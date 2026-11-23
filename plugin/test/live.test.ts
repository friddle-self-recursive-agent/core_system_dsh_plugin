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
  assert.ok(SRC.includes("jget('v1/events?limit=100')"), '事件归档读面在册（Welcome 最近重要事件持久源）')
})

test('live 层写纪律（E3 起）：唯一写方法=apply() → POST /core-console/apply（宿主转发 cored 唯一写入口，主体宿主注入）；零其他写方法', () => {
  assert.ok(liveSrc.includes("'/core-console/apply'"), 'apply 通路在册（写路径唯一浏览器入口）')
  assert.ok(/method:\s*'POST'/.test(liveSrc), 'apply 使用 POST（主体由宿主注入，浏览器不携带）')
  for (const m of ['DELETE', 'PUT', 'PATCH']) {
    assert.ok(!new RegExp('\\bmethod\\s*[:=]\\s*[\"\']' + m).test(liveSrc), `live 层不得出现 ${m} 写方法`)
  }
})

test('Welcome 屏真数据换装：数据源标注 + event_log 归档 + run 投影阶段条（不再全 mock）', () => {
  assert.ok(SRC.includes('数据源=cored 读面'), 'Welcome 数据源标注在册')
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
  assert.ok(SRC.includes('data-c="lock"') && SRC.includes('面上已 r'), '乐观锁检查=回执 rv 与稿 baseRV 比对在册')
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
