/**
 * 存量昵称清理:已经不符合昵称规范(`zhanghao/nickname`)的昵称,改成用户名并给玩家发一条站内信。
 *
 * 业主 2026-10-01:「已经不符合规范的,就把它的昵称改成用户名,然后发送个通知」。
 * 包只管**挑谁、改成什么、通知怎么写、先后顺序**;读用户、写昵称、发通知全部由宿主注入
 * (各站昵称列名 / 机器人判法 / 通知包接法都不一样)。宿主用自己的定时任务(dingshi)每天跑一次:
 * 词表加词发版后,下一拍自动处理新命中的存量,不用另写脚本。
 *
 * 几条写错了不报错的地方:
 *   1. **先通知、后改名**,通知带幂等键(用户 + 旧昵称)。反过来的话,改名成功而通知失败,
 *      下一拍已经扫不到这个人 → 玩家莫名其妙被改名、永远收不到解释。现在的顺序:通知成功改名失败
 *      → 下一拍再来,同一个幂等键不会发第二条。
 *   2. `rename` 必须是**条件更新**(`WHERE id=? AND nickname=<旧值>`):扫描到写入之间玩家自己改过就别覆盖。
 *   3. 用户名形如邮箱(含 @)不拿来当昵称:那等于把邮箱公示给全站;用户名是手机号的用打码形式(138****0000)。
 *   另:1.11.0 起昵称里含完整手机号(多是注册时默认昵称 = 手机号用户名)也清理:改成打码形式,**默认不发通知**
 *      (那不是玩家违规,是站点替他泄露了号码;发几百条「昵称已被重置」只会吓到人)。`notifyPhoneMask: true` 可开。
 *   4. 昵称在站内要求唯一时(多数站),替代名也要避开已占用的;占用判定与宿主判重同一口径(NFKC + 小写)。
 */
import { type NicknameRule } from "./nickname.ts";
export interface NicknameSweepUser {
    userId: string;
    username: string | null;
    nickname: string | null;
    /** 机器人只改名不发通知 */
    isBot?: boolean;
}
export interface NicknameResetNotice {
    title: string;
    body: string;
    /** 幂等键:同一用户同一旧昵称只发一次 */
    idemKey: string;
    /** 建议的跳转(宿主可忽略) */
    link: string | null;
}
export interface NicknameSweepOptions {
    /** 与 createZhanghao({ config: { nickname } }) **同一个常量** */
    rule?: NicknameRule;
    /** 全站用户(含已合规的:用来算已占用的昵称)。千级用户一次读完即可 */
    listUsers: () => Promise<readonly NicknameSweepUser[]>;
    /** 条件更新 `nickname=next WHERE id=user.userId AND nickname=previous`,返回是否真的改了 */
    rename: (user: NicknameSweepUser, next: string, previous: string) => Promise<boolean>;
    /** 发站内信(宿主接 tongzhi,把 idemKey 传给它)。不传 = 只改名不通知 */
    notify?: (user: NicknameSweepUser, notice: NicknameResetNotice) => Promise<unknown>;
    /** 站内昵称是否要求唯一(默认 true):替代名会避开已占用的 */
    unique?: boolean;
    /** 替代名候选,按顺序取第一个合规且未占用的。默认:用户名(含 @ 的跳过)→ 玩家{id} → 玩家{id}_2 … */
    candidates?: (user: NicknameSweepUser) => readonly string[];
    /** 通知文案覆盖 */
    notice?: (user: NicknameSweepUser, previous: string, next: string) => Omit<NicknameResetNotice, "idemKey">;
    /** 昵称里的手机号被打码时也发通知(默认 false) */
    notifyPhoneMask?: boolean;
    /** 单个用户处理失败时回调(默认 console.warn),不中断整批 */
    onError?: (user: NicknameSweepUser, error: unknown) => void;
}
export interface NicknameSweepResult {
    scanned: number;
    /** 命中规范的人数(含手机号) */
    offending: number;
    /** 其中只因昵称含手机号、改成打码形式的人数 */
    masked: number;
    renamed: number;
    failed: number;
    /** 本拍改了谁(审计 / 汇报用) */
    changes: {
        userId: string;
        previous: string;
        next: string;
    }[];
}
/** 判重口径:与各站 nicknameKey 一致(NFKC + 去首尾空白 + 小写) */
export declare function nicknameKey(value: unknown): string;
export declare function defaultNicknameCandidates(user: NicknameSweepUser): string[];
/** 给违规昵称挑替代名;taken = 已占用的 nicknameKey 集合(unique=false 时传空集合) */
export declare function pickReplacementNickname(user: NicknameSweepUser, taken: ReadonlySet<string>, opts?: Pick<NicknameSweepOptions, "rule" | "candidates">): string | null;
export declare function nicknameResetNotice(user: NicknameSweepUser, previous: string, next: string): NicknameResetNotice;
export declare function sweepOffensiveNicknames(opts: NicknameSweepOptions): Promise<NicknameSweepResult>;