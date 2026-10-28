// 导入前的预览确认：来源、导出设备与时间、各部分数量，勾选要恢复的部分。确认前 Go 端会自动备份当前配置（可撤销一次）。
import { Checkbox, DescriptionList, FormDialog, Note } from "@ankotti/admin-ui";
import { useState } from "react";
import type { ConfigPreview, ConfigSection } from "../../../api/types-account";
import { useFeedback } from "../../../app/use-feedback";
import { fmtDateTime } from "../../../shared/format";
import { useStore } from "../../../shared/store";
import { cancelImport, configSync, confirmImport, type ImportSource, SECTION_LABELS } from "../../../state/configsync";

const TITLES: Record<ImportSource, string> = {
  file: "导入配置文件",
  profile: "恢复云端配置",
  share: "导入别人分享的配置",
};

function countOf(p: ConfigPreview, s: ConfigSection): string {
  switch (s) {
    case "nodes":
      return `${p.nodes} 个节点`;
    case "subscriptions":
      return `${p.subscriptions} 个订阅`;
    case "rules":
      return `${p.rules} 条规则 · ${p.lines} 条线路`;
    case "proxyPorts":
      return `${p.proxyPorts} 个端口`;
    default:
      return p.hasSettings ? "主题、启动、DNS、模式等" : "无";
  }
}

export function ImportPreviewDialog() {
  const pending = useStore(configSync, (s) => s.pending);
  if (!pending) return null;
  return (
    <PreviewForm
      key={`${pending.source}-${pending.preview.exportedAt}`}
      source={pending.source}
      preview={pending.preview}
    />
  );
}

function PreviewForm({ source, preview }: { source: ImportSource; preview: ConfigPreview }) {
  const { say } = useFeedback();
  const [picked, setPicked] = useState<ConfigSection[]>(preview.sections);
  const toggle = (s: ConfigSection, on: boolean) =>
    setPicked((cur) => (on ? [...cur.filter((x) => x !== s), s] : cur.filter((x) => x !== s)));
  const title = preview.name ? `${TITLES[source]}「${preview.name}」` : TITLES[source];
  return (
    <FormDialog
      open
      size="md"
      title={title}
      description="勾选要恢复的部分，没勾的保持本机现状。导入前会自动备份当前配置，不满意可以在「配置与同步」里撤销。"
      submitLabel="确认导入"
      dirty
      onClose={cancelImport}
      onSubmit={async () => {
        const err = await confirmImport(picked);
        if (err) throw new Error(err);
        say("配置已导入，原来的配置已备份，可随时撤销", "success");
      }}
    >
      <DescriptionList
        columns={2}
        items={[
          { label: "来自设备", value: preview.device || "未知" },
          { label: "导出时间", value: preview.exportedAt ? fmtDateTime(preview.exportedAt) : "未知" },
        ]}
      />
      <fieldset className="ps-sync-sections" aria-label="要恢复的内容">
        {preview.sections.map((s) => (
          <label key={s} className="ps-sync-section" htmlFor={`imp-${s}`}>
            <Checkbox id={`imp-${s}`} checked={picked.includes(s)} onCheckedChange={(v) => toggle(s, v === true)} />
            <span className="ps-sync-section-name">{SECTION_LABELS[s]}</span>
            <Note as="span">{countOf(preview, s)}</Note>
          </label>
        ))}
      </fieldset>
      <Note as="p">POWER云 官方线路和账号信息不在配置包里，本机已有的官方线路会保留。</Note>
    </FormDialog>
  );
}
