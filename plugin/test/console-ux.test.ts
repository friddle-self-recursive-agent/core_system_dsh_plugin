// console-ux.test.ts —— R-UX-3/4/5 界面用户视角落地（core_design rule.md R-UX-3/4/5 +
// console-ui.md §13，2026-11-26 用户裁决；loop-75）。
// 判据对应 §13.4：界面文案字符串清单零「面」字工程用法、零内部里程碑词形（回潮即红）；
// markdown 渲染器在册且 XSS 转义红线在位；对象正文=字段卡默认态+「YAML」折叠次级；
// 系统 3 首屏=系统卡+人话入口卡（事件/指标/文档/权限）；视觉=dsh 原生 token（零自造体系）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const CLIENT = join(PLUGIN, 'client')
const SRC = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')

const FILES = ['console-md.js', 'console-shell.js', 'console-data.js', 'console-live.js', 'console-scenario.js',
  'console-ctx.js', 'console-obj.js', 'console-tasks.js', 'console-chat.js', 'console-projects.js', 'console-app.js', 'conn-monitor.js', 'entry.js']

/** 提取字符串字面量域（'…' 与 "…"，单行近似）——排除注释与代码标识符域（§13.4 判据词形）。 */
function stringLiterals(src) {
  const out = []
  for (const line of src.split('\n')) {
    const m = line.match(/'[^'\n]*'|"[^"\n]*"/g) || []
    for (const s of m) out.push(s)
  }
  return out
}

test('L75-01 §13.1 文案人话化：client/*.js 字符串域零「面」字工程词（回潮即红）', () => {
  const banned = /事件面|指标面|文档面|权限面|场景面|读面|写面|派单面|动作面|判定面|投影面|登录面|执行面|数据面|矩阵面|回写面|运行面|检测面|调用面|收口面|在册面|导航面|留痕面|决策面|链路面|准入面|面读/
  const benign = /面板|界面/
  const hits = []
  for (const f of FILES) {
    const src = readFileSync(join(CLIENT, f), 'utf8')
    for (const s of stringLiterals(src)) {
      if (banned.test(s) && !benign.test(s)) hits.push(f + ' :: ' + s.slice(0, 60))
    }
  }
  assert.equal(hits.length, 0, '「面」字工程词回潮：\n' + hits.join('\n'))
})

test('L75-02 §13.1 内部里程碑/判据词不上界面：零 E<n>/L<n>-/P-0x/「真数据」/declared-deferred 词形', () => {
  const banned = [
    [/\bE[0-9]\b/, 'E<n>'],
    [/L[0-9]+-/, 'L<n>-'],
    [/P-0[0-9]/, 'P-0x'],
    [/真数据/, '真数据'],
    [/declared-deferred/, 'declared-deferred'],
  ]
  const hits = []
  for (const f of FILES) {
    const src = readFileSync(join(CLIENT, f), 'utf8')
    for (const s of stringLiterals(src)) {
      for (const [re, tag] of banned) {
        if (re.test(s)) hits.push(f + ' [' + tag + '] :: ' + s.slice(0, 60))
      }
    }
  }
  assert.equal(hits.length, 0, '里程碑词形回潮：\n' + hits.join('\n'))
})

test('L75-03 §13.1 屏幕 3 现势整改点：旧实证词形零残留 ∧ kind 降次级徽章词形在册', () => {
  // 2026-11-26 线上实证整改点（§13.1 列举）——回潮即红
  for (const stale of ['声明/清单全部来自 cored 读面', '场景面（E7 真数据）', '事件面 →', '指标面 →', '文档面（tag 过滤）→', '权限面 →']) {
    assert.ok(!SRC.includes(stale), '屏幕 3 旧实证词形残留：' + stale)
  }
  // 系统卡=主标题用户词；kind 名降次级徽章（「系统声明」副注记+chip kind）
  assert.ok(SRC.includes('data-syscard="1"'), '系统卡在册（§13.3 首屏=系统卡）')
  assert.ok(SRC.includes('>系统声明</span>'), '系统声明副注记在册（kind 名降次级）')
  assert.ok(SRC.includes("'系统不在册'"), '空态人话（旧词形「系统不在册（cored 读面）」已人话化）')
})

test('L75-04 §13.3 系统视角：入口卡四张=事件/指标/文档/权限（人话标签+计数徽章）+文档退次级折叠', () => {
  assert.ok(SRC.includes('data-ent-cards="1"'), '入口卡容器在册')
  assert.ok(/entCard\('pulse', '事件'/.test(SRC), '事件入口卡（人话）')
  assert.ok(/entCard\('pulse', '指标'/.test(SRC), '指标入口卡（人话）')
  assert.ok(/entCard\('doc', '文档'/.test(SRC), '文档入口卡（人话）')
  assert.ok(/entCard\('check', '权限'/.test(SRC), '权限入口卡（人话）')
  assert.ok(SRC.includes('data-docs-fold="1"'), '文档清单=折叠次级（details）在册')
  // 服务分组人话标题（服务实例/工作流/连接与凭据源）
  assert.ok(SRC.includes("sec('服务实例'") && SRC.includes("sec('工作流'") && SRC.includes("sec('连接与凭据源'"),
    '服务分组人话标题在册')
  // 对话入口点入会话屏（chat/<agent>——非对象详情）
  assert.ok(SRC.includes("data-go=\"chat/' + esc(a) + '\""), '对话入口点入会话屏（chat/<agent>）')
})

test('L75-05 §13.2 渲染优先：渲染器在册+XSS 转义红线+默认渲染视图+原文/scheme 次级切换', () => {
  assert.ok(SRC.includes('window.__CC.md'), 'console-md 渲染器入 bundle')
  assert.ok(SRC.includes('function renderMarkdown'), 'renderMarkdown 在册')
  // XSS 红线：esc() 先行——一切内容先转义再走结构化解析；链接白名单零 javascript: 通路
  assert.ok(SRC.includes("replace(/&/g, '&amp;')"), 'HTML 转义（&amp;）在渲染器最前（XSS 红线）')
  assert.ok(SRC.includes('function safeHref'), '链接白名单 safeHref 在册')
  assert.ok(!/href="\s*'\s*\+\s*[^']/.test(SRC.slice(SRC.indexOf('function renderMarkdown'), SRC.indexOf('yamlToCards'))), '渲染器零原文直插 href')
  // 编辑器屏：默认渲染视图 + 原文切换
  assert.ok(SRC.includes("data-act=\"ed-view\""), '视图切换动作在册（正文/原文）')
  assert.ok(SRC.includes('function edViewMode') && SRC.includes("'render'"), '默认视图=render（渲染优先）')
  assert.ok(SRC.includes('function paintRenderBody'), '渲染正文绘制在册')
  assert.ok(SRC.includes('function isMarkdownDoc'), 'markdown 文档类判别在册（文档类默认 markdown）')
  // 对象正文：字段卡默认态+「YAML」折叠次级（首屏禁裸 YAML 转储）
  assert.ok(SRC.includes('md.yamlToCards('), '字段卡渲染通路在册')
  assert.ok(SRC.includes("rawDisclosure('YAML'"), '「YAML」折叠次级在册')
  assert.ok(SRC.includes("rawDisclosure('原文'"), '「原文」折叠次级在册（markdown 文档类）')
})

test('L75-06 渲染器机械直测：markdown 全要素+XSS 攻击串转义+URL 白名单+字段卡解析', () => {
  // 沙箱执行 console-md.js（零 DOM 依赖）——渲染输出断言
  const window = {}
  const fn = new Function('window', readFileSync(join(CLIENT, 'console-md.js'), 'utf8'))
  fn(window)
  const md = window.__CC.md
  // XSS 攻击串恒转义
  const evil = '<img src=x onerror=alert(1)>'
  const out = md.renderMarkdown(evil)
  assert.ok(!out.includes('<img'), 'XSS：img 标签恒转义（先转义后渲染红线）')
  assert.ok(out.includes('&lt;img'), '转义词形在册')
  const out2 = md.renderMarkdown('[x](javascript:alert(1))')
  assert.ok(!out2.includes('href="javascript'), 'javascript: 链接白名单拒绝（降级纯文本不产可点 href）')
  // 全要素
  const full = md.renderMarkdown('# h1\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> q\n\n\`\`\`\ncode\n\`\`\`\n\n**b** *i* \`c\`')
  for (const piece of ['md-h1', '<li', 'md-tbl', 'md-quote', 'md-pre', '<strong>', '<em>', 'md-code']) {
    assert.ok(full.includes(piece), 'markdown 要素：' + piece)
  }
  // 列表标签配平（结构合法）
  const li = (full.match(/<li[\s>]/g) || []).length, liCl = (full.match(/<\/li>/g) || []).length
  assert.equal(li, liCl, '列表 li 配平')
  // 字段卡：ServiceDesc 正文 → data-md-card 结构化（非裸转储）
  const cards = md.yamlToCards('metadata:\n  name: demo\nspec:\n  instances:\n    - name: i1\n      agentRefs: ["agent://a"]\n')
  assert.ok(cards.includes('data-md-card="metadata"'), '字段卡顶层键在册')
  assert.ok(cards.includes('agent://a'), 'agentRef 值在册（列表解析）')
  assert.ok(cards.includes('md-gloss') || cards.includes('md-subcard'), '字段卡结构（释义/子卡）在册')
})

test('L75-07 R-UX-5 视觉锚定：md/syscard 样式零新色彩常量（只消费 dsh 原生 token）', () => {
  const css = readFileSync(join(CLIENT, 'console.css'), 'utf8')
  const mdBlock = css.slice(css.indexOf('R-UX-4 渲染优先'))
  assert.ok(mdBlock.length > 0, 'md 样式块在册')
  // 新增样式块只允许既有 token 变量与既有字面色（dsh 原生体系）——禁自造第二套色板
  const tokens = mdBlock.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  const dshNative = ['#0b0e14', '#161b24', '#273041', '#8b93a7', '#3b82f6', '#1d3a68']
  const foreign = tokens.filter((t) => !dshNative.includes(t.toLowerCase()))
  assert.equal(foreign.length, 0, '新样式块引入非 dsh 原生色值：' + foreign.join(','))
  assert.ok(mdBlock.includes('var(--panel-2)'), 'md 样式消费 dsh 原生 token（--panel-2）')
})

test('L75-08 bundle 形态：dist 随源重建（client/console-md.js 入拼接序）', () => {
  const build = readFileSync(join(PLUGIN, 'build-client.mjs'), 'utf8')
  assert.ok(build.includes("'console-md.js'"), 'console-md.js 入 bundle 拼接序')
  assert.ok(SRC.length > 600000, 'dist/client.js 重建在册（bytes=' + SRC.length + '）')
})

/* ============ L76 提案×上下文对照卡（concepts/proposal.md §4.6 · console-ui.md §12，loop-76） ============ */

test('L76-01 对照卡三态必现其一：conflicts / supplements / degraded（模块直测+引用可展开+hash 在册）', async () => {
  const window: Record<string, any> = {}
  const fn = new Function('window', readFileSync(join(CLIENT, 'console-ctx.js'), 'utf8'))
  fn(window)
  const ctx = window.__CC.ctx
  const docs = [
    { repo: 'core_design', path: 'concepts/proposal.md', sha: 'aaaabbbbccccddddeeeeffff' },
    { repo: 'core_design', path: 'concepts/event.md', sha: '111122223333444455556666' },
    { repo: 'core_design', path: 'concepts/connector.md', sha: '999988887777666655554444' },
  ]
  // 冲突态：主题+域双命中 → conflicts 非空
  const yamlHit = 'title: 提案审批通知分流\nsummary: 调整提案 approve 流转与 connectorRefs 声明'
  const cx1 = ctx.analyze(yamlHit, docs)
  const card1 = ctx.card(cx1)
  const state1 = String(card1.match(/data-ctx-state="([^"]+)"/)?.[1])
  assert.ok(['conflicts', 'supplements'].includes(state1), '三态其一（conflicts|supplements）≠ ' + state1)
  if (state1 === 'conflicts') {
    assert.ok(card1.includes('data-ctx-conflict="0"'), '冲突卡逐条 details 可展开')
    assert.ok(/<details class="ctx-item" data-ctx-conflict/.test(card1), '冲突引用可展开（details）')
    assert.ok(card1.includes('aaaabbbb'), 'hash 短形在册')
    assert.ok(card1.includes('hash=aaaabbbbccccddddeeeeffff'), 'hash 全形可核对（逐字节对账口径）')
    assert.ok(card1.includes('core_design/concepts/proposal.md#proposal'), 'ref=<repo>/<path>#<锚> 词形在册')
  }
  // 补充态：域键单命中（connectorRefs → connector.md）→ supplements 非空零冲突
  const yamlSupp = 'title: 报表导出增强\nsummary: 导出任务声明 connectorRefs 复用'
  const cx2 = ctx.analyze(yamlSupp, docs)
  assert.equal(cx2.conflicts.length, 0, '单命中不产冲突')
  assert.ok(cx2.supplements.some((s: any) => s.ref === 'core_design/concepts/connector.md#connector'), '补充卡 ref 在册')
  const card2 = ctx.card(cx2)
  assert.ok(card2.includes('data-ctx-supp="0"'), '补充卡条目在册')
  assert.ok(card2.includes('data-act="ctx-supplement-add"'), '一键加入随行清单按钮在册')
  // 降级态：索引缺席 → degraded 可见不阻断
  const cx3 = ctx.analyze(yamlHit, null)
  assert.equal(cx3.degraded, true, '索引缺席=degraded')
  const card3 = ctx.card(cx3)
  assert.ok(card3.includes('data-ctx-state="degraded"'), '降级态词形在册')
  assert.ok(card3.includes('data-ctx-degraded="1"'), '降级可见（不静默）')
  assert.ok(card3.includes('不阻断'), '降级不阻断词形在册')
})

test('L76-02 对照入口：check 复用（sig 同→不重复装配）+ 降级链路（loader 失败=degraded 卡）', async () => {
  const window: Record<string, any> = {}
  const fn = new Function('window', readFileSync(join(CLIENT, 'console-ctx.js'), 'utf8'))
  fn(window)
  const ctx = window.__CC.ctx
  const docs = [{ repo: 'core_design', path: 'concepts/proposal.md', sha: 'aaaabbbbccccddddeeeeffff' }]
  let calls = 0
  ctx.setDocsLoader(() => { calls++; return Promise.resolve({ docs }) })
  const yaml = 'title: 提案审批分流优化\nsummary: approve 通知分流'
  const r1 = await ctx.check('Proposal', 'global', 'ctx-demo', yaml)
  assert.equal(r1.reused, false, '首跑=新装配')
  const r2 = await ctx.check('Proposal', 'global', 'ctx-demo', yaml)
  assert.equal(r2.reused, true, '同键同摘要复用（tagSig 语义）——calls=' + calls)
  assert.equal(calls, 1, '索引只现读一次（120s 缓存）')
  // loader 失败 → degraded（不阻断）
  const win2: Record<string, any> = {}
  ;(new Function('window', readFileSync(join(CLIENT, 'console-ctx.js'), 'utf8')))(win2)
  win2.__CC.ctx.setDocsLoader(() => Promise.reject(new Error('down')))
  const r3 = await win2.__CC.ctx.check('Proposal', 'global', 'ctx-demo2', yaml)
  assert.equal(r3.cx.degraded, true, 'loader 失败=degraded 可见')
  assert.ok(win2.__CC.ctx.card(r3.cx).includes('data-ctx-state="degraded"'), '降级卡在册')
  // approvalStrip：在册=完整对照；缺席=降级可见（不静默）
  const strip0 = win2.__CC.ctx.approvalStrip(null, 'ctx-demo2')
  assert.ok(strip0.includes('data-ctx-approval="ctx-demo2"'), '审批屏折叠次级在册')
  assert.ok(strip0.includes('data-ctx-degraded="1"'), '审批屏降级可见（缺席不静默）')
})

test('L76-03 提交节点与审批屏挂载词形在册（对话区独立卡/预览区/详情屏 slot/动作）', () => {
  assert.ok(SRC.includes('window.__CC.ctx'), 'console-ctx 模块入 bundle')
  assert.ok(SRC.includes("ctxCardHtml(st)"), '对话区/预览区对照卡挂载在册')
  assert.ok(SRC.includes('id="intake-ctx-card"'), '对话区独立卡 id 在册')
  assert.ok(SRC.includes('id="pd-ctx-slot"'), '审批详情屏对照 slot 在册')
  assert.ok(SRC.includes('data-ctx-approval='), '审批屏折叠次级词形在册')
  assert.ok(SRC.includes("ACTIONS['ctx-supplement-add']"), '补充项一键随行动作在册')
  assert.ok(SRC.includes('ctxRunCheck'), '提交节点随行对照入口在册')
  assert.ok(SRC.includes('__CC.ctx.setDocsLoader'), '文档库索引 loader 注入在册')
  assert.ok(SRC.includes('__CC.propYaml = propYaml'), 'propYaml 导出在册（降级重试摘要重建通道）')
  assert.ok(SRC.includes("ACTIONS['ctx-retry']"), '降级重试动作处理器在册')
  assert.ok(SRC.includes('window.__CC.ctx.yamlOf'), '模块侧 yamlOf 摘要重建在册')
  assert.ok(SRC.includes('ctx-degraded .btn'), '降级卡重试按钮样式在册')
  const build = readFileSync(join(PLUGIN, 'build-client.mjs'), 'utf8')
  assert.ok(build.includes("'console-ctx.js'"), 'console-ctx.js 入 bundle 拼接序（console-md 后 console-live 前）')
})

test('L76-04 对照卡文案与样式纪律：零工程词形（「面」族/E<n>/L<n>）+ 零新色值（dsh 原生 token）', () => {
  const src = readFileSync(join(CLIENT, 'console-ctx.js'), 'utf8')
  const banned = /事件面|指标面|文档面|权限面|读面|写面|执行面|数据面|运行面|准入面/
  for (const s of stringLiterals(src)) {
    assert.ok(!banned.test(s) || /面板|界面/.test(s), '对照卡违禁词形：' + s.slice(0, 60))
    assert.ok(!/\bE[0-9]\b/.test(s) && !/L[0-9]+-/.test(s) && !/真数据/.test(s), '里程碑词形：' + s.slice(0, 60))
  }
  const css = readFileSync(join(CLIENT, 'console.css'), 'utf8')
  const ctxBlock = css.slice(css.indexOf('提案×文档对照卡'))
  assert.ok(ctxBlock.includes('.ctx-card'), '对照卡样式块在册')
  const tokens = ctxBlock.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  const dshNative = ['#0b0e14', '#161b24', '#273041', '#8b93a7', '#3b82f6', '#1d3a68']
  const foreign = tokens.filter((t) => !dshNative.includes(t.toLowerCase()))
  assert.equal(foreign.length, 0, '对照卡样式引入非 dsh 原生色值：' + foreign.join(','))
  assert.ok(ctxBlock.includes('var(--panel-2') || css.includes('var(--panel-2'), '对照卡样式消费 dsh 原生 token（--panel-2）')
})

test('L77-01 降级重试：degraded 卡自带重试按钮（免刷新整页）——refresh 现读重装配+同键同摘要语义在册', async () => {
  const window: Record<string, any> = {}
  const fn = new Function('window', readFileSync(join(CLIENT, 'console-ctx.js'), 'utf8'))
  fn(window)
  const ctx = window.__CC.ctx
  // ① degraded 卡自带重试按钮（文案=「重试对照」——免刷新整页）；带 kind/scope/name 数据通道
  //    （走 check() 生产路径——analyze 直产无定位戳，check 盖戳后卡才携带 data-kind/scope）
  ctx.setDocsLoader(() => Promise.reject(new Error('down')))
  const cxCheck = await ctx.check('Proposal', 'global', 'ctx-retry-card', 'title: 对照重试\nsummary: 按钮在册')
  const cardDeg = ctx.card(cxCheck.cx)
  assert.equal(cxCheck.cx.degraded, true, '前置：索引缺席=degraded')
  assert.ok(cardDeg.includes('data-act="ctx-retry"'), '降级卡重试按钮在册（ctx-retry）')
  assert.ok(cardDeg.includes('重试对照'), '重试文案在册（非「刷新」词形）')
  assert.ok(cardDeg.includes('data-kind="Proposal"') && cardDeg.includes('data-scope="global"'), '重试按钮携带对象定位数据')
  // ② refresh 强制现读重装配：先跑出 degraded，再 loader 恢复后 refresh → 非 degraded
  let calls = 0
  ctx.setDocsLoader(() => { calls++; return Promise.reject(new Error('down')) })
  const r1 = await ctx.check('Proposal', 'global', 'ctx-retry-demo', 'title: 对照重试\nsummary: 恢复')
  assert.equal(r1.cx.degraded, true, '前置：loader 失败=degraded')
  const docs = [{ repo: 'core_design', path: 'concepts/proposal.md', sha: 'aaaabbbbccccddddeeeeffff' }]
  ctx.setDocsLoader(() => { calls++; return Promise.resolve({ docs }) })
  const r2 = await ctx.refresh('Proposal', 'global', 'ctx-retry-demo', 'title: 对照重试\nsummary: 恢复')
  assert.equal(r2.cx.degraded, false, 'refresh 后索引恢复=完整对照')
  assert.equal(r2.reused, false, 'refresh 不复用失败态（失败态本就不缓存——重试恒现读）')
  assert.ok(calls >= 2, 'refresh 强制跳过索引缓存现读（calls=' + calls + '）')
  assert.equal(r2.cx.kind, 'Proposal', 'cx 携带对象定位戳（重试按钮 data 通道同源）')
  // ③ 复用语义回归：成功态同键同摘要仍复用（refresh 只清键，不破坏既有缓存语义）
  const r3 = await ctx.check('Proposal', 'global', 'ctx-retry-demo', 'title: 对照重试\nsummary: 恢复')
  assert.equal(r3.reused, true, '成功态复用语义保持（refresh 后 check 同 sig 复用）')
})

test('L78-01 R-UX-7 工作台模块直测：tagType 分组/规则命中来源显式/结构段完成度/ctx 摘要/键形（§14.5）', async () => {
  const window: Record<string, any> = {}
  const fn = new Function('window', readFileSync(join(CLIENT, 'console-obj.js'), 'utf8'))
  fn(window)
  const obj = window.__CC.obj
  // ① tagType 分组：词表归组+未分组殿后（不冒充归组）
  const g = obj.tagGroups(['reliability', 'ux', 'other'], { reliability: '治理', ux: '体验' })
  assert.deepEqual(g.map((x: any) => x.type), ['体验', '治理', '未分组'])
  assert.deepEqual(g[2].tags, ['other'])
  assert.equal(obj.tagGroups([], {}).length, 0, '零 tag=零组（诚实空态）')
  // ② 规则命中：三路来源显式列（标签同组/原文提及 kind/正文引用 basename）；零命中=空数组不兜底
  const rules = [
    { repo: 'core_design', path: 'rule/rule_eng.md', tags: ['交付'], content: 'dev-delivery workflow 交付规则' },
    { repo: 'core_design', path: 'rule/rule_pub.md', tags: ['发布'], content: '发布规则' },
  ]
  const hit = obj.rulesFor({ kind: 'Workflow', scope: 'global', name: 'dev-delivery', content: '见 rule_eng', tags: ['交付'] }, rules)
  assert.equal(hit.degraded, false, '索引在=不降级')
  assert.equal(hit.hits.length, 1, '仅命中规则在列')
  assert.ok(hit.hits[0].why.some((w: string) => w.indexOf('标签') >= 0), '命中来源=标签同组（显式）')
  assert.ok(hit.hits[0].why.some((w: string) => w.indexOf('rule_eng') >= 0), '命中来源=正文引用（显式）')
  const none = obj.rulesFor({ kind: 'Provider', scope: 'global', name: 'oss', content: 'plain', tags: [] }, rules)
  assert.deepEqual(none.hits, [], '零命中=空数组（「无适用规则」不装假）')
  const deg = obj.rulesFor({ kind: 'X', scope: '', name: 'y', content: '', tags: [] }, null)
  assert.equal(deg.degraded, true, '索引缺席=降级显式（不冒充无适用）')
  // ③ 规则引用深链=设计文档工作台形（designdoc/:repo/:path——path 整段单次编码，involvedRoute 同词形）
  assert.equal(obj.objRouteOfRef('core_design/rule/rule_ux.md#rule_ux'), 'designdoc/core_design/rule%2Frule_ux.md')
  // ④ 结构段完成度：注册段名 vs 正文标题（done/缺 显式）
  const comp = obj.sectionCompletion('## 目标\nx\n## 范围\ny', ['目标', '范围', '时间线'])
  assert.deepEqual(comp.map((c: any) => c.done), [true, true, false], '完成度逐段判定')
  assert.deepEqual(obj.sectionCompletion('x', []), [], '无注册=空数组（不装假）')
  // ⑤ ctx 摘要：未装配=显式 state:none；在册=带会话锚与规模档
  assert.equal(obj.ctxSummary(null).state, 'none')
  const s = obj.ctxSummary({ sessionId: 's1', tagSig: 'sig-abcdef0123456789', chunks: [{ ref: 'a', hash: 'h', tokens: 3000 }] })
  assert.equal(s.state, 'ok')
  assert.equal(s.sessionId, 's1')
  assert.ok(s.text.indexOf('1 段') >= 0, '规模人话（段计数）')
  // ⑥ scheme 声明投影：kinds 载荷行 → 声明卡 yaml（md.yamlToCards 同源渲染）
  const y = obj.kindRegYaml({ name: 'Workflow', builtin: true, storage: 'global/workflows.yaml', spec: { enabled: '?bool' }, relations: { owns: 'Run' } })
  assert.ok(y.indexOf('kind: Workflow') >= 0 && y.indexOf('spec:') >= 0 && y.indexOf('owns: Run') >= 0, '声明投影含 spec/relations')
  assert.equal(obj.kindRegYaml(null), '', '空注册=空串')
  // ⑦ 六片渲染词形：缺片显式「无」+ degraded 可见（不静默）
  assert.ok(obj.tagPanel([]).includes('data-obj-tags-empty="1"'), '标签缺片=显式空态')
  assert.ok(obj.rulePanel({ hits: [], degraded: true, reason: '暂不可达', scanned: 0 }).includes('data-obj-rules-degraded="1"'), '规则降级=可见')
  assert.ok(obj.rulePanel({ hits: [], degraded: false, reason: '', scanned: 3 }).includes('无适用规则'), '零命中=「无适用规则」')
  assert.ok(obj.ctxPanel(obj.ctxSummary(null)).includes('data-obj-ctx="none"'), '上下文未装配=显式')
  assert.equal(obj.opsPanel([]), '', '无操作=整片不显示（不画灰按钮）')
})

test('L78-02 R-UX-7 工作台接线在册：路由/loader 注入/六片挂载词形/别名跳转/拼接序（回潮即红）', () => {
  assert.ok(SRC.includes('window.__CC.obj'), 'console-obj 模块入 bundle')
  assert.ok(SRC.includes("route('obj/:kind/:scope/:name'"), '工作台路由在册（#/obj/:kind/:scope/:name）')
  assert.ok(SRC.includes('__CC.obj.setRuleDocsLoader'), '规则文档族 loader 注入在册')
  assert.ok(SRC.includes('__CC.obj.setTagTypesLoader'), 'tagType 词表 loader 注入在册')
  assert.ok(SRC.includes('data-obj-tags="1"') && SRC.includes('data-obj-rules="1"') && SRC.includes('data-obj-ctx="') &&
    SRC.includes('data-obj-ops="1"') && SRC.includes('data-obj-scheme="1"') && SRC.includes('data-obj-content="1"'),
    '六片挂载词形在册（标签/规则/上下文/操作/内容/scheme）')
  assert.ok(SRC.includes('data-obj-list="1"'), '对象清单在册（标识符全可点）')
  assert.ok(SRC.includes("ACTIONS['obj-tag']") && SRC.includes("ACTIONS['obj-rules-retry']") && SRC.includes("ACTIONS['obj-chat']"),
    '工作台动作处理器在册（tag 联动/重试/开聊）')
  assert.ok(SRC.includes("location.replace('#/obj')") || SRC.includes("route('obj', function"), '首屏缺省落地=对象工作台（R-UX-7 首屏=工作台——空段/裸词重定向）')
  assert.ok(SRC.includes("{ id: 'welcome', label: '对象工作台', route: '#/obj'"), '侧栏首位=对象工作台（旧 Welcome 入口迁移）')
  const build = readFileSync(join(PLUGIN, 'build-client.mjs'), 'utf8')
  assert.ok(build.includes("'console-obj.js'") && build.indexOf("'console-obj.js'") > build.indexOf("'console-md.js'") &&
    build.indexOf("'console-obj.js'") < build.indexOf("'console-live.js'"),
    'console-obj.js 入 bundle 拼接序（console-md 后 console-live 前）')
})

test('L79-01 R-UX-6 任务中心/报告模块直测：分组人话词形/证据路由/会话头 chips/降级词形（console-ui.md §16+§14）', async () => {
  const window: Record<string, any> = {}
  const fn = new Function('window', readFileSync(join(CLIENT, 'console-tasks.js'), 'utf8'))
  fn(window)
  const tk = window.__CC.tasks
  const t = (id: string, phase: string, extra?: any) => ({
    kind: 'Task', scope: id.split('/')[0], name: id.split('/')[1],
    spec: Object.assign({ title: 'T-' + id, summary: 's', dependsOn: [], touches: [], priority: 'p1', agent: 'dev-1' }, extra && extra.spec),
    status: Object.assign({ phase, attempts: 1, agentSession: '', lastAction: '', lastError: '' }, extra && extra.status),
  })
  // ① 分组=确定性：正在做(running/verifying)/排队(queued/ready)/完成(done)；blocked/failed 按原因分卡住/等人
  const g = tk.groupTasks([
    t('a/one', 'running'), t('a/two', 'verifying'), t('b/one', 'queued'), t('b/two', 'ready'),
    t('c/one', 'done'), t('d/one', 'blocked', { status: { lastError: '等待审批通过' } }),
    t('d/two', 'blocked', { status: { lastError: '依赖未完成' } }), t('e/one', 'failed', { status: { lastError: 'verify 连续失败' } }),
    t('f/one', 'canceled'),
  ])
  assert.deepEqual(g.doing.map((x: any) => x.name), ['one', 'two'])
  assert.deepEqual(g.queued.map((x: any) => x.scope), ['b', 'b'])
  assert.equal(g.done.length, 2, 'done+canceled 入完成组（canceled 徽标如实不冒充成功）')
  assert.equal(g.waiting.length, 1, '审批词形原因=等人')
  assert.equal(g.stuck.length, 2, '其余 blocked/failed=卡住')
  assert.equal(tk.runningCount([t('a/one', 'running'), t('a/two', 'verifying'), t('b/one', 'queued')]), 1, '并发摘要只数 running（上限未知不装假）')
  // ② 相位徽人话；未知相位原词如实
  assert.ok(tk.phaseChip(t('a/x', 'done')).includes('已完成') && tk.phaseChip(t('a/x', 'done')).includes('chip ok'))
  assert.ok(tk.phaseChip(t('a/x', 'mystery')).includes('mystery'), '未知相位不冒充人话')
  // ③ 任务路由：id 整段单次编码（%2F 形——路由侧整体解回）
  assert.equal(tk.taskRoute('dev/build-x'), 'task/dev%2Fbuild-x')
  assert.equal(tk.sessionRoute('s 1'), 'session/s%201')
  // ④ 证据 ref 路由映射：已知词形可点，未知=不可点不冒充
  assert.equal(tk.evidenceRoute('#/wf/dev-delivery/r/1'), 'wf/dev-delivery/r/1')
  assert.equal(tk.evidenceRoute('#/event/e-9'), 'event/e-9')
  assert.equal(tk.evidenceRoute('#/inbox'), 'inbox')
  assert.equal(tk.evidenceRoute('ServiceDesc/dev/core'), 'obj/ServiceDesc/dev/core')
  assert.equal(tk.evidenceRoute('#/mystery/x'), null, '未知锚词形=纯文本（不编路由）')
  // ⑤ severity 排序 critical→high→medium；卡片证据可点+action 按钮人话
  const sorted = tk.sortAttention([
    { severity: 'medium', title: 'm' }, { severity: 'critical', title: 'c' }, { severity: 'high', title: 'h' }])
  assert.deepEqual(sorted.map((x: any) => x.title), ['c', 'h', 'm'])
  const card = tk.attentionCard({
    severity: 'critical', category: 'run', title: '门禁连续失败', why: '连续 3 轮失败',
    evidence: [{ kind: 'run', ref: '#/wf/dev/r/1', hash: 'abc', at: 't1' }, { kind: 'doc', ref: 'mystery-word', hash: '', at: '' }],
    action: { kind: 'approve', target: '#/approvals' },
  }, 0)
  assert.ok(card.includes('data-act="go" data-go="wf/dev/r/1"'), '证据 ref 可点（已知词形）')
  assert.ok(!card.includes('data-go="mystery-word"'), '未知词形证据不编路由')
  assert.ok(card.includes('去审批'), 'action.kind 人话按钮')
  assert.ok(card.includes('sev-critical'), 'severity 卡档在册（critical 红档 css）')
  // ⑥ 会话头 chips：可得的才显示（Task 锚反查），无关联=显式人话，清单不可读=整片不显示
  assert.equal(tk.sessionChips(null, 's1'), '')
  assert.ok(tk.sessionChips([t('dev/t1', 'running', { status: { agentSession: 's9' } })], 's1').includes('未关联在册任务'))
  const chips = tk.sessionChips([t('dev/t1', 'running', { status: { agentSession: 's1' } })], 's1')
  assert.ok(chips.includes('Task: t1') && chips.includes('data-go="' + tk.taskRoute('dev/t1') + '"'), 'Task 锚 chip=任务详情深链')
  assert.ok(chips.includes('会话型任务'), 'workflow 字段未携带=显式人话注记不编造')
  // ⑦ 任务行：lastAction 一句话+对话深链（无会话锚=不画按钮）；兼容 GET /v1/tasks 扁平行形态（tasks_face.go taskRow）与详情嵌套形态
  const rowWith = tk.taskRow(t('dev/t1', 'running', { status: { agentSession: 's1', lastAction: '正在跑 gate' } }))
  assert.ok(rowWith.includes('正在跑 gate') && rowWith.includes('data-go="session/s1"'), '行内 lastAction+会话深链')
  const rowWithout = tk.taskRow(t('dev/t2', 'queued'))
  assert.ok(!rowWithout.includes('data-go="session/'), '无会话锚=不画对话按钮（不装假）')
  const flatRow = { name: 'probe-smoke-1', scope: 'self-recursive-core', title: '调度器冒烟探针', phase: 'running', dependsOn: ['a/dep1'], agentSession: 'self-recursive-core/probe-smoke-1', lastAction: '已请求取消' }
  assert.equal(tk.groupOf(flatRow), 'doing', 'GET /v1/tasks 扁平行形态 phase=running 归入 doing')
  assert.equal(tk.runningCount([flatRow]), 1, '扁平行形态 runningCount=1')
  assert.equal(tk.taskTitle(flatRow), '调度器冒烟探针', '扁平行形态 taskTitle 读顶层 title')
  const flatHtml = tk.taskRow(flatRow)
  assert.ok(flatHtml.includes('调度器冒烟探针') && flatHtml.includes('正在做') && flatHtml.includes('依赖 1') && flatHtml.includes('已请求取消') && flatHtml.includes('data-go="session/self-recursive-core%2Fprobe-smoke-1"'), '扁平行形态 taskRow 全要素可显')
  assert.ok(tk.sessionChips([flatRow], 'self-recursive-core/probe-smoke-1').includes('Task: probe-smoke-1'), '扁平行形态 sessionChips 反查命中')
  // ⑧ 报告词形：facts 防御投影/降级横幅列 missing/clear 折叠/生成方式人话/window 对象形态零 [object Object]
  assert.ok(tk.factsHtml(['6 系统', '42 轮']).includes('6 系统'), 'facts 数组=chips')
  assert.ok(tk.factsHtml({ systems: 6 }).includes('systems'), 'facts 对象=kv chips')
  assert.ok(tk.degradedBanner({ degraded: true, missing: ['runs', 'approvals'] }).includes('runs、approvals'), '降级横幅列 missing')
  assert.equal(tk.degradedBanner({ degraded: false }), '', '未降级=零横幅')
  assert.equal(tk.clearPanel([]), '', '零 clear=不渲染折叠（诚实空态由空卡承担）')
  assert.ok(tk.clearPanel([{ candidateId: 'c1', note: '已处理' }]).includes('本窗口已澄清'), 'clear 折叠人话词形')
  assert.equal(tk.generatedByLabel('llm'), '智能归纳')
  assert.equal(tk.generatedByLabel('rules'), '基础汇总')
  assert.equal(tk.windowLabel({ from: '2026-11-25T07:00:00Z', to: '2026-11-26T07:00:00Z' }), '24h', 'attention.go window {from,to} 对象形态=24h')
  const foot = tk.reportFooter({ generatedBy: 'rules', scope: 'global', window: { from: '2026-11-25T07:00:00Z', to: '2026-11-26T07:00:00Z' }, asOf: '2026-11-26T07:00:00Z' })
  assert.ok(foot.includes('窗口 24h') && !foot.includes('[object Object]'), 'reportFooter 零 [object Object]')
  // ⑨ loader 注入：清单失败=落 null 不缓存失败态；详情恒现读
  let calls = 0
  tk.setTasksLoader(() => { calls++; return Promise.reject(new Error('x')) })
  assert.equal(await tk.ensureTasks(), null, '读取失败=显式 null（调用方降级词形）')
  assert.equal(await tk.ensureTasks(true), null)
  assert.equal(calls, 2, '失败态不缓存（每拍现读）')
  let tid = ''
  tk.setTaskLoader((id: string) => { tid = id; return Promise.resolve({ name: id.split('/')[1] }) })
  assert.equal((await tk.ensureTask('dev/t9')).name, 't9')
  assert.equal(tid, 'dev/t9')
})

test('L79-02 R-UX-6 接线在册：三路由/侧栏入口/loader 注入/会话头 chips/拼接序/锚词形（回潮即红）', () => {
  assert.ok(SRC.includes('window.__CC.tasks'), 'console-tasks 模块入 bundle')
  assert.ok(SRC.includes("route('tasks', screenTasks)"), '任务中心路由在册（#/tasks）')
  assert.ok(SRC.includes("route('task/:id', screenTaskDetail)"), '任务详情路由在册（#/task/:id）')
  assert.ok(SRC.includes("route('report', screenReport)"), '关注报告路由在册（#/report）')
  // 侧栏入口（entry.js 注册处——L36-02 断言 11 入口成对；此处锚词形）
  assert.ok(SRC.includes("id: 'report', panel: 'core-console-report'"), '关注报告侧栏入口在册')
  assert.ok(SRC.includes("id: 'tasks', panel: 'core-console-tasks'"), '任务中心侧栏入口在册')
  assert.ok(SRC.includes("'welcome', 'overview', 'obj', 'report', 'tasks', 'task'"), 'CONSOLE_SEGS 收录 report/tasks/task（hash 同步宿主面板）')
  // loader 注入（同 obj/ctx 范式——模块零直接网络依赖）
  assert.ok(SRC.includes('__CC.tasks.setTasksLoader') && SRC.includes('__CC.tasks.setTaskLoader') && SRC.includes('__CC.tasks.setAttentionLoader'), '三 loader 注入在册')
  assert.ok(SRC.includes("LIVE.get('v1/tasks')") && SRC.includes("LIVE.get('v1/attention')"), '数据通路=既有只读代理（v1/tasks+v1/attention，零新写路径）')
  // 会话头 chips + 报告锚 + 任务中心锚
  assert.ok(SRC.includes('sess-task-chips'), '会话头 chips 挂载点在册（§16.1 D）')
  assert.ok(SRC.includes('data-task-groups="1"') && SRC.includes('data-tasks-degraded="1"') && SRC.includes('data-tasks-empty="1"'), '任务中心分组/降级/空态锚在册（零命中不装假）')
  assert.ok(SRC.includes('data-task-three="1"') && SRC.includes('data-task-spec="1"') && SRC.includes('data-task-status="1"'), '任务详情三行/声明/状态锚在册')
  assert.ok(SRC.includes('data-report-facts="1"') && SRC.includes('data-report-summary="1"') && SRC.includes('data-report-clear="1"') && SRC.includes('data-report-degraded="1"'), '报告 facts/综述/clear 折叠/降级横幅锚在册')
  assert.ok(SRC.includes('data-report-chat="1"'), '报告旁挂对话栏在册（chat/<agent> 深链模式）')
  assert.ok(SRC.includes("ACTIONS['tasks-refresh']") && SRC.includes("ACTIONS['report-refresh']") && SRC.includes("ACTIONS['report-chat']"), '刷新/对话动作处理器在册')
  assert.ok(SRC.includes("ref.kind === 'Session'") && SRC.includes("ref.kind === 'Task'"), '工作台操作片对接 Session/Task 深链（#/session/:id 与 #/task/:id）')
  // css token 块随 bundle（dsh 原生 token 零新色值——.task-row/.att-card 消费既有变量）
  assert.ok(SRC.includes('.task-row') && SRC.includes('.att-card') && SRC.includes('.report-layout'), 'css 布局块入 bundle')
  const build = readFileSync(join(PLUGIN, 'build-client.mjs'), 'utf8')
  assert.ok(build.includes("'console-tasks.js'") && build.indexOf("'console-tasks.js'") > build.indexOf("'console-obj.js'") &&
    build.indexOf("'console-tasks.js'") < build.indexOf("'console-live.js'"),
    'console-tasks.js 入 bundle 拼接序（console-obj 后 console-live 前）')
})

test('L80-01 工作台 v0.65 上下文/trace 读面与补标+revSourceLabel 纯函数机械直测（R-UX-7 + R-DOC-9）', async () => {
  const window: any = {}
  new Function('window', readFileSync(join(CLIENT, 'console-obj.js'), 'utf8'))(window)
  const obj = window.__CC.obj
  // ① traceRouteOf：三段/多段 scope 精确路由；非三段不编假路由
  assert.equal(obj.traceRouteOf('ServiceDesc/self-recursive-core/desc'), 'obj/ServiceDesc/self-recursive-core/desc')
  assert.equal(obj.traceRouteOf('Rule/a/b/r1'), 'obj/Rule/a%2Fb/r1', '多段 scope 单次编码保留')
  assert.equal(obj.traceRouteOf('bad-only-one'), '', '非三段=空串（不编假路由）')
  // ② tracePanel：降级 / 未入索引 / 空态 / 三向聚合含 stale 告警与未解析标注
  assert.ok(obj.tracePanel(null).includes('data-obj-trace-degraded="1"'), 'trace 失败=降级显式')
  assert.ok(obj.tracePanel({ missing: true }).includes('data-obj-trace-missing="1"'), '404=未入索引诚实标注')
  assert.ok(obj.tracePanel({ implements: null, implemented_by: null, verified_by: null }).includes('data-obj-trace-empty="1"'), '全空=无上下游追踪声明')
  const trHtml = obj.tracePanel({
    implements: [{ doc: 'ServiceDesc/self-recursive-core/core', sections: ['§3'], designRev: '4', stale: true, resolved: true }],
    implemented_by: [{ doc: 'Task/self-recursive-core/impl-1', stale: false, resolved: true }],
    verified_by: [{ doc: 'ghost/missing', stale: false, resolved: false }]
  })
  assert.ok(trHtml.includes('data-obj-trace="1"'), '非空 trace 挂载锚在册')
  assert.ok(trHtml.includes('data-trace-stale="1"') && trHtml.includes('待对齐'), 'stale=true 显式告警徽')
  assert.ok(trHtml.includes('data-go="obj/ServiceDesc/self-recursive-core/core"'), '可解析对端=可点工作台深链')
  assert.ok(trHtml.includes('对齐 r4') && trHtml.includes('§3'), '对齐版次与章节锚点透传')
  assert.ok(trHtml.includes('未解析') && !trHtml.includes('data-go="obj/ghost'), '未解析对端标注未解析且不编路由')
  // ③ relatedPanel：过滤自身+按相关性呈现 Top5+降级/空态
  assert.ok(obj.relatedPanel(null, 'Agent/global/a').includes('data-obj-related-degraded="1"'))
  assert.ok(obj.relatedPanel([{ kind: 'Agent', scope: 'global', name: 'a', score: 90, why: 'self' }], 'Agent/global/a').includes('data-obj-related-empty="1"'), '剔除自身后空=诚实空态')
  const relHtml = obj.relatedPanel([
    { kind: 'Agent', scope: 'global', name: 'a', score: 99, why: 'self-only-marker' },
    { kind: 'ServiceDesc', scope: 'self-recursive-core', name: 'core', score: 42.5, why: '标题/关键词重合' }
  ], 'Agent/global/a')
  assert.ok(relHtml.includes('data-obj-related="1"') && relHtml.includes('42.5') && relHtml.includes('data-go="obj/ServiceDesc/self-recursive-core/core"'), '相关对象含得分/原因/工作台深链')
  assert.ok(!relHtml.includes('self-only-marker'), '自身条目已剔除')
  // ④ ctxPanel 组合：会话装配 + trace + related 同片不互伤
  const ctxHtml = obj.ctxPanel(obj.ctxSummary(null), { implements: [], implemented_by: [], verified_by: [] }, [], 'Agent/global/a')
  assert.ok(ctxHtml.includes('data-obj-ctx="none"') && ctxHtml.includes('data-obj-trace-empty="1"') && ctxHtml.includes('data-obj-related-empty="1"'))
  // ⑤ tagPanel 补标入口（§14.5）：有编辑权限才显示「补标」进编辑器（走既有 Apply 通路）
  assert.ok(obj.tagPanel([], { editRoute: 'doc/Task/s/t1' }).includes('data-obj-tag-edit="1"') && obj.tagPanel([], { editRoute: 'doc/Task/s/t1' }).includes('补标'))
  assert.ok(!obj.tagPanel([]).includes('data-obj-tag-edit="1"'), '无权限/未传 editRoute 不画补标按钮')
  // ⑥ revSourceLabel 双后端分立标注
  assert.equal(obj.revSourceLabel('sqlite-doc-history'), 'sqlite 逐次正文账')
  assert.equal(obj.revSourceLabel('git'), 'git 正文快照')
  // ⑦ trace/find loader 降级不抛错
  obj.setTraceLoader(() => Promise.reject(new Error('down')))
  assert.equal(await obj.ensureTrace('Agent', 'global', 'a'), null, 'trace loader 异常=null 降级')
  obj.setContextFindLoader(() => Promise.resolve({ hits: [{ kind: 'Agent', scope: 'global', name: 'b', score: 10 }] }))
  const hits = await obj.ensureRelated('a', [])
  assert.equal(hits.length, 1)
})

test('L80-02 关注报告当前循环卡（loopCard——console-ui.md §16.1 C）四态纯函数直测', () => {
  const window: any = {}
  new Function('window', readFileSync(join(CLIENT, 'console-tasks.js'), 'utf8'))(window)
  const tk = window.__CC.tasks
  const now = Date.parse('2026-11-26T08:00:00Z')
  // ① 双空=降级显式
  assert.ok(tk.loopCard(null, null, { now }).includes('data-report-loop="degraded"'), '唤醒与会话均不可达=降级')
  // ② 无 LoopRequested=空闲态 + corectl loop CLI 指引 + 显式会话型任务关系
  const idle = tk.loopCard({ wakes: [{ type: 'SessionStalled', at: '2026-11-26T07:50:00Z' }] }, { sessions: [] }, { now })
  assert.ok(idle.includes('data-report-loop="idle"') && idle.includes('当前无进行中循环') && idle.includes('corectl loop') && idle.includes('会话型任务（无 workflow run）'))
  // ③ 近 1h 内 LoopRequested=active，挑最新一条并带对话/任务/事件深链+停滞会话计数
  const active = tk.loopCard({
    wakes: [
      { type: 'LoopRequested', wake: 1, dedupKey: 'old-1', at: '2026-11-26T05:00:00Z', status: 'accepted', route: 'root-agent', eventId: 'evt-old' },
      { type: 'LoopRequested', wake: 2, dedupKey: 'cli-next-99', at: '2026-11-26T07:45:00Z', status: 'accepted', route: 'root-agent', eventId: 'evt-new' }
    ]
  }, { sessions: [{ sessionId: 's1', state: 'escalated' }] }, { now, agent: 'core-headless' })
  assert.ok(active.includes('data-report-loop="active"') && active.includes('cli-next-99') && active.includes('15m 前'), '命中最新 LoopRequested 且计算相对时长')
  assert.ok(active.includes('data-go="chat/core-headless"') && active.includes('data-go="tasks"') && active.includes('data-go="event/evt-new"'), '三深链可点')
  assert.ok(active.includes('停滞/升级 1') && active.includes('会话型任务（无 workflow run）'), '会话监控摘要+loop 与 workflow 关系显式')
  // ④ 超 1h=recorded（历史唤醒，不假装正在跑）
  const rec = tk.loopCard({ wakes: [{ type: 'LoopRequested', wake: 1, dedupKey: 'cli-old', at: '2026-11-26T01:00:00Z', status: 'accepted' }] }, { sessions: [] }, { now })
  assert.ok(rec.includes('data-report-loop="recorded"') && rec.includes('历史唤醒'))
})

test('L80-03 接线与回归锚：trace/context-find loader + sqlite doc-history + rev-content rv=1 修复 + loopCard（回潮即红）', () => {
  assert.ok(SRC.includes('__CC.obj.setTraceLoader') && SRC.includes('__CC.obj.setContextFindLoader'), '工作台 trace/context-find loader 注入在册')
  assert.ok(SRC.includes("LIVE.get('v1/trace/'") && SRC.includes("LIVE.get('v1/context/find?'"), 'v0.65 上下文与 trace 读路由接线在册')
  assert.ok(SRC.includes("'v1/doc-history/'") && SRC.includes('data-doc-history="1"'), '编辑器历史 tab 接入 /v1/doc-history 与逐次快照区块')
  assert.ok(!SRC.includes('rv === 1 ? Promise.resolve(null)'), 'hist-diff 不再误跳过 rv=1（sqlite 首版快照可达）')
  assert.ok(SRC.includes('data-rev-source=') && SRC.includes('revSourceLabel'), 'rev-content diff 按真实 source 区分 sqlite-doc-history 与 git')
  assert.ok(SRC.includes('TK.loopCard') && SRC.includes('data-report-loop='), '关注报告当前循环卡接线在册')
  assert.ok(SRC.includes('.ob-trace-row') && SRC.includes('.ob-rel-row') && SRC.includes('.report-loop') && SRC.includes('.doc-hist-sec'), 'L80 新增样式块入 bundle')
})
