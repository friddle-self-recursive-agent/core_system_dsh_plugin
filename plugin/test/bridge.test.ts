// 桥单元测试：就绪行解析回归 + 持续查询句柄（假 HTTP 服务，零部署锚点）。
// 运行：node --test test/bridge.test.ts（Node ≥24 原生 strip-types）。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { parseReadyLine, createQueryHandle, default as apply } from '../src/index.ts'
import type { Config } from '../src/index.ts'

// ── 假 cored 读面：按 cored-bridge.md §2 载荷形状 canned ──────────────────
type Route = { test: (u: URL) => boolean; status: number; body: unknown }
function fakeServer(routes: Route[]): Promise<{ server: http.Server; url: string; seen: URL[] }> {
  return new Promise((resolve) => {
    const seen: URL[] = []
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x')
      seen.push(u)
      const hit = routes.find((r) => r.test(u))
      res.writeHead(hit?.status ?? 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(hit?.body ?? { error: 'not found' }))
    })
    server.listen(0, '127.0.0.1', () => {
      server.unref() // fetch(undici) keep-alive 连接不阻塞测试进程退出
      resolve({ server, url: `http://127.0.0.1:${(server.address() as any).port}`, seen })
    })
  })
}

const REF = { kind: 'Agent', name: 'fixture-agent', scope: 'global', resourceVersion: 1 }

test('parseReadyLine：基本行 + apply= 尾随令牌宽松容忍 + 非就绪行拒绝', () => {
  assert.deepEqual(parseReadyLine('CORED_READY addr=127.0.0.1:38001 scheme_version=core/v1 kinds=2'),
    { addr: '127.0.0.1:38001', schemeVersion: 'core/v1', kinds: 2 })
  assert.deepEqual(parseReadyLine('CORED_READY addr=127.0.0.1:38001 scheme_version=core/v1 kinds=2 apply=off'),
    { addr: '127.0.0.1:38001', schemeVersion: 'core/v1', kinds: 2 })
  assert.equal(parseReadyLine('CORED_READY addr=127.0.0.1:38001 scheme_version=core/v1 kinds=2 apply=on').kinds, 2)
  assert.equal(parseReadyLine('some random log line'), null)
  assert.equal(parseReadyLine('CORED_READY addr= scheme_version=x kinds=y'), null)
})

test('句柄 list：瘦引用投影 + scope 查询串透传', async () => {
  const { server, url, seen } = await fakeServer([
    { test: (u) => u.pathname === '/v1/objects/Agent', status: 200,
      body: { count: 1, kind: 'Agent', scope: 'global', objects: [REF] } },
  ])
  const h = createQueryHandle(url)
  const r = await h.list('Agent', 'global')
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.data, [REF])
  assert.equal(seen[0].searchParams.get('scope'), 'global')
  const noScope = await h.list('Agent')
  assert.equal(noScope.ok, true)
  assert.equal(seen[1].search, '') // scope 缺省=跨 scope 枚举，不带查询串
  server.close()
})

test('句柄 get：content 原文透传 + 路径段转义（不产生路径穿越）', async () => {
  const { server, url, seen } = await fakeServer([
    { test: (u) => u.pathname.startsWith('/v1/objects/Agent/'), status: 200,
      body: { ...REF, content: 'apiVersion: core/v1\nkind: Agent\n' } },
  ])
  const r = await createQueryHandle(url).get('Agent', 'global', 'fixture-agent')
  assert.equal(r.ok, true)
  if (r.ok) assert.match(r.data.content, /^apiVersion: core\/v1/)
  assert.equal(seen[0].searchParams.get('scope'), 'global')
  const weird = await createQueryHandle(url).get('Agent', 'global', 'a/b c')
  assert.equal(weird.ok, true) // 整段转义后仍是一个路径段，命中同一前缀路由
  assert.equal(seen[1].pathname, '/v1/objects/Agent/a%2Fb%20c')
  server.close()
})

test('句柄错误面：404 保留状态码 / 503 保留状态码 / 传输失败 status=null / 全程不抛错', async () => {
  const { server, url } = await fakeServer([
    { test: (u) => u.pathname.endsWith('/absent'), status: 404, body: { error: '对象不存在' } },
    { test: (u) => u.pathname === '/v1/objects/Agent', status: 503, body: { error: '对象存储未配置' } },
  ])
  const h = createQueryHandle(url)
  const miss = await h.get('Agent', 'global', 'absent')
  assert.deepEqual({ ok: miss.ok, status: miss.ok ? null : miss.status }, { ok: false, status: 404 })
  assert.match(miss.ok ? '' : miss.error, /对象不存在/)
  const unavail = await h.list('Agent')
  assert.deepEqual({ ok: unavail.ok, status: unavail.ok ? null : unavail.status }, { ok: false, status: 503 })
  const dead = await createQueryHandle('http://127.0.0.1:1').get('Agent', 'global', 'x')
  assert.deepEqual({ ok: dead.ok, status: dead.ok ? null : dead.status }, { ok: false, status: null })
  server.close()
})

test('apply()：coredUrl 路径挂 service（get/list 可调用）+ probe 填 scheme/kinds', async () => {
  const { server, url } = await fakeServer([
    { test: (u) => u.pathname === '/v1/scheme', status: 200,
      body: { apiVersion: 'core/v1', kind: 'Scheme', version: 'core/v1' } },
    { test: (u) => u.pathname === '/v1/scheme/kinds', status: 200,
      body: { count: 2, kinds: [{ kind: 'Scheme' }, { kind: 'Agent', name: 'Agent', storage: 'x' }] } },
    { test: (u) => u.pathname === '/v1/objects/Agent/fixture-agent', status: 200,
      body: { ...REF, content: 'metadata: {name: fixture-agent}' } },
  ])
  let provided: unknown = null
  const ctx = {
    provide: (_: string, v: unknown) => { provided = v },
    effect: (_: () => () => void, __?: string) => {},
    logger: { info() {}, warn() {}, error() {} },
  }
  await apply(ctx, { coredUrl: url } satisfies Config)
  const bridge = provided as any
  assert.equal(bridge.url, url)
  assert.equal(bridge.kinds?.length, 2)
  assert.equal(typeof bridge.get, 'function')
  assert.equal(typeof bridge.list, 'function')
  const r = await bridge.get('Agent', 'global', 'fixture-agent')
  assert.equal(r.ok, true)
  server.close()
})

test('apply()：无 scheme 无 coredUrl → 桥接不启动（不 provide）；空 url 句柄 ok=false 不抛错', async () => {
  let provided: unknown = null
  const ctx = {
    provide: (_: string, v: unknown) => { provided = v },
    effect: (_: () => () => void, __?: string) => {},
    logger: { info() {}, warn() {}, error() {} },
  }
  await apply(ctx, {}) // 无 scheme 无 url：仅 warn 返回
  assert.equal(provided, null)
  const empty = await createQueryHandle('').get('Agent', 'global', 'x')
  assert.equal(empty.ok, false)
  assert.ok(!empty.ok && empty.status === null)
})
