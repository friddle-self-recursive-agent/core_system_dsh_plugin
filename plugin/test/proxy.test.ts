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
  type FetchLike, type HttpReqLike, type HttpResLike,
} from '../src/index.ts'

function okFetch(body: unknown, status = 200): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const impl = (async (input: string) => {
    calls.push(input)
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
  }) as FetchLike & { calls: string[] }
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
  ], '读代理（prefix）与 Apply 写路由（exact）成对注册（E3）')
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
