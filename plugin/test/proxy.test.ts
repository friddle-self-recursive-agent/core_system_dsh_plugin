// proxy.test.ts —— E2 数据通路宿主侧验收：/core-console/api 只读代理
// （console-adoption.md §1.8 数据通路；R-PUB：无部署锚点，全注入）。
// 判据：鉴权栅栏 fail-closed（栅栏缺席=拒全部）、只放行 GET /v1/*、cored 未就绪 503、
// 状态码/载荷透传（双读一致面）、注册依赖软出现（headless 零影响）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSOLE_API_PREFIX, createConsoleApiHandler, mountConsoleProxy,
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

test('mountConsoleProxy：webServer+connection 在场=prefix 注册；缺席=不注册（headless 软出现）', () => {
  let registered: { kind: string; path: string } | null = null
  mountConsoleProxy({
    inject(_deps, apply) {
      const sub: Record<string, unknown> = {
        webServer: { register: (route: { kind: string; path: string }) => { registered = route; return () => {} } },
        connection: { requestRejection: () => undefined },
      }
      const d = apply(sub)
      assert.equal(typeof d, 'function', '注册 disposer 应随插件退场返回')
    },
  }, { url: 'http://127.0.0.1:9/' })
  assert.ok(registered)
  assert.equal(registered!.kind, 'prefix')
  assert.equal(registered!.path, CONSOLE_API_PREFIX)

  // 依赖缺席（headless）：回调体不注册、不抛错
  let called = false
  mountConsoleProxy({
    inject(_deps, apply) {
      called = true
      apply({}) // Reflect.get 均缺席
    },
  }, { url: '' })
  assert.ok(called, 'inject 回调仍被驱动（软出现=依赖缺席时无害空转）')
})
