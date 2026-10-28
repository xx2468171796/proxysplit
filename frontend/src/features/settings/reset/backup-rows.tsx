// 配置备份：正式位置在设置「配置与同步」（导出 / 导入 / 撤销 / 云同步），这里只放跳转。
import { FormSection } from "@ankotti/admin-ui";
import { openSettings } from "../../../app/nav";
import { LinkRow } from "../link-row";

export function BackupRows() {
  return (
    <FormSection title="备份" description="换电脑时先导出，到新电脑上导入" layout="side">
      <LinkRow
        id="cfg-backup-link"
        label="配置备份"
        hint="导出、导入、撤销导入和会员云同步都在「配置与同步」"
        actions={[{ label: "去配置与同步", onClick: () => openSettings("sync") }]}
      />
    </FormSection>
  );
}
