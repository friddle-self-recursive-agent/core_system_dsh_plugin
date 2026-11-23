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

test('live 层只读纪律：零写方法（写路径唯一入口=POST /v1/apply，不经浏览器代理）', () => {
  const http = ['fetch(', 'POST', 'DELETE', 'PUT']
  assert.ok(liveSrc.includes('fetch('), 'live 层用 fetch')
  for (const m of ['POST', 'DELETE', 'PUT', 'PATCH']) {
    assert.ok(!new RegExp('\\bmethod\\s*[:=]\\s*[\\"\']' + m).test(liveSrc), `live 层不得出现 ${m} 写方法`)
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

test('对象详情 viewer + 事件详情路由注册（标识符全可点的落点面）', () => {
  assert.ok(SRC.includes("route('doc/:kind/:scope/:name'"), '对象键直链路由在册')
  assert.ok(SRC.includes("route('doc/:name'"), '名字解析路由在册')
  assert.ok(SRC.includes('function screenObject'), '对象 viewer 在册')
  assert.ok(SRC.includes('function screenEventLive'), '事件详情（真数据）在册')
  assert.ok(SRC.includes("route('event/:id', screenEventLive)"), '事件详情路由接线')
  assert.ok(SRC.includes('function refChips'), '正文引用标识符可点（system:// agent:// …）')
})

test('原型屏仍在册（未换装的屏保持 proto mock 待各自 E 轮）', () => {
  for (const fn of ['screenOverview', 'screenWorkflows', 'screenDocsGlobal', 'screenChat', 'screenApprovals']) {
    assert.ok(new RegExp('function ' + fn + '\\(').test(SRC), `${fn} 在册`)
  }
})
