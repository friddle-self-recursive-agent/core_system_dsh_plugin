// bridges/transcript.ts —— 控制台自有对话面的宿主转录桥（2026-11-26 用户裁决：
// 「代码拷贝过来」不是 iframe 引 dsh 壳——控制台画自己的 DeepSeek 式对话界面，
// 数据从宿主 sessionController 的 Remote 面直读直写）。
//   GET  /core-console/chat-sessions  → sc.list()            会话清单（id/updated/running/blank）
//   POST /core-console/chat-create    → sc.create({cwd})     新会话（宿主发 id——界面零手填词形）
//   GET  /core-console/chat-transcript → sc.page({address…})  转录页（原始事件投影——
//       user/message|assistant/message|tool/call|tool/result|system|developer 词形；
//       ignorable/delta 噪声服务端剥除——传输面只留渲染面词形）
//   GET  /core-console/chat-state     → sc.state({sessionId}) 被动状态（running/queue/pendingInput）
// 红线：sc 为宿主注入（inject(['sessionController'])）；缺席=503 显式缺席不冒充；
// 读面只读（零写旁路）；转录面 fail-closed 同款栅栏。
import { sendJson, type HttpReqLike, type HttpResLike } from '../http.ts'

export interface SessionControllerDeps {
  sc: {
    list: (req: unknown, signal: AbortSignal) => Promise<{ items?: readonly unknown[] }>
    create: (req: unknown, signal: AbortSignal) => Promise<{ sessionId?: string }>
    state: (req: unknown, signal: AbortSignal) => Promise<unknown>
    page: (req: unknown, signal: AbortSignal) => Promise<unknown>
  } | null
}

/** 转录渲染面保留的事件词形（durable journal——dsh-client-ui-chat conversation-nodes 同族；
 * delta/live-chunk/ignorable 是过程噪声，控制台渲染面不要）。 */
const KEEP = new Set([
  'user/message', 'assistant/message', 'tool/call', 'tool/result',
  'system/message', 'developer/message', 'turn/start', 'turn/end', 'llm/retry',
])

/** 事件 → 渲染面词形（剥 surfaceOp/sourceEventSeqs/ignorable 包装；data 原样透传）。 */
export function projectTranscript(pageValue: unknown): { cursor?: number; events?: unknown[] } {
  const p = pageValue && typeof pageValue === 'object' ? pageValue as Record<string, unknown> : {}
  // SessionPage 词形=records（SessionEventEntry[]——types.ts §530；events 是请求侧词不是页词）
  const rows = (Array.isArray(p.records) ? p.records : (Array.isArray(p.events) ? p.events : [])) as Record<string, unknown>[]
  const events: unknown[] = []
  for (const row of rows) {
    const ev = row && typeof row === 'object' ? (row as Record<string, unknown>).event : null
    if (!ev || typeof ev !== 'object') continue
    const e = ev as Record<string, unknown>
    const type = String(e.type ?? '')
    if (!KEEP.has(type)) continue
    if (e.ignorable === true) continue
    events.push({ seq: e.seq, time: e.time, type, data: e.data ?? null })
  }
  return { cursor: typeof p.cursor === 'number' ? p.cursor : undefined, events }
}

/** 会话清单 → 渲染面词形（blank=可复用空白会话——「新会话」优先复用而非再造）。 */
export function projectSessions(value: unknown): { items?: unknown[] } {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const items = Array.isArray(v.items) ? v.items : []
  return { items: items.map((it) => {
    const s = it && typeof it === 'object' ? it as Record<string, unknown> : {}
    return {
      sessionId: String(s.sessionId ?? ''),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : null,
      running: s.running === true,
      blank: s.blank === true,
      agentAvailable: s.agentAvailable === true,
    }
  }).filter((x) => x.sessionId) }
}

function json<T>(req: HttpReqLike): T | null {
  try { return JSON.parse(String((req as { body?: unknown }).body ?? '{}')) as T } catch { return null }
}

/** 清单/转录/状态三读面（同一 sc 依赖——缺席=503）。 */
export function createChatTranscriptReadHandler(opts: {
  deps: SessionControllerDeps
  kind: 'sessions' | 'transcript' | 'state'
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return async function handler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (!opts.reject) { res.statusCode = 401; res.end(); return }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
    if ((req.method ?? 'GET') !== 'GET') { res.statusCode = 405; res.setHeader('allow', 'GET'); res.end(); return }
    if (!opts.deps.sc) { sendJson(res, 503, { error: '宿主 sessionController 未就绪（缺席=显式缺席，不冒充）' }); return }
    const u = new URL(req.url ?? '/', 'http://local')
    const signal = AbortSignal.timeout(10_000)
    try {
      if (opts.kind === 'sessions') {
        sendJson(res, 200, projectSessions(await opts.deps.sc.list({}, signal)))
        return
      }
      const sessionId = String(u.searchParams.get('sessionId') ?? '').trim()
      if (!sessionId) { sendJson(res, 400, { error: 'sessionId 必填' }); return }
      if (opts.kind === 'state') {
        sendJson(res, 200, await opts.deps.sc.state({ sessionId }, signal))
        return
      }
      const maxRaw = Number(u.searchParams.get('max') ?? '60')
      const max = Number.isFinite(maxRaw) && maxRaw > 0 && maxRaw <= 200 ? Math.floor(maxRaw) : 60
      const beforeRaw = Number(u.searchParams.get('beforeSeq') ?? '')
      const reqBody: Record<string, unknown> = {
        address: { kind: 'session', sessionId },
        maxMessages: max,
      }
      if (Number.isFinite(beforeRaw) && beforeRaw > 0) reqBody.beforeSeq = Math.floor(beforeRaw)
      sendJson(res, 200, projectTranscript(await opts.deps.sc.page(reqBody, signal)))
    } catch (e) {
      sendJson(res, 502, { error: '宿主转录面读失败: ' + String((e as Error)?.message ?? e) })
    }
  }
}

/** 新会话面（POST——宿主发 id；blank 复用由宿主裁决）。 */
export function createChatCreateHandler(opts: {
  deps: SessionControllerDeps
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return async function handler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (!opts.reject) { res.statusCode = 401; res.end(); return }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
    if ((req.method ?? 'POST') !== 'POST') { res.statusCode = 405; res.setHeader('allow', 'POST'); res.end(); return }
    if (!opts.deps.sc) { sendJson(res, 503, { error: '宿主 sessionController 未就绪' }); return }
    const body = json<{ cwd?: string }>(req)
    try {
      const v = await opts.deps.sc.create(body && body.cwd ? { cwd: String(body.cwd) } : {}, AbortSignal.timeout(10_000))
      if (!v || typeof v.sessionId !== 'string' || !v.sessionId) {
        sendJson(res, 502, { error: '宿主未返回 sessionId（不冒充创建）' })
        return
      }
      sendJson(res, 200, { sessionId: v.sessionId })
    } catch (e) {
      sendJson(res, 502, { error: '会话创建失败: ' + String((e as Error)?.message ?? e) })
    }
  }
}
