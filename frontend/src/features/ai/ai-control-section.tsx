// AI 控制（MCP / API）：让 Claude Code / Codex 等直接控制本机代理。
import { Button, ConfirmDialog, CopyField, DescriptionList, Note, Panel, StatusBadge } from "@ankotti/admin-ui";
import { Bot, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { copyText, regenerateAIToken, system } from "../../state/system";

export function AIControlSection() {
  const { say } = useFeedback();
  const ai = useStore(system, (s) => s.ai);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const copy = async (text: string, label: string) => {
    if (!text) return say("暂无内容，稍后再试", "info");
    say((await copyText(text)) ? `${label}已复制到剪贴板` : "复制失败，请手动选中复制");
  };

  return (
    <Panel
      className="qd-pane"
      title="AI 控制（MCP / API）"
      description="让 AI（Claude Code / Codex 等）直接控制本机代理：把某程序设为走代理 / 直连 / 全局、启停。"
      actions={
        <StatusBadge tone={ai.running ? "success" : "neutral"} variant="dot">
          {ai.running ? "已就绪" : "未启动"}
        </StatusBadge>
      }
    >
      <DescriptionList
        columns={2}
        items={[
          { label: "接口地址", value: <CopyField label="接口地址" value={ai.url} /> },
          {
            label: "Token",
            value: ai.token ? <CopyField label="Token" value={ai.token} secret /> : null,
            hint: "等于本机代理控制权，别外发",
          },
        ]}
      />
      <div className="ps-set-actions ps-set-gap">
        <Button onClick={() => void copy(ai.prompt, "AI 提示词")}>
          <Bot />
          一键复制 AI 提示词
        </Button>
        <Button variant="outline" onClick={() => void copy(ai.mcpConfig, "MCP 配置")}>
          <Copy />
          复制 MCP 配置
        </Button>
        <Button variant="outline" disabled={!ai.token} onClick={() => setConfirmRegen(true)}>
          <RefreshCw />
          重新生成令牌
        </Button>
      </div>
      <Note as="p" className="ps-set-note">
        用法：点「一键复制 AI 提示词」→ 粘贴给你的 AI（Claude Code / Codex）→ 直接说「让 Chrome
        走代理」即可。提示词已内置接口地址与 Token，AI 用 curl 就能控制。「复制 MCP 配置」给的是命令方式（本程序
        --mcp），配好后即使 ProxySplit 没打开，AI 调用时也会自动在后台启动它。
      </Note>
      <ConfirmDialog
        open={confirmRegen}
        title="重新生成令牌？"
        description="旧令牌会立刻失效。之前把提示词粘贴给过的 AI 工具（Claude Code / Codex 等）要重新复制一次提示词才能继续控制；用「MCP 配置」接入的不用改，它会自己读到新令牌。怀疑令牌被别人看到时请重新生成。"
        tone="warning"
        confirmLabel="重新生成"
        onConfirm={async () => {
          const text = await regenerateAIToken();
          if (text.includes("失败")) throw new Error(text);
          say(text);
        }}
        onClose={() => setConfirmRegen(false)}
      />
    </Panel>
  );
}
