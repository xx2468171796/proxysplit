// 设置页通用件：一行开关（标签 + 说明）和「改了就存」的保存动作。设置立即生效，不用保存条。
import { FormField, Switch } from "@ankotti/admin-ui";
import { useCallback } from "react";
import type { Settings } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { saveSettings } from "../../state/data";

type SwitchFieldProps = {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
};

export function SwitchField({ id, label, hint, checked, disabled, onChange }: SwitchFieldProps) {
  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </FormField>
  );
}

/** 存一部分设置；Go 端返回的错误直接提示出来。 */
export function useSaveSettings() {
  const { say } = useFeedback();
  return useCallback(
    (patch: Partial<Settings>) => {
      void saveSettings(patch).then((err) => say(err, "error"));
    },
    [say],
  );
}
