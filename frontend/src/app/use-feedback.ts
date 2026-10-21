// 把动作返回的一句话变成提示：空串不提示；含「失败 / 错误 / 不通」等按出错提示，其余按成功。
import { useNotify } from "@ankotti/admin-ui";
import { useCallback } from "react";

const ERROR_WORDS = /失败|错误|无法|不通|过期|请先|请填写|请输入|超时|拒绝/;

export function toneOf(text: string): "success" | "error" {
  return ERROR_WORDS.test(text) ? "error" : "success";
}

/** 返回 say(text) 和 run(动作)：run 等动作结束后把它返回的文字提示出来。 */
export function useFeedback() {
  const notify = useNotify();
  const say = useCallback(
    (text: string | undefined, tone?: "success" | "error" | "info") => {
      if (text) notify(text, tone ?? toneOf(text));
    },
    [notify],
  );
  const run = useCallback(
    async (action: () => Promise<string | undefined>, okText?: string) => {
      const text = await action();
      say(text || okText);
    },
    [say],
  );
  return { say, run };
}
