// tools/agent-comm.ts —— agent-comm 四 op 工具装配（console v2 E5b；cross-agent.md §5 协议 v0.1）。
// R-ENG-7 拆分：原 index.ts 的 mountAgentCommTools/registerAgentCommTools/CommState 全量搬家（零语义变化）。
// 协议实现（信封/mailbox/journal/executeAgentCommOp）仍在 src/agent-comm.ts（兼容层保留，不动）。
// 定位：本文件是 core plugin 对 dsh 宿主工具面的贡献（ctx.tools.register 四工具），
// 不是 connector 驱动——R-ENG-3 归属裁决（2026-11-25 注记 rule.md）：工具宿主=plugin 仓本体。
import {
  AGENT_COMM_KINDS,
  CommJournal,
  Mailbox,
  executeAgentCommOp,
  type AgentCommDeps,
  type AgentCommResult,
} from '../agent-comm.ts'
import type { CoreSystemBridge } from '../bridge.ts'

/** agent-comm 运行时落账状态（一次插件激活一份；mailbox=v0.1 既有落账面，
 *  journal=E6 comm 流水——同族扩展，console 只渲染）。 */
export interface CommState {
  mailbox: Mailbox
  journal: CommJournal
}

export function createCommState(): CommState {
  return { mailbox: new Mailbox(), journal: new CommJournal() }
}

/** agent-comm 四 op 工具名（§5.3：agent 只见四个 op——工具名=协议 op 名裸用，
 *  E5a 判别器（op 名 ∈ 文档面声明集）零改动即命中 ConnectorOps 卡）。 */
export const AGENT_COMM_TOOL_NAMES = [...AGENT_COMM_KINDS]

/**
 * agent-comm 四 op 工具装配（E5b；cross-agent.md §5 协议 v0.1）：
 *   ctx.tools.register 四工具（dispatch/query/interrupt/inbox）——工具宿主=本 plugin
 *   对 dsh 宿主工具面的贡献（R-ENG-3 归属裁决 2026-11-25：非 connector 驱动，不入
 *   common_connector）。传输=同机进程内注册表（ctx.agents 活体 + 文档面 Agent 对象解析）；
 *   会话控制器 prompt/cancel 面=回调式 inject 软出现（§1.11 补注①教训：声明式 inject
 *   加新服务名会 cordis apply 停等=整面板缺席）。
 * 防御面：tools/agents/sessionController 任一缺席宿主=对应能力不注册/解析必拒，不炸宿主；
 * 撞名（dsh 保留 run_code+既有工具）=warn+跳过该 op。
 */
export function mountAgentCommTools(ctx: any, bridge: CoreSystemBridge, comm: CommState = createCommState()): void {
  const mailbox = comm.mailbox
  const journal = comm.journal
  const faces: {
    prompt?: AgentCommDeps['prompt']
    cancel?: AgentCommDeps['cancel']
    agents?: AgentCommDeps['agents']
  } = {}
  // 回调式软出现（声明式 inject 加新服务名=apply 停等；ctx.<服务> 直访=without inject 抛错
  // ——§1.11 补注①护栏语义，agents 同款实证 2026-11-25 探针）。缺席宿主回调永不启动。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionController'], (sub: any) => {
      const sc = Reflect.get(sub, 'sessionController')
      if (!sc || typeof sc.prompt !== 'function') return // 防御面：inject 已保证，缺席即不接
      faces.prompt = (req) => sc.prompt(req, AbortSignal.timeout(10_000))
      if (typeof sc.cancel === 'function') faces.cancel = (req) => sc.cancel(req)
    })
    // 同机活体注册表（to 解析第③步）：缺席回调=活体面解析必拒（诚实降级不冒充）
    ctx.inject(['agents'], (sub: any) => {
      const ag = Reflect.get(sub, 'agents')
      if (ag && typeof ag.get === 'function') faces.agents = ag
    })
    // 四 op 工具注册（tools 服务就绪后；撞名=warn+跳过该 op 其余照常）
    ctx.inject(['tools'], (sub: any) => {
      console.error('[core-system-diag] inject([tools]) 回调触发')
      const tools = Reflect.get(sub, 'tools')
      if (!tools || typeof tools.register !== 'function') { console.error('[core-system-diag] tools 服务缺席'); return }
      registerAgentCommTools(ctx, tools, (kind, args, caller) =>
        executeAgentCommOp(kind, args, { core: bridge, ...faces, callerAgentId: caller }, mailbox, undefined, journal))
    })
    console.error('[core-system-diag] agent-comm inject 挂起（sessionController/agents/tools 三回调已登记）')
  } else if (ctx.tools && typeof ctx.tools.register === 'function') {
    // 无 inject 能力宿主（测试假体/极简壳）：tools 直取容错
    registerAgentCommTools(ctx, ctx.tools, (kind, args, caller) =>
      executeAgentCommOp(kind, args, { core: bridge, ...faces, callerAgentId: caller }, mailbox, undefined, journal))
  }
}

/** 四 op 工具注册核（tools 面就绪后调用；run=注入 faces+bridge+mailbox 的分派闭包）。 */
function registerAgentCommTools(
  ctx: any,
  tools: { register(definition: any): () => void },
  run: (kind: (typeof AGENT_COMM_KINDS)[number], args: unknown, callerAgentId?: string) => Promise<AgentCommResult>,
): void {
  const defs = [
    {
      name: 'dispatch',
      description: 'agent-comm 派任务（cross-agent.md §5.2）：向另一个已注册 agent 派一次意图（异步）。'
        + ' to 必须是文档面在册且本机活体在册的 agent（agent/<name>@<scope>）；必带 token（权限凭据）。'
        + ' 回执=accepted（消息入对方会话队列）；对方的业务回复在其 SessionLog（v0.1 不自动回传）。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>' },
        text: { type: 'string', required: true, description: '任务意图（一次意图一段文本）' },
        token: { type: 'string', required: true, description: '权限 token（⊆ 发起方权限面；缺失=拒）' },
        hint: { type: 'string', description: '可选执行提示' },
        refs: { type: 'array', items: { type: 'string' }, description: '可选文档面引用（systems/<s>/path#revN）' },
      },
      args: (a: any) => ({ to: a.to, text: a.text, token: a.token, hint: a.hint, refs: a.refs }),
    },
    {
      name: 'query',
      description: 'agent-comm 只读问询（cross-agent.md §5.2）：查另一个已注册 agent 的状态快照（活体/文档相位/待处理输入）。'
        + ' 同步返回；v0.1=只读快照（对话式问询请用 dispatch——对方回复在其 SessionLog）。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>' },
        text: { type: 'string', description: '可选问询说明（v0.1 仅入信封审计，不投递）' },
      },
      args: (a: any) => ({ to: a.to, text: a.text }),
    },
    {
      name: 'interrupt',
      description: 'agent-comm 取消/插话（cross-agent.md §5.2）：打断另一个已注册 agent 的活跃回合（对应 dsh cancel/steer）。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>' },
        reason: { type: 'string', description: '可选打断原因（入 ops 留痕）' },
      },
      args: (a: any) => ({ to: a.to, reason: a.reason }),
    },
    {
      name: 'inbox',
      description: 'agent-comm 拉取未消费消息（cross-agent.md §5.2）：拉取目标 agent 的 agent-comm 收件箱（error reply 落账；按 id 幂等去重），'
        + ' 并附其活体 pending 输入计数。对等场景没有共同上级替你翻 SessionLog——拉取是唯一入口。',
      parameters: {
        to: { type: 'string', required: true, description: '目标 agent ref：agent/<name>@<scope>（通常填自己=拉自己的收件箱）' },
        limit: { type: 'integer', description: '最多返回条数（缺省全部）' },
      },
      args: (a: any) => ({ to: a.to, ...(a.limit !== undefined ? { payload: { limit: a.limit } } : {}) }),
    },
  ]

  let registered = 0
  for (const d of defs) {
    try {
      tools.register({
        name: d.name,
        description: d.description,
        parameters: d.parameters as any,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              // output schema DSL 约束（2026-11-25 探针实证）：properties 节点不收 required
              // （required 只在隐式参数根）；'json' 类型不被 output 接受→对象开面。
              ok: { type: 'boolean' },
              op: { type: 'string' },
              envelopeId: { type: 'string' },
              to: { type: 'string' },
              detail: { type: 'object', additionalProperties: true },
              error: { type: 'string' },
            },
          },
          render: (_args: unknown, value: any) => {
            const lines = [
              `agent-comm ${value.op} → ${value.to}`,
              value.ok ? `accepted（envelope ${value.envelopeId}）` : `failed：${String(value.error ?? 'unknown')}`,
            ]
            if (value.detail !== undefined) lines.push(JSON.stringify(value.detail))
            return [{ type: 'text', text: lines.join('\n') }]
          },
        },
        isConcurrencySafe: () => true,
        async execute(args: any, exec: any) {
          return run(d.name as (typeof AGENT_COMM_KINDS)[number], d.args(args ?? {}), exec?.agent?.id ?? undefined)
        },
      })
      registered++
    } catch (e) {
      console.error('[core-system-diag] 工具 %s 注册失败：%s', d.name, String((e as Error)?.stack ?? e).slice(0, 500))
    }
  }
  console.error('[core-system-diag] agent-comm 注册完成 %d/4', registered)
}
