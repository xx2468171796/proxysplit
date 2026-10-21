package accel

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	utls "github.com/refraction-networking/utls"
)

// 兜底直连的握手不写死在客户端：中继打招呼时把它连官方用的稳定握手配置（sub2api accel TlsProfile，cc-follow 自动跟官方）
// 整份交过来，编码端按 BoringSSL 的规则复刻成 ClientHello。官方只改了配置能表达的东西（加签名算法、换组……）时客户端自动跟上，
// 不用发新版；配置里有这里不认识的字段 / 取值（官方换了需要改代码的东西）→ 复刻不了 → 不兜底、不接管 Claude Code。
// 与官方实抓逐字节比对见 direct_test.go。下面的词表 sub2api 哨兵 guard/internal/features/proxysplit_fallback.go 抄了一份
// （判断 cc-follow 推的新配置这里复刻不复刻得了，复刻不了就告警），改这里要同改那边。

// tlsProfile 与 accel/src/tls_profile.rs 的 TlsProfile 字段一一对应
type tlsProfile struct {
	V                    int      `json:"v"`
	Name                 string   `json:"name"`
	MinVersion           string   `json:"min_version"`
	MaxVersion           string   `json:"max_version"`
	Ciphers              string   `json:"ciphers"`
	Curves               string   `json:"curves"`
	Sigalgs              string   `json:"sigalgs"`
	ALPN                 []string `json:"alpn"`
	OCSPStapling         bool     `json:"ocsp_stapling"`
	SignedCertTimestamps bool     `json:"signed_cert_timestamps"`
	GREASE               bool     `json:"grease"`
	PermuteExtensions    bool     `json:"permute_extensions"`
	SessionTickets       bool     `json:"session_tickets"`
}

// handshakeSHA256 与中继 TlsProfile::handshake_sha256 同算法：去掉 name 后键排序、无空白的 JSON 的 sha256。
// 对收到的原始 JSON 算（不先解进结构体），中继多出来的字段也算进去
func handshakeSHA256(raw []byte) (string, error) {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", err
	}
	delete(m, "name")
	canon, err := json.Marshal(m) // map 按键排序
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canon)
	return hex.EncodeToString(sum[:]), nil
}

// parseProfile 核对指纹（hs 由中继 v2 签名担保）并检查能否复刻
func parseProfile(raw []byte, hs string) (*tlsProfile, error) {
	if len(raw) == 0 {
		return nil, errors.New("中继没给握手配置")
	}
	got, err := handshakeSHA256(raw)
	if err != nil || got != hs {
		return nil, errors.New("握手配置与签名的指纹不符")
	}
	var p tlsProfile
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("握手配置有不认识的内容：%w", err)
	}
	if _, err := p.spec(); err != nil {
		return nil, err
	}
	return &p, nil
}

var (
	tls12Ciphers = map[string]uint16{
		"ECDHE-ECDSA-AES128-GCM-SHA256": utls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		"ECDHE-RSA-AES128-GCM-SHA256":   utls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		"ECDHE-ECDSA-AES256-GCM-SHA384": utls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
		"ECDHE-RSA-AES256-GCM-SHA384":   utls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
		"ECDHE-ECDSA-CHACHA20-POLY1305": utls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
		"ECDHE-RSA-CHACHA20-POLY1305":   utls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
		"ECDHE-ECDSA-AES128-SHA":        utls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA,
		"ECDHE-RSA-AES128-SHA":          utls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA,
		"ECDHE-ECDSA-AES256-SHA":        utls.TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA,
		"ECDHE-RSA-AES256-SHA":          utls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
		"AES128-GCM-SHA256":             utls.TLS_RSA_WITH_AES_128_GCM_SHA256,
		"AES256-GCM-SHA384":             utls.TLS_RSA_WITH_AES_256_GCM_SHA384,
		"AES128-SHA":                    utls.TLS_RSA_WITH_AES_128_CBC_SHA,
		"AES256-SHA":                    utls.TLS_RSA_WITH_AES_256_CBC_SHA,
	}
	tlsCurves = map[string]utls.CurveID{
		"X25519MLKEM768": utls.X25519MLKEM768,
		"X25519":         utls.X25519,
		"P-256":          utls.CurveP256,
		"P-384":          utls.CurveP384,
		"P-521":          utls.CurveP521,
	}
	tlsSigalgs = map[string]utls.SignatureScheme{
		"ECDSA+SHA256":        utls.ECDSAWithP256AndSHA256,
		"ECDSA+SHA384":        utls.ECDSAWithP384AndSHA384,
		"ECDSA+SHA512":        utls.ECDSAWithP521AndSHA512,
		"ECDSA+SHA1":          utls.ECDSAWithSHA1,
		"rsa_pss_rsae_sha256": utls.PSSWithSHA256,
		"rsa_pss_rsae_sha384": utls.PSSWithSHA384,
		"rsa_pss_rsae_sha512": utls.PSSWithSHA512,
		"RSA+SHA256":          utls.PKCS1WithSHA256,
		"RSA+SHA384":          utls.PKCS1WithSHA384,
		"RSA+SHA512":          utls.PKCS1WithSHA512,
		"RSA+SHA1":            utls.PKCS1WithSHA1,
		"ed25519":             utls.Ed25519,
	}
)

func lookupAll[T any](list, what string, table map[string]T) ([]T, error) {
	var out []T
	for _, n := range strings.Split(list, ":") {
		v, ok := table[n]
		if !ok {
			return nil, fmt.Errorf("握手配置里的%s %q 本机复刻不了", what, n)
		}
		out = append(out, v)
	}
	return out, nil
}

// spec 按 BoringSSL（Bun 内置）的规则把配置变成 ClientHello：扩展顺序 = BoringSSL kExtensions，TLS 1.3 套件固定在前，
// 首选组是后量子混合组时另带一份 X25519 密钥。每次连接都要新建（扩展里存着本次的密钥）
func (p *tlsProfile) spec() (*utls.ClientHelloSpec, error) {
	switch {
	case p.V != 1:
		return nil, fmt.Errorf("握手配置格式版本 %d 本机不认识", p.V)
	case p.MinVersion != "1.2" || p.MaxVersion != "1.3":
		return nil, fmt.Errorf("握手配置的 TLS 版本 %s–%s 本机复刻不了", p.MinVersion, p.MaxVersion)
	case p.GREASE || p.PermuteExtensions:
		return nil, errors.New("握手配置开了 GREASE / 扩展乱序，本机复刻不了")
	case len(p.ALPN) != 1 || p.ALPN[0] != "http/1.1":
		return nil, fmt.Errorf("握手配置的 ALPN %v 本机复刻不了（兜底只会 HTTP/1.1）", p.ALPN)
	}
	c12, err := lookupAll(p.Ciphers, "密码套件", tls12Ciphers)
	if err != nil {
		return nil, err
	}
	curves, err := lookupAll(p.Curves, "密钥交换组", tlsCurves)
	if err != nil {
		return nil, err
	}
	sigs, err := lookupAll(p.Sigalgs, "签名算法", tlsSigalgs)
	if err != nil {
		return nil, err
	}
	shares := []utls.KeyShare{{Group: curves[0]}}
	if curves[0] == utls.X25519MLKEM768 {
		shares = append(shares, utls.KeyShare{Group: utls.X25519})
	}
	exts := []utls.TLSExtension{
		&utls.SNIExtension{},
		&utls.ExtendedMasterSecretExtension{},
		&utls.RenegotiationInfoExtension{Renegotiation: utls.RenegotiateOnceAsClient},
		&utls.SupportedCurvesExtension{Curves: curves},
		&utls.SupportedPointsExtension{SupportedPoints: []byte{0}},
	}
	if p.SessionTickets {
		exts = append(exts, &utls.SessionTicketExtension{})
	}
	if len(p.ALPN) > 0 {
		exts = append(exts, &utls.ALPNExtension{AlpnProtocols: append([]string(nil), p.ALPN...)})
	}
	if p.OCSPStapling {
		exts = append(exts, &utls.StatusRequestExtension{})
	}
	exts = append(exts, &utls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: sigs})
	if p.SignedCertTimestamps {
		exts = append(exts, &utls.SCTExtension{})
	}
	exts = append(exts,
		&utls.KeyShareExtension{KeyShares: shares},
		&utls.PSKKeyExchangeModesExtension{Modes: []uint8{utls.PskModeDHE}},
		&utls.SupportedVersionsExtension{Versions: []uint16{utls.VersionTLS13, utls.VersionTLS12}},
		// 握手包 256–511 字节时 BoringSSL 补 padding；带后量子密钥时远超 511，不补
		&utls.UtlsPaddingExtension{GetPaddingLen: utls.BoringPaddingStyle},
	)
	return &utls.ClientHelloSpec{
		TLSVersMin:         utls.VersionTLS12,
		TLSVersMax:         utls.VersionTLS13,
		CipherSuites:       append([]uint16{utls.TLS_AES_128_GCM_SHA256, utls.TLS_AES_256_GCM_SHA384, utls.TLS_CHACHA20_POLY1305_SHA256}, c12...),
		CompressionMethods: []byte{0},
		Extensions:         exts,
	}, nil
}
