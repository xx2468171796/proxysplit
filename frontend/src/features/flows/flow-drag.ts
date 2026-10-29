// 连接图里拖动过的卡片位置：按节点 id 记偏移（相对自动排版），存在本机，下次打开还在原处。
import { createContext } from "react";

export type Offset = { dx: number; dy: number };
export type Offsets = Record<string, Offset>;

const KEY = "ps-flow-offsets";
const MAX = 300; // 网站节点会不断变化，只留最近拖过的这么多个

/** 画布当前缩放：拖卡片时把屏幕位移换算成图上的位移。 */
export const ViewScale = createContext(1);

export function loadOffsets(): Offsets {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Offsets) : {};
  } catch {
    return {};
  }
}

export function saveOffsets(o: Offsets) {
  const keys = Object.keys(o);
  const kept = keys.length > MAX ? Object.fromEntries(keys.slice(-MAX).map((k) => [k, o[k]])) : o;
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* 存不下就只在本次有效 */
  }
}

/** 一次拖动：按下的位置、起始偏移、是否已经动过（动过就不算点击）。 */
export type DragState = { id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean };

/** 屏幕上移动不到 4 像素算点击，不算拖动。 */
export function dragOffset(d: DragState, x: number, y: number, k: number): Offset | null {
  if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 4) return null;
  d.moved = true;
  return { dx: d.ox + (x - d.sx) / k, dy: d.oy + (y - d.sy) / k };
}
