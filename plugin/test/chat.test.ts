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
/** 假 remote 面（remote.session.page）。 */
function fakeRemote(records, opts = {}) {
  return { session: { page: async (arg) => { opts.pageArgs?.push(arg); if (opts.pageFails) return { ok: false, error: { code: 'x', message: 'boom' } }; return { ok: true, value: { records, hasMore: false } } } } }
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
  const page = await ad.page('s1', {})
  assert.equal(page.ok, false)
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

test('E5 host bundle 静态面：chat 屏真数据换装（mock 会话名/假 token 行/仿 gotty 终端摘除）', () => {
  const dist = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')
  assert.ok(dist.includes('ctx.sessions'), 'entry 注入宿主会话面')
  assert.ok(dist.includes('remote.session'), '转录读面=remote.session.page')
  assert.ok(dist.includes('status.currentSession'), '身份=SessionId 文档面回填面在册')
  assert.ok(dist.includes('运行器四选'), 'runner 四选 UI')
  assert.ok(dist.includes('gotty=跨机兜底'), '§5.7 #6 主案/兜底标注')
  assert.ok(!dist.includes('sess-term-'), '仿 gotty 会话 mock 摘除')
  assert.ok(!dist.includes('<span>model: flash-tier</span>'), 'chat 假 token/model tail 摘除')
  assert.ok(!dist.includes('personaReply(agent.name'), 'mock 回复链路调用点摘除')
  assert.ok(!dist.includes("chat/builtinRoot"), 'mock agent 对话入口摘除（文档面真数据）')
})
