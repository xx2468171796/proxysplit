// 链路状态：当前节点、Google 延迟、实时 Ping（每秒），代理出口 IP（概览开着时每 10 秒）。标题栏和概览共用。

import { api } from "../api/backend";
import { EMPTY_LINK, type LinkStatus, linkApi } from "../api/link";
import type { ExitInfo } from "../api/types";
import { createStore } from "../shared/store";

type LinkState = { link: LinkStatus; exit: ExitInfo | null; exitAt: number };

export const linkState = createStore<LinkState>({ link: EMPTY_LINK, exit: null, exitAt: 0 });

export async function refreshLink(): Promise<void> {
  const link = await linkApi.status().catch(() => linkState.get().link);
  linkState.set({ link });
}

const EXIT_EVERY_MS = 10_000;

/** 出口 IP 查询要绕一圈外网，节流到 10 秒一次。 */
export async function refreshExit(): Promise<void> {
  if (Date.now() - linkState.get().exitAt < EXIT_EVERY_MS) return;
  linkState.set({ exitAt: Date.now() });
  const r = await api.exits().catch(() => null);
  if (r) linkState.set({ exit: r.running ? r.proxy : null });
}
