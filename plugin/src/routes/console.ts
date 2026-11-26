// routes/console.ts —— console 只读代理 + comm 落账读面 + Service project 映射 + 路由装配。
// R-ENG-7 拆分：原 index.ts 的读面 handler 与 mountConsoleRoutes 全量搬家（零语义变化）；
// 写通路 handler 族在 ./console-write.ts，WS 升级代理在 ./wsproxy.ts。
import {
  CONSOLE_API_PREFIX, CONSOLE_APPLY_PATH, CONSOLE_DRAFTS_PATH, CONSOLE_DESIGN_DOCS_PATH,
  CONSOLE_INTAKE_PATH, CONSOLE_SESSION_HEARTBEAT_PATH, CONSOLE_COMM_PATH, CONSOLE_SERVICE_PROJECTS_PATH,
  CONSOLE_WS_PATH, DEFAULT_APPLY_SUBJECT,
} from '../config.ts'
import { sendJson, readRequestBody, type FetchLike, type HttpReqLike, type HttpResLike, type WebServerLike, type ConnectionLike, type ApplySubject } from '../http.ts'
import type { CoreSystemBridge, CoreSystemQueryHandle } from '../bridge.ts'
import type { CommState } from '../tools/agent-comm.ts'
import { createCommHandler } from './comm-read.ts'
import {
  createApplyHandler, createDraftsHandler, createDesignDocsHandler,
  createIntakeHandler, createSessionHeartbeatHandler, createEventPubHandler,
} from './console-write.ts'
import { createChatTranscriptReadHandler, createChatCreateHandler, type SessionControllerDeps } from '../bridges/transcript.ts'
import { createConsoleWsUpgradeHandler } from './wsproxy.ts'
import { mountConsoleV2 } from './console-v2.ts'
import { createChatFacesClientHandler, createChatSendHandler, createChatStopHandler, type ChatFacesDeps } from '../bridges/chatfaces.ts'
import { CONSOLE_CHAT_SEND_PATH, CONSOLE_CHAT_STOP_PATH, CONSOLE_CHATFACES_CLIENT_PATH, CONSOLE_EVENT_PUB_PATH,
  CONSOLE_CHAT_SESSIONS_PATH, CONSOLE_CHAT_CREATE_PATH, CONSOLE_CHAT_TRANSCRIPT_PATH, CONSOLE_CHAT_STATE_PATH } from '../config.ts'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export { createCommState } from '../tools/agent-comm.ts'
export type { CommState } from '../tools/agent-comm.ts'
export { createCommHandler }

/** Service project 根：只由部署环境推导，公开仓不写真实路径。 */
export function defaultServiceProjectsRoot(): string {
  return process.env.DSH_SERVICE_PROJECTS_ROOT
    || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'service-projects')
}

function safeServiceName(name: unknown): string | null {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name)) return null
  if (name === '.' || name === '..') return null
  return name
}

/** Service→Workspace 路由（能力 C）。GET=cored ServiceDesc 投影；POST=只为已声明 Service
 *  准备本地目录。真正的 Workspace 注册/会话绑定由 dsh ctx.workspaces/ctx.sessions 完成，
 *  本路由不创造第二权威、不迁移旧会话、不触碰文档面。 */
export function createServiceProjectsHandler(opts: {
  bridge: CoreSystemQueryHandle & { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  root?: string
}) {
  const root = resolve(opts.root || defaultServiceProjectsRoot())
  const services = async (): Promise<Array<{ name: string; scope: string; agents: string[] }>> => {
    if (!opts.bridge.url) throw new Error('cored 未就绪（桥接未完成）')
    const listed = await opts.bridge.list('ServiceDesc')
    if (!listed.ok) throw new Error(listed.error)
    const rows: Array<{ name: string; scope: string; agents: string[] }> = []
    for (const ref of listed.data) {
      const got = await opts.bridge.get('ServiceDesc', ref.scope, ref.name)
      if (!got.ok) continue
      const agents = [...new Set([...String(got.data.content).matchAll(/agent:\/\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]))]
      rows.push({ name: ref.name, scope: ref.scope, agents })
    }
    return rows
  }
  return async function serviceProjectsHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (!opts.reject) { res.statusCode = 401; res.end(); return }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'GET, POST')
      res.end()
      return
    }
    try {
      const rows = await services()
      if (method === 'GET') {
        sendJson(res, 200, { count: rows.length, services: rows })
        return
      }
      let requested: unknown
      try { requested = JSON.parse((await readRequestBody(req)) || '{}') } catch {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' }); return
      }
      if (typeof requested !== 'object' || requested === null || Array.isArray(requested)) {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' }); return
      }
      const names = (requested as { services?: unknown }).services
      if (names !== undefined && (!Array.isArray(names) || names.length > 500)) {
        sendJson(res, 400, { error: 'services 需为 ≤500 项数组' }); return
      }
      const declared = new Set(rows.map((r) => r.name))
      const selected = (names as unknown[] | undefined)?.map(safeServiceName) ?? rows.map((r) => r.name)
      if (selected.some((n) => n === null || !declared.has(n as string))) {
        sendJson(res, 400, { error: '只能为 cored 已声明的合法 Service 准备 project' }); return
      }
      mkdirSync(root, { recursive: true, mode: 0o700 })
      const projects = selected.map((name) => {
        const safe = name as string
        const dir = resolve(root, safe)
        if (dir !== join(root, safe)) throw new Error('project 路径越界')
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        return { service: safe, path: dir }
      })
      sendJson(res, 200, { count: projects.length, projects })
    } catch (e) {
      sendJson(res, 502, { error: String((e as Error)?.message ?? e) })
    }
  }
}

/** 代理允许的上游路径前缀：只放行 cored 只读 GET 面（cored-bridge.md §2）——
 *  写路径唯一入口 POST /v1/apply 与 secrets/草稿写操作永不经本代理（缺省只读装配），
 *  浏览器侧零写路径旁路（console-adoption.md §5 规则 1/2）。 */
const UPSTREAM_ALLOWED = /^\/v1\//

/**
 * console API 代理 handler（E2 数据通路核心，测试注入 fetch/bridge/reject 全独立）：
 *   浏览器 GET /core-console/api/v1/* → connection 鉴权栅栏 → cored GET <bridge.url>/v1/*
 * 鉴权栅栏缺席（connection 未装配）=拒绝所有请求（fail-closed，不降级为无鉴权转发）。
 * cored 未就绪（bridge.url 空）=503（与 cored 读面 503 口径一致，不冒充 404）。
 * 非 GET=405（allow: GET——查询面只读，写路径不经浏览器代理）。
 */
export function createConsoleApiHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  return async function consoleApiHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (opts.reject) {
      const rejection = opts.reject({ headers: req.headers })
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
    }
    if ((req.method ?? 'GET') !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    const target = new URL(String(req.url ?? '/'), 'http://localhost')
    const rest = target.pathname.slice(CONSOLE_API_PREFIX.length)
    if (!UPSTREAM_ALLOWED.test(rest) || rest.includes('..')) {
      sendJson(res, 404, { error: 'not found（只放行 cored /v1/ 只读面）' })
      return
    }
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    let upstream: Awaited<ReturnType<FetchLike>>
    try {
      upstream = await fetchImpl(opts.bridge.url.replace(/\/+$/, '') + rest + target.search)
    } catch (e) {
      sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
      return
    }
    const text = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }
}

/** 宿主侧装配（软出现：web profile 才有 webServer/connection；headless 宿主零影响）。
 *  用 ctx.inject 等待依赖可用——依赖缺席的 profile 上回调永不启动，插件本体不受影响。 */
export function mountConsoleRoutes(ctx: {
  inject?(deps: string[], apply: (sub: any) => void | (() => void)): unknown
}, bridge: { url: string }, applySubject: ApplySubject = DEFAULT_APPLY_SUBJECT, comm?: CommState, serviceProjectsRoot?: string): void {  if (typeof ctx.inject !== 'function') return // 防御面：无 inject 能力的宿主（测试假体/极简壳）零影响
  // 对话通路 prompt/cancel 面（chat-send/chat-stop 后端——sessionController 直调；selfheal 桥同款软出现）
  const chatDeps: ChatFacesDeps & { cancel?: ((req: { sessionId: string }) => unknown) | null } = { prompt: null, cancel: null }
  const transcriptDeps: SessionControllerDeps = { sc: null }
  ctx.inject(['sessionController'], (sub: any) => {
    const sc = Reflect.get(sub, 'sessionController')
    if (sc && typeof sc.prompt === 'function') {
      chatDeps.prompt = (req) => sc.prompt(req, AbortSignal.timeout(10_000))
      // C-02 停止通路（cancel 面=agent-comm interrupt 同源真通路；缺席宿主=503 诚实词形）
      if (typeof sc.cancel === 'function') chatDeps.cancel = (req) => sc.cancel(req)
      // 自有对话面转录桥（§对话界面批——sc.list/create/page/state 直调面）
      transcriptDeps.sc = sc as unknown as SessionControllerDeps['sc']
      console.error('[core-system-diag] chatfaces prompt 面已接（sessionController 就绪）')
    }
  })
  ctx.inject(['webServer', 'connection'], (sub: any) => {
    const webServer = Reflect.get(sub, 'webServer') as WebServerLike | undefined
    const connection = Reflect.get(sub, 'connection') as ConnectionLike | undefined
    if (!webServer || !connection) return // 防御面：inject 已保证，缺席即不注册（不降级）
    const reject = (req: { headers: unknown }) => connection.requestRejection(req)
    const unregisters: Array<() => void> = [
      webServer.register({
        kind: 'prefix', path: CONSOLE_API_PREFIX,
        handler: createConsoleApiHandler({ bridge, reject }),
      }),
      webServer.register({
        kind: 'exact', path: CONSOLE_APPLY_PATH,
        handler: createApplyHandler({ bridge, reject, subject: applySubject }),
      }),
      webServer.register({
        kind: 'prefix', path: CONSOLE_DRAFTS_PATH,
        handler: createDraftsHandler({ bridge, reject }),
      }),
      // 设计文档写通路（v0.52 能力 A）：apply 主体宿主注入 + draft 落稿/弃稿——
      // 三闸门（白名单/lint/乐观锁）与权限判定在 cored 侧，宿主零旁路。
      webServer.register({
        kind: 'prefix', path: CONSOLE_DESIGN_DOCS_PATH,
        handler: createDesignDocsHandler({ bridge, reject, subject: applySubject }),
      }),
      // 对话式录入与准入预检通路（v0.53 能力 D + R-UX-1/R-UX-2）：主体宿主注入，浏览器不直连模型。
      webServer.register({
        kind: 'prefix', path: CONSOLE_INTAKE_PATH,
        handler: createIntakeHandler({ bridge, reject, subject: applySubject }),
      }),
      // 会话活性心跳注册通路（v0.54 KI-003）：agent 侧推进点上报走宿主注入主体。
      webServer.register({
        kind: 'exact', path: CONSOLE_SESSION_HEARTBEAT_PATH,
        handler: createSessionHeartbeatHandler({ bridge, reject, subject: applySubject }),
      }),
      ...(comm ? [webServer.register({
        kind: 'exact', path: CONSOLE_COMM_PATH,
        handler: createCommHandler({ state: comm, reject }),
      })] : []),
      webServer.register({
        kind: 'exact', path: CONSOLE_SERVICE_PROJECTS_PATH,
        handler: createServiceProjectsHandler({ bridge: bridge as CoreSystemBridge, reject, root: serviceProjectsRoot }),
      }),
    ]
    // 实时流 WS 升级代理（/core-console/ws → cored /v1/stream）：registerUpgrade 能力缺席的
    // 宿主（测试假体/旧版 dsh）=软出现零 WS 面；退场 disposer 与 HTTP 路由同队列清理。
    // 对话通路两路由（send 面已接 prompt 才可用；client.js 恒可用）
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_CHAT_SEND_PATH,
      handler: createChatSendHandler({ deps: chatDeps, reject }),
    }))
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_CHATFACES_CLIENT_PATH,
      handler: createChatFacesClientHandler({ reject }),
    }))
    // C-02 停止通路（cancel 真接线；面缺席 handler 内 503 显式缺席）
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_CHAT_STOP_PATH,
      handler: createChatStopHandler({ deps: chatDeps, reject }),
    }))
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_EVENT_PUB_PATH,
      handler: createEventPubHandler({ bridge, reject, subject: applySubject }),
    }))
    // 自有对话面四路由（转录/清单/状态=读；新会话=POST——宿主发 id 零手填）
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_CHAT_SESSIONS_PATH,
      handler: createChatTranscriptReadHandler({ deps: transcriptDeps, kind: 'sessions', reject }),
    }))
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_CHAT_TRANSCRIPT_PATH,
      handler: createChatTranscriptReadHandler({ deps: transcriptDeps, kind: 'transcript', reject }),
    }))
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_CHAT_STATE_PATH,
      handler: createChatTranscriptReadHandler({ deps: transcriptDeps, kind: 'state', reject }),
    }))
    unregisters.push(webServer.register({
      kind: 'exact', path: CONSOLE_CHAT_CREATE_PATH,
      handler: createChatCreateHandler({ deps: transcriptDeps, reject }),
    }))
    const wsUnregister = mountConsoleWsUpgrade(webServer, { bridge, reject })
    if (wsUnregister) unregisters.push(wsUnregister)
    // web/ 新前端并行载体面（产物缺席=软出现零 v2 面——不炸宿主）。
    unregisters.push(...mountConsoleV2(webServer, reject))
    return () => unregisters.forEach((u) => u())
  })
}

/** WS 升级路由注册（registerUpgrade 能力面软出现；缺席=undefined，不炸宿主）。 */
function mountConsoleWsUpgrade(
  webServer: WebServerLike,
  opts: { bridge: { url: string }; reject: (req: { headers: unknown }) => 401 | 403 | undefined },
): (() => void) | undefined {
  if (typeof webServer.registerUpgrade !== 'function') return undefined
  const dispose = webServer.registerUpgrade({
    path: CONSOLE_WS_PATH,
    handler: createConsoleWsUpgradeHandler({ bridge: opts.bridge, reject: opts.reject }),
  })
  return typeof dispose === 'function' ? dispose : undefined
}

/** 旧装配入口别名（E2 只读代理；现由 mountConsoleRoutes 承接——契约名保留兼容）。 */
export const mountConsoleProxy = mountConsoleRoutes
