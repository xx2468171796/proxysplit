// 把程序文件名 / 目录换成用户认得的名字：常见软件用内置中文名，其次用 exe 自带的文件说明，最后才是去掉 .exe 的文件名。
import type { Proc } from "../api/types";
import { baseName } from "./format";

const KNOWN: Record<string, string> = {
  "chrome.exe": "Chrome 浏览器",
  "msedge.exe": "Edge 浏览器",
  "firefox.exe": "Firefox 浏览器",
  "brave.exe": "Brave 浏览器",
  "opera.exe": "Opera 浏览器",
  "code.exe": "VS Code",
  "cursor.exe": "Cursor",
  "windsurf.exe": "Windsurf",
  "claude.exe": "Claude",
  "chatgpt.exe": "ChatGPT",
  "node.exe": "Node.js",
  "python.exe": "Python",
  "git.exe": "Git",
  "wechat.exe": "微信",
  "weixin.exe": "微信",
  "qq.exe": "QQ",
  "telegram.exe": "Telegram",
  "discord.exe": "Discord",
  "whatsapp.exe": "WhatsApp",
  "slack.exe": "Slack",
  "steam.exe": "Steam",
  "steamwebhelper.exe": "Steam",
  "epicgameslauncher.exe": "Epic 游戏平台",
  "spotify.exe": "Spotify",
  "ld9boxheadless.exe": "雷电模拟器",
  "vboxnetnat.exe": "雷电模拟器（网络）",
  "ldvboxheadless.exe": "雷电模拟器",
  "mumuvmmheadless.exe": "MuMu 模拟器",
  "nemuheadless.exe": "MuMu 模拟器",
  "hd-player.exe": "蓝叠模拟器",
  "hd-network.exe": "蓝叠模拟器（网络）",
  "noxvmhandle.exe": "夜神模拟器",
  "memuheadless.exe": "逍遥模拟器",
};

const DIRS: [RegExp, string][] = [
  [/ldplayer|雷电/i, "雷电模拟器"],
  [/mumu|nemu/i, "MuMu 模拟器"],
  [/bluestacks/i, "蓝叠模拟器"],
  [/^nox/i, "夜神模拟器"],
  [/memu|microvirt/i, "逍遥模拟器"],
];

/** 目录（整个目录的规则）→ 认得的名字，认不出就用目录名 */
export function dirDisplayName(dir: string): string {
  const name = baseName(dir.replace(/[\\/]+$/, ""));
  return DIRS.find(([re]) => re.test(name))?.[1] ?? name;
}

/** exe 名或完整路径 → 认得的名字 */
export function appDisplayName(exeOrPath: string, procs: Proc[] = []): string {
  const exe = baseName(exeOrPath).toLowerCase();
  if (KNOWN[exe]) return KNOWN[exe];
  const desc = procs.find((p) => baseName(p.path || p.name).toLowerCase() === exe)?.desc?.trim();
  if (desc && desc.length <= 40) return desc;
  return baseName(exeOrPath).replace(/\.exe$/i, "");
}
