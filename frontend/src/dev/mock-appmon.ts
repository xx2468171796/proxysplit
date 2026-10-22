// 应用库与逐应用监测的假后端（浏览器预览用）：内置模拟器 + 一个自定义应用；每个应用给一份样例统计和访问日志。
type Fn = (...args: unknown[]) => unknown;

const EMU_NOTE = "需使用默认 NAT 网络（关闭「网络桥接」）；整台模拟器一起走代理，多开实例进程名相同、无法分开";
const BUILTIN = [
  ["emu-ldplayer", "雷电模拟器", ["Ld9BoxHeadless.exe", "VBoxNetNAT.exe", "LdVBoxHeadless.exe"]],
  ["emu-mumu", "MuMu 模拟器", ["MuMuVMMHeadless.exe", "NemuHeadless.exe"]],
  ["emu-bluestacks", "蓝叠模拟器（BlueStacks）", ["HD-Player.exe", "HD-Network.exe"]],
  ["emu-nox", "夜神模拟器", ["NoxVMHandle.exe"]],
  ["emu-memu", "逍遥模拟器", ["MEmuHeadless.exe"]],
] as const;

type MockApp = { id: string; name: string; category: string; processes: string[]; note?: string; builtin: boolean };

const sample = (process: string) => {
  const h = [...process].reduce((n, c) => n + c.charCodeAt(0), 0);
  const failed = h % 4 === 0 ? 6 : h % 3;
  const ok = 20 + (h % 40);
  return {
    process,
    health: failed === 0 ? "ok" : failed > 5 ? "warn" : "ok",
    live: h % 5,
    total: ok + failed,
    ok,
    done: h % 7,
    failed,
    upload: h * 9100,
    download: h * 88_000,
    lastSeen: "2026-10-22 12:40:02",
    lastOk: "2026-10-22 12:40:02",
    lastFail: failed ? "2026-10-22 12:38:41" : "",
    lastHost: "www.google.com",
    lastExit: "JP | Tokyo - 01",
  };
};

// 样例连接：[目标, 出口, 结果, 原因, 程序, 协议, ↑, ↓, 持续秒]
const ACCESS: readonly (readonly [string, string, string, string, string, string, number, number, number])[] = [
  ["play.googleapis.com", "JP | Tokyo - 01", "成功", "", "Ld9BoxHeadless.exe", "tcp", 4200, 98_000, 12.4],
  ["android.googleapis.com", "JP | Tokyo - 01", "成功", "", "Ld9BoxHeadless.exe", "tcp", 1200, 5364, 3.1],
  [
    "www.gstatic.com",
    "JP | Tokyo - 01",
    "失败",
    "连接保持了几秒但没有收到任何数据（节点或目标无响应）",
    "Ld9BoxHeadless.exe",
    "tcp",
    1789,
    0,
    6,
  ],
  ["mtalk.google.com:5228", "JP | Tokyo - 01", "进行中", "", "VBoxNetNAT.exe", "tcp", 900, 2100, 48],
  [
    "1.82.219.234:123",
    "JP | Tokyo - 01",
    "失败",
    "open connection to 1.82.219.234:123 using outbound/vless[proxy]: dial udp: i/o timeout",
    "Ld9BoxHeadless.exe",
    "udp",
    48,
    0,
    5,
  ],
  [
    "172.217.113.4:443",
    "拦截",
    "拦截",
    "QUIC（UDP 443）按设计拦截，应用会自动改用 TCP，不影响使用",
    "Ld9BoxHeadless.exe",
    "udp",
    0,
    0,
    0,
  ],
  ["www.youtube.com", "JP | Tokyo - 01", "成功", "", "Ld9BoxHeadless.exe", "tcp", 9100, 883_780, 21],
  ["www.baidu.com", "直连", "完成", "", "Ld9BoxHeadless.exe", "tcp", 460, 0, 0.3],
  ["play.googleapis.com", "JP | Tokyo - 01", "成功", "", "Ld9BoxHeadless.exe", "tcp", 3100, 6875, 2.2],
  ["www.gstatic.com", "JP | Tokyo - 01", "成功", "", "Ld9BoxHeadless.exe", "tcp", 1700, 24_000, 1.8],
];

const mockAccess = (process: string) =>
  ACCESS.map(([host, outbound, status, reason, exe, network, upload, download, seconds], i) => ({
    time: `2026-10-22 14:5${Math.floor(i / 6)}:${String(50 - i * 4).padStart(2, "0")}`,
    host,
    network,
    outbound,
    rule:
      outbound === "直连"
        ? "rule_set geosite-cn => direct"
        : `process ${/[/]$/.test(process) ? "目录" : process} => proxy`,
    status,
    reason: reason || undefined,
    process: exe,
    path: `C:\\Program Files\\ldplayer9box\\${exe}`,
    upload,
    download,
    seconds,
  }));

type MockAccess = ReturnType<typeof mockAccess>[number];

// 和 Go 端 appid.Hosts 同口径：有失败的排前，再按连接数
const mockHosts = (list: MockAccess[]) => {
  const by = new Map<string, Record<string, number | string>>();
  for (const a of list) {
    const h = by.get(a.host) ?? {
      host: a.host,
      conns: 0,
      live: 0,
      ok: 0,
      done: 0,
      failed: 0,
      blocked: 0,
      upload: 0,
      download: 0,
      exit: a.outbound,
      network: a.network,
      lastSeen: a.time,
      lastError: "",
      seconds: 0,
    };
    const key =
      ({ 进行中: "live", 成功: "ok", 完成: "done", 失败: "failed", 拦截: "blocked" } as Record<string, string>)[
        a.status
      ] ?? "ok";
    h.conns = Number(h.conns) + 1;
    h[key] = Number(h[key]) + 1;
    h.upload = Number(h.upload) + a.upload;
    h.download = Number(h.download) + a.download;
    if (a.status === "失败") h.lastError = a.reason ?? "";
    by.set(a.host, h);
  }
  return [...by.values()].sort(
    (x, y) => Number(Number(y.failed) > 0) - Number(Number(x.failed) > 0) || Number(y.conns) - Number(x.conns),
  );
};

// 预览里详情的统计按样例连接算，和下面的表对得上
const statOf = (process: string, list: MockAccess[]) => {
  const n = (s: string) => list.filter((a) => a.status === s).length;
  const failed = n("失败");
  return {
    ...sample(process),
    health: failed ? "warn" : "ok",
    live: n("进行中"),
    total: list.length,
    ok: n("成功"),
    done: n("完成"),
    failed,
    upload: list.reduce((x, a) => x + a.upload, 0),
    download: list.reduce((x, a) => x + a.download, 0),
    lastSeen: "2026-10-22 14:51:26",
  };
};

export function createAppMonMock(): Record<string, Fn> {
  let custom: MockApp[] = [
    { id: "custom-1", name: "腾讯手游助手", category: "custom", processes: ["AndroidEmulatorEx.exe"], builtin: false },
  ];
  return {
    GetAppCatalog: () => [
      ...BUILTIN.map(([id, name, processes]) => ({
        id,
        name,
        category: "emulator",
        processes: [...processes],
        note: EMU_NOTE,
        builtin: true,
        // 预览：假装本机装了雷电（检测到安装目录 + 虚拟机目录）
        dirs: id === "emu-ldplayer" ? ["C:\\Program Files\\ldplayer9box\\", "D:\\LDPlayer\\LDPlayer14\\"] : undefined,
      })),
      ...custom,
    ],
    SetCustomApps: (apps) => {
      custom = (apps as MockApp[]).map((a, i) => ({ ...a, id: a.id || `custom-${i + 1}`, category: "custom" }));
      return "";
    },
    GetAppStats: (names) => (names as string[]).map(sample),
    GetAppMonitorDetail: (process) => {
      const access = mockAccess(String(process));
      return {
        stat: statOf(String(process), access),
        processes: [
          {
            process: "Ld9BoxHeadless.exe",
            path: "C:\\Program Files\\ldplayer9box\\Ld9BoxHeadless.exe",
            total: 91,
            failed: 12,
            download: 5_723_316,
            lastSeen: "2026-10-22 14:53:26",
          },
          {
            process: "VBoxNetNAT.exe",
            path: "C:\\Program Files\\ldplayer9box\\VBoxNetNAT.exe",
            total: 9,
            failed: 0,
            download: 1_011_538,
            lastSeen: "2026-10-22 14:52:28",
          },
        ],
        hosts: mockHosts(access),
        access,
        logs: [
          "+0800 2026-10-22 14:53:17 ERROR [3071459612 5.0s] connection: open connection to 1.82.219.234:123 using outbound/vless[proxy]: dial udp: i/o timeout",
        ],
      };
    },
    ResetAppMonitor: () => undefined,
    AppRouteTest: (process, url) => ({
      process,
      url,
      ok: true,
      httpCode: 204,
      seconds: 0.62,
      route: "node",
      hops: [
        {
          host: "www.google.com",
          rule: `process_name ${String(process)}`,
          outTag: "proxy",
          outbound: "JP | Tokyo - 01",
        },
      ],
    }),
  };
}
