// console 原生整合（console-adoption.md §1.23）：
// 九项经 dsh Slots 注册到宿主主侧栏；console 壳只保留内容区，不再拥有第二列导航。
// Welcome 与总览按 console-ui.md §11 A1 合并；已交付「需求提案」补足九项。
var CONSOLE_NAV = [
  { id: 'overview', panel: 'core-console-overview', label: '总览', route: '#/welcome', icon: 'home', segs: ['welcome', 'overview'] },
  { id: 'tree', panel: 'core-console-tree', label: '系统树', route: '#/tree', icon: 'tree', segs: ['tree', 's'] },
  { id: 'workflows', panel: 'core-console-workflows', label: 'Workflows', route: '#/workflows', icon: 'flow', segs: ['workflows', 'wf'] },
  { id: 'docs', panel: 'core-console-docs', label: '文档', route: '#/docs', icon: 'doc', segs: ['docs', 'doc', 'designdoc'] },
  { id: 'events', panel: 'core-console-events', label: '事件', route: '#/events', icon: 'pulse', segs: ['events', 'event'] },
  { id: 'approvals', panel: 'core-console-approvals', label: '审批', route: '#/approvals', icon: 'check', segs: ['approvals'] },
  { id: 'connectors', panel: 'core-console-connectors', label: '连接', route: '#/connectors', icon: 'plug', segs: ['connectors', 'connector', 'ws', 'provider', 'ref', 'role'] },
  { id: 'sessions', panel: 'core-console-sessions', label: '会话', route: '#/chat/root-agent', icon: 'chat', segs: ['chat', 'session', 'agent'] },
  { id: 'proposals', panel: 'core-console-proposals', label: '需求提案', route: '#/proposals', icon: 'spark', segs: ['proposals', 'proposal'] }
]

var CONSOLE_SEGS = [
  'welcome', 'overview', 'tree', 's', 'workflows', 'wf', 'docs', 'doc', 'designdoc',
  'chat', 'session', 'connectors', 'connector', 'ws', 'provider', 'ref', 'role',
  'agent', 'event', 'events', 'approvals', 'proposals', 'proposal', 'inbox'
]

function isConsoleHash(h) {
  if (typeof h !== 'string' || h.charAt(0) !== '#') return false
  var first = h.replace(/^#\/?/, '').split('/')[0]
  return first !== '' && CONSOLE_SEGS.indexOf(first) >= 0
}

function panelForHash(h) {
  if (!isConsoleHash(h)) return null
  var first = h.replace(/^#\/?/, '').split('/')[0]
  for (var i = 0; i < CONSOLE_NAV.length; i++) {
    if (CONSOLE_NAV[i].segs.indexOf(first) >= 0) return CONSOLE_NAV[i]
  }
  return CONSOLE_NAV[0]
}

var GLYPHS = {
  home: 'M2 8.5 8 3l6 5.5V14H9.5v-4h-3v4H2z',
  tree: 'M3 2v12M3 5h5M3 9h5M8 5v1.5M8 9v1.5M8 6.5h4M8 10.5h4',
  flow: 'M8 1.5v6M8 7.5H4v3M8 7.5h4v3M4 10.5v3h8v-3',
  doc: 'M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6 8h4.5M6 10.5h4.5',
  pulse: 'M1.5 8h3l2-5 3 10 2-5h3',
  check: 'M5 8.2 7.1 10.2 11.2 6M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z',
  plug: 'M5 1.5v3M11 1.5v3M4 4.5h8v3a4 4 0 0 1-8 0zM8 11.5v3',
  chat: 'M2 3.5h12v8H8l-3 3v-3H2zM5 6.5h6M5 8.8h4',
  spark: 'M8 1.5 9.6 6 14 8l-4.4 2L8 14.5 6.4 10 2 8l4.4-2z'
}

function approvalSnapshot() {
  return Number((typeof __CC !== 'undefined' && __CC.approvalCount) || 0)
}
function subscribeApprovals(cb) {
  if (typeof window === 'undefined' || !window.addEventListener) return function () {}
  window.addEventListener('cc-approvals', cb)
  return function () { window.removeEventListener('cc-approvals', cb) }
}

function ConsoleIcon(nav, props) {
  props = props || {}
  var s = props.size || 16
  var children = []
  // 宿主 wide 行请求 16px，collapsed rail 请求 18px；只在 wide 行显示分组标题。
  if (nav.id === 'overview' && s === 16) {
    children.push(React.createElement('span', {
      key: 'group', 'data-cc-sidebar-label': '核心控制台', role: 'heading', 'aria-level': 2
    }, '核心控制台'))
  }
  children.push(React.createElement('svg', {
    key: 'icon', width: s, height: s, viewBox: '0 0 16 16', 'aria-hidden': true,
    'data-cc-nav': nav.id,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round'
  }, React.createElement('path', { d: GLYPHS[nav.icon] || GLYPHS.home })))
  if (nav.id === 'approvals') {
    var count = React.useSyncExternalStore(subscribeApprovals, approvalSnapshot, approvalSnapshot)
    if (count > 0) children.push(React.createElement('span', {
      key: 'badge', 'data-cc-approval-badge': 'true', 'aria-label': count + ' 项待审批'
    }, count > 99 ? '99+' : String(count)))
  }
  return React.createElement(React.Fragment, null, children)
}

function makeConsoleIcon(nav) {
  return function ConsoleNavIcon(props) {
    return ConsoleIcon(nav, props)
  }
}

// ref 挂载点：React 只递容器，壳内由 proto 自治（挂载即引导，卸载即回收）。
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

function makeConsolePanel(nav) {
  return function ConsolePanel() {
    React.useEffect(function () {
      if (panelForHash(location.hash) !== nav) location.hash = nav.route
    }, [nav])
    return React.createElement('div', { className: 'cc-app cc-host', ref: consoleRef, style: { height: '100%' } })
  }
}

var CC_NATIVE_CSS = [
  '[data-cc-sidebar-label]{position:absolute;top:-30px;left:12px;color:var(--dsw-alias-label-tertiary);font:11px/16px var(--dsw-font-family);letter-spacing:.04em;pointer-events:none}',
  'nav:has([data-cc-sidebar-label]){padding-top:40px}',
  '[data-cc-approval-badge]{position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-on-color);font:11px/16px var(--dsw-font-family);text-align:center}',
  '@media(max-width:1199px){.cc-host .cc-narrow-menu{display:inline-flex!important}}'
].join('\n')

function ensureNativeStyle() {
  if (typeof document === 'undefined' || !document.head) return
  if (!document.getElementById('cc-native-style')) {
    var st = document.createElement('style')
    st.id = 'cc-native-style'
    st.textContent = CC_NATIVE_CSS
    document.head.appendChild(st)
  }
}

function syncNarrowSidebar(ctx) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.innerWidth < 1200 && !document.querySelector('[data-sidebar-collapsed]')) ctx.layout.toggleSidebar()
}

exports.inject = ['slots', 'layout']
exports.apply = function applyClient(ctx) {
  ensureNativeStyle()
  __CC.hostFaces = { layout: ctx.layout }
  __CC.toggleHostSidebar = function () { ctx.layout.toggleSidebar() }
  var onResize = function () { syncNarrowSidebar(ctx) }
  syncNarrowSidebar(ctx)
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', onResize)

  // 宿主能力回调式软出现：缺席不阻塞 console，chat/Workspace 面诚实降级。
  try {
    ctx.inject(['sessions'], function (sub) {
      __CC.chatFaces = { sessions: Reflect.get(sub, 'sessions') }
    })
  } catch (e) { /* 无会话面：chat 降级 */ }
  try {
    ctx.inject(['workspaces'], function (sub) {
      __CC.hostFaces.workspaces = Reflect.get(sub, 'workspaces')
      if (__CC.serviceProjects) __CC.serviceProjects.bind()
    })
  } catch (e) { /* 无 Workspace 面：Service project 降级 */ }
  try {
    ctx.inject(['webTerminals'], function (sub) {
      __CC.termFaces = { webTerminals: Reflect.get(sub, 'webTerminals') }
    })
  } catch (e) { /* 无终端面：roster 降级 */ }

  ctx.slots.inject('main', function* () {
    for (var i = 0; i < CONSOLE_NAV.length; i++) {
      yield ctx.slots.register({ name: 'main', key: CONSOLE_NAV[i].panel }, makeConsolePanel(CONSOLE_NAV[i]))
    }
    var target = panelForHash(location.hash)
    if (target && ctx.layout.panelInfo.getSnapshot().activePanelId !== target.panel) ctx.layout.selectPanel(target.panel)
    else if (!location.hash && ctx.layout.panelInfo.getSnapshot().activePanelId === null) ctx.layout.selectPanel(CONSOLE_NAV[0].panel)
  })

  ctx.slots.inject('sidebar.panellist', function* () {
    for (var j = 0; j < CONSOLE_NAV.length; j++) {
      var nav = CONSOLE_NAV[j]
      yield ctx.slots.register({ name: 'sidebar.panellist', id: nav.panel, order: 60 + j, label: nav.label }, makeConsoleIcon(nav))
    }
  })

  // hash 是 console 路由；跨分组深链时同步宿主选中态，刷新可恢复。
  if (typeof window !== 'undefined' && window.addEventListener) {
    var onHash = function () {
      var nav = panelForHash(location.hash)
      if (nav && ctx.layout.panelInfo.getSnapshot().activePanelId !== nav.panel) ctx.layout.selectPanel(nav.panel)
    }
    window.addEventListener('hashchange', onHash)
    if (typeof ctx.effect === 'function') ctx.effect(function () {
      return function () {
        window.removeEventListener('hashchange', onHash)
        window.removeEventListener('resize', onResize)
      }
    }, 'core-console:native-navigation')
  }
}
