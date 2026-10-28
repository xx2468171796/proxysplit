// 设置「配置与同步」：本地导出 / 导入 / 撤销（所有人）→ 云同步开关与状态（会员）→ 我的云端配置（会员）→ 导入别人分享的配置（已登录）。
import { Button, FormField, FormSection, InlineAlert, Note, Panel, Switch } from "@ankotti/admin-ui";
import { Download, KeyRound, RefreshCw, Undo2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../../app/nav";
import { useFeedback } from "../../../app/use-feedback";
import { fmtDateTime } from "../../../shared/format";
import { useStore } from "../../../shared/store";
import { isPaidMember, license } from "../../../state/account";
import {
  configSync,
  exportConfig,
  loadSyncStatus,
  pickImportFile,
  setSyncEnabled,
  syncNow,
  undoImport,
} from "../../../state/configsync";
import { ProfilesPanel } from "./profiles-panel";
import { ShareImportDialog } from "./share-import-dialog";
import "./sync.css";

function useBusy(): [string, (key: string, action: () => Promise<string>) => Promise<void>] {
  const { say } = useFeedback();
  const [busy, setBusy] = useState("");
  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    try {
      say(await action());
    } finally {
      setBusy("");
    }
  };
  return [busy, run];
}

function LocalBackup() {
  const [busy, run] = useBusy();
  const status = useStore(configSync, (s) => s.status);
  return (
    <FormSection title="本地备份" description="所有人可用：换电脑时先导出，到新电脑上导入" layout="side">
      <FormField
        label="配置文件"
        htmlFor="sync-export"
        hint="节点、订阅、规则、端口代理、软件设置（不含账号和 POWER云 官方线路）"
      >
        <div className="ps-set-actions">
          <Button
            id="sync-export"
            size="sm"
            variant="outline"
            loading={busy === "export"}
            onClick={() => void run("export", exportConfig)}
          >
            <Download />
            导出配置
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={busy === "import"}
            onClick={() => void run("import", pickImportFile)}
          >
            <Upload />
            导入配置
          </Button>
        </div>
      </FormField>
      {status?.canUndo ? (
        <FormField
          label="撤销导入"
          htmlFor="sync-undo"
          hint={`导入前的配置已备份（${status.undoAt ? fmtDateTime(status.undoAt) : "最近一次"}），只能撤销一次`}
        >
          <Button
            id="sync-undo"
            size="sm"
            variant="outline"
            loading={busy === "undo"}
            onClick={() => void run("undo", undoImport)}
          >
            <Undo2 />
            撤销上次导入
          </Button>
        </FormField>
      ) : null}
    </FormSection>
  );
}

function syncLine(lastSyncedAt: string | undefined, busy: boolean, changed: boolean): string {
  if (busy) return "正在同步…";
  const last = lastSyncedAt ? `上次同步 ${fmtDateTime(lastSyncedAt)}` : "还没同步过";
  return changed ? `${last} · 本机有改动，稍后自动上传` : last;
}

function CloudSync() {
  const [busy, run] = useBusy();
  const status = useStore(configSync, (s) => s.status);
  const member = useStore(license, (s) => isPaidMember(s.status));
  if (!member)
    return (
      <FormSection title="云同步" description="会员专属" layout="side">
        <InlineAlert
          tone="info"
          title="开通会员后，配置自动跟着账号走"
          action={
            <Button size="sm" variant="outline" onClick={() => navigate("member")}>
              看看会员
            </Button>
          }
        >
          在一台电脑上改了节点或规则，其他电脑登录同一账号会自动拿到；还能在云端保存多份配置、分享给朋友。
        </InlineAlert>
      </FormSection>
    );
  return (
    <FormSection title="云同步" description="登录后自动同步；本机改动停 10 秒后上传" layout="side">
      <FormField
        label="自动同步"
        htmlFor="sync-auto"
        hint={syncLine(status?.lastSyncedAt, !!status?.busy, !!status?.localChanged)}
      >
        <Switch
          id="sync-auto"
          checked={status?.enabled ?? true}
          onCheckedChange={(on) => void run("toggle", () => setSyncEnabled(on))}
        />
      </FormField>
      <FormField label="手动同步" htmlFor="sync-now" hint="马上和云端对一次；两边都改过会问你用哪份">
        <Button
          id="sync-now"
          size="sm"
          variant="outline"
          loading={busy === "now" || !!status?.busy}
          onClick={() => void run("now", syncNow)}
        >
          <RefreshCw />
          立即同步
        </Button>
      </FormField>
      {status?.error ? <Note tone="danger">{status.error}</Note> : null}
    </FormSection>
  );
}

export function SyncSection() {
  const signedIn = useStore(license, (s) => s.status.enabled && s.status.signedIn);
  const member = useStore(license, (s) => isPaidMember(s.status));
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => void loadSyncStatus(), []);
  return (
    <Panel className="qd-pane" title="配置与同步" description="备份、换电脑、多台电脑共用一份配置都在这里。">
      <div className="ps-sync-block">
        <LocalBackup />
        {signedIn ? <CloudSync /> : null}
        {signedIn && member ? <ProfilesPanel /> : null}
        {signedIn ? (
          <FormSection title="导入别人分享的配置" description="朋友给你分享码和密码就能导入，不需要会员" layout="side">
            <FormField label="分享码" htmlFor="sync-share-import" hint="导入前会预览内容，并自动备份你现在的配置">
              <Button id="sync-share-import" size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                <KeyRound />
                输入分享码
              </Button>
            </FormField>
          </FormSection>
        ) : null}
      </div>
      {shareOpen ? <ShareImportDialog onClose={() => setShareOpen(false)} /> : null}
    </Panel>
  );
}
