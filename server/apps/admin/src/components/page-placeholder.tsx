import { Construction } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

/** 占位页：其它页面 agent 会覆盖它。仅用于让路由与 build 通过。 */
export function PagePlaceholder({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Construction className="h-6 w-6" />
        </div>
        <div className="text-lg font-semibold">{title}</div>
        <p className="max-w-md text-sm text-muted-foreground">{hint ?? '建设中，敬请期待。'}</p>
      </CardContent>
    </Card>
  )
}
