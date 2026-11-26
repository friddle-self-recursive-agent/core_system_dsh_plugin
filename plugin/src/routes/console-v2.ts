// routes/console-v2.ts —— web/ 新前端载体面（G-02 载体切换·并行 v2 阶段）：
//   GET /core-console/v2           → 壳页 HTML（预置 __CORE_CONSOLE_BASES__ 代理词位 + 容器）
//   GET /core-console/v2/assets/*  → web/dist 构建产物（console.js/console.css 白名单静态面）
// 产物来源解析序：env CORE_CONSOLE_WEB_DIST → <仓根>/core_system/web/dist（workservice
// submodule 在插件仓根，pin 自带入库 dist——零构建启动）。产物缺席=503 诚实词形（不冒充 404）。
// 鉴权同族 fail-closed：connection 栅栏缺席=401 拒全部；非 GET=405。旧 console（client/
// 过渡期载体）零改动——本面是并行新增，浏览器活体验收后另行裁决默认切换。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendJson, type HttpReqLike, type HttpResLike } from '../http.ts'
import { CONSOLE_V2_ASSETS_PREFIX, CONSOLE_V2_PREFIX } from '../config.ts'

// 测试面兼容重导出（test/console-v2.test.ts 自本模块取词——常量真源=config.ts）。
export { CONSOLE_V2_PREFIX, CONSOLE_V2_ASSETS_PREFIX }

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
    '<title>Core Console v2（web 重构载体·并行验收面）</title>\n' +
    '<link rel="stylesheet" href="' + CONSOLE_V2_ASSETS_PREFIX + '/console.css?v=' + v + '">\n' +
    '<script>' + bases + '</script>\n</head>\n<body>\n' +
    '<div data-core-console></div>\n' +
    '<script src="/core-console/chatfaces.js?v=' + v + '"></script>\n' +
    '<script src="' + CONSOLE_V2_ASSETS_PREFIX + '/console.js?v=' + v + '"></script>\n</body>\n</html>\n'
}

/** 鉴权栅栏（fail-closed）：栅栏缺席=401 拒全部；在册=按宿主判定（undefined=放行）。 */
function gateStatus(req: HttpReqLike, reject?: (req: { headers: unknown }) => 401 | 403 | undefined): number | null {
  if (!reject) return 401
  const r = reject({ headers: req.headers })
  return r === undefined ? null : r
}

/** 产物处理器工厂（opts.reject 在册=fail-closed 栅栏；opts 公开词形=omit opts.reject 键——
 * 以 in 判别区分「未声明栅栏（公开）」与「显式声明但缺席（fail-closed 401）」）。
 * F-01（loop-87）：公开词形只用于静态壳页（/core-console 主入口——无数据面）；
 * 数据/写面（api/apply/drafts/ws）恒传真栅栏，缺席=401 词形不变。 */
export function createConsoleV2ShellHandler(opts: { reject?: (req: { headers: unknown }) => 401 | 403 | undefined }) {
  const open = !('reject' in opts)
  return function consoleV2ShellHandler(req: HttpReqLike, res: HttpResLike): void {
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

/** 产物 handler：GET /core-console/v2/assets/<file>（白名单双保险+no-store）。 */
export function createConsoleV2AssetHandler(opts: { reject?: (req: { headers: unknown }) => 401 | 403 | undefined }) {
  return function consoleV2AssetHandler(req: HttpReqLike, res: HttpResLike): void {
    const denied = gateStatus(req, opts.reject)
    if (denied !== null) { res.statusCode = denied; res.end(); return }
    if ((req.method ?? 'GET') !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    const target = new URL(String(req.url ?? '/'), 'http://localhost')
    const name = basename(decodeURIComponent(target.pathname.slice(CONSOLE_V2_ASSETS_PREFIX.length)))
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

/** 装配（在 mountConsoleRoutes 内与既有路由同队列注册+清理）。
 * F-01 入口转正（2026-11-26 34 屏扫描 P0-1）：/core-console 与 /core-console/ 注册为同壳
 * 200（壳页=静态只读 HTML 面无数据泄漏面，公开词形对齐任务验收「/core-console/ 与
 * /core-console/v2 均 200」）；/core-console/assets/* 同族放行（同白名单同产物面）。
 * 数据/写面（/core-console/api|apply|drafts|ws）鉴权面零改动。 */
export function mountConsoleV2(
  webServer: { register(route: { kind: string; path: string; handler: (req: HttpReqLike, res: HttpResLike) => void }): () => void },
  reject: (req: { headers: unknown }) => 401 | 403 | undefined,
): Array<() => void> {
  const dist = resolveWebDistDir()
  console.error(`[core-system-diag] console-v2 mount dist=${dist ?? 'null'} root=${repoRoot()}`)
  if (!dist) return [] // 产物缺席=软出现零 v2 面（不炸宿主；日志面由调用方 stderr 提示）
  const entries = readdirSync(dist)
  const haveAll = ['console.js', 'console.css'].every((f) => entries.includes(f))
  if (!haveAll) return []
  const out = [
    webServer.register({ kind: 'exact', path: CONSOLE_V2_PREFIX, handler: createConsoleV2ShellHandler({ reject }) }),
    // 尾斜杠词形同壳（§19.4 转正毛刺：dsh 前缀匹配 url===path||path+'/' 会吃掉
    // /core-console/v2/ 落到 404——显式注册 exact 斜杠词形=同壳 200）。
    webServer.register({ kind: 'exact', path: CONSOLE_V2_PREFIX + '/', handler: createConsoleV2ShellHandler({ reject }) }),
    webServer.register({ kind: 'prefix', path: CONSOLE_V2_ASSETS_PREFIX, handler: createConsoleV2AssetHandler({ reject }) }),
    // F-01 入口转正：无版本主入口同壳公开 200（34 屏扫描 P0-1——/core-console/ 直开 404 修复；
    // 公开词形=不声明 reject 键——静态壳页无数据泄漏面；数据/写面栅栏零改动）。
    webServer.register({ kind: 'exact', path: '/core-console', handler: createConsoleV2ShellHandler({}) }),
    webServer.register({ kind: 'exact', path: '/core-console/', handler: createConsoleV2ShellHandler({}) }),
  ]
  console.error(`[core-system-diag] console-v2 registered=${out.length}`)
  return out
}
