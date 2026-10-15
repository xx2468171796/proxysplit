package service

import (
	"fmt"
	"path/filepath"
	"strings"

	"proxysplit/internal/proc"
)

// Security software that commonly blocks a TUN proxy: once the core owns the
// routes, every connection — mainland "direct" ones included — is made by
// sing-box.exe, so a product that distrusts it breaks all browsing.
var securityProducts = []struct {
	name  string
	procs []string
}{
	{"火绒", []string{"hipsdaemon.exe", "hipstray.exe", "usysdiag.exe", "wsctrlsvc.exe"}},
	{"360 安全卫士 / 360 杀毒", []string{"360tray.exe", "zhudongfangyu.exe", "360sd.exe", "360rp.exe", "360safe.exe"}},
	{"腾讯电脑管家", []string{"qqpcrtp.exe", "qqpctray.exe", "qqpcmgr.exe"}},
	{"金山毒霸", []string{"kxetray.exe", "kxescore.exe", "kxemain.exe"}},
	{"2345 安全卫士", []string{"2345safetray.exe", "2345safecenter.exe"}},
	{"卡巴斯基", []string{"avp.exe", "avpui.exe"}},
	{"ESET", []string{"ekrn.exe", "egui.exe"}},
	{"诺顿", []string{"nortonsecurity.exe", "ns.exe"}},
}

// matchSecurity names the products whose processes are among running.
func matchSecurity(running map[string]bool) []string {
	var out []string
	for _, p := range securityProducts {
		for _, name := range p.procs {
			if running[name] {
				out = append(out, p.name)
				break
			}
		}
	}
	return out
}

// DetectSecuritySoftware lists the security products running right now.
func DetectSecuritySoftware() []string {
	list, err := proc.ListProcesses()
	if err != nil {
		return nil
	}
	running := make(map[string]bool, len(list))
	for _, p := range list {
		running[strings.ToLower(p.Name)] = true
	}
	return matchSecurity(running)
}

// securityAdvice tells the user how to let ProxySplit through the given
// products; "" when none are running.
func (s *Service) securityAdvice(products []string) string {
	if len(products) == 0 {
		return ""
	}
	return fmt.Sprintf("检测到安全软件：%s。开代理后如果网站打不开（连本该直连的国内网站也打不开），多半是它拦了 ProxySplit：在它的「信任区 / 白名单 / 联网控制」里放行 proxysplit.exe 和 %s，然后重新启动代理。",
		strings.Join(products, "、"), filepath.Join(s.binDir, "sing-box.exe"))
}

// withSecurityHint appends the security-software advice to a start failure.
func (s *Service) withSecurityHint(err error) error {
	if err == nil {
		return nil
	}
	if advice := s.securityAdvice(DetectSecuritySoftware()); advice != "" {
		return fmt.Errorf("%w（%s）", err, advice)
	}
	return err
}
