// AI 环境检测（AI 编程官网客户才显示）：劫持模式开关 + 逐项检测（AI 只走我们的线路、出口、DNS、IPv6、时区、时间、
// 其他代理 / VPN、开机自启）与一键修复。后端 App.CheckAIEnv / FixAIEnv（aiguard_app.go）。
import { Button, ConfirmDialog, InlineAlert, Panel, StatusChecklist } from "@ankotti/admin-ui";
import { useCallback, useEffect, useState } from "react";
import { api, onBackendEvent } from "../../api/backend";
import type { AIEnvItem, AIEnvReport, AIHijack } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";

const FIX_LABEL: Record<string, string> = {
  guard: "立即保护",
  timezone: "改成台北时间",
  clock: "立即对时",
  autostart: "开启",
};
const STATUS: Record<AIEnvItem["status"], "ok" | "warning" | "error" | "unknown"> = {
  ok: "ok",
  warn: "warning",
  fail: "error",
  info: "unknown",
};
const STATUS_TEXT = {
  ok: "正常",
  warning: "建议处理",
  error: "有风险",
  unknown: "—",
  pending: "检测中",
  off: "未开启",
};

function useAIEnv() {
  const { say } = useFeedback();
  const [report, setReport] = useState<AIEnvReport | null>(null);
  const [hijack, setHijack] = useState<AIHijack>({ on: false, locked: false, visible: false });
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState("");

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setReport(await api.checkAIEnv());
    } catch (e) {
      say(`检测失败：${String(e)}`);
    } finally {
      setChecking(false);
    }
  }, [say]);

  const loadHijack = useCallback(async () => {
    const h = await api.aiHijack().catch(() => null);
    if (h) setHijack(h);
    return h;
  }, []);

  // 别处登录后可能刚打开劫持模式：每 5 秒看一次，变成可见时检测一次。
  useEffect(() => {
    let visible = false;
    const poll = async () => {
      const h = await loadHijack();
      if (h?.visible && !visible) void check();
      visible = !!h?.visible;
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    const off = onBackendEvent<string>("ai-autostart-failed", (m) => say(`劫持模式自动启动代理失败：${m}`));
    return () => {
      clearInterval(timer);
      off();
    };
  }, [check, loadHijack, say]);

  const run = async (key: string, action: () => Promise<string>, ok: string) => {
    setFixing(key);
    try {
      const err = await action();
      say(err || ok);
    } catch (e) {
      say(String(e), "error");
    } finally {
      setFixing("");
    }
    await loadHijack();
    await check();
  };
  return { report, hijack, checking, fixing, check, run };
}

export function AIEnvPanel() {
  const { report, hijack, checking, fixing, check, run } = useAIEnv();
  const [confirmRestore, setConfirmRestore] = useState(false);
  if (!hijack.visible) return null;

  const problems = report?.items.filter((i) => i.status === "fail" || i.status === "warn").length ?? 0;
  const fixable = report?.items.some((i) => i.fix) ?? false;
  const exit = report?.exitIp ? ` · 出口 ${report.exitIp}（${report.exitLoc}）` : "";
  return (
    <Panel
      title="AI 环境检测"
      description="按 AI 防风控要求检查这台电脑：AI 只走我们的台湾线路，关掉 ProxySplit 时 AI 打不开，绝不会用本机 IP 访问。"
      count={report ? `${problems > 0 ? `${problems} 项需要处理` : "全部正常"}${exit}` : undefined}
      actions={
        <>
          {fixable ? (
            <Button
              size="sm"
              loading={fixing === "all"}
              disabled={checking}
              onClick={() => void run("all", () => api.fixAIEnv("all"), "已处理")}
            >
              一键修复
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            loading={checking}
            loadingText="检测中…"
            disabled={!!fixing}
            onClick={() => void check()}
          >
            重新检测
          </Button>
        </>
      }
    >
      <InlineAlert
        tone={hijack.on ? "success" : "warning"}
        density="compact"
        title={`劫持模式：${hijack.on ? "已开启" : "已关闭"}`}
        action={
          hijack.on ? (
            <Button size="sm" variant="outline" disabled={!!fixing} onClick={() => setConfirmRestore(true)}>
              恢复
            </Button>
          ) : (
            <Button
              size="sm"
              loading={fixing === "hijack-on"}
              onClick={() => void run("hijack-on", () => api.setAIHijack(true), "已开启劫持模式")}
            >
              开启劫持
            </Button>
          )
        }
      >
        {hijack.on
          ? "AI 网站只能经我们的线路访问；关掉软件、退出登录、重启电脑都保持劫持，AI 不会走本机（大陆）网络。只能在这里「恢复」。"
          : "已恢复：关掉软件时 AI 会走本机网络，有封号风险。"}
      </InlineAlert>
      {report ? (
        <StatusChecklist
          caption="AI 环境检测结果"
          summary={false}
          items={report.items}
          getId={(i) => i.id}
          label={(i) => i.name}
          reason={(i) => i.detail}
          status={(i) => STATUS[i.status] ?? "unknown"}
          statusLabel={(i) => STATUS_TEXT[STATUS[i.status] ?? "unknown"]}
          action={(i) =>
            i.fix
              ? {
                  label: fixing === i.fix ? "处理中…" : FIX_LABEL[i.fix] || "修复",
                  disabled: !!fixing,
                  onSelect: () => void run(i.fix ?? "", () => api.fixAIEnv(i.fix ?? ""), "已处理"),
                }
              : null
          }
          loading={checking && !report}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRestore}
        title="确定恢复？"
        tone="danger"
        confirmLabel="确定恢复"
        description="恢复后 AI 不再强制走我们的线路，关掉 ProxySplit 时 AI 会直接用本机（大陆）网络访问，账号可能被风控封禁。"
        onConfirm={() => run("hijack-off", () => api.setAIHijack(false), "已恢复：AI 不再强制走线路")}
        onClose={() => setConfirmRestore(false)}
      />
    </Panel>
  );
}
