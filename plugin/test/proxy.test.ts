// proxy.test.ts —— E2 数据通路宿主侧验收：/core-console/api 只读代理
// （console-adoption.md §1.8 数据通路；R-PUB：无部署锚点，全注入）。
// E3 增：/core-console/apply 写路由（栅栏同款 fail-closed、方法分立 405、subject 宿主注入
// 剥除客户端声明、上游透传、503/502 口径）。
// 判据：鉴权栅栏 fail-closed（栅栏缺席=拒全部）、只放行 GET /v1/*、cored 未就绪 503、
// 状态码/载荷透传（双读一致面）、注册依赖软出现（headless 零影响）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSOLE_API_PREFIX, CONSOLE_APPLY_PATH, DEFAULT_APPLY_SUBJECT,
  createApplyHandler, createConsoleApiHandler, mountConsoleRoutes,
  CONSOLE_COMM_PATH, CONSOLE_DESIGN_DOCS_PATH, CONSOLE_INTAKE_PATH, CONSOLE_SERVICE_PROJECTS_PATH,
  createCommHandler, createCommState, createDesignDocsHandler, createIntakeHandler, createServiceProjectsHandler,
  createSessionHeartbeatHandler,
  type FetchLike, type HttpReqLike, type HttpResLike,
  CONSOLE_SESSION_HEARTBEAT_PATH,
} from '../src/index.ts'
import { makeErrorReply } from '../src/agent-comm.ts'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONSOLE_CHAT_UPLOAD_PATH, CONSOLE_CHAT_UPLOAD_ASSETS } from '../src/bridges/chatupload.ts'
import { CONSOLE_LEGACY_V2_PATH, CONSOLE_WEB_ASSETS_PREFIX, CONSOLE_CHAT_SEND_PATH, CONSOLE_CHAT_STOP_PATH, CONSOLE_CHATFACES_CLIENT_PATH, CONSOLE_EVENT_PUB_PATH,
  CONSOLE_CHAT_SESSIONS_PATH, CONSOLE_CHAT_CREATE_PATH, CONSOLE_CHAT_TRANSCRIPT_PATH, CONSOLE_CHAT_STATE_PATH } from '../src/config.ts'

function okFetch(body: unknown, status = 200): FetchLike & { calls: string[]; lastBody?: string } {
  const calls: string[] = []
  const impl = (async (input: string, init?: { method?: string; body?: string }) => {
    calls.push(input)
    ;(impl as any).lastBody = init?.body
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
  }) as FetchLike & { calls: string[]; lastBody?: string }
  impl.calls = calls
  return impl
}

function makeRes(): HttpResLike & { body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  return {
    statusCode: 0, headers,
    setHeader(n: string, v: string) { headers[n] = v },
    end(b?: string) { this.body = b ?? '' },
    body: '',
  }
}

test('代理放行 GET /v1/*：上游 URL 拼接 + 状态码/content-type/no-store 透传', async () => {
  const f = okFetch({ count: 0, events: [] })
  const res = makeRes()
  await createConsoleApiHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: f })(
    { method: 'GET', url: CONSOLE_API_PREFIX + '/v1/events?limit=5', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(f.calls, ['http://127.0.0.1:9/v1/events?limit=5'])
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.match(res.body, /"count":0/)
})

test('代理只放行 /v1/ 前缀：非 v1 → 404；路径穿越 → 404；非 GET → 405（allow: GET）', async () => {
  const h = createConsoleApiHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}) })
  const r1 = makeRes()
  await h({ method: 'GET', url: CONSOLE_API_PREFIX + '/healthz', headers: {} }, r1)
  assert.equal(r1.statusCode, 404)
  const r2 = makeRes()
  await h({ method: 'GET', url: CONSOLE_API_PREFIX + '/v1/../etc', headers: {} }, r2)
  assert.equal(r2.statusCode, 404)
  const r3 = makeRes()
  await h({ method: 'POST', url: CONSOLE_API_PREFIX + '/v1/apply', headers: {} }, r3)
  assert.equal(r3.statusCode, 405)
})

test('鉴权栅栏 fail-closed：401/403 透传；栅栏抛缺=拒绝全部（不降级为无鉴权转发）', async () => {
  const f = okFetch({ ok: true })
  const h401 = createConsoleApiHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => 401, fetchImpl: f })
  const r = makeRes()
  await h401({ method: 'GET', url: CONSOLE_API_PREFIX + '/v1/scheme', headers: {} }, r)
  assert.equal(r.statusCode, 401)
  assert.deepEqual(f.calls, [], '被拒请求不得触达上游')
  // 栅栏 undefined=放行（connection 装配正常的宿主）
  const hok = createConsoleApiHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined, fetchImpl: f })
  const r2 = makeRes()
  await hok({ method: 'GET', url: CONSOLE_API_PREFIX + '/v1/scheme', headers: {} }, r2)
  assert.equal(r2.statusCode, 200)
})

test('cored 未就绪=503；上游不可达=502（读面关断口径，不冒充 404）', async () => {
  const h = createConsoleApiHandler({ bridge: { url: '' }, fetchImpl: okFetch({}) })
  const r = makeRes()
  await h({ method: 'GET', url: CONSOLE_API_PREFIX + '/v1/scheme', headers: {} }, r)
  assert.equal(r.statusCode, 503)
  const failing: FetchLike = (async () => { throw new Error('ECONNREFUSED') }) as FetchLike
  const h2 = createConsoleApiHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: failing })
  const r2 = makeRes()
  await h2({ method: 'GET', url: CONSOLE_API_PREFIX + '/v1/scheme', headers: {} }, r2)
  assert.equal(r2.statusCode, 502)
})

test('mountConsoleRoutes：webServer+connection 在场=读代理 prefix + Apply exact 成对注册；缺席=不注册（headless 软出现）', () => {
  // console-web 产物经 env 指路（hermetic——不依赖 submodule 是否 checkout）；
  // 默认入口壳页 exact + v2 兼容 302 + assets prefix 注册于队尾。
  const dist = mkdtempSync(join(tmpdir(), 'proxy-v2-'))
  writeFileSync(join(dist, 'console.js'), '/* t */')
  writeFileSync(join(dist, 'console.css'), '/* t */')
  process.env.CORE_CONSOLE_WEB_DIST = dist
  const registered: { kind: string; path: string }[] = []
  let disposed = 0
  mountConsoleRoutes({
    inject(_deps, apply) {
      // 两条 inject（sessionController 对话面 + webServer 路由面）逐条驱动——与宿主注入语义一致
      const sub: Record<string, unknown> = {
        webServer: { register: (route: { kind: string; path: string }) => { registered.push(route); return () => { disposed++ } } },
        connection: { requestRejection: () => undefined },
        sessionController: { prompt: async () => ({}) },
      }
      const d = apply(sub)
      if (_deps[0] === 'webServer') assert.equal(typeof d, 'function', '路由面注册 disposer 应随插件退场返回')
    },
  }, { url: 'http://127.0.0.1:9/' })
  assert.deepEqual(registered.map((r) => [r.kind, r.path]), [
    ['prefix', CONSOLE_API_PREFIX],
    ['exact', CONSOLE_APPLY_PATH],
    ['prefix', CONSOLE_DRAFTS_PATH],
    ['prefix', CONSOLE_DESIGN_DOCS_PATH],
    ['prefix', CONSOLE_INTAKE_PATH],
    ['exact', CONSOLE_SESSION_HEARTBEAT_PATH],
    ['exact', CONSOLE_SERVICE_PROJECTS_PATH],
    ['exact', CONSOLE_CHAT_SEND_PATH],
    ['exact', CONSOLE_CHATFACES_CLIENT_PATH],
    ['exact', CONSOLE_CHAT_STOP_PATH],
    ['exact', CONSOLE_CHAT_UPLOAD_PATH],
    ['prefix', CONSOLE_CHAT_UPLOAD_ASSETS],
    ['exact', CONSOLE_EVENT_PUB_PATH],
    ['exact', CONSOLE_CHAT_SESSIONS_PATH],
    ['exact', CONSOLE_CHAT_TRANSCRIPT_PATH],
    ['exact', CONSOLE_CHAT_STATE_PATH],
    ['exact', CONSOLE_CHAT_CREATE_PATH],
    ['exact', '/core-console'],
    ['exact', '/core-console/'],
    ['exact', CONSOLE_LEGACY_V2_PATH],
    ['exact', CONSOLE_LEGACY_V2_PATH + '/'],
    ['prefix', CONSOLE_WEB_ASSETS_PREFIX],
  ], '读代理（prefix）+ Apply 写路由（exact）+ 草稿路由（prefix，E4）+ 设计文档路由（prefix，v0.52 能力 A）+ 对话录入路由（prefix，v0.53 能力 D）+ 会话活性心跳注册（exact，v0.54 KI-003）+ Service project 映射（exact，能力 C）+ 自有对话面转录桥四路由+chat-stop（sessions/transcript/state/create/stop）+ 控制台 Web 默认入口（exact×2 公开壳 + v2 兼容 302×2 + assets prefix）成套注册')
  assert.equal(disposed, 0)
  delete process.env.CORE_CONSOLE_WEB_DIST

  // 依赖缺席（headless）：回调体不注册、不抛错
  let called = false
  mountConsoleRoutes({
    inject(_deps, apply) {
      called = true
      apply({}) // Reflect.get 均缺席
    },
  }, { url: '' })
  assert.ok(called, 'inject 回调仍被驱动（软出现=依赖缺席时无害空转）')
})

// ─────── v0.54 KI-003：/core-console/session-heartbeat 心跳注册通路 ───────

test('createSessionHeartbeatHandler：栅栏 fail-closed ∧ 非 POST=405 ∧ subject 宿主注入剥客户端声明 ∧ 上游透传 /v1/sessions/heartbeat', async () => {
  const allow = () => undefined as 401 | 403 | undefined
  let seenUrl = ''
  let seenBody = ''
  const h = createSessionHeartbeatHandler({
    bridge: { url: 'http://127.0.0.1:9/' },
    reject: allow,
    subject: DEFAULT_APPLY_SUBJECT,
    fetchImpl: (async (url: any, init: any) => {
      seenUrl = String(url)
      seenBody = String(init?.body ?? '')
      return new Response('{"ok":true,"sessionId":"s1"}', { status: 200 })
    }) as FetchLike,
  })
  const res = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await h(
    { method: 'POST', url: CONSOLE_SESSION_HEARTBEAT_PATH, headers: {}, body: JSON.stringify({ sessionId: 's1', phase: 'tool-call', subject: { user: 'spoofed' } }) },
    res,
  )
  assert.equal(res.statusCode, 200, '受理=200 透传')
  assert.ok(seenUrl.endsWith('/v1/sessions/heartbeat'), '上游路径=/v1/sessions/heartbeat')
  const up = JSON.parse(seenBody)
  assert.equal(up.sessionId, 's1')
  assert.ok(up.subject && !up.subject.user.includes('spoofed'), '客户端 subject 声明剥除，宿主主体注入')
  // 非 POST=405
  const res405 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await h({ method: 'GET', url: CONSOLE_SESSION_HEARTBEAT_PATH, headers: {}, body: '' }, res405)
  assert.equal(res405.statusCode, 405, '非 POST=405')
  // 栅栏拒绝=403
  const hDenied = createSessionHeartbeatHandler({
    bridge: { url: 'http://127.0.0.1:9/' }, reject: () => 403, subject: DEFAULT_APPLY_SUBJECT,
    fetchImpl: (async () => new Response('{}', { status: 200 })) as FetchLike,
  })
  const res403 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await hDenied({ method: 'POST', url: CONSOLE_SESSION_HEARTBEAT_PATH, headers: {}, body: '{}' }, res403)
  assert.equal(res403.statusCode, 403, '栅栏拒绝=403（fail-closed）')
})

// ─────── E3：/core-console/apply 写路由（console-adoption.md §1.9）───────

function postRes(): HttpResLike {
  return { statusCode: 0, setHeader() {}, end() {} }
}

test('createApplyHandler：栅栏 fail-closed ∧ 非 POST=405 ∧ 未就绪=503 ∧ 体不可解析=400', async () => {
  const allow = () => undefined as 401 | 403 | undefined
  const h = createApplyHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: allow, subject: DEFAULT_APPLY_SUBJECT })
  // 栅栏拒绝（403）
  const hDenied = createApplyHandler({
    bridge: { url: 'http://127.0.0.1:9/' }, reject: () => 403, subject: DEFAULT_APPLY_SUBJECT,
  })
  let r = postRes()
  await hDenied({ method: 'POST', headers: {} }, r)
  assert.equal(r.statusCode, 403)
  // 栅栏缺席=fail-closed（拒绝全部）
  const hNoGate = createApplyHandler({ bridge: { url: 'http://127.0.0.1:9/' }, subject: DEFAULT_APPLY_SUBJECT })
  r = postRes()
  await hNoGate({ method: 'POST', headers: {} }, r)
  assert.equal(r.statusCode, 401, '无栅栏=拒绝全部（fail-closed 同读代理口径）')
  // 非 POST=405（写路由方法分立）
  r = postRes()
  await h({ method: 'GET', headers: {} }, r)
  assert.equal(r.statusCode, 405)
  // 未就绪=503
  const hDown = createApplyHandler({ bridge: { url: '' }, reject: allow, subject: DEFAULT_APPLY_SUBJECT })
  r = postRes()
  await hDown({ method: 'POST', headers: {}, body: '{}' }, r)
  assert.equal(r.statusCode, 503)
  // 体不可解析=400
  const hBad = createApplyHandler({
    bridge: { url: 'http://127.0.0.1:9/' }, reject: allow,
    fetchImpl: (async () => { throw new Error('不应转发') }) as FetchLike,
    subject: DEFAULT_APPLY_SUBJECT,
  })
  r = postRes()
  await hBad({ method: 'POST', headers: {}, body: '{oops' }, r)
  assert.equal(r.statusCode, 400)
})

test('createApplyHandler：subject 宿主注入（剥客户端声明）∧ 上游透传 rv/action', async () => {
  let captured: { url: string; init?: { body?: string } } | null = null
  const ok: FetchLike = (async (url: string, init?: { body?: string }) => {
    captured = { url, init }
    return { ok: true, status: 200, json: async () => ({}), text: async () => JSON.stringify({ rv: 2, action: 'update' }) }
  }) as FetchLike
  const h = createApplyHandler({
    bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined as 401 | 403 | undefined, fetchImpl: ok,
    subject: { user: 'console-probe', roles: ['role/global/admin'] },
  })
  let r = postRes()
  await h({
    method: 'POST', headers: {},
    body: JSON.stringify({ kind: 'Workflow', scope: 's1', name: 'dev-delivery', resourceVersion: 1, fieldManager: 'console:apply', content: 'spec: {enabled: false}\n', subject: { user: 'spoof' } }),
  }, r)
  assert.equal(r.statusCode, 200)
  assert.ok(captured!.url.endsWith('/v1/apply'))
  const sent = JSON.parse(captured!.init!.body!)
  assert.equal(sent.subject.user, 'console-probe', '主体=宿主注入')
  assert.equal(sent.subject.user !== 'spoof', true, '客户端 subject 声明被剥除')
  assert.equal(sent.kind, 'Workflow')
})

// ── E4 草稿通道（console-adoption.md §1.10 写面）：POST 落稿 / DELETE 弃稿 ──
import { CONSOLE_DRAFTS_PATH, createDraftsHandler, DEFAULT_DRAFT_FIELD_MANAGER } from '../src/index.ts'

test('草稿落稿：POST exact 段转发 cored POST /v1/drafts；缺主=宿主补缺省 fieldManager', async () => {
  const f = okFetch({ kind: 'Rule', scope: 'global', name: 'r-1' })
  const res = makeRes()
  await createDraftsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined, fetchImpl: f })(
    { method: 'POST', url: CONSOLE_DRAFTS_PATH, headers: {},
      body: JSON.stringify({ kind: 'Rule', scope: 'global', name: 'r-1', content: 'apiVersion: core/v1\n', baseResourceVersion: 2 }) },
    res)
  assert.equal(res.statusCode, 200)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0], 'http://127.0.0.1:9/v1/drafts')
  const sent = JSON.parse((f as any).lastBody ?? '{}')
  assert.equal(sent.fieldManager, DEFAULT_DRAFT_FIELD_MANAGER, '客户端缺主=宿主补（无主稿 cored 400，宿主兜底保 UX）')
  assert.equal(sent.baseResourceVersion, 2)
})

test('草稿落稿：客户端自带 fieldManager 不被覆盖（溯源串客户端携——授权主体与草稿无关）', async () => {
  const f = okFetch({})
  const res = makeRes()
  await createDraftsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined, fetchImpl: f })(
    { method: 'POST', url: CONSOLE_DRAFTS_PATH, headers: {},
      body: JSON.stringify({ kind: 'Rule', scope: 'global', name: 'r-1', content: 'x', fieldManager: 'console:editor:manual' }) },
    res)
  assert.equal(res.statusCode, 200)
  const sent = JSON.parse((f as any).lastBody ?? '{}')
  assert.equal(sent.fieldManager, 'console:editor:manual')
})

test('草稿弃稿：DELETE 子路径转发 cored DELETE（kind/name+scope 查询串透传）；POST 子路径=405', async () => {
  const f = okFetch({})
  const h = createDraftsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined, fetchImpl: f })
  const res = makeRes()
  await h({ method: 'DELETE', url: CONSOLE_DRAFTS_PATH + '/Rule/r-1?scope=global', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(f.calls, ['http://127.0.0.1:9/v1/drafts/Rule/r-1?scope=global'])
  const res2 = makeRes()
  await h({ method: 'POST', url: CONSOLE_DRAFTS_PATH + '/Rule/r-1', headers: {} }, res2)
  assert.equal(res2.statusCode, 405)
  assert.equal(res2.headers['allow'], 'POST, DELETE')
})

test('草稿路由：栅栏缺席=401 拒全部；体不可解析=400；cored 未就绪=503；上游不可达=502', async () => {
  const hNoReject = createDraftsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}) })
  const r0 = makeRes()
  await hNoReject({ method: 'POST', url: CONSOLE_DRAFTS_PATH, headers: {}, body: '{}' }, r0)
  assert.equal(r0.statusCode, 401, '写面 fail-closed：reject 缺席=拒全部')
  const h = createDraftsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined, fetchImpl: okFetch({}) })
  const rBad = makeRes()
  await h({ method: 'POST', url: CONSOLE_DRAFTS_PATH, headers: {}, body: 'not-json{' }, rBad)
  assert.equal(rBad.statusCode, 400)
  const hNoBridge = createDraftsHandler({ bridge: { url: '' }, reject: () => undefined, fetchImpl: okFetch({}) })
  const r503 = makeRes()
  await hNoBridge({ method: 'POST', url: CONSOLE_DRAFTS_PATH, headers: {}, body: '{}' }, r503)
  assert.equal(r503.statusCode, 503)
  const errFetch = (async () => { throw new Error('conn refused') }) as unknown as FetchLike
  const hErr = createDraftsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined, fetchImpl: errFetch })
  const r502 = makeRes()
  await hErr({ method: 'POST', url: CONSOLE_DRAFTS_PATH, headers: {}, body: '{}' }, r502)
  assert.equal(r502.statusCode, 502)
})

test('草稿路由：路径穿越不触上游（URL 归一化吃掉 ..→落 exact 段 405）；GET exact 段=405', async () => {
  const f = okFetch({})
  const h = createDraftsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, reject: () => undefined, fetchImpl: f })
  const r1 = makeRes()
  await h({ method: 'DELETE', url: CONSOLE_DRAFTS_PATH + '/../etc', headers: {} }, r1)
  assert.equal(r1.statusCode, 405, '归一化后落 exact 段、DELETE 不符 → 405；穿越段永不转发上游')
  assert.equal(f.calls.length, 0)
  const r2 = makeRes()
  await h({ method: 'GET', url: CONSOLE_DRAFTS_PATH, headers: {} }, r2)
  assert.equal(r2.statusCode, 405)
  assert.equal(r2.headers['allow'], 'POST, DELETE')
})

// ---------- comm 读路由（E6：console-adoption.md §1.13 L42-04 静态面） ----------
test('comm 读路由：GET 200 载荷（ops/refs/journal/mailboxPending）∧ token 值永不出现 ∧ 双读一致', async () => {
  const state = createCommState()
  state.journal.record({ ts: '2026-11-25T00:00:00Z', op: 'dispatch', from: 'agent/a@global', to: 'agent/b@global', ok: false, envelopeId: 'e1', error: 'to 未注册', hasToken: true })
  state.mailbox.deliver(makeErrorReply({ from: 'agent/a@global', inReplyTo: 'e1', op: 'dispatch' }, '回执落账'))
  const h = createCommHandler({ state, reject: () => undefined })
  const r1 = makeRes()
  await h({ method: 'GET', url: '/core-console/comm', headers: {} }, r1)
  assert.equal(r1.statusCode, 200)
  const body = JSON.parse(r1.body)
  assert.deepEqual(body.ops, ['dispatch', 'query', 'interrupt', 'inbox'])
  assert.equal(body.journal.length, 1)
  assert.equal(body.journal[0].hasToken, true)
  assert.ok(!('token' in body.journal[0]), 'token 值永不出现（只有 hasToken 布尔）')
  assert.ok(body.mailboxPending['agent/a@global'] >= 1, 'mailbox pending 计数投影')
  const r2 = makeRes()
  await h({ method: 'GET', url: '/core-console/comm', headers: {} }, r2)
  assert.equal(r2.body, r1.body, '双读一致（幂等快照）')
})

test('comm 读路由：栅栏缺席=401 拒全部 ∧ 403 透传 ∧ 非 GET=405（allow: GET）', async () => {
  const state = createCommState()
  const noReject = createCommHandler({ state })
  const r1 = makeRes()
  await noReject({ method: 'GET', url: '/core-console/comm', headers: {} }, r1)
  assert.equal(r1.statusCode, 401, '栅栏缺席 fail-closed（apply 同款）')
  const r2 = makeRes()
  await createCommHandler({ state, reject: () => 403 })({ method: 'GET', url: '/core-console/comm', headers: {} }, r2)
  assert.equal(r2.statusCode, 403)
  const r3 = makeRes()
  await createCommHandler({ state, reject: () => undefined })({ method: 'POST', url: '/core-console/comm', headers: {} }, r3)
  assert.equal(r3.statusCode, 405)
  assert.equal(r3.headers.allow, 'GET')
})

// ─────── v0.52 能力 A：/core-console/design-docs 写路由（cored-bridge.md §2.4）───────

test('设计文档路由：apply 主体宿主注入剥除客户端声明；draft 缺主宿主补缺省；方法分立 405', async () => {
  const f = okFetch({ action: 'dry-run', sha: 'abc' })
  const res = makeRes()
  await createDesignDocsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: f, subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'POST', url: CONSOLE_DESIGN_DOCS_PATH, headers: {}, body: JSON.stringify({ repo: 'core_design', path: 'a.md', content: 'x', subject: { user: 'evil' } }) }, res)
  assert.equal(res.statusCode, 200)
  const sent = JSON.parse(String((f as any).lastBody))
  assert.equal(sent.subject.user, DEFAULT_APPLY_SUBJECT.user, '主体由宿主注入（客户端声明剥除）')
  assert.equal(f.calls[0], 'http://127.0.0.1:9/v1/design-docs/apply')

  const f2 = okFetch({ resource: 'DesignDoc/core_design/a.md', action: 'staged' })
  const res2 = makeRes()
  await createDesignDocsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: f2, subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'POST', url: CONSOLE_DESIGN_DOCS_PATH + '/draft', headers: {}, body: JSON.stringify({ repo: 'core_design', path: 'a.md', content: 'x' }) }, res2)
  assert.equal(res2.statusCode, 200)
  const sent2 = JSON.parse(String((f2 as any).lastBody))
  assert.equal(sent2.fieldManager, 'console:editor', '客户端缺主=宿主补缺省')
  assert.equal(f2.calls[0], 'http://127.0.0.1:9/v1/design-docs/draft')

  const f3 = okFetch({ resource: 'DesignDoc/core_design/a.md', action: 'discarded' })
  const res3 = makeRes()
  await createDesignDocsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: f3, subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'DELETE', url: CONSOLE_DESIGN_DOCS_PATH + '/draft/core_design/concepts/a.md', headers: {} }, res3)
  assert.equal(res3.statusCode, 200)
  assert.equal(f3.calls[0], 'http://127.0.0.1:9/v1/design-docs/draft/core_design/concepts/a.md')

  // 方法分立：exact 段 GET → 405；未知子路径 → 404。
  const res4 = makeRes()
  await createDesignDocsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}), subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'GET', url: CONSOLE_DESIGN_DOCS_PATH, headers: {} }, res4)
  assert.equal(res4.statusCode, 405)
  const res5 = makeRes()
  await createDesignDocsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}), subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'POST', url: CONSOLE_DESIGN_DOCS_PATH + '/nope', headers: {}, body: '{}' }, res5)
  assert.equal(res5.statusCode, 404)
  // 状态码透传：409 乐观锁 / 400 lint 照传。
  const f6 = okFetch({ error: '基线 sha 与仓内 HEAD 不一致', expected: 'a', current: 'b' }, 409)
  const res6 = makeRes()
  await createDesignDocsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: f6, subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'POST', url: CONSOLE_DESIGN_DOCS_PATH, headers: {}, body: '{}' }, res6)
  assert.equal(res6.statusCode, 409)
  assert.match(res6.body, /expected/)
})

test('设计文档路由：栅栏缺席 fail-closed 拒全部；cored 未就绪 503', async () => {
  const res = makeRes()
  await createDesignDocsHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}), subject: DEFAULT_APPLY_SUBJECT })(
    { method: 'POST', url: CONSOLE_DESIGN_DOCS_PATH, headers: {}, body: '{}' }, res)
  assert.equal(res.statusCode, 401)
  const res2 = makeRes()
  await createDesignDocsHandler({ bridge: { url: '' }, fetchImpl: okFetch({}), subject: DEFAULT_APPLY_SUBJECT,
    reject: () => undefined })(
    { method: 'POST', url: CONSOLE_DESIGN_DOCS_PATH, headers: {}, body: '{}' }, res2)
  assert.equal(res2.statusCode, 503)
})

// ─────── v0.53 能力 D：/core-console/intake 对话式录入与准入预检路由（cored-bridge.md §2.5）───────

test('对话录入路由：/turn 与 /generate 主体宿主注入剥除客户端声明；方法分立 405；栅栏缺席 fail-closed 401', async () => {
  const f1 = okFetch({ sessionId: 's1', ready: false, askingField: 'title' })
  const res1 = makeRes()
  await createIntakeHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: f1, subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'POST', url: CONSOLE_INTAKE_PATH + '/turn', headers: {}, body: JSON.stringify({ kind: 'Proposal', subject: { user: 'spoofed' } }) }, res1)
  assert.equal(res1.statusCode, 200)
  const sent1 = JSON.parse(String((f1 as any).lastBody))
  assert.equal(sent1.subject.user, DEFAULT_APPLY_SUBJECT.user, '主体由宿主注入（剥除客户端声明）')
  assert.equal(f1.calls[0], 'http://127.0.0.1:9/v1/intake/turn')

  const f2 = okFetch({ ok: true, sessionId: 's1', genVersion: 1 })
  const res2 = makeRes()
  await createIntakeHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: f2, subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'POST', url: CONSOLE_INTAKE_PATH + '/generate', headers: {}, body: JSON.stringify({ kind: 'Proposal', fields: {} }) }, res2)
  assert.equal(res2.statusCode, 200)
  assert.equal(f2.calls[0], 'http://127.0.0.1:9/v1/intake/generate')

  // GET → 405；未知子路径 → 404；栅栏缺席 → 401
  const res3 = makeRes()
  await createIntakeHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}), subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'GET', url: CONSOLE_INTAKE_PATH + '/turn', headers: {} }, res3)
  assert.equal(res3.statusCode, 405)

  const res4 = makeRes()
  await createIntakeHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}), subject: DEFAULT_APPLY_SUBJECT, reject: () => undefined })(
    { method: 'POST', url: CONSOLE_INTAKE_PATH + '/unknown', headers: {}, body: '{}' }, res4)
  assert.equal(res4.statusCode, 404)

  const res5 = makeRes()
  await createIntakeHandler({ bridge: { url: 'http://127.0.0.1:9/' }, fetchImpl: okFetch({}), subject: DEFAULT_APPLY_SUBJECT })(
    { method: 'POST', url: CONSOLE_INTAKE_PATH + '/turn', headers: {}, body: '{}' }, res5)
  assert.equal(res5.statusCode, 401)
})

test('Service project 路由：GET 从 cored ServiceDesc 投影；POST 只为已声明 Service 准备目录；越界/非法名=400；栅栏缺席=401', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-projects-'))
  const bridge = {
    url: 'http://127.0.0.1:9/',
    list: async () => ({ ok: true as const, data: [
      { kind: 'ServiceDesc', name: 'self-recursive-core', scope: 'systems/self-recursive-core', resourceVersion: 1 },
    ] }),
    get: async () => ({ ok: true as const, data: {
      kind: 'ServiceDesc', name: 'self-recursive-core', scope: 'systems/self-recursive-core', resourceVersion: 1,
      content: 'spec:\n  instances:\n    - {name: default, agents: [agent://core-headless]}\n',
    } }),
  }
  const h = createServiceProjectsHandler({ bridge: bridge as any, reject: () => undefined, root })
  const r1 = makeRes()
  await h({ method: 'GET', headers: {} }, r1)
  assert.equal(r1.statusCode, 200)
  const listed = JSON.parse(r1.body)
  assert.equal(listed.count, 1)
  assert.deepEqual(listed.services[0].agents, ['core-headless'])
  const r2 = makeRes()
  await h({ method: 'POST', headers: {}, body: JSON.stringify({ services: ['self-recursive-core'] }) }, r2)
  assert.equal(r2.statusCode, 200)
  const made = JSON.parse(r2.body)
  assert.equal(made.projects[0].service, 'self-recursive-core')
  assert.ok(existsSync(made.projects[0].path))
  const r3 = makeRes()
  await h({ method: 'POST', headers: {}, body: JSON.stringify({ services: ['../escape'] }) }, r3)
  assert.equal(r3.statusCode, 400, '非法 Service 名不得建目录')
  const noGate = createServiceProjectsHandler({ bridge: bridge as any, root })
  const r4 = makeRes()
  await noGate({ method: 'GET', headers: {} }, r4)
  assert.equal(r4.statusCode, 401)
  rmSync(root, { recursive: true, force: true })
})

// ─────── §19 R3：/core-console/event-pub（批闸/点火/取消白名单通路）───────
import { createEventPubHandler } from '../src/index.ts'

function pubRes(): HttpResLike {
  return { statusCode: 0, setHeader() {}, end() {} }
}

test('createEventPubHandler：白名单四类型 ∧ involved 三段强制 ∧ 透传 dedupKey/data ∧ origin 注入', async () => {
  const allow = () => undefined as 401 | 403 | undefined
  const seen: Array<{ url: string; body: string }> = []
  const h = createEventPubHandler({
    bridge: { url: 'http://127.0.0.1:9/' },
    reject: allow,
    subject: DEFAULT_APPLY_SUBJECT,
    fetchImpl: (async (url: any, init: any) => {
      seen.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response('{"id":"evt-1"}', { status: 200 })
    }) as FetchLike,
  })
  // 受理：ApprovalGranted（批闸信号——run 恢复的唯一人工通路）
  const r1 = pubRes()
  await h({ method: 'POST', url: CONSOLE_EVENT_PUB_PATH, headers: {}, body: JSON.stringify({ type: 'ApprovalGranted', involved: 'Workflow/global/core-workflow', dedupKey: 'd1', data: { note: 'ok' } }) }, r1)
  assert.equal(r1.statusCode, 200, '白名单类型受理')
  assert.ok(seen[0].url.endsWith('/v1/events'), '上游=/v1/events')
  const up1 = JSON.parse(seen[0].body)
  assert.equal(up1.type, 'ApprovalGranted')
  assert.equal(up1.involved, 'Workflow/global/core-workflow')
  assert.equal(up1.dedupKey, 'd1')
  assert.equal(up1.data.note, 'ok')
  assert.equal(up1.data.origin, 'console-ui', 'origin 注入')
  // 非白名单类型=400
  const r2 = pubRes()
  await h({ method: 'POST', url: CONSOLE_EVENT_PUB_PATH, headers: {}, body: JSON.stringify({ type: 'DocApplied', involved: 'Rule/global/x' }) }, r2)
  assert.equal(r2.statusCode, 400, '非白名单=400（防通用发射器）')
  // involved 非三段词形=400
  const r3 = pubRes()
  await h({ method: 'POST', url: CONSOLE_EVENT_PUB_PATH, headers: {}, body: JSON.stringify({ type: 'ApprovalGranted', involved: 'core-workflow' }) }, r3)
  assert.equal(r3.statusCode, 400, 'involved 词形强制（信号按锚寻径）')
  // 非 POST=405
  const r4 = pubRes()
  await h({ method: 'GET', url: CONSOLE_EVENT_PUB_PATH, headers: {}, body: '' }, r4)
  assert.equal(r4.statusCode, 405, '非 POST=405')
})

// ─────── 自有对话面转录桥（transcript.ts——sc.list/page/state/create 直调面）───────
import { createChatTranscriptReadHandler, createChatCreateHandler, projectTranscript, projectSessions } from '../src/index.ts'

const scFake = {
  list: async () => ({ items: [{ sessionId: 's-1', updatedAt: 1700000000000, running: true, blank: false, agentAvailable: true }, { sessionId: '' }, { sessionId: 's-blank', updatedAt: 1, running: false, blank: true, agentAvailable: true }] }),
  create: async () => ({ sessionId: 's-new' }),
  state: async () => ({ active: true, running: false, queue: null, pendingInput: [] }),
  page: async () => ({ cursor: 42, records: [
    { type: 'event', event: { type: 'user/message', seq: 7, time: 1700000001000, data: { id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } } },
    { type: 'event', event: { type: 'assistant/live-chunk', seq: 8, time: 1700000002000, data: {}, ignorable: true } },
    { type: 'event', event: { type: 'assistant/message', seq: 9, time: 1700000003000, data: { content: [{ type: 'text', text: 'done' }] } } },
  ] }),
}

test('transcript 读面：sessions 投影剥空 id ∧ transcript 剥 delta/ignorable 留渲染词形 ∧ state 透传 ∧ 缺 sc=503', async () => {
  const allow = () => undefined as 401 | 403 | undefined
  const deps = { sc: scFake as never }
  for (const [kind, path, want] of [
    ['sessions', CONSOLE_CHAT_SESSIONS_PATH, 'items'],
    ['transcript', CONSOLE_CHAT_TRANSCRIPT_PATH + '?sessionId=s-1', 'events'],
    ['state', CONSOLE_CHAT_STATE_PATH + '?sessionId=s-1', 'running'],
  ] as const) {
    let out = ''
    const res = { statusCode: 0, setHeader() {}, end(t?: string) { out = String(t ?? '') } } as unknown as HttpResLike
    const h = createChatTranscriptReadHandler({ deps, kind, reject: allow })
    await h({ method: 'GET', url: path, headers: {} }, res)
    assert.equal(res.statusCode, 200, kind + '=200')
    assert.ok(out.includes(want), kind + ' 载荷含 ' + want)
  }
  // transcript 投影：user/message+assistant/message 留、live-chunk ignorable 剥
  let out = ''
  const res = { statusCode: 0, setHeader() {}, end(t?: string) { out = String(t ?? '') } } as unknown as HttpResLike
  const h = createChatTranscriptReadHandler({ deps, kind: 'transcript', reject: allow })
  await h({ method: 'GET', url: CONSOLE_CHAT_TRANSCRIPT_PATH + '?sessionId=s-1', headers: {} }, res)
  const j = JSON.parse(out)
  assert.equal(j.events.length, 2, 'records 词形映射+delta/ignorable 剥除后=2')
  assert.equal(j.events[0].type, 'user/message')
  assert.equal(j.cursor, 42)
  // 非 GET=405；缺 sc=503
  const res405 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await h({ method: 'POST', url: CONSOLE_CHAT_TRANSCRIPT_PATH, headers: {} }, res405)
  assert.equal(res405.statusCode, 405)
  const hNoDeps = createChatTranscriptReadHandler({ deps: { sc: null }, kind: 'sessions', reject: allow })
  const res503 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await hNoDeps({ method: 'GET', url: CONSOLE_CHAT_SESSIONS_PATH, headers: {} }, res503)
  assert.equal(res503.statusCode, 503, 'sc 缺席=503 显式')
})

test('transcript 纯投影：projectTranscript/projectSessions 直测（零事件页/损坏页=诚实空词形）', () => {
  assert.deepEqual(projectTranscript(null), { cursor: undefined, events: [] })
  assert.deepEqual(projectTranscript({ events: 'x' }), { cursor: undefined, events: [] })
  const bad = projectTranscript({ cursor: 1, events: [{ type: 'event' }, { nope: 1 }] })
  assert.equal(bad.events?.length, 0)
  const sess = projectSessions({ items: [{ sessionId: 'a' }, 'junk', null] })
  assert.equal(sess.items?.length, 1)
})

test('chat-create：POST 受理回 sessionId ∧ 非 POST=405 ∧ 宿主空回执=502', async () => {
  const allow = () => undefined as 401 | 403 | undefined
  const h = createChatCreateHandler({ deps: { sc: scFake as never }, reject: allow })
  let out = ''
  const res = { statusCode: 0, setHeader() {}, end(t?: string) { out = String(t ?? '') } } as unknown as HttpResLike
  await h({ method: 'POST', url: CONSOLE_CHAT_CREATE_PATH, headers: {}, body: '{}' }, res)
  assert.equal(res.statusCode, 200)
  assert.ok(out.includes('s-new'))
  const res405 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await h({ method: 'GET', url: CONSOLE_CHAT_CREATE_PATH, headers: {} }, res405)
  assert.equal(res405.statusCode, 405)
  const hEmpty = createChatCreateHandler({ deps: { sc: { ...scFake, create: async () => ({}) } as never }, reject: allow })
  const res502 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await hEmpty({ method: 'POST', url: CONSOLE_CHAT_CREATE_PATH, headers: {}, body: '{}' }, res502)
  assert.equal(res502.statusCode, 502, '空 sessionId=502 不冒充创建')
})

// ─────── C 批通路扩展（chatfaces.ts chat-stop + mode;transcript.ts 活体投影）───────
import { createChatSendHandler, createChatStopHandler, projectLive, projectStateLive, type ChatFacesDeps } from '../src/index.ts'

test('C-01 chat-send：mode 透传（steer/queue 双词形如实落投）∧ 回执携 mode+requestId ∧ 非 POST=405 ∧ prompt 缺席=503', async () => {
  const allow = () => undefined as 401 | 403 | undefined
  const seen: { mode?: string; text?: string }[] = []
  const deps: ChatFacesDeps = { prompt: async (req) => { seen.push({ mode: req.mode, text: req.content[0]?.text }) } }
  const h = createChatSendHandler({ deps, reject: allow })
  let out = ''
  const res = { statusCode: 0, setHeader() {}, end(t?: string) { out = String(t ?? '') } } as unknown as HttpResLike
  await h({ method: 'POST', url: CONSOLE_CHAT_SEND_PATH, headers: {}, body: JSON.stringify({ sessionId: 's-9', text: '插话', mode: 'steer' }) }, res)
  assert.equal(res.statusCode, 200)
  const j = JSON.parse(out)
  assert.equal(j.mode, 'steer', '回执 mode=steer 如实回显')
  assert.ok(j.requestId, '回执 requestId 在册（C-05 销账锚）')
  assert.equal(seen[0]?.mode, 'steer')
  // 缺省 mode=queue（非 running 调用侧显式落 queue）
  const res2 = { statusCode: 0, setHeader() {}, end(t?: string) { out = String(t ?? '') } } as unknown as HttpResLike
  await h({ method: 'POST', url: CONSOLE_CHAT_SEND_PATH, headers: {}, body: JSON.stringify({ sessionId: 's-9', text: '排队' }) }, res2)
  assert.equal(seen[1]?.mode, 'queue', '缺省 mode=queue')
  // 非 POST=405；prompt 缺席=503
  const res405 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await h({ method: 'GET', url: CONSOLE_CHAT_SEND_PATH, headers: {} }, res405)
  assert.equal(res405.statusCode, 405)
  const hNo = createChatSendHandler({ deps: { prompt: null }, reject: allow })
  const res503 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await hNo({ method: 'POST', url: CONSOLE_CHAT_SEND_PATH, headers: {}, body: '{"sessionId":"s","text":"x"}' }, res503)
  assert.equal(res503.statusCode, 503)
})

test('C-02 chat-stop：cancel 真通路受理 ∧ cancel 缺席=503 显式缺席 ∧ 非 POST=405 ∧ sessionId 必填', async () => {
  const allow = () => undefined as 401 | 403 | undefined
  const stopped: string[] = []
  const h = createChatStopHandler({ deps: { prompt: null, cancel: (req) => { stopped.push(req.sessionId) } }, reject: allow })
  let out = ''
  const res = { statusCode: 0, setHeader() {}, end(t?: string) { out = String(t ?? '') } } as unknown as HttpResLike
  await h({ method: 'POST', url: CONSOLE_CHAT_STOP_PATH, headers: {}, body: JSON.stringify({ sessionId: 's-live' }) }, res)
  assert.equal(res.statusCode, 200, '停止受理=200')
  assert.ok(out.includes('"ok":true') && out.includes('s-live'))
  assert.deepEqual(stopped, ['s-live'])
  // cancel 面缺席=503（不冒充停止）
  const hNo = createChatStopHandler({ deps: { prompt: null, cancel: null }, reject: allow })
  const res503 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await hNo({ method: 'POST', url: CONSOLE_CHAT_STOP_PATH, headers: {}, body: '{"sessionId":"s"}' }, res503)
  assert.equal(res503.statusCode, 503, 'cancel 缺席=503 显式')
  // 非 POST=405；sessionId 缺席=400
  const hOk = createChatStopHandler({ deps: { prompt: null, cancel: () => undefined }, reject: allow })
  const res405 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await hOk({ method: 'GET', url: CONSOLE_CHAT_STOP_PATH, headers: {} }, res405)
  assert.equal(res405.statusCode, 405)
  const res400 = { statusCode: 0, setHeader() {}, end() {} } as unknown as HttpResLike
  await hOk({ method: 'POST', url: CONSOLE_CHAT_STOP_PATH, headers: {}, body: '{}' }, res400)
  assert.equal(res400.statusCode, 400)
})

test('C-03 projectLive/projectStateLive：尾事件 lastSeq ∧ 未闭合 tool/call=正在调用 ∧ steering/queued 分列', () => {
  // 未闭合 tool/call → currentTool 在册（活体行数据面）
  const live = projectLive([
    { seq: 1, type: 'user/message', time: 1, data: {} },
    { seq: 2, type: 'tool/call', time: 2, data: { callId: 'c1', name: 'read' } },
  ])
  assert.equal(live.lastSeq, 2)
  assert.equal(live.currentTool, 'read')
  assert.equal(live.currentToolSince, 2)
  // tool/result 闭合 → currentTool 退场
  const closed = projectLive([
    { seq: 1, type: 'tool/call', time: 1, data: { callId: 'c1', name: 'read' } },
    { seq: 2, type: 'tool/result', time: 3, data: { callId: 'c1' } },
  ])
  assert.equal(closed.currentTool, undefined)
  assert.equal(closed.lastSeq, 2)
  // 静止页=无 currentTool
  assert.deepEqual(projectLive([{ seq: 5, type: 'assistant/message', data: {} }]), { lastSeq: 5 })
  assert.deepEqual(projectLive([]), {})
  assert.deepEqual(projectLive(null), {})
  // queue 投影：steering 与 queued 分列计数
  assert.deepEqual(projectStateLive({ queue: [{ placement: 'steering' }, { placement: 'queued' }, { placement: 'queued' }] }),
    { queueDepth: 3, steerDepth: 1 })
  assert.deepEqual(projectStateLive({ queue: null }), {})
  assert.deepEqual(projectStateLive('x'), {})
})
