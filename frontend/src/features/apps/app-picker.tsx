// 添加应用：从运行中的进程挑，或从文件夹选 exe（不必在运行），或手动填 exe 名 / 完整路径。
import {
  ActionList,
  Button,
  Dialog,
  DialogFooter,
  Input,
  isComposingEvent,
  SearchBox,
  StatusBadge,
} from "@ankotti/admin-ui";
import { FolderOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Proc } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { AppIcon } from "../../components/app-icon";
import { appDisplayName } from "../../shared/app-names";
import { useStore } from "../../shared/store";
import { addRule, apps, pickFiles, procHasRule, refreshProcesses } from "../../state/app-rules";
import { data } from "../../state/data";
import { useSaveNotice } from "./use-save-notice";

const procMatch = (p: Proc) => p.path || p.name;

function ProcList({ query }: { query: string }) {
  const save = useSaveNotice();
  const procs = useStore(apps, (s) => s.procs);
  const rules = useStore(data, (s) => s.rules);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return procs
      .map((p) => ({ p, name: appDisplayName(p.path || p.name, procs), done: procHasRule(p, rules) }))
      .filter(({ p, name }) => !q || `${name} ${p.name} ${p.desc ?? ""} ${p.path}`.toLowerCase().includes(q))
      .sort((a, b) => Number(a.done) - Number(b.done)) // 还没加的排前面
      .map(({ p, name, done }) => {
        return {
          key: `${p.path}|${p.name}`,
          icon: <AppIcon path={p.path} />,
          title: name,
          detail: p.path || p.name,
          meta: `运行中 ${p.count} 个`,
          badge: done ? <StatusBadge tone="success">已添加</StatusBadge> : undefined,
          actions: done
            ? []
            : [
                {
                  key: "add",
                  label: "添加",
                  icon: <Plus />,
                  primary: true,
                  onSelect: () => save(addRule(procMatch(p), p.path)),
                },
              ],
        };
      });
  }, [procs, rules, query, save]);
  return (
    <div className="ps-picker-list">
      <ActionList
        label="运行中的进程"
        dense
        items={items}
        emptyLabel="没有匹配的进程。试试换个关键字，或在下方手动输入。"
      />
    </div>
  );
}

function ManualAdd() {
  const save = useSaveNotice();
  const [value, setValue] = useState("");
  const submit = () => {
    if (!value.trim()) return;
    save(addRule(value));
    setValue("");
  };
  return (
    <div className="ps-row">
      <Input
        id="picker-manual"
        aria-label="手动输入 exe 名或完整路径"
        boxClassName="ps-grow"
        value={value}
        placeholder="找不到？手动输入程序名（如 chrome.exe）或完整路径"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (!isComposingEvent(e) && e.key === "Enter") submit();
        }}
      />
      <Button variant="outline" disabled={!value.trim()} onClick={submit}>
        添加
      </Button>
    </div>
  );
}

export function AppPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { say } = useFeedback();
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (open) void refreshProcesses();
  }, [open]);

  const pick = async () => {
    setPicking(true);
    const n = await pickFiles().catch(() => 0);
    setPicking(false);
    if (n) say(`已添加 ${n} 个程序`);
  };

  return (
    <Dialog
      open={open}
      size="lg"
      title="添加应用"
      description="选择要分流的程序，添加后默认「智能分流」：国内直连、国外走当前节点，之后可在列表里改。"
      onClose={onClose}
      footer={
        <DialogFooter hint="「从文件夹选择」可以添加没在运行的程序，浏览到它的 .exe 即可。">
          <Button variant="outline" loading={picking} onClick={() => void pick()}>
            <FolderOpen />
            从文件夹选择…
          </Button>
          <Button onClick={onClose}>完成</Button>
        </DialogFooter>
      }
    >
      <div className="ps-picker">
        <SearchBox value={query} onChange={setQuery} placeholder="搜软件名，如 微信、Chrome…" label="搜索进程" />
        <ProcList query={query} />
        <ManualAdd />
      </div>
    </Dialog>
  );
}
