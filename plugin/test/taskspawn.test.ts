// taskspawn.test.ts —— 多任务调度宿主 spawn 桥单测（task-scheduler.md §4；与 wake 桥同族）：
//   固定命令零参数（载荷不进命令）+ taskPath 只经 stdin 递送；taskId 锁文件单飞
//   （活 pid=already-running / 陈旧锁=清后重派）；缺命令=503 诚实降级；缺 taskId/taskPath=400。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mountTaskSpawnBridge, TASK_SPAWN_PATH } from '../src/index.ts'

function post(addr: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return fetch(`http://${addr}${TASK_SPAWN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}

function fakeChild(pid: number, sink: string[]) {
  return {
    pid,
    unref() {},
    on() {},
    stdin: {
      on() {},
      write(s: string) { sink.push(s) },
      end(s?: string) { if (s !== undefined) sink.push(s) },
    },
  }
}

test('task spawn 桥：固定命令零参数拉起+taskPath 走 stdin；锁落盘；回执 spawned/sessionHint', async () => {
  const calls: Array<{ cmd: string; args: string[]; opts: any }> = []
  const fed: string[] = []
  const spawnImpl = ((cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, opts })
    return fakeChild(process.pid, fed) // 活 pid=锁活性判定成立（单飞语义对进程存在性负责）
  }) as any
  const lockDir = join(tmpdir(), `task-spawn-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const h = await mountTaskSpawnBridge({}, { command: '/opt/fake/task-run.sh', lockDir, spawnImpl })
  try {
    const r1 = await post(h.addr, {
      taskId: 'dev/task-123', taskPath: '/tmp/tasks/task-123.yaml',
      workspace: { mode: 'worktree', path: '/ws/x', branch: 'task/task-123' }, agent: 'dev-1',
    })
    assert.equal(r1.status, 202)
    assert.equal(r1.body.ok, true)
    assert.equal(r1.body.status, 'spawned')
    assert.equal(r1.body.sessionHint, 'dev/task-123')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cmd, '/opt/fake/task-run.sh')
    assert.deepEqual(calls[0].args, [], '固定命令零参数（载荷不参与命令构造）')
    assert.equal(calls[0].opts.stdio[0], 'pipe', 'stdin 管道在（taskPath 递送通道）')
    assert.ok(fed.join('').indexOf('/tmp/tasks/task-123.yaml') >= 0, 'taskPath 只经 stdin 递给命令')
    // 锁落盘（0600 内容含 pid）——单飞依据
    const lockPath = join(lockDir, 'dev_task-123.lock')
    assert.equal(existsSync(lockPath), true, 'taskId 锁文件在册（sanitize 文件名）')
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(lock.pid, process.pid)

    // 同 taskId 第二次：活 pid 锁=already-running 不重复拉起
    const r2 = await post(h.addr, { taskId: 'dev/task-123', taskPath: '/tmp/tasks/task-123.yaml' })
    assert.equal(r2.status, 200)
    assert.equal(r2.body.status, 'already-running')
    assert.equal(calls.length, 1, '同任务不重复拉起（单飞）')

    // 不同 taskId：无锁=照常拉起
    const r3 = await post(h.addr, { taskId: 'dev/task-124', taskPath: '/tmp/tasks/task-124.yaml' })
    assert.equal(r3.status, 202)
    assert.equal(r3.body.status, 'spawned')
    assert.equal(calls.length, 2)
  } finally {
    h.stop()
  }
})

test('task spawn 桥：陈旧锁（pid 不存活）=清锁重派；活 pid 预置锁=already-running', async () => {
  const calls: string[] = []
  const spawnImpl = ((cmd: string) => {
    calls.push(cmd)
    return fakeChild(5252, [])
  }) as any
  const lockDir = join(tmpdir(), `task-spawn-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(lockDir, { recursive: true })
  const staleLock = join(lockDir, 'dev_gone.lock')
  writeFileSync(staleLock, JSON.stringify({ taskId: 'dev/gone', pid: 2147483000, at: 1 }), { mode: 0o600 })
  const liveLock = join(lockDir, 'dev_alive.lock')
  writeFileSync(liveLock, JSON.stringify({ taskId: 'dev/alive', pid: process.pid, at: 1 }), { mode: 0o600 })
  const h = await mountTaskSpawnBridge({}, { command: '/opt/fake/task-run.sh', lockDir, spawnImpl })
  try {
    const r1 = await post(h.addr, { taskId: 'dev/gone', taskPath: '/tmp/tasks/gone.yaml' })
    assert.equal(r1.status, 202, '陈旧锁清后重派（租约回收语义）')
    assert.equal(r1.body.status, 'spawned')
    const r2 = await post(h.addr, { taskId: 'dev/alive', taskPath: '/tmp/tasks/alive.yaml' })
    assert.equal(r2.status, 200)
    assert.equal(r2.body.status, 'already-running')
    assert.equal(calls.length, 1, '活进程锁=不重复拉起')
  } finally {
    h.stop()
  }
})

test('task spawn 桥：缺命令=503；缺 taskId/taskPath=400；错误路径=404', async () => {
  const h = await mountTaskSpawnBridge({}, {})
  try {
    const r1 = await post(h.addr, { taskId: 'dev/x', taskPath: '/tmp/x.yaml' })
    assert.equal(r1.status, 503, 'task 命令未配置=诚实降级不冒充满载')
    assert.ok(String(r1.body.error).indexOf('taskSpawnCommand') >= 0)
    const r2 = await post(h.addr, { taskPath: '/tmp/x.yaml' })
    assert.equal(r2.status, 400)
    const r3 = await post(h.addr, { taskId: 'dev/x' })
    assert.equal(r3.status, 400)
  } finally {
    h.stop()
  }
  const h2 = await mountTaskSpawnBridge({}, { command: '/opt/fake/task-run.sh', lockDir: join(tmpdir(), `task-spawn-404-${Date.now()}`) })
  try {
    const res = await fetch(`http://${h2.addr}/other/path`, { method: 'POST', body: '{}' })
    assert.equal(res.status, 404)
    const res2 = await fetch(`http://${h2.addr}${TASK_SPAWN_PATH}`)
    assert.equal(res2.status, 404, '只收 POST')
  } finally {
    h2.stop()
  }
})
