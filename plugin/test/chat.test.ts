// E5 chat 适配层测试（console-adoption.md §1.11；数据源=dsh session store §3.7 裁决）：
// 适配器 faces 全注入（假 ctx.sessions/remote/webTerminals）——发消息真通路判别联合、
// 转录事件页投影（user/assistant/tool 配对）、ConnectorOps 卡判别=文档面声明集、
// 归属过滤（currentSession/console 发起/session:// 显式形）、运行器四选（诚实余量）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const SRC = readFileSync(join(PLUGIN, 'client/console-chat.js'), 'utf8')

/** 沙箱装载 console-chat.js（IIFE 挂 __CC.chat；__CC 由 bundle 闭包承载=参数注入）。 */
function loadChat() {
  const cc: any = {}
  const fn = new Function('window', '__CC', SRC)
  fn({ __CC: cc }, cc)
  assert.ok(cc.chat, 'console-chat.js 必须挂 __CC.chat 适配层')
  return cc.chat
}

/** 假 sessions 面（ISessions 子集：list/create/using）。 */
function fakeSessions(rows, opts = {}) {
  return {
    list: {
      getSnapshot: () => ({
        ids: rows.map((r) => r.id),
        byId: Object.fromEntries(rows.map((r) => [r.id, r])),
        phase: 'ready',
      }),
      subscribe: (fn) => { opts.listeners?.push(fn); return () => { opts.unsubbed = true } },
    },
    create: async (o) => { opts.created?.push(o || {}); return opts.createFails ? (() => { throw new Error('preset missing') })() : 'sess-new-1' },
    refresh: async () => { opts.refreshed = true },
    using: async (id, o, op) => op({
      sessionId: id,
      binding: {
        session: {
          beginSubmission: (input) => { opts.begun?.push(input); return { requestId: 'req-1', abandon() {} } },
          prompt: async (content, mode, signal, requestId) => {
            opts.prompted?.push({ content, mode, requestId })
            if (opts.promptFails) return { ok: false, error: { code: 'session/busy', message: 'busy' } }
            return { ok: true, value: { accepted: true } }
          },
          rename: async (title) => { opts.renamed?.push(title); return { ok: true, value: { title, seq: 9 } } },
        },
      },
    }),
  }
}
/** 假 retain 持有（binding.eventSource 事件窗——retain 自带初始历史开窗）。 */
function fakeSessionsHold(rows, records, opts = {}) {
  const base = fakeSessions(rows, opts)
  base.retain = (id, o) => {
    opts.retained?.push({ id, source: o && o.source })
    return {
      sessionId: id,
      ready: Promise.resolve({ sessionId: id, session: base.using ? undefined : undefined, eventSource: makeSource(records) }),
      binding: { eventSource: makeSource(records) },
      release: () => { opts.released = (opts.released || 0) + 1 },
    }
  }
  return base
}
function makeSource(records) {
  let listeners = []
  let snap = { entries: records, hasMore: false, revision: 1, change: { kind: 'replace', entries: records } }
  return {
    getSnapshot: () => snap,
    subscribe: (fn) => { listeners.push(fn); return () => { listeners = listeners.filter((l) => l !== fn) } },
  }
}

const EV = (type, seq, data, time = 1760000000000 + seq) => ({ type: 'event', event: { type, seq, time, data } })

test('E5 适配器：会话清单快照投影（瘦身行=displayTitle/cwd/running/blank/updatedAt）+ 订阅/刷新', async () => {
  const chat = loadChat()
  const opts = { listeners: [] }
  const faces = { sessions: fakeSessions([
    { id: 's1', displayTitle: 'console · core-headless', cwd: '/w/a', running: true, blank: false, updatedAt: 1760000000000 },
    { id: 's2', title: 'raw-title', displayTitle: '', running: false, blank: true, updatedAt: 5 },
  ], opts) }
  const ad = chat.createAdapter(faces)
  assert.equal(ad.ready(), true, 'sessions 在场=ready')
  const snap = ad.listSnapshot()
  assert.equal(snap.ready, true)
  assert.equal(snap.rows.length, 2)
  assert.equal(snap.rows[0].title, 'console · core-headless')
  assert.equal(snap.rows[1].title, 'raw-title', 'displayTitle 缺席回退 title 字段（不发明标题）')
  assert.equal(snap.rows[0].running, true)
  let notified = 0
  const off = ad.subscribe(() => { notified++ })
  opts.listeners.forEach((fn) => fn())
  assert.equal(notified, 1, 'subscribe 桥接宿主清单流')
  off()
  await ad.refresh()
  assert.equal(opts.refreshed, true)
})

test('E5 适配器：faces 缺席=ready()=false 诚实降级（create/prompt 判别联合不抛错）', async () => {
  const chat = loadChat()
  const ad = chat.createAdapter({})
  assert.equal(ad.ready(), false)
  const created = await ad.create({})
  assert.equal(created.ok, false)
  assert.match(created.error, /缺席|未在册/)
  const prompted = await ad.prompt('s1', 'hi', 'queue')
  assert.equal(prompted.ok, false)
  assert.equal(ad.hold('s1'), null, '会话面缺席=hold 降级 null')
  assert.equal(ad.terminals('s1'), null, 'webTerminals 缺席=roster 降级 null')
  assert.deepEqual(ad.listSnapshot(), { ready: false, rows: [] })
})

test('E5 发消息真通路：beginSubmission+prompt(requestId) 落 mode/内容；回执=accepted；拒绝=判别 ✗', async () => {
  const chat = loadChat()
  const opts = { begun: [], prompted: [] }
  const ad = chat.createAdapter({ sessions: fakeSessions([{ id: 's1', displayTitle: 't' }], opts) })
  const ok = await ad.prompt('s1', '你好', 'steer')
  assert.equal(ok.ok, true); assert.equal(ok.accepted, true)
  assert.equal(opts.begun[0].mode, 'steer')
  assert.equal(opts.begun[0].text, '你好')
  assert.deepEqual(opts.prompted[0].content, [{ type: 'text', text: '你好' }])
  assert.equal(opts.prompted[0].mode, 'steer')
  assert.equal(opts.prompted[0].requestId, 'req-1', 'prompt 携 beginSubmission 回执身份')
  opts.promptFails = true
  const bad = await ad.prompt('s1', 'hi', 'queue')
  assert.equal(bad.ok, false, 'prompt 被拒=判别 ✗（宿主业务错误透传）')
  const empty = await ad.prompt('s1', '  ', 'queue')
  assert.equal(empty.ok, false, '空消息=拒绝不触宿主')
})

test('E5 转录投影：user/assistant 气泡行 + tool/call↔tool/result 按 callId 配对 + context 注入行', () => {
  const chat = loadChat()
  const records = [
    EV('turn/start', 1, { turn: 1 }),
    EV('user/message', 2, { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'text', text: '查一下状态' }], source: { kind: 'user' } } }),
    EV('assistant/message', 3, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好的' }, { type: 'reasoning', text: '内部推理不上屏' }] }, usage: { totalTokens: 42 } }),
    EV('tool/call', 4, { turn: 1, step: 1, callId: 'c1', name: 'dispatch', arguments: '{"to":"agent/core-headless@global"}' }),
    EV('tool/result', 5, { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '拒绝：目标未运行' }], isError: true } }),
    EV('user/message', 6, { turn: 2, step: 1, message: { role: 'user', content: [{ type: 'text', text: 'AGENTS.md 注入' }], source: { kind: 'system-prompt' } } }),
  ]
  const items = chat.projectTranscript(records, ['dispatch', 'query'])
  assert.equal(items.length, 4, 'turn/start 与已配对 tool/result 不上独立行（callId 配对回填）')
  assert.equal(items[0].kind, 'user')
  assert.equal(items[0].text, '查一下状态')
  assert.equal(items[1].kind, 'assistant')
  assert.equal(items[1].text, '好的', 'reasoning 块不上对话面')
  assert.equal(items[1].usage.totalTokens, 42)
  assert.equal(items[2].kind, 'tool')
  assert.equal(items[2].connectorOps, true, 'op 名命中声明集=ConnectorOps 卡')
  assert.equal(items[2].result, '拒绝：目标未运行', 'callId 配对 result 回填')
  assert.equal(items[2].isError, true)
  assert.equal(items[3].kind, 'context', '非 user 源注入行=context（不冒充人话）')
})

test('E5 ConnectorOps 卡判别：声明集命中/缺席两态（不冒充协议挂载）+ declaredOps 解析（挂载 refs × 对象 ops）', () => {
  const chat = loadChat()
  assert.equal(chat.isConnectorOp('dispatch', ['dispatch', 'query']), true)
  assert.equal(chat.isConnectorOp('read_file', ['dispatch']), false)
  assert.equal(chat.isConnectorOp('read_file', []), false, '声明缺席=普通工具卡')
  const agentContent = [
    'spec:',
    '  connectorOps:',
    '    - {ops: connector-ops/agent-comm, as: comm}',
  ].join('\n')
  const copIndex = {
    'connector-ops/agent-comm': { ops: ['dispatch', 'query', 'interrupt', 'inbox'] },
  }
  assert.deepEqual(chat.declaredOpsOf({ spec: { connectorOps: [{ ops: 'connector-ops/agent-comm', as: 'comm' }] } }, copIndex), ['dispatch', 'query', 'interrupt', 'inbox'])
  const fromYaml = /connectorOps:/.test(agentContent) // yaml 解析由 console-app 层 regex 完成——此处验对象面
  assert.ok(fromYaml)
  assert.deepEqual(chat.declaredOpsOf({ spec: {} }, copIndex), [], '无挂载声明=空集（诚实）')
})

test('E5 归属过滤（§3.7 按 agent 过滤的投影）：currentSession/console 发起/session:// 显式形；其余=宿主组不冒充', () => {
  const chat = loadChat()
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const g = chat.attributedSessions(rows, { currentSessionId: 'a', ownedIds: ['a', 'b'] })
  assert.deepEqual(g.mine.map((r) => r.id), ['a', 'b'])
  assert.deepEqual(g.host.map((r) => r.id), ['c'])
  const g2 = chat.attributedSessions(rows, { currentSessionId: '', ownedIds: [] })
  assert.equal(g2.mine.length, 0, '归属证据缺席=零归属（诚实）')
  assert.equal(g2.host.length, 3)
  assert.deepEqual(chat.sessionIdsOfRefs(['session://s-1', 'agent://core-headless', 'session://s-1']), ['s-1'], 'session:// 显式形去重；agent:// 形不在此列')
})

test('E5 运行器四选：四项在册；内嵌 dsh 可用；claude-code/opencode/gotty=诚实余量（enabled=false+why 标注）', () => {
  const chat = loadChat()
  const runners = chat.runnerList()
  assert.equal(runners.length, 4)
  assert.deepEqual(runners.map((r) => r.id), ['dsh', 'claude-code', 'opencode', 'gotty'])
  assert.equal(runners[0].enabled, true)
  runners.slice(1).forEach((r) => {
    assert.equal(r.enabled, false, r.id + '=余量不冒充可用')
    assert.ok(r.why.length >= 4, r.id + ' 携余量原因标注')
  })
  assert.equal(chat.runnerById('gotty').id, 'gotty')
})

test('E5 终端 roster 面：webTerminals.watch 桥接+退订；face 缺席=null（§5.7 #6 内置 PTY 主案）', () => {
  const chat = loadChat()
  let watched = null
  let unsubbed = false
  const wt = { watch: (sessionId, listener) => { watched = sessionId; listener([{ id: 't1', title: 'bash', state: 'running' }]); return () => { unsubbed = true } } }
  const ad = chat.createAdapter({ webTerminals: wt })
  const roster = ad.terminals('s1')
  assert.ok(roster, 'face 在场=roster 面在册')
  assert.equal(watched, 's1')
  assert.equal(roster.get().length, 1)
  roster.unsubscribe()
  assert.equal(unsubbed, true)
})

test('E5 会话持有（retain+eventSource）：事件窗快照投影 + 订阅活体 + release 对称', async () => {
  const chat = loadChat()
  const opts = { retained: [] }
  const records = [
    { type: 'event', event: { type: 'user/message', seq: 1, time: 1760000000000, data: { message: { role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } } } },
    { type: 'event', event: { type: 'assistant/message', seq: 2, time: 1760000000001, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } } } },
    { type: 'transient', event: { kind: 'assistant/live-chunk' } },
  ]
  const ad = chat.createAdapter({ sessions: fakeSessionsHold([{ id: 's1', displayTitle: 't' }], records, opts) })
  const h = ad.hold('s1')
  assert.ok(h, 'sessions 在场=hold 在册')
  assert.deepEqual(opts.retained.map((r) => r.source), ['core-console'], 'retain 携消费者标签')
  await h.ready
  const snap = h.snapshot()
  assert.equal(snap.entries.length, 3)
  const items = chat.projectTranscript(snap.entries, [])
  assert.equal(items.length, 2, 'transient 行不上 durable 投影')
  assert.equal(items[0].text, 'hello')
  let notified = 0
  const off = h.subscribe(() => { notified++ })
  off()
  h.release()
  assert.equal(opts.released, 1, 'release 对称（屏切换/卸载释放持有）')
})

test('E5 host bundle 静态面：chat 屏真数据换装（mock 会话名/假 token 行/仿 gotty 终端摘除）', () => {
  const dist = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')
  assert.ok(dist.includes('ctx.sessions'), 'entry 注入宿主会话面')
  assert.ok(dist.includes('eventSource'), '转录读面=retain 持有的事件窗（活体）')
  assert.ok(dist.includes('status.currentSession'), '身份=SessionId 文档面回填面在册')
  assert.ok(dist.includes('运行器四选'), 'runner 四选 UI')
  assert.ok(dist.includes('gotty=跨机兜底'), '§5.7 #6 主案/兜底标注')
  assert.ok(!dist.includes('sess-term-'), '仿 gotty 会话 mock 摘除')
  assert.ok(!dist.includes('<span>model: flash-tier</span>'), 'chat 假 token/model tail 摘除')
  assert.ok(!dist.includes('personaReply(agent.name'), 'mock 回复链路调用点摘除')
  assert.ok(!dist.includes("chat/builtinRoot"), 'mock agent 对话入口摘除（文档面真数据）')
})

// ── E5b chat-backfill 结构化合并（console-adoption.md §1.35——§1.11 补注④ 余量摘除；loop-62） ──
// 判据：已有 status 块=键级合并落库不跳过；零盲写（块外字节恒等/未知键保留）；同值幂等 noop；
// 预读口径缺席（无 metadata.name/tab 缩进）=诚实降级不盲写；调用点余量词形摘除（回潮即红）。

const AGENT_WITH_STATUS = [
  'apiVersion: core/v1',
  'kind: Agent',
  'metadata:',
  '  name: core-headless',
  '  scope: global',
  '  resourceVersion: 4',
  'spec:',
  '  runtime: dsh',
  '  connectorOps:',
  '    - {ops: connector-ops/agent-comm, as: agent-comm}',
  'status:',
  '  currentSession:',
  '    id: session-old-1',
  '    startedAt: 2026-11-23T21:16:46.173Z',
  '    docsLoaded: []',
  '',
].join('\n')
const AGENT_NO_CS = ['kind: Agent', 'metadata:', '  name: x', 'status:', '  phase: ready', ''].join('\n')
const AGENT_NO_STATUS = ['kind: Agent', 'metadata:', '  name: y', 'spec:', '  runtime: dsh', ''].join('\n')
const AGENT_UNKNOWN_KEY = ['kind: Agent', 'metadata:', '  name: z', 'status:', '  currentSession:', '    id: oldz', '    note: keep-me', '    docsLoaded: [a]', 'spec:', '  runtime: dsh', ''].join('\n')
const AGENT_SIBLING = ['kind: Agent', 'metadata:', '  name: g', 'status:', '  phase: ready', '  currentSession:', '    id: oldg', ''].join('\n')

function loadMerge() {
  const chat = loadChat()
  assert.equal(typeof chat.mergeCurrentSession, 'function', 'mergeCurrentSession 纯映射已导出（__CC.chat）')
  return chat.mergeCurrentSession
}

test('E5b 合并：已有 status 块 Agent = currentSession 键级更新（rv 前进落库词形；既有块 id 翻新旧值不残留）', () => {
  const merge = loadMerge()
  const r = merge(AGENT_WITH_STATUS, 'sess-9', '2026-11-26T10:00:00.000Z')
  assert.equal(r.ok, true, '已有 status 块=合并不跳过（余量词形摘除）')
  assert.ok(r.content.includes('id: sess-9'), '新 SessionId 落位')
  assert.ok(!r.content.includes('session-old-1'), '旧 id 不残留（键级重写非追加）')
  assert.ok(r.content.includes('runtime: dsh'), 'spec 面零盲写（块外字节恒等）')
  assert.ok(r.content.includes('connector-ops/agent-comm'), '其余字段零盲写（mount 声明保留）')
  assert.equal((r.content.match(/currentSession:/g) || []).length, 1, 'currentSession 键唯一（零双键）')
  assert.ok(r.content.startsWith('apiVersion: core/v1'), 'frontmatter 头部零改写')
  assert.ok(r.content.endsWith('docsLoaded: []'), '块内结构=YAML 可解析词形（尾行 docsLoaded）')
})

test('E5b 合并：同参回放=幂等 noop 词形（第二次起 content 恒等——零盲写红线机读锚）', () => {
  const merge = loadMerge()
  const r1 = merge(AGENT_WITH_STATUS, 'sess-9', '2026-11-26T10:00:00.000Z')
  const r2 = merge(r1.content, 'sess-9', '2026-11-26T10:00:00.000Z')
  const r3 = merge(r2.content, 'sess-9', '2026-11-26T10:00:00.000Z')
  assert.equal(r2.content, r3.content, '同参回放=幂等 noop（apply 面零新 rv）')
  const rB = merge(AGENT_NO_CS, 's2', 'T1')
  const rB2 = merge(rB.content, 's2', 'T1')
  const rB3 = merge(rB2.content, 's2', 'T1')
  assert.equal(rB2.content, rB3.content, '有块无 currentSession 分支同参幂等')
  const rC = merge(AGENT_NO_STATUS, 's3', 'T2')
  const rC2 = merge(rC.content, 's3', 'T2')
  const rC3 = merge(rC2.content, 's3', 'T2')
  assert.equal(rC2.content, rC3.content, '无 status 块分支（首次追加）回放幂等')
  const rD = merge(AGENT_UNKNOWN_KEY, 's4', 'T3')
  const rD2 = merge(rD.content, 's4', 'T3')
  assert.equal(rD.content, rD2.content, '未知子键分支回放幂等')
})

test('E5b 合并：零盲写红线——status 块内未知子键原样保留 + sibling 键零动 + 块外文档零改写', () => {
  const merge = loadMerge()
  const rD = merge(AGENT_UNKNOWN_KEY, 's4', 'T3')
  assert.ok(rD.content.includes('note: keep-me'), '未知子键原样保留（零盲写）')
  assert.ok(!rD.content.includes('oldz'), '旧 id 翻新')
  assert.ok(rD.content.includes('runtime: dsh'), 'status 块后文档零改写')
  const rG = merge(AGENT_SIBLING, 's6', 'T4')
  assert.ok(rG.content.includes('phase: ready'), 'sibling 键零动')
  assert.equal((rG.content.match(/currentSession:/g) || []).length, 1, '不发明第二 currentSession 键')
  assert.ok(!rG.content.includes('oldg'), '旧 id 翻新')
})

test('E5b 合并：预读口径缺席=诚实降级（ok=false 不盲写）——无 metadata.name / tab 缩进两形', () => {
  const merge = loadMerge()
  const rE = merge('kind: Agent\nstatus: inline-scalar\n', 's', 'T')
  assert.equal(rE.ok, false, '无 metadata.name=拒绝合并（无身份锚不盲写）')
  assert.equal(rE.content, 'kind: Agent\nstatus: inline-scalar\n', '拒绝=原文零改写')
  const rT = merge('status:\n\tid: x\n', 's', 'T')
  assert.equal(rT.ok, false, 'tab 缩进=保守拒绝（键级手术口径外）')
})

test('E5b 回归：调用点余量词形摘除（「未回填（诚实余量）」/「结构化合并=E5b 余量」回潮即红）', () => {
  const app = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')
  assert.ok(!app.includes('未回填（诚实余量）'), '余量跳过 toast 词形已摘除')
  assert.ok(!app.includes('结构化合并=E5b 余量'), '余量标注词形已摘除')
  assert.ok(app.includes('mergeCurrentSession'), '调用点=结构化合并纯映射接线在册')
  assert.ok(app.includes("res.data.action === 'noop'"), '幂等 noop 回执词形消费在册（action=create|update|noop）')
  assert.ok(app.includes('console:chat-backfill'), 'fieldManager 不变（判据面）')
})
