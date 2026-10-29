import { describe, expect, it } from "vitest";
import { type DragState, dragOffset } from "./flow-drag";

const start = (): DragState => ({ id: "a", sx: 100, sy: 100, ox: 10, oy: 20, moved: false });

describe("dragOffset", () => {
  it("treats a tiny wobble as a click", () => {
    const d = start();
    expect(dragOffset(d, 102, 101, 1)).toBeNull();
    expect(d.moved).toBe(false);
  });
  it("adds the screen delta divided by the zoom to the starting offset", () => {
    const d = start();
    expect(dragOffset(d, 140, 80, 2)).toEqual({ dx: 30, dy: 10 });
    expect(d.moved).toBe(true);
  });
  it("keeps following small moves once dragging started", () => {
    const d = start();
    dragOffset(d, 120, 100, 1);
    expect(dragOffset(d, 101, 100, 1)).toEqual({ dx: 11, dy: 20 });
  });
});
