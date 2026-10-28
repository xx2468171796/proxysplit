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
