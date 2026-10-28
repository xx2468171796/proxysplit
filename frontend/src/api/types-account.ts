// 账号授权与配置同步的类型（与 Go license.Status / configsync / app_configsync.go 对应）。

export type LicenseStatus = {
  enabled: boolean;
  signedIn: boolean;
  authenticated: boolean;
  deviceLimitReached: boolean;
  username: string;
  plan: string;
  planCode: string;
  tier: string;
  maxDevices: number;
  features: string[];
  expiresAt: string;
  offlineUntil: string;
  /** 付费会员（tier 不是 free）；免费用户功能齐全，只是 1 台设备、没有云同步 */
  member?: boolean;
  /** 免费名额（后台「免费设备数」） */
  freeDevices?: number;
  /** 套餐叠加的设备数 */
  planDevices?: number;
  /** 老账号没绑手机号时为 false：每次登录后提示绑定 */
  phoneBound?: boolean;
  channel?: string;
  error?: string;
};

/** 配置包的五个部分（勾选只恢复其中几项） */
export type ConfigSection = "nodes" | "subscriptions" | "rules" | "proxyPorts" | "settings";

export type ConfigPreview = {
  name?: string;
  device: string;
  exportedAt: string;
  sections: ConfigSection[];
  nodes: number;
  subscriptions: number;
  rules: number;
  lines: number;
  proxyPorts: number;
  hasSettings: boolean;
};

export type ImportPreview = { preview?: ConfigPreview; canceled?: boolean; err?: string };

export type SyncConflict = { cloudVersion: number; cloudUpdatedAt: string; cloudDevice: string };

export type SyncStatus = {
  member: boolean;
  enabled: boolean;
  busy: boolean;
  lastSyncedAt: string;
  lastVersion: number;
  localChanged: boolean;
  error?: string;
  conflict?: SyncConflict | null;
  canUndo: boolean;
  undoAt?: string;
};

export type ConfigProfile = {
  id: string;
  name: string;
  deviceName: string;
  size: number;
  updatedAt: string;
  shared: boolean;
  shareCode?: string;
  /** 设了恢复密码 */
  locked: boolean;
};

export type ProfilesResult = { items: ConfigProfile[]; quota: number; used: number; err?: string };

export type SmsPurpose = "register" | "reset" | "bind";
