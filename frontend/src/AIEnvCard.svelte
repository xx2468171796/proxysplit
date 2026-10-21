<script lang="ts">
  // AI 环境检测（AI 编程官网客户，概览页）：AI 是否只走我们的线路、出口、DNS 锁、IPv6、时区、时间、
  // 其他代理 / VPN、开机自启。后端 App.CheckAIEnv / FixAIEnv（aiguard_app.go）。
  import { onMount } from 'svelte'
  import { CheckAIEnv, FixAIEnv, GetAIHijack, SetAIHijack } from '../wailsjs/go/main/App'
  import { EventsOn } from '../wailsjs/runtime/runtime.js'

  type Item = { id: string; name: string; status: 'ok' | 'warn' | 'fail' | 'info'; detail: string; fix?: string }
  type Report = { items: Item[]; exitIp?: string; exitLoc?: string; checkedAt: string }
  type Hijack = { on: boolean; locked: boolean; visible: boolean }

  let report: Report | null = null
  let hijack: Hijack = { on: false, locked: false, visible: false }
  let checking = false
  let fixing = ''
  let msg = ''
  let confirmRestore = false

  async function loadHijack() {
    try { hijack = (await GetAIHijack()) as Hijack } catch { /* 启动中 */ }
  }

  async function setHijack(on: boolean) {
    confirmRestore = false
    fixing = on ? 'hijack-on' : 'hijack-off'
    msg = ''
    try {
      const err = await SetAIHijack(on)
      msg = err ? err : on ? '已开启劫持模式' : '已恢复：AI 不再强制走线路'
    } catch (e) { msg = String(e) }
    fixing = ''
    await loadHijack()
    await check()
  }

  const fixLabel: Record<string, string> = { guard: '立即保护', timezone: '改成台北时间', clock: '立即对时', autostart: '开启' }
  const statusText: Record<string, string> = { ok: '正常', warn: '建议处理', fail: '有风险', info: '—' }

  $: problems = report ? report.items.filter((i) => i.status === 'fail' || i.status === 'warn').length : 0
  $: fixable = report ? report.items.filter((i) => i.fix).length : 0

  async function check() {
    checking = true
    msg = ''
    try { report = (await CheckAIEnv()) as Report } catch (e) { msg = '检测失败：' + String(e) }
    checking = false
  }

  async function fix(id: string) {
    fixing = id
    msg = ''
    try {
      const err = await FixAIEnv(id)
      msg = err ? err : '已处理'
    } catch (e) { msg = String(e) }
    fixing = ''
    await check()
  }

  onMount(() => {
    loadHijack().then(() => { if (hijack.visible) check() })
    const off = EventsOn('ai-autostart-failed', (m: string) => { msg = '劫持模式自动启动代理失败：' + m })
    // sign-in elsewhere in the app can switch 劫持模式 on while this card is shown
    const timer = setInterval(async () => {
      const was = hijack.visible
      await loadHijack()
      if (hijack.visible && !was) check()
    }, 5000)
    return () => { clearInterval(timer); off() }
  })
</script>

{#if hijack.visible}
<section class="card ai-env">
  <div class="hijack" class:off={!hijack.on}>
    <div class="txt">
      <b>劫持模式：{hijack.on ? '已开启' : '已关闭'}</b>
      <small>{hijack.on
        ? 'AI 网站只能经我们的线路访问；关掉软件、退出登录、重启电脑都保持劫持，AI 不会走本机（大陆）网络。只能在这里「恢复」。'
        : '已恢复：关掉软件时 AI 会走本机网络，有封号风险。'}</small>
    </div>
    {#if hijack.on}
      <button class="act" disabled={!!fixing} on:click={() => (confirmRestore = true)}>恢复</button>
    {:else}
      <button class="act primary" disabled={!!fixing} on:click={() => setHijack(true)}>{fixing === 'hijack-on' ? '开启中…' : '开启劫持'}</button>
    {/if}
  </div>
  {#if confirmRestore}
    <div class="confirm">
      <span>确定恢复？恢复后 AI 不再强制走我们的线路，<b>关掉 ProxySplit 时 AI 会直接用本机（大陆）网络访问，账号可能被风控封禁</b>。</span>
      <button class="act danger" disabled={!!fixing} on:click={() => setHijack(false)}>{fixing === 'hijack-off' ? '恢复中…' : '确定恢复'}</button>
      <button class="act" on:click={() => (confirmRestore = false)}>取消</button>
    </div>
  {/if}
  <div class="head">
    <div>
      <div class="title">AI 环境检测</div>
      <div class="sub">按 AI 防风控要求检查这台电脑：AI 只走我们的台湾线路，关掉 ProxySplit 时 AI 打不开，绝不会用本机 IP 访问</div>
    </div>
    <div class="actions">
      {#if fixable > 0}<button class="act primary" disabled={!!fixing || checking} on:click={() => fix('all')}>{fixing === 'all' ? '修复中…' : '一键修复'}</button>{/if}
      <button class="act" disabled={checking || !!fixing} on:click={check}>{checking ? '检测中…' : '重新检测'}</button>
    </div>
  </div>
  {#if report}
    <div class="summary" class:bad={problems > 0}>{problems > 0 ? `${problems} 项需要处理` : '全部正常'}{#if report.exitIp} · 出口 {report.exitIp}（{report.exitLoc}）{/if}</div>
    <ul>
      {#each report.items as it (it.id)}
        <li>
          <span class="dot" data-s={it.status}></span>
          <div class="txt"><b>{it.name}</b><small>{it.detail}</small></div>
          <span class="state" data-s={it.status}>{statusText[it.status]}</span>
          {#if it.fix}<button class="act sm" disabled={!!fixing} on:click={() => fix(it.fix || '')}>{fixing === it.fix ? '处理中…' : fixLabel[it.fix] || '修复'}</button>{/if}
        </li>
      {/each}
    </ul>
  {:else if checking}
    <div class="summary">检测中…</div>
  {/if}
  {#if msg}<p class="msg">{msg}</p>{/if}
</section>
{/if}

<style>
  .ai-env { padding: 0; overflow: hidden; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 17px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .title { color: var(--ink); font-size: 14px; font-weight: 800; }
  .sub { margin-top: 3px; color: var(--muted-2); font-size: 11px; }
  .actions { display: flex; gap: 8px; }
  .act { min-height: 30px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--card); color: var(--ink-2); font-size: 12px; font-weight: 700; cursor: pointer; }
  .act.primary { border-color: var(--brand); background: var(--brand); color: #fff; }
  .act.sm { min-height: 26px; padding: 0 9px; font-size: 11px; }
  .act:disabled { opacity: .55; cursor: default; }
  .summary { padding: 9px 17px; font-size: 12px; font-weight: 700; color: var(--ok-600); background: var(--ok-tint); }
  .summary.bad { color: var(--danger); background: var(--bad-bg); }
  ul { list-style: none; margin: 0; padding: 4px 0; }
  li { display: flex; align-items: center; gap: 10px; padding: 9px 17px; border-bottom: 1px solid var(--line); }
  li:last-child { border-bottom: none; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--muted-2); }
  .dot[data-s='ok'] { background: var(--ok); }
  .dot[data-s='warn'] { background: var(--warn, #e6a23c); }
  .dot[data-s='fail'] { background: var(--danger); }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .txt b { color: var(--ink); font-size: 12.5px; }
  .txt small { color: var(--muted); font-size: 11px; line-height: 1.45; word-break: break-all; }
  .state { flex: none; font-size: 11px; font-weight: 700; color: var(--muted-2); }
  .state[data-s='ok'] { color: var(--ok-600); }
  .state[data-s='warn'] { color: var(--warn, #e6a23c); }
  .state[data-s='fail'] { color: var(--danger); }
  .msg { margin: 0; padding: 8px 17px 12px; font-size: 11px; color: var(--muted); }
  .hijack { display: flex; align-items: center; gap: 12px; padding: 12px 17px; background: var(--ok-tint); border-bottom: 1px solid var(--line); }
  .hijack.off { background: var(--bad-bg); }
  .hijack b { color: var(--ink); font-size: 13px; }
  .confirm { display: flex; align-items: center; gap: 8px; padding: 10px 17px; font-size: 12px; color: var(--ink-2); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .confirm span { flex: 1; min-width: 240px; line-height: 1.5; }
  .act.danger { border-color: var(--danger); background: var(--danger); color: #fff; }
</style>
