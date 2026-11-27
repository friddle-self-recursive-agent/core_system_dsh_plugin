// bridges/task-sessions.ts —— Task→真实 dsh 会话映射（2026-11-27 用户要求：workflow 任务节点必须显示真实 session）。
// 旧 Task.status.agentSession 只是 taskId（spawn 桥的 sessionHint），不是 dsh sessionId；本桥从宿主
// sessionController 的真实 journal 反查 taskId 首次用户消息，返回 session-* 会话锚。
// GET /core-console/task-sessions?taskIds=scope/name,scope/name
//   → {items:[{taskId,sessionId,updatedAt,startedAt,running}]}
// 只读；fail-closed；扫描上限 200 会话×200 消息，结果 60s 缓存；找不到=空数组（不编造）。
import { sendJson, type HttpReqLike, type HttpResLike } from '../http.ts'
import { projectSessions, projectTranscript, type SessionControllerDeps } from './transcript.ts'

const MAX_SESSIONS = 200
const MAX_MESSAGES = 200
const CACHE_MS = 60_000

type TaskSessionRow = { taskId: string; sessionId: string; updatedAt: number | null; startedAt: number | null; running: boolean }
type CacheRow = { at: number; items: TaskSessionRow[] }

/** 从用户消息文本提取 taskId（任务卡词形：taskId: scope/name；兼容 Task: scope/name）。 */
export function taskIdsOfText(text: string): string[] {
  const out = new Set<string>()
  const s = String(text || '')
  for (const re of [/\btaskId\s*:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi, /\bTask\s*:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g]) {
    for (const m of s.matchAll(re)) out.add(m[1])
  }
  return [...out]
}

/** projectTranscript events → taskId+首条任务卡时刻（只认 user/message，工具输出/思考文本不算任务卡）。 */
export function taskMatchesOfEvents(events: unknown[]): Array<{ taskId: string; startedAt: number | null }> {
  const out = new Map<string, number | null>()
  for (const ev of (Array.isArray(events) ? events : [])) {
    const e = ev && typeof ev === 'object' ? ev as Record<string, unknown> : null
    if (!e || String(e.type || '') !== 'user/message') continue
    const data = (e.data && typeof e.data === 'object' ? e.data : Record<string, unknown>) as Record<string, unknown>
    const blocks = Array.isArray(data.content) ? data.content : []
    const at = typeof e.time === 'number' ? e.time : null
    for (const b of blocks) {
      if (b && typeof b === 'object' && String((b as Record<string, unknown>).type || '') === 'text') {
        for (const id of taskIdsOfText(String((b as Record<string, unknown>).text || ''))) {
          if (!out.has(id)) out.set(id, at)
        }
      }
    }
  }
  return [...out].map(([taskId, startedAt]) => ({ taskId, startedAt }))
}

/** 兼容纯集合投影（测试/其他消费面）。 */
export function taskIdsOfEvents(events: unknown[]): string[] {
  return taskMatchesOfEvents(events).map((x) => x.taskId)
}

export function createTaskSessionsHandler(opts: {
  deps: SessionControllerDeps
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  now?: () => number
  cache?: Map<string, CacheRow>
}) {
  const cache = opts.cache ?? new Map<string, CacheRow>()
  const now = opts.now ?? (() => Date.now())
  return async function taskSessionsHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (!opts.reject) { res.statusCode = 401; res.end(); return }
    const denial = opts.reject({ headers: req.headers })
    if (denial !== undefined) { res.statusCode = denial; res.end(); return }
    if ((req.method ?? 'GET') !== 'GET') { res.statusCode = 405; res.setHeader('allow', 'GET'); res.end(); return }
    if (!opts.deps.sc) { sendJson(res, 503, { error: '宿主 sessionController 未就绪（Task→session 映射显式缺席）' }); return }
    const u = new URL(String(req.url ?? '/'), 'http://local')
    const wanted = new Set(String(u.searchParams.get('taskIds') || '').split(',').map((x) => x.trim()).filter(Boolean))
    if (!wanted.size || wanted.size > 100) { sendJson(res, 400, { error: 'taskIds 必填（1..100 个 scope/name）' }); return }
    const key = [...wanted].sort().join(',')
    const hit = cache.get(key)
    if (hit && now() - hit.at < CACHE_MS) { sendJson(res, 200, { count: hit.items.length, items: hit.items }); return }
    const signal = AbortSignal.timeout(30_000)
    try {
      const listed = projectSessions(await opts.deps.sc.list({}, signal)).items || []
      const sessions = (listed as Array<Record<string, unknown>>)
        .filter((s) => s && typeof s.sessionId === 'string' && s.sessionId)
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
        .slice(0, MAX_SESSIONS)
      const items: TaskSessionRow[] = []
      const perTask = new Map<string, number>()
      for (const s of sessions) {
        const sid = String(s.sessionId || '')
        let matches: Array<{ taskId: string; startedAt: number | null }> = []
        try {
          const page = await opts.deps.sc.page({ address: { kind: 'session', sessionId: sid }, maxMessages: MAX_MESSAGES }, signal)
          matches = taskMatchesOfEvents(projectTranscript(page).events || [])
        } catch { /* 单会话读失败=跳过，不冒充无关联 */ }
        for (const m of matches) {
          if (!wanted.has(m.taskId)) continue
          const n = perTask.get(m.taskId) || 0
          if (n >= 5) continue // 每任务最多 5 个真实会话（重试/续跑），避免无界
          perTask.set(m.taskId, n + 1)
          items.push({
            taskId: m.taskId, sessionId: sid,
            updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : null,
            startedAt: m.startedAt, running: s.running === true,
          })
        }
      }
      cache.set(key, { at: now(), items })
      sendJson(res, 200, { count: items.length, items })
    } catch (e) {
      sendJson(res, 502, { error: 'Task→session 映射读失败: ' + String((e as Error)?.message || e) })
    }
  }
}
