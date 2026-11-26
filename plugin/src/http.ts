// http.ts —— HTTP 结构面类型 + JSON 响应/请求体读取小工具（R-ENG-7 拆分，零语义变化）。
// 全部为「最小结构面」投影（真实侧来自 node:http；测试可注入假体）。

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

/** webServer 的最小注册面（dsh-host-webserver 类型投影；测试可注入假体）。
 *  registerUpgrade=WS 升级路由注册（缺席宿主=零 WS 代理，软出现不炸宿主）。 */
export interface WebServerLike {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: HttpReqLike, res: HttpResLike) => void | Promise<void> }): () => void
  registerUpgrade?(route: {
    path: string
    handler: (req: HttpReqLike, socket: import('node:stream').Duplex, head: Buffer) => void
  }): (() => void) | void
}
/** connection 的最小信任面（open-in-app 同款 requestRejection：401=未认证，403=Host/Origin 拒绝，undefined=放行）。 */
export interface ConnectionLike {
  requestRejection(req: { headers: unknown }): 401 | 403 | undefined
}

/** 请求级主体（cored POST /v1/apply subject 字段投影；cored-bridge.md §2.1）。 */
export interface ApplySubject {
  user: string
  roles?: string[]
  groups?: string[]
}

/** 统一 JSON 响应（no-store：读面是活体投影，缓存即撕读）。 */
export function sendJson(res: HttpResLike, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** POST 体上限（与 cored apply 入口同量级；超出=400，不无界缓冲）。 */
const APPLY_BODY_CAP = 4 << 20

/** 读 POST 请求体：流面在=逐块收集（真实 IncomingMessage）；string 面在=直取（测试假体）；
 *  两者皆缺=空体（cored 侧 400 兜底）。超限提前收口。 */
export async function readRequestBody(req: HttpReqLike): Promise<string> {
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
