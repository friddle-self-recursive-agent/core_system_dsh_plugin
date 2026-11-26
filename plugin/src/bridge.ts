// bridge.ts —— cored 对象读面桥（契约：core_system_instance/runtime/cored-bridge.md）。
// R-ENG-7 拆分：原 index.ts 的查询句柄/投影/就绪行解析收拢于此，零语义变化。
// 只发 GET，不引入新写路径——写路径唯一入口仍是 cored 的 POST /v1/apply 且缺省关闭。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FetchLike } from './http.ts'

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
export function makeBridge(): CoreSystemBridge {
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
export async function probeScheme(base: string, bridge: CoreSystemBridge): Promise<void> {
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

/** 写 cored 地址发现文件（R-UX-8；部署侧配置路径，0600；失败不阻断宿主——CLI 仍可显式 --server）。 */
export function writeCoredAddr(file: string | undefined, url: string): void {
  if (!file || !url) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, url.replace(/\/+$/, '') + '\n', { mode: 0o600 })
  } catch (e) {
    console.error('[core-system-diag] cored 地址文件写入失败 %s: %s', file, String((e as Error)?.message ?? e))
  }
}
