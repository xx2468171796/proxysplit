// 评审包的地址参数：页面审阅台用沙箱 iframe 加载单文件页，改不了地址，参数由页面预先写进 __PS_QUERY
export function previewSearch(): string {
  return (globalThis as { __PS_QUERY?: string }).__PS_QUERY ?? location.search;
}
