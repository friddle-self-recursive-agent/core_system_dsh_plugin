// bridges/service-spawn.ts —— Service spawn 桥（2026-11-27 session 裁决——workflow.md §1.3；
// 与 task-spawn 桥同族）：builtin service 的内部 agent 执行载体=session。
//   ① cored 侧 run 落 unit=service 节点挂起 → POST /service/spawn {spawnSeq, workflow, run,
//      node, phase, service, op, agent, role, context}（agent=ServiceDesc.instances.agentRefs
//      cored 侧已解析）；
//   ② 本桥只做单飞检测（workflow:run:node 锁文件+进程活性）→ 执行部署侧配置的固定命令
//      （config.serviceSpawnCommand / CORE_SYSTEM_SERVICE_SPAWN_CMD）；**命令零参数零 shell
//      拼接，载荷 JSON 只经 stdin 喂给命令**（部署侧命令自读载荷：拉起 dsh 会话挂 service 的
//      agent、首轮=contextPassing 上下文、退出后发布 ServiceSessionCompleted）；
//   ③ 无命令=桥禁用（503 诚实降级）；同 run·节点已有活会话=already-running（不重复拉起）；
//      失败=502。
// 红线：会话 ID 不在本桥产生——执行体心跳/回执 sessionId 由部署侧面回填（cored ack pid:<n>
// 降级锚同 wake 桥 G-08 词形）；载荷不进命令（零注入面）。
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { SERVICE_SPAWN_PATH } from '../config.ts'

export interface ServiceSpawnBridgeHandle {
  /** loopback 监听地址（host:port——cored 侧 CORE_SYSTEM_SERVICE_SPAWN_ADDR 回填值）。 */
  addr: string
  stop(): void
}

export async function mountServiceSpawnBridge(
  _ctx: any,
  opts: {
    /** loopback 监听地址（host:port）；缺省 127.0.0.1 随机口。 */
    addr?: string
    /** 部署侧 service 会话启动命令（固定命令，零参数）；空=桥禁用。 */
    command?: string
    /** 单飞锁目录（按 workflow:run:node 锁文件；空=不落锁——部署侧自行保证单飞）。 */
    lockDir?: string
    /** node:child_process 注入面（测试用）。 */
    spawnImpl?: typeof spawn
    /** node:http 注入面（测试用——缺省真实模块）。 */
    httpModule?: typeof import('node:http')
  } = {},
): Promise<ServiceSpawnBridgeHandle> {
  const httpMod = opts.httpModule ?? (await import('node:http'))
  const spawnImpl = opts.spawnImpl ?? spawn
  const command = (opts.command ?? '').trim()
  const lockDir = (opts.lockDir ?? '').trim()

  // 单飞锁：锁文件名=workflow:run:node 白名单字符 sanitize（路径分隔符与点号外字符折 _——
  // 不外溢锁目录）；活性=锁内 pid 进程存活判定（kill(pid,0)），死进程锁=陈旧即清（重派）。
  const lockKeyOf = (body: Record<string, unknown>): string | null => {
    const wf = String(body.workflow ?? '').trim()
    const run = String(body.run ?? '').trim()
    const node = String(body.node ?? '').trim()
    if (!wf || !node) return null
    return `${wf}:${run || '0'}:${node}`
  }
  const lockPathOf = (key: string): string | null => {
    if (!lockDir) return null
    const safe = key.replace(/[^A-Za-z0-9._-]/g, '_')
    return join(lockDir, safe + '.lock')
  }
  const pidAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException)?.code === 'EPERM' // EPERM=进程在（他属主）——照活处理
    }
  }
  const lockedPid = (key: string): number | null => {
    const p = lockPathOf(key)
    if (!p || !existsSync(p)) return null
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { pid?: number }
      const pid = Number(raw?.pid ?? 0)
      if (pid > 0 && pidAlive(pid)) return pid
      try { unlinkSync(p) } catch { /* 陈旧锁已不在=已清 */ }
      console.error('[core-system-diag] service spawn 桥陈旧锁已清 key=%s（pid=%s 不存活）', key, pid || '?')
    } catch (e) {
      console.error('[core-system-diag] service spawn 桥锁不可读（按无锁）key=%s: %s', key, String((e as Error)?.message ?? e))
    }
    return null
  }
  const writeLock = (key: string, pid: number): void => {
    const p = lockPathOf(key)
    if (!p || !(pid > 0)) return
    try {
      mkdirSync(lockDir, { recursive: true })
      writeFileSync(p, JSON.stringify({ key, pid, at: Date.now() }), { mode: 0o600 })
    } catch (e) {
      console.error('[core-system-diag] service spawn 桥锁写入失败 %s: %s', p, String((e as Error)?.message ?? e))
    }
  }
  const spawnSession = (payloadJson: string): number | null => {
    try {
      // 固定命令零参数（载荷不参与命令构造）；载荷 JSON 只经 stdin 递给命令（部署侧命令自读）。
      const child = spawnImpl(command, [], { detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: process.env })
      child.unref()
      child.on('error', (e: Error) => {
        console.error('[core-system-diag] service spawn 桥命令进程错误: %s', String(e?.message ?? e))
      })
      if (child.stdin) {
        child.stdin.on('error', (e: Error) => {
          console.error('[core-system-diag] service spawn 桥 stdin 递送失败: %s', String((e as Error)?.message ?? e))
        })
        child.stdin.end(payloadJson + '\n', 'utf8')
      }
      console.error('[core-system-diag] service spawn 桥已拉起 command=%s pid=%s', command, child.pid ?? '?')
      return child.pid ?? null
    } catch (e) {
      console.error('[core-system-diag] service spawn 桥拉起失败 command=%s: %s', command, String((e as Error)?.message ?? e))
      return null
    }
  }

  const server = httpMod.createServer((req, res) => {
    const url = String(req.url ?? '/').split('?')[0]
    const reply = (status: number, body: Record<string, unknown>) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || url !== SERVICE_SPAWN_PATH) {
      reply(404, { error: `not found（service spawn 桥只收 POST ${SERVICE_SPAWN_PATH}）` })
      return
    }
    let raw = ''
    req.on('data', (c: Buffer | string) => { raw += c.toString() })
    req.on('end', () => {
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw || '{}') as Record<string, unknown>
      } catch {
        reply(400, { error: '载荷不可解析（需 JSON 对象）' })
        return
      }
      const key = lockKeyOf(body)
      if (!key) {
        reply(400, { error: 'workflow/node 缺失（需 workflow + run + node 锚三元组）' })
        return
      }
      console.error('[core-system-diag] service spawn 桥请求 key=%s service=%s op=%s agent=%s',
        key, String(body.service ?? ''), String(body.op ?? ''), String(body.agent ?? ''))
      if (!command) {
        reply(503, { error: 'service 会话命令未配置（config.serviceSpawnCommand / CORE_SYSTEM_SERVICE_SPAWN_CMD）' })
        return
      }
      const held = lockedPid(key)
      if (held !== null) {
        reply(200, { ok: true, status: 'already-running', sessionHint: key })
        return
      }
      const pid = spawnSession(raw)
      if (pid === null) {
        reply(502, { error: 'service 会话命令拉起失败（详见宿主日志；完成信号缺席 run 保持挂起）' })
        return
      }
      writeLock(key, pid)
      reply(202, { ok: true, status: 'spawned', pid, sessionHint: key })
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
  console.error('[core-system-diag] service spawn 桥 listener=%s（CORE_SYSTEM_SERVICE_SPAWN_ADDR 回填——cored service 节点路由）', bound)
  return { addr: bound, stop: () => { server.close() } }
}
