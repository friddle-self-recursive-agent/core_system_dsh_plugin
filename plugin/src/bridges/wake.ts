// bridges/wake.ts —— Wake 桥（事件→自循环拉起；core_design concepts/cli.md / R-UX-8）。
// R-ENG-7 拆分：原 index.ts 的 mountWakeBridge 全量搬家（零语义变化）。
//   ① cored 侧 wake 桥（CORE_SYSTEM_WAKE_ADDR）把白名单唤醒（缺省 LoopRequested）POST 到本桥；
//   ② 本桥只做单飞检测（pgrep -f 运行模式）→ 执行部署侧配置的 loop 命令（config.loopCommand /
//      CORE_SYSTEM_LOOP_CMD）拉起自循环会话；**命令是配置项，载荷不参与命令构造**；
//   ③ 无命令=桥禁用（503 诚实降级）；已有循环=already-running（不重复拉起）；失败=502。
// 红线：不新增自主判定/定时器/队列——唯一触发源=cored 已受理的唤醒事件（事件驱动，非外部点火）。
import { spawn, execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { WAKE_SPAWN_PATH } from '../config.ts'

export interface WakeBridgeHandle {
  /** loopback 监听地址（host:port——cored 侧 CORE_SYSTEM_WAKE_ADDR 回填值）。 */
  addr: string
  stop(): void
}

export async function mountWakeBridge(
  _ctx: any,
  opts: {
    /** loopback 监听地址（host:port）；缺省 127.0.0.1 随机口。 */
    addr?: string
    /** 部署侧 loop 启动命令（绝对路径或 PATH 名）；空=桥禁用。 */
    command?: string
    /** 单飞检测模式（pgrep -f）；空=不检测（部署侧自行保证单飞）。 */
    runningPattern?: string
    /** pending 重试间隔毫秒（缺省 30000）；已有循环时事件挂起，循环退出后自动拉起。 */
    retryMs?: number
    /** pending 持久化文件（空=仅内存；跨插件重启保留未投递事件）。 */
    pendingFile?: string
    /** node:child_process 注入面（测试用）。 */
    spawnImpl?: typeof spawn
    execFileImpl?: typeof execFile
    /** node:http 注入面（测试用——缺省真实模块）。 */
    httpModule?: typeof import('node:http')
  } = {},
): Promise<WakeBridgeHandle> {
  const httpMod = opts.httpModule ?? (await import('node:http'))
  const spawnImpl = opts.spawnImpl ?? spawn
  const execFileImpl = opts.execFileImpl ?? execFile
  const command = (opts.command ?? '').trim()
  const runningPattern = (opts.runningPattern ?? '').trim()
  const retryMs = opts.retryMs && opts.retryMs > 0 ? opts.retryMs : 30_000
  const pendingFile = (opts.pendingFile ?? '').trim()

  // pending：已有循环时事件不丢——挂起最新一条（同因合并），循环退出后自动拉起。
  type Pending = { eventId: string; dedupKey: string; at: number }
  let pending: Pending | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  const persistPending = () => {
    if (!pendingFile || !pending) return
    try {
      mkdirSync(dirname(pendingFile), { recursive: true })
      writeFileSync(pendingFile, JSON.stringify(pending), { mode: 0o600 })
    } catch (e) {
      console.error('[core-system-diag] wake pending 写入失败 %s: %s', pendingFile, String((e as Error)?.message ?? e))
    }
  }
  const clearPending = (removeFile: boolean) => {
    pending = null
    stopTimer()
    if (removeFile && pendingFile) {
      try { unlinkSync(pendingFile) } catch { /* 文件不存在=已清 */ }
    }
  }
  const isRunning = (): Promise<boolean> => {
    if (!runningPattern) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      execFileImpl('pgrep', ['-f', runningPattern], { timeout: 2000 }, (err, stdout) => {
        resolve(!err && String(stdout).trim() !== '')
      })
    })
  }
  const spawnLoop = (eventId: string): number | null => {
    try {
      // 命令是部署侧配置项；载荷只用于日志，绝不拼接进命令（零注入面）。
      const child = spawnImpl(command, [], { detached: true, stdio: 'ignore', env: process.env })
      child.unref()
      console.error('[core-system-diag] wake 桥已拉起自循环 command=%s pid=%s event=%s', command, child.pid ?? '?', eventId)
      return child.pid ?? null
    } catch (e) {
      console.error('[core-system-diag] wake 桥拉起失败 command=%s event=%s: %s', command, eventId, String((e as Error)?.message ?? e))
      return null
    }
  }
  const attemptPending = async () => {
    if (!pending) return
    if (await isRunning()) return
    if (spawnLoop(pending.eventId) !== null) {
      console.error('[core-system-diag] wake 桥 pending 投递成功 event=%s', pending.eventId)
      clearPending(true)
    }
  }
  const queuePending = (body: Record<string, unknown>) => {
    const eventId = String(body.eventId ?? '')
    const dedupKey = String(body.dedupKey ?? '')
    if (pending && pending.eventId === eventId) return
    pending = { eventId, dedupKey, at: Date.now() }
    persistPending()
    console.error('[core-system-diag] wake 桥 pending（已有循环，待其退出后拉起）event=%s retryMs=%d', eventId, retryMs)
    if (!timer) {
      timer = setInterval(() => { void attemptPending() }, retryMs)
      timer.unref?.()
    }
  }
  // 跨插件重启恢复 pending：重启期间事件不丢（文件 0600）。
  if (pendingFile && command) {
    try {
      if (existsSync(pendingFile)) {
        const raw = JSON.parse(readFileSync(pendingFile, 'utf8')) as Partial<Pending>
        if (raw && typeof raw.eventId === 'string' && raw.eventId) {
          pending = { eventId: raw.eventId, dedupKey: String(raw.dedupKey ?? ''), at: Number(raw.at ?? Date.now()) }
          timer = setInterval(() => { void attemptPending() }, retryMs)
          timer.unref?.()
          console.error('[core-system-diag] wake 桥恢复 pending event=%s（循环退出后自动拉起）', pending.eventId)
          void attemptPending()
        }
      }
    } catch (e) {
      console.error('[core-system-diag] wake pending 恢复失败 %s: %s', pendingFile, String((e as Error)?.message ?? e))
    }
  }

  const server = httpMod.createServer((req, res) => {
    const url = String(req.url ?? '/').split('?')[0]
    const reply = (status: number, body: Record<string, unknown>) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || url !== WAKE_SPAWN_PATH) {
      reply(404, { error: `not found（wake 桥只收 POST ${WAKE_SPAWN_PATH}）` })
      return
    }
    let raw = ''
    req.on('data', (c: Buffer | string) => { raw += c.toString() })
    req.on('end', async () => {
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw || '{}') as Record<string, unknown>
      } catch {
        reply(400, { error: '载荷不可解析（需 JSON 对象）' })
        return
      }
      const type = String(body.type ?? '')
      const agent = String(body.agent ?? '')
      console.error('[core-system-diag] wake 桥请求 type=%s agent=%s event=%s', type, agent, String(body.eventId ?? ''))
      if (type !== 'LoopRequested') {
        reply(400, { error: `事件类型不支持（${type}）` })
        return
      }
      if (!agent.startsWith('root')) {
        reply(400, { error: `agent 锚不支持（${agent}）` })
        return
      }
      if (!command) {
        reply(503, { error: 'loop 命令未配置（config.loopCommand / CORE_SYSTEM_LOOP_CMD）' })
        return
      }
      if (await isRunning()) {
        queuePending(body)
        reply(200, { ok: true, status: 'already-running', queued: true, retryMs, pattern: runningPattern })
        return
      }
      const pid = spawnLoop(String(body.eventId ?? ''))
      if (pid === null) {
        reply(502, { error: 'loop 命令拉起失败（详见宿主日志；事件已受理，下一事件可重试）' })
        return
      }
      clearPending(true) // 新循环已起：旧 pending 的意图被满足，清掉防重复
      reply(202, { ok: true, status: 'spawned', pid })
    })
  })
  const listenHost = (opts.addr ?? '127.0.0.1:0').split(':')[0] || '127.0.0.1'
  const wantPort = Number((opts.addr ?? '127.0.0.1:0').split(':')[1] ?? 0) || 0
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(wantPort, listenHost, () => resolve())
  })
  server.unref()
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? `${address.address}:${address.port}` : String(opts.addr ?? '')
  console.error('[core-system-diag] wake 桥 listener=%s（CORE_SYSTEM_WAKE_ADDR 回填——cored LoopRequested 路由）', bound)
  return { addr: bound, stop: () => { stopTimer(); server.close() } }
}
