// scenario.test.ts —— E7 场景面纯函数层 + 静态面验收（console-adoption.md §1.14 L43 判据的测试核）：
// tag 现读解析（spec.metadata.tags/metadata.tags，flow+block 形态）/ involved scope 匹配 /
// 游标合并去重 / 挂载现读 / 合成压测窗标记与确定性 / 四屏真数据换装标记 + mock 渲染面归零。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const SRC = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')
const scnSrc = readFileSync(join(PLUGIN, 'client/console-scenario.js'), 'utf8')
const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')

/** 沙箱执行 console-scenario.js（__CC 桩），返回纯函数层。 */
function loadScenario() {
  const cc: any = {}
  const fn = new Function('__CC', scnSrc)
  fn(cc)
  return cc.scenario
}

test('tagsOf：spec.metadata.tags 优先 + metadata.tags 兜底 + flow/block/内联三形态', () => {
  const s = loadScenario()
  assert.deepEqual(s.tagsOf('metadata:\n  name: x\nspec:\n  metadata:\n    tags: [prod, ci]\n'), ['prod', 'ci'])
  assert.deepEqual(s.tagsOf('metadata:\n  tags:\n    - a\n    - b\n'), ['a', 'b'])
  assert.deepEqual(s.tagsOf('metadata: {name: x, tags: [flow-one]}\n'), ['flow-one'])
  assert.deepEqual(s.tagsOf('metadata:\n  name: x\nspec:\n  workservice: ws\n'), [], '零声明=空集（不冒充）')
  assert.deepEqual(s.tagsOf('tags: ["q, x", b]\n'), ['q, x', 'b'], '引号感知分词（引号内逗号不切）')
  const dup = s.tagsOf('tags: [a, a, b]\n')
  assert.deepEqual(dup, ['a', 'b'], '去重保序')
})

test('scopeOfInvolved/evInScope：involved 中段=scope，systems/<name> 前缀形兼容，非三段不归属', () => {
  const s = loadScenario()
  assert.equal(s.scopeOfInvolved('ConnectorOps/global/agent-comm'), 'global')
  assert.equal(s.scopeOfInvolved('Workflow/self-recursive-core/dev-delivery'), 'self-recursive-core')
  assert.equal(s.scopeOfInvolved(''), '')
  assert.equal(s.scopeOfInvolved('Workflow'), '')
  assert.equal(s.evInScope({ involved: 'Workflow/self-recursive-core/dev-delivery' }, 'self-recursive-core'), true)
  assert.equal(s.evInScope({ involved: 'Rule/systems/self-recursive-core/r-1' }, 'self-recursive-core'), true)
  assert.equal(s.evInScope({ involved: 'ConnectorOps/global/agent-comm' }, 'self-recursive-core'), false)
  assert.equal(s.evInScope({ involved: '' }, 'self-recursive-core'), false, 'involved 未标注=不归属（不猜）')
})

test('mergeEvents：eventId 去重（相邻页零重叠语义的防御面）+ 保序', () => {
  const s = loadScenario()
  const base = [{ eventId: 'e1' }, { eventId: 'e2' }]
  const page = [{ eventId: 'e2' }, { eventId: 'e0' }]
  const merged = s.mergeEvents(base, page)
  assert.deepEqual(merged.map((e: any) => e.eventId), ['e1', 'e2', 'e0'])
  assert.deepEqual(s.mergeEvents(base, []), base, '空页=原窗')
})

test('mountsOf/agentMountsKind：Agent 声明正文挂载现读（词表前缀→kind 映射）', () => {
  const s = loadScenario()
  const doc = 'spec:\n  connectorOps:\n    - {ops: connector-ops/agent-comm, as: agent-comm}\n  providerRef: providers/llm-main\n'
  const ms = s.mountsOf(doc)
  assert.ok(ms.some((m: any) => m.kind === 'ConnectorOps' && m.name === 'agent-comm'))
  assert.ok(ms.some((m: any) => m.kind === 'Provider' && m.name === 'llm-main'))
  assert.ok(s.agentMountsKind(doc, 'ConnectorOps', 'agent-comm'), '命中')
  assert.equal(s.agentMountsKind(doc, 'ConnectorOps', 'notify-send-email'), null, '未挂载=null')
})

test('synEvents：确定性合成窗（同种子同序列）+ synthetic 标记 + syn- 前缀（不入归档的展示层通道）', () => {
  const s = loadScenario()
  const a = s.synEvents(1200)
  const b = s.synEvents(1200)
  assert.equal(a.length, 1200, '千级载荷')
  const proj = (rows: any[]) => rows.map((e) => ({ id: e.eventId, t: e.type, lv: e.level, inv: e.involved }))
  assert.deepEqual(proj(a), proj(b), '同种子确定性（类型/级别/序——ts 锚定现钟不入断言）')
  assert.ok(a.every((e: any) => e.synthetic === true && String(e.eventId).startsWith('syn-')), '行级 synthetic 标记+syn- 前缀')
  assert.ok(a.every((e: any) => String(e.involved).startsWith('Synthetic/probe/')), 'involved=合成命名空间（不与文档面键空间相交）')
  const times = a.map((e: any) => Date.parse(e.ts))
  assert.ok(times.every((t: number, i: number) => i === 0 || t <= times[i - 1]), '最新优先序')
})

test('E7 静态面：四场景屏真数据换装（读面数据源标注 + 零 mock 事件名 + 诚实空态线）', () => {
  assert.ok(appSrc.includes('function screenEventsCore'), '全局/场景面共用屏核在册（过滤条同款的结构保证）')
  assert.ok(appSrc.includes('function screenSysEvents') && appSrc.includes('screenEventsCore(view, S.params.name)'), '场景事件面=共用核换装')
  assert.ok(appSrc.includes('指标数据未接入'), 'metrics 空投影诚实空态在册（不冒充曲线；R-UX-3：数据面未装配→指标数据未接入）')
  assert.ok(appSrc.includes('function hydrateMetricQueries'), '即席查询注水在册（404=无投影结果如实标注）')
  assert.ok(appSrc.includes('spec.metadata.tags'), 'tag 口径标注在册（scheme conventions 检索元数据）')
  assert.ok(appSrc.includes('function hydrateDocTags'), 'tag 现读注水在册')
  assert.ok(appSrc.includes('授权来源现读'), '权限矩阵格=声明正文现读在册')
  assert.ok(appSrc.includes('Role / Group 对象零在册'), 'Role/Group 诚实空态在册（docsRoot 零对象不冒充）')
  assert.ok(!/lnsr-chk|dep-1|ci-verify|onedev-ci|deploy-block/.test(appSrc), '零 mock 标识符（dep-1/ci-verify 等 mock 行名归零）')
})

test('E7 静态面：合成压测窗 UI 通道（toggle 人点为准 + 不入归档标注）+ until 游标加载', () => {
  assert.ok(appSrc.includes("ACTIONS['ev-syn']"), '压测窗 toggle 在册（人点为准）')
  assert.ok(appSrc.includes('客户端合成展示层'), '不入归档标注在册')
  assert.ok(appSrc.includes("ACTIONS['ev-older']"), '加载更早按钮在册（短列表兜底入口）')
  assert.ok(appSrc.includes('onLoadMore'), 'vlist 滚动加载钩子在册')
  assert.ok(appSrc.includes('游标到底'), 'exhausted 如实标注在册')
  assert.ok(appSrc.includes('it.synthetic'), '合成行不可点（事件详情深链只达真实归档行）')
})

test('E7 收口清扫：mock 渲染面归零（总览/palette/文档行/假动作）', () => {
  assert.ok(!appSrc.includes('全部本地 mock'), 'settings「全部本地 mock」声明摘除')
  assert.ok(!appSrc.includes('ensureWorkflowDocs'), 'boot mock 播种摘除')
  assert.ok(!/M\.events\.|M\.docs\.push|M\.systems\.|M\.workflows\.forEach/.test(appSrc), 'M 渲染引用归零（数据文件保留=proto 起点代码）')
  assert.ok(appSrc.includes('手动触发暂未接线'), 'manual tick 诚实提示在册（不画假回执；R-UX-3：触发面余量→暂未接线）')
  assert.ok(appSrc.includes('新建文档=declared 余量'), 'newGoal 诚实提示在册（不推 mock 库）')
})

test('R-6 静态面：授权面 Role/Group 现读 + Role 授权矩阵（console-adoption.md §1.20 L49-04 测试核）', () => {
  const liveSrc = readFileSync(join(PLUGIN, 'client/console-live.js'), 'utf8')
  assert.ok(/smallKinds = \['Agent', 'ServiceDesc', 'ConnectorOps', 'Role', 'Group'\]/.test(liveSrc), 'live 小对象现读清单扩 Role/Group（授权矩阵 spec 现读数据源）')
  assert.ok(appSrc.includes('Role 授权矩阵'), 'Role 授权矩阵区块在册（非空态激活面）')
  assert.ok(appSrc.includes('spec 零授权条目'), '零授权条目诚实标注在册（声明在册零条目=不产生授权，授权面同判）')
  assert.ok(appSrc.includes('绑定 role（user→group→role'), 'group→role 绑定反查在册（permission.md 骨架 3）')
  assert.ok(appSrc.includes('Role / Group 对象零在册'), '零对象诚实空态保留（零在册分支不删——docsRoot 零对象时不冒充）')
})

test('R-7 静态面：执行绑定 chip（决策面 execution 投影——console-adoption.md §1.21 L50-07 测试核）', () => {
  assert.ok(appSrc.includes('function wfExecChip'), 'wfExecChip 在册（bound 骨架/unbound 三态渲染核）')
  assert.ok(appSrc.includes("ex.state === 'bound'"), 'bound 判定在册（可点落 ConnectorOps 编辑器）')
  assert.ok(appSrc.includes('>unbound</span>'), 'unbound warn chip 在册（connector.md 规则 6 缺口可见不静默）')
  assert.ok(appSrc.includes('apply 即实现骨架物化'), '骨架=物化面注记在册（实现代码=apply-workflow agent 余量口径）')
  assert.ok(appSrc.includes('<th>执行绑定</th>'), 'workflows 列表「执行绑定」列在册')
  assert.ok(appSrc.includes("wfExecChip(row.execution)"), '详情头/配置 tab 执行绑定 chip 复用在册')
})

test('R-8 静态面：派单行（apply-workflow 派单受理投影——console-adoption.md §1.22 L51-07 测试核）', () => {
  assert.ok(appSrc.includes('wf-dispatch-state'), '派单行注水锚在册（骨架=实现未落时现读受理投影）')
  assert.ok(appSrc.includes("v1/agents/dispatches"), '派单面读面路径在册（GET /v1/agents/dispatches）')
  assert.ok(appSrc.includes('apply-workflow ×'), '派单锚 chip 在册（apply-workflow ×n——受理计数）')
  assert.ok(appSrc.includes('autoLevel='), 'autoLevel 数据面在册（ask 默认——agent-session.md §2）')
  assert.ok(appSrc.includes('受理投影≠会话已拉起'), '诚实投影注记在册（受理≠拉起——真实拉起 deferred）')
  assert.ok(appSrc.includes('受理投影缺席'), '环归零缺席态如实标注（进程内环重启归零——skeleton 持久态兜底）')
})

test('能力 B 静态面：需求提案屏（console-adoption.md §1.24 L52-06 测试核——concepts/proposal.md）', () => {
  assert.ok(appSrc.includes("route('proposals', screenProposals)"), '提案屏路由在册（#/proposals）')
  assert.ok(appSrc.includes("route('proposal/:scope/:name', screenProposalDetail)"), '详情路由在册（#/proposal/:scope/:name）')
  assert.ok(appSrc.includes("v1/proposals"), '提案读面路径在册（GET /v1/proposals——列表/详情）')
  assert.ok(appSrc.includes('prop-submit'), '提交表单动作在册（提交=草稿→Apply 全流程）')
  assert.ok(appSrc.includes('fromDraft: true'), 'fromDraft 通路在册（稿→面落库唯一写入口）')
  assert.ok(appSrc.includes("'console:propose'"), '提交溯源串在册（fieldManager=console:propose）')
  assert.ok(appSrc.includes("'console:approve'") && appSrc.includes("'console:reject'"), '批准/驳回判定约定串在册（approval_log 判定行+审批信号族事件随行——cored 侧）')
  assert.ok(appSrc.includes('console:propose'), '提交溯源串形态正确')
  assert.ok(appSrc.includes('prop-approve') && appSrc.includes('prop-reject'), '批准/驳回动作锚在册（submitted 态专用）')
  assert.ok(appSrc.includes('status=submitted'), '提交落库状态词在册（rv=1 status=submitted——L52-01）')
  assert.ok(appSrc.includes('无派单'), '驳回无派单注记在册（L52-03——rejected 不派单）')
  assert.ok(appSrc.includes('产物真实落盘=apply-workflow agent 真实拉起段（余量）'), '产物指针缺席态如实标注（本轮打通到派单受理+产物指针，不冒充产物已在；R-UX-3：declared-deferred 词形出界面）')
  assert.ok(appSrc.includes('R-PUB'), '提案表单 R-PUB 纪律注记在册（禁真实 IP/凭据）')
})

test('能力 A 静态面：设计文档工作台（console-adoption.md §1.26 L53 判据的测试核——cored-bridge.md §2.4）', () => {
  assert.ok(appSrc.includes("route('designdoc/:repo/:path', screenDesignDoc)"), '工作台深链路由在册（#/designdoc/:repo/:path——path 段整体 URL 编码）')
  assert.ok(appSrc.includes("['design', '设计文档']"), '屏 6「设计文档」页签在册（整屏换工作台——任务书页签判据）')
  assert.ok(appSrc.includes('screenDesignWorkspace'), '工作台渲染核在册（文件树+编辑器+diff+Apply 三栏）')
  assert.ok(appSrc.includes('v1/design-docs'), '读面路径在册（GET /v1/design-docs——清单/单文档/史）')
  assert.ok(appSrc.includes('/core-console/design-docs'), '写面宿主路由在册（apply 主体宿主注入+draft 落稿/弃稿）')
  assert.ok(appSrc.includes('baseSha'), '乐观锁基准 baseSha 随行（HEAD blob sha——409 判据面）')
  assert.ok(appSrc.includes('R-PUB-1 lint'), 'lint 检查项在册（400 携违规——判据面）')
  assert.ok(appSrc.includes('白名单'), '白名单检查项在册（403——判据面）')
  assert.ok(appSrc.includes('DesignDoc/'), 'involved 三段同构投影在册（DesignDoc/<repo>/<path>——事件/史面 obj 键）')
  assert.ok(appSrc.includes('kind=DesignDoc'), '草稿键注记在册（与对象草稿同一缓存同一持久化面）')
  assert.ok(appSrc.includes('权威=git 仓'), '权威唯一红线注记在册（读面=HEAD——路线②受限文件面取舍）')
  assert.ok(appSrc.includes("designDocApprovalApply"), '审批屏设计文档稿批准通路在册（dry-run 三检查→git commit）')
  assert.ok(appSrc.includes('designdoc/'), 'DesignDoc involved 深链在册（involvedRoute 分支——事件链可导航）')
})
