// inbox.test.ts —— v0.56 R-10 console 通知中心收件箱静态验收（console-adoption.md §1.31：
// 四类待办计数可查∧条目可点达操作面∧无通道=页面兜底可见∧空态显式——§1.25 判据的静态面）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const SRC = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')
const liveSrc = readFileSync(join(PLUGIN, 'client/console-live.js'), 'utf8')

test('inbox 读面在册：/v1/inbox 装载 + /v1/sessions watchdog 投影 + 读面缺席诚实降级（零自建状态）', () => {
  assert.ok(liveSrc.includes("jget('v1/inbox')"), '/v1/inbox 读面装载在册（v0.56 四类判定分类投影）')
  assert.ok(liveSrc.includes("jget('v1/sessions')"), '/v1/sessions watchdog 投影装载在册（v0.54 KI-003 查询面）')
  assert.ok(/\.catch\(function \(\) \{ state\.inbox = null; \}\)/.test(liveSrc), '读面缺席=null（旧代/超时诚实降级，不冒充）')
})

test('inbox 屏在册：四类 chips（需人接管/待批准/提案待批/文档待审）+条目深链 data-act=go+空态显式+watchdog 观测面', () => {
  assert.ok(SRC.includes('function screenInbox'), '收件箱屏在册')
  assert.ok(SRC.includes("route('inbox', screenInbox)"), 'inbox 路由接线')
  assert.ok(SRC.includes('INBOX_CLASS_META'), '四类判定分类元数据在册（机械分类=读面自分类单一真相）')
  for (const cls of ['NeedsHuman', 'ApprovalNeeded', 'Proposal', 'DocReview']) {
    assert.ok(SRC.includes(`'${cls}'`), `四类词形 ${cls} 在册`)
  }
  assert.ok(SRC.includes("data-cc-inbox-list=\"true\""), '收件箱条目列表容器在册（headless 判据锚）')
  assert.ok(SRC.includes("data-cc-empty=\"inbox\""), '空态显式在册（§1.25 判据：无待办时显式空态）')
  assert.ok(SRC.includes('data-cc-watchdog="true"'), 'watchdog 观测面区块在册（批准投影挂起/会话活性真实词形）')
  assert.ok(SRC.includes('approveIdle'), '批准投影空闲词形消费（零挂起≠停摆不冒充）')
  assert.ok(SRC.includes('notification.md 规则 6') || SRC.includes('规则 6'), '页面兜底口径标注在册（未配置通知通道=仅页面展示）')
  assert.ok(SRC.includes("'ib-class'"), '类过滤交互在册')
})

test('inbox 入口三件：总览待你处理 metric 卡 + palette 动作 + inboxCount 回落口径（读面缺席=草稿∪归档现读）', () => {
  assert.ok(SRC.includes("metric('inbox', '待你处理'"), '总览 metric 卡在册（点击落 #/inbox）')
  assert.ok(SRC.includes("'待你处理收件箱'"), 'palette 动作在册')
  assert.ok(SRC.includes('function inboxCount'), '计数函数在册')
  assert.ok(SRC.includes('return approvalNeededObjects().length'), '读面缺席回落=草稿∪ApprovalNeeded 归档现读（不冒充零）')
  assert.ok(SRC.includes("'inbox'"), 'inbox 深链段在册（entry CONSOLE_SEGS/路由）')
})

// ── v0.57 R-10 续段（console-adoption.md §1.32——深链操作面活体+事件回链+spawn 声明词形消费） ──
const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')

test('类内 op 深链落点升格：四类各自兜底落点函数在册（link 键原值优先=cored 深链单一真相）', () => {
  assert.ok(appSrc.includes('function inboxOpOf'), '类内 op 落点派生函数在册（§1.32 收口——L58-UI-10 类级跳过词形废除）')
  assert.ok(appSrc.includes("it.link || ''"), 'link 键原值优先（cored 深链不改写——红线 2 无双源）')
  for (const w of ["'NeedsHuman'", "'ApprovalNeeded'", "'Proposal'", "'DocReview'"]) {
    assert.ok(appSrc.includes(`if (it.class === ${w})`), `类 ${w} 兜底落点词形在册`)
  }
  assert.ok(appSrc.includes('data-cc-inbox-event'), '条目行 eventId 判据锚在册（NeedsHuman→事件详情回链活体判定）')
  assert.ok(appSrc.includes('data-cc-inbox-kind'), '条目行 kind 判据锚在册（挂起行 kind=dispatch 词形）')
})

test('挂起行幽灵计数缺口收口：ApprovalNeeded 派单待批行进行集词形+旧代诚实降级标注（不翻倍）', () => {
  assert.ok(appSrc.includes("it.class === 'ApprovalNeeded' && it.kind === 'dispatch'"), '派单待批行进行集消费在册（cored v0.57 行集同源）')
  assert.ok(appSrc.includes('dispatch-legacy'), '旧代幽灵计数诚实降级词形在册（计数挂起而行集缺席=旧代 cored 词形照实）')
  assert.ok(appSrc.includes('data-cc-inbox-count'), 'inbox 计数判据锚在册（回链判据=操作完成下次装载降位）')
})

test('spawn 接线声明词形消费：wf 详情派单行+提案详情派单卡 approval/spawn chips（wired 恒 false 词形诚实）', () => {
  assert.ok(appSrc.includes('last.approval && last.approval.state'), 'wf 派单行 approval 键消费在册（§11.5 批准投影随行）')
  assert.ok(appSrc.includes('last.spawn || null'), 'wf 派单行 spawn 键消费在册（§11.7 接线声明随行）')
  assert.ok(appSrc.includes('spawn·声明'), 'spawn 声明词形 chip 在册（declared=true 词形）')
  assert.ok(appSrc.includes('spawn·未声明'), 'spawn 缺席词形 chip 在册（零值键=诚实缺席）')
  assert.ok(appSrc.includes('wired 恒 false=零拉起执行器'), 'wired 恒 false 红线 a 机械锚标注在册（声明≠拉起）')
  assert.ok(appSrc.includes('r0.approval && r0.approval.state'), '提案详情派单卡 approval 键消费在册')
})
