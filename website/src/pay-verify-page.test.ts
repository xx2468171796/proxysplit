// 正式环境的验证中继页只能把凭证发给客户端窗口，不能发给任何开发地址（本机任何占了那个端口的程序都能收到）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../public/pay-verify.html", import.meta.url), "utf8");
const list = /var PARENTS = \[([^\]]*)\]/.exec(html)?.[1] ?? "";
const parents = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test("凭证只发给 Wails 客户端窗口的 origin", () => {
  assert.deepEqual(parents, ["http://wails.localhost", "https://wails.localhost", "wails://wails"]);
});

test("整页不出现本机开发地址，也不用通配 origin", () => {
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ""), /localhost:\d+|127\.0\.0\.1/);
  assert.doesNotMatch(html, /postMessage\([^)]*["']\*["']/);
});
