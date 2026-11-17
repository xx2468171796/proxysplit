// 代理商分成（T05 分区页）：AI 中转站代理站的客户付费，按代理商比例记分成，线下结算。设计见 docs/中转站渠道.md「代理站」。
import * as React from 'react'
import { ReceiptText, Store } from 'lucide-react'
import { TabbedPage } from '@ankotti/admin-ui'
import type { PageProps } from '@/shell/workspace-context'
import { CommissionsTab } from './commissions-tab'
import { DealersTab } from './dealers-tab'

export function DealersPage({ active }: PageProps) {
  const [tab, setTab] = React.useState('dealers')
  const [dealer, setDealer] = React.useState('')
  return (
    <TabbedPage title="代理商分成" active={active} value={tab} onValueChange={setTab}
      description="AI 中转站代理站（<代理商>.claude.zygskins.cn）带来的客户：归属、客服联系方式与付费分成。"
      sections={[
        { id: 'dealers', label: '代理商', icon: <Store /> },
        { id: 'commissions', label: '分成流水', icon: <ReceiptText /> },
      ]}
      render={(id) => (
        <>
          {id === 'dealers' && <DealersTab onOpenLedger={(slug) => { setDealer(slug); setTab('commissions') }} />}
          {id === 'commissions' && <CommissionsTab dealer={dealer} onDealerChange={setDealer} />}
        </>
      )} />
  )
}
