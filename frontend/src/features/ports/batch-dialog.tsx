// 批量新建：同一套设置，从起始端口开始连续建 N 个，名称「前缀1 … 前缀N」。
import { FormDialog, FormField, Input, Note, NumberInput } from "@ankotti/admin-ui";
import { useState } from "react";
import type { ProxyPort } from "../../api/types";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { createPorts, ports } from "../../state/ports";
import { BATCH_MAX, batchDrafts, emptyPort, PORT_MAX, PORT_MIN, validateBatch } from "./port-draft";
import { PortSettingsFields, type SharedSettings } from "./port-fields";

export function BatchDialog({ onClose }: { onClose: () => void }) {
  const { say } = useFeedback();
  const list = useStore(ports, (s) => s.list);
  const [base, setBase] = useState<ProxyPort>(() => emptyPort(list));
  const [prefix, setPrefix] = useState("浏览器");
  const [start, setStart] = useState<number | null>(() => emptyPort(list).port);
  const [count, setCount] = useState<number | null>(5);
  const plan = { prefix, start: start ?? 0, count: count ?? 0 };
  const used = list.map((p) => p.port);
  const problem = validateBatch(plan, used);
  const set = (p: Partial<SharedSettings>) => setBase((b) => ({ ...b, ...p }));

  const submit = async () => {
    if (problem) throw new Error(problem);
    const { created, err } = await createPorts(batchDrafts(base, plan));
    if (!err) return say(`已创建 ${created} 个端口`);
    if (!created) throw new Error(err);
    say(`已创建 ${created} 个，其余未建：${err}`, "error");
  };

  return (
    <FormDialog
      open
      size="lg"
      title="批量新建端口"
      description="一次建多个设置相同的端口，给多个指纹浏览器分别用。建好后会自动启动。"
      submitLabel={count ? `创建 ${count} 个端口` : "创建"}
      dirty
      onClose={onClose}
      onSubmit={submit}
    >
      <FormField label="名称前缀" htmlFor="batch-prefix">
        <Input id="batch-prefix" value={prefix} placeholder="浏览器" onChange={(e) => setPrefix(e.target.value)} />
      </FormField>
      <FormField label="数量" htmlFor="batch-count" hint={`最多 ${BATCH_MAX} 个`}>
        <NumberInput id="batch-count" value={count} min={1} max={BATCH_MAX} onChange={setCount} />
      </FormField>
      <FormField label="起始端口" htmlFor="batch-start" hint="之后每个端口加 1">
        <NumberInput id="batch-start" value={start} min={PORT_MIN} max={PORT_MAX} onChange={setStart} />
      </FormField>
      <div className="ps-port-full">
        <Note as="p">
          {problem ? (
            problem
          ) : (
            <>
              将创建 <b>{`${prefix.trim() || "浏览器"}1`}</b> – <b>{`${prefix.trim() || "浏览器"}${plan.count}`}</b>
              ，端口 <b>{`${plan.start} – ${plan.start + plan.count - 1}`}</b>。
            </>
          )}
        </Note>
      </div>
      <PortSettingsFields idBase="batch" draft={base} set={set} />
    </FormDialog>
  );
}
