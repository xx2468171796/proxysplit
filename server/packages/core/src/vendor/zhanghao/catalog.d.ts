/**
 * 能力清单 —— 机器可读，给 AI 用（包标准 §4）。
 * 想知道「这个包有什么 / 该 import 哪个 / 要什么前提 / 最容易静默失效在哪」读这个，别 grep 文档。
 * 加了能力必须登记一条，`test/catalog.test.ts` 逐条对账。纯数据、零运行时依赖。
 */
export interface Capability {
    /** 稳定 id，kebab-case */
    id: string;
    /** 中文名，一行 */
    title: string;
    /** 它解决什么，一句话 */
    summary: string;
    /** 从哪 import：包名或子路径 */
    entry: string;
    /** 入口符号 */
    main: readonly string[];
    /** 宿主要提供的前提 */
    needs?: readonly string[];
    /** 最容易静默失效的地方，接入方先查这些 */
    pitfalls?: readonly string[];
}
export declare const CAPABILITIES: readonly Capability[];