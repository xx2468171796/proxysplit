package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/download"
)

const maxDownloadSize = 300 << 20

// checkTimeout bounds one release query (a small JSON document). The package
// download has no overall deadline: see Download.
const checkTimeout = 90 * time.Second

var versionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

// Release is the signed public release record returned by the commercial API.
type Release struct {
	Version        string `json:"version"`
	MinimumVersion string `json:"minimumVersion"`
	URL            string `json:"url"`
	SHA256         string `json:"sha256"`
	Signature      string `json:"signature"`
	Mandatory      bool   `json:"mandatory"`
	PublishedAt    string `json:"publishedAt"`
}

// Status is safe to expose directly to the Wails frontend.
type Status struct {
	Enabled   bool     `json:"enabled"`
	Current   string   `json:"current"`
	Available bool     `json:"available"`
	Release   *Release `json:"release,omitempty"`
	Error     string   `json:"error,omitempty"`
}

// Client checks, verifies and downloads signed Windows releases.
type Client struct {
	mu        sync.Mutex
	apiURL    string
	current   string
	dataDir   string
	publicKey ed25519.PublicKey
	http      *http.Client
}

func New(apiURL, current, dataDir, publicKeyBase64, tlsSPKI string) *Client {
	return &Client{
		apiURL:    strings.TrimRight(strings.TrimSpace(apiURL), "/"),
		current:   normalizeVersion(current),
		dataDir:   dataDir,
		publicKey: parsePublicKey(publicKeyBase64),
		// No client Timeout: it would also cap the body of a ~130 MB package, so
		// slow lines never finished. Connecting, TLS and the response headers
		// are bounded on the transport; Check adds its own deadline and Download
		// is policed by the stall watchdog.
		http: &http.Client{
			Transport: pinnedTransport(tlsSPKI),
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 4 {
					return errors.New("更新下载重定向次数过多")
				}
				return nil
			},
		},
	}
}

func (c *Client) Enabled() bool {
	return c.apiURL != "" && len(c.publicKey) == ed25519.PublicKeySize
}

func (c *Client) Check(ctx context.Context) Status {
	status := Status{Enabled: c.Enabled(), Current: c.current}
	if !status.Enabled {
		return status
	}
	api, err := url.Parse(c.apiURL)
	if err != nil || api.Scheme != "https" || api.Host == "" {
		status.Error = "自动更新服务地址无效"
		return status
	}
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	// Stable clients must only ever be offered stable releases; the server
	// isolates channels so a higher-versioned beta never auto-updates them.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiURL+"/v1/releases/latest?channel=stable&platform="+Platform, nil)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	resp, err := c.http.Do(req)
	if err != nil {
		status.Error = "检查更新失败：" + err.Error()
		return status
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		status.Error = "读取更新信息失败：" + err.Error()
		return status
	}
	if resp.StatusCode != http.StatusOK {
		status.Error = fmt.Sprintf("更新服务返回 HTTP %d", resp.StatusCode)
		return status
	}
	var envelope struct {
		Release *Release `json:"release"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		status.Error = "更新清单格式无效"
		return status
	}
	if envelope.Release == nil {
		return status
	}
	if err := c.verifyRelease(*envelope.Release); err != nil {
		status.Error = err.Error()
		return status
	}
	status.Release = envelope.Release
	status.Available = compareVersion(c.current, envelope.Release.Version) < 0
	return status
}

// Download fetches a previously checked release and verifies both its digest
// and its detached Ed25519 signature before returning a local path.
func (c *Client) Download(ctx context.Context, release Release) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.verifyRelease(release); err != nil {
		return "", err
	}
	if compareVersion(c.current, release.Version) >= 0 {
		return "", errors.New("当前已是最新版本")
	}
	dir := filepath.Join(c.dataDir, "updates")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	final := filepath.Join(dir, "proxysplit-v"+release.Version+PackageExt)
	path := final + ".download"
	dropOtherPartials(dir, path)
	// The partial file survives a failed attempt (timeout, stall, app closed)
	// and the next one continues it with Range. What it ends up holding is
	// trusted only through the signed SHA256, exactly as a one-shot download.
	// A partial that fails the hash after being continued is thrown away and
	// fetched once more from the start.
	for attempt := 0; attempt < 2; attempt++ {
		from := int64(0)
		if !fileHasSHA256(path, release.SHA256) { // else: complete from an earlier attempt
			var err error
			from, err = download.Resume(ctx, download.Request{Client: c.http, URL: release.URL, Path: path, MaxBytes: maxDownloadSize})
			if err != nil {
				return "", fmt.Errorf("下载更新失败：%w", err)
			}
		}
		if fileHasSHA256(path, release.SHA256) {
			if err := os.Rename(path, final); err != nil {
				_ = os.Remove(path)
				return "", err
			}
			return final, nil
		}
		_ = os.Remove(path)
		if from == 0 {
			break
		}
	}
	return "", errors.New("更新文件 SHA256 校验失败")
}

// fileHasSHA256 reports whether the file at path exists and has the digest.
func fileHasSHA256(path, want string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return false
	}
	return strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), want)
}

// dropOtherPartials deletes partial downloads of other releases (a newer one
// superseded them), so abandoned ~100 MB files do not pile up.
func dropOtherPartials(dir, keep string) {
	partials, _ := filepath.Glob(filepath.Join(dir, "*.download"))
	for _, p := range partials {
		if p != keep {
			_ = os.Remove(p)
		}
	}
}

func (c *Client) verifyRelease(release Release) error {
	if !versionPattern.MatchString(release.Version) || !versionPattern.MatchString(release.MinimumVersion) {
		return errors.New("更新版本号格式无效")
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(release.SHA256) {
		return errors.New("更新 SHA256 格式无效")
	}
	u, err := url.Parse(release.URL)
	if err != nil || u.Scheme != "https" || u.Host == "" || !strings.HasSuffix(strings.ToLower(u.Path), PackageExt) {
		return errors.New("更新下载地址无效")
	}
	sig, err := base64.StdEncoding.DecodeString(release.Signature)
	if err != nil {
		sig, err = base64.RawURLEncoding.DecodeString(release.Signature)
	}
	if err != nil || len(sig) != ed25519.SignatureSize {
		return errors.New("更新签名格式无效")
	}
	if len(c.publicKey) != ed25519.PublicKeySize || !ed25519.Verify(c.publicKey, []byte(SigningMessage(release.Version, release.SHA256, release.URL)), sig) {
		return errors.New("更新签名验证失败")
	}
	return nil
}

// SigningMessage is shared with cmd/releasesign. Any format change must bump
// this domain separator so an old signature cannot be interpreted differently.
func SigningMessage(version, sha256Hex, downloadURL string) string {
	return "ProxySplit-Release-Signature-v1\n" +
		"version=" + version + "\n" +
		"sha256=" + strings.ToLower(sha256Hex) + "\n" +
		"url=" + downloadURL + "\n"
}

func parsePublicKey(encoded string) ed25519.PublicKey {
	der, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil
	}
	parsed, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return nil
	}
	key, _ := parsed.(ed25519.PublicKey)
	return key
}

func pinnedTransport(expected string) http.RoundTripper {
	transport := download.WithPhaseTimeouts(http.DefaultTransport.(*http.Transport).Clone())
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return transport
	}
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, VerifyConnection: func(cs tls.ConnectionState) error {
		if len(cs.PeerCertificates) == 0 {
			return errors.New("更新服务器证书缺失")
		}
		sum := sha256.Sum256(cs.PeerCertificates[0].RawSubjectPublicKeyInfo)
		hexPin := hex.EncodeToString(sum[:])
		base64Pin := base64.StdEncoding.EncodeToString(sum[:])
		if !strings.EqualFold(hexPin, expected) && base64Pin != expected {
			return errors.New("更新服务器证书指纹不匹配")
		}
		return nil
	}}
	return transport
}

func normalizeVersion(v string) string {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if !versionPattern.MatchString(v) {
		return "0.0.0"
	}
	return v
}

func compareVersion(a, b string) int {
	pa, pb := strings.Split(normalizeVersion(a), "."), strings.Split(normalizeVersion(b), ".")
	for i := 0; i < 3; i++ {
		ai, _ := strconv.Atoi(pa[i])
		bi, _ := strconv.Atoi(pb[i])
		if ai < bi {
			return -1
		}
		if ai > bi {
			return 1
		}
	}
	return 0
}
