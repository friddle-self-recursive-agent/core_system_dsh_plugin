// routes/console-web.ts —— 控制台 Web 前端载体面（默认入口；旧 client 载体 v1 已退役）：
//   GET /core-console 与 /core-console/     → 壳页 HTML（预置 __CORE_CONSOLE_BASES__ 代理词位 + 容器）
//   GET /core-console/assets/*              → web/dist 构建产物（console.js/console.css 白名单静态面）
//   GET /core-console/v2[/]                 → 302 /core-console/（历史词形兼容，不再作为入口名）
// 2026-11-27 用户裁决：不再叫 v2——本面即默认控制台；v1（plugin/client 旧前端巨石）整体删除。
// 产物来源解析序：env CORE_CONSOLE_WEB_DIST → <仓根>/core_system/web/dist（workservice
// submodule 在插件仓根，pin 自带入库 dist——零构建启动）。产物缺席=503 诚实词形（不冒充 404）。
// 鉴权同族 fail-closed：connection 栅栏缺席=401 拒全部；非 GET=405。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendJson, type HttpReqLike, type HttpResLike } from '../http.ts'
import { CONSOLE_LEGACY_V2_PATH, CONSOLE_WEB_ASSETS_PREFIX } from '../config.ts'

// 测试面兼容重导出（test/console-web.test.ts 自本模块取词——常量真源=config.ts）。
export { CONSOLE_LEGACY_V2_PATH, CONSOLE_WEB_ASSETS_PREFIX }

/** 插件仓根（src/routes/ → ../../../ = 仓根；submodule core_system 在仓根非 package 目录）。 */
export function repoRoot(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
}

/** web/dist 产物目录解析序：env 覆写 → submodule pin 面（<仓根>/core_system/web/dist）。缺席=null（诚实 503）。 */
export function resolveWebDistDir(): string | null {
  const candidates = [process.env.CORE_CONSOLE_WEB_DIST, join(repoRoot(), 'core_system', 'web', 'dist')]
  for (const dir of candidates) {
    if (!dir) continue
    const abs = resolve(dir)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue
    if (!existsSync(join(abs, 'console.js'))) continue // 无产物=同缺席（目录存在但空）
    return abs
  }
  return null
}

/** 产物白名单：只放行构建器固定输出的两个文件名——零路径遍历面（basename 再校验双保险）。 */
const ASSET_WHITELIST: Record<string, string> = {
  'console.js': 'application/javascript; charset=utf-8',
  'console.css': 'text/css; charset=utf-8',
}

function shellHtml(): string {
  // 资产版本参数=产物 mtime：上游公网反代（NPM）对同 URL 有缓存——重部署后 mtime 变化即击穿。
  const dist = resolveWebDistDir()
  const v = dist ? String(statSync(join(dist, 'console.js')).mtimeMs | 0) : '0'
  const bases = `window.__CORE_CONSOLE_BASES__={api:'/core-console/api',ws:(location.protocol==='https:'?'wss://':'ws://')+location.host+'/core-console/ws',apply:'/core-console/apply',drafts:'/core-console/drafts'};`
  return '<!doctype html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%234d6bfe%22/%3E%3Ctext x=%2216%22 y=%2222%22 font-size=%2218%22 font-family=%22sans-serif%22 font-weight=%22700%22 fill=%22white%22 text-anchor=%22middle%22%3EC%3C/text%3E%3C/svg%3E">\n' +
    '<title>Core Console（核心控制台）</title>\n' +
    '<link rel="stylesheet" href="' + CONSOLE_WEB_ASSETS_PREFIX + '/console.css?v=' + v + '">\n' +
    '<script>' + bases + '</script>\n</head>\n<body>\n' +
    '<div data-core-console></div>\n' +
    '<script src="/core-console/chatfaces.js?v=' + v + '"></script>\n' +
    '<script src="' + CONSOLE_WEB_ASSETS_PREFIX + '/console.js?v=' + v + '"></script>\n</body>\n</html>\n'
}

/** 鉴权栅栏（fail-closed）：栅栏缺席=401 拒全部；在册=按宿主判定（undefined=放行）。 */
function gateStatus(req: HttpReqLike, reject?: (req: { headers: unknown }) => 401 | 403 | undefined): number | null {
  if (!reject) return 401
  const r = reject({ headers: req.headers })
  return r === undefined ? null : r
}

/** 壳页处理器工厂（opts.reject 在册=fail-closed 栅栏；opts 公开词形=omit opts.reject 键——
 * 以 in 判别区分「未声明栅栏（公开）」与「显式声明但缺席（fail-closed 401）」）。
 * 公开词形只用于静态壳页（/core-console 主入口——无数据面）；
 * 数据/写面（api/apply/drafts/ws）恒传真栅栏，缺席=401 词形不变。 */
export function createConsoleShellHandler(opts: { reject?: (req: { headers: unknown }) => 401 | 403 | undefined }) {
  const open = !('reject' in opts)
  return function consoleShellHandler(req: HttpReqLike, res: HttpResLike): void {
    const denied = open ? null : gateStatus(req, opts.reject)
    if (denied !== null) { res.statusCode = denied; res.end(); return }
    if ((req.method ?? 'GET') !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    if (!resolveWebDistDir()) {
      sendJson(res, 503, { error: 'web/dist 产物缺席（submodule 未 pin 构建面且 env CORE_CONSOLE_WEB_DIST 未指路）' })
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(shellHtml())
  }
}

/** 产物 handler：GET /core-console/assets/<file>（白名单双保险+no-store）。 */
export function createConsoleAssetHandler(opts: { reject?: (req: { headers: unknown }) => 401 | 403 | undefined }) {
  return function consoleAssetHandler(req: HttpReqLike, res: HttpResLike): void {
    const denied = gateStatus(req, opts.reject)
    if (denied !== null) { res.statusCode = denied; res.end(); return }
    if ((req.method ?? 'GET') !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    const target = new URL(String(req.url ?? '/'), 'http://localhost')
    const name = basename(decodeURIComponent(target.pathname.slice(CONSOLE_WEB_ASSETS_PREFIX.length)))
    const ctype = ASSET_WHITELIST[name]
    if (!ctype) { sendJson(res, 404, { error: 'not found（产物白名单：console.js/console.css）' }); return }
    const dir = resolveWebDistDir()
    if (!dir) { sendJson(res, 503, { error: 'web/dist 产物缺席' }); return }
    let body: Buffer
    try { body = readFileSync(join(dir, name)) } catch {
      sendJson(res, 503, { error: 'web/dist 产物读取失败（' + name + '）' })
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', ctype)
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }
}

/** 历史 /core-console/v2 词形兼容：302 → /core-console/（静态跳转无数据面，同壳公开口径）。 */
export function createConsoleLegacyRedirectHandler() {
  return function consoleLegacyRedirectHandler(req: HttpReqLike, res: HttpResLike): void {
    if ((req.method ?? 'GET') !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    res.statusCode = 302
    res.setHeader('location', '/core-console/')
    res.setHeader('cache-control', 'no-store')
    res.end()
  }
}

/** 装配（在 mountConsoleRoutes 内与既有路由同队列注册+清理）。
 * /core-console 与 /core-console/ 注册为同壳 200（壳页=静态只读 HTML 面无数据泄漏面）；
 * /core-console/assets/* 同族放行（同白名单同产物面）；/core-console/v2 仅兼容重定向。
 * 数据/写面（/core-console/api|apply|drafts|ws）鉴权面零改动。 */
export function mountConsoleWeb(
  webServer: { register(route: { kind: string; path: string; handler: (req: HttpReqLike, res: HttpResLike) => void }): () => void },
  reject: (req: { headers: unknown }) => 401 | 403 | undefined,
): Array<() => void> {
  const dist = resolveWebDistDir()
  console.error(`[core-system-diag] console-web mount dist=${dist ?? 'null'} root=${repoRoot()}`)
  if (!dist) return [] // 产物缺席=软出现零 console-web 面（不炸宿主；日志面由调用方 stderr 提示）
  const entries = readdirSync(dist)
  const haveAll = ['console.js', 'console.css'].every((f) => entries.includes(f))
  if (!haveAll) return []
  const out = [
    // 默认入口：无版本词形（公开壳页——静态只读 HTML 面无数据泄漏面；数据/写面栅栏零改动）。
    webServer.register({ kind: 'exact', path: '/core-console', handler: createConsoleShellHandler({}) }),
    webServer.register({ kind: 'exact', path: '/core-console/', handler: createConsoleShellHandler({}) }),
    // 历史 v2 词形=302 兼容（2026-11-27 用户裁决：不再叫 v2，v1 删除）。
    webServer.register({ kind: 'exact', path: CONSOLE_LEGACY_V2_PATH, handler: createConsoleLegacyRedirectHandler() }),
    webServer.register({ kind: 'exact', path: CONSOLE_LEGACY_V2_PATH + '/', handler: createConsoleLegacyRedirectHandler() }),
    webServer.register({ kind: 'prefix', path: CONSOLE_WEB_ASSETS_PREFIX, handler: createConsoleAssetHandler({ reject }) }),
  ]
  console.error(`[core-system-diag] console-web registered=${out.length}`)
  return out
}
