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
