// 规则改动即保存：同一个 key 的提示原地替换，连续拨开关也只占一条。
import { useNotify } from "@ankotti/admin-ui";
import { useCallback } from "react";
import { useStore } from "../../shared/store";
import { isRunning, runtime } from "../../state/runtime";

export function useSaveNotice() {
  const notify = useNotify();
  const running = useStore(runtime, (s) => isRunning(s.status));
  return useCallback(
    (pending: Promise<string>) => {
      void pending.then((err) => {
        notify.show({
          key: "apps-save",
          title: err ? `保存失败：${err}` : running ? "已保存，已实时生效" : "已自动保存",
          tone: err ? "error" : "success",
          duration: err ? null : 1800,
        });
      });
    },
    [notify, running],
  );
}
