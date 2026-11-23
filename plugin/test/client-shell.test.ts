// E1 client 面测试：真实构建产物 dist/client.js 的沙箱执行断言 + 连接态灯状态机（§1.5）。
// 判据对应 console-adoption.md §1.6（L36-02/03/04/05 的静态面与判定核面）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const SRC = readFileSync(join(PLUGIN, 'dist/client.js'), 'utf8')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 沙箱执行 bundle：捕获 ModuleLoader 工厂并执行，返回 exports 与可变的沙箱 location。 */
function loadBundle() {
  const factories = new Map()
  const window = { __ModuleLoader__: { load: (row) => factories.set(row.id, row.factory) } }
  const reactStub = new Proxy({}, {
    get: (_t, k) => (k === 'createElement'
      ? (type, props, ...kids) => ({ $$type: type, props, kids })
      : reactStub),
  })
  const sandboxLocation = { hash: '' }
  const req = (spec) => { if (spec === 'react') return reactStub; throw new Error('unexpected require: ' + spec) }
  const fn = new Function('require', 'window', 'document', 'location', 'navigator', SRC)
  fn(req, window, undefined, sandboxLocation, {})
  assert.ok(factories.has('dsh-plugin-core-system'), 'bundle 必须以包名注册工厂（entry name == package name）')
  const exports = factories.get('dsh-plugin-core-system')(req)
  return { exports, sandboxLocation }
}

/** 驱动 apply：捕获 slots.inject 回调并按生成器迭代，回收 register 调用。 */
function runApply(exports, sandboxLocation, hash) {
  sandboxLocation.hash = hash
  const registrations = []
  const injects = []
  let selected = null
  const ctx = {
    slots: {
      inject: (name, cb) => injects.push({ name, cb }),
      register: (opts, comp) => { registrations.push({ opts, comp }); return { dispose() {} } },
    },
    layout: {
      panelInfo: { getSnapshot: () => ({ activePanelId: selected }) },
      selectPanel: (id) => { selected = id },
    },
  }
  exports.apply(ctx) // apply 引用的 location/isConsoleHash 等自由变量解析到工厂闭包与沙箱参数
  for (const { cb } of injects) {
    for (const _ of cb()) void _ // 生成器逐产出驱动（真实 slots.inject 同语义）
  }
  return { registrations, getSelected: () => selected }
}

test('bundle 形态：ModuleLoader 工厂注册 + 依赖注入声明', () => {
  assert.ok(SRC.includes("window.__ModuleLoader__.load({ id: 'dsh-plugin-core-system', factory: function (require) {"), 'bundle 必须以 lazy-CJS 工厂形注册（dsh-client-modules 契约）')
  const { exports } = loadBundle()
  assert.deepEqual(exports.inject, ['slots', 'layout', 'sessions'])
  assert.equal(typeof exports.apply, 'function')
})

test('L36-02 Slots 注册面：main 面板键 + sidebar.panellist 入口成对注册', () => {
  const { exports, sandboxLocation } = loadBundle()
  const { registrations } = runApply(exports, sandboxLocation, '')
  const main = registrations.find((r) => r.opts.name === 'main')
  const icon = registrations.find((r) => r.opts.name === 'sidebar.panellist')
  assert.ok(main, '必须注册 main 面板（顶层导航扩展位）')
  assert.equal(main.opts.key, 'core-console')
  assert.equal(typeof main.comp, 'function')
  assert.ok(icon, '必须注册 sidebar.panellist 入口（侧栏门）')
  assert.equal(icon.opts.id, 'core-console')
  assert.ok(icon.opts.label, '入口必须带展示文案')
  assert.equal(typeof icon.comp, 'function')
})

test('L36-04 静态面：console hash 判定恢复面板选择', () => {
  const { exports, sandboxLocation } = loadBundle()
  assert.equal(runApply(exports, sandboxLocation, '#/workflows').getSelected(), 'core-console', 'boot 时 hash=console 路由 → selectPanel 恢复')
  assert.equal(runApply(exports, sandboxLocation, '').getSelected(), null, '无 hash → 不抢宿主默认面板')
  assert.equal(runApply(exports, sandboxLocation, '#/other/host/route').getSelected(), null, '非 console 路由段 → 不选面板')
})

test('L36-03 静态面：八入口+总览 全部在壳导航数据中且路由可达', () => {
  for (const id of ['welcome', 'overview', 'tree', 'workflows', 'docs', 'events', 'approvals', 'connectors', 'chat-root']) {
    assert.ok(SRC.includes(`id: '${id}'`), `壳导航缺入口 ${id}`)
  }
  for (const route of ['#/welcome', '#/overview', '#/tree', '#/workflows', '#/docs', '#/events', '#/approvals', '#/connectors', '#/chat/']) {
    assert.ok(SRC.includes(`'${route}`), `壳导航缺路由 ${route}`)
  }
})

test('L36-05 连接态灯状态机：帧新鲜=connected；断流退避=reconnecting；登录面 3×401=rotated 且停重试；2xx 清零', async () => {
  const { createConnMonitor } = monitorModule()
  // ── 场景 A：流上→帧到→connected；帧停→watchdog 判陈旧→reconnecting→退避重连（重连流全败→稳定琥珀）──
  {
    let closePending = () => {}
    let fetches = 0
    let streams = 0
    const fetchImpl = (url) => {
      fetches++
      if (String(url).includes('plugins/events')) {
        streams++
        if (streams > 1) return Promise.resolve({ ok: false, status: 200, body: null }) // 重连流全败
        let resolveRead = null
        const reader = { read: () => new Promise((r) => { resolveRead = r }) }
        closePending = () => { if (resolveRead) resolveRead({ done: true, value: undefined }) }
        return Promise.resolve({ ok: true, status: 200, body: { getReader: () => reader } })
      }
      return Promise.resolve({ status: 200 }) // 登录面
    }
    const m = createConnMonitor({
      fetchImpl, eventsPath: 'plugins/events', probePath: '/',
      freshMs: 60, backoffStart: 20, backoffCap: 60, watchdogPeriod: 15,
      onChange: () => {},
    })
    m.start()
    await sleep(30)
    assert.equal(m.state().state, 'connected', '流上即 connected')
    closePending = (() => {
      const prev = closePending
      return () => { prev() } // 首帧即活性证据（read 链推进）
    })()
    closePending()
    await sleep(300) // 静默超 60ms 新鲜窗 → watchdog 断流重连；重连流全败 → 稳定 reconnecting
    assert.equal(m.state().state, 'reconnecting', '帧不新鲜→reconnecting（不白屏不误报 rotated）')
    assert.ok(m.state().attempts >= 2, '重试计数前进（顶栏细条「重连中（第 N 次）」数据源）')
    assert.ok(fetches >= 5, '重连期登录面探测发生')
    m.stop()
    closePending()
  }
  // ── 场景 B：登录面连续 3×401 → rotated 且不再发任何 fetch ──
  {
    let count = 0
    const fetchImpl = (url) => {
      count++
      if (String(url).includes('plugins/events')) return Promise.resolve({ ok: false, status: 200, body: null }) // 流面不可用（通道无鉴权——§1.5 实测）
      return Promise.resolve({ status: 401 }) // 登录面：旧 token
    }
    const states = []
    const m = createConnMonitor({
      fetchImpl, eventsPath: 'plugins/events', probePath: '/',
      backoffStart: 10, backoffCap: 20, watchdog: false,
      onChange: (s) => states.push(s.state),
    })
    m.start()
    await sleep(120)
    assert.equal(m.state().state, 'rotated', `连续 401×3 → rotated（实际=${m.state().state} strikes=${m.state().strikes}）`)
    assert.equal(m.state().strikes, 3)
    const c0 = count
    await sleep(60)
    assert.equal(count, c0, 'rotated 后不再重试（旧 token 重试必败，§1.5）')
    assert.ok(states.includes('rotated'))
    m.stop()
  }
  // ── 场景 C：探测 2xx 清零 strikes（rotated 窗口之前的自愈路径；按探测计数翻转=时序无关）──
  {
    let probes = 0
    const fetchImpl = (url) => {
      if (String(url).includes('plugins/events')) return Promise.resolve({ ok: false, status: 200, body: null })
      probes++
      return Promise.resolve({ status: probes <= 2 ? 401 : 200 })
    }
    const m = createConnMonitor({
      fetchImpl, eventsPath: 'plugins/events', probePath: '/',
      backoffStart: 10, backoffCap: 20, watchdog: false,
    })
    m.start()
    await sleep(100)
    assert.equal(m.state().state, 'reconnecting', '2 次 401 不判 rotated（判据=连续 3 次）')
    assert.equal(m.state().strikes, 0, '登录面 2xx 清零 strikes')
    m.stop()
  }
  // ── 场景 D：连接稳态的登录面周期复检（§1.5 rotated 面完备性）——流面正常但鉴权失效 → rotated ──
  {
    let strikesSeen = 0
    const fetchImpl = (url) => {
      if (String(url).includes('plugins/events')) {
        // 流面持续供帧（活性恒常）
        return Promise.resolve({
          ok: true, status: 200,
          body: { getReader: () => ({ read: () => new Promise((r) => setTimeout(() => r({ done: false, value: new Uint8Array(1) }), 20)) }) },
        })
      }
      strikesSeen++
      return Promise.resolve({ status: 401 }) // 登录面：会话真失效
    }
    const m = createConnMonitor({
      fetchImpl, eventsPath: 'plugins/events', probePath: '/',
      freshMs: 60000, watchdogPeriod: 30, probeEveryMs: 30, // 复检节奏压短=确定性
      onChange: () => {},
    })
    m.start()
    await sleep(40)
    assert.equal(m.state().state, 'connected', '流面活性正常=connected')
    await sleep(200) // ≥3 次稳态复检全 401
    assert.equal(m.state().state, 'rotated', `稳态鉴权失效 ×3 → rotated（实际=${m.state().state} strikes=${m.state().strikes}）`)
    assert.ok(strikesSeen >= 3, '稳态复检发生')
    const s0 = m.state().strikes
    await sleep(100) // 终态观察窗：无鉴权流面持续供帧也不得回写 connected（rotated=页内终态）
    assert.equal(m.state().state, 'rotated', 'rotated 为终态——流面回升不得降级（E1 实测缺陷回归）')
    assert.equal(m.state().strikes, s0, 'strikes 冻结')
    m.stop()
  }
})

/** conn-monitor 独立模块加载（不经 bundle，直接源码求值）。 */
function monitorModule() {
  const src = readFileSync(join(PLUGIN, 'client/conn-monitor.js'), 'utf8')
  return new Function(`${src}\nreturn { createConnMonitor }`)()
}

test('css 作用域：全局选择器全部收进 .cc-app 容器，keyframes 全部 cc- 前缀', () => {
  const css = readFileSync(join(PLUGIN, 'client/console.css'), 'utf8')
  for (const line of css.split('\n')) {
    assert.ok(!/^:root/.test(line), `未作用域化的 :root：${line.slice(0, 40)}`)
    assert.ok(!/^body\b/.test(line), `未作用域化的 body：${line.slice(0, 40)}`)
    assert.ok(!/^html\b/.test(line), `未作用域化的 html：${line.slice(0, 40)}`)
    assert.ok(!/^a\b|^::|^a,/.test(line.replace(/^\.cc-app\s*/, '')) || /^\.cc-app/.test(line), `未作用域化的选择器：${line.slice(0, 40)}`)
  }
  for (const m of css.matchAll(/@keyframes\s+([a-z-]+)/g)) assert.ok(m[1].startsWith('cc-'), `keyframes 未加前缀：${m[1]}`)
  for (const m of css.matchAll(/animation:\s*([a-z-]+)/g)) assert.ok(m[1].startsWith('cc-'), `animation 引用未加前缀：${m[1]}`)
})

test('壳模板：连接态灯/细条节点在册 + 图标 id 全部 cc- 前缀（不与宿主 SVG 碰撞）', () => {
  const shellSrc = readFileSync(join(PLUGIN, 'client/console-shell.js'), 'utf8')
  for (const id of ['cc-conn-lamp', 'cc-conn-dot', 'cc-conn-strip', 'cc-conn-strip-text', 'cc-conn-strip-lamp', 'cc-conn-label']) {
    assert.ok(shellSrc.includes(id), `壳模板缺节点 ${id}`)
  }
  assert.ok(!/id="i-/.test(shellSrc), 'SVG symbol id 未加前缀')
  assert.ok(!/href="#i-/.test(shellSrc), 'SVG use 引用未加前缀')
  assert.ok(SRC.includes('plugins/events'), 'bundle 含流面通道地址（活性判定源）')
  assert.ok(SRC.includes('cc-conn-lamp'), 'bundle 内嵌壳含连接态灯节点')
  assert.ok(SRC.includes('.cc-app'), 'bundle 内嵌 css 已作用域化')
})
