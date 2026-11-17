// 链路状态的假后端（浏览器预览用）。
export const mockLink = (conns: number) => ({
  GetLinkStatus: () => ({
    running: true,
    nodeName: "香港 · HK01",
    nodeType: "vless",
    googleMs: 182,
    pingMs: 46,
    pingP50: 48,
    conns,
  }),
});

/** 运行阶段预览：?run=recovering 内核自动重启中；?run=failed 代理自己停了（带原因）；其它 = 正常运行。 */
export function mockRunPhase(run: string | null) {
  if (run !== "recovering" && run !== "failed") return { runState: "running", captureState: "ok" };
  const failed = run === "failed";
  return {
    coreRunning: false,
    engineRunning: false,
    uptimeSec: 0,
    stats: undefined,
    runState: failed ? "stopped" : "recovering",
    stopReason: failed ? "内核意外退出，自动重启没有成功，已停止代理（选中的程序现在是直连）：端口被占用" : "",
  };
}
