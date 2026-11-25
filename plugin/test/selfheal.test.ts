// selfheal.test.ts —— v0.56 R-10 SelfHeal 注入桥真实接线单测（agent-session.md §7/§8：
// 注入只对「已判停滞的会话」发固定 prompt——不新增任何自动任务/自动执行面；桥缺席=绝不
// 冒充注入成功；注入词不被远端改写；回执心跳 source=session 非 watchdog=判定面自续租禁入）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mountSelfHealBridge, DEFAULT_HEAL_WORD, SELFHEAL_BOUNCE_PATH, SELFHEAL_HEARTBEAT_PHASE } from '../src/index.ts'

/** 极简 cordis 假 ctx（inject 回调登记面——软出现语义同宿主）。 */
function fakeCtx() {
  const callbacks: Array<(sub: any) => void> = []
  return {
    callbacks,
    inject(_deps: string[], apply: (sub: any) => void) { callbacks.push(apply) },
    deliver(sub: any) { for (const cb of callbacks) cb(sub) },
  }
}

function bounce(addr: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return fetch(`http://${addr}${SELFHEAL_BOUNCE_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}

test('selfheal 桥：注入停滞会话→sessionController.prompt(mode=queue, 固定词)∧回执心跳 source=session 非 watchdog', async () => {
  const ctx = fakeCtx()
  const prompts: any[] = []
  const beats: any[] = []
  const h = await mountSelfHealBridge(ctx, {
    heartbeat: async (p) => { beats.push(p) },
  })
  try {
    ctx.deliver({ sessionController: { prompt: async (req: any) => { prompts.push(req) } } })
    const res = await bounce(h.addr, { sessionId: 's-stalled', word: DEFAULT_HEAL_WORD, source: 'cored-watchdog' })
    assert.equal(res.status, 200, '注入受理=200')
    assert.equal(res.body.ok, true)
    assert.equal(prompts.length, 1, 'prompt 落投一次')
    const p = prompts[0]
    assert.equal(p.sessionId, 's-stalled')
    assert.equal(p.mode, 'queue', 'queue=保留上下文排队注入（不重启不 steer）')
    assert.deepEqual(p.content, [{ type: 'text', text: DEFAULT_HEAL_WORD }], '固定 prompt 词形（缺省「继续」）')
    assert.ok(p.requestId, 'requestId 在册')
    assert.equal(beats.length, 1, '注入受理回执心跳一次')
    assert.equal(beats[0].phase, SELFHEAL_HEARTBEAT_PHASE, '回执词形=inject-continue（活性观测）')
    assert.equal(beats[0].source, 'session', '回执来源=session（cored 拒收 source=watchdog=判定面自续租禁入）')
  } finally { h.stop() }
})

test('selfheal 桥防御面：缺 prompt 面=503 不冒充∧缺 sessionId=400∧注入词不匹配=400 不被远端改写∧GET/错路径=404', async () => {
  const ctx = fakeCtx()
  const h = await mountSelfHealBridge(ctx, {})
  try {
    // prompt 面未就绪（inject 回调未驱动）→ 503。
    const r1 = await bounce(h.addr, { sessionId: 's1', word: DEFAULT_HEAL_WORD })
    assert.equal(r1.status, 503, '宿主 prompt 面缺席=503（绝不冒充注入成功）')
    // 缺 sessionId=400。
    const r2 = await bounce(h.addr, { word: DEFAULT_HEAL_WORD })
    assert.equal(r2.status, 400)
    // 注入词不匹配=400（注入词不被远端改写——红线词形单点声明）。
    ctx.deliver({ sessionController: { prompt: async () => {} } })
    const r3 = await bounce(h.addr, { sessionId: 's1', word: '帮我做点别的' })
    assert.equal(r3.status, 400, '注入词不匹配=拒（只发固定 prompt）')
    // 非 POST/错路径=404。
    const g = await fetch(`http://${h.addr}${SELFHEAL_BOUNCE_PATH}`)
    assert.equal(g.status, 404)
    const w = await fetch(`http://${h.addr}/other`, { method: 'POST', body: '{}' })
    assert.equal(w.status, 404)
  } finally { h.stop() }
})

test('selfheal 桥 prompt 落投失败=502（cored 侧照实上报绝不静默）∧坏载荷=400', async () => {
  const ctx = fakeCtx()
  const beats: any[] = []
  const h = await mountSelfHealBridge(ctx, { heartbeat: async (p) => { beats.push(p) } })
  try {
    ctx.deliver({ sessionController: { prompt: async () => { throw new Error('queue 满载（判别桩）') } } })
    const r = await bounce(h.addr, { sessionId: 's1', word: DEFAULT_HEAL_WORD })
    assert.equal(r.status, 502, 'prompt 失败=502（失败上报路径）')
    assert.equal(beats.length, 0, '失败无回执心跳（不冒充受理）')
    const bad = await fetch(`http://${h.addr}${SELFHEAL_BOUNCE_PATH}`, { method: 'POST', body: 'not-json' })
    assert.equal(bad.status, 400)
  } finally { h.stop() }
})
