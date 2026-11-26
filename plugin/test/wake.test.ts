// wake.test.ts —— R-UX-8 事件→自循环拉起桥单测：
//   LoopRequested→部署侧 loop 命令（spawn 固定命令，载荷不进命令）；单飞检测 already-running；
//   非白名单类型/非 root 锚=400；无命令=503 诚实降级；零 shell 拼接。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountWakeBridge, WAKE_SPAWN_PATH } from '../src/index.ts'

function post(addr: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return fetch(`http://${addr}${WAKE_SPAWN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}

test('wake 桥：LoopRequested→固定命令拉起；已有循环=already-running；载荷不进命令', async () => {
  const calls: Array<{ cmd: string; args: string[]; opts: any }> = []
  const spawnImpl = ((cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, opts })
    return { pid: 4242, unref() {} }
  }) as any
  let running = false
  const execFileImpl = ((_file: string, _args: string[], _opts: any, cb: any) => {
    cb(running ? null : new Error('no process'), running ? '123 dsh\n' : '', '')
  }) as any

  const h = await mountWakeBridge({}, {
    command: '/opt/fake/loop.sh',
    runningPattern: 'dsh --profile core-headless',
    spawnImpl,
    execFileImpl,
  })
  try {
    const r1 = await post(h.addr, { type: 'LoopRequested', agent: 'root-agent', eventId: 'evt-1', dedupKey: 'd1' })
    assert.equal(r1.status, 202)
    assert.equal(r1.body.status, 'spawned')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cmd, '/opt/fake/loop.sh')
    assert.deepEqual(calls[0].args, [])
    assert.notEqual(calls[0].opts.stdio, 'pipe', '不接管道（载荷不进命令）')

    running = true
    const r2 = await post(h.addr, { type: 'LoopRequested', agent: 'root-agent', eventId: 'evt-2' })
    assert.equal(r2.status, 200)
    assert.equal(r2.body.status, 'already-running')
    assert.equal(calls.length, 1, '已有循环不重复拉起')

    const r3 = await post(h.addr, { type: 'ReconcileTick', agent: 'root-agent' })
    assert.equal(r3.status, 400)
    const r4 = await post(h.addr, { type: 'LoopRequested', agent: 'parent-agent' })
    assert.equal(r4.status, 400)
  } finally {
    h.stop()
  }
})

test('wake 桥：loop 命令未配置=503（不冒充满载）', async () => {
  const h = await mountWakeBridge({}, {})
  try {
    const res = await post(h.addr, { type: 'LoopRequested', agent: 'root-agent' })
    assert.equal(res.status, 503)
  } finally {
    h.stop()
  }
})
