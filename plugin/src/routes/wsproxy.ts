// routes/wsproxy.ts —— console 实时流 WS upgrade 代理（/core-console/ws → cored /v1/stream）。
// R-ENG-7 拆分新增面（任务：WS 代理路由）。语义：
//   ① connection 鉴权栅栏 fail-closed（requestRejection 同款：401/403 直写 HTTP 错误行并断开，
//      栅栏缺席=拒全部——与写路由同口径，绝不降级为无鉴权转发）；
//   ② bridge.url 就绪后按 host/port net.connect 上游，重写请求行（GET <upstream-path>?<原查询串>
//      + Host 换上游权威地址），sec-websocket-* 与其余头原样透传，head（早期数据）随后；
//   ③ 双向透传（升级后帧内容宿主零解析零旁路）；任一侧断开/出错即对侧销毁。
//   透传实现注记：不用 pause/resume+pipe 舞步（pause 态会吞掉对端 FIN——宿主侧 socket 收不
//   到浏览器断开事件，升级后连接对漏关）；改用 data 事件+早到数据队列——socket 一进来即挂
//   data 监听（恒流动），上游就绪前的早到块入队，请求行先行写出后回放；断开事件因此恒可
//   观测，两侧互锁销毁不漏。
import net from 'node:net'
import { CONSOLE_WS_UPSTREAM_PATH } from '../config.ts'
import type { HttpReqLike } from '../http.ts'

/** 极小升级 socket 结构面（真实侧=node Duplex；测试可注入轻量假体）。 */
export interface WsSocketLike {
  write(chunk: string | Uint8Array, cb?: (err?: Error | null) => void): unknown
  end(chunk?: string | Uint8Array): unknown
  destroy(err?: Error): unknown
  on(event: string, cb: (...args: any[]) => void): unknown
}

/**
 * WS upgrade 代理 handler 工厂（测试注入 reject/bridge/netImpl 全独立）：
 *   浏览器 ws://…/core-console/ws → connection 鉴权栅栏 → TCP 透传 cored <bridge.url>/v1/stream。
 * 升级响应（101 与否）原样回传——宿主只认 HTTP 升级交换，不解析 WS 帧。
 */
export function createConsoleWsUpgradeHandler(opts: {
  bridge: { url: string }
  reject?: (req: { headers: unknown }) => 401 | 403 | undefined
  netImpl?: typeof net
}) {
  const netMod = opts.netImpl ?? net
  return function consoleWsUpgradeHandler(req: HttpReqLike, socket: WsSocketLike, head: Buffer): void {
    const hs = (req.headers ?? {}) as Record<string, string | string[] | undefined>
    const cookie = typeof hs.cookie === 'string' ? hs.cookie : ''
    console.error('[core-system-diag] ws upgrade 到达插件 url=%s cookie=%s upgrade=%s', String(req.url ?? '/'), cookie || 'no', String(hs.upgrade ?? ''))
    // fail-closed 拒绝：直写 HTTP 错误行（升级握手未完成，无 101 即断）。
    const fail = (status: number, reason: string) => {
      try {
        socket.write(`HTTP/1.1 ${status} ${reason}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`)
      } catch { /* socket 已半关=直接销毁 */ }
      socket.destroy()
    }
    // 写面 fail-closed（读代理/写路由同款再锁一道）：栅栏回调缺席=拒全部。
    if (!opts.reject) return fail(401, 'Unauthorized')
    const rejection = opts.reject({ headers: req.headers })
    if (rejection !== undefined) {
      console.error('[core-system-diag] ws upgrade 被宿主栅栏拒绝 status=%s', rejection)
      return fail(rejection, rejection === 401 ? 'Unauthorized' : 'Forbidden')
    }
    if (!opts.bridge.url) return fail(503, 'Service Unavailable')
    let base: URL
    try {
      base = new URL(opts.bridge.url)
    } catch {
      return fail(502, 'Bad Gateway')
    }
    const port = Number(base.port) || (base.protocol === 'https:' ? 443 : 80)
    // 原查询串跟随（scope/trace 等过滤参数）；路径恒指 cored 流面。
    let search = ''
    try { search = new URL(String(req.url ?? '/'), 'http://localhost').search } catch { /* 无查询串=空 */ }
    // 重写请求行+Host（上游权威地址）；其余头（含 sec-websocket-*）原样透传。
    const headerLines: string[] = []
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      if (name.toLowerCase() === 'host') continue // Host 由上游权威地址重写
      headerLines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    }
    const request =
      `GET ${CONSOLE_WS_UPSTREAM_PATH}${search} HTTP/1.1\r\n` +
      `Host: ${base.host}\r\n` +
      headerLines.join('\r\n') + '\r\n' +
      '\r\n'
    // 上游就绪前的早到块队列（浏览器在 101 前本不发帧——防御面照写，不丢字节）。
    const early: Buffer[] = []
    let upstream: net.Socket | null = null
    let connected = false // 上游 TCP 已接+握手请求已写（此后错误=直接断两侧，不再写 502 撕帧）
    // 浏览器→上游：挂 data 即流动——断开/FIN 恒可观测（不 pause，见文件头注记）。
    socket.on('data', (chunk: Buffer) => {
      if (connected && upstream) upstream.write(chunk)
      else early.push(chunk)
    })
    const upstreamSock = netMod.connect({ host: base.hostname, port })
    upstreamSock.on('connect', () => {
      connected = true
      upstream = upstreamSock
      console.error('[core-system-diag] ws 代理上游已连 %s:%s 请求行=%s', base.hostname, port, request.split('\r\n')[0])
      upstreamSock.write(request) // 重写后的升级请求行先行（早到块在其后回放，次序不乱）
      if (head && head.length > 0) upstreamSock.write(head)
      for (const chunk of early) upstreamSock.write(chunk)
      early.length = 0
      upstreamSock.pipe(socket as never) // 上游→浏览器（101 应答+后续帧）
    })
    upstreamSock.on('error', (e: Error) => {
      if (!connected) {
        // TCP 未就绪即败=升级失败口径（502）；已升级后中断=直接断两侧（帧流内不写字）。
        fail(502, 'Bad Gateway')
        console.error('[core-system-diag] ws 代理上游不可达 %s:%s: %s', base.hostname, port, String(e?.message ?? e))
        return
      }
      upstreamSock.destroy()
      socket.destroy()
    })
    upstreamSock.on('data', function firstChunk(d: Buffer) {
      console.error('[core-system-diag] ws 上游首块=%s', d.toString('utf8', 0, 120).replace(/\r\n/g, '|'))
    })
    upstreamSock.on('close', () => socket.destroy())
    // 宿主侧升级 socket allowHalfOpen=true（node http.Server 语义）：浏览器断开先发 FIN——
    // 只触发 'end' 不触发 'close'，漏挂 end=半开连接漏关（对端早没了本侧还挂着）。
    socket.on('end', () => upstreamSock.destroy())
    socket.on('error', () => upstreamSock.destroy())
    socket.on('close', () => upstreamSock.destroy())
  }
}
