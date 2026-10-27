// 预览用：节点内核切换（规则同 Go 端 nodes.Node.EffectiveCore / ValidateCore），只改选择和徽标。
type MockNode = {
  id: string;
  core?: string;
  coreInfo: { effective: string; xrayOnly: boolean; xraySupported: boolean };
};

export function mockSetNodeCore(nodes: MockNode[], id: unknown, core: unknown): string {
  const n = nodes.find((x) => x.id === id);
  if (!n) return "节点不存在";
  const want = core === "auto" ? "" : String(core);
  if (want === "xray" && !n.coreInfo.xraySupported) return "Xray 不支持该节点的协议或传输方式";
  if (want === "sing-box" && n.coreInfo.xrayOnly) return "该节点只能用 Xray 内核（XHTTP / mKCP / VLESS encryption）";
  n.core = want;
  n.coreInfo.effective = n.coreInfo.xrayOnly || want === "xray" ? "xray" : "sing-box";
  return "";
}
