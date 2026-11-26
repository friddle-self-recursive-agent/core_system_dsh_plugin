// wsproxy.test.ts —— console 实时流 WS 升级代理验收（/core-console/ws → cored /v1/stream）：
// ① connection 鉴权栅栏 fail-closed（栅栏缺席=401 拒全部、403 透传——升级握手未完成即断，
//    上游零触达）；② 101 透传 + 双向帧往返（真 node:http 上游手工 upgrade 交换 + 真 TCP
//    pipe——宿主只认 HTTP 升级交换，帧内容零解析）；③ 装配面（registerUpgrade 能力缺席
//    宿主=软出现零 WS 面；退场 disposer 随 inject 回调清理）。
// 全假宿主/真 socket：无部署锚点（R-PUB），上游=本测试进程内 http.Server。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { CONSOLE_WS_PATH, mountConsoleRoutes, type WebServerLike } from '../src/index.ts'

// ── 假宿主：register/registerUpgrade 假 webServer + ctx.inject 装配范式 ──────────────
type UpgradeRoute = { path: string; handler: (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void }

function fakeWebServer(withUpgrade: boolean): {
  webServer: WebServerLike
  registered: { kind: string; path: string }[]
  route: () => UpgradeRoute | null
} {
  const registered: { kind: string; path: string }[] = []
  let upgradeRoute: UpgradeRoute | null = null
  const webServer: WebServerLike = {
    register(route: any) {
      registered.push(route)
      return () => {}
    },
    ...(withUpgrade ? {
      registerUpgrade(route: UpgradeRoute) {
        upgradeRoute = route
        return () => { upgradeRoute = null }
      },
    } : {}),
  }
  return { webServer, registered, route: () => upgradeRoute }
}

/** dsh 宿主 upgrade 分发范式：真 http server 收 upgrade → 路由表命中 → handler(req, socket, head)。 */
function hostServer(route: () => UpgradeRoute | null): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(() => { /* 仅 upgrade 面，普通 HTTP 不用 */ })
    server.on('upgrade', (req, socket, head) => {
      const hit = route()
      if (!hit || req.url !== hit.path) { socket.destroy(); return }
      hit.handler(req as unknown as never, socket as unknown as never, head)
    })
    server.listen(0, '127.0.0.1', () => { server.unref(); resolve(server) })
  })
}

/** 假 cored 上游：真 http server，upgrade 到达=101 应答 + 双向 echo（透传往返判定锚）。 */
function upstreamServer(): Promise<{ server: http.Server; url: string; hits: () => number }> {
  let hits = 0
  return new Promise((resolve) => {
    const server = http.createServer(() => { /* 仅 upgrade 面 */ })
    server.on('upgrade', (_req, socket, head) => {
      hits++
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wsproxy-test-accept\r\n\r\n')
      if (head?.length) socket.write(head)
      socket.on('data', (d: Buffer) => socket.write(d)) // echo：代理双向 pipe 的端到端证明
      // allowHalfOpen=true（http.Server 语义）：代理侧断开先到 FIN（'end'）——不主动断=半开漏挂
      socket.on('end', () => socket.destroy())
    })
    server.listen(0, '127.0.0.1', () => {
      server.unref() // fetch/keep-alive 不阻塞测试进程退出
      resolve({ server, url: `http://127.0.0.1:${(server.address() as any).port}`, hits: () => hits })
    })
  })
}

/** 原始升级客户端：真 TCP socket 发 WebSocket 握手，读到首个 HTTP 响应头块为止。 */
function wsHandshake(port: number, path = CONSOLE_WS_PATH): Promise<{
  statusLine: string
  headers: string
  socket: net.Socket
  rest: Buffer
}> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`)
    })
    let buf = Buffer.alloc(0)
    const onFail = (e: Error) => { socket.destroy(); reject(e) }
    socket.on('error', onFail)
    socket.on('data', function onData(d: Buffer) {
      buf = Buffer.concat([buf, d])
      const idx = buf.indexOf('\r\n\r\n')
      if (idx < 0) return
      socket.off('data', onData)
      socket.off('error', onFail)
      const headText = buf.subarray(0, idx).toString('utf8')
      const rest = buf.subarray(idx + 4)
      resolve({ statusLine: headText.split('\r\n')[0], headers: headText, socket, rest })
    })
  })
}

/** 帧往返：升级后写一段载荷，断言原样回来（双向 pipe 透传证明）。 */
function echoRoundTrip(socket: net.Socket, seed: Buffer, prefix: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.from(prefix)
    const onFail = (e: Error) => { socket.destroy(); reject(e) }
    socket.on('error', onFail)
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('echo 超时（双向 pipe 未通）')) }, 3000)
    socket.on('data', function onData(d: Buffer) {
      buf = Buffer.concat([buf, d])
      if (buf.length >= prefix.length + seed.length) {
        clearTimeout(timeout)
        socket.off('data', onData)
        socket.off('error', onFail)
        resolve(buf)
      }
    })
    socket.write(seed)
  })
}

// ── ① fail-closed：栅栏缺席=401；403 透传；cored 未就绪=503；上游零触达 ─────────────
test('ws 代理 fail-closed：栅栏缺席=401（handler 内再锁一道，绝不降级为无鉴权转发）', async () => {
  const { createConsoleWsUpgradeHandler } = await import('../src/routes/wsproxy.ts')
  const upstream = await upstreamServer()
  const host = await hostServer(() => ({
    path: CONSOLE_WS_PATH,
    handler: createConsoleWsUpgradeHandler({ bridge: { url: upstream.url } }) as never,
  }))
  const r = await wsHandshake((host.address() as any).port)
  assert.match(r.statusLine, /^HTTP\/1\.1 401/, '栅栏回调缺席=401（fail-closed）')
  assert.equal(upstream.hits(), 0, '被拒升级不得触达上游')
  r.socket.destroy()
})

test('ws 代理 fail-closed：403 透传、cored 未就绪=503（升级握手未完成即断）', async () => {
  const { webServer, route } = fakeWebServer(true)
  const upstream = await upstreamServer()
  const host = await hostServer(route)
  mountConsoleRoutes({
    inject(deps: string[], apply: (sub: any) => void | (() => void)) {
      const sub: Record<string, unknown> = { webServer, connection: { requestRejection: () => 403 } }
      apply(sub)
    },
  }, { url: upstream.url })
  const hit = route()
  assert.ok(hit, 'registerUpgrade 能力在=ws 路由在册')
  assert.equal(hit!.path, CONSOLE_WS_PATH)

  const r403 = await wsHandshake((host.address() as any).port)
  assert.match(r403.statusLine, /^HTTP\/1\.1 403/, '403 直写响应行（无 101）')
  assert.equal(upstream.hits(), 0, '被拒升级不得触达上游')
  r403.socket.destroy()

  // 栅栏放行但 bridge.url 空=503（诚实关断口径，不冒充 101）
  const { webServer: ws2, route: route2 } = fakeWebServer(true)
  const host2 = await hostServer(route2)
  mountConsoleRoutes({
    inject(deps: string[], apply: (sub: any) => void | (() => void)) {
      const sub: Record<string, unknown> = { webServer: ws2, connection: { requestRejection: () => undefined } }
      apply(sub)
    },
  }, { url: '' })
  const hit2 = route2()
  assert.ok(hit2)
  const r503 = await wsHandshake((host2.address() as any).port)
  assert.match(r503.statusLine, /^HTTP\/1\.1 503/, 'cored 未就绪=503')
  r503.socket.destroy()
})

// ── ② 101 透传 + 双向帧往返（真 socket pipe）─────────────────────────────────────
test('ws 代理透传：上游 101 回传 + 双向 echo 往返（帧内容宿主零解析）', async () => {
  const { webServer, route } = fakeWebServer(true)
  const upstream = await upstreamServer()
  const host = await hostServer(route)
  mountConsoleRoutes({
    inject(deps: string[], apply: (sub: any) => void | (() => void)) {
      const sub: Record<string, unknown> = { webServer, connection: { requestRejection: () => undefined } }
      apply(sub)
    },
  }, { url: upstream.url })
  const r = await wsHandshake((host.address() as any).port)
  assert.match(r.statusLine, /^HTTP\/1\.1 101/, '上游 101 原样回传浏览器')
  assert.match(r.headers, /Sec-WebSocket-Accept: wsproxy-test-accept/, 'sec-websocket-* 头透传')
  assert.equal(upstream.hits(), 1, '放行升级恰触达上游一次')
  const echoed = await echoRoundTrip(r.socket, Buffer.from('frame-payload-01'), r.rest)
  assert.ok(echoed.toString('utf8').includes('frame-payload-01'), '载荷经代理双向 pipe 原样往返')
  r.socket.destroy()
})

// ── ③ 装配面：registerUpgrade 缺席=软出现；退场 disposer 随 inject 回调清理 ─────────
test('ws 代理装配面：registerUpgrade 缺席宿主零 WS 面（不炸宿主）；disposer 注销 ws 路由', async () => {
  // 缺席 registerUpgrade（测试假体/旧版 dsh）：不抛错、零 ws 注册
  const { webServer, registered, route } = fakeWebServer(false)
  let disposed = false
  mountConsoleRoutes({
    inject(deps: string[], apply: (sub: any) => void | (() => void)) {
      const sub: Record<string, unknown> = { webServer, connection: { requestRejection: () => undefined } }
      const d = apply(sub) as () => void
      disposed = typeof d === 'function'
      if (disposed) d()
    },
  }, { url: 'http://127.0.0.1:9/' })
  assert.equal(route(), null, '无 registerUpgrade 能力=零 ws 路由')
  assert.ok(registered.length > 0, 'HTTP 路由照常注册（软出现）')
  assert.ok(disposed, '注册 disposer 应随插件退场返回')

  // 在册 disposer：注销后 ws 路由离场
  const { webServer: ws3, route: route3 } = fakeWebServer(true)
  mountConsoleRoutes({
    inject(deps: string[], apply: (sub: any) => void | (() => void)) {
      const sub: Record<string, unknown> = { webServer: ws3, connection: { requestRejection: () => undefined } }
      const d2 = apply(sub)
      if (typeof d2 === 'function') d2()
    },
  }, { url: 'http://127.0.0.1:9/' })
  assert.equal(route3(), null, '退场 disposer 注销 ws 路由（随 effect 清理）')
})
