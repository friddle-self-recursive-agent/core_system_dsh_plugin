// routes/console-write.ts —— console 写通路 handler 族（E3/E4/v0.52/v0.53/v0.54；R-ENG-7 拆分，零语义变化）。
// 铁律：写路径唯一入口=cored POST /v1/apply 族（三步闸门零旁路）；主体由宿主注入
// （剥除客户端声明——写主体是宿主断言，浏览器不携带主体）；栅栏缺席=fail-closed 拒全部。
import {
  CONSOLE_DRAFTS_PATH, CONSOLE_DESIGN_DOCS_PATH, CONSOLE_INTAKE_PATH, DEFAULT_DRAFT_FIELD_MANAGER,
} from '../config.ts'
import { sendJson, readRequestBody, type FetchLike, type HttpReqLike, type HttpResLike, type ApplySubject } from '../http.ts'

/**
 * console Apply handler（E3 写通路，测试注入 fetch/bridge/reject 全独立）：
 *   浏览器 POST /core-console/apply → connection 鉴权栅栏 → cored POST <bridge.url>/v1/apply
 * 主体由宿主注入（opts.subject 覆写请求体任何 subject 声明——浏览器不携带主体，red line：
 * 主体注入属宿主行为）；非 POST=405（写路由方法分立）；栅栏缺席=fail-closed 拒全部；
 * cored 未就绪=503；上游不可达=502（与读代理同口径）；请求体不可解析=400。
 */
export function createApplyHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  subject: ApplySubject
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  return async function applyHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    // 写面 fail-closed（比读代理更严）：栅栏回调缺席=拒全部——写路由只在显式装配了鉴权
    // 栅栏的宿主上放行（读代理的 fail-closed 在装配层，写面在 handler 内再锁一道）。
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
    if ((req.method ?? 'GET') !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    // 请求体：JSON 对象必需；subject 一律由宿主注入（剥除客户端声明——写主体是宿主断言）。
    let parsed: Record<string, unknown>
    try {
      const bodyText = await readRequestBody(req)
      parsed = JSON.parse(bodyText || '{}')
    } catch {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    delete parsed.subject
    const upstream = { ...parsed, subject: opts.subject }
    let out: Awaited<ReturnType<FetchLike>>
    try {
      out = await fetchImpl(opts.bridge.url.replace(/\/+$/, '') + '/v1/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upstream),
      })
    } catch (e) {
      sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
      return
    }
    const text = await out.text()
    res.statusCode = out.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }
}

/**
 * console 草稿路由 handler（E4 写通路，测试注入 fetch/bridge/reject 全独立）：
 *   浏览器 POST /core-console/drafts            → cored POST /v1/drafts（落稿 upsert）
 *   浏览器 DELETE /core-console/drafts/{k}/{n}  → cored DELETE /v1/drafts/{k}/{n}?scope=（弃稿）
 * 栅栏缺席=fail-closed 拒全部（与 apply 路由同款 handler 内再锁一道）；方法/路径分立：
 * exact 段只收 POST、子路径只收 DELETE（其余 405 allow: POST,DELETE）；体不可解析=400；
 * cored 未就绪=503；上游不可达=502；状态码/载荷透传（404 无稿/400 无主或空稿照传）。
 */
export function createDraftsHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  fieldManager?: string
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const defaultFM = opts.fieldManager ?? DEFAULT_DRAFT_FIELD_MANAGER
  return async function draftsHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
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
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    const url = new URL(String(req.url ?? '/'), 'http://localhost')
    const rest = url.pathname.slice(CONSOLE_DRAFTS_PATH.length)
    const base = opts.bridge.url.replace(/\/+$/, '')
    if (rest === '' || rest === '/') {
      // 落稿 upsert（exact 段）：{kind,scope,name,content,fieldManager,reasonRef,baseResourceVersion}
      if ((req.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST, DELETE')
        res.end()
        return
      }
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse((await readRequestBody(req)) || '{}')
      } catch {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      if (!parsed.fieldManager) parsed.fieldManager = defaultFM // 客户端缺主=宿主补（无主稿 cored 400）
      let out: Awaited<ReturnType<FetchLike>>
      try {
        out = await fetchImpl(base + '/v1/drafts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed),
        })
      } catch (e) {
        sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
        return
      }
      const text = await out.text()
      res.statusCode = out.status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(text)
      return
    }
    // 弃稿（子路径）：DELETE /core-console/drafts/{kind}/{name}?scope=
    if ((req.method ?? 'GET') !== 'DELETE') {
      res.statusCode = 405
      res.setHeader('allow', 'POST, DELETE')
      res.end()
      return
    }
    if (rest.includes('..')) {
      sendJson(res, 404, { error: 'not found（路径穿越拒绝）' })
      return
    }
    let out: Awaited<ReturnType<FetchLike>>
    try {
      out = await fetchImpl(base + '/v1/drafts' + rest + url.search, { method: 'DELETE' })
    } catch (e) {
      sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
      return
    }
    const text = await out.text()
    res.statusCode = out.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }
}

/**
 * console 设计文档路由 handler（v0.52 能力 A 写通路，测试注入 fetch/bridge/reject 全独立）：
 *   浏览器 POST /core-console/design-docs            → cored POST /v1/design-docs/apply（dry-run/真落库）
 *   浏览器 POST /core-console/design-docs/draft      → cored POST /v1/design-docs/draft（落稿 upsert）
 *   浏览器 DELETE /core-console/design-docs/draft/…  → cored DELETE /v1/design-docs/draft/{repo}/{path...}
 * 栅栏缺席=fail-closed 拒全部（apply/drafts 路由同款 handler 内再锁一道）；方法/路径分立
 * （exact 段只收 POST /draft 子段收 POST+DELETE，其余 405 allow: POST,DELETE）；体不可解析
 * =400；cored 未就绪=503；上游不可达=502；apply 主体由宿主注入（浏览器不携带——写主体是宿主
 * 断言，与 /core-console/apply 同款剥除客户端声明）；状态码/载荷透传（403 白名单/400 lint/
 * 409 乐观锁照传——判据三件在 cored 侧）。
 */
export function createDesignDocsHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  subject: ApplySubject
  fieldManager?: string
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const defaultFM = opts.fieldManager ?? DEFAULT_DRAFT_FIELD_MANAGER
  return async function designDocsHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
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
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    const url = new URL(String(req.url ?? '/'), 'http://localhost')
    const rest = url.pathname.slice(CONSOLE_DESIGN_DOCS_PATH.length)
    const base = opts.bridge.url.replace(/\/+$/, '')
    const forward = async (upstreamPath: string, init: { method: string; body?: string }) => {
      let out: Awaited<ReturnType<FetchLike>>
      try {
        out = await fetchImpl(base + upstreamPath, {
          method: init.method,
          headers: { 'content-type': 'application/json' },
          ...(init.body !== undefined ? { body: init.body } : {}),
        })
      } catch (e) {
        sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
        return
      }
      const text = await out.text()
      res.statusCode = out.status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(text)
    }
    if (rest === '' || rest === '/') {
      // Apply（exact 段，主体宿主注入）：dry-run/真落库——三闸门（白名单/lint/乐观锁）+权限判定在 cored。
      if ((req.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST, DELETE')
        res.end()
        return
      }
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse((await readRequestBody(req)) || '{}')
      } catch {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      delete parsed.subject
      const upstream = { ...parsed, subject: opts.subject }
      await forward('/v1/design-docs/apply', { method: 'POST', body: JSON.stringify(upstream) })
      return
    }
    if (rest === '/draft') {
      // 落稿 upsert：客户端缺主=宿主补缺省（无主稿 cored 400）。
      if ((req.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST, DELETE')
        res.end()
        return
      }
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse((await readRequestBody(req)) || '{}')
      } catch {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      if (!parsed.fieldManager) parsed.fieldManager = defaultFM
      await forward('/v1/design-docs/draft', { method: 'POST', body: JSON.stringify(parsed) })
      return
    }
    if (rest.startsWith('/draft/')) {
      // 弃稿（子路径）：DELETE /core-console/design-docs/draft/{repo}/{path...}
      if ((req.method ?? 'GET') !== 'DELETE') {
        res.statusCode = 405
        res.setHeader('allow', 'POST, DELETE')
        res.end()
        return
      }
      if (rest.includes('..')) {
        sendJson(res, 404, { error: 'not found（路径穿越拒绝）' })
        return
      }
      await forward('/v1/design-docs/draft' + rest.slice('/draft'.length) + url.search, { method: 'DELETE' })
      return
    }
    res.statusCode = 404
    sendJson(res, 404, { error: 'not found（只收 apply 与 draft 子路径）' })
  }
}

/**
 * console 对话式录入与准入预检 handler（v0.53 能力 D + R-UX-1/R-UX-2；cored-bridge.md §2.5）：
 *   - POST /core-console/intake 或 /core-console/intake/turn → cored POST /v1/intake/turn
 *   - POST /core-console/intake/generate → cored POST /v1/intake/generate
 * 栅栏缺席=fail-closed 401；只收 POST（其余 405 allow: POST）；剥除客户端 subject 注入宿主 applySubject。
 */
export function createIntakeHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  subject: ApplySubject
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  return async function intakeHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
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
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    const url = new URL(String(req.url ?? '/'), 'http://localhost')
    const rest = url.pathname.slice(CONSOLE_INTAKE_PATH.length)
    let upstreamPath = ''
    if (rest === '' || rest === '/' || rest === '/turn') {
      upstreamPath = '/v1/intake/turn'
    } else if (rest === '/generate') {
      upstreamPath = '/v1/intake/generate'
    } else {
      sendJson(res, 404, { error: 'not found（只收 /turn 与 /generate 子路径）' })
      return
    }
    if ((req.method ?? 'GET') !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse((await readRequestBody(req)) || '{}')
    } catch {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    delete parsed.subject
    const upstream = { ...parsed, subject: opts.subject }
    const base = opts.bridge.url.replace(/\/+$/, '')
    let out: Awaited<ReturnType<FetchLike>>
    try {
      out = await fetchImpl(base + upstreamPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upstream),
      })
    } catch (e) {
      sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
      return
    }
    const text = await out.text()
    res.statusCode = out.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }
}

/** 会话活性心跳注册 handler（v0.54 KI-003，agent-session.md §8）：POST /core-console/session-heartbeat
 *   → cored POST /v1/sessions/heartbeat。会话推进点（相位推进/工具调用完成/产物落盘任一）
 *   上报心跳；主体宿主注入（心贴士：心跳是引擎活性数据不是文档写——但注册面随写面门控，
 *   主体同 apply 注入口径）；connection 栅栏 fail-closed 同款；非 POST=405。 */
export function createSessionHeartbeatHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  subject: ApplySubject
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  return async function sessionHeartbeatHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
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
    if ((req.method ?? 'GET') !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse((await readRequestBody(req)) || '{}')
    } catch {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    delete parsed.subject
    const upstream = { ...parsed, subject: opts.subject }
    const base = opts.bridge.url.replace(/\/+$/, '')
    let out: Awaited<ReturnType<FetchLike>>
    try {
      out = await fetchImpl(base + '/v1/sessions/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upstream),
      })
    } catch (e) {
      sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
      return
    }
    const text = await out.text()
    res.statusCode = out.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }
}

/** 事件注入通路（点火/批闸/取消族——浏览器 → cored /v1/events；宿主注入主体与 apply 同族）。
 * 白名单类型（§19 R3）：LoopRequested（点火）/ ApprovalGranted+ApprovalRejected（人工批闸——
 * run 闸锚挂起的恢复/终态信号，involved=Workflow 锚）/ TaskCancelRequested（卡住任务取消）。
 * involved 客户端携（信号按 involved 的 workflow/task 锚寻径——路径强制校验词形），
 * dedupKey/data 透传可选；其余类型一律 400——防浏览器变通用事件发射器。 */
export function createEventPubHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  subject: ApplySubject
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const ALLOWED = new Set(['LoopRequested', 'ApprovalGranted', 'ApprovalRejected', 'TaskCancelRequested'])
  const INVOLVED_RE = /^[A-Za-z][A-Za-z0-9]*\/[A-Za-z0-9_.-]*\/[A-Za-z0-9_.\-\u4e00-\u9fff]+$/
  return async function eventPubHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (!opts.reject) { res.statusCode = 401; res.end(); return }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
    if ((req.method ?? 'POST') !== 'POST') { res.statusCode = 405; res.setHeader('allow', 'POST'); res.end(); return }
    let body: Record<string, unknown>
    try { body = JSON.parse((await readRequestBody(req)) || '{}') as Record<string, unknown> } catch {
      res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end('{"error":"载荷不可解析"}'); return
    }
    const type = String(body.type ?? '')
    const involved = String(body.involved ?? '')
    const dedupKey = String(body.dedupKey ?? '')
    const run = Number(body.run) > 0 ? Math.trunc(Number(body.run)) : 0
    const data = (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ? body.data as Record<string, unknown> : {}
    if (!ALLOWED.has(type)) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: '类型不在白名单（LoopRequested/ApprovalGranted/ApprovalRejected/TaskCancelRequested）' })); return }
    if (!involved || !INVOLVED_RE.test(involved)) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'involved 须为 Kind/scope/name 三段词形（信号按锚寻径）' })); return }
    if (!opts.bridge.url) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'cored 未就绪' })); return }
    try {
      const up = await fetchImpl(opts.bridge.url.replace(/\/+$/, '') + '/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Core-Subject': JSON.stringify(opts.subject) },
        body: JSON.stringify({ type, involved, ...(dedupKey ? { dedupKey } : {}), ...(run > 0 ? { run } : {}), data: { origin: 'console-ui', ...data } }),
      })
      const text = await up.text()
      res.statusCode = up.status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(text)
    } catch (e) {
      res.statusCode = 502; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'cored 不可达: ' + String((e as Error)?.message ?? e) }))
    }
  }
}
