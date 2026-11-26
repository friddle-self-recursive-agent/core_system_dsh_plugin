// console-v2.test.ts —— web/ 新前端载体面验收（/core-console/v2 壳页 + assets 白名单静态面）：
// ① 壳页 200：BASES 代理词位预置（api/ws/apply/drafts 四词位）+ 容器 data-core-console 在册；
// ② assets 白名单双保险（console.js/css 200+正确 content-type；其他名 404；../ 遍历词形 404）；
// ③ 鉴权 fail-closed（栅栏缺席=401/被拒=403 透传）；④ 非 GET=405；⑤ 装配面：产物缺席
// （env 指向空目录）=零 v2 面（软出现）；产物在册=两路由注册+disposer 清理。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONSOLE_V2_PREFIX, CONSOLE_V2_ASSETS_PREFIX,
  createConsoleV2ShellHandler, createConsoleV2AssetHandler, mountConsoleV2, resolveWebDistDir, repoRoot,
} from '../src/routes/console-v2.ts'
import type { HttpReqLike, HttpResLike } from '../src/http.ts'

function fakeReqRes(url: string, method = 'GET', headers: Record<string, string> = {}): {
  req: HttpReqLike; res: HttpResLike & { body: string; done: boolean }
} {
  const res: HttpResLike & { body: string; done: boolean } = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { (this.headers as Record<string, string>)[k] = v },
    end(b?: unknown) { if (b !== undefined) this.body = String(b); this.done = true },
    body: '', done: false,
  } as never
  const req = { url, method, headers } as unknown as HttpReqLike
  return { req, res }
}

function makeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-v2-'))
  writeFileSync(join(dir, 'console.js'), '/* bundle */')
  writeFileSync(join(dir, 'console.css'), '/* css */')
  return dir
}

test('壳页 200：BASES 四词位+容器在册+no-store', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  const { req, res } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({ reject: () => undefined })(req, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /data-core-console/)
  assert.match(res.body, /__CORE_CONSOLE_BASES__/)
  assert.match(res.body, /'\/core-console\/api'/)
  assert.match(res.body, /\/core-console\/ws/)
  assert.match(res.body, /'\/core-console\/apply'/)
  assert.match(res.body, /'\/core-console\/drafts'/)
  assert.equal((res.headers as Record<string, string>)['cache-control'], 'no-store')
})

test('assets 白名单：js/css 200+ctype；其他名与遍历词形 404', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  const handler = createConsoleV2AssetHandler({ reject: () => undefined })
  for (const [name, ctype] of [['console.js', 'application/javascript'], ['console.css', 'text/css']] as const) {
    const { req, res } = fakeReqRes(CONSOLE_V2_ASSETS_PREFIX + name)
    handler(req, res)
    assert.equal(res.statusCode, 200, name)
    assert.match(String((res.headers as Record<string, string>)['content-type']), new RegExp('^' + ctype))
    assert.match(res.body, /\/\* /)
  }
  for (const bad of ['evil.js', 'console.js.map', '%2e%2e%2fconsole.js', 'console.js/extra']) {
    const { req, res } = fakeReqRes(CONSOLE_V2_ASSETS_PREFIX + bad)
    handler(req, res)
    assert.equal(res.statusCode, 404, bad)
  }
})

test('鉴权 fail-closed：栅栏缺席=401；被拒=403 透传；非 GET=405', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  const { req: r1, res: s1 } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({})(r1, s1) // 栅栏缺席=401 拒全部
  assert.equal(s1.statusCode, 401)
  const { req: r2, res: s2 } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({ reject: () => 401 })(r2, s2)
  assert.equal(s2.statusCode, 401)
  const { req: r2b, res: s2b } = fakeReqRes(CONSOLE_V2_ASSETS_PREFIX + 'console.js')
  createConsoleV2AssetHandler({ reject: () => 403 })(r2b, s2b)
  assert.equal(s2b.statusCode, 403)
  const { req: r3, res: s3 } = fakeReqRes(CONSOLE_V2_PREFIX, 'POST')
  createConsoleV2ShellHandler({ reject: () => undefined })(r3, s3)
  assert.equal(s3.statusCode, 405)
})

test('产物缺席=壳页 503 诚实词形', () => {
  const empty = mkdtempSync(join(tmpdir(), 'cc-v2-empty-'))
  process.env.CORE_CONSOLE_WEB_DIST = empty
  const { req, res } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({ reject: () => undefined })(req, res)
  assert.equal(res.statusCode, 503)
  assert.match(res.body, /产物缺席/)
})

test('装配面：产物在册=两路由注册+disposer；缺席=零注册', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  const registered: { kind: string; path: string }[] = []
  const disposers: Array<() => void> = []
  const webServer = { register(route: never) { registered.push(route as never); disposers.push(() => {}); return () => {} } }
  const un = mountConsoleV2(webServer as never, () => undefined)
  assert.equal(registered.length, 2)
  assert.deepEqual(registered.map((r) => r.path), [CONSOLE_V2_PREFIX, CONSOLE_V2_ASSETS_PREFIX])
  un.forEach((d) => d())
  const empty = mkdtempSync(join(tmpdir(), 'cc-v2-empty2-'))
  process.env.CORE_CONSOLE_WEB_DIST = empty
  assert.deepEqual(mountConsoleV2(webServer as never, () => undefined), [])
})

test('repoRoot 推导：以 import.meta.url 上溯三级=插件仓根', () => {
  assert.equal(repoRoot().endsWith('core_system_dsh_plugin'), true)
})

test('resolveWebDistDir 解析序：env 命中即返；缺席=null', () => {
  const dir = makeDist()
  process.env.CORE_CONSOLE_WEB_DIST = dir
  assert.equal(resolveWebDistDir(), join(dir))
  process.env.CORE_CONSOLE_WEB_DIST = join(tmpdir(), 'no-such-dist-xyz')
  assert.equal(resolveWebDistDir(), null)
  delete process.env.CORE_CONSOLE_WEB_DIST
  rmSync(dir, { recursive: true, force: true })
})
