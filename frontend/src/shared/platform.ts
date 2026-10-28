// 运行平台（WebView 的 UA）：macOS 上程序是 .app，文案和选择方式不同。
export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
