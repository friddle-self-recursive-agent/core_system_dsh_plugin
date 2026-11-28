// taskrunner.test.ts —— headless 执行体监护回归锚（BugDoc 502 同族修复）：
// ①code=0 空 reply 的 502 归一可重试瞬态；②指数退避重试上限后 failed +
// TaskStateChanged(failed) + Escalate（绝不静默退进程）；③lastAction 心跳细粒度回写；
// ④失败后重跑可完成。全部依赖注入（spawn/fetch/sleep），零真实 cored/LLM 调用。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyExit, patchTaskStatus, runTaskAgent, taskIdOf,
} from '../src/bridges/task-agent-runner.mjs'

const DOC = `---
kind: Task
scope: self-recursive-core
name: probe-502
resourceVersion: 1
status:
  phase: running
  lastAction: 拉起中（spawn）
  lastError: ""
---

# 正文逐字节保留
探针正文，不参与 status 改写。
`

function fakeEnv({ outputs, taskId = 'self-recursive-core/probe-502', applyFails = 0 }: {
  outputs: Array<{ code: number; output: string }>
  taskId?: string
  applyFails?: number
}) {
  const applies: any[] = []
  const events: any[] = []
  const sleeps: number[] = []
  const beats: string[] = []
  let content = DOC
  let rv = 1
  let spawned = 0
  const fetchImpl = async (url: string, init?: any) => {
    if (url.includes('/v1/objects/Task/')) {
      return { ok: true, status: 200, json: async () => ({ content, resourceVersion: rv }) } as any
    }
    if (url.endsWith('/v1/apply')) {
      const body = JSON.parse(init.body)
      if (applyFails > 0 && applies.length === 0) {
        applyFails--
        return { ok: false, status: 409, text: async () => 'conflict' } as any
      }
      applies.push(body)
      content = body.content
      rv++
      return { ok: true, status: 200, text: async () => 'ok' } as any
    }
    if (url.endsWith('/v1/events')) {
      events.push(JSON.parse(init.body))
      return { ok: true, status: 200, text: async () => 'ok' } as any
    }
    return { ok: false, status: 404, text: async () => 'not found' } as any
  }
  const spawnImpl = ((_cmd: string, _args: string[], _opts: any) => {
    const step = outputs[Math.min(spawned, outputs.length - 1)]
    spawned++
    // 捕获 stdin 回执，验证 taskPath 只经 stdin 递送（零 shell 拼接）。
    const fake: any = {
      stdout: { on() {} },
      stderr: { on() {} },
      stdin: { on() {}, end(s?: string) { if (s) beats.push(s) } },
      on(ev: string, cb: any) {
        if (ev === 'close') queueMicrotask(() => cb(step.code))
      },
    }
    // 通过 stdout 的 data 监听回调注入瞬态日志。
    fake.stdout.on = (ev: string, cb: any) => {
      if (ev === 'data') queueMicrotask(() => cb(step.output))
    }
    return fake
  }) as any
  return {
    applies, events, sleeps, beats,
    count: () => spawned,
    fetchImpl: fetchImpl as any,
    spawnImpl,
    opts: {
      taskId, command: '/fake/dsh', args: ['-'],
      coredUrl: 'http://127.0.0.1:1', maxAttempts: 3, baseDelayMs: 1000,
      fetchImpl: fetchImpl as any, spawnImpl,
      sleep: async (ms: number) => { sleeps.push(ms) },
      log: () => {},
    },
  }
}

test('classifyExit：严格口径——只有 code=0 空 reply 的 502 才瞬态；裸 502/历史 502 不冒充', () => {
  assert.equal(classifyExit('dsh: SERVER: 502 ZCode did not stream: unexpected reply code=0/empty', 1), 'transient-502')
  assert.equal(classifyExit('{"code": 0, "reply": ""} upstream 502', 1), 'transient-502')
  assert.equal(classifyExit('SERVER: 502 permanent gateway misconfig (no code=0/empty)', 1), 'fatal')
  assert.equal(classifyExit('upstream Bad Gateway 502, no code/empty marker', 2), 'fatal')
  assert.equal(classifyExit('permission denied', 1), 'fatal')
  assert.equal(classifyExit('', 0), 'success')
  assert.equal(classifyExit('process succeeded but log mentions SERVER: 502 code=0/empty earlier', 0), 'success', 'exit 0=成功，历史日志不触发重复拉起')
})

test('taskIdOf + patchTaskStatus：宽松读 id；status 改写保 frontmatter/正文逐字节', () => {
  assert.equal(taskIdOf(DOC), '')
  assert.equal(taskIdOf('taskId: self-recursive-core/x\nstatus: {}\n'), 'self-recursive-core/x')
  const out = patchTaskStatus(DOC, { phase: 'failed', lastAction: '回收', lastError: '502' })
  assert.match(out, /^---\nkind: Task/)
  assert.match(out, /  phase: "failed"/)
  assert.match(out, /  lastAction: "回收"/)
  assert.match(out, /  lastError: "502"/)
  assert.ok(out.endsWith('探针正文，不参与 status 改写。\n'), '正文保留')
  assert.match(DOC, /  lastAction: 拉起中（spawn）/, '原文不被就地修改')
})

test('瞬态 502 两次后退避重试成功：心跳逐次回写、上限内不产 Escalate', async () => {
  const env = fakeEnv({ outputs: [
    { code: 1, output: 'dsh: SERVER: 502 ZCode did not stream code=0/empty' },
    { code: 1, output: 'dsh: SERVER: 502 ZCode did not stream code=0/empty' },
    { code: 0, output: 'done' },
  ] })
  const res = await runTaskAgent({ ...env.opts, taskPath: '/fake/task.yaml' })
  assert.equal(res.ok, true)
  assert.equal(res.attempts, 3)
  assert.equal(env.count(), 3)
  assert.deepEqual(env.sleeps, [1000, 2000], '指数退避 1s→2s')
  assert.ok(env.applies.length >= 6, '每次拉起/重试/成功均有 lastAction 心跳写面')
  assert.ok(env.applies.some((a) => a.content.includes('第 2/3 次拉起')), '细粒度进度=第几次拉起')
  assert.ok(env.applies.some((a) => a.content.includes('退避 1000ms')), '退避进度入账')
  assert.ok(env.applies.some((a) => a.content.includes('退避 2000ms')), '第二轮退避翻倍')
  assert.equal(env.events.length, 0, '上限内成功不产升级事件')
  assert.equal(env.beats[0], '/fake/task.yaml\n', 'taskPath 只经 stdin 递送')
})

test('重试上限后 failed + TaskStateChanged(failed) + Escalate，lastError 含 502 现场', async () => {
  const env = fakeEnv({ outputs: [
    { code: 1, output: 'SERVER: 502 did not stream code=0/empty' },
    { code: 1, output: 'SERVER: 502 did not stream code=0/empty' },
    { code: 1, output: 'SERVER: 502 did not stream code=0/empty' },
  ], applyFails: 1 })
  const res = await runTaskAgent({ ...env.opts, taskPath: '/fake/task.yaml' })
  assert.equal(res.ok, false)
  assert.equal(res.classification, 'transient-502')
  assert.equal(env.count(), 3)
  assert.deepEqual(env.sleeps, [1000, 2000])
  const finalApplies = env.applies.filter((a) => a.content.includes('"failed"'))
  assert.equal(finalApplies.length, 1, 'failed 写面恰好一次（409 重读后落）')
  assert.match(finalApplies[0].content, /网关瞬态 502（code=0 空 reply）重试上限 3 次仍失败/)
  assert.equal(finalApplies[0].fieldManager, 'task-scheduler')
  const types = env.events.map((e) => e.type)
  assert.deepEqual(types, ['TaskStateChanged', 'Escalate'])
  assert.equal(env.events[0].dedupKey, 'task:self-recursive-core/probe-502:failed')
  assert.equal(env.events[1].level, 'error')
})

test('非瞬态失败不重试：一次即 failed+Escalate；重跑成功不复发升级', async () => {
  const fatal = fakeEnv({ outputs: [{ code: 7, output: 'permission denied' }] })
  const r1 = await runTaskAgent({ ...fatal.opts, taskPath: '/fake/task.yaml' })
  assert.equal(r1.ok, false)
  assert.equal(r1.classification, 'fatal')
  assert.equal(fatal.count(), 1, '非瞬态不做退避重试')
  assert.equal(fatal.events.length, 2, '异常退出同样 failed+Escalate 不静默')

  // 重跑（复位为 ready 后同一 runner 再执行一次）：正常退出 → 只心跳无升级
  const rerun = fakeEnv({ outputs: [{ code: 0, output: 'ok' }] })
  const r2 = await runTaskAgent({ ...rerun.opts, taskPath: '/fake/task.yaml' })
  assert.equal(r2.ok, true)
  assert.equal(rerun.events.length, 0)
  assert.ok(rerun.applies.some((a) => a.content.includes('headless 正常退出')))
})
