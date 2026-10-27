// 监测详情的数据：打开期间每 2 秒取一次该应用（程序名或整个目录）的统计、网站汇总、访问日志和相关内核错误；暂停时停在当前画面。
import { useEffect, useState } from "react";
import type { AppDetail } from "../../api/types";
import { fetchAppDetail } from "../../state/app-monitor";

const POLL_MS = 2000;

export function useAppDetail(process: string, paused = false): AppDetail | null {
  const [detail, setDetail] = useState<AppDetail | null>(null);
  useEffect(() => {
    if (paused) return;
    let alive = true;
    const load = async () => {
      try {
        const d = await fetchAppDetail(process);
        if (alive) setDetail(d);
      } catch {
        /* 后端忙：保留上一次，下个 2 秒再取 */
      }
    };
    void load();
    // admin-ui-audit-ignore short-poll: 桌面客户端读本机 Go 后端（Wails 绑定）的运行状态，不是服务器业务数据，没有推送通道
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [process, paused]);
  return detail;
}
