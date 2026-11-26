// routes/comm-read.ts —— agent-comm 落账读面 handler（E6；R-ENG-7 拆分，零语义变化）：
//   浏览器 GET /core-console/comm → connection 鉴权栅栏 → 本进程 CommJournal+mailbox 快照（零上游请求）。
import { AGENT_COMM_KINDS } from '../agent-comm.ts'
import { sendJson, type HttpReqLike, type HttpResLike } from '../http.ts'
import type { CommState } from '../tools/agent-comm.ts'

/** 载荷投影（脱敏边界在此收口：journal 记录已不含 token 值；mailbox 信封若含 token 字段
 *  则整信封打码——v0.1 mailbox 只落 error reply 无 token，防御面照写）。 */
function commPayload(state: CommState) {
  const mailboxPending: Record<string, number> = {}
  const counts = state.journal.counts()
  const refs = state.journal.refs()
  for (const ref of new Set([...refs, ...state.journal.snapshot().map((r) => r.to)])) {
    const n = state.mailbox.peek(ref).length
    if (n > 0) mailboxPending[ref] = n
  }
  const journal = state.journal.snapshot().map((r) => ({
    ts: r.ts, op: r.op, from: r.from, to: r.to, ok: r.ok, envelopeId: r.envelopeId,
    ...(r.error ? { error: r.error } : {}),
    ...(r.sessionId ? { sessionId: r.sessionId } : {}),
    hasToken: r.hasToken === true,
  }))
  return {
    ops: [...AGENT_COMM_KINDS],
    counts,
    refs,
    mailboxPending,
    journal,
  }
}

/**
 * console agent-comm 读 handler（E6，测试注入 state/reject 全独立）：
 *   浏览器 GET /core-console/comm → connection 鉴权栅栏 → 本进程落账快照（零上游请求）。
 * 栅栏缺席=fail-closed 拒全部（apply 路由同款）；非 GET=405（allow: GET）。
 */
export function createCommHandler(opts: {
  state: CommState
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return function commHandler(req: HttpReqLike, res: HttpResLike): void {
    if (!opts.reject) {
      res.statusCode = 401
      res.end()
      return
    }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if ((req.method ?? 'GET') !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    sendJson(res, 200, commPayload(opts.state))
  }
}
