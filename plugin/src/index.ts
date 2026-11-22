// core_system dsh plugin 入口：宿主 cored（Go 控制面，core_system submodule 的 cmd/cored）。
// 职责（探针③，桥契约见 core_system_instance/runtime/cored-bridge.md）：
//   1. 按配置拉起 cored 子进程（二进制定位：config.coredBin → CORE_SYSTEM_CORED_BIN → PATH 上的 cored）
//   2. 解析 cored stdout 的 CORED_READY 就绪行，取得实际监听地址
//   3. 转发一次 scheme 查询（GET /v1/scheme + /v1/scheme/kinds）并留痕日志，结果挂到 ctx.coreSystem
//   4. 插件退场时回收子进程
// 部署锚点一律经配置或环境注入，不内置真实路径（rule.md R-PUB-1/2）。
import { spawn, type ChildProcess } from 'node:child_process'

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
}

/** 桥接结果（挂 ctx.coreSystem，供同宿主插件读取）。 */
export interface CoreSystemBridge {
  /** cored 基址。 */
  url: string
  /** scheme 概览（GET /v1/scheme 载荷）。 */
  scheme: Record<string, unknown> | null
  /** 对象类型名清单（GET /v1/scheme/kinds 投影）。 */
  kinds: string[] | null
}

/** 解析 cored 就绪行（契约：cored-bridge.md）：`CORED_READY addr=<host:port> scheme_version=<v> kinds=<n>`。 */
export function parseReadyLine(line: string): { addr: string; schemeVersion: string; kinds: number } | null {
  const m = /^CORED_READY addr=(\S+) scheme_version=(\S+) kinds=(\d+)/.exec(line.trim())
  if (!m) return null
  return { addr: m[1], schemeVersion: m[2], kinds: Number(m[3]) }
}

export default async function apply(ctx: any, config: Config = {}) {
  const url = config.coredUrl
  if (url) {
    const bridge: CoreSystemBridge = { url: '', scheme: null, kinds: null }
    ctx.provide('coreSystem', bridge)
    await probeScheme(url, bridge)
    ctx.logger.info('core-system: 已接入运行中的 cored %s（kinds=%s）', url, bridge.kinds?.length ?? '?')
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
  const bridge: CoreSystemBridge = { url: '', scheme: null, kinds: null }
  ctx.provide('coreSystem', bridge)

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
    'core-system: scheme 查询完成 —— %s/%s（kinds=%d：%s）',
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
