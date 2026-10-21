// 端口代理页的假后端（浏览器预览用）：两个示例端口，来访设备、连接、访问日志、内核日志都带样例；增删改和启停会记住。
type Fn = (...args: unknown[]) => unknown;

type MockPort = {
  id: string;
  name: string;
  enabled: boolean;
  port: number;
  protocol: string;
  lan: boolean;
  user: string;
  pass: string;
  mode: string;
  node: string;
};

type SampleClient = { ip: string; conns: number; total: number; up: number; down: number };

const SAMPLE_CLIENTS: Record<string, SampleClient[]> = {
  p1: [
    { ip: "192.168.1.50", conns: 3, total: 128, up: 3_400_000, down: 52_000_000 },
    { ip: "192.168.1.61", conns: 1, total: 17, up: 210_000, down: 4_800_000 },
  ],
  p2: [{ ip: "127.0.0.1", conns: 2, total: 40, up: 880_000, down: 12_500_000 }],
};

const HOSTS: readonly (readonly [string, "proxy" | "direct" | "reject"])[] = [
  ["www.google.com", "proxy"],
  ["api.openai.com", "proxy"],
  ["www.baidu.com", "direct"],
  ["static.zhihu.com", "direct"],
  ["ads.example.com", "reject"],
  ["github.com", "proxy"],
];

const RULES = { proxy: "geosite:geolocation-!cn", direct: "geosite:cn", reject: "geosite:category-ads" };
const OUTBOUND_FIXED = { direct: "直连", reject: "拦截" };

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (ago: number) => {
  const d = new Date(Date.now() - ago * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const hostAt = (i: number) => HOSTS[i % HOSTS.length] ?? ["example.com", "proxy"];
const outboundOf = (tag: "proxy" | "direct" | "reject", node: string) => (tag === "proxy" ? node : OUTBOUND_FIXED[tag]);

function portStatus(p: MockPort, node: string) {
  const clients = p.enabled ? (SAMPLE_CLIENTS[p.id] ?? []) : [];
  const sum = (pick: (c: SampleClient) => number) => clients.reduce((n, c) => n + pick(c), 0);
  const grow = Math.floor(Date.now() / 2000) % 50;
  return {
    ...p,
    running: p.enabled,
    nodeName: node,
    conns: sum((c) => c.conns),
    upload: sum((c) => c.up) + grow * 1200,
    download: sum((c) => c.down) + grow * 56_000,
    clients: clients.map((c) => ({
      ip: c.ip,
      conns: c.conns,
      total: c.total,
      upload: c.up,
      download: c.down,
      firstSeen: stamp(3600),
      lastSeen: stamp(3),
    })),
  };
}

function mockConns(id: string, clients: SampleClient[], node: string) {
  return clients.flatMap((c, ci) =>
    Array.from({ length: c.conns }, (_, i) => {
      const [host, tag] = hostAt(ci + i);
      return {
        process: "",
        host,
        dest: `203.0.113.${10 + i}:443`,
        network: "tcp",
        rule: RULES[tag],
        outTag: tag,
        outbound: outboundOf(tag, node),
        upload: 4000 * (i + 1),
        download: 90_000 * (i + 1),
        id: `${id}-${ci}-${i}`,
        source: c.ip,
        start: new Date(Date.now() - 20_000).toISOString(),
      };
    }),
  );
}

function mockAccess(clients: SampleClient[], node: string) {
  return Array.from({ length: 120 }, (_, i) => {
    const [host, tag] = hostAt(i);
    return {
      time: stamp(i * 3),
      client: clients[i % Math.max(clients.length, 1)]?.ip ?? "",
      host,
      network: i % 7 === 0 ? "udp" : "tcp",
      outbound: outboundOf(tag, node),
      rule: RULES[tag],
    };
  });
}

function portDetail(p: MockPort | undefined, client: string, node: string) {
  if (!p?.enabled) return { conns: [], access: [], logs: [] };
  const clients = (SAMPLE_CLIENTS[p.id] ?? []).filter((c) => !client || c.ip === client);
  return {
    conns: mockConns(p.id, clients, node),
    access: mockAccess(clients, node),
    logs: [
      `+0800 ${stamp(60)} INFO [inbound/mixed] mixed server started at ${p.lan ? "0.0.0.0" : "127.0.0.1"}:${p.port}`,
      `+0800 ${stamp(30)} INFO [outbound] connected to ${node}`,
      `+0800 ${stamp(12)} WARN [dns] lookup timeout, retrying`,
      `+0800 ${stamp(4)} ERROR [outbound] dial tcp 203.0.113.9:443: i/o timeout`,
    ],
  };
}

const SEED: MockPort[] = [
  {
    id: "p1",
    name: "浏览器1",
    enabled: true,
    port: 10801,
    protocol: "mixed",
    lan: true,
    user: "",
    pass: "",
    mode: "rule",
    node: "",
  },
  {
    id: "p2",
    name: "浏览器2",
    enabled: true,
    port: 10802,
    protocol: "socks",
    lan: false,
    user: "tom",
    pass: "123456",
    mode: "global",
    node: "n2",
  },
];

export function createPortsMock(nodeName: (id: string) => string): Record<string, Fn> {
  let ports = SEED;
  let seq = 2;
  const nameOf = (p: MockPort) => nodeName(p.node || "n1");
  const patch = (id: unknown, change: Partial<MockPort>) => {
    ports = ports.map((x) => (x.id === id ? { ...x, ...change } : x));
    return "";
  };

  return {
    GetProxyPorts: () => ports.map((p) => portStatus(p, nameOf(p))),
    GetProxyPortDetail: (id, client) => {
      const p = ports.find((x) => x.id === id);
      return portDetail(p, String(client ?? ""), p ? nameOf(p) : "");
    },
    SaveProxyPort: (arg) => {
      const p = arg as MockPort;
      if (ports.some((x) => x.port === p.port && x.id !== p.id)) return `端口 ${p.port} 已被其它端口占用`;
      if (p.id) return patch(p.id, p);
      seq += 1;
      ports = [...ports, { ...p, id: `p${seq}`, enabled: true }];
      return "";
    },
    DeleteProxyPort: (id) => {
      ports = ports.filter((x) => x.id !== id);
    },
    SetProxyPortEnabled: (id, on) => patch(id, { enabled: !!on }),
    SetProxyPortMode: (id, mode) => patch(id, { mode: String(mode) }),
  };
}
