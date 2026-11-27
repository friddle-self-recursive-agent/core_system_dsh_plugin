// servicespawn.test.ts —— service spawn 桥单测（2026-11-27 session 裁决——workflow.md §1.3；
// 与 task-spawn 桥同族）：固定命令零参数（载荷不进命令）+载荷 JSON 只经 stdin 递送；
// workflow:run:node 锁文件单飞（活 pid=already-running / 陈旧锁=清后重派）；缺命令=503
// 诚实降级；缺 workflow/node=400。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mountServiceSpawnBridge, SERVICE_SPAWN_PATH } from '../src/index.ts'

function post(addr: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return fetch(`http://${addr}${SERVICE_SPAWN_PATH}`, {
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

test('service spawn 桥：固定命令零参数拉起+载荷 JSON 走 stdin；锁落盘；回执 spawned/sessionHint', async () => {
  const calls: Array<{ cmd: string; args: string[]; opts: any }> = []
  const fed: string[] = []
  const spawnImpl = ((cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, opts })
    return fakeChild(process.pid, fed) // 活 pid=锁活性判定成立（单飞语义对进程存在性负责）
  }) as any
  const lockDir = join(tmpdir(), `svc-spawn-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const h = await mountServiceSpawnBridge({}, { command: '/opt/fake/service-session.sh', lockDir, spawnImpl })
  try {
    const payload = {
      spawnSeq: 1, workflow: 'core-system-developer-loop', run: 3, node: 'developer-system',
      phase: 'Executing', service: 'developer-system', op: 'develop',
      agent: 'agent/ci-repair-agent', role: 'role/developer-system-ops', context: ['judge', 'plan'],
    }
    const r1 = await post(h.addr, payload)
    assert.equal(r1.status, 202)
    assert.equal(r1.body.ok, true)
    assert.equal(r1.body.status, 'spawned')
    assert.equal(r1.body.sessionHint, 'core-system-developer-loop:3:developer-system')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cmd, '/opt/fake/service-session.sh')
    assert.deepEqual(calls[0].args, [], '固定命令零参数（载荷不参与命令构造）')
    assert.equal(calls[0].opts.stdio[0], 'pipe', 'stdin 管道在（载荷 JSON 递送通道）')
    const fedRaw = fed.join('')
    assert.ok(fedRaw.indexOf('"agent":"agent/ci-repair-agent"') >= 0, '载荷 JSON（含 agent）只经 stdin 递给命令')
    assert.ok(fedRaw.endsWith('\n'), 'stdin 以换行收尾')
    // 锁落盘（0600 内容含 pid）——单飞依据
    const lockPath = join(lockDir, 'core-system-developer-loop_3_developer-system.lock')
    assert.equal(existsSync(lockPath), true, 'workflow:run:node 锁文件在册（sanitize 文件名）')
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(lock.pid, process.pid)

    // 同 run·节点第二次：活 pid 锁=already-running 不重复拉起
    const r2 = await post(h.addr, payload)
    assert.equal(r2.status, 200)
    assert.equal(r2.body.status, 'already-running')
    assert.equal(calls.length, 1, '同 run·节点不重复拉起（单飞）')

    // 不同节点：无锁=照常拉起
    const r3 = await post(h.addr, { ...payload, node: 'verify', op: 'acceptance' })
    assert.equal(r3.status, 202)
    assert.equal(r3.body.status, 'spawned')
    assert.equal(calls.length, 2)
  } finally {
    h.stop()
  }
})

test('service spawn 桥：陈旧锁（pid 不存活）=清锁重派；活 pid 预置锁=already-running', async () => {
  const calls: string[] = []
  const spawnImpl = ((cmd: string) => {
    calls.push(cmd)
    return fakeChild(5353, [])
  }) as any
  const lockDir = join(tmpdir(), `svc-spawn-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(lockDir, { recursive: true })
  const staleLock = join(lockDir, 'wf_9_gone.lock')
  writeFileSync(staleLock, JSON.stringify({ key: 'wf:9:gone', pid: 2147483000, at: 1 }), { mode: 0o600 })
  const liveLock = join(lockDir, 'wf_9_alive.lock')
  writeFileSync(liveLock, JSON.stringify({ key: 'wf:9:alive', pid: process.pid, at: 1 }), { mode: 0o600 })
  const h = await mountServiceSpawnBridge({}, { command: '/opt/fake/service-session.sh', lockDir, spawnImpl })
  try {
    const r1 = await post(h.addr, { workflow: 'wf', run: 9, node: 'gone' })
    assert.equal(r1.status, 202, '陈旧锁清后重派')
    assert.equal(r1.body.status, 'spawned')
    const r2 = await post(h.addr, { workflow: 'wf', run: 9, node: 'alive' })
    assert.equal(r2.status, 200)
    assert.equal(r2.body.status, 'already-running')
    assert.equal(calls.length, 1, '活进程锁=不重复拉起')
  } finally {
    h.stop()
  }
})

test('service spawn 桥：缺命令=503；缺 workflow/node=400；错误路径=404', async () => {
  const h = await mountServiceSpawnBridge({}, {})
  try {
    const r1 = await post(h.addr, { workflow: 'wf', run: 1, node: 'n' })
    assert.equal(r1.status, 503, 'service 会话命令未配置=诚实降级不冒充满载')
    assert.ok(String(r1.body.error).indexOf('serviceSpawnCommand') >= 0)
    const r2 = await post(h.addr, { run: 1, node: 'n' })
    assert.equal(r2.status, 400)
    const r3 = await post(h.addr, { workflow: 'wf', run: 1 })
    assert.equal(r3.status, 400)
  } finally {
    h.stop()
  }
  const h2 = await mountServiceSpawnBridge({}, { command: '/opt/fake/service-session.sh', lockDir: join(tmpdir(), `svc-spawn-404-${Date.now()}`) })
  try {
    const res = await fetch(`http://${h2.addr}/other/path`, { method: 'POST', body: '{}' })
    assert.equal(res.status, 404)
    const res2 = await fetch(`http://${h2.addr}${SERVICE_SPAWN_PATH}`)
    assert.equal(res2.status, 404, '只收 POST')
  } finally {
    h2.stop()
  }
})
