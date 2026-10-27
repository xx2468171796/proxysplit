// 客户端日志上报的每 IP 流量预算：每个时间窗内解压后的字节数封顶（防止有人拿任意设备号灌库）。
// 配了 Redis 就用 Redis（多进程共享，INCRBY + PEXPIRE），否则 / Redis 出错时退回进程内计数。

export type BudgetRedis = {
  incrby: (key: string, n: number) => Promise<number>
  pexpire: (key: string, ms: number) => Promise<number>
}

export class IpByteBudget {
  private window = 0
  private used = new Map<string, number>()
  constructor(
    private readonly maxBytes: number,
    private readonly windowMs = 10 * 60_000,
    private readonly redis?: BudgetRedis,
    private readonly cap = 50_000,
    private readonly now = () => Date.now(),
  ) {}

  /** 记上 bytes，返回记完后是否仍在预算内。 */
  async charge(ip: string, bytes: number): Promise<boolean> {
    const w = Math.floor(this.now() / this.windowMs)
    if (this.redis) {
      const key = `proxysplit:telemetry:ipbytes:${w}:${ip}`
      try {
        const total = await this.redis.incrby(key, bytes)
        if (total === bytes) await this.redis.pexpire(key, this.windowMs)
        return total <= this.maxBytes
      } catch { /* Redis 不可用：退回进程内计数 */ }
    }
    if (w !== this.window || this.used.size > this.cap) { this.window = w; this.used.clear() }
    const total = (this.used.get(ip) ?? 0) + bytes
    this.used.set(ip, total)
    return total <= this.maxBytes
  }
}
