// agent-comm 四 op 工具面（console v2 E5b；cross-agent.md §5 协议 v0.1）。
// 定位：本文件是 core plugin 对 dsh 宿主工具面的贡献（ctx.tools.register 四工具），
// 不是 connector 驱动——R-ENG-3 归属裁决（2026-11-25 注记 rule.md）：工具宿主=plugin 仓本体。
// 协议边界（cross-agent.md §5 开篇）：Agent↔Agent 对等最小信封，无 session 机器；
// 与 agent-service-protocol（一意图一 session 的服务调用）不混用、不互译。
//
// v0.1 范围（§5.4 负债清单原样接受）：
//   - 传输=同机进程内注册表（ctx.agents 活体 + 文档面 Agent 对象解析）；跨机 typert 网关不在本面
//   - 失败=error reply（落 mailbox + 工具返回 error），不重试（§5.2 权限规则）
//   - payload 自由对象无 schema；inbox 侧容错（未知字段忽略不拒收）
//   - query=只读快照（§2 对齐表 query↔get/list；inject 通路=v0.2 declared 余量，不冒充）
//   - reply 非原语：v0.1 无独立 reply 工具——对端回复经其 SessionLog（§5.2 dispatch 回执两路之一），
//     error reply 由本面落账进 mailbox
import { randomUUID } from 'node:crypto'

/** 协议版本（恒 0.1；§5.1 信封字段 v）。 */
export const AGENT_COMM_VERSION = '0.1'

/** 四原语（§5.2；kind 枚举。reply 非原语，不在工具面）。 */
export const AGENT_COMM_KINDS = ['dispatch', 'query', 'interrupt', 'inbox'] as const
export type AgentCommKind = (typeof AGENT_COMM_KINDS)[number]

/** 单 agent 单 ref 的 mailbox 容量上限（FIFO 淘汰最旧；防无界增长）。 */
export const MAILBOX_CAPACITY = 50

/** agent ref：`agent/<name>@<scope>`（§5.1 from/to 格式）。 */
export interface AgentRef {
  name: string
  scope: string
}

/** envelope v0.1（§5.1 最小信封 + 可选 refs/token）。 */
export interface AgentCommEnvelope {
  v: string
  id: string
  ts: string
  from: string
  to: string
  kind: AgentCommKind
  payload: Record<string, unknown>
  refs?: string[]
  token?: string
}

/** UUID 任意版本（信封 id 只要求 uuid 形+幂等键语义；不锁 v4 也不锁大小写）。 */
export function isUuid(s: unknown): boolean {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/** RFC3339 日期时间（UTC 或带时区偏移；信封 ts）。 */
export function isRfc3339(s: unknown): boolean {
  if (typeof s !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(s)) return false
  return !Number.isNaN(Date.parse(s))
}

/** 解析 `agent/<name>@<scope>`；scope 不含 `@`（name/scope 段非空）。 */
export function parseAgentRef(s: unknown): AgentRef | null {
  if (typeof s !== 'string') return null
  const m = /^agent\/([^@\s]+)@([^\s@]+)$/.exec(s)
  return m ? { name: m[1], scope: m[2] } : null
}

/** ref 组串（parseAgentRef 逆运算）。 */
export function agentRefToString(ref: AgentRef): string {
  return `agent/${ref.name}@${ref.scope}`
}

/**
 * 信封校验（§5.1 全字段；错误逐条列出=机械可分支）。
 * 规则：v 恒 0.1；id=uuid（幂等键）；ts=RFC3339；from/to=agent ref 形；
 * kind∈四原语；payload=自由对象（必须 object，内容不校验）；refs 可选 string[]；
 * token：dispatch 必带（§5.2 权限规则——无 token 的 dispatch 一律拒绝），其余原语不强制。
 */
export function validateEnvelope(e: unknown): { ok: true; envelope: AgentCommEnvelope } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const o = (typeof e === 'object' && e !== null && !Array.isArray(e) ? e : {}) as Record<string, unknown>
  if (o.v !== AGENT_COMM_VERSION) errors.push(`v 必须为 "${AGENT_COMM_VERSION}"（收到 ${JSON.stringify(o.v ?? null)}）`)
  if (!isUuid(o.id)) errors.push('id 必须为 uuid（幂等键）')
  if (!isRfc3339(o.ts)) errors.push('ts 必须为 RFC3339 时间')
  if (!parseAgentRef(o.from)) errors.push('from 必须为 agent/<name>@<scope> 形')
  if (!parseAgentRef(o.to)) errors.push('to 必须为 agent/<name>@<scope> 形')
  const kind = o.kind
  if (typeof kind !== 'string' || !AGENT_COMM_KINDS.includes(kind as AgentCommKind)) {
    errors.push(`kind 必须为四原语之一：${AGENT_COMM_KINDS.join('|')}`)
  }
  const payload = o.payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    errors.push('payload 必须为对象（v0.1 自由对象不定 schema）')
  }
  if (o.refs !== undefined) {
    const refs = o.refs
    if (!Array.isArray(refs) || refs.some((r) => typeof r !== 'string')) errors.push('refs 必须为 string[]')
  }
  if (kind === 'dispatch' && (typeof o.token !== 'string' || o.token.length === 0)) {
    errors.push('dispatch 必须携带 token（§5.2：无 token 的 dispatch 一律拒绝）')
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    envelope: {
      v: AGENT_COMM_VERSION,
      id: o.id as string,
      ts: o.ts as string,
      from: o.from as string,
      to: o.to as string,
      kind: kind as AgentCommKind,
      payload: payload as Record<string, unknown>,
      ...(Array.isArray(o.refs) ? { refs: o.refs as string[] } : {}),
      ...(typeof o.token === 'string' ? { token: o.token } : {}),
    },
  }
}

/**
 * error reply（§5.2：失败也用信封——payload.error + Event，不自动重试）。
 * v0.1 落点=发起方 mailbox（进程内投递面失败回执，from=发起方自记——目标地址不可达时
 * 不存在可信接收方身份，不冒充）；to=发起方。inbox 原语拉取消费。
 */
export function makeErrorReply(base: { from: string; inReplyTo: string; op: AgentCommKind }, error: string): AgentCommEnvelope {
  return {
    v: AGENT_COMM_VERSION,
    id: randomUUID(),
    ts: new Date().toISOString(),
    from: base.from,
    to: base.from,
    kind: 'inbox',
    payload: { error, inReplyTo: base.inReplyTo, op: base.op },
  }
}

/**
 * 进程内 mailbox（v0.1 落账面）：error reply 按 to 归档，inbox 原语拉取消费。
 * 按 id 幂等去重（§5.1：inbox 按 id 去重）；容量 FIFO 淘汰。
 * v0.1 只有本面写 error reply——对端业务回复走 SessionLog（declared 余量，§5.2）。
 */
export class Mailbox {
  private boxes = new Map<string, AgentCommEnvelope[]>()
  private seen = new Set<string>()

  /** 落账一条信封（id 幂等：重复 id 忽略）。返回是否实际落账。 */
  deliver(env: AgentCommEnvelope): boolean {
    if (this.seen.has(env.id)) return false
    this.seen.add(env.id)
    let box = this.boxes.get(env.to)
    if (!box) { box = []; this.boxes.set(env.to, box) }
    box.push(env)
    while (box.length > MAILBOX_CAPACITY) {
      const dropped = box.shift()
      if (dropped) this.seen.delete(dropped.id) // 淘汰后同 id 可再落（容量语义优先于幂等记忆）
    }
    return true
  }

  /** 拉取消费：返回该 ref 的未消费信封（FIFO）并清空。 */
  drain(ref: string): AgentCommEnvelope[] {
    const box = this.boxes.get(ref)
    const out = box ? box.slice() : []
    if (box) box.length = 0
    return out
  }

  /** 只读快照（query/inbox 的计数展示；不清空）。 */
  peek(ref: string): readonly AgentCommEnvelope[] {
    return this.boxes.get(ref) ?? []
  }
}

/** to 解析结果（判别联合——机械可分支）。 */
export type ResolvedTarget =
  | { ok: true; ref: AgentRef; sessionId: string; live: boolean; docPhase: string | null }
  | { ok: false; error: string }

/** 文档面 Agent 对象最小投影（bridge.get 载荷 content=YAML 原文，此处只取结构化键）。 */
export interface AgentDocFacts {
  sessionId: string | null
  phase: string | null
}

/**
 * 从 Agent 文档面正文抽身份事实：status.currentSession.id（E5a console:chat-backfill 回填）
 * 或 spec.connectorOps 无关；agentRefs 的显式 `session://<id>` 形同样在册可解析（§1.11 归属三层证据①③）。
 * 正文是 YAML 文本——此处用行级正则抽取（不做 YAML 全解析：避免插件引依赖；抽不到=诚实 null）。
 */
export function extractAgentDocFacts(content: string): AgentDocFacts {
  const out: AgentDocFacts = { sessionId: null, phase: null }
  if (typeof content === 'string' && content.length > 0) {
    // 行级正则统一用 [ \t]（\s 会跨行吞换行——缩进锚错位）；[ \t]{2}=文档面两空格缩进约定。
    const cur = /^[ \t]{2}currentSession:[ \t]*$/m.exec(content)
    if (cur) {
      const rest = content.slice(cur.index + cur[0].length)
      const id = /^[ \t]*id:[ \t]*(\S+)/m.exec(rest)
      if (id && id[1] !== 'null' && id[1] !== '""') out.sessionId = id[1].replace(/^["']|["']$/g, '')
    }
    const sid = /session:\/\/([0-9a-f-]{16,})/i.exec(content)
    if (!out.sessionId && sid) out.sessionId = sid[1]
    const phase = /^[ \t]{2}phase:[ \t]*(\S+)/m.exec(content)
    if (phase) out.phase = phase[1].replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * to 解析（三步，§5.1「to 必须是已注册 agent（无服务发现，解析失败即拒）」+§5.7 #1：
 * 文档面地址→sessionId 解析落点=status.currentSession 回填）：
 *   ① ref 形校验（parseAgentRef）
 *   ② 文档面 Agent 对象在册（coreSystem.get('Agent', scope, name)）→ sessionId 抽取
 *   ③ 活体注册表可解析（agents.get(sessionId)）
 * 缺文档面=拒（未注册）；文档面在册但缺 sessionId=拒（无身份载体——§5.7 #1 身份=SessionId）；
 * 有 sessionId 但活体不在册=拒（同机注册表不可解析——§5.3 同机传输前提；跨机=v0.2 typert）。
 */
export async function resolveTarget(
  toRaw: unknown,
  core: { get(kind: string, scope: string, name: string): Promise<{ ok: boolean; status?: number | null; error?: string; data?: unknown }> },
  agents: { get(id: string): { id: string } | undefined } | undefined,
  opts: { requireLive?: boolean } = {},
): Promise<ResolvedTarget> {
  const requireLive = opts.requireLive !== false
  const ref = parseAgentRef(toRaw)
  if (!ref) return { ok: false, error: `to 必须为 agent/<name>@<scope> 形（收到 ${JSON.stringify(toRaw ?? null)}）` }
  const doc = await core.get('Agent', ref.scope, ref.name)
  if (!doc.ok) {
    return { ok: false, error: `to 未注册（文档面无 Agent/${ref.scope}/${ref.name}：${doc.error ?? `HTTP ${doc.status}`}）——agent-comm 无服务发现，解析失败即拒` }
  }
  const facts = extractAgentDocFacts((doc.data as { content?: string })?.content ?? '')
  if (!facts.sessionId) {
    return { ok: false, error: `Agent/${ref.scope}/${ref.name} 在册但无身份载体（status.currentSession.id 缺席）——先经 console 会话建立身份（§5.7 #1）` }
  }
  const live = agents ? agents.get(facts.sessionId) !== undefined : false
  if (requireLive && !live) {
    return { ok: false, error: `目标会话不在本进程活体注册表（sessionId=${facts.sessionId}）——同机传输前提不成立（跨机通道=v0.2 typert，§5.3）` }
  }
  return { ok: true, ref, sessionId: facts.sessionId, live, docPhase: facts.phase }
}

/** from 解析（调用者→ref）：exec.agent.id 反查文档面（status.currentSession.id 命中）；
 *  未回填身份的会话=诚实降级 `agent/<sessionId>@session`（可追溯，不冒充文档面身份）。 */
export async function resolveFrom(
  agentId: string | undefined,
  core: { list(kind: string): Promise<{ ok: boolean; data?: unknown }> },
): Promise<string | null> {
  if (!agentId) return null
  const refs = await core.list('Agent')
  if (refs.ok && Array.isArray(refs.data)) {
    for (const row of refs.data as { kind: string; name: string; scope: string }[]) {
      if (row.kind !== 'Agent') continue
      const doc = await core.get('Agent', row.scope, row.name)
      if (doc.ok) {
        const facts = extractAgentDocFacts((doc.data as { content?: string })?.content ?? '')
        if (facts.sessionId === agentId) return `agent/${row.name}@${row.scope}`
      }
    }
  }
  return `agent/${agentId}@session`
}

/** 工具返回（v0.1 全 op 同形：accepted/ok + envelope 回执或 error——机械可分支）。 */
export interface AgentCommResult {
  ok: boolean
  op: AgentCommKind
  envelopeId: string
  to: string
  /** dispatch=prompt 回执；query=快照载荷；interrupt=cancel 回执；inbox=信封列表 */
  detail?: Record<string, unknown>
  error?: string
}

/** 四 op 工具面的运行依赖（测试注入面；真实侧由装配层供给）。 */
export interface AgentCommDeps {
  /** cored 只读查询句柄（ctx.coreSystem——本插件自己 provide 的桥）。 */
  core: { get(kind: string, scope: string, name: string): Promise<{ ok: boolean; status?: number | null; error?: string; data?: unknown }>; list(kind: string): Promise<{ ok: boolean; data?: unknown }> }
  /** 同机活体注册表（ctx.agents；缺席宿主=解析必拒）。 */
  agents?: { get(id: string): { id: string } | undefined }
  /** 会话控制器 prompt 面（dispatch 真通路；缺席宿主=dispatch 拒）。 */
  prompt?: (req: { sessionId: string; requestId: string; mode: 'queue' | 'steer'; content: { type: 'text'; text: string }[] }) => Promise<unknown>
  /** 会话控制器 cancel 面（interrupt 真通路）。 */
  cancel?: (req: { sessionId: string }) => unknown
  /** 调用者 agent 身份（exec.agent?.id）。 */
  callerAgentId?: string
}

/** 四 op 分派核（工具 execute 共用：校验→from/to 解析→原语落点→回执；测试直注 deps）。 */
export async function executeAgentCommOp(kind: AgentCommKind, args: unknown, deps: AgentCommDeps, mailbox: Mailbox, envelopeId = randomUUID()): Promise<AgentCommResult> {
  // ① 组装并校验信封（工具参数 → envelope v0.1）
  const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
  const from = await resolveFrom(deps.callerAgentId, deps.core)
  if (!from) {
    const reply = makeErrorReply({ from, inReplyTo: envelopeId, op: kind }, 'from 不可解析（调用者非注册 agent 会话）——agent-comm 对等面信任已注册发起方')
    mailbox.deliver(reply)
    return { ok: false, op: kind, envelopeId, to: String(a.to ?? ''), error: 'from 不可解析（调用者非注册 agent 会话）' }
  }
  const draft: AgentCommEnvelope = {
    v: AGENT_COMM_VERSION,
    id: envelopeId,
    ts: new Date().toISOString(),
    from,
    to: String(a.to ?? ''),
    kind,
    payload: typeof a.payload === 'object' && a.payload !== null && !Array.isArray(a.payload)
      ? a.payload as Record<string, unknown>
      : {
          ...(a.text !== undefined ? { text: String(a.text) } : {}),
          ...(a.hint !== undefined ? { hint: String(a.hint) } : {}),
          ...(a.reason !== undefined ? { reason: String(a.reason) } : {}),
        },
    ...(Array.isArray(a.refs) ? { refs: (a.refs as unknown[]).map(String) } : {}),
    ...(typeof a.token === 'string' ? { token: a.token } : {}),
  }
  const check = validateEnvelope(draft)
  if (!check.ok) {
    const reply = makeErrorReply({ from, inReplyTo: envelopeId, op: kind }, `envelope 校验失败：${check.errors.join('；')}`)
    mailbox.deliver(reply)
    return { ok: false, op: kind, envelopeId, to: draft.to, error: `envelope 校验失败：${check.errors.join('；')}` }
  }
  const env = check.envelope
  // ② to 解析（inbox 豁免活体：拉取面对着自己/冷会话也要可用—— mailbox 落账不依赖活体）
  const target = await resolveTarget(env.to, deps.core, deps.agents, { requireLive: kind !== 'inbox' })
  if (!target.ok) {
    const reply = makeErrorReply({ from, inReplyTo: env.id, op: kind }, target.error)
    mailbox.deliver(reply)
    return { ok: false, op: kind, envelopeId: env.id, to: env.to, error: target.error }
  }
  // ③ 原语落点（§5.7 #4 对照）
  if (kind === 'dispatch') {
    if (!deps.prompt) {
      const reply = makeErrorReply({ from, inReplyTo: env.id, op: kind }, '宿主未装配会话控制器 prompt 面')
      mailbox.deliver(reply)
      return { ok: false, op: kind, envelopeId: env.id, to: env.to, error: '宿主未装配会话控制器 prompt 面' }
    }
    const text = String(env.payload.text ?? '')
    if (!text.trim()) {
      const reply = makeErrorReply({ from, inReplyTo: env.id, op: kind }, 'dispatch payload.text 必带（派任务一次意图）')
      mailbox.deliver(reply)
      return { ok: false, op: kind, envelopeId: env.id, to: env.to, error: 'dispatch payload.text 必带' }
    }
    try {
      await deps.prompt({
        sessionId: target.sessionId,
        requestId: randomUUID(),
        mode: 'queue', // dispatch=异步派任务（§5.2）↔ followup/delivery:queue
        content: [{ type: 'text', text: text + (env.payload.hint ? `\n\n（hint）${String(env.payload.hint)}` : '') }],
      })
      return { ok: true, op: kind, envelopeId: env.id, to: env.to, detail: { sessionId: target.sessionId, delivery: 'queue', accepted: true } }
    } catch (e) {
      const msg = `prompt 落投失败：${String((e as Error)?.message ?? e)}`
      mailbox.deliver(makeErrorReply({ from, inReplyTo: env.id, op: kind }, msg))
      return { ok: false, op: kind, envelopeId: env.id, to: env.to, error: msg }
    }
  }
  if (kind === 'query') {
    // 只读快照（§2 对齐表 query↔get/list；inject 通路=v0.2 余量）。同步返回=响应即回执。
    const live = deps.agents?.get(target.sessionId)
    let inbox = { nextTurn: 0, nextStep: 0 }
    if (live && typeof (live as any).inbox === 'object' && (live as any).inbox !== null) {
      const ib = (live as any).inbox
      inbox = { nextTurn: Array.isArray(ib.nextTurn) ? ib.nextTurn.length : 0, nextStep: Array.isArray(ib.nextStep) ? ib.nextStep.length : 0 }
    }
    const mailboxPending = mailbox.peek(env.to).length
    return {
      ok: true, op: kind, envelopeId: env.id, to: env.to,
      detail: {
        sessionId: target.sessionId,
        live: Boolean(live),
        docPhase: target.docPhase,
        status: live && typeof (live as any).status === 'string' ? (live as any).status : null,
        pendingInbox: inbox,
        mailboxPending,
        note: 'v0.1 query=只读快照（§2 对齐表）；对话式问询走 dispatch（SessionLog 承载回复）',
      },
    }
  }
  if (kind === 'interrupt') {
    if (!deps.cancel) {
      const reply = makeErrorReply({ from, inReplyTo: env.id, op: kind }, '宿主未装配会话控制器 cancel 面')
      mailbox.deliver(reply)
      return { ok: false, op: kind, envelopeId: env.id, to: env.to, error: '宿主未装配会话控制器 cancel 面' }
    }
    try {
      await deps.cancel({ sessionId: target.sessionId })
      return { ok: true, op: kind, envelopeId: env.id, to: env.to, detail: { sessionId: target.sessionId, cancelled: true } }
    } catch (e) {
      const msg = `cancel 落投失败：${String((e as Error)?.message ?? e)}`
      mailbox.deliver(makeErrorReply({ from, inReplyTo: env.id, op: kind }, msg))
      return { ok: false, op: kind, envelopeId: env.id, to: env.to, error: msg }
    }
  }
  // inbox：拉取消费（mailbox 落账）+ 活体 pending 投影（不消费 dsh inbox——那是目标 agent 的驱动队列）
  const drained = mailbox.drain(env.to)
  return {
    ok: true, op: kind, envelopeId: env.id, to: env.to,
    detail: { messages: drained, count: drained.length, sessionId: target.sessionId },
  }
}
