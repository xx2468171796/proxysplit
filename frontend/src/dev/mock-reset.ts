// 预览用：清除与重置中心（清单与 Go 端 reset_catalog.go 对齐，执行只回假结果）。
type Item = {
  id: string;
  group: string;
  title: string;
  effect: string;
  restarts: boolean;
  danger: string;
  lost?: string[];
  kept?: string[];
  confirm?: string;
  backup: boolean;
  available: boolean;
  count: number;
  countText?: string;
};

const it = (p: Partial<Item> & Pick<Item, "id" | "group" | "title" | "effect">): Item => ({
  restarts: false,
  danger: "safe",
  backup: false,
  available: true,
  count: -1,
  ...p,
});

const items: Item[] = [
  it({ id: "core-dns-cache", group: "cache", title: "内核 DNS 缓存", effect: "清掉内核记住的域名解析结果" }),
  it({
    id: "noderesolve-cache",
    group: "cache",
    title: "节点域名解析缓存",
    effect: "重新解析节点服务器域名",
    available: false,
  }),
  it({
    id: "dns-prewarm",
    group: "cache",
    title: "DNS 预热名单",
    effect: "清空预先解析的常用域名名单",
    available: false,
  }),
  it({ id: "windows-dns-cache", group: "cache", title: "Windows 系统 DNS 缓存", effect: "等同 ipconfig /flushdns" }),
  it({ id: "rulesets", group: "cache", title: "规则库重新下载", effect: "从深圳镜像重新同步规则库并校验" }),
  it({ id: "log-spool", group: "cache", title: "本地日志队列", effect: "先上传待传日志，再清空本机日志队列" }),
  it({ id: "sysproxy", group: "network", title: "清理残留系统代理", effect: "关闭 Windows 系统代理" }),
  it({
    id: "strays",
    group: "network",
    title: "清理残留内核进程与虚拟网卡",
    effect: "结束上次崩溃留下的进程，运行中的代理会自动重启",
    restarts: true,
    danger: "caution",
  }),
  it({
    id: "binaries",
    group: "network",
    title: "重新下载 WinDivert 与 Xray",
    effect: "按 SHA256 校验，缺失或损坏的重新下载",
  }),
  it({
    id: "node-cores",
    group: "config",
    title: "节点内核选择全部恢复自动",
    effect: "每个节点的内核选择改回「自动」",
    restarts: true,
    danger: "caution",
    backup: true,
    lost: ["每个节点手动选的内核"],
    count: 2,
    countText: "2 个节点手动选了内核",
  }),
  it({
    id: "app-rules",
    group: "config",
    title: "应用名单清空",
    effect: "删除全部应用分流规则",
    restarts: true,
    danger: "caution",
    backup: true,
    lost: ["全部应用分流规则"],
    count: 6,
    countText: "将删除 6 条应用规则",
  }),
  it({
    id: "factory",
    group: "config",
    title: "恢复出厂",
    effect: "清空全部配置，相当于重新安装；代理会停止",
    restarts: true,
    danger: "danger",
    backup: true,
    confirm: "确认重置",
    lost: ["全部节点与订阅", "所有开关设置"],
    kept: ["账号、会员与本机授权", "AI 劫持开关与锁"],
  }),
];

let lastBackup = "";

export const mockReset = {
  GetResetCenter: () => ({ items, lastBackup, confirm: "确认重置" }),
  RunReset: (ids: unknown) => {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    if (list.some((id) => items.find((x) => x.id === id)?.backup)) lastBackup = "reset-20261028-120000-000.json";
    const results = list.map((id) => ({
      id,
      title: items.find((x) => x.id === id)?.title ?? id,
      ok: true,
      message: "已完成",
    }));
    return { results, backup: lastBackup, ok: results.length, failed: 0, ms: 420 };
  },
  UndoReset: () => {
    lastBackup = "";
    return "";
  },
};
