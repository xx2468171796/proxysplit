import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/**
 * 全站动效总闸 —— 对应 dongxiao 纪律里要「亲手传」的那个 `paused`。
 * 典型用法：A 层主役演出（开奖 / 揭晓）开始时 setPaused(true)，把其余装饰全部按停；结束再放开。
 * 离屏、切后台、减少动态效果由组件内建处理（autoPause），不走这里。
 */
interface MotionState {
  paused: boolean;
  setPaused: (next: boolean) => void;
}

const MotionContext = createContext<MotionState>({ paused: false, setPaused: () => undefined });

export function MotionProvider({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const value = useMemo(() => ({ paused, setPaused }), [paused]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion(): MotionState {
  return useContext(MotionContext);
}
