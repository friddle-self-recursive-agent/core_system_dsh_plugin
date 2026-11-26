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
  'console-ctx.js', 'console-obj.js', 'console-chat.js', 'console-projects.js', 'console-app.js', 'conn-monitor.js', 'entry.js']

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
