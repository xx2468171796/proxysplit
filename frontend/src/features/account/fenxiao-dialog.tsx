// 推广赚钱弹框（账号菜单进入）：邀请链接 + 收益概要 + 团队 / 佣金 / 提现记录 + 申请提现。
import {
  Button,
  CompactTable,
  CopyField,
  DescriptionList,
  Dialog,
  FormDialog,
  FormField,
  InlineAlert,
  Input,
  MetricCard,
  MetricGrid,
  NativeSelect,
  Note,
  StatePanel,
  Tabs,
} from "@ankotti/admin-ui";
import { RefreshCw, Wallet } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../../app/use-feedback";
import { fmtDateTime } from "../../shared/format";
import { useStore } from "../../shared/store";
import { type FenxiaoMe, fenxiao, loadFenxiao, pct, requestWithdrawal, yuan } from "../../state/fenxiao";

const LEVELS = ["一级", "二级", "三级", "四级", "五级", "六级", "七级", "八级", "九级", "十级"];
const C_STATUS: Record<string, string> = { frozen: "冻结中", available: "已到账", reversed: "已退款冲回" };
const W_STATUS: Record<string, string> = { pending: "待审核", paid: "已打款", rejected: "已驳回" };
const METHODS = [
  { value: "alipay", label: "支付宝" },
  { value: "wechat", label: "微信" },
  { value: "bank", label: "银行卡" },
];

type Row = { id: string; a: string; b: string; c: string; d: string };
type Fields = Parameters<typeof CompactTable<Row>>[0]["fields"];
const cols = (a: string, b: string, c: string, d: string): Fields => [
  { key: "a", title: a, type: "text", primary: true },
  { key: "b", title: b, type: "text" },
  { key: "c", title: c, type: "text" },
  { key: "d", title: d, type: "text" },
];

function ratesLine(me: FenxiaoMe): string {
  if (!me.rates.length) return "—";
  if (me.mode === "differential") return `总比例 ${pct(me.rates[0] ?? 0)}（级差）`;
  return me.rates
    .slice(0, me.maxLevels)
    .map((r, i) => `${LEVELS[i]}下级付款的 ${pct(r)}`)
    .join("，");
}

function Records() {
  const [tab, setTab] = useState("commissions");
  const s = useStore(fenxiao, (x) => x);
  const rows: Row[] =
    tab === "team"
      ? s.team.items.map((t, i) => ({
          id: `t${i}`,
          a: t.username,
          b: LEVELS[t.depth - 1] ?? `${t.depth}级`,
          c: t.boundAt ? fmtDateTime(t.boundAt) : "—",
          d: "",
        }))
      : tab === "withdrawals"
        ? s.withdrawals.items.map((w) => ({
            id: w.id,
            a: yuan(w.amountCents),
            b: `${METHODS.find((m) => m.value === w.payee.method)?.label ?? w.payee.method} ${w.payee.account}`,
            c: W_STATUS[w.status] ?? w.status,
            d: w.adminNote ?? fmtDateTime(w.createdAt),
          }))
        : s.commissions.items.map((c) => ({
            id: c.id,
            a: yuan(c.amountCents),
            b: `${c.buyer}（${LEVELS[c.level - 1] ?? c.level}）付 ${yuan(c.baseCents)} × ${pct(c.rateBps)}`,
            c: c.status === "frozen" ? `冻结到 ${fmtDateTime(c.availableAt)}` : (C_STATUS[c.status] ?? c.status),
            d: fmtDateTime(c.createdAt),
          }));
  const fields =
    tab === "team"
      ? cols("用户", "层级", "加入时间", "")
      : tab === "withdrawals"
        ? cols("金额", "收款", "状态", "备注 / 时间")
        : cols("佣金", "来自", "状态", "时间");
  return (
    <Tabs
      label="推广记录"
      value={tab}
      onValueChange={setTab}
      size="sm"
      items={[
        { value: "commissions", label: "佣金", count: s.commissions.total },
        { value: "team", label: "我的团队", count: s.team.total },
        { value: "withdrawals", label: "提现记录", count: s.withdrawals.total },
      ]}
    >
      <CompactTable<Row>
        caption="推广记录"
        rows={rows}
        getRowId={(r) => r.id}
        fields={tab === "team" ? fields.slice(0, 3) : fields}
        expandRecord={false}
        maxRows={20}
        emptyLabel={tab === "team" ? "还没有人通过你的链接注册" : "暂无记录"}
      />
    </Tabs>
  );
}

function WithdrawDialog({ me, onClose }: { me: FenxiaoMe; onClose: () => void }) {
  const { say } = useFeedback();
  const [amount, setAmount] = useState(String(Math.max(0, me.account.availableCents) / 100));
  const [method, setMethod] = useState("alipay");
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  return (
    <FormDialog
      open
      size="sm"
      title="申请提现"
      description={`可提现 ${yuan(me.account.availableCents)}，最低 ${yuan(me.minWithdrawalCents)}。提交后由客服人工打款，通常 1~3 个工作日。`}
      submitLabel="提交申请"
      dirty
      onClose={onClose}
      onSubmit={async () => {
        const cents = Math.round(Number(amount) * 100);
        if (!Number.isFinite(cents) || cents <= 0) throw new Error("请填写提现金额");
        const err = await requestWithdrawal(cents, method, account, name);
        if (err) throw new Error(err);
        say("提现申请已提交，打款后会在提现记录里显示");
        onClose();
      }}
    >
      <FormField label="金额（元）" htmlFor="ps-fx-amount">
        <Input id="ps-fx-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </FormField>
      <FormField label="收款方式" htmlFor="ps-fx-method">
        <NativeSelect id="ps-fx-method" value={method} options={METHODS} onChange={(e) => setMethod(e.target.value)} />
      </FormField>
      <FormField label={method === "bank" ? "卡号（含开户行）" : "收款账号"} htmlFor="ps-fx-account">
        <Input id="ps-fx-account" value={account} onChange={(e) => setAccount(e.target.value)} maxLength={100} />
      </FormField>
      <FormField label="真实姓名" htmlFor="ps-fx-name">
        <Input id="ps-fx-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
      </FormField>
    </FormDialog>
  );
}

function Body({ me }: { me: FenxiaoMe }) {
  const [withdraw, setWithdraw] = useState(false);
  const a = me.account;
  if (!me.enabled)
    return <StatePanel kind="empty" title="推广活动还没开放" message="开放后这里会显示你的专属邀请链接。" />;
  if (!me.eligible || !me.link)
    return <StatePanel kind="empty" title="你还没有推广资格" message="想成为分销商 / 经销商，请联系客服开通。" />;
  return (
    <div className="ps-plans">
      <CopyField label="我的邀请链接（别人打开后注册，就成为你的下级）" value={me.link} note={`邀请码 ${me.code}`} />
      <DescriptionList
        columns={2}
        items={[
          { label: "我的身份", value: me.tierName ?? "推广员" },
          { label: "佣金比例", value: ratesLine(me) },
          {
            label: "到账规则",
            value: me.freezeDays ? `付款后冻结 ${me.freezeDays} 天（退款观察期），之后可提现` : "付款后立即可提现",
          },
          { label: "我的上级", value: me.inviter ?? "—" },
        ]}
      />
      <MetricGrid>
        <MetricCard
          title="可提现"
          value={yuan(a.availableCents)}
          note={a.availableCents < 0 ? "退款冲回的欠款，后续佣金先抵" : undefined}
        />
        <MetricCard title="冻结中" value={yuan(a.frozenCents)} />
        <MetricCard title="提现中 / 已提现" value={`${yuan(a.withdrawingCents)} / ${yuan(a.withdrawnCents)}`} />
        <MetricCard
          title="团队"
          value={`${me.team.direct} / ${me.team.team} 人`}
          note={`直推 / 全部，带来 ${me.team.paidOrders} 笔付款`}
        />
      </MetricGrid>
      <div>
        <Button disabled={a.availableCents < me.minWithdrawalCents} onClick={() => setWithdraw(true)}>
          <Wallet />
          申请提现
        </Button>
        <Note>满 {yuan(me.minWithdrawalCents)} 可提现</Note>
      </div>
      <Records />
      {withdraw ? <WithdrawDialog me={me} onClose={() => setWithdraw(false)} /> : null}
    </div>
  );
}

export function FenxiaoDialog() {
  const s = useStore(fenxiao, (x) => x);
  if (!s.open) return null;
  return (
    <Dialog
      open
      size="xl"
      title="推广赚钱"
      description="把邀请链接发给朋友，他们注册后每次开通会员，你都能拿到佣金。"
      onClose={() => fenxiao.set({ open: false })}
      headerActions={
        <Button variant="ghost" size="sm" loading={s.loading} loadingText="加载中…" onClick={() => void loadFenxiao()}>
          <RefreshCw />
          刷新
        </Button>
      }
    >
      {s.error ? (
        <InlineAlert tone="error" title="推广数据读不到">
          {s.error}
        </InlineAlert>
      ) : null}
      {s.me ? <Body me={s.me} /> : s.loading ? <StatePanel kind="loading" title="正在读取…" /> : null}
    </Dialog>
  );
}
