// inbox.test.ts —— v0.56 R-10 console 通知中心收件箱静态验收（console-adoption.md §1.31：
// 四类待办计数可查∧条目可点达操作面∧无通道=页面兜底可见∧空态显式——§1.25 判据的静态面）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const SRC = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')
const liveSrc = readFileSync(join(PLUGIN, 'client/console-live.js'), 'utf8')

test('inbox 读面在册：/v1/inbox 装载 + /v1/sessions watchdog 投影 + 读面缺席诚实降级（零自建状态）', () => {
  assert.ok(liveSrc.includes("jget('v1/inbox')"), '/v1/inbox 读面装载在册（v0.56 四类判定分类投影）')
  assert.ok(liveSrc.includes("jget('v1/sessions')"), '/v1/sessions watchdog 投影装载在册（v0.54 KI-003 查询面）')
  assert.ok(/\.catch\(function \(\) \{ state\.inbox = null; \}\)/.test(liveSrc), '读面缺席=null（旧代/超时诚实降级，不冒充）')
})

test('inbox 屏在册：四类 chips（需人接管/待批准/提案待批/文档待审）+条目深链 data-act=go+空态显式+watchdog 观测面', () => {
  assert.ok(SRC.includes('function screenInbox'), '收件箱屏在册')
  assert.ok(SRC.includes("route('inbox', screenInbox)"), 'inbox 路由接线')
  assert.ok(SRC.includes('INBOX_CLASS_META'), '四类判定分类元数据在册（机械分类=读面自分类单一真相）')
  for (const cls of ['NeedsHuman', 'ApprovalNeeded', 'Proposal', 'DocReview']) {
    assert.ok(SRC.includes(`'${cls}'`), `四类词形 ${cls} 在册`)
  }
  assert.ok(SRC.includes("data-cc-inbox-list=\"true\""), '收件箱条目列表容器在册（headless 判据锚）')
  assert.ok(SRC.includes("data-cc-empty=\"inbox\""), '空态显式在册（§1.25 判据：无待办时显式空态）')
  assert.ok(SRC.includes('data-cc-watchdog="true"'), 'watchdog 观测面区块在册（批准投影挂起/会话活性真实词形）')
  assert.ok(SRC.includes('approveIdle'), '批准投影空闲词形消费（零挂起≠停摆不冒充）')
  assert.ok(SRC.includes('notification.md 规则 6') || SRC.includes('规则 6'), '页面兜底口径标注在册（未配置通知通道=仅页面展示）')
  assert.ok(SRC.includes("'ib-class'"), '类过滤交互在册')
})

test('inbox 入口三件：总览待你处理 metric 卡 + palette 动作 + inboxCount 回落口径（读面缺席=草稿∪归档现读）', () => {
  assert.ok(SRC.includes("metric('inbox', '待你处理'"), '总览 metric 卡在册（点击落 #/inbox）')
  assert.ok(SRC.includes("'待你处理收件箱'"), 'palette 动作在册')
  assert.ok(SRC.includes('function inboxCount'), '计数函数在册')
  assert.ok(SRC.includes('return approvalNeededObjects().length'), '读面缺席回落=草稿∪ApprovalNeeded 归档现读（不冒充零）')
  assert.ok(SRC.includes("'inbox'"), 'inbox 深链段在册（entry CONSOLE_SEGS/路由）')
})

// ── v0.57 R-10 续段（console-adoption.md §1.32——深链操作面活体+事件回链+spawn 声明词形消费） ──
const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')

test('类内 op 深链落点升格：四类各自兜底落点函数在册（link 键原值优先=cored 深链单一真相）', () => {
  assert.ok(appSrc.includes('function inboxOpOf'), '类内 op 落点派生函数在册（§1.32 收口——L58-UI-10 类级跳过词形废除）')
  assert.ok(appSrc.includes("it.link || ''"), 'link 键原值优先（cored 深链不改写——红线 2 无双源）')
  for (const w of ["'NeedsHuman'", "'Proposal'", "'DocReview'", "it.kind === 'dispatch' || it.kind === 'dispatch-legacy'"]) {
    assert.ok(appSrc.includes(`if (it.class === ${w})`) || appSrc.includes(`it.class === 'ApprovalNeeded' && (${w})`), `族内落点词形在册：${w}`)
  }
  assert.ok(appSrc.includes('data-cc-inbox-event'), '条目行 eventId 判据锚在册（NeedsHuman→事件详情回链活体判定）')
  assert.ok(appSrc.includes('data-cc-inbox-kind'), '条目行 kind 判据锚在册（挂起行 kind=dispatch 词形）')
})

test('挂起行幽灵计数缺口收口：ApprovalNeeded 派单待批行进行集词形+旧代诚实降级标注（不翻倍）', () => {
  assert.ok(appSrc.includes("it.class === 'ApprovalNeeded' && it.kind === 'dispatch'"), '派单待批行进行集消费在册（cored v0.57 行集同源）')
  assert.ok(appSrc.includes('dispatch-legacy'), '旧代幽灵计数诚实降级词形在册（计数挂起而行集缺席=旧代 cored 词形照实）')
  assert.ok(appSrc.includes('data-cc-inbox-count'), 'inbox 计数判据锚在册（回链判据=操作完成下次装载降位）')
})

test('spawn 接线声明词形消费：wf 详情派单行+提案详情派单卡 approval/spawn chips（wired 恒 false 词形诚实）', () => {
  assert.ok(appSrc.includes('last.approval && last.approval.state'), 'wf 派单行 approval 键消费在册（§11.5 批准投影随行）')
  assert.ok(appSrc.includes('last.spawn || null'), 'wf 派单行 spawn 键消费在册（§11.7 接线声明随行）')
  assert.ok(appSrc.includes('spawn·声明'), 'spawn 声明词形 chip 在册（declared=true 词形）')
  assert.ok(appSrc.includes('spawn·未声明'), 'spawn 缺席词形 chip 在册（零值键=诚实缺席）')
  assert.ok(appSrc.includes('wired 恒 false=零拉起执行器'), 'wired 恒 false 红线 a 机械锚标注在册（声明≠拉起）')
  assert.ok(appSrc.includes('r0.approval && r0.approval.state'), '提案详情派单卡 approval 键消费在册')
})

// ───────────────── v0.58 派单批准动作面 console 动作化（console-adoption.md §1.33——L60-UI-01 静态面） ─────────────────

test('派单批准动作面：wf 配置 tab 派单行 approval=pending → 批准/驳回动作在册（动作=Apply 判定通路——红线 1 非旁路）', () => {
  assert.ok(SRC.includes("data-act=\"disp-approve\""), 'wf 派单行批准动作锚在册（approval=pending 词形）')
  assert.ok(SRC.includes("data-act=\"disp-reject\""), 'wf 派单行驳回动作锚在册')
  assert.ok(SRC.includes("ACTIONS['disp-approve']") && SRC.includes("ACTIONS['disp-reject']"), '动作 handler 接线在册（全局 data-act 委托）')
  assert.ok(SRC.includes("fieldManager: fm"), '动作本体=既有 Apply 通路（workflow:approve|workflow:reject 判定串——零新写路径）')
  assert.ok(SRC.includes("dryRun: true"), 'dry-run 预检在册（E4 通路同款三检查——零副作用先于判定）')
  assert.ok(SRC.includes('confirmModal('), '确认弹窗在册（人点为准——挂起行审批动作面）')
  assert.ok(SRC.includes("rec.approval.state !== 'pending'"), '判定终态守卫在册（终态后无批准/驳回动作——状态机词汇闭合）')
  assert.ok(SRC.includes("resourceVersion: rec.rv"), '乐观锁基线=批准投影行 rv 在册（DecisionAction 同源）')
})

test('派单批准动作红线词形：批准≠拉起（wired 恒 false 机械锚标注）+ 判定权威=apply_log 判定行（toast 词形）+ 回链闭环语义', () => {
  assert.ok(SRC.includes('批准→spawn 接线声明（wired 恒 false=真实拉起 deferred——红线 a，批准≠拉起零执行）'), '批准动作红线 a 标注在册（确认弹窗词形）')
  assert.ok(SRC.includes('apply_log 判定行=批准投影翻转权威'), '判定权威=apply_log 判定行词形在册（§11.5 动作面口径）')
  assert.ok(SRC.includes('inbox 下一次装载反映（挂起行消失=回链闭环）'), '回链闭环 toast 词形在册（挂起行投影已判过滤——v0.58 拍即生效）')
  assert.ok(SRC.includes('无挂起批准投影'), '终态守卫 toast 词形在册（零发明动作）')
})

// ───────────────── v0.58a 活体补口（loop-60 UI 探针实证缺陷收口——content 原文随行） ─────────────────

test('动作判定 Apply 原文随行：content=骨架对象现读原文（repository 面 content 须为可解析文档根——v0.58 首版空串活体 400 收口）', () => {
  assert.ok(SRC.includes("LIVE.get('v1/objects/'"), '动作前骨架对象现读在册（原文零变更=判定行照落照判定）')
  assert.ok(!SRC.includes("resourceVersion: rec.rv, content: ''"), '空串 content 词形废除（400「文档根须为映射」活体实证——不再回潮）')
  assert.ok(SRC.includes("var kind = (rec.kind === 'proposal' || rec.proposal) ? 'Proposal' : 'ConnectorOps'"), 'kind 判别在册（workflow 派单=骨架对象/proposal 派单=Proposal 对象——DecisionAction matchingKeyOf 同键）')
  assert.ok(SRC.includes("fieldManager: fm, reasonRef: 'workflow:' + decision + ':' + key, dryRun: true"), 'dry-run 预检同载荷同原文（预检≠判定）')
})

test('动作面 dry-run 零副作用词形守卫：预检/真实动作两拍同判据（弹窗词形不发明终态——投影词形只由真实判定翻转）', () => {
  assert.ok(SRC.includes("dry.data.rv === rec.rv"), '乐观锁预检判据在册（投影 rv ↔ 面上现值漂移即示）')
  assert.ok(SRC.includes("rec.approval.state !== 'pending'"), '真实动作拍终态守卫在册（pending→动作，终态=零动作）')
  assert.ok(SRC.includes("409"), '乐观锁冲突路径在册（rv 前移=重进现读——零旁路）')
})

// ── E6 积压族扩 + 收件箱类内落点分化（console-adoption.md §1.13 余量收口——loop-62） ──
// 判据：积压族=ApprovalNeeded 归档∪submitted 提案∪派单 pending 三源同窗单一真相函数；
// 聚合面板与「待审批」metric 卡同一函数消费（无双源）；族内落点=dispatch 行→wf 配置 tab
// （批准动作面在册屏）、归档行→审批屏；零 Go 改动零新写路径（既有读面族语义扩展）。

test('E6 积压族扩：approvalBacklog 三源单一真相函数在册+聚合面板/metric 卡同源消费+族构成词形标注', () => {
  assert.ok(appSrc.includes('function approvalBacklog'), '积压族单一真相函数在册（§1.13 余量收口）')
  assert.ok(appSrc.includes("d.approval && d.approval.state === 'pending'"), '派单批准投影 pending 源消费（v0.56/0.57 dispatches 读面——approval 键所在面）')
  assert.ok(appSrc.includes("st.dispatches || []"), '派单受理投影行集消费在册（live 层 dispatches 快照）')
  assert.ok(appSrc.includes("p.status === 'submitted'"), '提案 submitted 源消费（v0.51 读面）')
  assert.ok(/total: drafts \+ archive \+ submitted \+ dispatchPending/.test(appSrc), '族=源和（草稿∪归档∪提案∪派单——loop-63 分化为四源）单一真相')
  assert.ok(appSrc.includes('back.total'), '事件流聚合面板积压行消费族总数')
  assert.ok(appSrc.includes('族=草稿待审（DocReview）'), '族构成词形标注在册（四源分解可见——loop-63 分化）')
  assert.ok(appSrc.includes('操作面落点：审批屏∪编辑器/提案详情/wf 配置'), '操作面落点词形在册（草稿双落点——loop-63）')
})

test('E6 链点顺延：收件箱 ApprovalNeeded 族内落点分化（dispatch 行→wf 配置 tab 批准动作面；归档行→审批屏/editor 深链）', () => {
  assert.ok(appSrc.includes("'wf 配置'"), 'wf 配置落点 tag 词形在册（族内分化）')
  assert.ok(appSrc.includes("data-cc-inbox-tab"), 'tab 预置判据锚在册（落地即配置 tab=动作行可见）')
  assert.ok(appSrc.includes("S.wfTab[decodeURIComponent(segs[1])] = tab"), 'ACTIONS.go tab 预置消费在册（落地即配置 tab）')
  assert.ok(/it\.class === 'ApprovalNeeded' && \(it\.kind === 'dispatch' \|\| it\.kind === 'dispatch-legacy'\)/.test(appSrc), '族内分化逻辑在 inboxOpOf 单点（零散用）')
})

// ── E6 族源分化核验收口（console-adoption.md §1.35 余量注记顺延——loop-63 队列 1） ──
// 判据：积压族=四源单一真相（草稿待审∪ApprovalNeeded 归档∪submitted 提案∪派单 pending）
// 分解词形在册；聚合面板/backlogCount 顶部常驻入口（badge/updateCounters/palette/Welcome
// 卡）同一函数消费无双源；DocReview 收件箱行深链=编辑器屏（cored link 原值）∪审批屏 diff
// 双落点；审批屏 header 注记「已批 N 稿不出现」；四点族源守卫测试锚。

test('E6 族源分化核验：approvalBacklog 四源分解单一真相+族构成词形四源标注（回潮即红）', () => {
  const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')
  assert.ok(appSrc.includes('function approvalBacklog'), '积压族单一真相函数在册（loop-62 既有）')
  assert.ok(/total: drafts \+ archive \+ submitted \+ dispatchPending/.test(appSrc), '族=四源和单一真相（草稿∪归档∪提案∪派单——loop-63 分化）')
  assert.ok(appSrc.includes("p.status === 'submitted'"), '提案 submitted 源消费（v0.51 读面）')
  assert.ok(appSrc.includes("d.approval && d.approval.state === 'pending'"), '派单批准投影 pending 源消费（v0.56/0.57 dispatches 读面）')
  assert.ok(/x\.kind === 'event'/.test(appSrc), '归档子源分化消费在册（drafts∪归档两子源分解——pendingApprovals 不再整集入族）')
  assert.ok(appSrc.includes('族=草稿待审（DocReview）'), '聚合面板族构成词形=四源分解标注（回潮即红）')
  assert.ok(appSrc.includes('审批屏∪编辑器'), '族操作面落点词形（草稿双落点）在册')
})

test('E6 族源分化核验：backlogCount 单点——顶部常驻入口/聚合面板同一族总数（无双源漂移）', () => {
  const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')
  assert.ok(appSrc.includes('function backlogCount'), '族总数单点函数在册（loop-63）')
  assert.ok(appSrc.includes('function backlogCount() { return approvalBacklog().total; }'), '单点=approvalBacklog().total 直读（零重算）')
  assert.ok(appSrc.includes('var pend = backlogCount()'), 'updateCounters（badge 常驻入口）与 Welcome 卡同一单点消费')
  assert.ok(appSrc.includes("backlogCount() + ' 条积压待办"), 'palette 积压行同一单点消费')
  assert.ok(appSrc.includes('四源积压'), 'Welcome「待审批」卡 note 词形=四源（旧「需要你处理」词形摘除）')
})

test('E6 族源分化核验：DocReview 收件箱行深链=编辑器屏∪审批屏双落点+审批屏「已批 N 稿不出现」注记', () => {
  const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')
  assert.ok(appSrc.includes("审批屏（草稿行深链=编辑器屏双落点）"), 'DocReview 行 tag 词形=双落点（回潮即红）')
  assert.ok(!new RegExp('function inboxOpOf[\\s\\S]{0,1200}link\\.replace').test(appSrc), 'cored link 原值不改写（红线 2 无双源——inboxOpOf 内零 link 改写）')
  assert.ok(appSrc.includes('已批 N 稿不出现'), '审批屏 header「已批 N 稿不出现」注记在册')
  assert.ok(appSrc.includes('DocReview→编辑器屏（apply dock，cored link 原值）∪审批屏 diff'), '收件箱屏 dh-sub DocReview 落点词形在册')
})

test('E6 族源分化核验：四点族源守卫（drafts/proposals/dispatches/events——旧代读面缺席=该源归零诚实不冒充）', () => {
  const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')
  assert.ok(appSrc.includes('st.drafts || []'), '草稿子源缺席=零（旧代读面诚实词形）')
  assert.ok(appSrc.includes('st.proposals || []'), '提案子源缺席=零（v0.51 前旧代诚实词形）')
  assert.ok(appSrc.includes('st.dispatches || []'), '派单子源缺席=零（v0.56 前旧代诚实词形）')
  assert.ok(appSrc.includes('pendingApprovals()'), '归档子源=approvalNeededObjects 现读（读面缺席窗=空集不冒充）')
})

test('E6 四源积压词形单点复核（loop-65 队列 1）：族构成声明=单点函数——四消费点文字词形回潮双源漂移即红', () => {
  const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')
  assert.ok(appSrc.includes('function backlogFamilyNote'), '族构成词形声明单点函数在册（loop-65）')
  assert.ok(/backlogFamilyNote\(\)\.short/.test(appSrc), 'Welcome note 短词形=单点声明消费（不再字面量散用）')
  assert.ok(/积压待办（族总数' \+ backlogFamilyNote\(\)\.short/.test(appSrc), 'palette 积压行词形=单点声明消费（回潮即红）')
  assert.ok(/pal\.long \+ back\.drafts/.test(appSrc), '聚合面板族构成长词形=单点声明消费（回潮即红）')
  assert.ok(appSrc.split("short: '草稿/归档/提案/派单'").length - 1 === 1, '短词形=backlogFamilyNote 声明唯一（单一真相）')
  assert.ok(!/['"]四源积压（草稿/.test(appSrc), '渲染面零字面量散用（Welcome note 拼装词形——回潮即红）')
  assert.ok(appSrc.split('族=草稿待审（DocReview）').length - 1 === 1, '长词形字面量唯一（族构成声明单点——散用回潮即红）')
  assert.ok(/'四源积压（' \+ backlogFamilyNote\(\)\.short/.test(appSrc), 'Welcome「待审批」卡 note=四源积压+族构成单点拼装')
})
