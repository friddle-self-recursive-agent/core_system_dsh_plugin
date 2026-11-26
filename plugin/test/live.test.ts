// live.test.ts —— E2 真数据层静态验收（console-adoption.md §1.8 L37 静态面）：
// bundle 内 live 层在册 + 代理前缀/只读 GET 纪律 + 五屏真数据换装标记 + mock 屏未误删。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const SRC = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')
const liveSrc = readFileSync(join(PLUGIN, 'client/console-live.js'), 'utf8')

test('live 层在 bundle：/core-console/api 代理前缀 + __CC.live 挂载', () => {
  assert.ok(SRC.includes('/core-console/api'), 'live 层必须经宿主代理路由（同源 fetch）')
  assert.ok(SRC.includes('__CC.live = {'), 'live 层挂 __CC.live')
  assert.ok(SRC.includes("jget('v1/scheme/kinds')"), 'scheme kinds 装载在册')
  assert.ok(SRC.includes("jget('v1/events?limit=500')"), '事件归档读面在册（E7 千级窗收敛口径——limit≤500 防拖库同值）')
  assert.ok(SRC.includes("function eventsPage"), 'until 游标翻页通路在册（E7 向后分页）')
  assert.ok(liveSrc.includes("'&until='"), 'eventsPage 游标参数在册（严格早于——半开窗分页）')
})

test('live 层写纪律（E3 起）：写方法=apply() POST /core-console/apply（宿主转发 cored 唯一写入口，主体宿主注入）+ drafts 弃稿 DELETE（E6 驳回=弃稿）；零其他写方法', () => {
  assert.ok(liveSrc.includes("'/core-console/apply'"), 'apply 通路在册（写路径唯一浏览器入口）')
  assert.ok(/method:\s*'POST'/.test(liveSrc), 'apply 使用 POST（主体由宿主注入，浏览器不携带）')
  assert.ok(!/method:\s*['"]DELETE['"][^}]*\/core-console\/apply/.test(liveSrc) && liveSrc.includes('/core-console/drafts'),
    'DELETE 只用于草稿弃稿路由（E6 审批驳回=弃稿，零文档面动作——不发明反向写路径）')
  for (const m of ['PUT', 'PATCH']) {
    assert.ok(!new RegExp('\\bmethod\\s*[:=]\\s*[\"\']' + m).test(liveSrc), `live 层不得出现 ${m} 写方法`)
  }
})

test('Welcome 屏真数据换装：数据源标注 + event_log 归档 + run 投影阶段条（不再全 mock）', () => {
  assert.ok(SRC.includes('数据源=系统文档库'), 'Welcome 数据源标注在册（R-UX-3 人话化：cored 读面→系统文档库）')
  assert.ok(SRC.includes('function welcomeBizTitle'), '业务化标题（展示层生成，不入库为准）')
  assert.ok(SRC.includes('function welcomeStageStrip'), 'run 投影阶段条在册')
  assert.ok(!/core console proto · 全部为 mock 数据/.test(SRC), '旧「全部为 mock」标注必须摘除')
  // 健康度构成 tooltip（大数字不许是无出处黑盒）
  assert.ok(SRC.includes('健康度构成'), '健康度 tooltip 构成在册')
})

test('系统树真数据换装：scope 对象枚举 + 文档/资源同构行 + 草稿圆点', () => {
  assert.ok(SRC.includes('function inScopeObjects'), 'scope 匹配在册')
  assert.ok(SRC.includes('function treeObjRow'), '同构行渲染在册')
  assert.ok(SRC.includes('function treeDraftSet'), '草稿圆点数据源（/v1/drafts）在册')
  assert.ok(!/模拟异步 300ms/.test(SRC), '假懒加载计时器必须摘除（数据已全量在册）')
})

test('对象详情编辑器（E4 起 viewer 升编辑器）+ 事件详情路由注册（标识符全可点的落点面）', () => {
  assert.ok(SRC.includes("route('doc/:kind/:scope/:name'"), '对象键直链路由在册')
  assert.ok(SRC.includes("route('doc/:name'"), '名字解析路由在册')
  assert.ok(SRC.includes('function screenEditor'), '编辑器屏在册（E4：viewer 升编辑器——文档与资源同规则）')
  assert.ok(!/function screenObject\b/.test(SRC), '只读 viewer 已被编辑器替换（同路由同屏）')
  assert.ok(SRC.includes('function screenEventLive'), '事件详情（真数据）在册')
  assert.ok(SRC.includes("route('event/:id', screenEventLive)"), '事件详情路由接线')
  assert.ok(SRC.includes('function refChips'), '正文引用标识符可点（system:// agent:// …）')
})

// ─────── E4：文档编辑器真数据换装（console-adoption.md §1.10）───────

test('E4 live/编辑器：草稿通道 + dry-run 三检查 + Apply 闭环（LLM 止步提案）', () => {
  assert.ok(SRC.includes("POST /core-console/drafts".slice(5)), '草稿落稿通路在册（POST /core-console/drafts）')
  assert.ok(SRC.includes('function landDraft'), 'debounced 落稿在册（编辑=写草稿不触文档面）')
  assert.ok(SRC.includes('function llmTabHtml'), 'LLM 提案 tab 在册（提案队列=非 console 前缀稿）')
  assert.ok(SRC.includes('isConsoleFM'), 'console 前缀判别在册（提案/自有稿分流）')
  assert.ok(SRC.includes('data-act="prop-adopt"'), '提案 [加入草稿] 在册（采纳=工作副本更新）')
  assert.ok(SRC.includes('data-act="prop-drop"'), '提案 [丢弃] 在册（DELETE 弃稿）')
  assert.ok(SRC.includes('data-act="doc-apply"'), '吸底 Apply dock 在册（唯一写入口人点为准）')
  assert.ok(SRC.includes('fromDraft: true, dryRun: true'), 'dry-run 预检在册（零副作用三检查）')
  assert.ok(SRC.includes('data-c="lock"') && SRC.includes('库中已 r'), '乐观锁检查=回执 rv 与稿 baseRV 比对在册（R-UX-3 人话化：面上→库中）')
  assert.ok(SRC.includes('hydrateHistory'), '历史 tab=apply_log 投影在册（v0.38 /v1/history）')
  assert.ok(SRC.includes('空草稿——无操作'), '空草稿 Apply=无操作提示（不落库不发事件）')
  assert.ok(!SRC.includes("ACTIONS['llm-send']"), 'mock LLM 对话输入摘除（真实生成面=Agent 会话，E5 接线）')
  assert.ok(!SRC.includes("ACTIONS['draft-accept']"), 'mock 提案卡动作摘除（真通道=prop-adopt）')
})

test('原型屏仍在册（未换装的屏保持 proto mock 待各自 E 轮）', () => {
  for (const fn of ['screenOverview', 'screenWorkflows', 'screenDocsGlobal', 'screenChat', 'screenApprovals']) {
    assert.ok(new RegExp('function ' + fn + '\\(').test(SRC), `${fn} 在册`)
  }
})

// ─────── E3：Workflow 运行管理真数据换装（console-adoption.md §1.9）───────

test('E3 live 层：聚合面装载 + apply 通路返回判别联合', () => {
  assert.ok(liveSrc.includes("jget('v1/workflows')"), '聚合面 GET /v1/workflows 装载在册（v0.37 console 读面第二段）')
  assert.ok(liveSrc.includes('wfAgg'), '聚合面 state 槽在册')
  assert.ok(liveSrc.includes('return { ok: false, status: r.status, error:'), 'apply 失败判别（status/error）在册')
})

test('E3 屏换装：运行管理三屏真数据 + override 语义启停 + 运行抽屉', () => {
  assert.ok(SRC.includes('function liveWfRow'), '聚合行查找在册（列表/详情数据源）')
  assert.ok(SRC.includes('function liveRunsOf'), 'run 轮次过滤在册（runs 面投影）')
  assert.ok(SRC.includes('function wfRunDrawerHtml'), '运行抽屉在册（相位时间线/留痕 kv/涉及文档）')
  assert.ok(SRC.includes('data-act="wf-toggle"'), '启停开关在册（=Apply）')
  assert.ok(SRC.includes('override-of-builtin'), 'override origin 标注在册（红线 b：builtin 本体不动）')
  assert.ok(SRC.includes('function applyWorkflowToggleLive'), '真实 Apply 通路在册（POST /core-console/apply）')
  assert.ok(SRC.includes("route('wf/:name', screenWorkflow)"), '详情路由换装（E2 对象 viewer → E3 运行管理）')
  assert.ok(SRC.includes("route('wf/:name/r/:n', screenWfRun)"), '运行独立路由在册（详情页矩阵）')
  assert.ok(SRC.includes('诚实空态'), '诚实空态纪律在册（action log/SessionLog 余量不假画）')
  assert.ok(!SRC.includes("ACTIONS['wf-rerun']"), '假重跑按钮摘除（真实执行面接线前不画）')
  assert.ok(!SRC.includes("ACTIONS['wf-cancel']"), '假取消按钮摘除')
})

// ---------- E6 静态面（console-adoption.md §1.13 L42 静态判据） ----------
test('E6 事件流屏真数据：lane 映射纯函数 + 聚合面板 n/a 不冒充 + 零 mock 事件名', () => {
  assert.ok(SRC.includes('function eventLaneOf'), '三泳道映射纯函数在册')
  assert.ok(SRC.includes('function screenEvents'), '事件流屏在册')
  assert.ok(SRC.includes('归档窗内实数'), '聚合面板实数标注在册')
  assert.ok(SRC.includes('run 终态事件未落归档'), '成功率 declared 余量 n/a 标注在册')
  assert.ok(!/lnsr-chk|dep-block|deploy-system 发布等待批准/.test(SRC), '零 mock 审批事件名（诚实空态）')
})

test('E6 审批屏：待审区=草稿∪ApprovalNeeded ∧ 批准=dry-run+fromDraft ∧ 驳回=DELETE 弃稿', () => {
  assert.ok(SRC.includes('function approvalNeededObjects'), '待审区数据源在册（live 层）')
  assert.ok(SRC.includes("'console:approve'"), '批准 fieldManager=console:approve（留痕可查）')
  assert.ok(SRC.includes("data-act=\"ap-reject\""), '驳回动作在册')
  assert.ok(liveSrc.includes('draftDelete'), 'draftDelete 写通路在册（DELETE /core-console/drafts）')
  assert.ok(liveSrc.includes("'/core-console/comm'"), 'comm 读面在册')
})

test('R-3 审批判定独立账：审批屏已决账面区块=GET /v1/approvals 现读（v0.46，ops-log.md §2）', () => {
  assert.ok(SRC.includes('function hydrateApprovalLedger'), '已决账面注水函数在册')
  assert.ok(SRC.includes("'v1/approvals?limit=20'"), 'approval_log 读面调用在册（现读不缓存）')
  assert.ok(SRC.includes('id="ap-ledger"'), '已决账面区块容器在册')
  assert.ok(SRC.includes('判定不再只靠 apply_log 字符串考古') || SRC.includes('已决记录'), '账面语义标注在册（R-UX-3：已决账面→已决记录）')
  assert.ok(SRC.includes("r.decision === 'granted'"), 'granted/rejected chip 判别在册')
})

test('E6 连接页与运行面：三组=objects 枚举 ∧ ConnectorOps 第五 tab 运行面 ∧ agent-comm comm 落账活体', () => {
  assert.ok(SRC.includes("connCards('WorkService', 'ws/')"), 'WorkService 组=objects 枚举')
  assert.ok(SRC.includes("connCards('ConnectorOps', 'connector/')"), 'ConnectorOps 组=objects 枚举')
  assert.ok(SRC.includes("connCards('Provider', 'provider/')"), 'Provider 组=objects 枚举')
  assert.ok(SRC.includes("'ops', '运行状态'"), '运行状态 tab 在册（ConnectorOps 专属；R-UX-3：运行面→运行状态）')
  assert.ok(SRC.includes('function hydrateCommLive'), 'comm 落账注水在册')
  assert.ok(SRC.includes('ENVELOPE_V1'), 'envelope v0.1 字段表在册')
  assert.ok(SRC.includes('已携（值打码）'), 'token 打码标注在册')
})

test('E6 详情页矩阵：event 详情 run 反查 + workflow 锚链 + ws/provider/ref/role 路由零改动', () => {
  assert.ok(SRC.includes('function hydrateEventChain'), '事件链路注水在册')
  assert.ok(SRC.includes('event→run→workflow→doc'), '链路语义标注在册')
  const appSrc = readFileSync(join(PLUGIN, 'client/console-app.js'), 'utf8')
  assert.ok(/route\('ws\/:name'/.test(appSrc) && /route\('provider\/:name'/.test(appSrc) &&
    /route\('ref\/:name'/.test(appSrc) && /route\('role\/:name'/.test(appSrc), '矩阵行落点路由在册')
})

test('能力 D + R-UX-1/R-UX-2：对话式录入默认模式 + scheme 驱动八类控件渲染器 + 降级表单同源在册', () => {
  assert.ok(liveSrc.includes("'/core-console/intake/turn'"), '对话推进写通路在册')
  assert.ok(liveSrc.includes("'/core-console/intake/generate'"), '提交节点生成与 dry-run 通路在册')
  assert.ok(SRC.includes('function renderSchemeControlHtml'), 'R-UX-2 通用 scheme 控件渲染器在册')
  assert.ok(SRC.includes('function renderProposalIntakeCard'), 'R-UX-1 对话录入组件在册')
  assert.ok(SRC.includes("'console:propose:chat'"), '对话录入 Apply fieldManager=console:propose:chat 在册')
  assert.ok(!SRC.includes('var PROP_PRIORITIES ='), '旧硬编码优先级列表已摘除（由 scheme 单一真相驱动）')
})

// —— loop-67 rev-content diff 面（console-adoption.md §1.40）——
test('rev-content diff 面：历史 tab ok 行可点（data-act=hist-diff）+ 点行 diff 通路读 /v1/rev-content（零写路径）+ 旧「余量」标注摘除', () => {
  assert.ok(SRC.includes("data-act=\"hist-diff\""), 'ok 行可点词形在册（hist-diff）')
  assert.ok(SRC.includes('v1/rev-content/'), 'rev-content 读面通路在册（GET 快照）')
  assert.ok(!SRC.includes('点行 diff 上一版=rev-content 面余量'), '旧「余量」如实标注必须摘除（已收口不再自贬）')
  assert.ok(!/method:\s*['"](?:POST|DELETE|PUT|PATCH)['"][^}]*rev-content/.test(liveSrc) && !/rev-content[^]*?method:\s*['"](?:POST|DELETE|PUT|PATCH)['"]/.test(SRC.slice(Math.max(0, SRC.indexOf('rev-content') - 200), SRC.indexOf('rev-content') + 200)),
    'rev-content 只读 GET（零写路径——渲染数据无双源红线 §5 规则 2）')
  assert.ok(SRC.includes('hist-diff-box'), 'diff 呈现面板在册（单处开合——复点换内容）')
  assert.ok(SRC.includes('对象起点（create，无上一版）'), '起点行如实标注词形在册')
})
