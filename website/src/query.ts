// 地址参数：评审包在沙箱 iframe 里改不了地址，参数由页面预先写进 window.__PS_QUERY（scripts/review-pages.mjs）。
declare global {
  interface Window {
    __PS_QUERY?: string;
  }
}

export function siteQuery(): URLSearchParams {
  return new URLSearchParams(window.__PS_QUERY ?? location.search);
}
