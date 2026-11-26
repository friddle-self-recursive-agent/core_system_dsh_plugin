// bridges/task-spawn.ts —— Task spawn 桥（多任务并发调度宿主面——task-scheduler.md §4；与 mountWakeBridge 同族）。
// R-ENG-7 拆分：原 index.ts 的 mountTaskSpawnBridge 全量搬家（零语义变化）。
//   ① cored 侧调度器租约命中任务 → POST /task/spawn {taskId, taskPath, workspace, agent}；
//   ② 本桥只做单飞检测（taskId 锁文件+进程活性）→ 执行部署侧配置的固定命令
//      （config.taskSpawnCommand / CORE_SYSTEM_TASK_SPAWN_CMD）；**命令零参数零 shell 拼接，
//      taskPath 只经 stdin 喂给命令**；taskId 只作锁文件名（白名单字符 sanitize），不进命令；
//   ③ 无命令=桥禁用（503 诚实降级）；同任务已有活会话=already-running（不重复拉起）；失败=502。
// 红线：会话 ID 不在本桥产生——执行体心跳/Task.status.agentSession 回填；回执只给 sessionHint 锚。
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { TASK_SPAWN_PATH } from '../config.ts'

export interface TaskSpawnBridgeHandle {
  /** loopback 监听地址（host:port——cored 侧 CORE_SYSTEM_TASK_SPAWN_ADDR 回填值）。 */
  addr: string
  stop(): void
}

export async function mountTaskSpawnBridge(
  _ctx: any,
  opts: {
    /** loopback 监听地址（host:port）；缺省 127.0.0.1 随机口。 */
    addr?: string
    /** 部署侧任务启动命令（固定命令，零参数）；空=桥禁用。 */
    command?: string
    /** 任务单飞锁目录（按 taskId 锁文件；空=不落锁——部署侧自行保证同任务单飞）。 */
    lockDir?: string
    /** node:child_process 注入面（测试用）。 */
    spawnImpl?: typeof spawn
    /** node:http 注入面（测试用——缺省真实模块）。 */
    httpModule?: typeof import('node:http')
  } = {},
): Promise<TaskSpawnBridgeHandle> {
  const httpMod = opts.httpModule ?? (await import('node:http'))
  const spawnImpl = opts.spawnImpl ?? spawn
  const command = (opts.command ?? '').trim()
  const lockDir = (opts.lockDir ?? '').trim()

  // 单飞锁：锁文件名=taskId 白名单字符 sanitize（.. 与路径分隔符一并折为 _——不外溢锁目录）；
  // 活性=锁内 pid 进程存活判定（kill(pid,0)），死进程锁=陈旧即清（租约回收后可重派）。
  const lockPathOf = (taskId: string): string | null => {
    if (!lockDir) return null
    const safe = taskId.replace(/[^A-Za-z0-9._-]/g, '_')
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
  const lockedPid = (taskId: string): number | null => {
    const p = lockPathOf(taskId)
    if (!p || !existsSync(p)) return null
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { pid?: number }
      const pid = Number(raw?.pid ?? 0)
      if (pid > 0 && pidAlive(pid)) return pid
      try { unlinkSync(p) } catch { /* 陈旧锁已不在=已清 */ }
      console.error('[core-system-diag] task spawn 桥陈旧锁已清 task=%s（pid=%s 不存活）', taskId, pid || '?')
    } catch (e) {
      console.error('[core-system-diag] task spawn 桥锁不可读（按无锁）task=%s: %s', taskId, String((e as Error)?.message ?? e))
    }
    return null
  }
  const writeLock = (taskId: string, pid: number): void => {
    const p = lockPathOf(taskId)
    if (!p || !(pid > 0)) return
    try {
      mkdirSync(lockDir, { recursive: true })
      writeFileSync(p, JSON.stringify({ taskId, pid, at: Date.now() }), { mode: 0o600 })
    } catch (e) {
      console.error('[core-system-diag] task spawn 桥锁写入失败 %s: %s', p, String((e as Error)?.message ?? e))
    }
  }
  const spawnTask = (taskId: string, taskPath: string): number | null => {
    try {
      // 固定命令零参数（载荷不参与命令构造）；taskPath 只经 stdin 递给命令（部署侧命令自读任务文件）。
      const child = spawnImpl(command, [], { detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: process.env })
      child.unref()
      child.on('error', (e: Error) => {
        console.error('[core-system-diag] task spawn 桥命令进程错误 task=%s: %s', taskId, String(e?.message ?? e))
      })
      if (child.stdin) {
        child.stdin.on('error', (e: Error) => {
          console.error('[core-system-diag] task spawn 桥 stdin 递送失败 task=%s: %s', taskId, String(e?.message ?? e))
        })
        child.stdin.end(taskPath + '\n', 'utf8')
      }
      console.error('[core-system-diag] task spawn 桥已拉起任务 command=%s pid=%s task=%s', command, child.pid ?? '?', taskId)
      return child.pid ?? null
    } catch (e) {
      console.error('[core-system-diag] task spawn 桥拉起失败 command=%s task=%s: %s', command, taskId, String((e as Error)?.message ?? e))
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
    if (req.method !== 'POST' || url !== TASK_SPAWN_PATH) {
      reply(404, { error: `not found（task spawn 桥只收 POST ${TASK_SPAWN_PATH}）` })
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
      const taskId = String(body.taskId ?? '').trim()
      const taskPath = String(body.taskPath ?? '').trim()
      console.error('[core-system-diag] task spawn 桥请求 task=%s agent=%s workspace=%s',
        taskId, String(body.agent ?? ''), JSON.stringify(body.workspace ?? null))
      if (!taskId) {
        reply(400, { error: 'taskId 缺失（需 "<scope>/<name>"）' })
        return
      }
      if (!taskPath) {
        reply(400, { error: 'taskPath 缺失（任务文件路径——调度器生成，经 stdin 递给命令）' })
        return
      }
      if (!command) {
        reply(503, { error: 'task 命令未配置（config.taskSpawnCommand / CORE_SYSTEM_TASK_SPAWN_CMD）' })
        return
      }
      const held = lockedPid(taskId)
      if (held !== null) {
        reply(200, { ok: true, status: 'already-running', sessionHint: taskId })
        return
      }
      const pid = spawnTask(taskId, taskPath)
      if (pid === null) {
        reply(502, { error: 'task 命令拉起失败（详见宿主日志；租约到期后调度器可重派）' })
        return
      }
      writeLock(taskId, pid)
      reply(202, { ok: true, status: 'spawned', sessionHint: taskId })
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
  console.error('[core-system-diag] task spawn 桥 listener=%s（CORE_SYSTEM_TASK_SPAWN_ADDR 回填——cored 调度器路由）', bound)
  return { addr: bound, stop: () => { server.close() } }
}
