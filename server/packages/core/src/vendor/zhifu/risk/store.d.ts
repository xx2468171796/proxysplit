import type { RiskOverride, EmergencyState } from "./resolve.ts";
/**
 * 存储接口（只定义形状，实现由消费方给：zhifu-service 用 PostgreSQL 表 + 进程内缓存 + 写后失效）。
 * 写入必须带操作人和原因，由实现写审计；紧急状态打开期间实现应拒绝改覆盖，保证恢复后逐格一致。
 */
export interface RiskSnapshot {
    overrides: readonly RiskOverride[];
    emergency: EmergencyState;
    /** 每次写 +1，缓存按它判断新旧 */
    version: number;
}
export interface RiskActor {
    id: string;
    name: string;
}
export interface RiskStore {
    load(): Promise<RiskSnapshot>;
    /** enabled / params 都为 null = 删掉这层覆盖（回到继承） */
    setOverride(o: RiskOverride, actor: RiskActor, reason: string): Promise<void>;
    setEmergency(active: boolean, actor: RiskActor, reason: string): Promise<void>;
    invalidate(): void;
}