// 开发预览：免费档 / 手机号 / 配置同步 / 云端配置的假后端（mock-backend 用）。
// 地址参数：?tier=free 免费用户（侧栏「会员」页、首次介绍弹框），?phone=0 老账号没绑手机号（登录后弹绑定框），
// ?sync=conflict 云同步冲突弹框，?profiles=full 云端配置份数已满，?intro=1 清掉「已看过会员介绍」标记。
import { previewSearch } from "./search";

type Fn = (...args: unknown[]) => unknown;

const params = new URLSearchParams(previewSearch());
const free = params.get("tier") === "free";
if (params.get("intro") === "1") localStorage.removeItem("member-intro-seen");
// 预览里没有真登录：?phone=0 直接弹绑定框。
if (params.get("phone") === "0") void import("../state/prompts").then((m) => m.prompts.set({ bindPhoneOpen: true }));

/** 合进假 license 的新字段 */
export const licenseExtras = {
  member: !free,
  tier: free ? "free" : "premium",
  plan: free ? "免费版" : "超级会员 · 年付",
  planCode: free ? "free" : "premium-year",
  maxDevices: free ? 1 : 9,
  freeDevices: 1,
  planDevices: free ? 0 : 8,
  phoneBound: params.get("phone") !== "0",
};

const preview = {
  device: "公司电脑",
  exportedAt: "2026-10-28T09:30:00Z",
  sections: ["nodes", "subscriptions", "rules", "proxyPorts", "settings"],
  nodes: 12,
  subscriptions: 2,
  rules: 18,
  lines: 3,
  proxyPorts: 1,
  hasSettings: true,
};

let syncEnabled = true;
let undo = false;
const conflict =
  params.get("sync") === "conflict"
    ? { cloudVersion: 7, cloudUpdatedAt: "2026-10-29T02:10:00Z", cloudDevice: "家里的笔记本" }
    : null;
const syncStatus = () => ({
  member: !free,
  enabled: syncEnabled,
  busy: false,
  lastSyncedAt: free ? "" : "2026-10-29T03:58:00Z",
  lastVersion: 6,
  localChanged: false,
  conflict,
  canUndo: undo,
  undoAt: undo ? new Date().toISOString() : "",
});

const profiles = [
  {
    id: "p1",
    name: "公司电脑",
    deviceName: "DESKTOP-WORK",
    size: 18432,
    updatedAt: "2026-10-28T09:30:00Z",
    shared: true,
    shareCode: "7KQ2MXRP",
    locked: false,
  },
  {
    id: "p2",
    name: "家里",
    deviceName: "XUAN-LAPTOP",
    size: 9216,
    updatedAt: "2026-10-26T13:00:00Z",
    shared: false,
    locked: true,
  },
];
const quota = params.get("profiles") === "full" ? 2 : 5;

export const mockSync: Record<string, Fn> = {
  SendSMSCode: () => ({ cooldownSeconds: 60 }),
  RegisterPhone: () => "",
  ResetPassword: () => "",
  BindPhone: () => "",
  RefreshAccountProfile: () => "",
  ExportConfig: () => "",
  ImportConfig: () => ({ preview }),
  ConfirmImport: () => {
    undo = true;
    return "";
  },
  CancelImport: () => undefined,
  UndoImport: () => {
    undo = false;
    return "";
  },
  GetSyncStatus: syncStatus,
  SyncNow: () => "",
  SetSyncEnabled: (on) => {
    syncEnabled = !!on;
    return "";
  },
  ResolveSyncConflict: () => "",
  GetConfigProfiles: () =>
    free
      ? { items: [], quota: 0, used: 0, err: "云端配置是会员功能，开通会员后就能用" }
      : { items: profiles, quota, used: profiles.length },
  SaveConfigProfile: () => "",
  OverwriteConfigProfile: () => "",
  RenameConfigProfile: () => "",
  DeleteConfigProfile: () => "",
  PreviewConfigProfile: (id) => ({ preview: { ...preview, name: profiles.find((p) => p.id === id)?.name ?? "" } }),
  SetConfigProfilePassword: () => "",
  ShareConfigProfile: () => ({ code: "M3XQ8KZT" }),
  UnshareConfigProfile: () => "",
  PreviewSharedConfig: () => ({ preview: { ...preview, name: "朋友的配置", device: "朋友的电脑" } }),
};
