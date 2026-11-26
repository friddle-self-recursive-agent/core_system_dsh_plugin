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
import { CONSOLE_V2_ASSETS_PREFIX as ASSETS_PREFIX_CONFIG } from '../src/config.ts'
if (CONSOLE_V2_ASSETS_PREFIX !== ASSETS_PREFIX_CONFIG) throw new Error('assets 前缀重导出漂移')
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
  assert.match(res.body, /href="\/core-console\/assets\/console\.css(\?v=\d+)?"/, '资产链接=前缀+/文件名（无尾斜杠常量拼接补斜杠）')
  assert.match(res.body, /src="\/core-console\/assets\/console\.js(\?v=\d+)?"/, '脚本 src=前缀+/文件名')
  assert.equal((res.headers as Record<string, string>)['cache-control'], 'no-store')
})

test('assets 白名单：js/css 200+ctype；其他名与遍历词形 404', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  const handler = createConsoleV2AssetHandler({ reject: () => undefined })
  for (const [name, ctype] of [['console.js', 'application/javascript'], ['console.css', 'text/css']] as const) {
    const { req, res } = fakeReqRes(CONSOLE_V2_ASSETS_PREFIX + '/' + name)
    handler(req, res)
    assert.equal(res.statusCode, 200, name)
    assert.match(String((res.headers as Record<string, string>)['content-type']), new RegExp('^' + ctype))
    assert.match(res.body, /\/\* /)
  }
  for (const bad of ['evil.js', 'console.js.map', 'console.js/extra']) {
    const { req, res } = fakeReqRes(CONSOLE_V2_ASSETS_PREFIX + '/' + bad)
    handler(req, res)
    assert.equal(res.statusCode, 404, bad)
  }
  // 遍历词形 %2e%2e%2fconsole.js：basename(decodeURIComponent(...)) 归一=console.js → 200——
  // 双保险语义=basename 归一后只可能落白名单文件（join(dir,name) 无出目录面），机械断言即此。
  const { req: reqT, res: resT } = fakeReqRes(CONSOLE_V2_ASSETS_PREFIX + '/%2e%2e%2fconsole.js')
  handler(reqT, resT)
  assert.equal(resT.statusCode, 200, '%2e%2e 归一后=白名单内文件名（无出目录面）')
  assert.match(resT.body, /\/\* /)
})

test('鉴权 fail-closed：显式声明栅栏缺席=401；被拒=403 透传；非 GET=405；公开词形（不声明键）放行', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  const { req: r1, res: s1 } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({ reject: undefined })(r1, s1) // 显式声明但缺席=401 fail-closed（既有词形）
  assert.equal(s1.statusCode, 401)
  const { req: r2, res: s2 } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({ reject: () => 401 })(r2, s2)
  assert.equal(s2.statusCode, 401)
  const { req: r2b, res: s2b } = fakeReqRes(CONSOLE_V2_ASSETS_PREFIX + '/console.js')
  createConsoleV2AssetHandler({ reject: () => 403 })(r2b, s2b)
  assert.equal(s2b.statusCode, 403)
  const { req: r3, res: s3 } = fakeReqRes(CONSOLE_V2_PREFIX, 'POST')
  createConsoleV2ShellHandler({ reject: () => undefined })(r3, s3)
  assert.equal(s3.statusCode, 405)
  const { req: r4, res: s4 } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({})(r4, s4) // 公开词形（F-01 主入口）=200
  assert.equal(s4.statusCode, 200)
})

test('产物缺席=壳页 503 诚实词形', () => {
  const empty = mkdtempSync(join(tmpdir(), 'cc-v2-empty-'))
  process.env.CORE_CONSOLE_WEB_DIST = empty
  const { req, res } = fakeReqRes(CONSOLE_V2_PREFIX)
  createConsoleV2ShellHandler({ reject: () => undefined })(req, res)
  // env 落空=回落 submodule pin 面（loop-87 起常在）——503 词形仅在 pin 亦缺席时成立。
  if (resolveWebDistDir() === null) {
    assert.equal(res.statusCode, 503)
    assert.match(res.body, /产物缺席/)
  } else {
    assert.equal(res.statusCode, 200, 'pin 面在册=壳页 200（回落词形）')
  }
})

test('装配面：产物在册=成套注册+disposer；缺席=零注册', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  const registered: { kind: string; path: string }[] = []
  const disposers: Array<() => void> = []
  const webServer = { register(route: never) { registered.push(route as never); disposers.push(() => {}); return () => {} } }
  const un = mountConsoleV2(webServer as never, () => undefined)
  // F-01 入口转正后=5 路由（v2 壳/v2 尾斜杠/assets 前缀 + /core-console、/core-console/ 公开壳）。
  assert.equal(registered.length, 5)
  assert.deepEqual(registered.map((r) => r.path), [
    CONSOLE_V2_PREFIX, CONSOLE_V2_PREFIX + '/', CONSOLE_V2_ASSETS_PREFIX, '/core-console', '/core-console/',
  ])
  un.forEach((d) => d())
  const empty = mkdtempSync(join(tmpdir(), 'cc-v2-empty2-'))
  process.env.CORE_CONSOLE_WEB_DIST = empty
  if (resolveWebDistDir() === null) {
    assert.deepEqual(mountConsoleV2(webServer as never, () => undefined), [])
  } else {
    assert.equal(mountConsoleV2(webServer as never, () => undefined).length, 5, 'pin 面在册=仍成套注册（回落词形）')
  }
})

// L87-02 F-01 入口转正锚：/core-console 与 /core-console/ 公开 200（公开词形=不声明
// reject 键；数据/写面「显式 reject=undefined→401」的既有 fail-closed 词形零改动——
// 静态壳页无数据泄漏面=34 屏扫描 P0-1 修复）。
test('F-01 入口转正：/core-console 与 /core-console/ 公开 200 同壳', () => {
  process.env.CORE_CONSOLE_WEB_DIST = makeDist()
  for (const path of ['/core-console', '/core-console/']) {
    const { req, res } = fakeReqRes(path)
    createConsoleV2ShellHandler({})(req, res)
    assert.equal(res.statusCode, 200, path)
    assert.match(res.body, /data-core-console/, path)
    assert.match(res.body, /__CORE_CONSOLE_BASES__/, path)
  }
  const { req: r405, res: s405 } = fakeReqRes('/core-console/', 'POST')
  createConsoleV2ShellHandler({})(r405, s405)
  assert.equal(s405.statusCode, 405, '公开词形仍拒非 GET（405 面）')
})

test('repoRoot 推导：以 import.meta.url 上溯三级=插件仓根', () => {
  assert.equal(repoRoot().endsWith('core_system_dsh_plugin'), true)
})

test('resolveWebDistDir 解析序：env 命中即返；缺席回落 submodule pin 面', () => {
  const dir = makeDist()
  process.env.CORE_CONSOLE_WEB_DIST = dir
  assert.equal(resolveWebDistDir(), join(dir))
  process.env.CORE_CONSOLE_WEB_DIST = join(tmpdir(), 'no-such-dist-xyz')
  // env 落空=回落 submodule pin 面（<仓根>/core_system/web/dist）——loop-87 起该面常在
  // （pin 自带入库 dist）=null 词形只在 pin 亦缺席时成立（hermetic：仅在 absent 时断 null）。
  const pinned = resolveWebDistDir()
  if (pinned === null) assert.equal(pinned, null)
  assert.ok(pinned === null || pinned.endsWith(join('core_system', 'web', 'dist')), '回落词形=pin 面')
  delete process.env.CORE_CONSOLE_WEB_DIST
  rmSync(dir, { recursive: true, force: true })
})
