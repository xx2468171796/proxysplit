import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Tone = 'success' | 'warning' | 'destructive' | 'secondary' | 'default'

/** 通用状态徽章：按语义把任意状态词映射到颜色。各页面可复用。 */
export function StatusBadge({ value, className }: { value: string; className?: string }) {
  const v = String(value)
  let tone: Tone = 'secondary'
  if (/正常|启用|已发布|发布|销售中|当前|active|paid|success|online|在线|已开通/i.test(v)) tone = 'success'
  else if (/待|pending|草稿|expiring|即将|处理中/i.test(v)) tone = 'warning'
  else if (/停用|封禁|失败|failed|banned|suspended|revoked|已解绑|已停用|expired|已过期|closed|refunded|disabled/i.test(v))
    tone = 'destructive'
  return (
    <Badge variant={tone} className={cn(className)}>
      {v}
    </Badge>
  )
}
