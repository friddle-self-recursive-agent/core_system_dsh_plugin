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
  type FetchLike, type HttpReqLike, type HttpResLike,
} from '../src/index.ts'
import { makeErrorReply } from '../src/agent-comm.ts'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  const registered: { kind: string; path: string }[] = []
  let disposed = 0
  mountConsoleRoutes({
    inject(_deps, apply) {
      const sub: Record<string, unknown> = {
        webServer: { register: (route: { kind: string; path: string }) => { registered.push(route); return () => { disposed++ } } },
        connection: { requestRejection: () => undefined },
      }
      const d = apply(sub)
      assert.equal(typeof d, 'function', '注册 disposer 应随插件退场返回')
    },
  }, { url: 'http://127.0.0.1:9/' })
  assert.deepEqual(registered.map((r) => [r.kind, r.path]), [
    ['prefix', CONSOLE_API_PREFIX],
    ['exact', CONSOLE_APPLY_PATH],
    ['prefix', CONSOLE_DRAFTS_PATH],
    ['prefix', CONSOLE_DESIGN_DOCS_PATH],
    ['prefix', CONSOLE_INTAKE_PATH],
    ['exact', CONSOLE_SERVICE_PROJECTS_PATH],
  ], '读代理（prefix）+ Apply 写路由（exact）+ 草稿路由（prefix，E4）+ 设计文档路由（prefix，v0.52 能力 A）+ 对话录入路由（prefix，v0.53 能力 D）+ Service project 映射（exact，能力 C）成套注册')
  assert.equal(disposed, 0)

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
