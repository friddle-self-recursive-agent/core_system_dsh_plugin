// E5b agent-comm 四 op 工具面测试（console-adoption.md §1.11 E5b；cross-agent.md §5 协议 v0.1）：
// 信封校验全字段（§5.1）、四原语落点（§5.2/§5.7 #4 对照）、to 解析三步（文档面→sessionId→活体）、
// mailbox 幂等/容量、from 解析（文档面反查+session 降级）、bundle 静态面（工具名=协议 op 名裸用）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AGENT_COMM_VERSION, AGENT_COMM_KINDS, MAILBOX_CAPACITY,
  isUuid, isRfc3339, parseAgentRef, agentRefToString,
  validateEnvelope, makeErrorReply, Mailbox, extractAgentDocFacts, resolveTarget, resolveFrom, executeAgentCommOp,
} from '../src/agent-comm.ts'
import { mountAgentCommTools, AGENT_COMM_TOOL_NAMES } from '../src/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')

const GOOD_ENVELOPE = () => ({
  v: AGENT_COMM_VERSION,
  id: '0195d8f2-7a3b-7c41-9e2a-51f0c3b8a7d4',
  ts: '2026-11-23T10:12:30Z',
  from: 'agent/dev-delivery@systems/core_system',
  to: 'agent/ci-repair@systems/developer-system',
  kind: 'dispatch',
  payload: { text: '修复 ci 门禁红灯' },
  token: 'tok_x',
})

// ---------- §5.1 信封校验（十面） ----------
test('envelope 合法最小信封全通过（含 dispatch token）', () => {
  const r = validateEnvelope(GOOD_ENVELOPE())
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.envelope.v, '0.1')
    assert.equal(r.envelope.token, 'tok_x')
    assert.deepEqual(r.envelope.payload, { text: '修复 ci 门禁红灯' })
  }
})
test('envelope v 缺失/错版本=拒', () => {
  for (const v of [undefined, '0.2', 0.1, '']) {
    const r = validateEnvelope({ ...GOOD_ENVELOPE(), v })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('v 必须为')), `v=${String(v)} 的错误串须点名 v 字段`)
  }
})
test('envelope id 非 uuid=拒（幂等键）', () => {
  for (const id of [undefined, 'not-a-uuid', '0195D8F2-7A3B-7C41-9E2A-51F0C3B8A7D4X']) {
    const r = validateEnvelope({ ...GOOD_ENVELOPE(), id })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('id 必须为 uuid')))
  }
})
test('envelope ts 非 RFC3339=拒', () => {
  for (const ts of [undefined, '2026-11-23 10:12:30', '2026-11-23T10:12:30', Date.now()]) {
    const r = validateEnvelope({ ...GOOD_ENVELOPE(), ts: ts as unknown as string })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('ts 必须为 RFC3339')))
  }
})
test('envelope ts 合法变体（毫秒/偏移时区）通过', () => {
  assert.equal(validateEnvelope({ ...GOOD_ENVELOPE(), ts: '2026-11-23T10:12:30.123Z' }).ok, true)
  assert.equal(validateEnvelope({ ...GOOD_ENVELOPE(), ts: '2026-11-23T18:12:30+08:00' }).ok, true)
})
test('envelope from/to 非 agent/<name>@<scope>=拒', () => {
  for (const to of [undefined, 'ci-repair', 'agent/onlyname', 'agent/x@y@z', 'agent/@scope']) {
    const r = validateEnvelope({ ...GOOD_ENVELOPE(), to: to as unknown as string })
    assert.equal(r.ok, false, `to=${String(to)} 应拒`)
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('to 必须为 agent/')))
  }
})
test('envelope kind 非法=拒（reply 非原语不在工具面）', () => {
  for (const kind of [undefined, 'reply', 'notify', 'DISPATCH']) {
    const r = validateEnvelope({ ...GOOD_ENVELOPE(), kind: kind as unknown as string })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('kind 必须为四原语')))
  }
})
test('envelope payload 非对象=拒（数组/标量均拒）', () => {
  for (const payload of [undefined, 'text', [1, 2]]) {
    const r = validateEnvelope({ ...GOOD_ENVELOPE(), payload: payload as unknown as object })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('payload 必须为对象')))
  }
})
test('envelope refs 非 string[] =拒', () => {
  const r = validateEnvelope({ ...GOOD_ENVELOPE(), refs: ['ok-ref', 42] })
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes('refs 必须为')))
})
test('dispatch 无 token=拒；query/interrupt/inbox 无 token=过（§5.2 权限规则）', () => {
  const noToken = { ...GOOD_ENVELOPE() } as Record<string, unknown>
  delete noToken.token
  const d = validateEnvelope({ ...noToken, kind: 'dispatch' })
  assert.equal(d.ok, false)
  if (!d.ok) assert.ok(d.errors.some((e) => e.includes('dispatch 必须携带 token')))
  for (const kind of ['query', 'interrupt', 'inbox'] as const) {
    assert.equal(validateEnvelope({ ...noToken, kind, payload: { text: 'x' } }).ok, true, `${kind} 不强制 token`)
  }
})

// ---------- ref/杂项 ----------
test('parseAgentRef 往返', () => {
  const ref = parseAgentRef('agent/core-headless@global')
  assert.ok(ref)
  assert.equal(agentRefToString(ref!), 'agent/core-headless@global')
  assert.equal(parseAgentRef('agent/x@y@z'), null)
  assert.equal(parseAgentRef('agent/x@'), null)
})
test('isUuid/isRfc3339 基面', () => {
  assert.equal(isUuid('0195d8f2-7a3b-7c41-9e2a-51f0c3b8a7d4'), true)
  assert.equal(isUuid(''), false)
  assert.equal(isRfc3339('2026-11-23T10:12:30Z'), true)
  assert.equal(isRfc3339('not a date'), false)
})
test('makeErrorReply：to=from=发起方（自记失败回执，不冒充目标身份）', () => {
  const r = makeErrorReply({ from: 'agent/a@global', inReplyTo: 'env-1', op: 'dispatch' }, '目标不在册')
  assert.equal(r.to, 'agent/a@global')
  assert.equal(r.from, 'agent/a@global')
  assert.equal(r.kind, 'inbox')
  assert.equal((r.payload as any).error, '目标不在册')
  assert.equal((r.payload as any).inReplyTo, 'env-1')
  assert.ok(isUuid(r.id))
})

// ---------- mailbox（幂等/容量/拉取消费） ----------
test('mailbox：deliver 幂等（同 id 忽略）+ drain 消费清空', () => {
  const mb = new Mailbox()
  const env = makeErrorReply({ from: 'agent/a@global', inReplyTo: 'x', op: 'query' }, 'e1')
  assert.equal(mb.deliver(env), true)
  assert.equal(mb.deliver(env), false, '同 id 二次落账=忽略')
  assert.equal(mb.peek('agent/a@global').length, 1)
  const out = mb.drain('agent/a@global')
  assert.equal(out.length, 1)
  assert.equal(mb.drain('agent/a@global').length, 0, '拉取即消费')
})
test('mailbox：FIFO 容量淘汰（淘汰后同 id 可再落）', () => {
  const mb = new Mailbox()
  const ref = 'agent/a@global'
  const ids: string[] = []
  for (let i = 0; i < MAILBOX_CAPACITY + 3; i++) {
    const e = makeErrorReply({ from: ref, inReplyTo: `i${i}`, op: 'dispatch' }, `e${i}`)
    ids.push(e.id)
    mb.deliver(e)
  }
  const box = mb.peek(ref)
  assert.equal(box.length, MAILBOX_CAPACITY, '容量封顶')
  assert.equal((box[0] as any).payload.error, 'e3', '最旧三条被淘汏（FIFO）')
  // 重新落被淘汰的 id：可再入（幂等记忆随淘汰释放）
  const first = makeErrorReply({ from: ref, inReplyTo: 'i0', op: 'dispatch' }, 'e0')
  first.id = ids[0]
  assert.equal(mb.deliver(first), true)
})

// ---------- 文档面身份抽取 ----------
test('extractAgentDocFacts：status.currentSession.id 命中 + session:// 兜底 + phase', () => {
  const yaml = [
    'apiVersion: core/v1',
    'kind: Agent',
    'metadata:',
    '  name: core-headless',
    'spec:',
    '  runtime: dsh',
    'status:',
    '  phase: Idle',
    '  currentSession:',
    '    id: session-f2cef2cb-bfe2-4e3f-9a15-7a2e80e410e4',
    '    startedAt: 2026-11-23T21:16:46.173Z',
  ].join('\n')
  const f = extractAgentDocFacts(yaml)
  assert.equal(f.sessionId, 'session-f2cef2cb-bfe2-4e3f-9a15-7a2e80e410e4')
  assert.equal(f.phase, 'Idle')
  const f2 = extractAgentDocFacts('spec:\n  agentRefs: ["session://abc-12345678-1234-1234-1234-123456789012"]\n')
  assert.equal(f2.sessionId, 'abc-12345678-1234-1234-1234-123456789012', 'agentRefs 显式 session:// 形在册可解析')
  assert.deepEqual(extractAgentDocFacts(''), { sessionId: null, phase: null })
})

// ---------- to 解析三步 ----------
function fakeCore(agentDoc: string | null) {
  return {
    get: async (_kind: string, scope: string, name: string) =>
      agentDoc === null
        ? { ok: false, status: 404, error: 'not found' }
        : { ok: true, data: { kind: 'Agent', scope, name, resourceVersion: 1, content: agentDoc } },
    list: async () => ({ ok: true, data: agentDoc === null ? [] : [{ kind: 'Agent', name: 'core-headless', scope: 'global', resourceVersion: 1 }] }),
  }
}
const DOC = 'status:\n  phase: Idle\n  currentSession:\n    id: session-aaaa-bbbb\n'
test('resolveTarget：ref 形坏=拒；文档面缺=拒（无服务发现）；缺 sessionId=拒；活体缺=拒', async () => {
  const live = { get: (id: string) => (id === 'session-aaaa-bbbb' ? { id } : undefined) }
  const core = fakeCore(DOC)
  const badRef = await resolveTarget('core-headless', core, live)
  assert.equal(badRef.ok, false)
  const noDoc = await resolveTarget('agent/ghost@global', fakeCore(null), live)
  assert.equal(noDoc.ok, false)
  if (!noDoc.ok) assert.ok(noDoc.error.includes('未注册'))
  const noSid = await resolveTarget('agent/core-headless@global', fakeCore('status:\n  phase: Idle\n'), live)
  assert.equal(noSid.ok, false)
  if (!noSid.ok) assert.ok(noSid.error.includes('身份载体'))
  const noLive = await resolveTarget('agent/core-headless@global', core, { get: () => undefined })
  assert.equal(noLive.ok, false)
  if (!noLive.ok) assert.ok(noLive.error.includes('活体注册表'))
  const ok = await resolveTarget('agent/core-headless@global', core, live)
  assert.deepEqual(ok, { ok: true, ref: { name: 'core-headless', scope: 'global' }, sessionId: 'session-aaaa-bbbb', live: true, docPhase: 'Idle' })
})
test('resolveTarget：inbox 豁免活体（mailbox 落账面不依赖活体）', async () => {
  const r = await resolveTarget('agent/core-headless@global', fakeCore(DOC), undefined, { requireLive: false })
  assert.equal(r.ok, true, 'requireLive=false（inbox 调用形）仍解析过')
  assert.equal(r.ok && r.live, false, '活体事实如实投影（不在册）')
})
test('resolveFrom：文档面反查命中 / 未回填= session 降级 / 无 caller=null', async () => {
  const core = fakeCore(DOC)
  assert.equal(await resolveFrom('session-aaaa-bbbb', core), 'agent/core-headless@global')
  assert.equal(await resolveFrom('session-other', core), 'agent/session-other@session')
  assert.equal(await resolveFrom(undefined, core), null)
})

// ---------- 四 op 落点（§5.7 #4 对照） ----------
function baseDeps(over: Partial<AgentCommDeps> = {}): AgentCommDeps {
  return {
    core: fakeCore(DOC),
    agents: { get: (id: string) => (id === 'session-aaaa-bbbb' ? { id, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as any : undefined) },
    prompt: async () => ({ accepted: true }),
    cancel: () => ({ accepted: true }),
    callerAgentId: 'session-aaaa-bbbb',
    ...over,
  }
}
test('dispatch：活体+文档面命中 → prompt(mode=queue) 真通路；回执含 sessionId', async () => {
  const prompted: any[] = []
  const r = await executeAgentCommOp('dispatch', { to: 'agent/core-headless@global', text: '跑一次验收', token: 'tok' }, baseDeps({
    prompt: async (req) => { prompted.push(req); return { accepted: true } },
  }), new Mailbox())
  assert.equal(r.ok, true)
  assert.equal(r.detail?.sessionId, 'session-aaaa-bbbb')
  assert.equal(r.detail?.delivery, 'queue')
  assert.equal(prompted.length, 1)
  assert.equal(prompted[0].mode, 'queue')
  assert.equal(prompted[0].sessionId, 'session-aaaa-bbbb')
  assert.match(prompted[0].content[0].text, /跑一次验收/)
})
test('dispatch：无 token=envelope 校验拒 + error reply 落发起方 mailbox（不重试）', async () => {
  const mb = new Mailbox()
  const r = await executeAgentCommOp('dispatch', { to: 'agent/core-headless@global', text: 'x' }, baseDeps(), mb)
  assert.equal(r.ok, false)
  assert.match(r.error!, /dispatch 必须携带 token/)
  const box = mb.drain('agent/core-headless@global')
  assert.equal(box.length, 1, 'error reply 落账给发起方')
  assert.equal((box[0] as any).payload.op, 'dispatch')
})
test('dispatch：to 未注册=拒（无服务发现，解析失败即拒 §5.4）', async () => {
  const r = await executeAgentCommOp('dispatch', { to: 'agent/ghost@global', text: 'x', token: 't' }, baseDeps({ core: fakeCore(null) }), new Mailbox())
  assert.equal(r.ok, false)
  assert.match(r.error!, /未注册/)
})
test('dispatch：活体缺席=拒（同机传输前提；跨机=v0.2 declared 余量）', async () => {
  const r = await executeAgentCommOp('dispatch', { to: 'agent/core-headless@global', text: 'x', token: 't' }, baseDeps({ agents: { get: () => undefined } }), new Mailbox())
  assert.equal(r.ok, false)
  assert.match(r.error!, /活体注册表/)
})
test('query：同步只读快照（live/status/pendingInbox/mailboxPending）', async () => {
  const mb = new Mailbox()
  mb.deliver(makeErrorReply({ from: 'agent/core-headless@global', inReplyTo: 'z', op: 'dispatch' }, '旧错'))
  const r = await executeAgentCommOp('query', { to: 'agent/core-headless@global' }, baseDeps(), mb)
  assert.equal(r.ok, true)
  assert.equal(r.detail?.live, true)
  assert.equal(r.detail?.status, 'idle')
  assert.equal(r.detail?.pendingInbox.nextTurn, 0)
  assert.equal(r.detail?.mailboxPending, 1)
})
test('interrupt：cancel 面调用（sessionId 对齐）', async () => {
  const cancelled: any[] = []
  const r = await executeAgentCommOp('interrupt', { to: 'agent/core-headless@global', reason: '改派' }, baseDeps({
    cancel: (req) => { cancelled.push(req); return { accepted: true } },
  }), new Mailbox())
  assert.equal(r.ok, true)
  assert.equal(r.detail?.cancelled, true)
  assert.equal(cancelled[0].sessionId, 'session-aaaa-bbbb')
})
test('inbox：拉取消费 mailbox + 活体在册回执（不消费 dsh pending 队列）', async () => {
  const mb = new Mailbox()
  mb.deliver(makeErrorReply({ from: 'agent/core-headless@global', inReplyTo: 'z1', op: 'dispatch' }, 'e1'))
  mb.deliver(makeErrorReply({ from: 'agent/core-headless@global', inReplyTo: 'z2', op: 'interrupt' }, 'e2'))
  const r = await executeAgentCommOp('inbox', { to: 'agent/core-headless@global' }, baseDeps(), mb)
  assert.equal(r.ok, true)
  assert.equal(r.detail?.count, 2)
  assert.equal((r.detail as any)?.messages.length, 2)
  assert.equal(mb.drain('agent/core-headless@global').length, 0, '拉取即消费')
})
test('caller 缺席=拒（from 不可解析——对等面信任已注册发起方）', async () => {
  const r = await executeAgentCommOp('query', { to: 'agent/core-headless@global' }, baseDeps({ callerAgentId: undefined }), new Mailbox())
  assert.equal(r.ok, false)
  assert.match(r.error!, /from 不可解析/)
})

// ---------- 装配面（mountAgentCommTools） ----------
test('装配：四工具以协议 op 名裸注册（§5.3 agent 只见四个 op）+ 撞名防御', () => {
  assert.deepEqual(AGENT_COMM_TOOL_NAMES, ['dispatch', 'query', 'interrupt', 'inbox'])
  const registered: string[] = []
  const fakeTools = { register: (d: any) => { registered.push(d.name); return () => {} } }
  const ctx: any = {
    inject: (deps: string[], cb: (sub: any) => void) => {
      const sub: any = {}
      if (deps.includes('tools')) sub.tools = fakeTools
      if (deps.includes('sessionController')) sub.sessionController = { prompt() {}, cancel() {} }
      if (deps.includes('agents')) sub.agents = { get: () => undefined }
      cb(sub)
    },
    logger: { warn() {}, info() {} },
  }
  mountAgentCommTools(ctx, { url: 'http://x', scheme: null, kinds: null, get: async () => ({ ok: false, status: null, error: '' }), list: async () => ({ ok: false, error: '' }) })
  assert.deepEqual(registered.sort(), ['dispatch', 'inbox', 'interrupt', 'query'])
})
test('装配：ctx.tools 缺席宿主=不注册不炸（headless 防御面）', () => {
  const ctx: any = { logger: { warn() {}, info() {} } }
  assert.doesNotThrow(() => mountAgentCommTools(ctx, { url: '', scheme: null, kinds: null, get: async () => ({ ok: false, status: null, error: '' }), list: async () => ({ ok: false, error: '' }) }))
})
test('装配：inject 回调不供给 tools 面（tools 服务缺席宿主）=不注册', () => {
  const ctx: any = {
    inject: (deps: string[], cb: (sub: any) => void) => cb({}),
    logger: { warn() {}, info() {} },
  }
  mountAgentCommTools(ctx, { url: '', scheme: null, kinds: null, get: async () => ({ ok: false, status: null, error: '' }), list: async () => ({ ok: false, error: '' }) })
  assert.ok(true, '不抛错即过')
})
test('装配：撞名工具=warn+跳过其余 op（防御式注册）', () => {
  const registered: string[] = []
  const fakeTools = { register: (d: any) => { if (d.name === 'dispatch') throw new Error('duplicate tool name'); registered.push(d.name); return () => {} } }
  const ctx: any = {
    inject: (deps: string[], cb: (sub: any) => void) => {
      const sub: any = {}
      if (deps.includes('tools')) sub.tools = fakeTools
      if (deps.includes('sessionController')) sub.sessionController = { prompt() {}, cancel() {} }
      cb(sub)
    },
    logger: { warn() {}, info() {} },
  }
  mountAgentCommTools(ctx, { url: '', scheme: null, kinds: null, get: async () => ({ ok: false, status: null, error: '' }), list: async () => ({ ok: false, error: '' }) })
  assert.equal(registered.includes('dispatch'), false)
  assert.ok(registered.includes('query') && registered.includes('interrupt') && registered.includes('inbox'), '其余三 op 照常注册')
})

// ---------- bundle 静态面 ----------
test('bundle 静态面：src/index.ts 装配 agent-comm 四工具 + client 判别器零改动引用声明集', () => {
  const indexSrc = readFileSync(join(PLUGIN, 'src/index.ts'), 'utf8')
  assert.match(indexSrc, /mountAgentCommTools\(ctx, bridge\)/, 'apply 双分支装配 agent-comm')
  assert.match(indexSrc, /AGENT_COMM_KINDS/)
  const chatSrc = readFileSync(join(PLUGIN, 'client/console-chat.js'), 'utf8')
  assert.match(chatSrc, /declaredOpsOf/, 'E5a 判别器在册（op 名命中声明集→ConnectorOps 卡，零改动）')
})
