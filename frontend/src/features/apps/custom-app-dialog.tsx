// 新建 / 编辑一个自定义应用：名称 + 进程名或程序目录（一行一个，或用逗号分隔），保存到应用库。
// 完整路径且不以 .exe 结尾的算目录：目录下所有程序都走这个应用的规则。
import { FormDialog, FormField, Input, Textarea } from "@ankotti/admin-ui";
import { useState } from "react";
import type { CatalogApp } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { customApps, saveCustomApps } from "../../state/app-monitor";

/** 目录：盘符开头的完整路径，以 \ 结尾，或最后一段没有扩展名（D:\Games\GameLoop）；C:\x\run.bat 这种不算 */
export const isDirEntry = (s: string): boolean =>
  /^[a-z]:[\\/]/i.test(s) && (/[\\/]$/.test(s) || !/\.[^\\/.]+$/.test(s));

export const splitEntries = (text: string): { processes: string[]; dirs: string[] } => {
  const all = text
    .split(/[\n,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { processes: all.filter((s) => !isDirEntry(s)), dirs: all.filter(isDirEntry) };
};

const joinEntries = (app: CatalogApp | null) => [...(app?.dirs ?? []), ...(app?.processes ?? [])].join("\n");

export function CustomAppDialog({ app, onClose }: { app: CatalogApp | null; onClose: () => void }) {
  const { say } = useFeedback();
  const [name, setName] = useState(app?.name ?? "");
  const [entries, setEntries] = useState(joinEntries(app));
  const [note, setNote] = useState(app?.note ?? "");
  const dirty = name !== (app?.name ?? "") || entries !== joinEntries(app) || note !== (app?.note ?? "");

  return (
    <FormDialog
      open
      size="md"
      title={app ? `编辑「${app.name}」` : "自定义应用"}
      description="填程序目录最省心：目录下所有程序都走这个应用的规则，换了进程名也能抓到。也可以填具体进程名（任务管理器「详细信息」里能看到）。"
      submitLabel="保存"
      dirty={dirty}
      onClose={onClose}
      onSubmit={async () => {
        const { processes, dirs } = splitEntries(entries);
        const entry: CatalogApp = {
          id: app?.id ?? "",
          name: name.trim(),
          category: "custom",
          processes,
          dirs,
          note: note.trim(),
          builtin: false,
        };
        if (!entry.name) throw new Error("请填写名称");
        if (!processes.length && !dirs.length) throw new Error("至少填一个程序目录或进程名");
        const list = customApps();
        const next = app ? list.map((a) => (a.id === app.id ? entry : a)) : [...list, entry];
        const err = await saveCustomApps(next);
        if (err) throw new Error(err);
        say(`已保存「${entry.name}」`);
      }}
    >
      <FormField label="名称" htmlFor="custom-app-name" required>
        <Input
          id="custom-app-name"
          value={name}
          placeholder="如 腾讯手游助手"
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <FormField
        label="程序目录或进程名"
        htmlFor="custom-app-procs"
        required
        hint="一行一个。目录写完整路径，如 D:\Program Files\GameLoop；进程名如 AndroidEmulator.exe（.exe 可省略）"
      >
        <Textarea id="custom-app-procs" rows={5} value={entries} onChange={(e) => setEntries(e.target.value)} />
      </FormField>
      <FormField label="备注" htmlFor="custom-app-note">
        <Input id="custom-app-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </FormDialog>
  );
}
