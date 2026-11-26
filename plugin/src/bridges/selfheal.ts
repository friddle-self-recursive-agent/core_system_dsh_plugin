// bridges/selfheal.ts —— SelfHeal 注入桥装配（v0.56 R-10——agent-session.md §7/§8 自愈第一动作真实接线，dsh 宿主侧）。
// R-ENG-7 拆分：原 index.ts 的 mountSelfHealBridge 全量搬家（零语义变化）。
import { randomUUID } from 'node:crypto'
import { DEFAULT_HEAL_WORD, SELFHEAL_BOUNCE_PATH, SELFHEAL_HEARTBEAT_PHASE } from '../config.ts'

export interface SelfHealBridgeHandle {
  /** loopback 监听地址（host:port——cored 侧 CORE_SYSTEM_SELFHEAL_ADDR 回填值）。 */
  addr: string
  /** 停桥（插件退场回收——listener+inject 回调随 disposer 注销）。 */
  stop(): void
}

export async function mountSelfHealBridge(
  ctx: any,
  opts: {
    /** loopback 监听地址（host:port）；缺省 127.0.0.1 随机口。 */
    addr?: string
    /** 注入词（缺省 DEFAULT_HEAL_WORD——cored --self-heal-word 单点声明同值）。 */
    word?: string
    /** 心跳回执通路（既有 /core-console/session-heartbeat 通路宿主侧直调核心——桥侧同进程
     *  直调 cored /v1/sessions/heartbeat；测试注入假实现）。 */
    heartbeat?: (payload: Record<string, unknown>) => Promise<unknown>
    /** node:http 注入面（测试用——缺省真实模块）。 */
    httpModule?: typeof import('node:http')
  } = {},
): Promise<SelfHealBridgeHandle> {
  const httpMod = opts.httpModule ?? (await import('node:http'))
  const word = opts.word ?? DEFAULT_HEAL_WORD
  let prompt: ((req: { sessionId: string; requestId: string; mode: 'queue' | 'steer'; content: { type: 'text'; text: string }[] }) => Promise<unknown>) | null = null
  // prompt 面=回调式软出现（声明式 inject 加新服务名=apply 停等——§1.11 补注①教训）。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionController'], (sub: any) => {
      const sc = Reflect.get(sub, 'sessionController')
      if (!sc || typeof sc.prompt !== 'function') return // 防御面：缺席即不接
      prompt = (req) => sc.prompt(req, AbortSignal.timeout(10_000))
      console.error('[core-system-diag] selfheal 桥 prompt 面已接（sessionController 就绪）')
    })
  }
  const server = httpMod.createServer((req, res) => {
    const url = String(req.url ?? '/').split('?')[0]
    if (req.method !== 'POST' || url !== SELFHEAL_BOUNCE_PATH) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'not found（selfheal 桥只收 POST /selfheal/bounce）' }))
      return
    }
    let raw = ''
    req.on('data', (c: Buffer | string) => { raw += c.toString() })
    req.on('end', async () => {
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw || '{}') as Record<string, unknown>
      } catch {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: '载荷不可解析（需 JSON 对象）' }))
        return
      }
      const sessionId = String(body.sessionId ?? '')
      const incoming = String(body.word ?? '') || word
      if (!sessionId) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: '缺 sessionId（停滞会话锚必填）' }))
        return
      }
      // 红线：只发固定 prompt（cored watchdog 已判停滞的唯一触发源）——词形以本面声明为准
      //（cored --self-heal-word 单点声明同值；载荷 word 仅核对不采信——注入词不被远端改写）。
      if (incoming !== word) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: `注入词不匹配（本面声明=${word}——注入词不被远端改写）` }))
        return
      }
      if (!prompt) {
        res.statusCode = 503
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: '宿主 prompt 面未就绪（sessionController 缺席——绝不冒充注入成功）' }))
        return
      }
      try {
        await prompt({
          sessionId,
          requestId: randomUUID(),
          mode: 'queue', // queue=保留上下文排队注入（不重启不 steer——自愈第一动作语义）
          content: [{ type: 'text', text: word }],
        })
      } catch (e) {
        res.statusCode = 502
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: `prompt 落投失败: ${String((e as Error)?.message ?? e)}` }))
        return
      }
      // 注入受理→活性观测回执（phase=inject-continue，source=session——非续租；cored 拒收
      // source=watchdog=判定面自续租禁入，本回执来源恒 session）。
      if (opts.heartbeat) {
        try {
          await opts.heartbeat({ sessionId, phase: SELFHEAL_HEARTBEAT_PHASE, lastAction: `注入固定 prompt「${word}」（自愈第一动作·受理）`, source: 'session' })
        } catch { /* 回执失败不阻断注入结果（cored 侧下一拍重扫——观测面可重建） */ }
      }
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, sessionId, word, delivery: 'queue' }))
    })
  })
  const listenHost = (opts.addr ?? '127.0.0.1:0').split(':')[0] || '127.0.0.1'
  const wantPort = Number((opts.addr ?? '127.0.0.1:0').split(':')[1] ?? 0) || 0
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(wantPort, listenHost, () => resolve())
  })
  server.unref() // 桥 listener 不持事件循环（测试进程可退；插件退场 stop() 显式回收）
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? `${address.address}:${address.port}` : String(opts.addr ?? '')
  console.error('[core-system-diag] selfheal 桥 listener=%s（CORE_SYSTEM_SELFHEAL_ADDR 回填——cored watchdog 注入路由）', bound)
  return {
    addr: bound,
    stop: () => { server.close() },
  }
}
