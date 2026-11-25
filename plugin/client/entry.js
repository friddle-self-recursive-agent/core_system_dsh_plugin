// E1 slot 注册面（console-adoption.md §6 方向性风险的主案验证）：
//   顶层导航扩展位=dsh 0.2.2-rc.5 的 sidebar.panellist（列表，id ↔ main 面板键）+
//   main（keyed，key=面板 id，非 conversation 键无 Session 绑定）——注册该对=顶层导航+整页路由能力。
// 八入口不占八个 dsh 面板：console 壳自带侧栏（proto 同构，hash 路由在壳内），dsh 侧只加一枚
// 入口（id=core-console）。路由即状态（location.hash，dsh client 不占用 hash）——刷新恢复=
// 注册完成后按 hash 判定 selectPanel（深链可直发他人，console-ui.md 全局框架行）。
var PANEL_ID = 'core-console'

// console 全部 hash 路由首段（console-ui.md §proto 对应关系表；E1 起全部入此集）
var CONSOLE_SEGS = [
  'welcome', 'overview', 'tree', 's', 'workflows', 'wf', 'docs', 'doc', 'designdoc',
  'chat', 'session', 'connectors', 'connector', 'ws', 'provider', 'ref', 'role',
  'agent', 'event', 'events', 'approvals', 'proposals', 'proposal',
]

function isConsoleHash(h) {
  if (typeof h !== 'string' || h.charAt(0) !== '#') return false
  var first = h.replace(/^#\/?/, '').split('/')[0]
  return first !== '' && CONSOLE_SEGS.indexOf(first) >= 0
}

// 侧栏图标（dsh 侧栏拥有按钮/文案/选中态，本组件只给字形——PluginsPanelIcon 同构）
function ConsoleIcon(props) {
  props = props || {}
  var s = props.size || 16
  return React.createElement('svg', { width: s, height: s, viewBox: '0 0 16 16', 'aria-hidden': true },
    React.createElement('path', { d: 'M8 1.5 14.5 8 8 14.5 1.5 8z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
    React.createElement('path', { d: 'M8 5v6M5 8h6', stroke: 'currentColor', strokeWidth: 1.1 }))
}

// 主面板：ref 挂载点——React 只递容器，壳内由 proto 自治（挂载即引导，卸载即回收）
var ccDepth = 0
function consoleRef(node) {
  if (node) {
    ccDepth++
    if (ccDepth === 1) __CC.mountConsole(node)
  } else {
    ccDepth = Math.max(0, ccDepth - 1)
    if (ccDepth === 0) __CC.unmountConsole()
  }
}
function ConsolePanel() {
  // className=cc-app：作用域化 css 的挂载类（console.css 全部选择器收进 .cc-app，§1.6）
  return React.createElement('div', { className: 'cc-app cc-host', ref: consoleRef, style: { height: '100%' } })
}

exports.inject = ['slots', 'layout']
exports.apply = function applyClient(ctx) {
  // E5 会话数据面（console-adoption.md §1.11；§3.7 裁决：数据源=dsh session store 不复制状态）：
  // ctx.sessions=宿主会话清单/创建/prompt 真通路 + retain 持有的事件窗（转录活体源——
  // binding.eventSource，不触 remote.* 命名空间护栏：E5 探针实证 remote.session 未声明即访问抛错）。
  // faces 经回调式 inject 软出现（声明式 exports.inject 加名会让 apply 停等=面板缺席，E5 探针实证）；
  // 缺席宿主回调不启动=chat 屏 ready()=false 诚实降级（不冒充数据）。
  try {
    ctx.inject(['sessions'], function (sub) {
      __CC.chatFaces = { sessions: Reflect.get(sub, 'sessions') }
    })
  } catch (e) { /* 无 inject 能力的极简宿主：chat 降级 */ }
  try {
    // 终端 roster 面（可选能力）：回调式注入（缺席宿主回调不启动=roster 诚实空态）
    ctx.inject(['webTerminals'], function (sub) {
      __CC.termFaces = { webTerminals: Reflect.get(sub, 'webTerminals') }
    })
  } catch (e) { /* 同上：终端 roster 降级为诚实空态 */ }
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({ name: 'main', key: PANEL_ID }, ConsolePanel)
    // 刷新可恢复：hash 是 console 路由而宿主面板选择已回到会话 → 重选本面板（不整页刷新）
    if (isConsoleHash(location.hash) && ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID) {
      ctx.layout.selectPanel(PANEL_ID)
    }
  })
  ctx.slots.inject('sidebar.panellist', function* () {
    yield ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: 'core console' }, ConsoleIcon)
  })
}
