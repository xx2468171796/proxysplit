// 节点页页头按钮：检测全部可用性、测速全部（先测通）、测活动节点速度、添加订阅、添加节点。
import { Button } from "@ankotti/admin-ui";
import { Gauge, Plus, Rss, Stethoscope, Zap } from "lucide-react";
import { navigate } from "../../app/nav";
import { useFeedback } from "../../app/use-feedback";
import { useStore } from "../../shared/store";
import { nodeTests, testActiveSpeed, testAllLatency, testThenSpeedAll } from "../../state/nodes";

export function NodeActions({ onAdd }: { onAdd: () => void }) {
  const { say } = useFeedback();
  const allLatency = useStore(nodeTests, (s) => s.allLatency);
  const speedAll = useStore(nodeTests, (s) => s.speedAll);
  const activeSpeed = useStore(nodeTests, (s) => s.activeSpeed);
  return (
    <>
      <Button
        variant="outline"
        loading={allLatency && !speedAll}
        disabled={speedAll}
        loadingText="Google 检测中…"
        onClick={() => void testAllLatency().then(say)}
      >
        <Stethoscope />
        检测全部可用性
      </Button>
      <Button
        variant="outline"
        loading={speedAll}
        disabled={allLatency && !speedAll}
        loadingText="测通后逐个测速中…"
        onClick={() => void testThenSpeedAll().then(say)}
      >
        <Zap />
        测速全部（先测通）
      </Button>
      <Button
        variant="outline"
        loading={activeSpeed}
        loadingText="下载测速中…"
        onClick={() => void testActiveSpeed().then(say)}
      >
        <Gauge />
        测活动节点速度
      </Button>
      <Button variant="outline" onClick={() => navigate("nodes", "add-sub", "subs")}>
        <Rss />
        添加订阅
      </Button>
      <Button onClick={onAdd}>
        <Plus />
        添加节点
      </Button>
    </>
  );
}
