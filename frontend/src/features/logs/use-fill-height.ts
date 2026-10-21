// 列表区跟着窗口高度走：窗口高度减去上方外壳 / 标签 / 工具行占的高度，最低 280。
import { useEffect, useState } from "react";

export function useFillHeight(offset: number): number {
  const calc = () => Math.max(280, window.innerHeight - offset);
  const [height, setHeight] = useState(calc);
  useEffect(() => {
    const onResize = () => setHeight(Math.max(280, window.innerHeight - offset));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [offset]);
  return height;
}
