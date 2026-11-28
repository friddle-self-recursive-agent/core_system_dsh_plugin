// task-agent-runner.mjs —— headless 执行体监护（BugDoc bug-workflow-agent-502-20261127 /
// bug-gh-issue-3-502-retry-20261127 修复：502 code=0 空 reply 归一为可重试瞬态错误；指数
// 退避重试；上限后 Task.status=failed + TaskStateChanged(failed) + Escalate；全程
// Task.status.lastAction 细粒度心跳回写）。
//
// 位置=宿主 spawn 桥配置的固定命令（bin/task-spawn.sh 调本脚本）。stdin 只收 taskPath，
// 与原契约相同（固定命令零参数、载荷不进 shell）。cored 写面仍走 POST /v1/apply
// （fieldManager=task-scheduler，P2 status 单一写者），事件走 POST /v1/events
// （注册类型 TaskStateChanged/Escalate），零新增旁路写口。失败后清理单飞锁由调度器
// 下一拍承担（phase=failed 为终态；重跑=新任务或显式复位后重派）。
//
// 注入面（测试用）：fetchImpl/spawnImpl/sleep/now/log/coredUrl/subject；真实装配缺省
// 从 ~/.dsh/cored.addr 或 CORED_ADDR 读 cored 地址。
import { spawn } from 'node:child_process'
import { readFileSync, readFile } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_BASE_DELAY_MS = 1000
export const STATUS_FIELD_MANAGER = 'task-scheduler'
const OUTPUT_CAP = 32 * 1024

/** 归一：仅「code=0 且空 reply/流」的 502 才算可重试瞬态（严格口径——裸 502/永久
 *  网关故障不冒充瞬态；exit 0 的进程即便日志提到历史 502 也算成功，不重复拉起）。 */
export function classifyExit(output, exitCode) {
  if (exitCode === 0) return 'success'
  const text = String(output || '')
  const has502 = /(?:^|[^\d])502(?!\d)/.test(text)
  const codeZero = /(?:code\s*[=:]\s*0|"code"\s*:\s*0)/i.test(text)
  const emptyReply = /(?:empty\s*(?:reply|stream)|did\s*not\s*stream|"reply"\s*:\s*"")/i.test(text)
  return has502 && codeZero && emptyReply ? 'transient-502' : 'fatal'
}

/** 从任务文件读 taskId（YAML 标量；宽松，不引 yaml 依赖）。 */
export function taskIdOf(text) {
  const m = String(text || '').match(/^taskId:\s*(.+?)\s*$/m)
  if (!m) return ''
  return m[1].replace(/^["']|["']$/g, '').trim()
}

/** 在 Task 原文 status 区机械改写 phase/lastAction/lastError（保 frontmatter 正文）。 */
export function patchTaskStatus(content, patch) {
  const raw = String(content || '')
  const md = raw.startsWith('---\n') || raw.startsWith('---\r\n')
  const marker = md ? (raw.startsWith('---\r\n') ? '---\r\n' : '---\n') : ''
  const cut = md ? raw.indexOf(marker, marker.length) : -1
  const front = cut >= 0 ? raw.slice(marker.length, cut) : raw
  const rest = cut >= 0 ? raw.slice(cut) : ''
  const lines = front.split('\n')
  const start = lines.findIndex((l) => /^status\s*:/.test(l))
  if (start < 0) lines.push('status:')
  const from = start < 0 ? lines.length - 1 : start
  let end = from + 1
  while (end < lines.length && (/^\s+/.test(lines[end]) || lines[end].trim() === '')) end++
  const block = lines.slice(from + 1, end)
  const scalar = (key, val) => `  ${key}: ${JSON.stringify(val)}`
  for (const key of ['phase', 'lastAction', 'lastError']) {
    if (patch[key] === undefined) continue
    const idx = block.findIndex((l) => new RegExp(`^\\s{2}${key}\\s*:`).test(l))
    const line = scalar(key, patch[key])
    if (idx >= 0) block[idx] = line
    else block.push(line)
  }
  const outLines = lines.slice(0, from + 1).concat(block, lines.slice(end))
  const outFront = outLines.join('\n')
  return md ? marker + outFront + rest : outFront
}

function readCoredAddr() {
  if (process.env.CORED_ADDR) return process.env.CORED_ADDR.replace(/\/+$/, '')
  try {
    return readFileSync(join(homedir(), '.dsh', 'cored.addr'), 'utf8').trim().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function defaultSubject() {
  return { user: 'core-task-runner', roles: ['role/global/admin'], groups: [] }
}

/** 一次 status 写面：GET 现文+rv → POST /v1/apply；409/rv 漂移=重读重试一次。 */
export async function writeStatus(opts, taskId, patch) {
  const { fetchImpl, coredUrl, subject, fieldManager, log } = opts
  if (!coredUrl || !taskId) return false
  const [scope, name] = taskId.includes('/') ? taskId.split('/', 2) : ['global', taskId]
  for (let round = 0; round < 2; round++) {
    try {
      const get = await fetchImpl(`${coredUrl}/v1/objects/Task/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`)
      if (!get.ok) {
        log?.(`[task-runner] Task 读面失败 status=${get.status} task=${taskId}（心跳不静默丢）`)
        return false
      }
      const row = await get.json()
      const content = patchTaskStatus(row.content, patch)
      const res = await fetchImpl(`${coredUrl}/v1/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'Task', scope, name, resourceVersion: row.resourceVersion,
          content, fieldManager, reasonRef: `task-runner:${patch.lastAction || patch.phase || 'heartbeat'}`,
          subject,
        }),
      })
      if (res.ok) return true
      const text = await res.text().catch(() => '')
      log?.(`[task-runner] Task 心跳写面失败 status=${res.status} task=${taskId}: ${text.slice(0, 240)}`)
      if (res.status !== 409) return false
    } catch (e) {
      log?.(`[task-runner] cored 不可达（心跳/失败写面未落）task=${taskId}: ${String(e?.message ?? e)}`)
      return false
    }
  }
  return false
}

/** 事件注入（TaskStateChanged / Escalate；dedup 键人读可回查）。 */
export async function publishEvent(opts, type, taskId, dedupKey, level) {
  const { fetchImpl, coredUrl, subject, log } = opts
  if (!coredUrl || !taskId) return false
  try {
    const res = await fetchImpl(`${coredUrl}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, involved: `Task/${taskId}`, dedupKey, level, subject }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      log?.(`[task-runner] 事件发布失败 status=${res.status} type=${type}: ${text.slice(0, 240)}`)
    }
    return res.ok
  } catch (e) {
    log?.(`[task-runner] 事件发布不可达 type=${type}: ${String(e?.message ?? e)}`)
    return false
  }
}

function runOnce(opts, taskPath) {
  return new Promise((resolve) => {
    let child
    try {
      child = opts.spawnImpl(opts.command, opts.args, {
        stdio: ['pipe', 'pipe', 'pipe'], env: process.env,
      })
    } catch (e) {
      resolve({ code: -1, output: String(e?.message ?? e) })
      return
    }
    let out = ''
    const take = (chunk) => {
      const s = String(chunk)
      out = (out + s).slice(-OUTPUT_CAP)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', (e) => resolve({ code: -1, output: `${out}\n${String(e?.message ?? e)}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, output: out }))
    if (child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(`${taskPath}\n`, 'utf8')
    } else {
      resolve({ code: -1, output: 'child.stdin 缺席（无法递送 taskPath）' })
    }
  })
}

/** 主流程：细粒度心跳 → 瞬态 502 退避重试 → 上限后 failed+TaskStateChanged+Escalate。 */
export async function runTaskAgent(userOpts = {}) {
  const opts = {
    taskPath: String(userOpts.taskPath || '').trim(),
    command: userOpts.command || 'dsh',
    args: userOpts.args || ['--profile', 'core-headless', '--permission-mode',
      userOpts.permissionMode || process.env.TASK_AGENT_MODE || 'danger-full-access', '--approval-policy', 'never', '-'],
    maxAttempts: Number(userOpts.maxAttempts || DEFAULT_MAX_ATTEMPTS),
    baseDelayMs: Number(userOpts.baseDelayMs || DEFAULT_BASE_DELAY_MS),
    coredUrl: userOpts.coredUrl ?? readCoredAddr(),
    subject: userOpts.subject || defaultSubject(),
    fieldManager: userOpts.fieldManager || STATUS_FIELD_MANAGER,
    fetchImpl: userOpts.fetchImpl || fetch,
    spawnImpl: userOpts.spawnImpl || spawn,
    sleep: userOpts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: userOpts.now || (() => new Date()),
    log: userOpts.log || ((...a) => console.error(...a)),
  }
  let raw = ''
  if (opts.taskPath) {
    try {
      raw = readFileSync(opts.taskPath, 'utf8')
    } catch (e) {
      opts.log?.(`[task-runner] 任务文件读取失败（仍按 stdin 递送原路径）：${String(e?.message ?? e)}`)
    }
  }
  const taskId = userOpts.taskId || taskIdOf(raw)
  const attempts = Math.max(1, opts.maxAttempts)
  let last = { code: -1, output: '' }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await writeStatus(opts, taskId, {
      phase: 'running',
      lastAction: `第 ${attempt}/${attempts} 次拉起 headless（task-agent-runner 心跳，${opts.now().toISOString()}）`,
      lastError: '',
    })
    last = await runOnce(opts, opts.taskPath)
    const kind = classifyExit(last.output, last.code)
    opts.log(`[task-runner] task=${taskId} attempt=${attempt}/${attempts} exit=${last.code} class=${kind}`)
    if (kind === 'success') {
      await writeStatus(opts, taskId, {
        phase: 'running',
        lastAction: `headless 正常退出（attempt=${attempt}，验证/落地由执行体继续）`,
      })
      return { ok: true, attempts: attempt, taskId, classification: kind }
    }
    if (kind !== 'transient-502' || attempt >= attempts) {
      const reason = kind === 'transient-502'
        ? `网关瞬态 502（code=0 空 reply）重试上限 ${attempts} 次仍失败（末次 exit=${last.code}）：${tail(last.output)}`
        : `headless 异常退出（exit=${last.code}，非可重试瞬态）：${tail(last.output)}`
      const written = await writeStatus(opts, taskId, {
        phase: 'failed', lastError: reason,
        lastAction: `headless 退出回收：failed + lastError + TaskStateChanged(failed) + Escalate（attempt=${attempt}）`,
      })
      await publishEvent(opts, 'TaskStateChanged', taskId, `task:${taskId}:failed`, 'info')
      await publishEvent(opts, 'Escalate', taskId, `task-502:${taskId}:${attempt}`, 'error')
      return { ok: false, attempts: attempt, taskId, classification: kind, statusWritten: written, reason }
    }
    const delay = Math.max(1, opts.baseDelayMs) * 2 ** (attempt - 1)
    await writeStatus(opts, taskId, {
      phase: 'running',
      lastAction: `网关瞬态 502（code=0 空 reply）：第 ${attempt}/${attempts} 次退避 ${delay}ms 后重试（task-agent-runner）`,
      lastError: `瞬态 502 待重试（attempt=${attempt}/${attempts}）：${tail(last.output)}`,
    })
    await opts.sleep(delay)
  }
  return { ok: false, attempts, taskId, classification: 'fatal', reason: '不可达分支' }
}

function tail(text) {
  return String(text || '').trim().split('\n').slice(-6).join(' | ').slice(0, 400)
}

// 直接执行（部署侧固定命令）：stdin=taskPath 一行。
if (import.meta.main) {
  let path = ''
  for await (const chunk of process.stdin) {
    path += String(chunk)
    if (path.includes('\n')) break
  }
  const res = await runTaskAgent({ taskPath: path.trim() })
  process.exit(res.ok ? 0 : 1)
}
