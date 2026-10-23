// 推广赚钱（多级分销）：我的邀请链接、收益、团队、佣金、提现。数据都来自服务端 /v1/fenxiao/*（别人的用户名服务端已打码）。
import { api } from "../api/backend";
import { createStore } from "../shared/store";

export type FenxiaoMe = {
  enabled: boolean;
  eligible: boolean;
  code: string | null;
  link: string | null;
  tierName: string | null;
  rates: number[];
  mode: "level" | "differential";
  maxLevels: number;
  freezeDays: number;
  minWithdrawalCents: number;
  inviter: string | null;
  account: {
    frozenCents: number;
    availableCents: number;
    withdrawingCents: number;
    withdrawnCents: number;
    earnedCents: number;
    reversedCents: number;
  };
  team: { direct: number; team: number; paidOrders: number; commissionCents: number };
};
export type FxTeamRow = { username: string; depth: number; boundAt: string | null };
export type FxCommissionRow = {
  id: string;
  level: number;
  baseCents: number;
  rateBps: number;
  amountCents: number;
  status: string;
  availableAt: string;
  createdAt: string;
  buyer: string;
};
export type FxWithdrawalRow = {
  id: string;
  amountCents: number;
  status: string;
  payee: { method: string; account: string; name: string };
  adminNote: string | null;
  createdAt: string;
};
type Page<T> = { items: T[]; total: number };

type State = {
  open: boolean;
  loading: boolean;
  error: string;
  me: FenxiaoMe | null;
  team: Page<FxTeamRow>;
  commissions: Page<FxCommissionRow>;
  withdrawals: Page<FxWithdrawalRow>;
};
const EMPTY = { items: [], total: 0 };
export const fenxiao = createStore<State>({
  open: false,
  loading: false,
  error: "",
  me: null,
  team: EMPTY,
  commissions: EMPTY,
  withdrawals: EMPTY,
});

async function read<T>(kind: "me" | "team" | "commissions" | "withdrawals"): Promise<T> {
  const r = await api.fenxiao(kind);
  if (r.err) throw new Error(r.err);
  return r.data as T;
}

export async function loadFenxiao(): Promise<void> {
  fenxiao.set({ loading: true, error: "" });
  try {
    const [me, team, commissions, withdrawals] = await Promise.all([
      read<FenxiaoMe>("me"),
      read<Page<FxTeamRow>>("team"),
      read<Page<FxCommissionRow>>("commissions"),
      read<Page<FxWithdrawalRow>>("withdrawals"),
    ]);
    fenxiao.set({ me, team, commissions, withdrawals });
  } catch (e) {
    fenxiao.set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    fenxiao.set({ loading: false });
  }
}

export function openFenxiao(): void {
  fenxiao.set({ open: true });
  void loadFenxiao();
}

/** 申请提现；返回空串 = 成功（成功后刷新数据）。 */
export async function requestWithdrawal(
  amountCents: number,
  method: string,
  account: string,
  name: string,
): Promise<string> {
  const r = await api.fenxiaoWithdraw(amountCents, method, account, name);
  if (r.err) return r.err;
  await loadFenxiao();
  return "";
}

export const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
export const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
