// 程序原始图标（Go 从 exe 取出的 PNG）。规则只存了 exe 名时用运行中进程的真实路径去取；取不到显示占位块。
import { useEffect } from "react";
import type { AppRule } from "../api/types";
import { useStore } from "../shared/store";
import { apps, loadIcon, ruleIconPath } from "../state/app-rules";

export function AppIcon({ path }: { path: string }) {
  const uri = useStore(apps, (s) => s.icons[path]);
  useEffect(() => {
    if (path) void loadIcon(path);
  }, [path]);
  return uri ? (
    <img className="ps-app-icon" src={uri} alt="" />
  ) : (
    <span className="ps-app-icon" data-empty="" aria-hidden="true" />
  );
}

export function RuleIcon({ rule }: { rule: AppRule }) {
  const procs = useStore(apps, (s) => s.procs);
  return <AppIcon path={ruleIconPath(rule, procs)} />;
}
