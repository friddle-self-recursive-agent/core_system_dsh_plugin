// core_system dsh plugin 入口：宿主 cored（Go 控制面，core_system submodule 的 cmd/cored）。
// 职责（桥契约见 core_system_instance/runtime/cored-bridge.md）：
//   1. 按配置拉起 cored 子进程（二进制定位：config.coredBin → CORE_SYSTEM_CORED_BIN → PATH 上的 cored）
//   2. 解析 cored stdout 的 CORED_READY 就绪行，取得实际监听地址
//   3. 转发一次 scheme 查询（GET /v1/scheme + /v1/scheme/kinds）并留痕日志，结果挂到 ctx.coreSystem
//   4. 挂持续只读查询句柄（ctx.coreSystem.get/list，fetch 封装 /v1/objects 对象读面）
//   5. 插件退场时回收子进程
// R-ENG-7 拆分（源文件 ≤800 行红线）：本文件只留 default apply() 编排 + waitForReady；
//   声明面/常量 → config.ts，HTTP 结构面 → http.ts，cored 桥 → bridge.ts，console 路由 →
//   routes/（读代理+装配 console.ts、写通路 console-write.ts、comm 读面 comm-read.ts、WS
//   升级代理 wsproxy.ts），三桥 → bridges/（wake/task-spawn/selfheal），agent-comm 工具 →
//   tools/agent-comm.ts。下方 re-export 保持既有导出名单不变（package.json main 仍指本文件，
//   test/ 的 import 路径零改动）。
import { spawn, type ChildProcess } from 'node:child_process'
import type { Config } from './config.ts'
import { makeBridge, probeScheme, writeCoredAddr } from './bridge.ts'
import { parseReadyLine } from './bridge.ts'
import { createCommState, type CommState } from './tools/agent-comm.ts'
import { mountAgentCommTools } from './tools/agent-comm.ts'
import { mountConsoleRoutes } from './routes/console.ts'
import { mountSelfHealBridge, type SelfHealBridgeHandle } from './bridges/selfheal.ts'
import { mountWakeBridge, type WakeBridgeHandle } from './bridges/wake.ts'
import { mountTaskSpawnBridge, type TaskSpawnBridgeHandle } from './bridges/task-spawn.ts'

// ── 既有导出面兼容（名字与拆分前一致；类型走 export type——type-stripping 安全）────────
export type { Config } from './config.ts'
export {
  CONSOLE_API_PREFIX, CONSOLE_APPLY_PATH, CONSOLE_DRAFTS_PATH, CONSOLE_DESIGN_DOCS_PATH,
  CONSOLE_INTAKE_PATH, CONSOLE_SESSION_HEARTBEAT_PATH, CONSOLE_COMM_PATH, CONSOLE_SERVICE_PROJECTS_PATH,
  CONSOLE_WS_PATH, CONSOLE_WS_UPSTREAM_PATH, SELFHEAL_BOUNCE_PATH, SELFHEAL_HEARTBEAT_PHASE,
  DEFAULT_HEAL_WORD, DEFAULT_DRAFT_FIELD_MANAGER, DEFAULT_APPLY_SUBJECT,
  WAKE_SPAWN_PATH, TASK_SPAWN_PATH,
  CONSOLE_CHAT_SEND_PATH, CONSOLE_CHATFACES_CLIENT_PATH, CONSOLE_EVENT_PUB_PATH,
} from './config.ts'
export type { ApplySubject, FetchLike, HttpReqLike, HttpResLike, WebServerLike, ConnectionLike } from './http.ts'
export { sendJson, readRequestBody } from './http.ts'
export type {
  CoreObjectRef, CoreObject, CoreQueryResult, CoreSystemQueryHandle, CoreSystemBridge,
} from './bridge.ts'
export { parseReadyLine, createQueryHandle } from './bridge.ts'
export {
  createConsoleApiHandler, createServiceProjectsHandler,
  defaultServiceProjectsRoot, mountConsoleRoutes, mountConsoleProxy,
} from './routes/console.ts'
export {
  createApplyHandler, createDraftsHandler, createDesignDocsHandler,
  createIntakeHandler, createSessionHeartbeatHandler,
} from './routes/console-write.ts'
export { createCommHandler } from './routes/comm-read.ts'
export { createEventPubHandler } from './routes/console-write.ts'
export { createChatTranscriptReadHandler, createChatCreateHandler, projectTranscript, projectSessions, projectLive, projectStateLive, type SessionControllerDeps } from './bridges/transcript.ts'
export { createTaskSessionsHandler, taskIdsOfText, taskIdsOfEvents, taskMatchesOfEvents } from './bridges/task-sessions.ts'
export type { CommState } from './tools/agent-comm.ts'
export { createCommState, AGENT_COMM_TOOL_NAMES, mountAgentCommTools } from './tools/agent-comm.ts'
// 协议判别集（AGENT_COMM_KINDS 四 op 名=工具名裸用；E5a 客户端判别器引用声明集——bundle 静态面锚点）。
export { AGENT_COMM_KINDS } from './agent-comm.ts'
export type { SelfHealBridgeHandle } from './bridges/selfheal.ts'
export { mountSelfHealBridge } from './bridges/selfheal.ts'
export type { WakeBridgeHandle } from './bridges/wake.ts'
export { mountWakeBridge } from './bridges/wake.ts'
export { createChatFacesClientHandler, createChatSendHandler, createChatStopHandler } from './bridges/chatfaces.ts'
export type { TaskSpawnBridgeHandle } from './bridges/task-spawn.ts'
export { mountTaskSpawnBridge } from './bridges/task-spawn.ts'

export default async function apply(ctx: any, config: Config = {}) {
  // agent-comm 运行时落账状态（一次激活一份：mailbox=v0.1 既有 + journal=E6 comm 流水）——
  // 工具面写、读路由读（GET /core-console/comm），同仓同进程。
  const comm = createCommState()
  // SelfHeal 注入桥（v0.56 R-10）：装配即起 loopback listener（cored watchdog 注入路由面）——
  // 注入词/地址经环境注入（CORE_SYSTEM_SELFHEAL_ADDR/HEAL），cored 侧 env 回填同值。
  // 失败=warn 不阻断宿主（桥缺席=cored 纯观测词形，零行为面变化）。
  let selfheal: SelfHealBridgeHandle | null = null
  let bridgeRef: { url: string } | null = null
  try {
    selfheal = await mountSelfHealBridge(ctx, {
      addr: process.env.CORE_SYSTEM_SELFHEAL_ADDR || undefined,
      heartbeat: async (payload) => {
        // 回执走既有心跳通路（宿主侧直调 cored /v1/sessions/heartbeat——写面同门控）。
        const url = (config.coredUrl || bridgeRef?.url || '')
        if (!url) return
        await fetch(url.replace(/\/+$/, '') + '/v1/sessions/heartbeat', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      },
    })
    if (selfheal) process.env.CORE_SYSTEM_SELFHEAL_ADDR = selfheal.addr
  } catch (e) {
    ctx.logger.warn('core-system: selfheal 桥装配失败（纯观测词形）: %s', String((e as Error)?.message ?? e))
  }
  // Wake 桥（R-UX-8）：cored 侧 CORE_SYSTEM_WAKE_ADDR 回填；LoopRequested→部署侧 loop 命令。
  // 与 selfheal 同款：装配失败=warn 不阻断宿主；无命令=桥禁用（503 诚实降级）。
  let wake: WakeBridgeHandle | null = null
  try {
    wake = await mountWakeBridge(ctx, {
      addr: process.env.CORE_SYSTEM_WAKE_ADDR || undefined,
      command: config.loopCommand || process.env.CORE_SYSTEM_LOOP_CMD || '',
      runningPattern: config.loopRunningPattern || process.env.CORE_SYSTEM_LOOP_RUNNING_PATTERN || '',
      retryMs: config.loopRetryMs ?? (Number(process.env.CORE_SYSTEM_LOOP_RETRY_MS || 0) || undefined),
      pendingFile: config.wakePendingFile || process.env.CORE_SYSTEM_WAKE_PENDING_FILE || '',
    })
    if (wake) process.env.CORE_SYSTEM_WAKE_ADDR = wake.addr
  } catch (e) {
    ctx.logger.warn('core-system: wake 桥装配失败（纯投影词形）: %s', String((e as Error)?.message ?? e))
  }
  // Task spawn 桥（task-scheduler.md §4）：cored 调度器租约命中 → POST /task/spawn →
  // 固定命令拉起任务会话（taskPath 只经 stdin；单飞=taskId 锁文件+进程活性）。
  // 与 wake/selfheal 同款：装配失败=warn 不阻断宿主；无命令=桥禁用（503 诚实降级）；
  // 地址经 CORE_SYSTEM_TASK_SPAWN_ADDR 环境回填（本进程 spawn cored 子进程时继承同值——
  // 三桥 addr 注入收拢在同一通路），taskSpawnAddrFile 就绪即写（人看/部署侧发现，0600）。
  let taskSpawn: TaskSpawnBridgeHandle | null = null
  try {
    taskSpawn = await mountTaskSpawnBridge(ctx, {
      addr: process.env.CORE_SYSTEM_TASK_SPAWN_ADDR || undefined,
      command: config.taskSpawnCommand || process.env.CORE_SYSTEM_TASK_SPAWN_CMD || '',
      lockDir: config.taskSpawnLockDir || process.env.CORE_SYSTEM_TASK_SPAWN_LOCK_DIR || '',
    })
    if (taskSpawn) {
      process.env.CORE_SYSTEM_TASK_SPAWN_ADDR = taskSpawn.addr
      writeCoredAddr(config.taskSpawnAddrFile, taskSpawn.addr)
    }
  } catch (e) {
    ctx.logger.warn('core-system: task spawn 桥装配失败（调度器退化纯状态投影）: %s', String((e as Error)?.message ?? e))
  }
  if (config.coredUrl) {
    const bridge = makeBridge()
    bridgeRef = bridge
    bridge.url = config.coredUrl
    writeCoredAddr(config.coredAddrFile, bridge.url)
    ctx.provide('coreSystem', bridge)
    mountConsoleRoutes(ctx, bridge, config.applySubject, comm, config.serviceProjectsRoot)
    mountAgentCommTools(ctx, bridge, comm)
    if (typeof ctx.effect === 'function' && selfheal) {
      ctx.effect(() => () => selfheal?.stop(), 'core-system:selfheal-bridge')
    }
    if (typeof ctx.effect === 'function' && wake) {
      ctx.effect(() => () => wake?.stop(), 'core-system:wake-bridge')
    }
    if (typeof ctx.effect === 'function' && taskSpawn) {
      ctx.effect(() => () => taskSpawn?.stop(), 'core-system:task-spawn-bridge')
    }
    if (wake) {
      ctx.logger.info('core-system: wake 桥已起 %s（attach 模式需 cored 侧 CORE_SYSTEM_WAKE_ADDR 指向同址）', wake.addr)
    }
    if (taskSpawn) {
      ctx.logger.info('core-system: task spawn 桥已起 %s（attach 模式需 cored 侧 CORE_SYSTEM_TASK_SPAWN_ADDR 指向同址）', taskSpawn.addr)
    }
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
  bridgeRef = bridge
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
      if (selfheal) selfheal.stop() // selfheal 桥 listener 随插件退场（v0.56）
      if (wake) wake.stop() // wake 桥 listener 随插件退场（R-UX-8）
      if (taskSpawn) taskSpawn.stop() // task spawn 桥 listener 随插件退场（task-scheduler.md §4）
    }
  }, 'core-system:cored-child')

  const ready = await waitForReady(child, readyTimeoutMs, (line) => ctx.logger.warn('core-system|cored: %s', line))
  if (!ready) {
    ctx.logger.error('core-system: cored 未在 %dms 内就绪（bin=%s），桥接失败', readyTimeoutMs, coredBin)
    return
  }
  bridge.url = `http://${ready.addr}`
  writeCoredAddr(config.coredAddrFile, bridge.url)
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
