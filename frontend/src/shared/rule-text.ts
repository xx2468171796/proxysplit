// 内核的「命中规则」原文（process_name=[chrome.exe] => route(proxy)、rule_set geosite-cn、final…）换成白话；认不出的原样返回。

const SETS: Record<string, string> = {
  "geosite-cn": "国内网站",
  "geoip-cn": "国内 IP",
  "geosite-ads": "广告网站",
  "geosite-category-ads-all": "广告网站",
  "geosite-private": "局域网",
  "geoip-private": "局域网",
  "geosite-geolocation-!cn": "国外网站",
};

const KINDS: Record<string, (v: string) => string> = {
  process_name: (v) => `应用 ${v}`,
  process_path: (v) => `程序 ${v}`,
  process_path_regex: () => "整个目录的应用",
  rule_set: (v) =>
    v
      .split(/\s*,\s*/)
      .map((s) => SETS[s] ?? s)
      .join("、"),
  domain: (v) => `网站 ${v}`,
  domain_suffix: (v) => `网站 ${v}`,
  domain_keyword: (v) => `网址含 ${v}`,
  ip_cidr: (v) => `IP ${v}`,
  port: (v) => `端口 ${v}`,
  port_range: (v) => `端口 ${v}`,
  inbound: () => "端口代理",
  protocol: (v) => `${v} 协议`,
};

export function ruleText(raw?: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^final\b/i.test(s)) return "默认规则";
  const cond = s.split("=>")[0]?.trim() ?? s;
  const m = /^([a-z_]+)\s*[= ]\s*\[?([^\]]*)\]?/i.exec(cond);
  const kind = m && KINDS[m[1]?.toLowerCase() ?? ""];
  return m && kind ? kind((m[2] ?? "").trim()) : s;
}
