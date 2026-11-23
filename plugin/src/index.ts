// core_system dsh plugin 入口：宿主 cored（Go 控制面，core_system submodule 的 cmd/cored）。
// 职责（桥契约见 core_system_instance/runtime/cored-bridge.md）：
//   1. 按配置拉起 cored 子进程（二进制定位：config.coredBin → CORE_SYSTEM_CORED_BIN → PATH 上的 cored）
//   2. 解析 cored stdout 的 CORED_READY 就绪行，取得实际监听地址
//   3. 转发一次 scheme 查询（GET /v1/scheme + /v1/scheme/kinds）并留痕日志，结果挂到 ctx.coreSystem
//   4. 挂持续只读查询句柄（ctx.coreSystem.get/list，fetch 封装 /v1/objects 对象读面；
//      只发 GET，不引入新写路径——写路径唯一入口仍是 cored 的 POST /v1/apply 且缺省关闭）
//   5. 插件退场时回收子进程
// 部署锚点一律经配置或环境注入，不内置真实路径（rule.md R-PUB-1/2）。
import { spawn, type ChildProcess } from 'node:child_process'
import { AGENT_COMM_KINDS, CommJournal, Mailbox, executeAgentCommOp, type AgentCommDeps, type AgentCommResult } from './agent-comm.ts'

export interface Config {
  /** 启动时拉起 cored 子进程（缺省 true）；coredUrl 存在时忽略本项。 */
  autoSpawn?: boolean
  /** cored 可执行文件路径；缺省读 CORE_SYSTEM_CORED_BIN，再退化为 PATH 上的 cored。 */
  coredBin?: string
  /** 传给 cored 的附加参数（--scheme 由 schemePath 注入，不在此重复）。 */
  coredArgs?: string[]
  /** core/scheme.yaml 源路径；缺省读 CORE_SYSTEM_SCHEME。为空且无 coredUrl 时桥接不启动。 */
  schemePath?: string
  /** 已在运行的 cored 基址（http://127.0.0.1:port）；设置则跳过 spawn 直接查询。 */
  coredUrl?: string
  /** 等待就绪行的超时（毫秒，缺省 10000）。 */
  readyTimeoutMs?: number
  /** console Apply 写路由的请求级主体（E3 起；缺省=内置 admin 全权字面量——
   *  cored-bridge.md §3 config.applySubject；主体注入属宿主行为，浏览器不携带主体）。 */
  applySubject?: ApplySubject
}

/** 对象引用（/v1/objects list 投影，瘦身载荷无正文；契约 cored-bridge.md §2）。 */
export interface CoreObjectRef {
  kind: string
  name: string
  scope: string
  resourceVersion: number
}

/** 文档对象（get 载荷：引用 + content=文档原文 yaml 或 md+frontmatter）。 */
export interface CoreObject extends CoreObjectRef {
  content: string
}

/**
 * 查询结果（判别联合，机械可分支）：
 *  - ok=true：data 为载荷投影；
 *  - ok=false：status 为 HTTP 状态码（404=对象/类型不存在，503=文档库未配置……），
 *    null=传输层失败（未就绪/连接拒绝）；error 为诊断文本。
 * 句柄永不抛错——查询失败不阻断宿主（宿主健康优先于桥接成功，契约 §3）。
 */
export type CoreQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; error: string }

/** 持续只读查询句柄（挂 ctx.coreSystem；url 就绪前后均可安全调用）。 */
export interface CoreSystemQueryHandle {
  /** 单对象读取：GET /v1/objects/{kind}/{name}?scope=<scope>。 */
  get(kind: string, scope: string, name: string): Promise<CoreQueryResult<CoreObject>>
  /** 对象清单：GET /v1/objects/{kind}[?scope=<scope>]（scope 缺省=跨 scope 枚举）。 */
  list(kind: string, scope?: string): Promise<CoreQueryResult<CoreObjectRef[]>>
}

/** 桥接结果（挂 ctx.coreSystem，供同宿主插件读取）。 */
export interface CoreSystemBridge extends CoreSystemQueryHandle {
  /** cored 基址（spawn 路径就绪后填值；此前调用 get/list 返回 ok=false status=null）。 */
  url: string
  /** scheme 概览（GET /v1/scheme 载荷）。 */
  scheme: Record<string, unknown> | null
  /** 对象类型名清单（GET /v1/scheme/kinds 投影）。 */
  kinds: string[] | null
}

/** fetch 的最小结构面（便于测试注入假实现；与全局 fetch 同形——第二参=POST/写通路的 init）。 */
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>

/** 极小 IncomingMessage 结构面（测试可注入；真实侧来自 node:http——POST 体经流式读取）。 */
export interface HttpReqLike {
  method?: string
  url?: string
  headers: Record<string, unknown>
  /** 测试注入面：string=现成请求体（流缺席时不走 stream 读取）。 */
  body?: string
  /** node:http 流面（真实侧 IncomingMessage；测试假体可缺席）。 */
  on?(event: string, cb: (chunk?: Buffer | string) => void): unknown
  off?(event: string, cb: (chunk?: Buffer | string) => void): unknown
}
/** 极小 ServerResponse 结构面（测试可注入）。 */
export interface HttpResLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

/** webServer 的最小注册面（dsh-host-webserver 类型投影；测试可注入假体）。 */
export interface WebServerLike {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: HttpReqLike, res: HttpResLike) => void | Promise<void> }): () => void
}
/** connection 的最小信任面（open-in-app 同款 requestRejection：401=未认证，403=Host/Origin 拒绝，undefined=放行）。 */
export interface ConnectionLike {
  requestRejection(req: { headers: unknown }): 401 | 403 | undefined
}

/** console 只读代理路由前缀（宿主 web 路由；浏览器同源 fetch，cookies 随行）。 */
export const CONSOLE_API_PREFIX = '/core-console/api'

/** console Apply 写路由（E3 起，exact 路径；与只读代理前缀分立）。宿主转发 cored
 *  POST /v1/apply（写路径唯一入口，三步闸门零旁路——cored-bridge.md §2.1）；主体由宿主
 *  注入（config.applySubject），浏览器不携带主体；鉴权边界=connection 鉴权栅栏（与读代理
 *  同 fail-closed 口径）。 */
export const CONSOLE_APPLY_PATH = '/core-console/apply'

/** console 草稿路由（E4 起，prefix；落稿/弃稿——cored-bridge.md §2.2 草稿缓存面）。
 *  POST /core-console/drafts（exact 段）→ cored POST /v1/drafts 落稿 upsert；
 *  DELETE /core-console/drafts/{kind}/{name}?scope= → cored DELETE 弃稿。
 *  草稿不触文档面（零 Revision 零事件），但写操作随 cored --allow-apply 开关（缺省 405）；
 *  fieldManager=客户端溯源串（溯源非授权——授权主体只在 apply 路由由宿主注入），客户端
 *  缺主=宿主补缺省（无主稿 cored 侧 400 拒绝）。 */
export const CONSOLE_DRAFTS_PATH = '/core-console/drafts'

/** 草稿 fieldManager 缺省（客户端缺主时宿主补——无主稿 cored 拒绝 400，兜底保 UX）。 */
export const DEFAULT_DRAFT_FIELD_MANAGER = 'console:editor'

/** agent-comm 读路由（E6，exact 路径）：`GET /core-console/comm`——agent-comm 运行时
 *  落账面（CommJournal+mailbox）的浏览器读出口（console 连接页 agent-comm 详情=
 *  op 面/拓扑/消息日志数据源，console-adoption.md §1.13）。只读 GET（其余 405 allow: GET）；
 *  connection 栅栏 fail-closed 与 apply 路由同款（handler 内再锁一道）；**token 值永不
 *  出现于载荷**（落账面只记 hasToken 布尔——凭据红线）。 */
export const CONSOLE_COMM_PATH = '/core-console/comm'

/** agent-comm 运行时落账状态（一次插件激活一份；mailbox=v0.1 既有落账面，
 *  journal=E6 comm 流水——同族扩展，console 只渲染）。 */
export interface CommState {
  mailbox: Mailbox
  journal: CommJournal
}

export function createCommState(): CommState {
  return { mailbox: new Mailbox(), journal: new CommJournal() }
}

/** 载荷投影（脱敏边界在此收口：journal 记录已不含 token 值；mailbox 信封若含 token 字段
 *  则整信封打码——v0.1 mailbox 只落 error reply 无 token，防御面照写）。 */
function commPayload(state: CommState) {
  const mailboxPending: Record<string, number> = {}
  const counts = state.journal.counts()
  const refs = state.journal.refs()
  for (const ref of new Set([...refs, ...state.journal.snapshot().map((r) => r.to)])) {
    const n = state.mailbox.peek(ref).length
    if (n > 0) mailboxPending[ref] = n
  }
  const journal = state.journal.snapshot().map((r) => ({
    ts: r.ts, op: r.op, from: r.from, to: r.to, ok: r.ok, envelopeId: r.envelopeId,
    ...(r.error ? { error: r.error } : {}),
    ...(r.sessionId ? { sessionId: r.sessionId } : {}),
    hasToken: r.hasToken === true,
  }))
  return {
    ops: [...AGENT_COMM_KINDS],
    counts,
    refs,
    mailboxPending,
    journal,
  }
}

/**
 * console agent-comm 读 handler（E6，测试注入 state/reject 全独立）：
 *   浏览器 GET /core-console/comm → connection 鉴权栅栏 → 本进程落账快照（零上游请求）。
 * 栅栏缺席=fail-closed 拒全部（apply 路由同款）；非 GET=405（allow: GET）。
 */
export function createCommHandler(opts: {
  state: CommState
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
}) {
  return function commHandler(req: HttpReqLike, res: HttpResLike): void {
    if (!opts.reject) {
      res.statusCode = 401
      res.end()
      return
    }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if ((req.method ?? 'GET') !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    sendJson(res, 200, commPayload(opts.state))
  }
}

/** Apply 主体缺省（permission.DefaultAdmin 全权字面量；部署可经 config.applySubject 覆写
 *  为受限 role——cored-bridge.md §3 config.applySubject）。 */
export const DEFAULT_APPLY_SUBJECT = { user: 'console-operator', roles: ['role/global/admin'] }

/** 请求级主体（cored POST /v1/apply subject 字段投影；cored-bridge.md §2.1）。 */
export interface ApplySubject {
  user: string
  roles?: string[]
  groups?: string[]
}

/** 代理允许的上游路径前缀：只放行 cored 只读 GET 面（cored-bridge.md §2）——
 *  写路径唯一入口 POST /v1/apply 与 secrets/草稿写操作永不经本代理（缺省只读装配），
 *  浏览器侧零写路径旁路（console-adoption.md §5 规则 1/2）。 */
const UPSTREAM_ALLOWED = /^\/v1\//

/** 统一 JSON 响应（no-store：读面是活体投影，缓存即撕读）。 */
function sendJson(res: HttpResLike, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

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

/** POST 体上限（与 cored apply 入口同量级；超出=400，不无界缓冲）。 */
const APPLY_BODY_CAP = 4 << 20

/** 读 POST 请求体：流面在=逐块收集（真实 IncomingMessage）；string 面在=直取（测试假体）；
 *  两者皆缺=空体（cored 侧 400 兜底）。超限提前收口。 */
async function readRequestBody(req: HttpReqLike): Promise<string> {
  if (typeof req.body === 'string') return req.body
  if (typeof req.on !== 'function') return ''
  return new Promise<string>((resolve) => {
    let out = ''
    let done = false
    const finish = (v: string) => {
      if (done) return
      done = true
      try { req.off?.('data', onData); req.off?.('end', onEnd) } catch { /* 假体可无 off */ }
      resolve(v)
    }
    const onData = (chunk?: Buffer | string) => {
      if (done) return
      out += typeof chunk === 'string' ? chunk : (chunk ?? Buffer.alloc(0)).toString('utf8')
      if (out.length > APPLY_BODY_CAP) finish('')
    }
    const onEnd = () => finish(out)
    req.on('data', onData)
    req.on('end', onEnd)
  })
}

/**
 * console Apply handler（E3 写通路，测试注入 fetch/bridge/reject 全独立）：
 *   浏览器 POST /core-console/apply → connection 鉴权栅栏 → cored POST <bridge.url>/v1/apply
 * 主体由宿主注入（opts.subject 覆写请求体任何 subject 声明——浏览器不携带主体，red line：
 * 主体注入属宿主行为）；非 POST=405（写路由方法分立）；栅栏缺席=fail-closed 拒全部；
 * cored 未就绪=503；上游不可达=502（与读代理同口径）；请求体不可解析=400。
 */
export function createApplyHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  subject: ApplySubject
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  return async function applyHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    // 写面 fail-closed（比读代理更严）：栅栏回调缺席=拒全部——写路由只在显式装配了鉴权
    // 栅栏的宿主上放行（读代理的 fail-closed 在装配层，写面在 handler 内再锁一道）。
    if (!opts.reject) {
      res.statusCode = 401
      res.end()
      return
    }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if ((req.method ?? 'GET') !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    // 请求体：JSON 对象必需；subject 一律由宿主注入（剥除客户端声明——写主体是宿主断言）。
    let parsed: Record<string, unknown>
    try {
      const bodyText = await readRequestBody(req)
      parsed = JSON.parse(bodyText || '{}')
    } catch {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
      return
    }
    delete parsed.subject
    const upstream = { ...parsed, subject: opts.subject }
    let out: Awaited<ReturnType<FetchLike>>
    try {
      out = await fetchImpl(opts.bridge.url.replace(/\/+$/, '') + '/v1/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(upstream),
      })
    } catch (e) {
      sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
      return
    }
    const text = await out.text()
    res.statusCode = out.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }
}

/**
 * console 草稿路由 handler（E4 写通路，测试注入 fetch/bridge/reject 全独立）：
 *   浏览器 POST /core-console/drafts            → cored POST /v1/drafts（落稿 upsert）
 *   浏览器 DELETE /core-console/drafts/{k}/{n}  → cored DELETE /v1/drafts/{k}/{n}?scope=（弃稿）
 * 栅栏缺席=fail-closed 拒全部（与 apply 路由同款 handler 内再锁一道）；方法/路径分立：
 * exact 段只收 POST、子路径只收 DELETE（其余 405 allow: POST,DELETE）；体不可解析=400；
 * cored 未就绪=503；上游不可达=502；状态码/载荷透传（404 无稿/400 无主或空稿照传）。
 */
export function createDraftsHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  fetchImpl?: FetchLike
  fieldManager?: string
}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const defaultFM = opts.fieldManager ?? DEFAULT_DRAFT_FIELD_MANAGER
  return async function draftsHandler(req: HttpReqLike, res: HttpResLike): Promise<void> {
    if (!opts.reject) {
      res.statusCode = 401
      res.end()
      return
    }
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if (!opts.bridge.url) {
      sendJson(res, 503, { error: 'cored 未就绪（桥接未完成）' })
      return
    }
    const url = new URL(String(req.url ?? '/'), 'http://localhost')
    const rest = url.pathname.slice(CONSOLE_DRAFTS_PATH.length)
    const base = opts.bridge.url.replace(/\/+$/, '')
    if (rest === '' || rest === '/') {
      // 落稿 upsert（exact 段）：{kind,scope,name,content,fieldManager,reasonRef,baseResourceVersion}
      if ((req.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST, DELETE')
        res.end()
        return
      }
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse((await readRequestBody(req)) || '{}')
      } catch {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, { error: '请求体不可解析（需 JSON 对象）' })
        return
      }
      if (!parsed.fieldManager) parsed.fieldManager = defaultFM // 客户端缺主=宿主补（无主稿 cored 400）
      let out: Awaited<ReturnType<FetchLike>>
      try {
        out = await fetchImpl(base + '/v1/drafts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed),
        })
      } catch (e) {
        sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
        return
      }
      const text = await out.text()
      res.statusCode = out.status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(text)
      return
    }
    // 弃稿（子路径）：DELETE /core-console/drafts/{kind}/{name}?scope=
    if ((req.method ?? 'GET') !== 'DELETE') {
      res.statusCode = 405
      res.setHeader('allow', 'POST, DELETE')
      res.end()
      return
    }
    if (rest.includes('..')) {
      sendJson(res, 404, { error: 'not found（路径穿越拒绝）' })
      return
    }
    let out: Awaited<ReturnType<FetchLike>>
    try {
      out = await fetchImpl(base + '/v1/drafts' + rest + url.search, { method: 'DELETE' })
    } catch (e) {
      sendJson(res, 502, { error: `cored 不可达: ${String((e as Error)?.message ?? e)}` })
      return
    }
    const text = await out.text()
    res.statusCode = out.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }
}

/** agent-comm 四 op 工具名（§5.3：agent 只见四个 op——工具名=协议 op 名裸用，
 *  E5a 判别器（op 名 ∈ 文档面声明集）零改动即命中 ConnectorOps 卡）。 */
export const AGENT_COMM_TOOL_NAMES = [...AGENT_COMM_KINDS]

/**
 * agent-comm 四 op 工具装配（E5b；cross-agent.md §5 协议 v0.1）：
 *   ctx.tools.register 四工具（dispatch/query/interrupt/inbox）——工具宿主=本 plugin
 *   对 dsh 宿主工具面的贡献（R-ENG-3 归属裁决 2026-11-25：非 connector 驱动，不入
 *   common_connector）。传输=同机进程内注册表（ctx.agents 活体 + 文档面 Agent 对象解析）；
 *   会话控制器 prompt/cancel 面=回调式 inject 软出现（§1.11 补注①教训：声明式 inject
 *   加新服务名会 cordis apply 停等=整面板缺席）。
 * 防御面：tools/agents/sessionController 任一缺席宿主=对应能力不注册/解析必拒，不炸宿主；
 * 撞名（dsh 保留 run_code+既有工具）=warn+跳过该 op。
 */
export function mountAgentCommTools(ctx: any, bridge: CoreSystemBridge, comm: CommState = createCommState()): void {
  const mailbox = comm.mailbox
  const journal = comm.journal
  const faces: {
    prompt?: AgentCommDeps['prompt']
    cancel?: AgentCommDeps['cancel']
    agents?: AgentCommDeps['agents']
  } = {}
  // 回调式软出现（声明式 inject 加新服务名=apply 停等；ctx.<服务> 直访=without inject 抛错
  // ——§1.11 补注①护栏语义，agents 同款实证 2026-11-25 探针）。缺席宿主回调永不启动。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionController'], (sub: any) => {
      const sc = Reflect.get(sub, 'sessionController')
      if (!sc || typeof sc.prompt !== 'function') return // 防御面：inject 已保证，缺席即不接
      faces.prompt = (req) => sc.prompt(req, AbortSignal.timeout(10_000))
      if (typeof sc.cancel === 'function') faces.cancel = (req) => sc.cancel(req)
    })
    // 同机活体注册表（to 解析第③步）：缺席回调=活体面解析必拒（诚实降级不冒充）
    ctx.inject(['agents'], (sub: any) => {
      const ag = Reflect.get(sub, 'agents')
      if (ag && typeof ag.get === 'function') faces.agents = ag
    })
    // 四 op 工具注册（tools 服务就绪后；撞名=warn+跳过该 op 其余照常）
    ctx.inject(['tools'], (sub: any) => {
      console.error('[core-system-diag] inject([tools]) 回调触发')
      const tools = Reflect.get(sub, 'tools')
      if (!tools || typeof tools.register !== 'function') { console.error('[core-system-diag] tools 服务缺席'); return }
      registerAgentCommTools(ctx, tools, (kind, args, caller) =>
        executeAgentCommOp(kind, args, { core: bridge, ...faces, callerAgentId: caller }, mailbox, undefined, journal))
    })
    console.error('[core-system-diag] agent-comm inject 挂起（sessionController/agents/tools 三回调已登记）')
  } else if (ctx.tools && typeof ctx.tools.register === 'function') {
    // 无 inject 能力宿主（测试假体/极简壳）：tools 直取容错
    registerAgentCommTools(ctx, ctx.tools, (kind, args, caller) =>
      executeAgentCommOp(kind, args, { core: bridge, ...faces, callerAgentId: caller }, mailbox, undefined, journal))
  }
}

/** 四 op 工具注册核（tools 面就绪后调用；run=注入 faces+bridge+mailbox 的分派闭包）。 */
function registerAgentCommTools(
  ctx: any,
  tools: { register(definition: any): () => void },
  run: (kind: (typeof AGENT_COMM_KINDS)[number], args: unknown, callerAgentId?: string) => Promise<AgentCommResult>,
): void {
  const defs = [
    {
      name: 'dispatch',
      description: 'agent-comm 派任务（cross-agent.md §5.2）：向另一个已注册 agent 派一次意图（异步）。'
        + ' to 必须是文档面在册且本机活体在册的 agent（agent/<name>@<scope>）；必带 token（权限凭据）。'
        + ' 回执=accepted（消息入对方会话队列）；对方的业务回复在其 SessionLog（v0.1 不自动回传）。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>' },
        text: { type: 'string', required: true, description: '任务意图（一次意图一段文本）' },
        token: { type: 'string', required: true, description: '权限 token（⊆ 发起方权限面；缺失=拒）' },
        hint: { type: 'string', description: '可选执行提示' },
        refs: { type: 'array', items: { type: 'string' }, description: '可选文档面引用（systems/<s>/path#revN）' },
      },
      args: (a: any) => ({ to: a.to, text: a.text, token: a.token, hint: a.hint, refs: a.refs }),
    },
    {
      name: 'query',
      description: 'agent-comm 只读问询（cross-agent.md §5.2）：查另一个已注册 agent 的状态快照（活体/文档相位/待处理输入）。'
        + ' 同步返回；v0.1=只读快照（对话式问询请用 dispatch——对方回复在其 SessionLog）。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>' },
        text: { type: 'string', description: '可选问询说明（v0.1 仅入信封审计，不投递）' },
      },
      args: (a: any) => ({ to: a.to, text: a.text }),
    },
    {
      name: 'interrupt',
      description: 'agent-comm 取消/插话（cross-agent.md §5.2）：打断另一个已注册 agent 的活跃回合（对应 dsh cancel/steer）。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>' },
        reason: { type: 'string', description: '可选打断原因（入 ops 留痕）' },
      },
      args: (a: any) => ({ to: a.to, reason: a.reason }),
    },
    {
      name: 'inbox',
      description: 'agent-comm 拉取未消费消息（cross-agent.md §5.2）：拉取目标 agent 的 agent-comm 收件箱（error reply 落账；按 id 幂等去重），'
        + ' 并附其活体 pending 输入计数。对等场景没有共同上级替你翻 SessionLog——拉取是唯一入口。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>（通常填自己=拉自己的收件箱）' },
        limit: { type: 'integer', description: '最多返回条数（缺省全部）' },
      },
      args: (a: any) => ({ to: a.to, ...(a.limit !== undefined ? { payload: { limit: a.limit } } : {}) }),
    },
  ]

  let registered = 0
  for (const d of defs) {
    try {
      tools.register({
        name: d.name,
        description: d.description,
        parameters: d.parameters as any,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              // output schema DSL 约束（2026-11-25 探针实证）：properties 节点不收 required
              // （required 只在隐式参数根）；'json' 类型不被 output 接受→对象开面。
              ok: { type: 'boolean' },
              op: { type: 'string' },
              envelopeId: { type: 'string' },
              to: { type: 'string' },
              detail: { type: 'object', additionalProperties: true },
              error: { type: 'string' },
            },
          },
          render: (_args: unknown, value: any) => {
            const lines = [
              `agent-comm ${value.op} → ${value.to}`,
              value.ok ? `accepted（envelope ${value.envelopeId}）` : `failed：${String(value.error ?? 'unknown')}`,
            ]
            if (value.detail !== undefined) lines.push(JSON.stringify(value.detail))
            return [{ type: 'text', text: lines.join('\n') }]
          },
        },
        isConcurrencySafe: () => true,
        async execute(args: any, exec: any) {
          return run(d.name as (typeof AGENT_COMM_KINDS)[number], d.args(args ?? {}), exec?.agent?.id ?? undefined)
        },
      })
      registered++
    } catch (e) {
      console.error('[core-system-diag] 工具 %s 注册失败：%s', d.name, String((e as Error)?.stack ?? e).slice(0, 500))
    }
  }
  console.error('[core-system-diag] agent-comm 注册完成 %d/4', registered)
}

/** 宿主侧装配（软出现：web profile 才有 webServer/connection；headless 宿主零影响）。
 *  用 ctx.inject 等待依赖可用——依赖缺席的 profile 上回调永不启动，插件本体不受影响。 */
export function mountConsoleRoutes(ctx: {
  inject?(deps: string[], apply: (sub: any) => void | (() => void)): unknown
}, bridge: { url: string }, applySubject: ApplySubject = DEFAULT_APPLY_SUBJECT, comm?: CommState): void {  if (typeof ctx.inject !== 'function') return // 防御面：无 inject 能力的宿主（测试假体/极简壳）零影响
  ctx.inject(['webServer', 'connection'], (sub: any) => {
    const webServer = Reflect.get(sub, 'webServer') as WebServerLike | undefined
    const connection = Reflect.get(sub, 'connection') as ConnectionLike | undefined
    if (!webServer || !connection) return // 防御面：inject 已保证，缺席即不注册（不降级）
    const reject = (req: { headers: unknown }) => connection.requestRejection(req)
    const unregisters = [
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
      ...(comm ? [webServer.register({
        kind: 'exact', path: CONSOLE_COMM_PATH,
        handler: createCommHandler({ state: comm, reject }),
      })] : []),
    ]
    return () => unregisters.forEach((u) => u())
  })
}

/** 旧装配入口别名（E2 只读代理；现由 mountConsoleRoutes 承接——契约名保留兼容）。 */
export const mountConsoleProxy = mountConsoleRoutes

/** 解析 cored 就绪行（契约：cored-bridge.md §1）：`CORED_READY addr=… scheme_version=… kinds=<n> [apply=on|off]`。
 * 解析宽松：尾随令牌（如 apply=）不参与匹配——旧桥/新桥互不破坏。 */
export function parseReadyLine(line: string): { addr: string; schemeVersion: string; kinds: number } | null {
  const m = /^CORED_READY addr=(\S+) scheme_version=(\S+) kinds=(\d+)/.exec(line.trim())
  if (!m) return null
  return { addr: m[1], schemeVersion: m[2], kinds: Number(m[3]) }
}

/** 构造对象读面 URL（路径段逐段转义，scope 经查询串注入；只产生 GET 地址，无写端点）。 */
function objectsUrl(base: string, kind: string, name?: string, scope?: string): string {
  const segs = [base.replace(/\/+$/, ''), 'v1', 'objects', encodeURIComponent(kind)]
  if (name !== undefined) segs.push(encodeURIComponent(name))
  return segs.join('/') + (scope ? `?scope=${encodeURIComponent(scope)}` : '')
}

/** 统一查询核：传输失败/HTTP 非 2xx/载荷不可解析一律折为 ok=false，不抛错。 */
async function query<T>(fetchImpl: FetchLike, url: string, project: (body: any) => T): Promise<CoreQueryResult<T>> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchImpl(url)
  } catch (e) {
    return { ok: false, status: null, error: String((e as Error)?.message ?? e) }
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body?.error ? `：${body.error}` : ''
    } catch { /* 非 JSON 错误体，留状态码即可 */ }
    return { ok: false, status: res.status, error: `HTTP ${res.status}${detail}` }
  }
  try {
    return { ok: true, data: project(await res.json()) }
  } catch (e) {
    return { ok: false, status: res.status, error: `载荷不可解析: ${String((e as Error)?.message ?? e)}` }
  }
}

/** get 载荷投影：{kind,name,scope,resourceVersion,content}（契约 §2）。 */
function projectObject(b: any): CoreObject {
  return {
    kind: String(b.kind), name: String(b.name), scope: String(b.scope),
    resourceVersion: Number(b.resourceVersion), content: String(b.content),
  }
}

/** list 载荷投影：瘦身引用数组（无正文）。 */
function projectRefs(b: any): CoreObjectRef[] {
  return (Array.isArray(b.objects) ? b.objects : []).map((o: any) => ({
    kind: String(o.kind), name: String(o.name), scope: String(o.scope),
    resourceVersion: Number(o.resourceVersion),
  }))
}

/** 持续只读查询句柄（fetch 封装 §2 对象读面；不引入新写路径）。 */
export function createQueryHandle(baseUrl: string, fetchImpl: FetchLike = fetch): CoreSystemQueryHandle {
  return {
    get: (kind, scope, name) => query(fetchImpl, objectsUrl(baseUrl, kind, name, scope), projectObject),
    list: (kind, scope) => query(fetchImpl, objectsUrl(baseUrl, kind, undefined, scope), projectRefs),
  }
}

/** 构造桥对象：字段就地可变（cordis：先 provide 后填值），句柄箭头函数每次调用读最新 url。 */
function makeBridge(): CoreSystemBridge {
  const bridge: CoreSystemBridge = {
    url: '',
    scheme: null,
    kinds: null,
    get: (kind, scope, name) => query(fetch, objectsUrl(bridge.url, kind, name, scope), projectObject),
    list: (kind, scope) => query(fetch, objectsUrl(bridge.url, kind, undefined, scope), projectRefs),
  }
  return bridge
}

/** 就绪后转发一次 scheme 查询：概览 + 对象类型清单（只读面），结果就地填入 bridge。 */
async function probeScheme(base: string, bridge: CoreSystemBridge): Promise<void> {
  try {
    const res = await fetch(`${base}/v1/scheme`)
    if (res.ok) bridge.scheme = (await res.json()) as Record<string, unknown>
    const list = await fetch(`${base}/v1/scheme/kinds`)
    if (list.ok) {
      const body = (await list.json()) as { kinds?: { name: string }[] }
      bridge.kinds = (body.kinds ?? []).map((k) => k.name)
    }
  } catch {} // 查询失败不阻断宿主启动；结果如实留在 bridge（kinds=null 即未通）
}

export default async function apply(ctx: any, config: Config = {}) {
  // agent-comm 运行时落账状态（一次激活一份：mailbox=v0.1 既有 + journal=E6 comm 流水）——
  // 工具面写、读路由读（GET /core-console/comm），同仓同进程。
  const comm = createCommState()
  if (config.coredUrl) {
    const bridge = makeBridge()
    bridge.url = config.coredUrl
    ctx.provide('coreSystem', bridge)
    mountConsoleRoutes(ctx, bridge, config.applySubject, comm)
    mountAgentCommTools(ctx, bridge, comm)
    await probeScheme(bridge.url, bridge)
    ctx.logger.info('core-system: 已接入运行中的 cored %s（kinds=%s）', bridge.url, bridge.kinds?.length ?? '?')
    return
  }

  const schemePath = config.schemePath || process.env.CORE_SYSTEM_SCHEME || ''
  if (!schemePath) {
    ctx.logger.warn('core-system: 未配置 scheme 源（config.schemePath / CORE_SYSTEM_SCHEME），cored 桥接不启动')
    return
  }
  if (config.autoSpawn === false) {
    ctx.logger.info('core-system: autoSpawn=false，本宿主不拉起 cored')
    return
  }

  const coredBin = config.coredBin || process.env.CORE_SYSTEM_CORED_BIN || 'cored'
  const readyTimeoutMs = config.readyTimeoutMs ?? 10_000
  const args = [...(config.coredArgs ?? []), '--scheme', schemePath]
  const child: ChildProcess = spawn(coredBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  ctx.logger.info('core-system: 拉起 cored（bin=%s scheme=%s pid=%s）', coredBin, schemePath, child.pid)

  // 服务先声明后填值（cordis：未 provide 的属性不可 set）；fiber 卸载即自动注销。
  const bridge = makeBridge()
  ctx.provide('coreSystem', bridge)
  // console v2 数据通路（E2 读代理+E3 写路由）：webServer+connection 可用的宿主上注册
  // （/core-console/api → cored 读面；/core-console/apply → cored 唯一写入口，主体宿主注入；
  // headless 宿主无 webServer，回调永不启动）。
  mountConsoleRoutes(ctx, bridge, config.applySubject, comm)
  // agent-comm 四 op 工具面（E5b）：ctx.tools 可用的宿主上注册（dispatch/query/interrupt/inbox
  // ——cross-agent.md §5 v0.1；to 解析=文档面 bridge+ctx.agents 活体，sessionController 面=回调软出现）。
  mountAgentCommTools(ctx, bridge, comm)

  // 退场回收：无论插件因何种原因卸载，子进程一并带走。
  ctx.effect(() => {
    return () => {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
    }
  }, 'core-system:cored-child')

  const ready = await waitForReady(child, readyTimeoutMs, (line) => ctx.logger.warn('core-system|cored: %s', line))
  if (!ready) {
    ctx.logger.error('core-system: cored 未在 %dms 内就绪（bin=%s），桥接失败', readyTimeoutMs, coredBin)
    return
  }
  bridge.url = `http://${ready.addr}`
  ctx.logger.info('core-system: cored 就绪 %s（scheme_version=%s kinds=%d）', bridge.url, ready.schemeVersion, ready.kinds)

  await probeScheme(bridge.url, bridge)
  ctx.logger.info(
    'core-system: scheme 查询完成 —— %s/%s（kinds=%d：%s）；持续查询句柄已挂 ctx.coreSystem（get/list，只读）',
    (bridge.scheme as any)?.apiVersion ?? '?',
    (bridge.scheme as any)?.version ?? '?',
    bridge.kinds?.length ?? 0,
    (bridge.kinds ?? []).join(','),
  )
}

/** 等待就绪行；stderr 逐行旁路给宿主日志（onLog），部署侧可从服务日志审计 cored 输出。 */
async function waitForReady(
  child: ChildProcess,
  timeoutMs: number,
  onLog: (line: string) => void,
): Promise<{ addr: string; schemeVersion: string; kinds: number } | null> {
  return new Promise((resolve) => {
    let pending = ''
    let settled = false
    let errPending = ''
    const done = (value: { addr: string; schemeVersion: string; kinds: number } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('exit', onExit)
      resolve(value)
    }
    const drain = (buffer: string, emit: (line: string) => void): string => {
      let rest = buffer
      let idx: number
      while ((idx = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, idx).replace(/\r$/, '')
        rest = rest.slice(idx + 1)
        if (line) emit(line)
      }
      return rest
    }
    const onStdout = (chunk: Buffer | string) => {
      pending += chunk.toString()
      let parsed: ReturnType<typeof parseReadyLine> = null
      pending = drain(pending, (line) => {
        const hit = parseReadyLine(line)
        if (hit && !parsed) parsed = hit
      })
      if (parsed) done(parsed)
    }
    const onStderr = (chunk: Buffer | string) => {
      errPending = drain(errPending + chunk.toString(), onLog)
    }
    const onExit = () => done(null)
    const timer = setTimeout(() => done(null), timeoutMs)
    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('exit', onExit)
  })
}
