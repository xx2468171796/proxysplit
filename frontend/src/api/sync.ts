// 后端适配层（续）：手机号账号、配置导出导入、会员云同步、云端配置与分享码（Go: app_phone.go / app_configsync.go）。
// 写操作沿用约定：返回空串 = 成功，非空 = 给用户看的错误信息。
import * as W from "../../wailsjs/go/main/App.js";
import type {
  ConfigProfile,
  ConfigSection,
  ImportPreview,
  ProfilesResult,
  SmsPurpose,
  SyncStatus,
} from "./types-account";

const asPreview = (r: unknown): ImportPreview => (r ?? {}) as ImportPreview;

export const syncApi = {
  // 手机号
  sendSmsCode: (phone: string, purpose: SmsPurpose) => W.SendSMSCode(phone, purpose),
  registerPhone: (phone: string, code: string, user: string, pass: string, ref: string) =>
    W.RegisterPhone(phone, code, user, pass, ref),
  resetPassword: (phone: string, code: string, pass: string) => W.ResetPassword(phone, code, pass),
  bindPhone: (phone: string, code: string) => W.BindPhone(phone, code),
  refreshAccountProfile: () => W.RefreshAccountProfile(),

  // 本地导出 / 导入（预览 → 确认，确认前自动备份，可撤销一次）
  exportConfig: () => W.ExportConfig(),
  importConfig: async () => asPreview(await W.ImportConfig()),
  confirmImport: (sections: ConfigSection[]) => W.ConfirmImport(sections),
  cancelImport: () => W.CancelImport(),
  undoImport: () => W.UndoImport(),

  // 云同步（会员）
  syncStatus: () => W.GetSyncStatus() as Promise<SyncStatus>,
  syncNow: () => W.SyncNow(),
  setSyncEnabled: (on: boolean) => W.SetSyncEnabled(on),
  resolveSyncConflict: (choice: "cloud" | "local") => W.ResolveSyncConflict(choice),

  // 我的云端配置
  profiles: async (): Promise<ProfilesResult> => {
    const r = (await W.GetConfigProfiles()) as Partial<ProfilesResult> | null;
    return {
      items: (r?.items ?? []) as ConfigProfile[],
      quota: r?.quota ?? 0,
      used: r?.used ?? 0,
      err: r?.err || undefined,
    };
  },
  saveProfile: (name: string) => W.SaveConfigProfile(name),
  overwriteProfile: (id: string) => W.OverwriteConfigProfile(id),
  renameProfile: (id: string, name: string) => W.RenameConfigProfile(id, name),
  deleteProfile: (id: string) => W.DeleteConfigProfile(id),
  previewProfile: async (id: string, password: string) => asPreview(await W.PreviewConfigProfile(id, password)),
  setProfilePassword: (id: string, next: string, current: string) => W.SetConfigProfilePassword(id, next, current),
  shareProfile: (id: string, password: string) =>
    W.ShareConfigProfile(id, password) as Promise<{ code: string; err?: string }>,
  unshareProfile: (id: string) => W.UnshareConfigProfile(id),
  previewShared: async (code: string, password: string) => asPreview(await W.PreviewSharedConfig(code, password)),
};
