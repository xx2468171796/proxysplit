package service

import (
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"time"

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

// PostStartCheck runs right after the core starts: when neither mainland probe
// site can be reached, the core is most likely being blocked (the start itself
// succeeds, so the user would otherwise just see "nothing opens"). Returns a
// user-facing explanation, or "" when the network works.
func (s *Service) PostStartCheck() string {
	time.Sleep(2 * time.Second) // let routes and DNS hijack settle
	if !s.core.Running() {
		return ""
	}
	for _, addr := range []string{"www.baidu.com:443", "www.qq.com:443"} {
		if c, err := net.DialTimeout("tcp", addr, 5*time.Second); err == nil {
			c.Close()
			return ""
		}
	}
	msg := "开启代理后连不上国内网站（百度、QQ 都连不上）。"
	if advice := s.securityAdvice(DetectSecuritySoftware()); advice != "" {
		msg += advice
	} else {
		msg += "常见原因是安全软件或防火墙拦截了 proxysplit.exe 和 sing-box.exe，请在它的信任区 / 白名单里放行后重新启动代理；如果关掉代理也上不了网，就是网络本身的问题。"
	}
	s.log("[check] " + msg)
	return msg
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
