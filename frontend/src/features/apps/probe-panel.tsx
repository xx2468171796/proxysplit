// 立即检测：以该程序的名字真实访问一个网址，告诉用户通没通、多快、从哪里出去。
import { Button, Choice, InlineAlert, Input } from "@ankotti/admin-ui";
import { Activity } from "lucide-react";
import { useState } from "react";
import type { RouteTestResult } from "../../api/types";
import { routeTest } from "../../state/app-monitor";

const GOOGLE = "https://www.google.com/generate_204";
const TARGETS = [
  { value: GOOGLE, label: "Google（境外）" },
  { value: "https://www.youtube.com", label: "YouTube（境外）" },
  { value: "https://www.baidu.com", label: "百度（国内）" },
  { value: "custom", label: "自定义网址" },
];

const ROUTE: Record<string, string> = { direct: "直连", node: "走节点", reject: "被拦截", unknown: "未知" };

function summary(r: RouteTestResult): string {
  const exit = r.hops.find((h) => h.outbound)?.outbound;
  const way = ROUTE[r.route] ?? r.route;
  return `${way}${exit && r.route === "node" ? `（${exit}）` : ""} · HTTP ${r.httpCode || "—"} · ${r.seconds.toFixed(2)} 秒`;
}

export function ProbePanel({ process }: { process: string }) {
  const [target, setTarget] = useState(GOOGLE);
  const [custom, setCustom] = useState("https://");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RouteTestResult | null>(null);
  const url = target === "custom" ? custom.trim() : target;

  const run = async () => {
    setBusy(true);
    try {
      setRes(await routeTest(process, url));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ps-mon-probe">
      <div className="ps-row">
        <Choice size="sm" label="检测目标" value={target} options={TARGETS} onChange={setTarget} />
        {target === "custom" ? (
          <Input aria-label="自定义网址" value={custom} onChange={(e) => setCustom(e.target.value)} />
        ) : null}
        <Button size="sm" loading={busy} onClick={() => void run()}>
          <Activity />
          立即检测
        </Button>
      </div>
      {res ? (
        <InlineAlert
          density="compact"
          tone={res.ok ? "success" : "error"}
          title={res.ok ? `连接成功：${summary(res)}` : `连接失败：${res.error || summary(res)}`}
        >
          {res.note || "以这个程序的名字真实发了一次请求，结果和该程序自己联网时走的路线一致。"}
        </InlineAlert>
      ) : null}
    </section>
  );
}
