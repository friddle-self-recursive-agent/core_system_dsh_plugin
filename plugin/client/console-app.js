// console-proto app.js（整体内嵌起点代码）手术注记：M←__CC.MOCK；ROOT 容器纪律（$/委托/键盘收进容器）；监听与 boot 移入 mountConsole（可卸载）；连接态灯三色 UI 更新（§1.5）；图标 id 加 cc- 前缀
// E2 手术注记（console-adoption.md §1.8）：Welcome 大屏/系统树/系统详情/对象详情/事件详情五屏换 cored
// 读面真数据（__CC.live，经 /core-console/api 宿主代理只读 GET）；其余屏保持 proto mock 待各自 E 轮替换。
/* app.js — core console 原型逻辑（普通 script，无模块） */
(function () {
  'use strict';
  var M = __CC.MOCK;
  var LIVE = __CC.live; // E2 真数据层（console-live.js：cored 读面快照 + ensure/fetchObject）
  var SCN = __CC.scenario; // E7 场景面纯函数层（console-scenario.js：tag 现读/scope 匹配/游标合并/合成窗）
  var ROOT = null; // 容器根（挂载时由 mountConsole 指定；$/委托/键盘一律收进容器，不触宿主全局）

  /* ================= 全局状态 ================= */
  var S = {
    route: '',
    segs: [],
    drafts: {},          // docName -> {working, entries:[{source,summary,ts}], base}
    treeOpen: {},        // tree 节点展开态
    treeLoaded: {},      // 懒加载完成标记
    sysTab: {},          // system 详情当前 tab
    wfTab: {},           // workflow 详情当前 tab
    wfRunSel: {},        // workflow -> 选中运行 no
    chatUi: {},          // agent -> {sessionId, view:'chat'|'traj', tab:'chat'|'term', filter:'all', search:''}
    term: {},            // sessionId -> {lines:[], demoIdx, userMode}
    evFilter: { kinds: {}, level: "", range: "24h", q: "", lane: "" },
    evWin: {},           // E7 事件窗（'global' | 'sys:<name>' -> {rows, exhausted, busy}——until 游标已装更早页）
    evSyn: { on: false, n: 1200 }, // E7 合成压测窗（客户端合成展示层——不入归档不入聚合）
    docFilter: { tags: {}, kind: '', draft: '', q: '' },
    docTags: {},         // E7 tag 现读缓存（docKey@rv -> tags[]——渲染层缓存，读面权威不变）
    trFilter: { phase: '' },
    wImpLevel: 'all',
    follow: {},          // runKey -> bool
    timers: [],
    overlays: [],
    sideCollapsed: false,
    bootedChips: false
  };

  /* ================= 小工具 ================= */
  function $(sel, root) { return (root || ROOT).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || ROOT).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtTimeS(d) { return fmtTime(d) + ':' + pad(d.getSeconds()); }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtAgo(d) {
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return Math.max(1, s | 0) + 's 前';
    if (s < 3600) return (s / 60 | 0) + 'm 前';
    if (s < 86400) return (s / 3600 | 0) + 'h 前';
    return (s / 86400 | 0) + 'd 前';
  }
  function seeded(seedStr) {
    var a = 5381;
    for (var i = 0; i < seedStr.length; i++) a = ((a << 5) + a + seedStr.charCodeAt(i)) | 0;
    return M.meta.seeded.constructor ? (function (x) {
      return function () { x |= 0; x = x + 0x6D2B79F5 | 0; var t = Math.imul(x ^ x >>> 15, 1 | x); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    })(a) : Math.random;
  }
  function series24(key, base, amp) {
    var rnd = seeded('spark:' + key), out = [], v = base;
    for (var i = 0; i < 24; i++) { v = Math.max(0.05, base + (rnd() - 0.5) * amp); out.push(v); }
    return out;
  }
  function byId(arr, key, val) { for (var i = 0; i < arr.length; i++) if (arr[i][key] === val) return arr[i]; return null; }
  /* E7 收口清扫：sysByName/docByName/wfByName/agentByName/instByName/sysDocs/sysInstances/
   * sysAgents mock finder 摘除——渲染面读面化后零引用（场景面归属=inScopeObjects 同一口径）。 */
  /* E7 收口清扫：顶栏事件计数=归档窗实数（LIVE 快照 24h 过滤）——mock evCount24h 摘除 */
  function evCount24h() {
    var evs = (LIVE.state && LIVE.state.events) || [];
    return evs.filter(function (e) {
      var t = Date.parse(e.ts || '');
      return !isNaN(t) && (Date.now() - t) < 86400000;
    }).length;
  }
  /* E6 审批待审区（console-adoption.md §1.13）=草稿缓存 ∪ ApprovalNeeded 归档行——
   * 数据源=cored 读面（LIVE 快照；读面未装=空数组诚实，不读 mock）。 */
  function approvalNeededObjects() {
    var st = __CC.live ? __CC.live.state : null;
    var out = [];
    if (!st || st.status === 'idle') return out;
    (st.drafts || []).forEach(function (d) { out.push({ kind: 'draft', key: d.kind + '/' + (d.scope || '') + '/' + d.name, draft: d }); });
    var seen = {};
    (st.events || []).forEach(function (e) {
      if (e.type === 'ApprovalNeeded' && e.involved && !seen[e.involved]) { seen[e.involved] = 1; out.push({ kind: 'event', key: e.involved, event: e }); }
    });
    return out;
  }
  function pendingApprovals() { return approvalNeededObjects(); }
  /* E7 收口清扫：openDrifts/runningWfs/healthScore mock 聚合摘除（渲染面已归零——
   * liveHealth()=真数据聚合唯一口径）；addEvent mock 事件入栈摘除（审计账=cored 归档唯一权威）。 */
  function openDrifts() { return LIVE.refs('DriftReport'); }
  function runningWfs() { return []; }

  var PHASE_CLS = { InSync: 'ok', Drifting: 'warn', Remediating: 'acc', Failed: 'danger', Escalated: 'esc',
    Idle: 'mute', Analyzing: 'acc', Planning: 'acc', AwaitingApproval: 'warn', Executing: 'acc', Verifying: 'acc', Reporting: 'acc', Paused: 'warn', Ready: 'ok', Degraded: 'warn' };
  var PHASE_PULSE = { InSync: 'pulse-ok', Drifting: 'pulse-warn', Remediating: '', Failed: 'pulse-danger', Escalated: 'pulse-danger',
    Analyzing: '', Planning: '', Executing: '', Verifying: '', Reporting: '', AwaitingApproval: '' };
  function phaseChip(phase, lg) {
    var cls = PHASE_CLS[phase] || 'mute';
    var pulse = PHASE_PULSE[phase] || '';
    return '<span class="chip ' + cls + (lg ? ' lg' : '') + '"><span class="lamp ' + cls + ' ' + pulse + '"></span>' + esc(phase) + '</span>';
  }
  function statusChip(st) { return phaseChip(st); }
  function kindBadge(kind) { return '<span class="chip kind">' + esc(kind) + '</span>'; }
  function draftDot(has) { return has ? '<span class="draft-dot" title="有未 Apply 草稿">●</span>' : ''; }
  function kbd(k) { return '<span class="kbd">' + esc(k) + '</span>'; }
  function sparkSVG(key, color, w, h, threshold) {
    var pts = series24(key, 0.5, 0.55);
    var n = pts.length, min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var rng = (max - min) || 1;
    var step = (w - 4) / (n - 1);
    var d = pts.map(function (p, i) {
      var x = 2 + i * step, y = h - 3 - ((p - min) / rng) * (h - 8);
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var area = d + ' L' + (w - 2) + ',' + (h - 2) + ' L2,' + (h - 2) + ' Z';
    var thr = '';
    if (threshold != null) {
      var ty = h - 3 - ((threshold - min) / rng) * (h - 8);
      if (ty > 1 && ty < h - 1) thr = '<line x1="2" y1="' + ty.toFixed(1) + '" x2="' + (w - 2) + '" y2="' + ty.toFixed(1) + '" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>';
    }
    return '<svg class="metric-chart" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<path d="' + area + '" fill="' + color + '" opacity=".12"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5"/>' + thr + '</svg>';
  }
  function bigChart(key, threshold, w, h) {
    var pts = series24(key, 0.5, 0.5);
    var n = pts.length, min = Math.min.apply(null, pts) * 0.9, max = Math.max.apply(null, pts) * 1.08;
    var rng = (max - min) || 1, step = (w - 40) / (n - 1);
    var d = pts.map(function (p, i) {
      var x = 34 + i * step, y = h - 18 - ((p - min) / rng) * (h - 30);
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var ty = h - 18 - ((threshold - min) / rng) * (h - 30);
    var labels = '';
    for (var i = 0; i < 24; i += 6) {
      labels += '<text x="' + (34 + i * step) + '" y="' + (h - 4) + '" text-anchor="middle">' + (24 - i) + 'h前</text>';
    }
    var thrLine = (ty > 8 && ty < h - 14) ? '<line x1="30" y1="' + ty.toFixed(1) + '" x2="' + (w - 6) + '" y2="' + ty.toFixed(1) + '" stroke="#f59e0b" stroke-dasharray="4 3"/><text x="' + (w - 8) + '" y="' + (ty - 3).toFixed(1) + '" text-anchor="end" fill="#f59e0b">阈值 ' + esc(threshold) + '</text>' : '';
    var dots = pts.map(function (p, i) {
      var x = 34 + i * step, y = h - 18 - ((p - min) / rng) * (h - 30);
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2" fill="#3b82f6"/>';
    }).join('');
    return '<svg class="metric-chart" width="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="height:' + h + 'px">' +
      '<line x1="30" y1="' + (h - 18) + '" x2="' + (w - 6) + '" y2="' + (h - 18) + '" stroke="#1e2530"/>' + thrLine +
      '<path d="' + d + '" fill="none" stroke="#3b82f6" stroke-width="1.6"/>' + dots + labels + '</svg>';
  }

  /* ================= 行级 diff（LCS 简化） ================= */
  function diffLines(oldStr, newStr) {
    var a = (oldStr || '').split('\n'), b = (newStr || '').split('\n');
    var n = a.length, m = b.length;
    // LCS DP（文档规模小，可接受）
    var lcs = [], i, j;
    for (i = 0; i <= n; i++) { lcs.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    var out = [], x = 0, y = 0;
    function ctx() { // 吸附 1 行上下文
      if (out.length && out[out.length - 1].t === 'ctx' && out[out.length - 1].gap) return;
      if (x < n) { out.push({ t: 'ctx', s: a[x], gap: true }); x++; }
    }
    var need = [];
    while (x < n && y < m) {
      if (a[x] === b[y]) { need.push({ t: ' ', s: a[x] }); x++; y++; }
      else if (lcs[x + 1][y] >= lcs[x][y + 1]) { need.push({ t: '-', s: a[x] }); x++; }
      else { need.push({ t: '+', s: b[y] }); y++; }
    }
    while (x < n) { need.push({ t: '-', s: a[x] }); x++; }
    while (y < m) { need.push({ t: '+', s: b[y] }); y++; }
    // 压缩：只保留变更块 ±2 行上下文
    var keep = new Array(need.length).fill(false);
    for (i = 0; i < need.length; i++) {
      if (need[i].t !== ' ') { for (j = Math.max(0, i - 2); j <= Math.min(need.length - 1, i + 2); j++) keep[j] = true; }
    }
    var lastKept = -3;
    for (i = 0; i < need.length; i++) {
      if (keep[i]) {
        if (i - lastKept > 1 && need[i].t === ' ') out.push({ t: 'gap', s: '⋯' });
        out.push(need[i]); lastKept = i;
      }
    }
    if (!out.length) out.push({ t: 'ctx', s: '（无差异）' });
    return out;
  }
  function renderDiff(lines, maxLines) {
    var html = lines.slice(0, maxLines || 200).map(function (l) {
      if (l.t === 'gap') return '<div class="diff-line ctx">   ⋯</div>';
      var sign = l.t === '+' ? '+' : l.t === '-' ? '-' : ' ';
      return '<div class="diff-line ' + (l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx') + '"><span class="d-sign">' + sign + '</span>' + esc(l.s) + '</div>';
    }).join('');
    if (lines.length > (maxLines || 200)) html += '<div class="diff-line ctx">… 共 ' + lines.length + ' 行差异</div>';
    return '<div class="diff">' + html + '</div>';
  }
  function diffStats(lines) {
    var add = 0, del = 0;
    lines.forEach(function (l) { if (l.t === '+') add++; else if (l.t === '-') del++; });
    return { add: add, del: del };
  }

  /* ================= 草稿 / Apply 引擎 ================= */
  /* E7 收口清扫：docState mock 草稿引擎摘除；docHasDraft=草稿缓存（/v1/drafts）按名命中
   * （真数据源——palette 草稿圆点与场景面文档行同一判据）。 */
  function docHasDraft(name) {
    var drafts = (LIVE.state && LIVE.state.drafts) || [];
    for (var i = 0; i < drafts.length; i++) if (drafts[i].name === name) return true;
    return false;
  }
  /* E7 收口清扫：addEvent mock 事件入栈与 healthScore mock 聚合摘除——事件唯一来源=
   * cored /v1/events 归档（审计账保真，客户端不造事件；合成压测窗走 SCN.synEvents 展示层
   * 专用通道）；健康聚合唯一口径=liveHealth()（真数据）。 */
  /* ================= 路由 ================= */
  var ROUTES = [];
  function route(pattern, fn) { ROUTES.push({ segs: pattern.split('/'), fn: fn }); }
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    h = h.split('?')[0];
    return h === '' ? [] : h.split('/').map(decodeURIComponent);
  }
  function go(path) {
    var h = '#/' + String(path).replace(/^\/+/, '');
    if (h === location.hash) { render(); } else location.hash = h;
  }
  function matchRoute(segs) {
    for (var i = 0; i < ROUTES.length; i++) {
      var r = ROUTES[i];
      if (r.segs.length !== segs.length) continue;
      var p = {}, ok = true;
      for (var j = 0; j < segs.length; j++) {
        var pat = r.segs[j];
        if (pat.charAt(0) === ':') p[pat.slice(1)] = segs[j];
        else if (pat !== segs[j]) { ok = false; break; }
      }
      if (ok) { p.route = r.segs[0]; return { fn: r.fn, params: p }; }
    }
    return null;
  }

  /* ================= 事件委托 ================= */
  var ACTIONS = {};
    function bindDelegation() {
    ROOT.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var fn = ACTIONS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  
    });
  }
  ACTIONS.go = function (el) { go(el.dataset.go); };
  ACTIONS['stop'] = function () {};

  /* ================= 浮层栈（共用模态裁决 Esc 并恢复焦点） ================= */
  function pushOverlay(o) {
    o.prevFocus = document.activeElement;
    S.overlays.push(o);
    var host = $('#' + o.host);
    host.hidden = false;
    if (o.mount) o.mount();
    var f = host.querySelector('input,textarea,button');
    if (f) f.focus();
  }
  function closeOverlay(id) {
    for (var i = S.overlays.length - 1; i >= 0; i--) {
      if (!id || S.overlays[i].id === id) {
        var o = S.overlays[i];
        S.overlays.splice(i, 1);
        var host = $('#' + o.host);
        if (host) host.hidden = true;
        if (o.unmount) o.unmount();
        if (o.prevFocus && o.prevFocus.focus) o.prevFocus.focus();
        return o;
      }
    }
    return null;
  }
  function topOverlay() { return S.overlays.length ? S.overlays[S.overlays.length - 1] : null; }
  function closeTopOverlay() {
    var t = topOverlay();
    if (t) { closeOverlay(t.id); return true; }
    if (S.drawerOpen) { closeDrawer(); return true; }
    return false;
  }

  /* ================= modal / drawer / toast ================= */
  function openModal(html, opts) {
    opts = opts || {};
    closeOverlay('modal');
    $('#modal-root').innerHTML = '<div class="modal ' + (opts.cls || '') + '">' + html + '</div>';
    pushOverlay({ id: 'modal', host: 'overlay-modal' });
    return $('#modal-root');
  }
  function closeModal() { closeOverlay('modal'); }
  ACTIONS['close-modal'] = function () { closeModal(); };
  var drawerKey = null;
  function openDrawer(html, key) {
    drawerKey = key || 'drawer';
    closeDrawer(true);
    $('#drawer-root').innerHTML = '<div class="drawer-wrap"><div class="drawer-mask" data-act="close-drawer"></div><div class="drawer">' + html + '</div></div>';
    S.drawerOpen = true;
  }
  function closeDrawer(silent) {
    if (!S.drawerOpen) return;
    $('#drawer-root').innerHTML = '';
    S.drawerOpen = false;
    drawerKey = null;
    if (!silent) stopFollowTimers();
  }
  ACTIONS['close-drawer'] = function () { closeDrawer(); };
  function toast(msg, sub, type) {
    var stack = $('#toast-stack');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = '<div class="t-msg">' + esc(msg) + '</div>' + (sub ? '<div class="t-sub">' + esc(sub) + '</div>' : '');
    stack.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3400);
    setTimeout(function () { el.remove(); }, 3800);
  }
  function confirmModal(title, bodyHtml, okLabel, onOk, danger) {
    openModal(
      '<div class="modal-h"><span class="m-title">' + esc(title) + '</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b">' + bodyHtml + '</div>' +
      '<div class="modal-f"><button class="btn" data-act="close-modal">取消</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" id="cm-ok">' + esc(okLabel) + '</button></div>',
      { cls: 'narrow' });
    $('#cm-ok').addEventListener('click', function () { closeModal(); onOk(); });
  }

  /* ================= follow / 计时器管理 ================= */
  function addTimer(fn, ms) { var t = setTimeout(fn, ms); S.timers.push(t); return t; }
  function addInterval(fn, ms) { var t = setInterval(fn, ms); S.timers.push(t); return t; }
  function clearTimers() { S.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); S.timers = []; }
  function stopFollowTimers() { S.followTimers && S.followTimers.forEach(function (t) { clearInterval(t); }); S.followTimers = []; }

  /* ================= 命令面板 ================= */
  function palItems(q) {
    var items = [];
    function add(sec, label, sub, go_, icon) { items.push({ sec: sec, label: label, sub: sub || '', go: go_, icon: icon || 'i-chev' }); }
    // 快捷动作
    add('动作', '手动触发一轮（core-workflow）', 'manual tick', 'act:tick', 'i-refresh');
    add('动作', '新建 Goal', 'global scope 草稿', 'act:newgoal', 'i-plus');
    var rootAgent = liveChatAgents()[0] || 'core-headless'; // 文档面在册 agent（缺省=builtin root 名）
    add('动作', '与 root（' + rootAgent + '）对话', '#/chat/' + rootAgent, 'chat/' + rootAgent, 'i-chat');
    add('动作', '打开审批页', pendingApprovals().length + ' 条待审', 'approvals', 'i-check');
    add('动作', '打开事件流', (liveHealth().events24) + ' events/24h（归档窗）', 'events', 'i-pulse');
    // 导航
    M.nav.forEach(function (n) { add('导航', n.label, navRouteOf(n.route), navRouteOf(n.route).replace('#/', ''), n.icon); });
    // 系统（E7 收口清扫：读面枚举——M 静态锚摘除，M 名落空路由不再出现）
    LIVE.refs('ServiceDesc').forEach(function (s) { add('系统', s.name, 'ServiceDesc · r' + s.resourceVersion, 's/' + s.name, 'i-grid'); });
    // workflows（E3 聚合面真数据；读面未装=不列 mock——palette 诚实缩容）
    (LIVE.state.wfAgg && LIVE.state.wfAgg.workflows ? LIVE.state.wfAgg.workflows : []).forEach(function (w) {
      add('Workflows', w.name, (w.effective ? 'effective' : 'absent') + ' · ' + (w.runsTotal || 0) + ' runs', 'wf/' + w.name, 'i-flow');
    });
    // agents（E5 起文档面真数据；M.agents mock 行摘除——对话入口=chat/<agent>）
    liveChatAgents().forEach(function (a) { add('Agents', a, 'Agent@文档面 · 对话入口', 'chat/' + a, 'i-bot'); });
    // connectors（E6 真数据：cored objects 枚举；读面未装=不列 mock——palette 诚实缩容）
    (LIVE.state.kinds.length ? LIVE.refs('WorkService') : []).forEach(function (w) { add('连接', w.name, 'WorkService · r' + w.resourceVersion, 'ws/' + w.name, 'i-plug'); });
    (LIVE.state.kinds.length ? LIVE.refs('ConnectorOps') : []).forEach(function (c) { add('连接', c.name, 'ConnectorOps · r' + c.resourceVersion, 'connector/' + c.name, 'i-plug'); });
    (LIVE.state.kinds.length ? LIVE.refs('Provider') : []).forEach(function (p) { add('连接', p.name, 'Provider · r' + p.resourceVersion, 'provider/' + p.name, 'i-key'); });
    // docs（E7：读面对象枚举——模糊搜索=名称/kind/scope；草稿圆点=草稿缓存）
    var ql = (q || '').toLowerCase();
    var docs = [];
    LIVE.state.kinds.forEach(function (kd) { (LIVE.refs(kd.name) || []).forEach(function (o) { docs.push({ name: o.name, kind: o.kind, scope: o.scope || '', rv: o.resourceVersion }); }); });
    if (ql) docs = fuzzyFilter(docs, ql, function (d) { return d.name + ' ' + d.kind + ' ' + d.scope; });
    docs.slice(0, 30).forEach(function (d) {
      add('文档', d.name, d.kind + ' r' + d.rv + (docHasDraft(d.name) ? ' ●draft' : ''), 'doc/' + encodeURIComponent(d.kind) + '/' + encodeURIComponent(d.scope) + '/' + encodeURIComponent(d.name), 'i-doc');
    });
    // 运行轮次（E7：runs 面投影——M 假轮次摘除）
    var runs = (LIVE.state.runs || []).slice(0, 8);
    if (ql) runs = fuzzyFilter(runs, ql, function (x) { return (x.workflow || '') + ' #' + (x.run || x.triggerSeq || ''); });
    runs.slice(0, 8).forEach(function (x) {
      var no = x.run || x.triggerSeq || '';
      add('运行轮次', '#' + no + ' · ' + (x.workflow || 'core-workflow'), (x.status || '') + (x.phase ? ' · ' + x.phase : ''), 'wf/' + encodeURIComponent(x.workflow || 'core-workflow') + '/r/' + no, 'i-clock');
    });
    if (!ql) return items.filter(function (it, i) { return i < 14; });
    return fuzzyFilter(items, ql, function (it) { return it.label + ' ' + it.sec + ' ' + it.sub; }).slice(0, 24);
  }
  function fuzzyFilter(arr, q, getText) {
    var ql = q.toLowerCase();
    return arr.map(function (x) {
      var t = getText(x).toLowerCase();
      var score = 0, ti = 0;
      for (var i = 0; i < ql.length; i++) {
        var idx = t.indexOf(ql[i], ti);
        if (idx < 0) return null;
        score += (idx === ti ? 2 : 1); ti = idx + 1;
      }
      if (t.indexOf(ql) >= 0) score += 20;
      return { x: x, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).map(function (v) { return v.x; });
  }
  var palSel = 0, palShown = [];
  function openPalette() {
    closeOverlay('palette');
    $('#overlay-palette').classList.add('pal-open');
    pushOverlay({
      id: 'palette', host: 'overlay-palette',
      mount: function () { $('#pal-input').value = ''; palSel = 0; renderPalList(''); },
      unmount: function () { $('#overlay-palette').classList.remove('pal-open'); }
    });
  }
  function renderPalList(q) {
    palShown = palItems(q);
    var sec = '', html = '';
    palShown.forEach(function (it, i) {
      if (it.sec !== sec) { sec = it.sec; html += '<div class="pal-sec">' + esc(sec) + '</div>'; }
      html += '<div class="pal-item' + (i === palSel ? ' sel' : '') + '" data-act="pal-pick" data-i="' + i + '">' +
        '<svg class="ic"><use href="#' + it.icon + '"/></svg><span class="pi-label">' + esc(it.label) + '</span>' +
        '<span class="pi-sub">' + esc(it.sub) + '</span></div>';
    });
    if (!palShown.length) html = '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">无匹配项</div><div>换个关键词试试</div></div>';
    $('#pal-list').innerHTML = html;
  }
  function palPick(i) {
    var it = palShown[i];
    if (!it) return;
    closeOverlay('palette');
    if (it.go.indexOf('act:') === 0) {
      if (it.go === 'act:tick') manualTick();
      if (it.go === 'act:newgoal') newGoalDraft('global');
    } else go(it.go);
  }
  ACTIONS['pal-pick'] = function (el) { palPick(parseInt(el.dataset.i, 10)); };
  ACTIONS['open-palette'] = function () { openPalette(); };
  /* E7 收口清扫：manual tick=诚实提示（触发面=cored 写面余量——不画假回执不推 mock 事件库） */
  function manualTick() {
    toast('手动触发=触发面余量', '写路径唯一入口=POST /v1/apply（--allow-apply）；触发执行面=cored 触发器接线（declared 余量）——不画假回执', 'warn');
  }
  ACTIONS['manual-tick'] = function () { manualTick(); };
  /* E7 收口清扫：新建 Goal=诚实提示（新建=落稿经 Apply；编辑器 new-draft 模式=declared 余量——
   * 不推 mock 文档库不发假 toast）。 */
  function newGoalDraft() {
    toast('新建文档=declared 余量', '草稿通道挂在既有对象上（编辑器→草稿→Apply）；新建对象稿模式未接线——不画假草稿', 'warn');
  }
  ACTIONS['new-goal'] = function () { newGoalDraft(); };

  /* ================= 快捷键注册表 ================= */
  var SHORTCUTS = [
    { keys: ['⌘', 'K'], label: '命令面板', when: '全局', handler: function () { openPalette(); } },
    { keys: ['?'], label: '快捷键速查表', when: '全局（非输入框）', handler: function () { openCheatsheet(); } },
    { keys: ['Esc'], label: '关闭顶层浮层（面板/弹窗/抽屉，逐层退出并还焦点）', when: '全局' },
    { keys: ['['], label: '折叠 / 展开侧栏', when: '全局（非输入框）', handler: function () { toggleSide(); } },
    { keys: ['N'], label: '新建 Goal（草稿，Apply 后落库）', when: '全局（非输入框）', handler: function () { newGoalDraft('global'); } },
    { keys: ['T'], label: '手动触发一轮对账（=入队 toast）', when: '全局（非输入框）', handler: function () { manualTick(); } },
    { keys: ['C'], label: '与 root 对话', when: '全局（非输入框）', handler: function () { go('chat/' + (liveChatAgents()[0] || 'core-headless')); } },
    { keys: ['W'], label: '回到 Welcome 大屏', when: '全局（非输入框）', handler: function () { go('welcome'); } },
    { keys: ['E'], label: '打开事件流', when: '全局（非输入框）', handler: function () { go('events'); } },
    { keys: ['A'], label: '打开审批页', when: '全局（非输入框）', handler: function () { go('approvals'); } },
    { keys: ['↑', '↓', 'Enter'], label: '命令面板选择 / 确认', when: '命令面板' },
    { keys: ['Enter'], label: '发送消息', when: '对话输入框' }
  ];
  function isTypingTarget(t) {
    if (!t) return false;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
    return !!(t.closest && (t.closest('.term') || t.closest('.chat-input-wrap')));
  }
  function openCheatsheet() {
    var rows = SHORTCUTS.map(function (s) {
      return '<div class="keys-row"><span class="kr-desc">' + esc(s.label) + '<span class="faint small"> · ' + esc(s.when) + '</span></span><span class="kr-keys">' + s.keys.map(kbd).join('') + '</span></div>';
    }).join('');
    openModal(
      '<div class="modal-h"><span class="m-title">快捷键速查</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b"><div class="keys-grid">' + rows + '</div>' +
      '<div class="hr"></div><div class="small faint">共用模态组件裁决顶层 Esc：面板 → 弹窗 → 抽屉逐层关闭，并恢复焦点。</div></div>',
      { cls: '' });
  }
  ACTIONS['open-cheatsheet'] = function () { openCheatsheet(); };
    function bindKeys() {
    ROOT.addEventListener('keydown', function (e) {
    // 命令面板键盘
    var palOpen = topOverlay() && topOverlay().id === 'palette';
    if (palOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palShown.length - 1, palSel + 1); renderPalList($('#pal-input').value); scrollPalSel(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); renderPalList($('#pal-input').value); scrollPalSel(); return; }
      if (e.key === 'Enter') { e.preventDefault(); palPick(palSel); return; }
    }
    if (e.key === 'Escape') { if (closeTopOverlay()) e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
    if (isTypingTarget(e.target)) return;
    if (e.key === '?') { e.preventDefault(); openCheatsheet(); return; }
    var map = { '[': function () { toggleSide(); }, 'n': function () { newGoalDraft('global'); }, 'N': function () { newGoalDraft('global'); },
      't': manualTick, 'T': manualTick, 'c': function () { go('chat/' + (liveChatAgents()[0] || 'core-headless')); }, 'C': function () { go('chat/' + (liveChatAgents()[0] || 'core-headless')); },
      'w': function () { go('welcome'); }, 'W': function () { go('welcome'); },
      'e': function () { go('events'); }, 'E': function () { go('events'); },
      'a': function () { go('approvals'); }, 'A': function () { go('approvals'); } };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  
    });
  }
  function scrollPalSel() {
    var sel = $('#pal-list .pal-item.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  /* ================= 虚拟滚动 ================= */
  /* opts（E7 大列表）：{onLoadMore: () => Promise<bool>（近底加载更早一页，返回 true=有追加需重绘）,
   *                      exhausted: () => bool（游标到底=不再触发）}——常量行高虚拟列表组件本体不变。 */
  function vlist(container, items, rowH, rowHtml, opts) {
    var H = Math.min(items.length * rowH, 560);
    container.style.height = H + 'px';
    container.classList.add('vlist');
    function paint() {
      var st = container.scrollTop;
      var vh = container.clientHeight;
      var start = Math.max(0, Math.floor(st / rowH) - 6);
      var end = Math.min(items.length, Math.ceil((st + vh) / rowH) + 6);
      var buf = '<div class="vlist-canvas" style="height:' + (items.length * rowH) + 'px">';
      for (var i = start; i < end; i++) {
        buf += '<div class="vrow" style="top:' + (i * rowH) + 'px;height:' + rowH + 'px;position:absolute;left:0;right:0">' + rowHtml(items[i], i) + '</div>';
      }
      buf += '</div>';
      container.innerHTML = buf;
    }
    var raf = null;
    var moreBusy = false;
    container.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; paint(); });
      if (opts && typeof opts.onLoadMore === 'function' && !moreBusy &&
          !(opts.exhausted && opts.exhausted()) &&
          container.scrollTop + container.clientHeight >= items.length * rowH - 240) {
        moreBusy = true;
        Promise.resolve(opts.onLoadMore()).then(function (appended) {
          moreBusy = false;
          if (appended) paint();
        }, function () { moreBusy = false; });
      }
    });
    paint();
    return { repaint: paint };
  }

  /* ================= 侧栏 / 顶栏 / 布局渲染 ================= */
  function toggleSide() {
    S.sideCollapsed = !S.sideCollapsed;
    $('#app').classList.toggle('side-collapsed', S.sideCollapsed);
  }
  ACTIONS['toggle-side'] = function () { toggleSide(); };
  function navRouteOf(route) {
    // 会话导航锚动态解析：文档面在册 agent（mock 数据文件的静态锚不落真名——R-PUB 同款纪律的部署侧变体）
    var r = String(route || '');
    if (r === '#/chat/root-agent') {
      var a = liveChatAgents()[0];
      if (a) return '#/chat/' + a;
    }
    return r;
  }
  function renderNav() {
    var pend = pendingApprovals().length;
    var html = '';
    M.nav.forEach(function (n) {
      var nroute = navRouteOf(n.route);
      html += '<div class="nav-item' + (navActive(n) ? ' active' : '') + '" data-act="go" data-go="' + nroute.replace('#/', '') + '" title="' + esc(n.label) + '">' +
        '<svg class="ic"><use href="#cc-i-' + n.icon + '"/></svg><span class="nav-label">' + esc(n.label) + '</span>' +
        (n.badge === 'approvals' && pend > 0 ? '<span class="nav-badge" id="nav-ap-badge">' + pend + '</span>' : '') + '</div>';
    });
    $('#side-nav').innerHTML = html;
  }
  function navActive(n) {
    var segs = S.segs;
    var id = n.id;
    if (id === 'welcome') return S.route === 'welcome';
    if (id === 'overview') return S.route === 'overview';
    if (id === 'tree') return S.route === 'tree';
    if (id === 'workflows') return S.route === 'workflows' || S.route === 'wf' || S.route === 'wf-run';
    if (id === 'docs') return S.route === 'docs' || S.route === 'doc';
    if (id === 'events') return S.route === 'events' || S.route === 'event';
    if (id === 'approvals') return S.route === 'approvals';
    if (id === 'proposals') return S.route === 'proposals' || S.route === 'proposal';
    if (id === 'connectors') return ['connectors', 'connector', 'ws', 'provider', 'ref'].indexOf(S.route) >= 0;
    if (id === 'chat-root') return S.route === 'chat';
    return false;
  }
  function updateCounters() {
    var pend = pendingApprovals().length;
    var b = $('#bell-badge');
    if (b) { b.textContent = pend; b.classList.toggle('hidden', pend === 0); }
    var ec = $('#ev-count');
    if (ec) ec.innerHTML = '<b>' + evCount24h() + '</b> events · 24h';
  }
  function setCrumbs(items) {
    var html = '';
    items.forEach(function (c, i) {
      if (i) html += '<span class="crumb-sep">›</span>';
      html += c.go ? '<span class="crumb" data-act="go" data-go="' + esc(c.go) + '">' + esc(c.label) + '</span>' : '<span class="crumb here">' + esc(c.label) + '</span>';
    });
    $('#crumbs').innerHTML = html;
  }

  /* ================= 主渲染 ================= */
  var CURRENT_SCREEN = null;
  function render() {
    clearTimers();
    stopFollowTimers();
    var segs = parseHash();
    if (!segs.length) { location.replace('#/welcome'); return; }
    var m = matchRoute(segs);
    var view = $('#view');
    if (!m) {
      S.route = '404'; S.segs = segs;
      view.innerHTML = '<div class="view-inner"><div class="empty" style="padding-top:12vh"><svg class="ic"><use href="#cc-i-warn"/></svg><div class="e-title">未知路由</div><div class="mono">' + esc('#/' + segs.join('/')) + '</div><div class="e-act"><button class="btn primary" data-act="go" data-go="welcome">回 Welcome</button></div></div></div>';
      setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '404' }]);
      renderNav(); updateCounters();
      return;
    }
    S.route = m.params.route;
    S.segs = segs;
    S.params = m.params;
    view.innerHTML = '';
    m.fn(view);
    renderNav(); updateCounters();
    view.scrollTop = 0;
  }
  /* ================= 屏 0：Welcome 大屏（E2：cored 读面真数据，console-ui.md 屏幕 0） =================
   * 数据来源（无双源红线）：系统/实例=cored 对象枚举（scheme/objects）；阶段条=run 投影；
   * 重要事件=event_log 归档（/v1/events）；草稿=草稿缓存清单。健康度合成口径写进 tooltip
   * ——大数字不许是无出处黑盒。读面未就绪=骨架行（§1.4：不白屏不报错块）。 */
  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return '夜深了，root';
    if (h < 11) return '早上好，root';
    if (h < 14) return '中午好，root';
    if (h < 19) return '下午好，root';
    return '晚上好，root';
  }
  function liveSkeletonRows(n, pad) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<div class="skel-row" style="padding:6px ' + (pad || 16) + 'px"><div class="skel" style="width:' +
        (140 + (i % 3) * 60) + 'px"></div><div class="skel" style="width:60px"></div></div>';
    }
    return out;
  }
  function liveDegradedNote() {
    return '<div class="small faint" style="padding:8px 16px">cored 读面暂不可达（' + esc(LIVE.state.err || '未就绪') +
      '）——保留骨架，恢复后自动整装替换（连接态灯见右下）</div>';
  }
  function liveHealth() {
    var st = LIVE.state;
    var systems = LIVE.refs('ServiceDesc');
    var instances = LIVE.refs('ServiceInstance');
    var drifts = LIVE.refs('DriftReport');
    var events24 = st.events.filter(function (e) {
      var t = Date.parse(e.ts);
      return !isNaN(t) && (Date.now() - t) < 86400000;
    }).length;
    var approvals = st.events.filter(function (e) { return e.type === 'ApprovalNeeded'; }).length;
    var started = (st.runMeta && st.runMeta.started) || 0;
    var failed = st.runs.filter(function (r) { return r.status === 'failed'; }).length;
    // InSync 率=phase=InSync 实例占比（console-ui.md 屏幕 0 口径的落地投影：instance status
    // 回写在正文，live 层逐个现读——现势 0 实例=n/a，tooltip 给构成不冒充 100%）。
    var insyncCount = instances.filter(function (o) {
      return (st.instanceStatus[o.kind + '/' + o.scope + '/' + o.name] || {}).phase === 'InSync';
    }).length;
    return {
      systems: systems, instances: instances, insyncCount: insyncCount, drifts: drifts.length, events24: events24,
      approvals: approvals, started: started, failed: failed,
      failedRate: started ? Math.round(failed / started * 100) : null,
      truncated: st.events.length >= 500 // 归档窗满窗标记（E7 起窗=500 收敛口径——until 游标可再装更早页）
    };
  }
  function welcomeStageStrip() {
    // dev-delivery 阶段条（console-ui.md 屏幕 0）：run 投影的相位落点→阶段态。run=触发面
    // 受理投影（status: triggered|running|suspended|failed），非终态推进不冒充执行完毕。
    var run = LIVE.state.runs.filter(function (r) { return r.workflow === 'dev-delivery'; })[0] || null;
    var stages = [
      { id: 'trigger', label: '触发' }, { id: 'analyze', label: 'Analyze' }, { id: 'gate', label: 'Gate' },
      { id: 'plan', label: 'Plan' }, { id: 'execute', label: 'Execute' }, { id: 'verify', label: 'Verify' },
      { id: 'deploy', label: 'Deploy' }, { id: 'report', label: 'Report' }
    ];
    var phaseMap = { Analyzing: 'analyze', AwaitingApproval: 'gate', Planning: 'plan', Executing: 'execute',
      Verifying: 'verify', Deploying: 'deploy', Reporting: 'report' };
    var curId = run ? (phaseMap[run.phase] || null) : null;
    var curIdx = stages.findIndex(function (s) { return s.id === curId; });
    var failed = !!run && run.status === 'failed';
    var suspended = !!run && run.status === 'suspended';
    var shown = stages.map(function (st, i) {
      var state = 'wait';
      if (curIdx >= 0) state = i < curIdx ? 'done' : i === curIdx ? (failed ? 'bad' : 'current') : 'wait';
      if (st.id === 'trigger' && curIdx >= 0 && !failed) state = 'done';
      var note = '—';
      if (run) {
        if (st.id === curId) note = failed ? '失败' : suspended ? '等待批准' : '进行中';
        else if (state === 'done') note = '已过';
      }
      return { id: st.id, label: st.label, state: state, note: note };
    });
    return { run: run, stages: shown, suspended: suspended };
  }
  function welcomeBizTitle(e) {
    // 业务化标题=展示层生成（console-ui.md 屏幕 0：不入库为准）
    var involved = e.involved || '';
    switch (e.type) {
      case 'ApprovalNeeded': return '有审批在等你：' + involved;
      case 'Escalate': return '升级上报：' + involved;
      case 'DocApplied': return '文档落库：' + involved;
      case 'HeartbeatLost': return '心跳丢失：' + involved;
      case 'MetricThreshold': return '指标越线：' + involved;
      case 'ExternalChanged': return '外部变化：' + involved;
      case 'ReconcileTick': return '定时巡检一轮';
      default: return e.type + (involved ? '：' + involved : '');
    }
  }
  function screenWelcome(view) {
    LIVE.ensure();
    var st = LIVE.state;
    setCrumbs([{ label: 'Welcome' }]);
    var h = liveHealth();
    var cells = h.systems.map(function (s) {
      return '<div class="w-insync-cell lit-ok" data-act="go" data-go="s/' + esc(s.name) +
        '" title="' + esc(s.name + ' · ServiceDesc r' + s.resourceVersion) + '"><span class="cell-tip">' + esc(s.name) + '</span></div>';
    }).join('');
    var insyncPct = h.instances.length
      ? Math.round(h.insyncCount / h.instances.length * 100) + '%'
      : '—';
    var strip = welcomeStageStrip();
    var stagesHtml = strip.stages.map(function (sg) {
      var dot = sg.state === 'done' ? '✓' : (sg.state === 'bad' ? '!' : sg.label.charAt(0));
      return '<div class="w-stage ' + sg.state + '" data-act="go" data-go="wf/dev-delivery" title="跳转 dev-delivery（对象详情；运行管理 E3 落地）">' +
        '<div class="w-stage-dot">' + dot + '</div><div class="ws-name">' + esc(sg.label) + '</div>' +
        '<div class="ws-sub">' + esc(sg.note) + '</div></div>';
    }).join('');
    var svcHtml = h.systems.map(function (s) {
      var inScope = function (k) { return LIVE.refs(k).filter(function (o) { return o.scope === s.name || o.scope === 'systems/' + s.name; }); };
      var wfs = inScope('Workflow').length;
      var docs = 0;
      LIVE.state.kinds.forEach(function (kd) {
        if (kd.name === 'ServiceDesc') return;
        docs += inScope(kd.name).length;
      });
      return '<div class="w-svc" data-act="go" data-go="s/' + esc(s.name) + '">' +
        '<span class="lamp ok" style="width:10px;height:10px"></span>' +
        '<div class="ws-main"><div class="ws-title">' + esc(s.name) + '</div><div class="ws-desc">ServiceDesc r' + s.resourceVersion +
        ' · workflow ' + wfs + ' · 对象 ' + docs + '</div></div>' +
        '<span class="ws-chip">' + phaseChip('InSync') + '</span></div>';
    }).join('');
    if (!svcHtml) svcHtml = liveSkeletonRows(2);
    var lvlFilter = S.wImpLevel;
    var lvlMap = { fatal: 'critical', error: 'critical', warn: 'high', info: 'info' };
    var bizEvents = LIVE.state.events.map(function (e) {
      return { e: e, lvl: lvlMap[e.level] || 'info', title: welcomeBizTitle(e) };
    }).filter(function (x) { return lvlFilter === 'all' || x.lvl === lvlFilter; }).slice(0, 10);
    var evHtml = bizEvents.map(function (x) {
      var dotc = x.lvl === 'critical' ? 'var(--danger)' : x.lvl === 'high' ? 'var(--warn)' : 'var(--accent)';
      var obj = x.e.involved || '';
      var objLink = '';
      if (obj) {
        var segs = obj.split('/');
        objLink = '<span class="w-ev-obj"><span class="lk mono small" data-act="go" data-go="doc/' +
          esc(segs.slice(0, -1).map(encodeURIComponent).join('/')) + '/' + esc(encodeURIComponent(segs[segs.length - 1])) + '">' + esc(obj) + '</span></span>';
      }
      return '<div class="w-ev-item"><span class="w-ev-dot" style="background:' + dotc + '"></span>' +
        '<span class="w-ev-title">' + esc(x.title) + '</span>' + objLink +
        '<span class="w-ev-time mono">' + esc(String(x.e.ts).replace('T', ' ').slice(5, 16)) + '</span></div>';
    }).join('');
    if (!evHtml) {
      evHtml = st.status === 'loading' ? liveSkeletonRows(3)
        : '<div class="empty" style="padding:22px"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">归档窗内暂无事件</div><div>event_log 为空：文档库 bootstrap 阶段尚无 Apply/触发流水（事件经 Apply 与注入产生）</div></div>';
    }
    if (st.status === 'degraded') evHtml = liveSkeletonRows(2) + liveDegradedNote();
    var healthTip = '健康度构成（console-ui.md 屏幕 0 口径）：InSync 率=status.phase=InSync 实例/全部实例' +
      '（现势 ServiceInstance 在册 ' + h.instances.length + ' → ' + (h.instances.length ? insyncPct : 'n/a——无实例在册不冒充 100%') + '）；' +
      'drift=DriftReport 在册 ' + h.drifts + '；审批积压=ApprovalNeeded 归档 ' + h.approvals + '；' +
      '24h 失败率=run 终态 failed ' + h.failed + '/' + h.started + (h.failedRate == null ? '（暂无 run）' : '=' + h.failedRate + '%');
    var stageNote = strip.run
      ? '最近一轮 ' + esc(strip.run.workflow) + ' · phase ' + esc(strip.run.phase) + ' · ' + esc(strip.run.status) +
        (strip.suspended ? '（闸锚挂起——等待批准信号）' : '')
      : '暂无 run：等待触发（DocApplied/ExternalChanged 事件或 timer resync）';
    var loading = st.status === 'loading';
    view.innerHTML = '<div class="welcome">' +
      '<div class="w-hello"><h1>' + esc(greeting()) + '</h1><span class="w-date">' + fmtDate(new Date()) +
      ' · 数据源=cored 读面（/core-console/api 代理 · 只读 GET）</span></div>' +
      '<div class="w-health-row">' +
        '<div class="w-health ' + (h.failedRate == null ? 'mid' : h.failedRate >= 90 ? 'good' : h.failedRate >= 70 ? 'mid' : 'bad') + '" title="' + esc(healthTip) + '">' +
          '<div class="w-health-num">' + (h.failedRate == null ? '—' : h.failedRate) + '<span class="unit">' + (h.failedRate == null ? '' : '%') + '</span></div>' +
          '<div class="w-health-meta"><b>24h 失败率</b><br>构成见 tooltip · 悬停查看</div>' +
        '</div>' +
        '<div class="w-insync">' +
          '<div class="w-insync-num">' + h.systems.length + '<span class="dim"> 系统</span> <span class="small muted">' +
            h.instances.length + ' 实例</span></div>' +
          '<div class="w-insync-bar">' + (cells || '<span class="small faint">系统树见左侧导航</span>') + '</div>' +
          '<div class="small faint">InSync 率 ' + esc(insyncPct) + ' · drift ' + h.drifts + ' · 待审批 ' + h.approvals +
            ' · run 受理 ' + h.started + '</div>' +
        '</div>' +
        '<div class="w-quick">' +
          '<button class="btn" data-act="manual-tick"><svg class="ic"><use href="#cc-i-refresh"/></svg>手动触发一轮</button>' +
          '<button class="btn" data-act="new-goal"><svg class="ic"><use href="#cc-i-plus"/></svg>新建 Goal</button>' +
          '<button class="btn primary" data-act="go" data-go="agent/core-headless"><svg class="ic"><use href="#cc-i-chat"/></svg>与 root 对话</button>' +
        '</div>' +
      '</div>' +
      '<div class="w-stagebar"><div class="sec-title">默认流转 · dev-delivery（点击阶段进运行详情）</div>' +
        '<div class="small faint" style="margin:2px 0 6px">' + esc(stageNote) + '</div>' +
        '<div class="w-stages">' + (loading ? liveSkeletonRows(1, 0) : stagesHtml) + '</div></div>' +
      '<div class="sec-title">服务状态（Service 关注行）</div>' +
      '<div class="w-services">' + svcHtml + '</div>' +
      '<div class="sec-title">最近重要事件（event_log 归档' + (h.truncated ? ' · 显示最近 100 条' : '') + '）</div>' +
      '<div class="w-ev-filter">' +
        [['all', '全部'], ['critical', 'critical'], ['high', 'high'], ['info', 'info']].map(function (f) {
          return '<span class="fchip' + (S.wImpLevel === f[0] ? ' on' : '') + '" data-act="w-ev-level" data-lv="' + f[0] + '">' + f[1] + '</span>';
        }).join('') +
      '</div>' +
      '<div class="card"><div class="card-b" style="padding:6px 16px">' + evHtml + '</div></div>' +
      '</div>';
  }
  ACTIONS['w-ev-level'] = function (el) { S.wImpLevel = el.dataset.lv; render(); };
  // 快捷动作（E2 诚实投影：写路径=Apply，未开启写面的装配不下发假回执）
  ACTIONS['manual-tick'] = function () {
    toast('只读装配不下发手动触发', '写路径唯一入口=POST /v1/apply（--allow-apply；E3 运行管理接 Apply override 闭环）', 'warn');
  };
  ACTIONS['new-goal'] = function () {
    toast('新建 Goal 由文档编辑器落地（E4）', 'LLM 草稿 → 人点 Apply → Revision+1 全链路（apply.md §1/§6）', 'warn');
  };

  /* ================= 屏 1：总览（E7 真数据换装——mock 渲染面归零，console-adoption.md §1.14 收口清扫） =================
   * 数据源=cored 读面（ServiceDesc 枚举+instanceStatus 相位投影+runs 面+归档窗）——liveHealth
   * 同一口径（Welcome 屏幕 0 复用），无双源。 */
  function screenOverview(view) {
    LIVE.ensure();
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '总览' }]);
    var h = liveHealth();
    var set = treeDraftSet();
    var stat = '<div class="statbar">' +
      '<div class="stat"><div class="st-num">' + h.systems.length + '</div><div class="st-label"><span class="lamp ok pulse-ok"></span>系统（ServiceDesc）</div></div>' +
      '<div class="stat"><div class="st-num">' + (h.instances.length ? Math.round(h.insyncCount / h.instances.length * 100) + '%' : 'n/a') + '</div><div class="st-label"><span class="lamp acc"></span>InSync 率' + (h.instances.length ? '' : '（零实例在册不冒充）') + '</div></div>' +
      '<div class="stat"><div class="st-num">' + h.events24 + '</div><div class="st-label"><span class="lamp acc"></span>24h 归档事件</div></div>' +
      '<div class="stat"><div class="st-num">' + h.approvals + '</div><div class="st-label"><span class="lamp warn"></span>ApprovalNeeded 归档</div></div>' +
      '<div class="stat"><div class="st-num">' + h.failed + '</div><div class="st-label"><span class="lamp esc"></span>failed run</div></div>' +
      '</div>';
    var cards = h.systems.map(function (s) {
      var sc = inScopeObjects(s.name);
      var insts = sc.byKind.ServiceInstance || [];
      var phase = 'n/a';
      if (insts.length) {
        var row = LIVE.state.instanceStatus['ServiceInstance/' + (insts[0].scope || '') + '/' + insts[0].name];
        phase = (row && row.phase) ? row.phase : 'n/a';
      }
      var draftN = sc.rows.filter(function (o) { return set[o.kind + '/' + (o.scope || '') + '/' + o.name]; }).length;
      return '<div class="syscard" data-act="go" data-go="s/' + esc(s.name) + '">' +
        '<div class="sc-top"><span class="lamp ' + (insts.length ? (PHASE_CLS[phase] || 'mute') : 'mute') + '" style="width:10px;height:10px"></span>' +
        '<span class="sc-name">' + esc(s.name) + '</span>' + (insts.length ? phaseChip(phase) : '<span class="chip mute small">无实例在册</span>') + '</div>' +
        '<div class="sc-meta">' +
          '<span><span class="k">ServiceDesc:</span> <span class="mono">r' + esc(s.resourceVersion) + '</span></span>' +
          '<span><span class="k">instances:</span> <span class="mono">' + insts.length + '</span></span>' +
          '<span><span class="k">workflows:</span> <span class="mono">' + (sc.byKind.Workflow || []).length + '</span></span>' +
          '<span><span class="k">对象:</span> <span class="mono">' + sc.rows.length + '</span></span>' +
          '<span><span class="k">草稿:</span> <span class="mono">' + draftN + '</span></span>' +
        '</div>' +
        '<div class="sc-foot"><span class="faint small" style="margin-left:auto">' + sc.rows.length + ' 对象在册 →</span></div>' +
        '</div>';
    }).join('') || '<div class="empty" style="padding:20px"><div class="e-title">零系统在册（cored 读面）</div></div>';
    // 进行中的运行（runs 面投影：triggered|running|suspended=进行中语义——终态推进不冒充）
    var runs = (LIVE.state.runs || []).filter(function (r) { return r.status === 'running' || r.status === 'triggered' || r.status === 'suspended'; }).slice(0, 8);
    var runsHtml = runs.map(function (r) {
      var wf = r.workflow || 'core-workflow';
      var no = r.run || r.triggerSeq || '';
      return '<div class="mini-row" data-act="go" data-go="wf/' + encodeURIComponent(wf) + '/r/' + esc(String(no)) + '">' +
        '<span class="mono" style="color:#7fb0f9;font-weight:700">#' + esc(String(no)) + '</span>' +
        '<div class="mr-main"><div>' + esc(wf) + '</div><div class="mr-sub mono">' + esc(r.eventId || r.involved || '') + '</div></div>' +
        '<span class="chip mute small">' + esc(r.status || '') + '</span></div>';
    }).join('') || '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">runs 面无进行中轮次</div></div>';
    // 最近事件（归档窗头 8 行——/v1/events 最新优先投影）
    var evs = (LIVE.state.events || []).slice(0, 8).map(function (e) {
      var dot = e.level === 'fatal' || e.level === 'error' ? 'danger' : e.level === 'warn' ? 'warn' : 'acc';
      return '<div class="mini-row" data-act="go" data-go="event/' + encodeURIComponent(e.eventId) + '">' +
        '<span class="lamp ' + dot + '"></span>' +
        '<div class="mr-main"><div>' + esc(e.type) + '</div><div class="mr-sub mono">' + esc(e.involved || '—') + '</div></div>' +
        '<span class="faint mono small">' + esc(String(e.ts || '').slice(11, 19)) + '</span></div>';
    }).join('') || '<div class="empty" style="padding:14px"><div class="e-title">归档窗内暂无事件</div></div>';
    view.innerHTML = '<div class="view-inner">' + stat +
      '<div class="sec-title">系统（ServiceDesc）· 点击进详情</div>' +
      '<div class="syscards">' + cards + '</div>' +
      '<div class="grid cols-2">' +
        '<div class="card"><div class="card-h"><span class="h-title">进行中的运行</span><span class="h-right lk small" data-act="go" data-go="workflows">全部 →</span></div><div class="mini-list">' + runsHtml + '</div></div>' +
        '<div class="card"><div class="card-h"><span class="h-title">最近事件</span><span class="h-right lk small" data-act="go" data-go="events">事件流 →</span></div><div class="mini-list">' + evs + '</div></div>' +
      '</div></div>';
  }

  /* ================= 屏 2：系统树（E2：cored 读面真数据，console-ui.md 屏幕 2） =================
   * 第一层树全屏化 + docs 一等子树：Global（builtin/global）→ 系统（ServiceDesc）→
   * instances / workflows / workservices / docs 全展开。文档节点与资源节点完全同构渲染
   * （kind 徽章 / rev / 草稿圆点）；树上任何标识符可点 → 对象详情（只读 viewer，E4 起升编辑器）。
   * 数据=cored 读面（scheme kinds + 逐 kind 对象枚举 + 草稿缓存清单）——子层懒展开=前端分组
   * （数据已全量在册，树上过滤为前端过滤）。 */
  function treeDraftSet() {
    var set = {};
    LIVE.state.drafts.forEach(function (d) { set[d.kind + '/' + d.scope + '/' + d.name] = true; });
    return set;
  }
  function treeObjRow(o, depth, set) {
    var path = encodeURIComponent(o.kind) + '/' + encodeURIComponent(o.scope) + '/' + encodeURIComponent(o.name);
    return '<div class="tree-row" style="padding-left:' + depth + 'px" data-act="go" data-go="doc/' + path + '">' +
      '<span class="t-caret"></span><svg class="ic" style="color:#5b6378"><use href="#cc-i-doc"/></svg>' +
      '<span class="t-name">' + esc(o.name) + '</span>' + kindBadge(o.kind) + draftDot(set[o.kind + '/' + o.scope + '/' + o.name]) +
      '<span class="t-meta"><span class="t-rev">r' + o.resourceVersion + '</span></span></div>';
  }
  function treeGroup(key, label, count, depth, icon, kidsHtml) {
    var open = S.treeOpen[key];
    return '<div class="tree-node"><div class="tree-row" style="padding-left:' + depth + 'px" data-act="tree-toggle" data-key="' + esc(key) + '">' +
      '<span class="t-caret' + (open ? ' open' : '') + '">▶</span><svg class="ic" style="color:#5b6378"><use href="#' + icon + '"/></svg>' +
      '<span class="t-name" style="font-family:var(--sans);font-weight:600">' + esc(label) + '</span>' +
      '<span class="t-meta"><span>' + count + '</span></span></div>' +
      (open ? '<div class="tree-children">' + kidsHtml + '</div>' : '') + '</div>';
  }
  function inScopeObjects(sysName) {
    // scope 匹配：现势文档库 scope=系统名裸名（layout.md 物化）；兼容 'systems/<name>' 前缀形。
    var hit = {};
    var rows = [];
    LIVE.state.kinds.forEach(function (kd) {
      var objs = LIVE.refs(kd.name).filter(function (o) { return o.scope === sysName || o.scope === 'systems/' + sysName; });
      if (objs.length) { hit[kd.name] = objs; rows = rows.concat(objs); }
    });
    return { byKind: hit, rows: rows };
  }
  function treeSystemChildren(sysName, set, ql) {
    var kids = '';
    var sc = inScopeObjects(sysName);
    var match = function (o) { return !ql || (o.name + ' ' + o.kind + ' ' + o.scope).toLowerCase().indexOf(ql) >= 0; };
    // instances
    var insts = (sc.byKind.ServiceInstance || []).filter(match);
    kids += treeGroup('inst:' + sysName, 'instances', insts.length, 34, 'cc-i-db',
      insts.map(function (o) { return treeObjRow(o, 56, set); }).join(''));
    // workflows（builtin 全局同名 override 在此与系统层同名对象并排可见）
    var wfs = (sc.byKind.Workflow || []).filter(match);
    kids += treeGroup('wf:' + sysName, 'workflows', wfs.length, 34, 'cc-i-flow',
      wfs.map(function (o) { return treeObjRow(o, 56, set); }).join(''));
    // workservices（WorkService/ConnectorOps/Provider 并组——资源节点与文档节点同构）
    var resRows = []
      .concat(sc.byKind.WorkService || []).concat(sc.byKind.ConnectorOps || []).concat(sc.byKind.Provider || []).filter(match);
    kids += treeGroup('res:' + sysName, 'workservices', resRows.length, 34, 'cc-i-plug',
      resRows.map(function (o) { return treeObjRow(o, 56, set); }).join(''));
    // docs（一等子树全展开：除上述资源/实例/workflow 外的全部 kind，按 kind 分组行）
    var docRows = [];
    LIVE.state.kinds.forEach(function (kd) {
      if (kd.name === 'ServiceInstance' || kd.name === 'Workflow' || kd.name === 'WorkService' ||
          kd.name === 'ConnectorOps' || kd.name === 'Provider' || kd.name === 'ServiceDesc') return;
      docRows = docRows.concat((sc.byKind[kd.name] || []).filter(match));
    });
    docRows.sort(function (a, b) { return (a.kind + a.name) < (b.kind + b.name) ? -1 : 1; });
    kids += treeGroup('docs:' + sysName, 'docs', docRows.length, 34, 'cc-i-folder',
      docRows.map(function (o) { return treeObjRow(o, 56, set); }).join(''));
    return kids;
  }
  var TREE_KEYS = [];
  function screenTree(view) {
    LIVE.ensure();
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '系统树' }]);
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>系统树</h1><span class="chip kind">Global → ServiceDesc → …</span></div>' +
      '<div class="dh-sub">文档节点与资源节点完全同构：同样的行样式 / kind 徽章 / revision / 草稿圆点。树上出现的任何标识符都可点（对象详情只读 viewer）。<span class="mono faint">数据源=cored 读面（scheme kinds + 对象枚举 + 草稿缓存）</span></div></div></div>' +
      '<div class="tree-toolbar">' +
        '<input type="search" id="tree-q" placeholder="按 kind / 名称 / scope 过滤…" style="flex:1;max-width:360px;background:var(--bg);border:1px solid var(--border-2);border-radius:7px;padding:6px 11px;color:var(--text);outline:none;font-size:12.5px">' +
        '<button class="btn sm" data-act="tree-expand">展开全部</button>' +
        '<button class="btn sm" data-act="tree-collapse">收起</button>' +
        '<span class="count-note" id="tree-count"></span>' +
      '</div>' +
      '<div class="tree-box" id="tree-box"></div></div>';
    paintTree('');
    $('#tree-q').addEventListener('input', function () { paintTree(this.value); });
  }
  function paintTree(q) {
    var box = $('#tree-box');
    var st = LIVE.state;
    var set = treeDraftSet();
    var ql = (q || '').toLowerCase().trim();
    var note = $('#tree-count');
    TREE_KEYS = [];
    if (st.status === 'loading') {
      box.innerHTML = '<div class="tree-node">' + liveSkeletonRows(6, 10) + '</div>';
      if (note) note.textContent = '装载 cored 读面…';
      return;
    }
    if (st.status === 'degraded') {
      box.innerHTML = '<div class="tree-node">' + liveSkeletonRows(3, 10) + liveDegradedNote() + '</div>';
      if (note) note.textContent = '读面不可达（保留骨架）';
      return;
    }
    var match = function (o) { return !ql || (o.name + ' ' + o.kind + ' ' + o.scope).toLowerCase().indexOf(ql) >= 0; };
    var totalRows = 0;
    var html = '<div class="tree-node"><div class="tree-row" style="padding-left:10px">' +
      '<span class="t-caret"></span><svg class="ic" style="color:#a78bfa"><use href="#cc-i-home"/></svg>' +
      '<span class="t-name">Global</span><span class="tree-root-badge">builtin/global 根 scope</span>' +
      '<span class="t-meta"><span class="mono">' + st.kinds.length + ' kinds 在册</span></span></div>';
    html += '<div class="tree-children">';
    // 系统子树（ServiceDesc 逐系统）
    var systems = LIVE.refs('ServiceDesc').filter(match);
    systems.forEach(function (s) {
      var sysKey = 'sys:' + s.name;
      TREE_KEYS.push(sysKey);
      var sc = inScopeObjects(s.name);
      var anyQ = ql ? sc.rows.some(match) : true;
      var open = ql ? anyQ : S.treeOpen[sysKey];
      html += '<div class="tree-node"><div class="tree-row" style="padding-left:30px" data-act="go" data-go="s/' + encodeURIComponent(s.name) + '">' +
        '<span class="t-caret' + (open ? ' open' : '') + '" data-act="tree-toggle" data-key="' + esc(sysKey) + '">▶</span>' +
        '<svg class="ic" style="color:#5b6378"><use href="#cc-i-grid"/></svg>' +
        '<span class="t-name">' + esc(s.name) + '</span><span class="chip kind">ServiceDesc</span>' +
        '<span class="t-meta"><span class="t-rev">r' + s.resourceVersion + '</span>' + draftDot(set[s.kind + '/' + s.scope + '/' + s.name]) + '</span></div>';
      if (open) html += '<div class="tree-children" data-sys="' + esc(s.name) + '">' + treeSystemChildren(s.name, set, ql) + '</div>';
      html += '</div>';
      totalRows += sc.rows.length;
    });
    // Global/builtin kind 分组（树的第一层“Global → …”其余对象）
    var gRows = 0;
    st.kinds.forEach(function (kd) {
      var rows = LIVE.refs(kd.name).filter(function (o) {
        return (o.scope === 'global' || o.scope === 'builtin') && match(o);
      });
      if (!rows.length) return;
      gRows += rows.length;
      var key = 'g:' + kd.name;
      TREE_KEYS.push(key);
      html += treeGroup(key, kd.name, rows.length, 30, 'cc-i-folder',
        rows.map(function (o) { return treeObjRow(o, 52, set); }).join(''));
    });
    html += '</div></div>';
    box.innerHTML = html;
    totalRows += gRows;
    if (note) {
      note.textContent = ql
        ? systems.length + '/' + LIVE.refs('ServiceDesc').length + ' 系统匹配 · 命中对象 ' + totalRows
        : LIVE.refs('ServiceDesc').length + ' 系统 · ' + totalRows + ' 对象在册 · 全部来自 cored 读面';
    }
    if (!LIVE.refs('ServiceDesc').length && !gRows) {
      box.innerHTML = '<div class="empty" style="padding:28px"><svg class="ic"><use href="#cc-i-empty"/></svg>' +
        '<div class="e-title">读面无对象在册</div><div>cored 读面 200 但零对象——检查文档库挂载（--docs）</div></div>';
    }
  }
  ACTIONS['tree-sys-toggle'] = function (el) {
    var key = el.dataset.key;
    S.treeOpen[key] = !S.treeOpen[key];
    render();
  };
  ACTIONS['tree-toggle'] = function (el) {
    var key = el.dataset.key;
    S.treeOpen[key] = !S.treeOpen[key];
    render();
  };
  ACTIONS['tree-expand'] = function () {
    TREE_KEYS.forEach(function (k) { S.treeOpen[k] = true; });
    LIVE.refs('ServiceDesc').forEach(function (s) { S.treeOpen['sys:' + s.name] = true; });
    render();
  };
  ACTIONS['tree-collapse'] = function () { S.treeOpen = {}; render(); };
  /* ================= 屏 3：系统详情（E2：cored 读面真数据最小面，console-ui.md 屏幕 3） =================
   * 声明/清单全部来自读面（ServiceDesc 正文 + scope 对象枚举）；六 tab 与场景面四页=E7 落地
   * （此处只留场景面入口占位，不渲染 mock——宁可空态不可假数据，console-adoption §5 规则 2）。
   * 「与该系统 Agent 对话」入口=agent 详情（E2 为对象 viewer；E5 换会话屏）。 */
  function sysCrumb(sys, extra) {
    var c = [{ label: 'Welcome', go: 'welcome' }, { label: sys.name, go: 's/' + sys.name }];
    return extra ? c.concat(extra) : c;
  }
  function hydrate(elId, path, paint) {
    // 异步内容注水：现渲染骨架行，读面返回后原位替换（路由已变=丢弃，不跨屏串数据）。
    var el = $('#' + elId);
    if (!el) return;
    var stamp = S.route + '|' + S.segs.join('/');
    el.innerHTML = liveSkeletonRows(1, 0);
    LIVE.get(path).then(function (b) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
      paint(el, b);
    }).catch(function (e) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
      el.innerHTML = '<div class="small faint" style="padding:6px 0">读面暂不可达（' + esc(String((e && e.message) || e)) + '）——恢复后重进即现读</div>';
    });
  }
  // scheme 引用词 → 路由（内容里出现的标识符全可点：硬性验收 console-adoption §5 规则 6）
  function refRoute(prefix, rest) {
    if (prefix === 'system' || prefix === 'systems') return 's/' + encodeURIComponent(rest.split('/')[0]);
    if (prefix === 'agent') return 'agent/' + encodeURIComponent(rest.split('/')[0]);
    if (prefix === 'ops') return 'connector/' + encodeURIComponent(rest.split('/')[0]);
    if (prefix === 'provider') return 'provider/' + encodeURIComponent(rest.split('/')[0]);
    if (prefix === 'ws') return 'ws/' + encodeURIComponent(rest.split('/')[0]);
    return null;
  }
  function refChips(content) {
    var seen = {}, out = '';
    var re = /([A-Za-z][A-Za-z0-9-]*):\/\/([A-Za-z0-9-_.\/]+)/g, m;
    while ((m = re.exec(String(content))) !== null) {
      var route = refRoute(m[1], m[2]);
      if (!route || seen[route]) continue;
      seen[route] = true;
      out += '<span class="chip click mute small" data-act="go" data-go="' + esc(route) + '"><svg class="ic"><use href="#cc-i-link"/></svg>' + esc(m[0]) + '</span> ';
    }
    return out;
  }
  ACTIONS['live-reload'] = function () { render(); }; // 重读=重渲染现读（读面 GET 幂等）
  /* 事件详情（E2 真数据：event_log 归档行投影，Welcome/事件流点击落点；链路=event→involved→对象） */
  function screenEventLive(view) {
    LIVE.ensure();
    var id = S.params.id;
    var e = LIVE.state.events.filter(function (x) { return x.eventId === id; })[0] || null;
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '事件' }, { label: id }]);
    if (!e) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('事件不在当前归档窗（最近 100 条）', id) + '</div>';
      return;
    }
    var lvlCls = e.level === 'error' || e.level === 'fatal' ? 'danger' : e.level === 'warn' ? 'warn' : 'ok';
    var involvedHtml = '';
    if (e.involved) {
      var segs = String(e.involved).split('/');
      involvedHtml = '<span class="lk mono" data-act="go" data-go="doc/' +
        esc(segs.slice(0, -1).map(encodeURIComponent).join('/')) + '/' + esc(encodeURIComponent(segs[segs.length - 1])) + '">' + esc(e.involved) + '</span>';
    }
    var kv = function (k, v) { return '<div class="kv"><span class="k mono">' + esc(k) + '</span><span class="v mono">' + (v || '<span class="faint">—</span>') + '</span></div>'; };
    view.innerHTML = '<div class="view-inner"><div class="dh"><div class="dh-main"><div class="dh-title"><h1 style="font-size:18px">' + esc(e.type) + '</h1>' +
      '<span class="chip ' + lvlCls + ' small">' + esc(e.level) + '</span><span class="chip mute small">source: ' + esc(e.source) + '</span></div>' +
      '<div class="dh-sub"><span class="mono">' + esc(e.ts) + '</span></div></div></div>' +
      '<div class="card" style="margin-top:12px"><div class="card-b" style="padding:10px 16px">' +
      kv('eventId', e.eventId) + kv('type', e.type) + kv('source', e.source) +
      kv('involved', involvedHtml) + kv('dedupKey', e.dedupKey) + kv('level', e.level) + kv('routedTo', e.routedTo) +
      '</div></div>' +
      '<div class="sec-title" style="margin-top:14px">链路（event→run→workflow→doc——标识符全可点）</div>' +
      '<div id="ev-chain" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
      (e.involved ? '<span class="chip click acc" data-act="go" data-go="' + esc(involvedRoute(e.involved)) + '">involved 对象 ' + esc(e.involved) + ' →</span>' : '') +
      '<span id="ev-chain-runs" class="small faint">run 反查中…</span>' +
      '</div>' +
      '<div class="small faint">数据源=event_log 归档（/v1/events，最新优先投影）；run 反查=/v1/workflows/runs eventId 命中；workflow 锚=/v1/triggers/resolve 决策投影（wfAnchorOfRoute 同一锚解析）。</div></div>';
    hydrateEventChain(e);
  }
  /* 链路注水（E6）：run 反查（eventId 命中→#/wf/:name/r/:n）+ workflow 锚（resolve route 投影→#/wf/:name） */
  function hydrateEventChain(e) {
    var el = $('#ev-chain-runs');
    if (!el) return;
    var stamp = S.route + '|' + S.segs.join('/');
    var runs = (LIVE.state.runs || []).filter(function (r) { return r.eventId === e.eventId; });
    var parts = runs.map(function (r) {
      var wf = r.workflow || 'core-workflow';
      var no = r.run || r.triggerSeq || '';
      return '<span class="chip click ok" data-act="go" data-go="wf/' + esc(encodeURIComponent(wf)) + '/r/' + esc(no) + '">run #' + esc(no) + ' @' + esc(wf) + '（' + esc(r.status || '') + '·' + esc(r.phase || '') + '）→</span>';
    });
    var anchorDone = false;
    var anchor = function () {
      if (anchorDone || !e.involved) return;
      anchorDone = true;
      LIVE.get('v1/triggers/resolve?type=' + encodeURIComponent(e.type) + '&involved=' + encodeURIComponent(e.involved))
        .then(function (res) {
          if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
          var el2 = $('#ev-chain-runs');
          if (!el2) return;
          var wf = wfAnchorOfRoute(res.route || '');
          var cur = el2.innerHTML;
          if (wf && res.matched) {
            cur += ' <span class="chip click mute" data-act="go" data-go="wf/' + esc(encodeURIComponent(wf)) + '">workflow 锚 ' + esc(wf) + '（route ' + esc(res.route) + '·row' + esc(res.row) + '）→</span>';
          } else if (res.route) {
            cur += ' <span class="chip mute small">route ' + esc(res.route) + '（执行面 executor=' + esc((res.execution && res.execution.route && res.execution.route.executor) || '') + '，非 workflow 锚）</span>';
          }
          el2.innerHTML = cur;
        }).catch(function () { /* 决策面缺席=链路行保持现状（不报错块） */ });
    };
    if (runs.length) {
      var el2 = $('#ev-chain-runs');
      if (el2) el2.innerHTML = parts.join(' ');
      anchor();
    } else {
      // runs 快照未含→显式拉一次（runs 面恒开；空=诚实「无 run 投影」不假画）
      LIVE.get('v1/workflows/runs').then(function (body) {
        if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
        var el2 = $('#ev-chain-runs');
        if (!el2) return;
        var hit = (body.runs || []).filter(function (r) { return r.eventId === e.eventId; });
        if (hit.length) {
          el2.innerHTML = hit.map(function (r) {
            var wf = r.workflow || 'core-workflow';
            var no = r.run || r.triggerSeq || '';
            return '<span class="chip click ok" data-act="go" data-go="wf/' + esc(encodeURIComponent(wf)) + '/r/' + esc(no) + '">run #' + esc(no) + ' @' + esc(wf) + '（' + esc(r.status || '') + '·' + esc(r.phase || '') + '）→</span>';
          }).join(' ');
        } else {
          el2.innerHTML = '<span class="chip mute small">无 run 投影（该事件执行面非 workflow 或未接线——诚实空态）</span>';
        }
        anchor();
      }, function () {
        if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
        var el2 = $('#ev-chain-runs');
        if (el2) el2.innerHTML = '<span class="small faint">run 反查面暂不可达</span>';
      });
    }
  }
  function screenSystem(view) {
    LIVE.ensure();
    var name = S.params.name;
    var sd = LIVE.refs('ServiceDesc').filter(function (o) { return o.name === name; })[0];
    if (!sd) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('系统不在册（cored 读面）', name) + '</div>';
      setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '404' }]);
      return;
    }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '系统树', go: 'tree' }, { label: name }]);
    var set = treeDraftSet();
    var sc = inScopeObjects(name);
    var rows = function (k, depth) { return (sc.byKind[k] || []).map(function (o) { return treeObjRow(o, depth, set); }).join(''); };
    var docRows = [];
    LIVE.state.kinds.forEach(function (kd) {
      if (kd.name === 'ServiceInstance' || kd.name === 'Workflow' || kd.name === 'WorkService' ||
          kd.name === 'ConnectorOps' || kd.name === 'Provider' || kd.name === 'ServiceDesc') return;
      docRows = docRows.concat(sc.byKind[kd.name] || []);
    });
    docRows.sort(function (a, b) { return (a.kind + a.name) < (b.kind + b.name) ? -1 : 1; });
    var sec = function (t, inner) {
      return '<div class="card" style="margin-top:12px"><div class="card-h"><span class="h-title">' + t + '</span></div><div class="card-b" style="padding:4px 8px 8px">' + (inner || '') + '</div></div>';
    };
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(name) + '</h1><span class="chip kind">ServiceDesc</span>' +
      draftDot(set[sd.kind + '/' + sd.scope + '/' + sd.name]) + '</div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(sd.scope) + '</span><span class="mono">r' + sd.resourceVersion + '</span>' +
      '<span>声明/清单全部来自 cored 读面；对象详情=只读 viewer（E4 起升编辑器）</span></div>' +
      '<div class="dh-sub" style="margin-top:8px">场景面（E7 真数据）：' +
      '<span class="chip click acc small" data-act="go" data-go="s/' + esc(name) + '/events">事件面 →</span> ' +
      '<span class="chip click acc small" data-act="go" data-go="s/' + esc(name) + '/metrics">指标面 →</span> ' +
      '<span class="chip click acc small" data-act="go" data-go="s/' + esc(name) + '/docs">文档面（tag 过滤）→</span> ' +
      '<span class="chip click acc small" data-act="go" data-go="s/' + esc(name) + '/permissions">权限面 →</span></div>' +
      '<div class="dh-actions" id="sys-agents"></div></div></div>' +
      sec('声明正文（ServiceDesc，现读）', '<div id="sys-spec">' + liveSkeletonRows(1, 0) + '</div>') +
      sec('instances（ServiceInstance）', rows('ServiceInstance', 12) || '<div class="small faint" style="padding:4px 12px">暂无实例对象在册</div>') +
      sec('workflows（系统层对象；builtin 全局同名 override 语义见 workflow.md）', rows('Workflow', 12) || '<div class="small faint" style="padding:4px 12px">暂无</div>') +
      sec('资源（WorkService / ConnectorOps / Provider）',
        rows('WorkService', 12) + rows('ConnectorOps', 12) + rows('Provider', 12) ||
        '<div class="small faint" style="padding:4px 12px">暂无</div>') +
      sec('docs（文档与资源同规则，kind 徽章区分）',
        docRows.map(function (o) { return treeObjRow(o, 12, set); }).join('') || '<div class="small faint" style="padding:4px 12px">暂无</div>') +
      '</div>';
    hydrate('sys-spec', 'v1/objects/ServiceDesc/' + encodeURIComponent(sd.name) + '?scope=' + encodeURIComponent(sd.scope), function (el, b) {
      var content = String(b.content || '');
      el.innerHTML = '<pre class="mono" style="white-space:pre-wrap;font-size:12.5px;line-height:1.55;margin:0">' + esc(content) + '</pre>' +
        (refChips(content) ? '<div style="margin-top:8px">' + refChips(content) + '</div>' : '');
      // 与该系统 Agent 对话入口（agentRef 来自声明正文——E2 进 agent 对象详情，E5 换会话屏）
      var ag = $('#sys-agents');
      if (ag) {
        var refs = (content.match(/agent:\/\/([A-Za-z0-9-_.]+)/g) || []).map(function (x) { return x.replace('agent://', ''); });
        var uniq = refs.filter(function (v, i) { return refs.indexOf(v) === i; });
        ag.innerHTML = uniq.map(function (a) {
          return '<button class="btn primary" data-act="go" data-go="agent/' + esc(a) + '"><svg class="ic"><use href="#cc-i-chat"/></svg>与 ' + esc(a) + ' 对话</button>';
        }).join('');
      }
    });
  }
  function emptyBox(title, sub) {
    return '<div class="empty" style="padding-top:10vh"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">' + esc(title) + '</div><div class="mono faint">' + esc(sub || '') + '</div><div class="e-act"><button class="btn primary" data-act="go" data-go="welcome">回 Welcome</button></div></div>';
  }

  /* ================= 屏 4：ServiceInstance 详情 ================= */
  function screenInstance(view) {
    // E5 真数据换装：实例条目内嵌于 ServiceDesc 正文（scheme: Desc.spec.instances[]——
    // agentRefs→agent 文档面地址→「在对话框调用该 Agent」=任务原文 #3 跳转链）。
    // conditions/metrics=引擎回写面（ServiceInstance 独立对象在册才可读——对象缺席=诚实空态）。
    LIVE.ensure();
    var sysRef = LIVE.refByName('ServiceDesc', S.params.name);
    var content = sysRef ? LIVE.docContent('ServiceDesc', sysRef.scope, S.params.name) : '';
    var instEntry = null;
    if (content) {
      var block = /instances:[\s\S]*?(?=\n {0,4}[A-Za-z_]+:|\n*$)/.exec(content);
      if (block) {
        var entries = block[0].split(/- name:/).slice(1);
        entries.forEach(function (e) {
          var nm = /\s*["']?([A-Za-z0-9-_.]+)["']?/.exec(e);
          if (nm && nm[1] === S.params.inst) instEntry = e;
        });
      }
    }
    if (!sysRef || instEntry === null) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('实例条目不在 ServiceDesc 声明正文', S.params.name + '/' + S.params.inst) + '</div>';
      setCrumbs([{ label: 'Welcome', go: 'welcome' }]);
      return;
    }
    var agentRefs = (instEntry.match(/agent:\/\/[A-Za-z0-9-_.]+/g) || []).map(function (x) { return x.replace('agent://', ''); })
      .concat(CHAT().sessionIdsOfRefs(instEntry.match(/session:\/\/[A-Za-z0-9_.:-]+/g) || []).map(function (x) { return x; }));
    var uniqRefs = agentRefs.filter(function (v, i) { return agentRefs.indexOf(v) === i; });
    var phaseRow = LIVE.state.instanceStatus['ServiceInstance/' + sysRef.scope + '/' + S.params.inst];
    var phaseChipHtml = phaseRow && phaseRow.phase ? phaseChip(phaseRow.phase, true) : '<span class="faint small" title="ServiceInstance 对象未在册（实例条目内嵌于 ServiceDesc 声明）——相位=引擎回写面余量">n/a</span>';
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '系统树', go: 'tree' }, { label: S.params.name, go: 's/' + esc(S.params.name) }, { label: S.params.inst }]);
    var agentChips = uniqRefs.map(function (a) {
      var isSession = a.indexOf('session:') === 0;
      return '<span class="chip click mute mono" ' + (isSession ? '' : 'data-act="go" data-go="agent/' + esc(a) + '"') + '><svg class="ic"><use href="#cc-i-bot"/></svg>' + esc(a) + '</span>';
    }).join(' ') || '<span class="faint">—（实例条目无 agentRefs）</span>';
    var firstAgent = uniqRefs.filter(function (a) { return a.indexOf('session:') !== 0; })[0];
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(S.params.inst) + '</h1>' + phaseChipHtml + '<span class="chip kind">ServiceInstance</span></div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(sysRef.scope) + '/instances/' + esc(S.params.inst) + '</span>' +
      '<span>owner: <span class="lk mono" data-act="go" data-go="s/' + esc(S.params.name) + '">' + esc(S.params.name) + '（ServiceDesc）</span></span></div>' +
      '<div class="dh-sub" style="margin-top:6px">agentRefs（声明正文现读）: ' + agentChips + '</div></div>' +
      '<div class="dh-actions">' +
      (firstAgent ? '<button class="btn primary lg" data-act="go" data-go="chat/' + esc(firstAgent) + '">在对话框调用该 Agent →</button>' : '') +
      '</div></div>' +
      '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">实例声明条目（ServiceDesc 正文现读）</span></div><div class="card-b"><pre class="mono" style="white-space:pre-wrap;font-size:12.5px;line-height:1.55;margin:0">' + esc('- name:' + instEntry) + '</pre>' +
      (refChips(instEntry) ? '<div style="margin-top:8px">' + refChips(instEntry) + '</div>' : '') + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">Status conditions / metrics</span></div><div class="card-b">' +
      (phaseRow ? '<div class="kv"><span class="k">phase</span><span class="v mono">' + esc(phaseRow.phase) + '</span><span class="k">observedGeneration</span><span class="v mono">' + esc(String(phaseRow.observedGeneration != null ? phaseRow.observedGeneration : '—')) + '</span></div>'
        : '<div class="empty" style="padding:16px"><div class="e-title">ServiceInstance 对象未在册</div><div class="small faint">conditions/metrics=引擎回写面（对象缺席=诚实空态，不画 mock）——E7 场景面细化</div></div>') +
      '</div></div></div></div>';
  }

  /* ================= 场景面：#/:sys/events ================= */
  function scenarioHead(sys, title, sub, backTab) {
    return '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(sys.name) + ' <span style="color:var(--text-2)">' + esc(title) + '</span></h1>' +
      (sys.phase ? phaseChip(sys.phase) : '') + '</div>' +
      '<div class="dh-sub">' + esc(sub) + '</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="go" data-go="s/' + esc(sys.name) + '">← 返回系统详情' + (backTab ? '（' + backTab + ' tab）' : '') + '</button></div></div>';
  }
  /* E7 场景事件面=全局事件流共用核（过滤条/行渲染/until 游标全同款——§1.14 L43-01）；
   * 场景差异=involved scope 过滤（inScopeObjects 同一口径）+ 归属系统面包屑。 */
  function screenSysEvents(view) {
    screenEventsCore(view, S.params.name);
  }
  /* ================= 场景面：metrics（E7 真数据换装，§1.14 L43-02） =================
   * 数据源=/v1/metrics 数据面投影（关断口径=空投影诚实空态——loop-43 实测 {"metrics":[],"total":0}，
   * 不冒充曲线不冒充指标名）+ /v1/metrics/query 即席查询（404=无投影结果如实标注）；
   * 越线事件=归档 MetricThreshold 行（系统 scope 过滤，行可点→事件详情）。 */
  function screenSysMetrics(view) {
    LIVE.ensure();
    var name = S.params.name;
    if (!LIVE.refByName('ServiceDesc', name)) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('系统不在册（cored 读面）', name) + '</div>';
      return;
    }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: name, go: 's/' + encodeURIComponent(name) }, { label: '指标面' }]);
    var mets = LIVE.state.metrics || [];
    var thr = (LIVE.state.events || []).filter(function (e) { return e.type === 'MetricThreshold' && SCN.evInScope(e, name); });
    var thrHtml = thr.length ? thr.slice(0, 8).map(function (e) {
      return '<div class="mini-row" data-act="go" data-go="event/' + encodeURIComponent(e.eventId) + '"><span class="lamp warn"></span>' +
        '<div class="mr-main"><div>' + esc(e.type) + '（' + esc(e.level) + '）</div><div class="mr-sub mono">' + esc(e.involved || '—') + '</div></div>' +
        '<span class="faint mono small">' + esc(String(e.ts || '').replace('T', ' ').slice(5, 16)) + '</span></div>';
    }).join('') : '<div class="empty" style="padding:16px"><div class="e-title">归档窗内无越线事件</div>' +
      '<div class="small faint">MetricThreshold 归档行（系统 scope 过滤）缺席=无越线记录，不画 mock</div></div>';
    var bodyHtml;
    if (!mets.length) {
      bodyHtml = '<div class="empty" style="padding:28px"><svg class="ic"><use href="#cc-i-empty"/></svg>' +
        '<div class="e-title">数据面未装配（/v1/metrics 空投影=关断口径可见）</div>' +
        '<div class="small faint">查询声明清单 / 曲线 / 阈值线的数据本体在 TSDB，不入 console（ops-log 同规则）——数据面装配=declared 余量（不冒充指标名不画 mock 曲线）</div></div>';
    } else {
      var rows = mets.map(function (m2) {
        return '<tr><td class="mono">' + esc(m2.name) + '</td><td class="mono" style="text-align:right">' + esc(String(m2.samples != null ? m2.samples : '—')) + '</td>' +
          '<td class="mono small" id="mq-' + esc(cssId(m2.name)) + '"><span class="faint">即席查询中…</span></td></tr>';
      }).join('');
      bodyHtml = '<div class="card"><div class="card-h"><span class="h-title">指标声明清单（/v1/metrics 投影）</span><span class="h-sub">样本计数=数据面在册实数</span></div>' +
        '<table class="tbl"><thead><tr><th>metric</th><th style="text-align:right">samples</th><th>即席查询（跨窗口全量 · avg/max）</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    view.innerHTML = '<div class="view-inner">' + scenarioHead({ name: name }, '指标面', '数据面投影实数（TSDB 本体不入 console）· 越线事件=归档行现读', '状态') +
      '<div class="grid" style="grid-template-columns:1fr 340px">' + bodyHtml +
      '<div class="card" style="align-self:start"><div class="card-h"><span class="h-title">最近越线事件（MetricThreshold）</span><span class="h-sub">归档窗内 · 系统 scope 过滤</span></div><div class="mini-list">' + thrHtml + '</div></div>' +
      '</div></div>';
    if (mets.length) hydrateMetricQueries(mets);
  }
  /* 即席查询注水（R-2 数据面装配后实跑路径）：window 缺省=跨窗口全量（Query 面声明语义——
   * 窗口标签由采样器部署决定，客户端不复制部署知识；404=无投影结果如实标注——不冒充零值）。
   * 注：带窗口标签的即席查询在标签不匹配时 404——浏览器对 4xx 资源错误照记 console error
   * （零 console error 硬线），故即席查询恒走全量口径。 */
  function hydrateMetricQueries(mets) {
    var stamp = S.route + '|' + S.segs.join('/');
    mets.slice(0, 12).forEach(function (m2) {
      ['avg', 'max'].forEach(function (agg) {
        LIVE.get('v1/metrics/query?metric=' + encodeURIComponent(m2.name) + '&agg=' + agg)
          .then(function (res) {
            if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
            var cur = $('#mq-' + cssId(m2.name));
            if (cur) cur.innerHTML += ' <span class="tag mono">' + esc(agg) + ' ' + esc(String(res.value)) + '</span>';
          }, function () {
            if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
            var cur = $('#mq-' + cssId(m2.name));
            if (cur && cur.innerHTML.indexOf('无投影结果') < 0) cur.innerHTML = '<span class="faint small">无投影结果（404=未知聚合或无同键样本——如实标注）</span>';
          });
      });
    });
  }
  /* 场景面：docs（E7 真数据换装，§1.14 L43-03/05）——tag 过滤为一等过滤器：
   * tags=对象正文 spec.metadata.tags（scheme conventions 检索元数据；fallback metadata.tags）
   * 现读解析（SCN.tagsOf，hydrate 注水，rv 键缓存）；chips=当前面 base 集合实读并集；
   * 全局 #/docs 与单系统 #/s/:name/docs 同一 paintDocsScreen 同款过滤器（文档与资源同规则）。 */
  function docBaseRows(scopeSys) {
    var rows = [];
    LIVE.state.kinds.forEach(function (kd) {
      (LIVE.refs(kd.name) || []).forEach(function (o) {
        if (scopeSys && !(o.scope === scopeSys || o.scope === 'systems/' + scopeSys)) return;
        rows.push({ kind: o.kind, scope: o.scope || '', name: o.name, resourceVersion: o.resourceVersion });
      });
    });
    rows.sort(function (a, b) { return (a.kind + a.scope + a.name) < (b.kind + b.scope + b.name) ? -1 : 1; });
    return rows;
  }
  function docKey(row) { return row.kind + '/' + (row.scope || '') + '/' + row.name; }
  function docTagsOfRow(row) { return S.docTags[docKey(row) + '@' + row.resourceVersion] || []; }
  function docTagsUnion(baseRows) {
    var u = [];
    baseRows.forEach(function (r) { docTagsOfRow(r).forEach(function (t) { if (u.indexOf(t) < 0) u.push(t); }); });
    return u.sort();
  }
  function hydrateDocTags(baseRows, done) {
    var stamp = S.route + '|' + S.segs.join('/');
    var jobs = baseRows.filter(function (r) { return !S.docTags[docKey(r) + '@' + r.resourceVersion]; });
    if (!jobs.length) { done(false); return; }
    Promise.all(jobs.map(function (r) {
      return LIVE.fetchObject(r.kind, r.scope, r.name).then(function (b) {
        S.docTags[docKey(r) + '@' + r.resourceVersion] = SCN.tagsOf(b.content);
      }).catch(function () {
        // 单对象正文不可读=tag 空集，不放大为整轮退化
        S.docTags[docKey(r) + '@' + r.resourceVersion] = [];
      });
    })).then(function () { if ((S.route + '|' + S.segs.join('/')) === stamp) done(true); },
      function () { if ((S.route + '|' + S.segs.join('/')) === stamp) done(true); });
  }
  function screenSysDocs(view) {
    LIVE.ensure();
    var name = S.params.name;
    if (!LIVE.refByName('ServiceDesc', name)) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('系统不在册（cored 读面）', name) + '</div>';
      return;
    }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: name, go: 's/' + encodeURIComponent(name) }, { label: '文档面' }]);
    paintDocsScreen(view, docBaseRows(name), 's/' + encodeURIComponent(name), 'systems/' + name);
  }
  function screenDocsGlobal(view) {
    LIVE.ensure();
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '文档' }]);
    paintDocsScreen(view, docBaseRows(null), 'overview', '全部 scope（global + systems/*）');
  }
  function paintDocsScreen(view, baseRows, backGo, scopeLabel) {
    var f = S.docFilter;
    var set = treeDraftSet();
    var kinds = [];
    baseRows.forEach(function (r) { if (kinds.indexOf(r.kind) < 0) kinds.push(r.kind); });
    kinds.sort();
    var tags = docTagsUnion(baseRows);
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>文档面</h1><span class="chip kind">' + esc(scopeLabel) + '</span></div>' +
      '<div class="dh-sub">tag chips 多选 × kind × 草稿 × 搜索 组合生效（tag=对象正文 spec.metadata.tags 现读——scheme conventions 检索元数据）· 虚拟滚动 · 共 ' + baseRows.length + ' 对象（文档与资源同规则）</div></div>' +
      '<div class="dh-actions">' + (backGo ? '<button class="btn" data-act="go" data-go="' + esc(backGo) + '">← 返回</button>' : '') + '</div></div>' +
      '<div class="filter-bar">' +
      '<span class="fchip' + (Object.keys(f.tags).every(function (k) { return !f.tags[k]; }) ? ' on' : '') + '" data-act="doc-tag" data-t="">全部 tags</span>' +
      (tags.length ? tags.map(function (t) { return '<span class="fchip' + (f.tags[t] ? ' on' : '') + '" data-act="doc-tag" data-t="' + esc(t) + '">#' + esc(t) + '</span>'; }).join('')
        : '<span class="faint small" id="df-tags-note">对象暂无 spec.metadata.tags 声明——tag 过滤器空集（不冒充；声明经 Apply 落库后此处现读）</span>') +
      '</div>' +
      '<div class="filter-bar">' +
      '<select id="df-kind"><option value="">全部 kind</option>' + kinds.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('') + '</select>' +
      '<select id="df-draft"><option value="">全部草稿态</option><option value="has">仅未 Apply 草稿 ●</option><option value="none">无草稿</option></select>' +
      '<input type="search" id="df-q" placeholder="名称 / kind / scope / tag 搜索…" style="width:220px">' +
      '<span class="count-note" id="df-note"></span></div>' +
      '<div id="df-vlist"></div></div>';
    $('#df-kind').value = f.kind; $('#df-draft').value = f.draft; $('#df-q').value = f.q;
    var repaintList = function () { paintDocsList(baseRows, set); };
    repaintList();
    $('#df-kind').addEventListener('change', function () { f.kind = this.value; repaintList(); });
    $('#df-draft').addEventListener('change', function () { f.draft = this.value; repaintList(); });
    var deb;
    $('#df-q').addEventListener('input', function () { var v = this.value; clearTimeout(deb); deb = setTimeout(function () { f.q = v; repaintList(); }, 160); });
    // tag 现读注水（base 行未解析的并行现读；完成后整屏重渲染——chips 与行 tag 同步现读面）
    hydrateDocTags(baseRows, function (changed) { if (changed) render(); });
  }
  ACTIONS['doc-tag'] = function (el) {
    var t = el.dataset.t;
    if (!t) S.docFilter.tags = {};
    else S.docFilter.tags[t] = !S.docFilter.tags[t];
    render();
  };
  function filterDocs(baseRows) {
    var f = S.docFilter;
    var sel = Object.keys(f.tags).filter(function (k) { return f.tags[k]; });
    var ql = (f.q || '').toLowerCase();
    var set = treeDraftSet();
    return baseRows.filter(function (d) {
      var tags = docTagsOfRow(d);
      if (sel.length && !sel.every(function (t) { return tags.indexOf(t) >= 0; })) return false;
      if (f.kind && d.kind !== f.kind) return false;
      var has = !!set[docKey(d)];
      if (f.draft === 'has' && !has) return false;
      if (f.draft === 'none' && has) return false;
      if (ql && (d.name + ' ' + d.kind + ' ' + (d.scope || '') + ' ' + tags.join(' ')).toLowerCase().indexOf(ql) < 0) return false;
      return true;
    });
  }
  function paintDocsList(baseRows, set) {
    var items = filterDocs(baseRows);
    $('#df-note').textContent = items.length + ' / ' + baseRows.length + ' docs';
    vlist($('#df-vlist'), items, 36, function (d) {
      var key = docKey(d);
      var tags = docTagsOfRow(d);
      return '<svg class="ic" style="color:#5b6378"><use href="#cc-i-doc"/></svg>' +
        '<span class="mono" style="width:200px;font-weight:600">' + esc(d.name) + '</span>' + draftDot(set[key]) +
        '<span class="vc"><span class="chip kind">' + esc(d.kind) + '</span></span>' +
        '<span class="vc mono faint small" style="width:130px">' + esc(d.scope || '—') + '</span>' +
        '<span class="vc" style="width:150px">' + tags.map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join(' ') + '</span>' +
        '<span class="vc mono faint" style="width:44px">r' + esc(d.resourceVersion) + '</span>' +
        (set[key] ? '<span class="vc"><span class="chip warn small">● 未 Apply</span></span>' : '<span class="vc faint">—</span>');
    });
    $('#df-vlist').onclick = function (ev) {
      var row = ev.target.closest('.vrow');
      if (!row) return;
      var idx = Math.floor((row.offsetTop + this.scrollTop) / 36);
      var it = items[idx];
      if (it) go('doc/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.scope || '') + '/' + encodeURIComponent(it.name));
    };
  }
  /* 场景面：permissions */
  /* ================= 场景面：permissions（E7 真数据换装，console-adoption.md §1.14 L43-04） =================
   * 权限矩阵：行=Agent 文档面对象（objects 枚举），列=ConnectorOps/Provider/Ref 对象 + 写路径列；
   * 格=授权来源现读（Agent 声明正文 spec.connectorOps 等挂载行——SCN.mountsOf，溯源=声明行可点）；
   * Role/Group=文档面枚举（docsRoot 零对象=诚实空态注记——角色面=declared 余量，不冒充矩阵）；
   * 挂载反查表=ConnectorOps × 挂载者（Agent 声明现读，双可点）。写路径列=声明面缺席如实标注
   * （Apply 准入=subject role 面 cored admit 判定，Agent 文档面无声明不冒充）。 */
  function screenSysPermissions(view) {
    LIVE.ensure();
    var name = S.params.name;
    if (!LIVE.refByName('ServiceDesc', name)) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('系统不在册（cored 读面）', name) + '</div>';
      return;
    }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: name, go: 's/' + encodeURIComponent(name) }, { label: '权限面' }]);
    var agents = LIVE.refs('Agent');
    var roles = LIVE.refs('Role');
    var groups = LIVE.refs('Group');
    var cols = LIVE.refs('ConnectorOps').map(function (o) { return { kind: 'ConnectorOps', name: o.name, scope: o.scope, route: 'connector/' + encodeURIComponent(o.name) }; })
      .concat(LIVE.refs('Provider').map(function (o) { return { kind: 'Provider', name: o.name, scope: o.scope, route: 'provider/' + encodeURIComponent(o.name) }; }))
      .concat(LIVE.refs('Ref').map(function (o) { return { kind: 'Ref', name: o.name, scope: o.scope, route: 'ref/' + encodeURIComponent(o.name) }; }));
    var colKeys = cols.map(function (c) { return c.kind + '/' + c.name; });
    function cellFor(agentName, col) {
      var hit = SCN.agentMountsKind(LIVE.docContent('Agent', agentScopeOf(agentName), agentName), col.kind, col.name);
      return hit;
    }
    function agentScopeOf(agentName) {
      var ref = agents.filter(function (a) { return a.name === agentName; })[0];
      return ref ? (ref.scope || '') : '';
    }
    var matrixRows = agents.map(function (a) { return a.name; });
    var matrix = '<div class="card"><div class="card-h"><span class="h-title">权限矩阵（行=Agent 文档面，列=ConnectorOps / Provider / Ref 对象）</span>' +
      '<span class="h-sub">格=授权来源现读（Agent 声明正文挂载行）；—=无挂载声明</span></div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th style="min-width:150px">agent</th>' +
      cols.map(function (c) { return '<th style="min-width:90px" title="' + esc(c.kind + '/' + c.scope + '/' + c.name) + '"><span class="lk mono small" data-act="go" data-go="' + esc(c.route) + '">' + esc(c.name) + '</span><div class="faint tiny">' + esc(c.kind) + '</div></th>'; }).join('') +
      '<th style="min-width:90px">Apply 写路径</th></tr></thead><tbody>' +
      (matrixRows.length ? matrixRows.map(function (r) {
        return '<tr><td class="mono"><svg class="ic"><use href="#cc-i-bot"/></svg> <span class="lk" data-act="go" data-go="agent/' + esc(r) + '">' + esc(r) + '</span></td>' +
          cols.map(function (c) {
            var hit = cellFor(r, c);
            return '<td class="mono" style="color:' + (hit ? '#4ade80' : 'var(--text-3)') + ';text-align:center" title="' +
              esc(hit ? '授权来源：Agent/' + agentScopeOf(r) + '/' + r + ' 声明正文挂载行 ' + hit.ref : '声明正文无 ' + c.kind + ' 挂载') + '">' + (hit ? '✓' : '—') + '</td>';
          }).join('') +
          '<td class="mono" style="color:var(--text-3);text-align:center" title="Apply 准入=subject role 面（cored admit 判定）——Agent 文档面无声明，不冒充">—</td></tr>';
      }).join('') : '<tr><td colspan="' + (colKeys.length + 2) + '" class="small faint">Agent 对象零在册（文档面）——矩阵空态</td></tr>') +
      '</tbody></table></div></div>';
    // 挂载反查表（ConnectorOps × 挂载者——Agent 声明现读，双可点）
    var copRows = LIVE.refs('ConnectorOps').map(function (c) {
      var holders = agents.filter(function (a) { return SCN.agentMountsKind(LIVE.docContent('Agent', a.scope || '', a.name), 'ConnectorOps', c.name); });
      return '<tr><td class="mono"><span class="lk" data-act="go" data-go="connector/' + esc(c.name) + '">' + esc(c.name) + '</span></td>' +
        '<td class="mono faint small">' + esc(c.scope || '—') + '</td>' +
        '<td>' + (holders.length ? holders.map(function (h) {
          return '<span class="lk mono small" data-act="go" data-go="agent/' + esc(h.name) + '">' + esc(h.name) + '</span>';
        }).join(' ') : '<span class="faint">未挂载</span>') + '</td></tr>';
    }).join('');
    var rolesHtml;
    if (!roles.length && !groups.length) {
      rolesHtml = '<div class="card"><div class="card-h"><span class="h-title">Role / Group 文档面</span></div><div class="card-b">' +
        '<div class="empty" style="padding:16px"><div class="e-title">Role / Group 对象零在册（docsRoot）</div>' +
        '<div class="small faint">角色面=declared 余量（docsRoot 未建 Role/Group 对象）——矩阵行只呈现 Agent 声明面现读，不冒充 role 授权</div></div></div></div>';
    } else {
      // R-6（console-adoption.md §1.20）：Role/Group 文档面在册 → 授权矩阵 spec 现读区块。
      // 数据源=live 小对象现读（console-live.js smallKinds 含 Role/Group）——声明正文现读，非内置表；
      // 全可点溯源（role→#/role/:name、on 挂载→#/agent/:name、group 反查→role 链接）。
      function strList(seg) {
        return (seg || '').split(',').map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); }).filter(Boolean);
      }
      function roleSpecOf(scope, name) {
        var c = LIVE.docContent('Role', scope || '', name) || '';
        var on = [];
        var om = /on:\s*\[([^\]]*)\]/.exec(c);
        if (om) on = strList(om[1]);
        var perms = [];
        var re = /-\s*\{scope:\s*([^,}]+),\s*actions:\s*\[([^\]]*)\]\}/g, pm;
        while ((pm = re.exec(c))) perms.push({ scope: strList(pm[1])[0] || pm[1].trim(), actions: strList(pm[2]) });
        return { on: on, perms: perms };
      }
      function groupRolesOf(scope, name) {
        var c = LIVE.docContent('Group', scope || '', name) || '';
        var m = /roles:\s*\[([^\]]*)\]/.exec(c);
        return m ? strList(m[1]) : [];
      }
      var roleLink = function (bare) {
        return '<span class="lk mono small" data-act="go" data-go="role/' + esc(bare.replace(/^role\//, '')) + '">' + esc(bare) + '</span>';
      };
      var grantRows = '';
      roles.forEach(function (r) {
        var sp = roleSpecOf(r.scope, r.name);
        if (!sp.perms.length && !sp.on.length) {
          grantRows += '<tr><td class="mono">' + roleLink(r.name) + '</td><td colspan="3" class="small faint">spec 零授权条目（声明在册，零挂载零权限域——授权面同判=不产生授权）</td></tr>';
          return;
        }
        sp.on.forEach(function (o) {
          grantRows += '<tr><td class="mono">' + roleLink(r.name) + '</td>' +
            '<td class="mono">' + (o.indexOf('agent/') === 0
              ? '<span class="lk" data-act="go" data-go="agent/' + esc(o.slice(6)) + '">' + esc(o) + '</span>'
              : esc(o)) + '</td><td class="mono faint small">—</td><td class="small faint">on 对象挂载（permission.md 骨架 3b——持有者可处理该对象）</td></tr>';
        });
        sp.perms.forEach(function (p) {
          grantRows += '<tr><td class="mono">' + roleLink(r.name) + '</td><td class="mono">' + esc(p.scope) + '</td><td class="mono small">' + esc(p.actions.join(', ')) + '</td><td class="small faint">permissions 权限域条目（写面 admit 判定源）</td></tr>';
        });
      });
      var grpRows = groups.map(function (g) {
        var bound = groupRolesOf(g.scope, g.name);
        return '<tr><td class="mono"><span class="chip kind">Group</span> ' + esc(g.name) + '</td><td>' +
          (bound.length ? bound.map(roleLink).join(' ') : '<span class="faint">零绑定（组不产生授权）</span>') + '</td></tr>';
      }).join('');
      rolesHtml = '<div class="card"><div class="card-h"><span class="h-title">Role / Group 文档面</span></div><table class="tbl"><thead><tr><th>kind</th><th>name</th><th>scope</th><th>rv</th></tr></thead><tbody>' +
        roles.map(function (r) { return '<tr><td class="chip kind">Role</td><td class="mono"><span class="lk" data-act="go" data-go="role/' + esc(r.name) + '">' + esc(r.name) + '</span></td><td class="mono">' + esc(r.scope || '—') + '</td><td class="mono">r' + esc(r.resourceVersion) + '</td></tr>'; }).join('') +
        groups.map(function (g) { return '<tr><td class="chip kind">Group</td><td class="mono">' + esc(g.name) + '</td><td class="mono">' + esc(g.scope || '—') + '</td><td class="mono">r' + esc(g.resourceVersion) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        '<div class="card"><div class="card-h"><span class="h-title">Role 授权矩阵（行=Role × 授权条目——声明正文 spec 现读）</span>' +
        '<span class="h-sub">on 挂载 / 权限域条目（scope + actions）/ 绑定 group 反查——全可点溯源</span></div>' +
        '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th style="min-width:110px">role</th><th style="min-width:150px">对象挂载 · 权限域</th><th style="min-width:120px">actions</th><th>条目类型</th></tr></thead><tbody>' +
        (grantRows || '<tr><td colspan="4" class="small faint">Role 零授权条目</td></tr>') +
        '</tbody></table></div>' +
        '<table class="tbl" style="margin-top:10px"><thead><tr><th style="min-width:140px">group</th><th>绑定 role（user→group→role，骨架 3）</th></tr></thead><tbody>' +
        (grpRows || '<tr><td colspan="2" class="small faint">Group 零在册</td></tr>') + '</tbody></table></div>';
    }
    view.innerHTML = '<div class="view-inner">' + scenarioHead({ name: name }, '权限面', '行=Agent 文档面 · 列=ConnectorOps/Provider/Ref · 格=声明正文挂载行现读（溯源全可点）· Role/Group=文档面枚举+授权矩阵 spec 现读', 'Agent') +
      '<div class="grid" style="grid-template-columns:1fr">' + matrix +
      '<div class="card"><div class="card-h"><span class="h-title">挂载反查（ConnectorOps × 挂载者——声明正文现读）</span></div>' +
      '<table class="tbl"><thead><tr><th>ConnectorOps</th><th>scope</th><th>挂载者（Agent 文档面）</th></tr></thead><tbody>' +
      (copRows || '<tr><td colspan="3" class="small faint">ConnectorOps 零在册</td></tr>') + '</tbody></table></div>' +
      rolesHtml + '</div></div>';
  }
  /* ================= 屏 5：Workflow 运行管理（E3：cored 读面真数据，console-ui.md 屏幕 5） =================
   * 数据来源（无双源红线）：列表/详情=GET /v1/workflows 聚合投影（三源同投，cored-bridge.md §2
   * v0.37）；轮次=/v1/workflows/runs（involved=涉及对象链第一跳）；事件 tab=触发留痕过滤；
   * 配置 tab=对象 YAML 现读。启停=POST /core-console/apply（宿主转发 cored 唯一写入口
   * POST /v1/apply，主体宿主注入，console-adoption.md §1.9）——override 语义（红线 b）：
   * builtin 本体不动，落系统层同名 override（origin: override-of-builtin）。
   * 诚实口径：成功率不投影（run 终态事件未落归档=declared 余量，n/a 不冒充）；无 run=空态
   * 不假画；action log/SessionLog=诚实空态余量；重跑/取消=余量不画按钮。 */
  function liveWfRow(name) {
    var a = LIVE.state.wfAgg;
    if (!a || !a.workflows) return null;
    for (var i = 0; i < a.workflows.length; i++) if (a.workflows[i].name === name) return a.workflows[i];
    return null;
  }
  function liveRunsOf(name) {
    var out = [];
    (LIVE.state.runs || []).forEach(function (r) { if (r.workflow === name) out.push(r); });
    out.reverse(); // 新→旧
    return out;
  }
  function liveRunByNo(name, no) {
    var runs = liveRunsOf(name);
    for (var i = 0; i < runs.length; i++) if (runs[i].run === no) return runs[i];
    return null;
  }
  function wfAnchorOfRoute(route) {
    if (!route) return '';
    if (route.indexOf('workflows/') === 0) return route.slice('workflows/'.length);
    if (/-workflow$/.test(route)) return 'core-workflow';
    return '';
  }
  function runStatusChip(st, phase) {
    if (st === 'running') return phaseChip(phase || 'running');
    if (st === 'suspended') return '<span class="chip warn"><span class="lamp warn pulse-warn"></span>' + esc(phase || 'suspended') + ' · 挂起</span>';
    if (st === 'failed') return '<span class="chip danger">failed</span>';
    return '<span class="chip mute">' + esc(st || 'triggered') + '</span>';
  }
  function wfObjectChip(name, o) {
    return '<span class="chip click mute small" data-act="go" data-go="doc/Workflow/' +
      encodeURIComponent(o.scope) + '/' + encodeURIComponent(name) + '" title="对象详情（本体/override 同构）">' +
      esc(o.scope) + ' r' + o.resourceVersion + '</span>';
  }
  // 执行绑定 chip（v0.49 R-7——workflow-runtime.md §11.1 决策面 execution 投影；connector.md 规则 6 缺口不静默）：
  // bound+实现=ok chip 可点落 ConnectorOps 编辑器；bound+skeleton=骨架（实现代码未落）mute chip；
  // unbound=warn chip（缺同名 ConnectorOps 对象——缺口可见）；execution 缺席=—（面缺省不冒充）。
  function wfExecChip(ex) {
    if (!ex || !ex.state) return '<span class="faint small" title="执行绑定面缺席（旧代/枚举失败——不冒充）">—</span>';
    if (ex.state === 'bound') {
      var tt = '执行绑定：ConnectorOps/' + ex.connectorScope + '/' + ex.connector + (ex.skeleton
        ? '（骨架=apply 即实现物化面；实现代码=apply-workflow agent 余量）' : '（实现已在册）');
      return '<span class="chip click ' + (ex.skeleton ? 'mute' : 'ok') + ' small" data-act="go" data-go="connector/' +
        encodeURIComponent(ex.connector) + '" title="' + tt + '">' + (ex.skeleton ? '骨架·' : '') + esc(ex.connector) + '</span>';
    }
    return '<span class="chip warn small" title="未绑定：缺 ' + esc(ex.connector || '(同名)') + ' ConnectorOps 对象——workflow apply 即实现骨架物化（apply-workflow agent 写实现；缺口可见不静默）">unbound</span>';
  }
  function involvedDocChip(involved) {
    var segs = String(involved || '').split('/');
    if (segs.length >= 3) {
      return '<span class="chip click mute small" data-act="go" data-go="doc/' +
        encodeURIComponent(segs[0]) + '/' + encodeURIComponent(segs[1]) + '/' + encodeURIComponent(segs.slice(2).join('/')) +
        '">' + esc(involved) + '</span>';
    }
    if (segs.length === 2) {
      return '<span class="chip click mute small" data-act="go" data-go="doc/' +
        encodeURIComponent(segs[0]) + '/' + encodeURIComponent(segs[1]) + '">' + esc(involved) + '</span>';
    }
    return involved ? '<span class="chip mute small mono">' + esc(involved) + '</span>' : '';
  }
  function wfToggleTarget(row) {
    var eff = null, body = null;
    (row.objects || []).forEach(function (o) {
      if (row.effective && o.scope === row.effective.scope) eff = o;
      if (o.scope === 'global') body = o;
    });
    return { target: eff || body, isOverride: !!eff };
  }
  function firstSystemScope() {
    var names = LIVE.refs('ServiceDesc').map(function (o) { return o.name; }).sort();
    return names[0] || '';
  }
  function setYamlEnabled(content, to) {
    if (/^[ \t]*enabled:[ \t]*(true|false)[ \t]*$/m.test(content)) {
      return content.replace(/^([ \t]*)enabled:[ \t]*(true|false)[ \t]*$/m, function (_m0, ind) { return ind + 'enabled: ' + to; });
    }
    return content.replace(/^spec:[ \t]*$/m, 'spec:\n  enabled: ' + to);
  }
  function ensureOriginLabel(content) {
    if (/core\/origin:/.test(content)) return content;
    if (/^[ \t]+labels:[ \t]*$/m.test(content)) {
      return content.replace(/^([ \t]+)labels:[ \t]*$/m, '$1labels:\n' + '$1' + '  core/origin: override-of-builtin');
    }
    if (/^metadata:[ \t]*$/m.test(content)) {
      return content.replace(/^metadata:[ \t]*$/m, 'metadata:\n  labels:\n    core/origin: override-of-builtin');
    }
    return content;
  }
  function cloneAsOverride(content, sys, to) {
    var c = setYamlEnabled(content, to);
    c = c.replace(/^([ \t]*)scope:[ \t]*\S+([ \t]*(?:#.*)?)$/m, '$1scope: ' + sys + '$2');
    return ensureOriginLabel(c);
  }
  function applyWorkflowToggleLive(name, target, isOverride, to) {
    LIVE.fetchObject('Workflow', target.scope, name).then(function (obj) {
      var content = String(obj.content || '');
      var scope = target.scope;
      if (isOverride) {
        content = ensureOriginLabel(setYamlEnabled(content, to));
      } else {
        var sys = firstSystemScope();
        if (!sys) { toast('override 目标面缺席', '文档库无系统 scope（ServiceDesc 缺席）——不发明 override 位置', 'warn'); return; }
        scope = sys;
        content = cloneAsOverride(content, sys, to);
      }
      LIVE.apply({
        kind: 'Workflow', scope: scope, name: name, resourceVersion: obj.resourceVersion,
        content: content, fieldManager: 'console:workflow-toggle', reasonRef: 'console:wf-toggle:' + name
      }).then(function (res) {
        if (!res.ok) { toast('Apply 失败（HTTP ' + (res.status == null ? '传输层' : res.status) + '）', res.error, 'danger'); return; }
        var ev = res.data && res.data.event ? ' · DocApplied ' + res.data.event.id : '';
        toast('已落库（Apply）', name + ' @' + scope + ' spec.enabled → ' + to + ev, 'ok');
        LIVE.load().then(function () { render(); });
      });
    }, function () {
      toast('本体读取失败', '对象读面不可达——稍后重试（连接态灯见右下）', 'warn');
    });
  }

  function screenWorkflows(view) {
    LIVE.ensure();
    var st = LIVE.state;
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: 'Workflows' }]);
    var inner;
    if (!st.wfAgg) {
      inner = '<div class="card"><div class="card-b">' + liveSkeletonRows(5) + '</div></div>' +
        (st.status === 'degraded' ? liveDegradedNote() : '');
    } else {
      var rowsHtml = (st.wfAgg.workflows || []).map(function (w) {
        var tt = wfToggleTarget(w);
        var curEnabled = tt.target ? (tt.target.enabled === false ? false : true) : null;
        var switchCell;
        if (tt.target) {
          switchCell = '<span class="switch' + (curEnabled ? ' on' : '') + '" data-act="wf-toggle" data-wf="' + esc(w.name) +
            '" title="启用/停用 = Apply（override 语义：builtin 本体不动）"></span>';
        } else {
          switchCell = '<span class="faint small" title="builtin 本体无文档对象——override 生成=E4 编辑器轮余量（诚实余量，不假开关）">—</span>';
        }
        var docsChips = (w.objects || []).map(function (o) { return wfObjectChip(w.name, o); }).join(' ') ||
          '<span class="faint small" title="声明随运行时 builtin 注册表（无文档本体）">builtin 注册表</span>';
        var scopeCell = w.effective ? '<span class="path-mono">' + esc(w.effective.scope) + '</span>' :
          (w.objects.length ? '<span class="path-mono">' + esc(w.objects[0].scope) + '</span>' : '<span class="faint">global</span>');
        return '<tr class="row-click" data-act="go" data-go="wf/' + esc(w.name) + '">' +
          '<td class="mono" style="font-weight:650">' + esc(w.name) + ' <span class="chip mute tiny" style="font-size:9px">' + esc(w.specSource || 'builtin') + '</span></td>' +
          '<td>' + scopeCell + '</td>' +
          '<td>' + switchCell + '</td>' +
          '<td>' + wfExecChip(w.execution) + '</td>' +
          '<td>' + (w.latest ? runStatusChip(w.latest.status, w.latest.phase) : '<span class="faint small">无现势 run</span>') + '</td>' +
          '<td class="mono num">' + w.runsTotal + ' <span class="faint">/ ' + w.runs24h + 'h</span></td>' +
          '<td><span class="faint small" title="成功率不投影：run 终态事件未落归档（declared 余量）——n/a 不冒充">n/a</span></td>' +
          '<td class="mono faint">' + (w.latest ? fmtAgo(new Date(w.latest.startedAt)) : '—') + '</td>' +
          '<td style="max-width:280px">' + docsChips + '</td></tr>';
      }).join('');
      inner = '<div class="card"><table class="tbl"><thead><tr><th>名称</th><th>生效 scope</th><th>启用 (=Apply)</th><th>执行绑定</th><th>当前相位</th>' +
        '<th>运行次数 总/24h</th><th>成功率</th><th>最近运行</th><th>涉及文档</th></tr></thead><tbody>' + (rowsHtml || '') + '</tbody></table></div>' +
        '<div class="small faint" style="margin-top:8px">计数口径=event_log 归档 ×dispatch 决议（含冷却窗内被拦阻触发——' + (st.wfAgg.scanCapped ? '扫描有界已收敛' : '全窗') + '）；启停=override 语义 Apply（builtin 本体不动）；执行绑定=同名/spec.connector 覆写 ConnectorOps（apply 即实现骨架物化——unbound=缺口可见）</div>';
    }
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>Workflows</h1>' +
      (st.wfAgg ? '<span class="chip kind">' + (st.wfAgg.count || 0) + ' 条规则</span>' : '') + '</div>' +
      '<div class="dh-sub">Workflow = 触发规则 → 事件整理 → 相位态机 → 文档回归。启停/编辑 全部 = Apply（override 落系统层同名对象）。</div></div></div>' +
      inner + '</div>';
  }

  var WF_TABS = [
    { id: 'runs', label: '运行' }, { id: 'flow', label: '流程图' }, { id: 'events', label: '事件' },
    { id: 'transitions', label: '流转' }, { id: 'dataflow', label: '数据流' }, { id: 'config', label: '配置' }
  ];
  function screenWorkflow(view) {
    LIVE.ensure();
    var st = LIVE.state;
    var name = S.params.name;
    var row = liveWfRow(name);
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: 'Workflows', go: 'workflows' }, { label: name }]);
    if (!row) {
      view.innerHTML = '<div class="view-inner">' + (st.wfAgg
        ? emptyBox('workflow 不在聚合面（行集=注册表∪对象∪run 锚三源并集）', name)
        : '<div class="card"><div class="card-b">' + liveSkeletonRows(3) + '</div></div>' + liveDegradedNote()) + '</div>';
      return;
    }
    var tab = S.wfTab[name] || 'runs';
    var curEnabled = wfToggleTarget(row).target ? (wfToggleTarget(row).target.enabled === false ? false : true) : null;
    var head = '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(row.name) + '</h1>' +
      '<span class="chip kind">Workflow</span><span class="chip mute">' + esc(row.specSource || 'builtin') + '</span>' +
      wfExecChip(row.execution) +
      (row.effective ? '<span class="chip mute">override · ' + esc(row.effective.scope) + '</span>' : '') +
      (curEnabled === false ? '<span class="chip warn">已停用（override）</span>' : '') + '</div>' +
      '<div class="dh-sub"><span>' + (row.objects.length ? '对象 ' + row.objects.length + ' 份（本体/override 同构可点）' : '声明随 builtin 注册表（无文档本体）') +
      ' · ' + (row.phases || []).length + ' 相位</span></div></div>' +
      '<div class="dh-actions">' +
      (curEnabled !== null
        ? '<button class="btn ' + (curEnabled ? 'danger' : 'ok') + '" data-act="wf-toggle" data-wf="' + esc(row.name) + '">' + (curEnabled ? '停用' : '启用') + '</button>'
        : '<span class="faint small" title="builtin 本体无文档对象——override 生成=E4 余量">启停余量</span>') +
      '<button class="btn" data-act="wf-edit-spec" data-wf="' + esc(row.name) + '" title="编辑=文档编辑器（E4 起 Apply 全链）">编辑 spec</button>' +
      '</div></div>';
    var kpi = '<div class="statbar" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="stat"><div class="st-num">' + row.runsTotal + '</div><div class="st-label">总运行（归档口径）</div></div>' +
      '<div class="stat"><div class="st-num">' + row.runs24h + '</div><div class="st-label">24h 运行</div></div>' +
      '<div class="stat"><div class="st-num" style="font-size:15px">' + (row.latest ? esc(row.latest.phase) : '—') + '</div><div class="st-label">当前相位' + (row.latest ? '' : '（无现势 run）') + '</div></div>' +
      '<div class="stat"><div class="st-num">' + row.objects.length + '</div><div class="st-label">对象（本体/override）</div></div></div>';
    var tabs = '<div class="tabs">' + WF_TABS.map(function (t) {
      return '<div class="tab' + (t.id === tab ? ' active' : '') + '" data-act="wf-tab" data-t="' + t.id + '">' + t.label + '</div>';
    }).join('') + '</div>';
    var body = '';
    if (tab === 'runs') body = wfLiveTabRuns(row);
    else if (tab === 'flow') body = wfLiveTabFlow(row);
    else if (tab === 'events') body = wfLiveTabEvents(row);
    else if (tab === 'transitions') body = wfLiveTabTransitions(row);
    else if (tab === 'dataflow') body = wfLiveTabDataflow(row);
    else body = wfLiveTabConfig(row);
    view.innerHTML = '<div class="view-inner">' + head + kpi + tabs + body + '</div>';
    if (tab === 'transitions') paintWfTransitions(row);
    if (tab === 'config') hydrateWfConfig(row);
  }
  ACTIONS['wf-tab'] = function (el) { S.wfTab[S.params.name] = el.dataset.t; render(); };
  ACTIONS['wf-toggle'] = function (el, e) {
    e.stopPropagation();
    var name = el.dataset.wf;
    var row = liveWfRow(name);
    if (!row) { toast('读面未就绪', 'workflow 聚合面未装载——稍后重试', 'warn'); return; }
    var tt = wfToggleTarget(row);
    if (!tt.target) { toast('无法启停（诚实余量）', 'builtin 本体无文档对象——override 生成=E4 编辑器轮余量', 'warn'); return; }
    var cur = tt.target.enabled === false ? false : true;
    var to = !cur;
    var scopeAfter = tt.isOverride ? tt.target.scope : firstSystemScope();
    confirmModal(to ? '启用 workflow（= Apply）' : '停用 workflow（= Apply）',
      '<div class="kv" style="gap:8px"><span class="k">对象</span><span class="v mono">Workflow/' + esc(scopeAfter) + '/' + esc(name) + '</span>' +
      '<span class="k">语义</span><span class="v">' + (tt.isOverride ? '更新既有 override（系统层同名覆盖——builtin 本体不动）' : '生成 override（克隆本体文档 + origin 标注 + 翻转 enabled；builtin 本体不动）') + '</span>' +
      '<span class="k">变更</span><span class="v mono">spec.enabled: ' + cur + ' → ' + to + '</span>' +
      '<span class="k">闭环</span><span class="v">Apply 落库 Revision+1 · DocApplied 归档 · 页面重读显示新态（触发路径对 enabled 的实时 honoring=引擎余量，如实标注）</span></div>',
      '确认（Apply）', function () {
        applyWorkflowToggleLive(name, tt.target, tt.isOverride, to);
      });
  };
  ACTIONS['wf-edit-spec'] = function (el) {
    var row = liveWfRow(el.dataset.wf);
    var tt = row ? wfToggleTarget(row) : null;
    if (tt && tt.target) { go('doc/Workflow/' + encodeURIComponent(tt.target.scope) + '/' + encodeURIComponent(el.dataset.wf)); return; }
    toast('无文档本体（诚实空态）', '该 workflow 的声明随 builtin 注册表——spec 编辑=E4 编辑器轮余量', 'warn');
  };

  /* --- 运行 tab：dsh Jobs 双栏（run 列表 + 抽屉内联；follow=余量，轮次静态投影） --- */
  function wfLiveTabRuns(row) {
    var runs = liveRunsOf(row.name);
    var selNo = S.wfRunSel[row.name] != null ? S.wfRunSel[row.name] : (runs[0] ? runs[0].run : null);
    var sel = runs.filter(function (r) { return r.run === selNo; })[0] || runs[0] || null;
    var list = runs.slice(0, 60).map(function (r) {
      return '<div class="job-item' + (sel && r.run === sel.run ? ' sel' : '') + '" data-act="wf-run-sel" data-no="' + r.run + '">' +
        '<div class="ji-top"><span class="ji-no">#' + r.run + '</span>' + runStatusChip(r.status, r.phase) +
        '<span class="faint mono small" style="margin-left:auto">' + fmtAgo(new Date(r.startedAt)) + '</span></div>' +
        '<div class="ji-sub"><span>' + esc(r.type) + '</span><span>·</span><span>' + esc(r.specSource || '—') + '</span></div></div>';
    }).join('');
    if (!list) list = '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">环内暂无该锚的 run（触发留痕=观测面，环容量 256）</div></div>';
    var detail = sel ? wfRunDrawerHtml(row, sel, true) :
      '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">无运行轮次</div><div class="e-act"><span class="faint small">手动触发=Apply 触发设置（引擎真实执行面接线余量）</span></div></div>';
    return '<div class="jobs-layout"><div class="jobs-list"><div class="card-h"><span class="h-title">运行轮次</span><span class="h-sub">' +
      runs.length + ' 轮（环内投影，新→旧）</span></div><div class="jl-scroll">' + list + '</div></div>' +
      '<div class="job-detail" id="job-detail">' + detail + '</div></div>';
  }
  ACTIONS['wf-run-sel'] = function (el) { S.wfRunSel[S.params.name] = parseInt(el.dataset.no, 10); render(); };

  /* --- 运行抽屉（相位时间线/留痕 kv/涉及文档；action log 与 SessionLog=诚实空态余量） --- */
  function wfRunDrawerHtml(row, r, inline) {
    var phases = r.phases || [];
    var curIdx = phases.indexOf(r.phase);
    var tl = phases.map(function (p, i) {
      var cls = i < curIdx ? 'done' : (i === curIdx ? 'current' : '');
      return '<div class="ptl-item ' + cls + '"><div class="ptl-rail"><div class="ptl-node"></div>' + (i < phases.length - 1 ? '<div class="ptl-line"></div>' : '') + '</div>' +
        '<div class="ptl-main"><div class="ptl-head"><span class="ptl-phase">' + esc(p) + '</span><span class="ptl-ts">' +
        (i === curIdx ? '当前落点' : (i < curIdx ? '已过（留痕面无进出时刻——相位进出时刻=执行面余量）' : '未至')) + '</span></div></div></div>';
    }).join('');
    if (!tl) tl = '<div class="small faint">相位未投影（' + esc(r.specSource) + ' 源未声明 spec.phases——零投影口径，status=' + esc(r.status) + '）</div>';
    var kv = function (k, v) { return '<span>' + esc(k) + ' <b>' + v + '</b></span>'; };
    var brakes = r.brakes || {};
    var docsChips = involvedDocChip(r.involved);
    var objChips = (row.objects || []).map(function (o) { return wfObjectChip(row.name, o); }).join(' ');
    var back = '<span class="lk small" data-act="go" data-go="wf/' + esc(row.name) + '/r/' + r.run + '">在独立页打开 →</span>';
    return '<div class="jd-head"><span class="jd-title mono">#' + r.run + ' · ' + esc(row.name) + '</span>' + runStatusChip(r.status, r.phase) +
      '<span style="margin-left:auto"></span>' + (inline ? back : '<span class="lk small" data-act="go" data-go="wf/' + esc(row.name) + '">← 返回运行管理</span>') + '</div>' +
      '<div class="jd-kvrow">' +
      kv('specSource', esc(r.specSource || '—')) + kv('status', esc(r.status)) +
      kv('triggerSeq', esc(r.triggerSeq)) + '<span>eventId <b class="mono">' + esc(r.eventId || '—') + '</b></span>' +
      '<span>route <b class="mono">' + esc(r.route || '—') + '</b></span>' +
      '<span>owner <b class="mono">' + esc(r.owner || '—') + '</b></span>' +
      '<span>startedAt <b class="mono">' + esc((r.startedAt || '').replace('T', ' ').slice(0, 19)) + '</b></span>' +
      '<span>brakes <b class="mono">' + esc(brakes.cooldown || '—') + ' / ' + esc(brakes.maxMutationsTick != null ? brakes.maxMutationsTick : '—') + '</b></span></div>' +
      '<div class="jd-body">' +
      '<div><div class="sec-title">相位时间线（FSM：声明序列 + 当前落点）</div><div class="phase-tl">' + tl + '</div></div>' +
      '<div><div class="sec-title">action log（ConnectorOps 调用）</div><div class="logbox"><div class="small faint" style="padding:10px 14px">诚实空态：action log 随真实执行面接线落位（引擎主体余量，cored-bridge.md §2.3）——本抽屉当前承载触发面投影（留痕 kv 即该 run 的审计锚点）</div></div></div>' +
      '<div><div class="sec-title">涉及文档（点击进对象 viewer）</div><div style="display:flex;gap:6px;flex-wrap:wrap">' + (docsChips || '<span class="faint small">留痕 involved 缺席</span>') + (objChips ? '<span class="faint small" style="align-self:center">声明对象：</span>' + objChips : '') + '</div></div>' +
      '<div><div class="sec-title">SessionLog 全文</div><div class="logbox"><div class="small faint" style="padding:10px 14px">诚实空态：SessionLog 随 agent 会话接线落位（E5 会话屏轮）——细粒度断点续跑靠 SessionLog（workflows 规则 13 挂账）</div></div></div>' +
      '</div>';
  }

  /* --- 流程图 tab：生效相位序列线性渲染，当前落点高亮（相位态机=声明序列） --- */
  function wfLiveTabFlow(row) {
    var phases = row.phases || [];
    var cur = row.latest ? row.latest.phase : '';
    var steps = phases.map(function (p, i) {
      var cls = p === cur ? 'cur' : (p === 'Failed' ? 'abn' : '');
      return '<div class="fstep ' + cls + '"><div class="fs-dot"></div><div class="fs-name mono">' + esc(p) + '</div></div>';
    }).join('<div class="fs-arrow">→</div>');
    if (!phases.length) steps = '<div class="small faint">相位未投影（声明 spec.phases 余量）</div>';
    return '<div class="card"><div class="card-h"><span class="h-title">相位态机（声明序列）</span>' +
      '<span class="h-sub">' + (row.latest ? '现势 run #' + row.latest.run + ' · ' + esc(row.latest.status) : '无现势 run——落点不假画（诚实空态）') + '</span></div>' +
      '<div class="card-b"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0">' + steps + '</div></div></div>' +
      '<div class="small faint" style="margin-top:8px">声明表=transitions（物化相邻行+审批边——runs 载荷 transitions 键可查）；当前相位=' + esc(cur || '无') + '</div>';
  }

  /* --- 事件 tab：该 workflow 触发与消费的事件流=触发留痕过滤（route→该锚） --- */
  function wfLiveTabEvents(row) {
    var recs = ((LIVE.state.triggers || {}).records || []).filter(function (rec) {
      return rec.execution && rec.execution.route && rec.execution.route.executor === 'workflow' &&
        wfAnchorOfRoute(rec.route) === row.name;
    }).reverse();
    var html = recs.slice(0, 60).map(function (rec) {
      var dot = rec.level === 'error' || rec.level === 'fatal' ? 'danger' : rec.level === 'warn' ? 'warn' : 'acc';
      return '<div class="mini-row" data-act="go" data-go="event/' + encodeURIComponent(rec.eventId) + '">' +
        '<span class="lamp ' + dot + '"></span>' +
        '<div class="mr-main"><div>' + esc(rec.type) + '</div><div class="mr-sub mono">' + esc(rec.involved || '—') + ' · route ' + esc(rec.route) + '</div></div>' +
        '<span class="faint mono small">' + fmtAgo(new Date(rec.receivedAt || rec.at)) + '</span></div>';
    }).join('');
    if (!html) html = '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">留痕环内暂无路由到该锚的事件（dead-letter/其他执行面不入此列）</div></div>';
    return '<div class="card"><div class="card-h"><span class="h-title">触发与消费的事件流（留痕=过去的决策投影）</span><span class="h-sub">' + recs.length + ' 条</span></div>' +
      '<div class="mini-list" style="max-height:520px;overflow-y:auto">' + html + '</div></div>';
  }

  /* --- 流转 tab：run 行投影（相位+状态+时刻；相位进出时刻=执行面余量，如实标注） --- */
  function wfLiveTabTransitions(row) {
    var runs = liveRunsOf(row.name);
    var container = '<div id="tr-vlist"></div>';
    var note = '<div class="filter-bar"><span class="small muted">运行轮次（新→旧）：</span><span class="count-note">' + runs.length + ' 行（相位进出时刻随执行面接线落位——当前承载=受理/迁移落点投影）</span></div>';
    return note + container;
  }
  function paintWfTransitions(row) {
    var el = $('#tr-vlist');
    if (!el) return;
    var runs = liveRunsOf(row.name);
    vlist(el, runs, 34, function (r) {
      return '<span class="vc mono faint" style="width:70px">#' + r.run + '</span>' + runStatusChip(r.status, r.phase) +
        '<span class="vc mono faint" style="width:150px">' + esc(r.type) + '</span>' +
        '<span class="grow mono faint small">' + esc(r.involved || '—') + '</span>' +
        '<span class="vc mono faint" style="width:130px">' + esc((r.startedAt || '').replace('T', ' ').slice(0, 19)) + '</span>';
    });
    el.onclick = function (ev) {
      var rowEl = ev.target.closest('.vrow');
      if (!rowEl) return;
      var idx = Math.floor((rowEl.offsetTop + this.scrollTop) / 34);
      var it = runs[idx];
      if (it) { S.wfRunSel[row.name] = it.run; S.wfTab[row.name] = 'runs'; render(); }
    };
  }

  /* --- 数据流 tab：聚合面 dataflowInputs/Outputs 拼图（节点全可点） --- */
  function wfLiveTabDataflow(row) {
    var tt = wfToggleTarget(row);
    var eff = tt.target;
    if (!eff) {
      return '<div class="card"><div class="card-b">' + emptyBox('数据流声明缺席（诚实空态）', row.name + ' 无文档本体——spec.dataflow 随文档面，builtin 注册表无此声明') + '</div></div>';
    }
    var ins = (eff.dataflowInputs || []).map(function (x) {
      var label = x.events && x.events.length ? 'events: ' + x.events.join(', ') : (x.docs ? 'docs: ' + x.docs : '');
      var go_ = x.docs && x.docs.indexOf('systems/') >= 0 ? 's/' + x.docs.split('/')[1] : (x.events ? 'events' : 'overview');
      return '<div class="op-card" style="cursor:pointer" data-act="go" data-go="' + esc(go_) + '"><div class="oc-name mono">' + esc(label) + '</div></div>';
    }).join('');
    var outs = (eff.dataflowOutputs || []).map(function (x) {
      var label = x.status ? 'status: ' + x.status : (x.docs ? 'docs: ' + x.docs : (x.artifacts ? 'artifacts: ' + x.artifacts : ''));
      var extra = [x.notify && x.notify.length ? 'notify: ' + x.notify.join(',') : '',
        x.artifacts ? 'artifacts: ' + x.artifacts : '', x.reports && x.reports.length ? 'reports: ' + x.reports.join(',') : ''].filter(Boolean).join(' · ');
      var go_ = x.artifacts ? 'connectors' : (x.docs && x.docs.indexOf('systems/') >= 0 ? 's/' + x.docs.split('/')[1] : 'overview');
      return '<div class="op-card" style="cursor:pointer" data-act="go" data-go="' + esc(go_) + '"><div class="oc-name mono">' + esc(label) + '</div><div class="oc-desc">' + esc(extra) + '</div></div>';
    }).join('');
    return '<div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:14px">' +
      '<div><div class="sec-title">① 输入（触发源）</div><div style="display:grid;gap:8px">' + (ins || '<span class="faint small">未声明</span>') + '</div></div>' +
      '<div><div class="sec-title">② 处理（相位态机）</div><div class="op-card"><div class="oc-name mono">phases ×' + (row.phases || []).length + '</div>' +
      '<div class="oc-desc">mode: ' + esc(eff.mode || '—') + '</div><div class="oc-desc">involved: ' + esc((eff.involved || []).join(', ') || '随 scope') + '</div>' +
      '<div style="margin-top:10px"><span class="lk small" data-act="wf-tab-go" data-t="flow">查看流程图 →</span></div></div></div>' +
      '<div><div class="sec-title">③ 输出（回归/产物）</div><div style="display:grid;gap:8px">' + (outs || '<span class="faint small">未声明</span>') + '</div></div></div>' +
      '<div class="small faint" style="margin-top:10px">节点全部可点：docs → 系统详情；events → 事件流；声明源=' + esc(eff.scope) + ' r' + eff.resourceVersion + '</div>';
  }
  ACTIONS['wf-tab-go'] = function (el) { S.wfTab[S.params.name] = el.dataset.t; render(); };

  /* --- 配置 tab：生效对象 YAML 现读（编辑深链=E4）；builtin 无本体=注册表说明 --- */
  // 派单行（v0.50 R-8——workflow-runtime.md §11.2 拉起形态首段）：骨架物化即派单 apply-workflow
  // （受理投影 GET /v1/agents/dispatches——受理≠会话已拉起，真实拉起 deferred）。骨架=skeleton
  // true 时现读；进程内环重启归零=受理投影缺席如实标注（实现未落持久态=execution.skeleton）。
  function wfDispatchLine() {
    return '<div class="small faint" style="padding:4px 0 0">派单（apply-workflow）：<span id="wf-dispatch-state" class="faint small">…</span></div>';
  }
  function wfLiveTabConfig(row) {
    var tt = wfToggleTarget(row);
    var exSkel = !!(row.execution && row.execution.state === 'bound' && row.execution.skeleton);
    if (!tt.target) {
      return '<div class="card"><div class="card-h"><span class="h-title">spec（builtin 注册表——无文档本体）</span></div>' +
        '<div class="card-b"><div class="small faint" style="padding:4px 0">声明随运行时 builtin 注册表（相位词汇映射表同源，concepts/workflow.md §1）；override 编辑=E4 编辑器轮余量。</div>' +
        '<div class="yaml-block">' + esc('phases: [' + (row.phases || []).join(', ') + ']\nspecSource: ' + row.specSource) + '</div>' +
        '<div class="small faint" style="padding:6px 0 0">执行绑定：' + wfExecChip(row.execution) + ' <span class="faint">（同名/spec.connector 覆写 ConnectorOps——apply 即实现骨架物化，workflow-runtime.md §11.1）</span></div>' +
        (exSkel ? wfDispatchLine() : '') + '</div></div>';
    }
    var obj = tt.target;
    return '<div class="card"><div class="card-h"><span class="h-title">spec yaml（' + esc(obj.scope) + ' r' + obj.resourceVersion + ' · origin ' + esc(obj.origin) + '）</span>' +
      '<span class="h-right"><span class="lk small" data-act="wf-edit-spec" data-wf="' + esc(row.name) + '">编辑（→ 对象 viewer，E4 起 Apply 全链）</span></span></div>' +
      '<div class="card-b" id="wf-config-yaml"><div class="skel-row"><div class="skel" style="width:220px"></div></div></div>' +
      '<div class="card-b" style="border-top:1px solid var(--line)"><div class="small faint" style="padding:2px 0">执行绑定：' + wfExecChip(row.execution) + ' <span class="faint">（同名/spec.connector 覆写 ConnectorOps——骨架=apply 即实现物化面，实现代码=apply-workflow agent 余量）</span></div>' +
      (exSkel ? wfDispatchLine() : '') + '</div></div>';
  }
  function hydrateWfConfig(row) {
    var obj = wfToggleTarget(row).target;
    if (obj) {
      hydrate('wf-config-yaml', 'v1/objects/Workflow/' + encodeURIComponent(row.name) + '?scope=' + encodeURIComponent(obj.scope),
        function (el, b) {
          el.innerHTML = '<div class="yaml-block">' + esc(String(b.content || '')) + '</div>';
        });
    }
    // 派单行注水（v0.50 R-8）：骨架=实现未落 → apply-workflow 派单受理投影现读
    // （环内该 workflow 锚的行数+最近一次动作/rv/autoLevel；缺席=重启归零如实标注）。
    if (row.execution && row.execution.state === 'bound' && row.execution.skeleton) {
      hydrate('wf-dispatch-state', 'v1/agents/dispatches', function (el, b) {
        var recs = (b.dispatches || []).filter(function (d) { return d.workflow === row.name; });
        if (!recs.length) {
          el.innerHTML = '<span>受理投影缺席（进程内环——重启归零；实现未落=execution.skeleton 持久态在册）</span>';
          return;
        }
        var last = recs[recs.length - 1];
        el.innerHTML = '<span class="chip mute small mono">apply-workflow ×' + recs.length + '</span> ' +
          '<span>最近 ' + esc(String(last.at || '').replace('T', ' ').slice(0, 19)) + ' · action=' + esc(last.action) +
          ' · rv=' + esc(last.rv) + ' · autoLevel=' + esc(last.autoLevel) +
          '（受理投影≠会话已拉起——真实拉起 deferred，workflow-runtime.md §11.2）</span>';
      });
    }
  }

  /* --- 运行独立页 #/wf/:name/r/:n（屏幕 5 运行抽屉的独立路由形态，console-ui.md 详情页矩阵） --- */
  function screenWfRun(view) {
    LIVE.ensure();
    var st = LIVE.state;
    var name = S.params.name;
    var no = parseInt(S.params.n, 10);
    var row = liveWfRow(name);
    var r = liveRunByNo(name, no);
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: 'Workflows', go: 'workflows' }, { label: name, go: 'wf/' + name }, { label: '运行 #' + no }]);
    if (!row || !r) {
      view.innerHTML = '<div class="view-inner">' + (st.wfAgg
        ? emptyBox('运行轮次不在环内（环容量 256——旧轮次随溢出挤出，留痕=观测面非账本）', name + ' #' + no)
        : '<div class="card"><div class="card-b">' + liveSkeletonRows(3) + '</div></div>' + liveDegradedNote()) + '</div>';
      return;
    }
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(name) + ' <span style="color:var(--text-2)">#' + r.run + '</span></h1>' + runStatusChip(r.status, r.phase) + '</div>' +
      '<div class="dh-sub">' + esc(r.type) + ' · startedAt ' + esc((r.startedAt || '').replace('T', ' ').slice(0, 19)) + '</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="go" data-go="wf/' + esc(name) + '">← 返回运行管理</button></div></div>' +
      '<div class="card" id="job-detail">' + wfRunDrawerHtml(row, r, false) + '</div></div>';
  }

  /* ================= 屏 6：文档编辑器（E4：cored 真数据，console-ui.md 屏幕 6 + console-adoption.md §1.10） ================= */
  // 编辑与发布分离（concepts/apply.md）的 UI 化——LLM 止步提案，人独占发布：
  //   · 手动编辑/已采纳提案走同一草稿通道：编辑=debounced 落稿（POST /core-console/drafts，
  //     不触文档面、不发事件、零 Revision）；空草稿 Apply=无操作提示不落库。
  //   · Apply 唯一入口=草稿 tab 吸底按钮（人点为准；LLM 通路上没有 Apply）→ 确认弹窗
  //     （完整 diff + dry-run 三项检查=scheme 校验/权限准入/乐观锁）→ POST /core-console/apply
  //     {fromDraft:true}（宿主注入主体）→ Revision+1 + DocApplied 必发 + 清稿。
  //   · LLM 提案=草稿缓存中 fieldManager 非 console: 前缀的稿（agent 经 cored 草稿面落的
  //     提案；会话页提案卡深链至此=E5 接线余量）——diff 卡排队等人裁，[加入草稿]/[丢弃]。
  // 数据来源（无双源）：文档体/草稿/history 全部 cored 读面（live 层 + 本屏 hydrate）。
  S.docTab = {}; // objKey -> collab tab（默认 llm——提案排队优先见人）
  S.ED = {};     // objKey -> 编辑器会话态（working/base/baseRV/faceRV/entries/landed/fm）

  function edKey(kind, scope, name) { return kind + '/' + scope + '/' + name; }
  function edOf(kind, scope, name) { return S.ED[edKey(kind, scope, name)] || null; }
  function edConsoleFM(kind, scope, name) { return 'console:editor:' + kind.toLowerCase() + '/' + name; }
  function isConsoleFM(fm) { return /^console:/.test(String(fm || '')); }
  // 变更块数（"Apply（N 处变更）"的 N=diff 变更块，非行数——诚实计数）
  function hunksOf(lines) {
    var n = 0, inHunk = false;
    lines.forEach(function (l) {
      if (l.t === '+' || l.t === '-') { if (!inHunk) { n++; inHunk = true; } }
      else inHunk = false;
    });
    return n;
  }
  function draftRowOf(kind, scope, name) {
    return (LIVE.state.drafts || []).filter(function (d) {
      return d.kind === kind && d.scope === scope && d.name === name;
    })[0] || null;
  }
  function edHasDiff(ed) { return !!ed && ed.loaded && ed.working !== ed.base; }

  // —— 屏本体：对象键解析（E2 语义保留：#/doc/:kind/:scope/:name 直链 + #/doc/:name 名字解析）——
  function screenEditor(view, kindHint) {
    LIVE.ensure();
    var p = S.params;
    var kind = kindHint || p.kind;
    var name = p.name;
    var scope = p.scope || '';
    var st = LIVE.state;
    if (st.status === 'loading' && !st.kinds.length) {
      if (kind && scope) { renderEditorShell(view, kind, scope, name); hydrateEditor(kind, scope, name); return; }
    }
    var ref = null;
    if (kind) {
      ref = LIVE.refs(kind).filter(function (o) { return o.name === name && (!scope || o.scope === scope); })[0] || null;
      if (!ref && !scope) {
        var cands = LIVE.refs(kind).filter(function (o) { return o.name === name; });
        if (cands.length === 1) ref = cands[0];
        else if (cands.length > 1) {
          view.innerHTML = '<div class="view-inner">' + emptyBox('同名对象跨 scope 有歧义（' + cands.length + ' 个）——请从系统树进入', name) + '</div>';
          return;
        }
      }
    } else {
      var all = [];
      st.kinds.forEach(function (kd) {
        LIVE.refs(kd.name).forEach(function (o) { if (o.name === name) all.push(o); });
      });
      if (all.length === 1) ref = all[0];
      else if (all.length > 1) {
        view.innerHTML = '<div class="view-inner">' + emptyBox('同名对象跨 kind/scope 有歧义（' + all.length + ' 个）——请从系统树进入', name) + '</div>';
        return;
      }
    }
    if (!ref) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('对象不在册（cored 读面 ' + st.kinds.length + ' kinds）', (kind ? kind + '/' : '') + name) + '</div>';
      return;
    }
    renderEditorShell(view, ref.kind, ref.scope, ref.name);
    hydrateEditor(ref.kind, ref.scope, ref.name);
  }

  function renderEditorShell(view, kind, scope, name) {
    var key = edKey(kind, scope, name);
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '系统树', go: 'tree' },
      { label: scope, go: scope === 'global' || scope === 'builtin' ? 'tree' : 's/' + encodeURIComponent(scope) }, { label: name }]);
    // E6：ConnectorOps kind 专属第五 tab「运行面」（连接层运行态——缺省 tab=运行面；
    // 其余 kind 四 tab 不变——文档与资源同规则 E4 既有）。
    var tabs = kind === 'ConnectorOps'
      ? [['ops', '运行面'], ['llm', 'LLM 提案'], ['draft', '草稿'], ['hist', '历史'], ['meta', '元数据']]
      : [['llm', 'LLM 提案'], ['draft', '草稿'], ['hist', '历史'], ['meta', '元数据']];
    var tab = S.docTab[key] || (kind === 'ConnectorOps' ? 'ops' : 'llm');
    view.innerHTML = '<div class="view-inner"><div class="doc-layout"><div class="doc-main">' +
      '<div class="doc-headbar"><span class="doc-path">' + esc(scope) + '/' + esc(name) + '</span>' + kindBadge(kind) +
      '<span id="ed-draft-chip"></span></div>' +
      '<div class="doc-meta-row"><span class="chip mute small">scope</span>' +
      '<span class="chip click mute small" data-act="go" data-go="' + (scope === 'global' || scope === 'builtin' ? 'tree' : 's/' + esc(encodeURIComponent(scope))) + '">' + esc(scope) + '</span>' +
      '<span class="mono small" id="ed-rev-chip">r?</span>' +
      '<span class="chip ok small">' + esc(kind) + ' 在册</span></div>' +
      '<div class="doc-editor-wrap"><textarea class="doc-editor" id="doc-editor" spellcheck="false" disabled></textarea></div>' +
      '<div class="small faint">编辑即累积草稿（POST /core-console/drafts——不触文档面、不发事件）；Apply 唯一入口=右栏「草稿」tab 吸底按钮（人点为准；LLM 只在右侧提案，机制上无 Apply 权）。</div>' +
      '</div>' +
      '<div class="doc-collab"><div class="collab-tabs">' + tabs.map(function (t) {
        return '<div class="collab-tab' + (tab === t[0] ? ' active' : '') + '" data-act="doc-tab" data-t="' + t[0] + '" id="ctab-' + t[0] + '">' + t[1] + '<span class="ct-badge" id="ctab-badge-' + t[0] + '" hidden></span></div>';
      }).join('') + '</div><div class="collab-body" id="collab-body"></div></div></div></div>';
  }

  // —— 注水：面正文（乐观锁基准）+ 草稿缓存（工作副本来源）——
  function hydrateEditor(kind, scope, name) {
    var key = edKey(kind, scope, name);
    var stamp = S.route + '|' + S.segs.join('/');
    // WorkService 读面缺口守卫已摘除（v0.44 收口：storage 模板归 global 桶——单对象 GET 可寻址，
    // adoption §1.15）；守卫存在前提=读面缺口，缺口不在即摘除，勿留死分支。
    var faceP = LIVE.fetchObject(kind, scope, name);
    var row = draftRowOf(kind, scope, name); // 草稿存在性=清单判别（无稿零请求——404 fetch 会进浏览器 console error，违 L36-06）
    var draftP = row ? LIVE.get('v1/drafts/' + encodeURIComponent(kind) + '/' + encodeURIComponent(name) +
      (scope ? '?scope=' + encodeURIComponent(scope) : '')).catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([faceP, draftP]).then(function (rs) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return; // 路由已变=丢弃（不跨屏串数据）
      var face = rs[0], dr = rs[1];
      var prev = S.ED[key];
      var base = String(face.content || '');
      var working = dr ? String(dr.content || '') : base;
      var entries = [];
      if (dr && working !== base) {
        entries.push({
          source: isConsoleFM(dr.fieldManager) ? 'manual' : 'llm',
          summary: isConsoleFM(dr.fieldManager) ? '未落草稿（fieldManager: ' + dr.fieldManager + '）' : 'LLM 提案在稿（fieldManager: ' + dr.fieldManager + '）',
          ts: dr.updatedAt ? new Date(dr.updatedAt) : new Date(),
        });
      }
      S.ED[key] = {
        kind: kind, scope: scope, name: name,
        working: working, base: base,
        faceRV: Number(face.resourceVersion),
        baseRV: dr ? Number(dr.baseResourceVersion) : Number(face.resourceVersion), // 乐观锁期望值（不静默重基——409 走稿保留语义）
        draftFM: dr ? String(dr.fieldManager || '') : '',
        reasonRef: dr ? String(dr.reasonRef || '') : '',
        entries: (prev && prev.loaded) ? prev.entries : entries,
        loaded: true,
        adopted: (prev && prev.loaded) ? (prev.adopted || {}) : {},
      };
      paintEditorBody(kind, scope, name);
      paintEdBadges(kind, scope, name);
      renderCollabBody(kind, scope, name);
      bindEditorInput(kind, scope, name);
    }).catch(function (e) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
      var ta = $('#doc-editor');
      if (ta) ta.value = '';
      var chip = $('#ed-rev-chip');
      if (chip) chip.textContent = '读面暂不可达（' + String((e && e.message) || e) + '）——恢复后重进即现读';
    });
  }

  function paintEditorBody(kind, scope, name) {
    var ed = edOf(kind, scope, name);
    var ta = $('#doc-editor');
    if (!ed || !ta) return;
    ta.value = ed.working;
    ta.disabled = false;
    var rev = $('#ed-rev-chip');
    if (rev) rev.textContent = 'r' + ed.faceRV + '（乐观锁基准）';
  }

  // —— 徽章/dock 的原位更新（编辑中不整屏重渲染——textarea 焦点保真）——
  function paintEdBadges(kind, scope, name) {
    var ed = edOf(kind, scope, name);
    if (!ed) return;
    var has = edHasDiff(ed);
    var hunks = has ? hunksOf(diffLines(ed.base, ed.working)) : 0;
    var chip = $('#ed-draft-chip');
    if (chip) {
      chip.className = has ? 'chip warn small' : 'chip ok small';
      chip.textContent = has ? '● 未 Apply（草稿 ' + hunks + ' 处变更）' : '无草稿';
    }
    var badge = $('#ctab-badge-draft');
    if (badge) { badge.hidden = !has; badge.textContent = has ? String(ed.entries.length || hunks) : ''; }
    var dock = $('#apply-dock-btn');
    if (dock) {
      dock.disabled = !has;
      dock.textContent = has ? 'Apply（' + hunks + ' 处变更）' : 'Apply（无变更）';
    }
  }

  // —— 草稿落稿（debounced；写穿 cored 草稿缓存——编辑的家）——
  var ED_TIMERS = {};
  function bindEditorInput(kind, scope, name) {
    var ta = $('#doc-editor');
    if (!ta) return;
    ta.addEventListener('input', function () {
      var ed = edOf(kind, scope, name);
      if (!ed) return;
      ed.working = ta.value;
      var has = ed.working !== ed.base;
      if (has && !ed.entries.filter(function (e) { return e.source === 'manual'; }).length) {
        ed.entries.push({ source: 'manual', summary: '手动编辑（编辑器直改）', ts: new Date() });
      }
      if (!has) ed.entries = ed.entries.filter(function (e) { return e.source !== 'manual'; });
      paintEdBadges(kind, scope, name);
      clearTimeout(ED_TIMERS[edKey(kind, scope, name)]);
      ED_TIMERS[edKey(kind, scope, name)] = setTimeout(function () { landDraft(kind, scope, name); }, 800);
    });
  }
  function landDraft(kind, scope, name) {
    var ed = edOf(kind, scope, name);
    if (!ed || !ed.loaded) return Promise.resolve(false);
    if (ed.working === ed.base) return Promise.resolve(true); // 空稿不落（无操作）
    var payload = {
      kind: kind, scope: scope, name: name, content: ed.working,
      fieldManager: edConsoleFM(kind, scope, name), reasonRef: 'console:editor',
      baseResourceVersion: ed.baseRV, // 乐观锁期望值=编辑器基准（不静默重基；面已前移则 apply 409 稿保留）
    };
    return fetch('/core-console/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(payload),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // live 草稿快照原位更新（树草稿圆点/徽章数据源；不整轮 reload）
      var row = draftRowOf(kind, scope, name);
      var slim = { kind: kind, scope: scope, name: name, fieldManager: payload.fieldManager,
        baseResourceVersion: ed.baseRV, updatedAt: new Date().toISOString(), bytes: ed.working.length };
      if (row) { Object.keys(slim).forEach(function (k) { row[k] = slim[k]; }); }
      else LIVE.state.drafts.push(slim);
      ed.landed = true;
      paintEdBadges(kind, scope, name);
      return true;
    }).catch(function (e) {
      toast('草稿未落（' + String((e && e.message) || e) + '）', '工作副本本地保留——恢复后再编辑即重落；Apply 前会先重落一次', 'warn');
      return false;
    });
  }

  // —— 右栏协作面板四 tab ——
  function renderCollabBody(kind, scope, name) {
    var key = edKey(kind, scope, name);
    var tab = S.docTab[key] || (kind === 'ConnectorOps' ? 'ops' : 'llm');
    var el = $('#collab-body');
    if (!el) return;
    if (tab === 'ops') { el.innerHTML = opsTabHtml(kind, scope, name); if (name === 'agent-comm') hydrateCommLive(kind, scope, name); return; }
    if (tab === 'llm') { el.innerHTML = llmTabHtml(kind, scope, name); hydrateProposals(kind, scope, name); return; }
    if (tab === 'draft') { el.innerHTML = draftTabHtml(kind, scope, name); return; }
    if (tab === 'hist') { el.innerHTML = '<div id="ed-history" style="padding:8px 2px">' + liveSkeletonRows(2, 0) + '</div>'; hydrateHistory(kind, scope, name); return; } // 骨架带宿主 id——hydrate 注水点
    el.innerHTML = metaTabHtml(kind, scope, name); // meta
  }

  // LLM 提案 tab：草稿缓存中 fieldManager 非 console: 前缀的稿=提案卡（排队等人裁）。
  // 真实生成面=Agent 会话经草稿通道落稿（会话页提案卡深链至此=E5 接线余量，如实标注）。
  function llmTabHtml(kind, scope, name) {
    var ed = edOf(kind, scope, name);
    var props = (LIVE.state.drafts || []).filter(function (d) {
      return d.kind === kind && d.scope === scope && d.name === name && !isConsoleFM(d.fieldManager);
    });
    var adopted = ed ? (ed.adopted || {}) : {};
    var cards = props.map(function (d) {
      var k = d.fieldManager;
      var done = adopted[k];
      return '<div class="draft-card" id="prop-card"><div class="dc-head"><svg class="ic"><use href="#cc-i-spark"/></svg>LLM 提案 · <span class="mono">' + esc(d.fieldManager) + '</span>' +
        (d.reasonRef ? '<span class="faint mono small"> ' + esc(d.reasonRef) + '</span>' : '') + '</div>' +
        '<div class="dc-body" id="prop-diff">' + liveSkeletonRows(2, 0) + '</div>' +
        '<div class="dc-acts">' + (done
          ? '<span class="chip ok small">已采纳——草稿 tab 统一 Apply</span>'
          : '<button class="btn sm llm" data-act="prop-adopt" data-fm="' + esc(k) + '">加入草稿</button><button class="btn sm" data-act="prop-drop" data-fm="' + esc(k) + '">丢弃</button>') +
        '<span class="faint mono small" style="margin-left:auto">' + esc(fmtAgo(new Date(d.updatedAt))) + '</span></div></div>';
    }).join('');
    return (cards || '<div class="empty" style="padding:22px"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">暂无排队提案</div>' +
      '<div>LLM 提案由 Agent 经草稿通道落稿（fieldManager=agent 名）；会话页提案卡深链至此（E5 接线余量）。机制上 LLM 无 Apply 权——提案止步这里。</div></div>') +
      '<div class="small faint" style="padding:8px 2px">提案 diff 基准=文档面现值（r' + (ed ? ed.faceRV : '?') + '）；采纳后与手动编辑走同一草稿通道，Apply 仍须人点。</div>';
  }

  function hydrateProposals(kind, scope, name) {
    var stamp = S.route + '|' + S.segs.join('/');
    var props = (LIVE.state.drafts || []).filter(function (d) {
      return d.kind === kind && d.scope === scope && d.name === name && !isConsoleFM(d.fieldManager);
    });
    if (!props.length) return;
    LIVE.get('v1/drafts/' + encodeURIComponent(kind) + '/' + encodeURIComponent(name) + '?scope=' + encodeURIComponent(scope))
      .then(function (b) {
        if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
        var el = $('#prop-diff');
        if (!el) return;
        var content = String(b.content || '');
        if (content === edBaseOf(kind, scope, name)) {
          el.innerHTML = '<span class="faint small">提案与文档面一致（noop 稿）</span>';
          return;
        }
        el.innerHTML = renderDiff(diffLines(edBaseOf(kind, scope, name), content), 30);
      })
      .catch(function () {
        var el = $('#prop-diff');
        if (el) el.innerHTML = '<span class="faint small">提案正文暂不可读（读面退化）</span>';
      });
  }
  function edBaseOf(kind, scope, name) {
    var ed = edOf(kind, scope, name);
    return ed ? ed.base : '';
  }

  // 草稿 tab：累积 diff + 条目留痕 + 吸底 Apply dock（人点为准）。
  function draftTabHtml(kind, scope, name) {
    var ed = edOf(kind, scope, name);
    if (!ed || !ed.loaded) return liveSkeletonRows(3, 0);
    var has = edHasDiff(ed);
    var entries = has && ed.entries.length ? ed.entries.map(function (e) {
      return '<div class="draft-item"><div class="di-head"><span class="di-src ' + e.source + '">' + (e.source === 'llm' ? 'LLM' : '手动') + '</span>' +
        '<span>' + esc(e.summary) + '</span><span class="faint mono small" style="margin-left:auto">' + esc(fmtAgo(e.ts instanceof Date ? e.ts : new Date(e.ts))) + '</span></div></div>';
    }).join('') : '';
    var diffBlock = has
      ? '<div class="hr"></div><div class="sec-title">完整草稿 diff（base r' + ed.faceRV + ' → 草稿）</div>' + renderDiff(diffLines(ed.base, ed.working), 60)
      : '<div class="empty" style="padding:26px"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">草稿区为空</div>' +
        '<div>编辑左侧内容或采纳右侧 LLM 提案；改动先落草稿，Apply 才落库（Revision+1 · DocApplied）。</div></div>';
    return '<div style="flex:1;overflow-y:auto;min-height:0">' + entries + diffBlock +
      (has ? '<div class="lk small" style="display:inline-block;margin:6px 0" data-act="draft-discard">弃稿（清空草稿，不落库）</div>' : '') + '</div>' +
      '<div class="apply-dock"><div class="hint">Apply = 唯一写路径：dry-run 三检查（scheme/权限/乐观锁）→ 落库 Revision+1 → DocApplied 必发 → 清稿。空草稿=无操作。</div>' +
      '<button class="btn primary lg block" data-act="doc-apply" id="apply-dock-btn" ' + (has ? '' : 'disabled') + '>Apply（' + (has ? hunksOf(diffLines(ed.base, ed.working)) + ' 处变更' : '无变更') + '）</button></div>';
  }

  // 历史 tab：apply_log 投影（rev 流水的权威=审计账；git 权威在正文）。
  function hydrateHistory(kind, scope, name) {
    hydrate('ed-history', 'v1/history/' + encodeURIComponent(kind) + '/' + encodeURIComponent(name) + (scope ? '?scope=' + encodeURIComponent(scope) : ''),
      function (el, b) {
        var rows = (b.entries || []).map(function (h) {
          var cls = h.result === 'ok' ? 'ok' : (h.result === 'denied' || h.result === 'conflict') ? 'danger' : 'mute';
          return '<div class="rev-item"><span class="rv-no">' + (h.result === 'ok' ? 'r' + h.rv : h.result) + '</span>' +
            '<span class="rv-author mono">' + esc(h.fieldManager || '—') + '</span>' +
            '<span class="rv-sum">' + esc(h.result) + (h.reasonRef ? ' · ' + esc(h.reasonRef) : '') + (h.subject ? '<br><span class="mono faint">' + esc(h.subject) + '</span>' : '') + '<br><span class="mono">' + esc(fmtAgo(new Date(h.ts))) + '</span></span>' +
            '<span class="chip ' + cls + ' small">' + esc(h.result) + '</span></div>';
        }).join('');
        el.innerHTML = (rows || '<div class="faint small" style="padding:8px 2px">归档窗内暂无应用流水（该对象尚未 Apply 过）</div>') +
          '<div class="small faint" style="margin-top:8px">数据源=ops DB apply_log（一次 Apply 判定的流水：ok/noop/conflict/denied 全在账）；点行 diff 上一版=rev-content 面余量（git show 面未开，如实标注）。</div>';
      });
  }

  // 元数据 tab：对象身份键+rev+草稿态+写路径（与资源同规则）。
  function metaTabHtml(kind, scope, name) {
    var ed = edOf(kind, scope, name);
    var dr = draftRowOf(kind, scope, name);
    var kv = function (k, v) { return '<div class="kv" style="margin-bottom:6px"><span class="k mono">' + esc(k) + '</span><span class="v mono">' + (v || '<span class="faint">—</span>') + '</span></div>'; };
    var draftState = dr
      ? '在册 · fieldManager ' + esc(dr.fieldManager) + ' · baseRV r' + dr.baseResourceVersion + ' · ' + esc(fmtAgo(new Date(dr.updatedAt)))
      : '无（工作副本==文档面）';
    return '<div style="flex:1;overflow-y:auto"><div class="sec-title">对象规则（与资源同构）</div>' +
      kv('kind', esc(kind)) + kv('scope', esc(scope)) + kv('name', esc(name)) +
      kv('resourceVersion', ed ? 'r' + ed.faceRV + '（乐观锁）' : '?') +
      kv('草稿', draftState) +
      kv('写路径', '草稿 → 人点 Apply（dry-run 三检查）→ Revision+1 → DocApplied') +
      '<div class="hr"></div><div class="sec-title">正文引用标识符（全可点）</div><div style="padding:2px">' +
      (ed ? (refChips(ed.base) || '<span class="faint small">无 scheme 引用词（system:// agent:// ops:// …）</span>') : '') + '</div></div>';
  }

  /* --- 编辑器动作 --- */
  ACTIONS['doc-tab'] = function (el) {
    var p = S.params;
    var ctx = edCtx();
    if (!ctx) return;
    S.docTab[edKey(ctx.kind, ctx.scope, ctx.name)] = el.dataset.t;
    render();
  };
  // 当前编辑器对象的键上下文（优先 ED 在册态——doc/:name 深链时 params.kind 可能缺席）
  function edCtx() {
    var p = S.params;
    if (!p || !p.name) return null;
    if (p.kind) return { kind: p.kind, scope: p.scope || '', name: p.name };
    for (var k in S.ED) {
      if (k.split('/')[2] === p.name) {
        var ed = S.ED[k];
        return { kind: ed.kind, scope: ed.scope, name: ed.name };
      }
    }
    return null;
  }

  // 采纳提案：以提案内容替换工作副本（与手动编辑同一草稿通道——Apply 仍须人点）。
  ACTIONS['prop-adopt'] = function (el) {
    var ctx = edCtx();
    if (!ctx) return;
    var ed = edOf(ctx.kind, ctx.scope, ctx.name);
    if (!ed) return;
    var fm = el.dataset.fm;
    LIVE.get('v1/drafts/' + encodeURIComponent(ctx.kind) + '/' + encodeURIComponent(ctx.name) + '?scope=' + encodeURIComponent(ctx.scope))
      .then(function (b) {
        ed.working = String(b.content || '');
        ed.baseRV = Number(b.baseResourceVersion != null ? b.baseResourceVersion : ed.faceRV); // 乐观锁期望值随稿走（不静默重基）
        ed.draftFM = String(b.fieldManager || fm);
        ed.reasonRef = String(b.reasonRef || '');
        ed.adopted[fm] = true;
        ed.entries.push({ source: 'llm', summary: '采纳提案（fieldManager: ' + fm + '）', ts: new Date() });
        var ta = $('#doc-editor');
        if (ta) ta.value = ed.working;
        paintEdBadges(ctx.kind, ctx.scope, ctx.name);
        renderCollabBody(ctx.kind, ctx.scope, ctx.name);
        toast('提案已加入草稿（未落库）', '乐观锁期望值=r' + ed.baseRV + '——面上已前移则 Apply 弹窗如实判 ✗（409 稿保留）', 'ok');
      })
      .catch(function (e) { toast('提案正文不可读', String((e && e.message) || e), 'danger'); });
  };

  // 丢弃提案：DELETE 弃稿（人裁不通过=弃；cored §2.2 弃稿=缓存行删除，零文档面零事件）。
  ACTIONS['prop-drop'] = function (el) {
    var ctx = edCtx();
    if (!ctx) return;
    var fm = el.dataset.fm;
    fetch('/core-console/drafts/' + encodeURIComponent(ctx.kind) + '/' + encodeURIComponent(ctx.name) + '?scope=' + encodeURIComponent(ctx.scope), {
      method: 'DELETE', credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status); // 404=本来无稿（幂等清场）
      LIVE.state.drafts = (LIVE.state.drafts || []).filter(function (d) {
        return !(d.kind === ctx.kind && d.scope === ctx.scope && d.name === ctx.name);
      });
      toast('提案已丢弃', 'fieldManager: ' + fm + '（草稿缓存清空，文档面不动）', 'warn');
      renderCollabBody(ctx.kind, ctx.scope, ctx.name);
      paintEdBadges(ctx.kind, ctx.scope, ctx.name);
    }).catch(function (e) { toast('弃稿失败', String((e && e.message) || e), 'danger'); });
  };

  // 弃稿（草稿 tab）：清空工作副本+删缓存稿。
  ACTIONS['draft-discard'] = function () {
    var ctx = edCtx();
    if (!ctx) return;
    var ed = edOf(ctx.kind, ctx.scope, ctx.name);
    if (!ed) return;
    fetch('/core-console/drafts/' + encodeURIComponent(ctx.kind) + '/' + encodeURIComponent(ctx.name) + '?scope=' + encodeURIComponent(ctx.scope), {
      method: 'DELETE', credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status); // 404=本来无稿（幂等清场）
      LIVE.state.drafts = (LIVE.state.drafts || []).filter(function (d) {
        return !(d.kind === ctx.kind && d.scope === ctx.scope && d.name === ctx.name);
      });
      ed.working = ed.base;
      ed.entries = [];
      ed.adopted = {};
      ed.landed = false;
      var ta = $('#doc-editor');
      if (ta) ta.value = ed.working;
      paintEdBadges(ctx.kind, ctx.scope, ctx.name);
      renderCollabBody(ctx.kind, ctx.scope, ctx.name);
      toast('草稿已弃', '工作副本回到文档面 r' + ed.faceRV + '（零落库零事件）', 'warn');
    }).catch(function (e) { toast('弃稿失败', String((e && e.message) || e), 'danger'); });
  };

  /* --- Apply 全流程（E4：dry-run 三检查→人确认→fromDraft 落库） --- */
  ACTIONS['doc-apply'] = function () {
    var ctx = edCtx();
    if (!ctx) return;
    var ed = edOf(ctx.kind, ctx.scope, ctx.name);
    if (!ed || !ed.loaded) return;
    if (ed.working === ed.base) { toast('空草稿——无操作', '草稿与文档面无差异：不落库、不发事件、不清稿（提示即止）'); return; }
    // 先落稿（缓存=差异唯一来源；落稿失败=中止 Apply——写路径必须走稿）
    landDraft(ctx.kind, ctx.scope, ctx.name).then(function (landed) {
      if (!landed) return;
      var fullDiff = diffLines(ed.base, ed.working);
      var stats = diffStats(fullDiff);
      openModal(
        '<div class="modal-h"><span class="m-title">Apply 确认 · ' + esc(ctx.scope) + '/' + esc(ctx.name) + '</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
        '<div class="modal-b">' +
        '<div class="kv" style="margin-bottom:12px"><span class="k">变更</span><span class="v"><span class="chip ok small">+' + stats.add + '</span> <span class="chip danger small">-' + stats.del + '</span> · 来源 ' +
          (ed.entries.map(function (e) { return e.source === 'llm' ? 'LLM' : '手动'; }).join('+') || '手动') + '</span></div>' +
        '<div class="checklist" id="ed-checks">' +
        '<div class="check-item" data-c="scheme"><span class="ci-ic">…</span>Scheme 校验（kind 注册∧spec 结构）</div>' +
        '<div class="check-item" data-c="perm"><span class="ci-ic">…</span>权限准入（主体=宿主注入 console-operator）</div>' +
        '<div class="check-item" data-c="lock"><span class="ci-ic">…</span>乐观锁（稿基于 r' + ed.baseRV + ' ↔ 面上现值）</div></div>' +
        renderDiff(fullDiff, 26) +
        '<div class="small faint" id="ed-dry-note" style="margin-top:6px">dry-run 预检中（POST /core-console/apply {fromDraft:true, dryRun:true}——零副作用）…</div>' +
        '</div>' +
        '<div class="modal-f"><button class="btn" data-act="close-modal">取消</button><button class="btn primary" id="ed-apply-go" disabled>确认 Apply</button></div>',
        { cls: 'wide' });
      // dry-run 三检查（引擎 admit ①scheme②权限 零副作用预检；③乐观锁=回执 rv 与稿 baseRV 客户端比对）
      LIVE.apply({ kind: ctx.kind, scope: ctx.scope, name: ctx.name, fromDraft: true, dryRun: true,
        fieldManager: edConsoleFM(ctx.kind, ctx.scope, ctx.name), reasonRef: 'console:apply-dry' }).then(function (res) {
        var mark = function (c, ok, note) {
          var row = $('.check-item[data-c="' + c + '"]');
          if (!row) return;
          row.classList.add(ok ? 'pass' : 'fail');
          var ic = row.querySelector('.ci-ic');
          if (ic) { ic.textContent = ok ? '✓' : '✗'; ic.style.color = ok ? 'var(--ok)' : 'var(--danger)'; }
          if (note) {
            var n = document.createElement('span');
            n.className = 'ci-note';
            n.textContent = note;
            row.appendChild(n);
          }
        };
        if (res.ok && res.data && res.data.action === 'dry-run') {
          mark('scheme', true, 'kind 在册∧spec 结构过（cored admit ①）');
          mark('perm', true, '主体准入过（cored admit ②——Role/Group 文档面判定）');
          var cur = Number(res.data.rv);
          var lockOk = cur === ed.baseRV;
          mark('lock', lockOk, lockOk ? 'r' + ed.baseRV + ' == 面上现值（可落）' : '稿基于 r' + ed.baseRV + '，面上已 r' + cur + '——落库将 409（稿保留，重读后重整）');
          var note = $('#ed-dry-note');
          if (note) note.textContent = 'dry-run 通过预检（rv 回执=r' + cur + '）——确认后真落库。';
          var go = $('#ed-apply-go');
          if (go && lockOk) {
            go.disabled = false;
            go.addEventListener('click', function () {
              go.disabled = true;
              LIVE.apply({ kind: ctx.kind, scope: ctx.scope, name: ctx.name, fromDraft: true,
                fieldManager: edConsoleFM(ctx.kind, ctx.scope, ctx.name), reasonRef: 'console:apply' }).then(function (r2) {
                if (r2.ok) {
                  closeModal();
                  toast('已落库 r' + r2.data.rv + '（' + (r2.data.action === 'noop' ? 'noop：稿与面一致，零提交' : 'Revision+1') + '）',
                    ctx.name + ' · DocApplied 已归档 · 草稿已清（apply.md rule 6）', 'ok');
                  delete S.ED[edKey(ctx.kind, ctx.scope, ctx.name)]; // 会话态作废——重进即现读新面
                  LIVE.state.drafts = (LIVE.state.drafts || []).filter(function (d) {
                    return !(d.kind === ctx.kind && d.scope === ctx.scope && d.name === ctx.name);
                  });
                  LIVE.load().then(function () { render(); });
                } else if (r2.status === 409) {
                  closeModal();
                  toast('乐观锁冲突（409）——稿保留', '文档面前移（' + String(r2.error || '') + '）——重读后重整草稿再落（apply.md §3 后写者语义）', 'danger');
                  delete S.ED[edKey(ctx.kind, ctx.scope, ctx.name)];
                  render();
                } else {
                  toast('Apply 失败（' + (r2.status == null ? '传输层' : 'HTTP ' + r2.status) + '）', String(r2.error || ''), 'danger');
                }
              });
            });
          }
        } else {
          var st = res.status;
          var schemeFail = st === 404 || st === 400; // 野 kind=404；spec 结构未过=400
          mark('scheme', !schemeFail, schemeFail ? String(res.error || ('HTTP ' + st)) : '—');
          mark('perm', st !== 403, st === 403 ? String(res.error || '权限准入拒绝') : (schemeFail ? '—' : String(res.error || '')));
          mark('lock', false, '预检未过（' + (st == null ? '传输层' : 'HTTP ' + st) + '）');
          var note2 = $('#ed-dry-note');
          if (note2) note2.textContent = 'dry-run 未通过（' + (res.error || 'HTTP ' + st) + '）——改正草稿或主体后再试。';
        }
      });
    });
  };
  /* ================= 屏 7：Agent 对话（E5 真数据换装，console-adoption.md §1.11） =================
   * 数据源裁决（§3.7）：左栏会话=dsh session store（ctx.sessions，不复制状态）；中栏转录=
   * session 事件页读面（remote.session.page，user/assistant/tool 事件最小渲染）；发消息=
   * session.prompt 真通路（cross-agent.md §5.7 #2）；右栏权限面=cored 读面 Agent 文档面
   * （spec.connectorOps/providers/refs/roles——渲染数据无双源红线：会话运行态=dsh session store
   * 是 §3.7 显式裁决，与文档面/资源状态=cored 各管一面）。 */
  function CHAT() { return __CC.chat; }
  var chatAdCached = null;
  function chatAd() {
    if (!chatAdCached || !chatAdCached.ready()) chatAdCached = CHAT().bindFaces();
    return chatAdCached;
  }
  // 会话 UI 态（内存 UI 态，不落库=console 零持久状态）
  S.chatTranscript = {};  // sessionId -> {at, items, hasMore}
  S.chatHold = null;      // {sessionId, handle}（retain 持有——转录活体源，随屏切换释放）
  S.chatOwned = {};       // agent -> [sessionId]（console 发起=归属证据②）
  S.chatBusy = {};        // sessionId -> true（prompt 在途）
  S.chatMode = {};        // agent -> 'queue'|'steer'（缺省 queue）

  /** Agent 文档面引用行（cored 读面）：{kind,name,scope,resourceVersion}|null。 */
  function liveAgentRef(name) {
    LIVE.ensure();
    return LIVE.refByName('Agent', name);
  }
  /** Agent 文档面 status.currentSession.id 解析（归属证据①：身份=SessionId，§5.7 #1）。 */
  function agentCurrentSessionId(content) {
    var m = /currentSession:[\s\S]{0,160}?id:\s*["']?([A-Za-z0-9_.:-]+)["']?/.exec(content || '');
    return m ? m[1] : '';
  }
  /** Agent 文档面 connectorOps 挂载 refs（spec.connectorOps[].ops）。 */
  function agentConnectorOpsRefs(content) {
    var refs = [];
    var m = /connectorOps:[\s\S]*?(?=\n {0,4}[A-Za-z_]+:|\n*$)/.exec(content || '');
    if (!m) return refs;
    var re2 = /ops:\s*["']?([A-Za-z0-9-_.\/]+)["']?/g, x;
    while ((x = re2.exec(m[0]))) if (refs.indexOf(x[1]) < 0) refs.push(x[1]);
    return refs;
  }
  /** ConnectorOps 对象 spec.ops 名集（['dispatch',…] / 行式清单同吃）。 */
  function connectorOpsNames(content) {
    var out = [];
    var body = (content || '');
    var m = /ops:\s*\[([^\]]*)\]/.exec(body);
    if (m) {
      m[1].split(',').forEach(function (s) {
        var v = s.replace(/["'\s]/g, '');
        if (v) out.push(v);
      });
      return out;
    }
    var m2 = /ops:\s*\n((?:\s*-\s*[^\n]+\n?)+)/.exec(body);
    if (m2) {
      m2[1].split('\n').forEach(function (line) {
        var v = line.replace(/\s*-\s*/, '').replace(/["'\s]/g, '');
        if (v) out.push(v);
      });
    }
    return out;
  }
  /** 该 agent 的 ConnectorOps op 名声明集（挂载 refs × 对象 ops 并集）。 */
  function agentDeclaredOps(agentName) {
    var aref = liveAgentRef(agentName);
    if (!aref) return [];
    var content = LIVE.docContent('Agent', aref.scope, agentName);
    var refs = agentConnectorOpsRefs(content);
    var names = [];
    refs.forEach(function (r) {
      var refName = r.split('/')[r.split('/').length - 1];
      var oref = LIVE.refByName('ConnectorOps', refName);
      if (!oref) return;
      connectorOpsNames(LIVE.docContent('ConnectorOps', oref.scope, refName)).forEach(function (op) {
        if (names.indexOf(op) < 0) names.push(op);
      });
    });
    return names;
  }
  /** 归属证据（§3.7）：①文档面 currentSession.id ②console 发起（内存态）③agentRefs 显式 sessionId 形。 */
  function agentSessionEvidence(agentName) {
    var aref = liveAgentRef(agentName);
    var content = aref ? LIVE.docContent('Agent', aref.scope, agentName) : '';
    var ids = CHAT().sessionIdsOfRefs((content.match(/session:\/\/[A-Za-z0-9_.:-]+/g) || []));
    var cur = agentCurrentSessionId(content);
    if (cur && ids.indexOf(cur) < 0) ids.push(cur);
    (S.chatOwned[agentName] || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    return { currentSessionId: cur, ownedIds: ids };
  }
  /** owner 实例解析（ServiceDesc 正文 agent://<name> 反查）：{system,instance}|null。 */
  function agentOwnerOf(agentName) {
    LIVE.ensure();
    var rows = LIVE.state.objects.ServiceDesc || [];
    for (var i = 0; i < rows.length; i++) {
      var sd = rows[i];
      var content = LIVE.docContent('ServiceDesc', sd.scope, sd.name);
      if (content.indexOf('agent://' + agentName) < 0) continue;
      var m = /- name:\s*["']?([A-Za-z0-9-_.]+)["']?[\s\S]{0,200}?agent:\/\//.exec(content);
      if (m) return { system: sd.name, instance: m[1], scope: sd.scope };
    }
    return null;
  }
  function liveChatAgents() {
    LIVE.ensure();
    return (LIVE.state.objects.Agent || []).map(function (o) { return o.name; });
  }
  function screenChat(view) {
    var agentName = S.params.agent;
    var aref = liveAgentRef(agentName);
    if (!aref) {
      // 文档面未注册 agent=诚实空态（不冒充 mock agent）
      var known = liveChatAgents();
      view.innerHTML = '<div class="view-inner">' + emptyBox('agent 未注册（文档面 Agent 对象缺席）', agentName +
        (known.length ? ' · 在册：' + known.join(', ') : '')) + '</div>';
      setCrumbs([{ label: 'Welcome', go: 'welcome' }]);
      return;
    }
    LIVE.ensure();
    var ad = chatAd();
    var u = S.chatUi[agentName] = S.chatUi[agentName] || {};
    if (!u.view) u.view = 'chat';
    if (!u.tab) u.tab = 'chat';
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '会话', go: 'chat/' + esc(agentName) }, { label: agentName }]);
    var content = LIVE.docContent('Agent', aref.scope, agentName);
    var declaredOps = agentDeclaredOps(agentName);
    // —— 左栏：会话清单=dsh session store 投影（归属两层：本 agent / 宿主全部） ——
    var snap = ad.listSnapshot();
    var ev = agentSessionEvidence(agentName);
    var groups = CHAT().attributedSessions(snap.rows, ev);
    // 选择=UI 态：手动/新建选中的 sessionId 保留（宿主清单可能滞后于 create 的 api-session/added）；
    // 未选时才自动挑（本 agent 组优先）。行从清单消失且转录读面判 404 时由转录空态兜底。
    if (!u.sessionId) u.sessionId = (groups.mine[0] || groups.host[0] || {}).id || null;
    var sessRow = function (r, badge) {
      return '<div class="sess-row' + (r.id === u.sessionId ? ' sel' : '') + '" data-act="chat-sess" data-id="' + esc(r.id) + '">' +
        '<div class="ss-title">' + (r.running ? '<span class="lamp ok" style="display:inline-block;margin-right:4px"></span>' : '') + esc(r.title) + '</div>' +
        '<div class="ss-sub"><span class="mono">' + esc(r.id.slice(0, 12)) + '…</span><span class="faint">' + (r.updatedAt ? fmtAgo(new Date(r.updatedAt)) : '') + '</span>' +
        (badge ? '<span class="chip acc tiny">' + badge + '</span>' : '') + '</div></div>';
    };
    var mineHtml = groups.mine.map(function (r) { return sessRow(r, '本 agent'); }).join('');
    var hostHtml = groups.host.map(function (r) { return sessRow(r, ''); }).join('');
    if (!mineHtml && !hostHtml) {
      mineHtml = '<div class="empty" style="padding:26px"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">' +
        (ad.ready() ? '宿主会话清单为空' : '宿主会话面缺席') + '</div><div class="small faint">' +
        (ad.ready() ? '新建一个开始对话' : 'ctx.sessions 未在册——dsh session store 数据源缺席（诚实降级）') + '</div></div>';
    }
    var owner = agentOwnerOf(agentName);
    var ownerLink = owner
      ? '<span class="lk mono small" data-act="go" data-go="s/' + esc(owner.system) + '/i/' + esc(owner.instance) + '">' + esc(owner.system) + '/' + esc(owner.instance) + '</span>'
      : '<span class="faint small">未解析（ServiceDesc agentRefs 无此 agent）</span>';
    var left = '<div class="chat-sub"><div class="cs-head">' +
      '<div class="cs-agent"><span class="avatar" style="background:rgba(59,130,246,.2);color:#7fb0f9"><svg class="ic"><use href="#cc-i-bot"/></svg></span>' +
      '<div><div class="ca-name">' + esc(agentName) + '</div><div class="ca-sub mono">Agent@' + esc(aref.scope) + ' · r' + aref.resourceVersion + '</div></div></div>' +
      '<div class="cs-search mono small" style="color:var(--text-2)">owner: ' + ownerLink + '</div>' +
      '<button class="btn primary sm" data-act="chat-new" data-agent="' + esc(agentName) + '">+ 新建会话（运行器四选）</button>' +
      '</div><div class="cs-list">' +
      (mineHtml ? '<div class="sec-title small">本 agent 会话（' + groups.mine.length + '）</div>' + mineHtml : '') +
      '<div class="sec-title small faint">宿主全部会话（' + groups.host.length + '）——按 agent 归属证据过滤的投影，未归属行不冒充</div>' + hostHtml +
      '</div></div>';
    // —— 中栏：视图开关 + 转录/终端（对话/终端切换恒在册——终端 tab 可达性，E5 探针教训） ——
    var cur = snap.rows.filter(function (r) { return r.id === u.sessionId; })[0] || null;
    var mode = S.chatMode[agentName] || 'queue';
    var center = '<div class="chat-main">' +
      '<div class="chat-headbar">' +
      '<div class="view-switch">' +
      '<div class="vs-opt' + (u.view === 'chat' ? ' on' : '') + '" data-act="chat-view" data-v="chat">Chat</div>' +
      '<div class="vs-opt' + (u.view === 'traj' ? ' on' : '') + '" data-act="chat-view" data-v="traj">Trajectory</div></div>' +
      '<span style="font-weight:650;font-size:13px" class="mono">' + (cur ? esc(cur.title) : '无会话') + '</span>' +
      (cur && cur.running ? '<span class="chip ok tiny">running</span>' : '') +
      '<span style="margin-left:auto" class="small faint mono">' + (cur ? esc(cur.id) : '') + '</span>' +
      '<div class="view-switch" style="margin-left:8px">' +
      '<div class="vs-opt' + (mode === 'queue' ? ' on' : '') + '" data-act="chat-mode" data-m="queue" title="queue=追加一 turns">queue</div>' +
      '<div class="vs-opt' + (mode === 'steer' ? ' on' : '') + '" data-act="chat-mode" data-m="steer" title="steer=打断当前 turn 插话">steer</div></div>' +
      '</div>' +
      (cur ? '<div class="term-tabs">' +
        '<div class="term-tab' + (u.tab === 'chat' ? ' active' : '') + '" data-act="chat-tab" data-t="chat">对话</div>' +
        '<div class="term-tab' + (u.tab === 'term' ? ' active' : '') + '" data-act="chat-tab" data-t="term">终端</div></div>' : '') +
      (u.tab === 'term'
        ? chatTermTab(agentName, cur, ad)
        : '<div id="chat-body" data-sess="' + esc(u.sessionId || '') + '" data-agent="' + esc(agentName) + '">' + liveSkeletonRows(3) + '</div>') +
      '</div>';
    // —— 右栏：权限面=cored 读面 Agent 文档面（声明真数据；mock token 字样摘除） ——
    var opChips = function (refs, route) {
      return (refs || []).map(function (r) {
        var nm = String(r).split('/')[String(r).split('/').length - 1];
        return '<span class="chip click mute small" data-act="go" data-go="' + route + '/' + esc(nm) + '">' + esc(r) + '</span>';
      }).join(' ') || '<span class="faint small">—</span>';
    };
    var specBlock = function (key, re) {
      var m = re.exec(content || '');
      return m ? esc(m[1]) : '<span class="faint">—</span>';
    };
    var opsRefs = agentConnectorOpsRefs(content);
    var providers = (content.match(/providers?:[\s\S]{0,80}?- ?\W*([A-Za-z0-9-_.\/]+)/) || [])[1];
    var roles = (content.match(/roles:[\s\S]{0,80}?- ?\W*([A-Za-z0-9-_.\/]+)/) || [])[1];
    var refsList = (content.match(/\brefs:[\s\S]{0,120}?- ?\W*([A-Za-z0-9-_.\/]+)/) || [])[1];
    var autoLevel = specBlock('autoLevel', /autoLevel:\s*["']?([a-z]+)/);
    var right = '<div class="chat-ctx">' +
      '<div class="ctx-sec"><div class="cx-h">权限面（Agent 文档面 · cored 现读）</div><div class="cx-b">' +
      '<div class="ctx-row"><span class="cr-k">ConnectorOps</span>' + opChips(opsRefs, 'connector') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">Provider</span>' + (providers ? '<span class="chip click mute small" data-act="go" data-go="provider/' + esc(providers.split('/').pop()) + '">' + esc(providers) + '</span>' : '<span class="faint small">—</span>') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">Ref</span>' + (refsList ? '<span class="chip mute small mono">' + esc(refsList) + '</span>' : '<span class="faint small">—</span>') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">Role</span>' + (roles ? '<span class="chip click mute small" data-act="go" data-go="role/' + esc(roles.split('/').pop()) + '">' + esc(roles) + '</span>' : '<span class="faint small">—</span>') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">autoLevel</span><span class="mono small">' + autoLevel + '</span></div>' +
      '<div class="ctx-row"><span class="cr-k">op 声明集</span><span class="mono small">' + (declaredOps.length ? esc(declaredOps.join(' / ')) : '—（无挂载声明）') + '</span></div>' +
      '<div class="small faint" style="margin-top:4px">ConnectorOps 卡判别=本声明集（转录工具调用 op 名命中→ConnectorOps 卡）；权限 ⊆ 父 agent</div>' +
      '</div></div>' +
      '<div class="ctx-sec"><div class="cx-h">身份与归属（SessionId）</div><div class="cx-b">' +
      '<div class="ctx-row"><span class="cr-k">owner</span>' + ownerLink + '</div>' +
      '<div class="ctx-row"><span class="cr-k">当前会话</span><span class="mono small">' + (ev.currentSessionId ? esc(ev.currentSessionId) : '—（文档面 status.currentSession 未回写）') + '</span></div>' +
      '<div class="small faint" style="margin-top:4px">身份=SessionId（cross-agent.md §5.7 #1）：console 新建会话后 Apply 回填 status.currentSession</div>' +
      '</div></div>' +
      '<div class="ctx-sec"><div class="cx-h">详情</div><div class="cx-b"><span class="lk small" data-act="go" data-go="agent/' + esc(agentName) + '">agent 文档面（编辑器）→</span>' +
      (cur ? '<span class="lk small" data-act="go" data-go="session/' + esc(cur.id) + '">session 详情（trajectory）→</span>' : '') + '</div></div>' +
      '</div>';
    view.classList.add('nopad');
    view.innerHTML = '<div class="chat-layout">' + left + center + right + '</div>';
    if (u.tab !== 'term' && u.sessionId) loadTranscript(agentName, u.sessionId, u.view);
  }
  /** 转录装载+订阅（sessions.retain 持有 → binding.eventSource 事件窗活体投影）。
   *  调用链 throw-safe（faces 护栏/读面异常折为降级注记——骨架不停挂）；订阅=活体更新不轮询。
   *  同一会话已持有=复用持有（不重复 retain）。 */
  function loadTranscript(agentName, sessionId, viewType) {
    var declaredOps = agentDeclaredOps(agentName);
    var body = $('#chat-body');
    if (!body) return;
    try {
      var h = S.chatHold;
      if (!h || h.sessionId !== sessionId) {
        if (h) { try { h.handle.release(); } catch (e) { /* 已离场 */ } }
        var handle = chatAd().hold(sessionId);
        if (!handle) throw new Error('宿主会话面缺席（ctx.sessions 未在册）');
        S.chatHold = { sessionId: sessionId, handle: handle };
        h = S.chatHold;
      }
      var paint = function () {
        var el = $('#chat-body');
        if (!el || el.dataset.sess !== sessionId) return;
        var snap = h.handle.snapshot();
        S.chatTranscript[sessionId] = { at: Date.now(), items: CHAT().projectTranscript(snap.entries, declaredOps), hasMore: snap.hasMore };
        paintTranscript(agentName, sessionId, viewType);
      };
      h.handle.ready.then(function () {
        var cur = S.chatHold;
        if (!cur || cur.sessionId !== sessionId) return;
        h.handle.subscribe(function () { paint(); }); // 先订阅（早帧不丢）
        paint();
        // 冷会话开窗兜底：空窗时显式补拉一页（dsh loadOlder 原语）
        if (!h.handle.snapshot().entries.length) {
          h.handle.loadOlder().then(function (pulled) { if (pulled) paint(); });
        }
      }, function (e) {
        var el = $('#chat-body');
        if (el && el.dataset.sess === sessionId) {
          el.innerHTML = '<div class="chat-scroll"><div class="empty"><div class="e-title">转录读面暂不可达</div><div class="small faint">' +
            esc(String((e && e.message) || e)) + '——发消息通路不受影响（prompt 回执即接受证据）</div></div></div>' + chatInputBar(agentName);
          bindChatInput(agentName, sessionId);
        }
      });
      paint(); // 开窗快照可能已在（retain 即填）
    } catch (e) {
      body.innerHTML = '<div class="chat-scroll"><div class="empty"><div class="e-title">转录装载异常</div><div class="small faint">' +
        esc(String((e && e.message) || e)) + '</div></div></div>' + chatInputBar(agentName);
      bindChatInput(agentName, sessionId);
    }
  }
  function releaseChatHold() {
    var h = S.chatHold;
    if (h) { try { h.handle.release(); } catch (e) { /* 已离场 */ } S.chatHold = null; }
  }
  function paintTranscript(agentName, sessionId, viewType) {
    var body = $('#chat-body');
    var t = S.chatTranscript[sessionId];
    if (!body || body.dataset.sess !== sessionId || !t) return;
    var declaredOps = agentDeclaredOps(agentName);
    var items = t.items;
    if (viewType === 'traj') {
      var rows = items.map(function (it) {
        var kindCls = it.kind === 'user' ? 'user' : it.kind === 'assistant' ? 'agent' : 'tool';
        var label = it.kind === 'tool' ? (it.op + (it.connectorOps ? ' · ConnectorOps' : '')) : it.kind;
        return '<div class="traj-item kind-' + kindCls + '"><div class="traj-rail"><div class="traj-dot"></div><div class="traj-line"></div></div>' +
          '<div><div style="display:flex;gap:8px;align-items:center"><span class="traj-kind">' + esc(label) + '</span>' +
          '<span class="mono faint small">seq ' + esc(it.seq) + '</span></div>' +
          '<div class="traj-detail">' + esc(String(it.text || it.argsText || '').slice(0, 160)) + '</div></div></div>';
      }).join('');
      body.innerHTML = '<div class="traj-scroll">' + (rows || '<div class="empty"><div class="e-title">轨迹为空</div></div>') + '</div>';
      return;
    }
    var msgs = items.map(function (it) {
      if (it.kind === 'user' || it.kind === 'context') {
        return '<div class="msg-row"><div class="msg-avatar user">你</div><div class="msg-body">' +
          '<div class="msg-who"><span class="who-name">' + (it.kind === 'user' ? '你' : '上下文注入') + '</span><span class="mono">seq ' + esc(it.seq) + '</span></div>' +
          '<div class="msg-text">' + esc(it.text) + '</div></div></div>';
      }
      if (it.kind === 'assistant') {
        return '<div class="msg-row"><div class="msg-avatar agent">◆</div><div class="msg-body">' +
          '<div class="msg-who"><span class="who-name">' + esc(agentName) + '</span><span class="mono">seq ' + esc(it.seq) + '</span></div>' +
          '<div class="msg-text">' + esc(it.text || '') + (it.interrupted ? ' <span class="chip warn tiny">interrupted</span>' : '') + '</div>' +
          (it.usage ? '<div class="turn-tail"><span>tokens: ' + esc(String(it.usage.totalTokens != null ? it.usage.totalTokens : JSON.stringify(it.usage).slice(0, 40))) + '</span></div>' : '') +
          '</div></div>';
      }
      if (it.kind === 'tool') return toolCardHtml(it, declaredOps);
      return '';
    }).join('');
    var busy = S.chatBusy[sessionId];
    body.innerHTML = '<div class="chat-scroll" id="chat-scroll">' + (msgs || '<div class="empty"><div class="e-title">会话为空</div><div>发第一条消息</div></div>') +
      (busy ? '<div class="small faint" style="padding:8px 16px">prompt 在途（回执未返）…</div>' : '') + '</div>' + chatInputBar(agentName);
    bindChatInput(agentName, sessionId);
    var sc = $('#chat-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  }
  /** 工具卡（ConnectorOps 判别=agent 文档面声明集）：op 名等宽+payload 展开+凭据脱敏（值打码）。 */
  function toolCardHtml(it, declaredOps) {
    var isCop = CHAT().isConnectorOp(it.op, declaredOps);
    var payload = it.argsText || '';
    var result = it.result || '';
    var mask = function (s) {
      return String(s).replace(/("(?:password|token|secret|apiKey|api_key|authorization)"\s*:\s*)"[^"]*"/gi, '$1"***"');
    };
    return '<div class="msg-row"><div class="msg-body" style="margin-left:44px"><div class="mcard' + (isCop ? ' op' : '') + '">' +
      '<div class="mc-head" data-act="card-toggle"><svg class="ic"><use href="#cc-i-plug"/></svg>' +
      '<span class="mc-op">' + esc(it.op) + '</span>' +
      (isCop ? '<span class="chip acc tiny">ConnectorOps</span>' : '<span class="chip mute tiny">tool</span>') +
      (it.isError ? '<span class="chip danger tiny">isError</span>' : '') +
      '<span class="mono faint small">seq ' + esc(it.seq) + '</span>' +
      '<svg class="ic" style="margin-left:4px"><use href="#cc-i-down"/></svg></div>' +
      '<div class="mc-body" hidden><div class="kv"><span class="k">payload</span><span class="v"><pre class="mono" style="white-space:pre-wrap;font-size:11px">' + esc(mask(payload)) + '</pre></span>' +
      (result ? '<span class="k">result</span><span class="v"><pre class="mono" style="white-space:pre-wrap;font-size:11px">' + esc(mask(result)) + '</pre></span>' : '') +
      '</div></div></div></div></div>';
  }
  function chatInputBar(agentName) {
    var mode = S.chatMode[agentName] || 'queue';
    var ad = chatAd();
    return '<div class="chat-inputbar"><div class="chat-input-wrap">' +
      '<textarea id="chat-input" rows="1" placeholder="发送给 ' + esc(agentName) + '…（Enter 发送 · ' + mode + ' 模式；LLM 改文档只进草稿）"' + (ad.ready() ? '' : ' disabled') + '></textarea>' +
      '<button class="btn primary sm" data-act="chat-send"' + (ad.ready() ? '' : ' disabled') + '>发送</button></div>' +
      '<div class="chat-hints"><span>' + (ad.ready()
        ? kbd('Enter') + ' 发送 · ' + mode + ' 语义（cross-agent.md §5.7 #2）'
        : '宿主会话面缺席（ctx.sessions 未在册）——发送面诚实禁用') + '</span><span style="margin-left:auto">权限见右栏</span></div></div>';
  }
  function bindChatInput(agentName, sessionId) {
    var ta = $('#chat-input');
    if (!ta) return;
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatReal(agentName, sessionId, ta.value); }
    });
    ta.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(120, this.scrollHeight) + 'px'; });
  }
  /** 发消息真通路（§5.7 #2：session.prompt——queue|steer）；回执后转录重读。 */
  function sendChatReal(agentName, sessionId, text) {
    text = (text || '').trim();
    if (!text || !sessionId) return;
    var ad = chatAd();
    if (!ad.ready()) { toast('会话面缺席', 'ctx.sessions 未在册——发送面诚实禁用', 'warn'); return; }
    var mode = S.chatMode[agentName] || 'queue';
    S.chatBusy[sessionId] = true;
    paintTranscript(agentName, sessionId, 'chat');
    ad.prompt(sessionId, text, mode).then(function (res) {
      S.chatBusy[sessionId] = false;
      if (!res.ok) {
        toast('prompt 未接受', String(res.error || '').slice(0, 120), 'warn');
        var t = S.chatTranscript[sessionId];
        if (t) paintTranscript(agentName, sessionId, 'chat');
        return;
      }
      // 归属证据②在册（console 发起）；转录重读（用户回声由宿主事件面权威投影）
      var owned = S.chatOwned[agentName] = S.chatOwned[agentName] || [];
      if (owned.indexOf(sessionId) < 0) owned.push(sessionId);
      loadTranscript(agentName, sessionId, S.chatUi[agentName] ? S.chatUi[agentName].view : 'chat');
    });
  }
  /** 终端 tab（E5：dsh 内置 PTY 为主=主案，§5.7 #6）：
   *  roster=ctx.webTerminals.watch 真数据（face 缺席=诚实空态）；attach 渲染=xterm 依赖余量
   *  （宿主终端侧栏承载交互面——与会话同生命周期同鉴权）；gotty=跨机兜底余量标注。 */
  function chatTermTab(agentName, cur, ad) {
    var head = '<div class="term-tabs">' +
      '<div class="term-tab" data-act="chat-tab" data-t="chat">对话</div>' +
      '<div class="term-tab active" data-act="chat-tab" data-t="term">终端</div></div>';
    if (!cur) return head + '<div class="term-wrap"><div class="empty" style="padding:26px"><div class="e-title">无会话</div><div class="small faint">终端跟随会话（SessionId 作用域）——先选择或新建会话</div></div></div>';
    var roster = ad.terminals ? ad.terminals(cur.id) : null;
    var rosterHtml;
    if (!roster) {
      rosterHtml = '<div class="empty" style="padding:26px"><svg class="ic"><use href="#cc-i-term"/></svg><div class="e-title">宿主终端面缺席</div>' +
        '<div class="small faint">ctx.webTerminals 未在册——roster 只读面诚实降级（不冒充终端）</div></div>';
    } else {
      var list = roster.get() || [];
      rosterHtml = list.length
        ? '<table class="tbl"><thead><tr><th>终端</th><th>壳</th><th>状态</th></tr></thead><tbody>' +
          list.map(function (t) {
            return '<tr><td class="mono">' + esc(String(t.title || t.id || '')) + '</td><td class="mono small">' + esc(String(t.shellPath || t.shell || '—')) + '</td>' +
              '<td><span class="chip ' + (t.state === 'running' || t.running ? 'ok' : 'mute') + ' tiny">' + esc(String(t.state || (t.running ? 'running' : '—'))) + '</span></td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty" style="padding:22px"><div class="e-title">该会话暂无内置终端</div><div class="small faint">在宿主终端侧栏打开即在此在册（真 PTY，scrollback 1000，每会话 ≤8 路）</div></div>';
    }
    return head + '<div class="term-wrap"><div class="card" style="margin:12px"><div class="card-h"><span class="h-title">dsh 内置终端 roster（' + esc(cur.id.slice(0, 12)) + '…）</span></div>' +
      '<div class="card-b">' + rosterHtml +
      '<div class="small faint" style="margin-top:10px">主案=dsh 内置 PTY（remote.terminal.*：与会话同生命周期同鉴权；交互面=宿主终端侧栏——本屏 attach 渲染=xterm 依赖余量，如实标注不冒充）。</div>' +
      '<div class="small faint">gotty=跨机兜底（ServiceInstance 在别的机器、或终端需独立分享给无 console 权限者时经 piko 暴露）——本机不启用（§5.7 #6）。</div>' +
      '</div></div></div>';
  }
  ACTIONS['card-toggle'] = function (el) {
    var body = el.parentElement.querySelector('.mc-body');
    if (body) body.hidden = !body.hidden;
  };
  function paintSessListOnly(agent) { render(); }
  ACTIONS['chat-view'] = function (el) { S.chatUi[S.params.agent].view = el.dataset.v; if (S.chatUi[S.params.agent].sessionId) loadTranscript(S.params.agent, S.chatUi[S.params.agent].sessionId, el.dataset.v); else render(); };
  ACTIONS['chat-tab'] = function (el) { S.chatUi[S.params.agent].tab = el.dataset.t; render(); };
  ACTIONS['chat-mode'] = function (el) { S.chatMode[S.params.agent] = el.dataset.m; render(); };
  ACTIONS['chat-sess'] = function (el) {
    var u = S.chatUi[S.params.agent];
    u.sessionId = el.dataset.id; u.tab = 'chat'; u.view = 'chat';
    render();
  };
  // chat-pin/chat-archive 摘除：session store 行无置顶/归档客户端面（宿主权威态）——假动作按钮不冒充（红线 4）。
  ACTIONS['chat-new'] = function (el) {
    var agentName = el.dataset.agent || S.params.agent;
    var runners = CHAT().runnerList();
    var sel = 'dsh';
    openModal('<div class="modal-h"><span class="m-title">新建会话 · 运行器四选（cross-agent.md §5.7）</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b"><div class="runner-cards" id="runner-cards">' +
      runners.map(function (r) {
        return '<div class="runner-card' + (r.id === sel ? ' sel' : '') + (r.enabled ? '' : ' disabled') + '" data-runner="' + r.id + '"' + (r.enabled ? '' : ' title="' + esc(r.why) + '"') + '><div class="rc-name">' + esc(r.name) +
          (r.enabled ? '' : ' <span class="chip mute tiny">余量</span>') + '</div><div class="rc-desc">' + esc(r.desc) +
          (r.enabled ? '' : '<div class="small faint">' + esc(r.why) + '</div>') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="small faint" style="margin-top:10px">创建成功即 Apply 回填 Agent.status.currentSession（身份=SessionId，§5.7 #1）；不可用 runner 在册但禁用=诚实余量标注。</div></div>' +
      '<div class="modal-f"><button class="btn" data-act="close-modal">取消</button><button class="btn primary" id="sess-create">创建会话（内嵌 dsh）</button></div>');
    $all('#runner-cards .runner-card').forEach(function (c) {
      c.addEventListener('click', function () {
        var r = CHAT().runnerById(c.dataset.runner);
        if (!r || !r.enabled) { toast('runner 余量', r ? r.why : '未知 runner', 'warn'); return; } // 诚实余量：不可用不冒充可选
        $all('#runner-cards .runner-card').forEach(function (x) { x.classList.remove('sel'); });
        c.classList.add('sel');
        sel = c.dataset.runner;
      });
    });
    $('#sess-create').addEventListener('click', function () {
      var ad = chatAd();
      if (!ad.ready()) { toast('会话面缺席', 'ctx.sessions 未在册——创建面诚实禁用', 'warn'); return; }
      var btn = this; btn.disabled = true;
      ad.create({}).then(function (res) {
        if (!res.ok) { btn.disabled = false; toast('创建失败', String(res.error || '').slice(0, 140), 'warn'); return; }
        var owned = S.chatOwned[agentName] = S.chatOwned[agentName] || [];
        if (owned.indexOf(res.id) < 0) owned.push(res.id);
        closeModal();
        var u = S.chatUi[agentName] = S.chatUi[agentName] || {};
        u.sessionId = res.id; u.tab = 'chat'; u.view = 'chat';
        // 归属锚先落（rename/回填先于路由重渲染——渲染链异常不吞归属证据，E5 探针实证教训）
        ad.rename(res.id, 'console · ' + agentName).catch(function () {});
        backfillCurrentSession(agentName, res.id);
        go('chat/' + agentName);
        toast('会话已创建（内嵌 dsh）', 'SessionId=' + res.id + ' · status.currentSession 回填中');
      });
    });
  };
  /** Agent.status.currentSession 回填（身份=SessionId 的文档面落点，§5.7 #1/#2）：
   *  读现文 → 追加/更新 status 块 → 既有 apply 通路（主体宿主注入，rv 乐观锁）。
   *  已有 status 块的结构化合并=E5b 余量（诚实跳过并 toast，不盲写覆盖）。 */
  function backfillCurrentSession(agentName, sessionId) {
    var aref = liveAgentRef(agentName);
    if (!aref) return;
    LIVE.get('v1/objects/Agent/' + encodeURIComponent(agentName) + '?scope=' + encodeURIComponent(aref.scope)).then(function (b) {
      var content = String(b.content || '');
      if (/^status:/m.test(content)) {
        toast('currentSession 未回填（诚实余量）', 'Agent 文档已有 status 块——结构化合并=E5b 余量，不盲写覆盖', 'warn');
        return;
      }
      var startedAt = new Date().toISOString();
      var block = '\nstatus:\n  currentSession:\n    id: ' + sessionId + '\n    startedAt: ' + startedAt + '\n    docsLoaded: []\n';
      LIVE.apply({
        kind: 'Agent', scope: aref.scope, name: agentName,
        resourceVersion: b.resourceVersion,
        content: content.replace(/\n*$/, '\n') + block,
        fieldManager: 'console:chat-backfill',
        reasonRef: 'console E5: chat session create'
      }).then(function (res) {
        if (res.ok) {
          toast('currentSession 已回填', 'Agent/' + agentName + ' → rv' + (res.data && res.data.rv != null ? res.data.rv : '?') + '（身份=SessionId）');
          LIVE.load().then(function () { if (S.route === 'chat') render(); });
        } else {
          toast('回填未落库（' + (res.status == null ? '传输层' : 'HTTP ' + res.status) + '）', String(res.error || '').slice(0, 140), 'warn');
        }
      });
    }).catch(function (e) {
      toast('回填预读失败', String((e && e.message) || e).slice(0, 140), 'warn');
    });
  }
  ACTIONS['chat-send'] = function () {
    var ta = $('#chat-input');
    var u = S.chatUi[S.params.agent] || {};
    if (ta && u.sessionId) sendChatReal(S.params.agent, u.sessionId, ta.value);
  };
  /* ================= 屏 8：连接（E6 真数据换装，console-adoption.md §1.13） =================
   * 三组=cored objects 跨 scope 枚举（E2 通路复用，渲染数据无双源）；ConnectorOps 详情=
   * 编辑器屏第五 tab「运行面」（route 零改动——文档与资源同规则 E4 既有）。
   * agent-comm 运行面数据源=GET /core-console/comm（插件宿主 comm 落账快照——协议运行时
   * 自身记账，console 只渲染）；token 值永不出现（落账只记 hasToken）。 */
  function connCard(o, route, sub) {
    return '<div class="conncard" data-act="go" data-go="' + route + '">' +
      '<div class="cc-top"><span class="chip ok small">' + esc(o.kind) + '</span><span class="cc-name mono">' + esc(o.name) + '</span></div>' +
      '<div class="cc-desc mono faint small">' + esc(o.scope || '—') + ' · r' + esc(o.resourceVersion) + '</div>' +
      (sub ? '<div class="cc-desc small">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function connCards(kind, routePrefix) {
    var rows = LIVE.refs(kind);
    if (!rows.length) return '<div class="empty" style="padding:14px"><div class="e-title">归档窗内暂无 ' + kind + ' 对象在册</div></div>';
    return rows.map(function (o) {
      var sub = '';
      if (kind === 'ConnectorOps') {
        var c = LIVE.docContent('ConnectorOps', o.scope, o.name);
        var m = /ops:\s*\[(.*?)\]/.exec(c);
        if (m) sub = 'ops: ' + m[1].replace(/[\s"']/g, '');
      }
      return connCard(o, routePrefix + encodeURIComponent(o.name), sub);
    }).join('');
  }
  function screenConnectors(view) {
    LIVE.ensure();
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '连接' }]);
    var loading = LIVE.state.status !== 'ok';
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>连接</h1><span class="chip kind">WorkService · ConnectorOps · Provider</span></div>' +
      '<div class="dh-sub">连接系统把外部世界包装成可调用的面；跨 Agent 通信走 agent-comm（dispatch / query / interrupt / inbox）。数据源=cored objects 枚举。</div></div></div>' +
      '<div class="conn-group"><div class="sec-title">WorkServices</div><div class="conncards">' + (loading ? liveSkeletonRows(2, 0) : connCards('WorkService', 'ws/')) + '</div></div>' +
      '<div class="conn-group"><div class="sec-title">ConnectorOps 挂载</div><div class="conncards">' + (loading ? liveSkeletonRows(2, 0) : connCards('ConnectorOps', 'connector/')) + '</div></div>' +
      '<div class="conn-group"><div class="sec-title">Providers</div><div class="conncards">' + (loading ? liveSkeletonRows(2, 0) : connCards('Provider', 'provider/')) + '</div></div>' +
      '</div>';
  }
  /* —— envelope v0.1 字段表（协议文档=静态面，cross-agent.md §5.1；非数据不冒充） —— */
  var ENVELOPE_V1 = [
    { field: 'v', type: 'string', req: true, desc: '协议版本，恒 "0.1"' },
    { field: 'id', type: 'uuid', req: true, desc: '信封幂等键（inbox 按 id 去重）' },
    { field: 'ts', type: 'RFC3339', req: true, desc: '发出时刻' },
    { field: 'from', type: 'agent ref', req: true, desc: '发起方 agent/<name>@<scope>' },
    { field: 'to', type: 'agent ref', req: true, desc: '目标 agent/<name>@<scope>（文档面在册且活体可解析才可投）' },
    { field: 'kind', type: 'enum', req: true, desc: '四原语之一：dispatch | query | interrupt | inbox' },
    { field: 'payload', type: 'object', req: true, desc: '自由对象（v0.1 不定 schema；inbox 侧容错收）' },
    { field: 'refs', type: 'string[]', req: false, desc: '可选文档面引用（systems/<s>/path#revN）' },
    { field: 'token', type: 'string', req: 'dispatch', desc: '权限凭据——dispatch 必带（无 token 一律拒绝）；值永不入 console 落账面' }
  ];
  function envelopeTableHtml() {
    return '<table class="env-table"><thead><tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>' +
      ENVELOPE_V1.map(function (f) {
        return '<tr><td class="mono" style="color:#7fb0f9">' + esc(f.field) + '</td><td class="mono small">' + esc(f.type) + '</td>' +
          '<td>' + (f.req === true ? '<span class="chip warn small">必填</span>' : f.req === 'dispatch' ? '<span class="chip warn small">dispatch 必带</span>' : '<span class="chip mute small">可选</span>') + '</td>' +
          '<td class="small muted">' + esc(f.desc) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  /* —— agent-comm 运行面（comm 落账真数据：拓扑/消息日志/op 计数；token 打码） —— */
  function agentCommCommPanels(data) {
    var OP_DESC = { dispatch: '委派任务（异步；token ⊆ 发起方权限面，缺 token=拒）', query: '只读问询（同步快照；§2 对齐表 query↔get/list）', interrupt: '打断/插话（cancel 落点）', inbox: '收件面拉取（error reply 落账消费；豁免活体检查）' };
    var counts = data.counts || {};
    var opCards = '<div class="op-cards">' + ['dispatch', 'query', 'interrupt', 'inbox'].map(function (op) {
      var c = counts[op] || { total: 0, ok: 0 };
      return '<div class="op-card"><div class="oc-name">agent-comm.' + esc(op) + '</div><div class="oc-desc">' + esc(OP_DESC[op] || '') + '</div>' +
        '<div class="mono faint small" style="margin-top:4px">落账 ' + c.total + ' 次 · 受理 ' + c.ok + '</div></div>';
    }).join('') + '</div>';
    var nodeRefs = (data.refs || []).slice();
    LIVE.refs('Agent').forEach(function (o) {
      var c = LIVE.docContent('Agent', o.scope, o.name);
      if (/connector-ops\/agent-comm/.test(c)) {
        var ref = 'agent/' + o.name + '@' + o.scope;
        if (nodeRefs.indexOf(ref) < 0) nodeRefs.push(ref);
      }
    });
    var rows = data.journal || [];
    var W = 440, rowH = 44, topH = 24;
    var pos = {};
    nodeRefs.forEach(function (r, i) { pos[r] = topH + i * rowH; });
    var H = topH + nodeRefs.length * rowH + 12;
    var edges = rows.slice(0, 8).filter(function (r) { return pos[r.from] !== undefined && pos[r.to] !== undefined; });
    var edgeHtml = edges.map(function (r) {
      var y1 = pos[r.from] + 14, y2 = pos[r.to] + 14;
      var mid = (W / 2 + 40);
      var col = r.ok ? '#22c55e' : '#f87171';
      return '<path class="topo-edge" style="stroke:' + col + '" d="M120,' + y1 + ' C' + mid + ',' + y1 + ',' + mid + ',' + y2 + ',320,' + y2 + '"/>';
    }).join('');
    var nodeHtml = nodeRefs.map(function (r) {
      var y = pos[r];
      var nm = r.replace(/^agent\//, '');
      return '<g class="topo-node" data-act="go" data-go="agent/' + esc(r.replace(/^agent\//, '').replace(/@.*$/, '')) + '">' +
        '<rect x="0" y="' + y + '" width="120" height="28" rx="6"/><text x="8" y="' + (y + 19) + '" style="fill:#e6e9ef">' + esc(nm) + '</text></g>';
    }).join('');
    var edgeLegend = '<div class="small faint" style="margin-top:4px">边=comm 落账流水（绿=受理，红=error 回执；v0.1 dispatch 异步——业务回复在目标 SessionLog，不自动回传）。</div>';
    var topo = nodeRefs.length
      ? '<svg class="topo-svg" width="' + W + '" height="' + Math.max(H, 80) + '" viewBox="0 0 ' + W + ' ' + Math.max(H, 80) + '">' + edgeHtml + nodeHtml + '</svg>' + edgeLegend
      : '<div class="empty" style="padding:12px"><div class="e-title">落账窗内暂无节点（comm 落账为空）</div></div>';
    var logRows = rows.slice(0, 20).map(function (r) {
      var st = r.ok ? '<span class="chip ok small">受理</span>' : '<span class="chip danger small">error</span>';
      return '<tr' + (r.sessionId ? ' class="row-click" data-act="go" data-go="session/' + esc(r.sessionId) + '"' : '') + '>' +
        '<td class="mono faint small">' + esc(String(r.ts || '').replace('T', ' ').slice(0, 19)) + '</td>' +
        '<td class="mono small">' + esc(r.from) + ' → ' + esc(r.to) + '</td>' +
        '<td><span class="chip acc small mono">' + esc(r.op) + '</span></td>' +
        '<td class="mono faint small">' + esc(String(r.envelopeId || '').slice(0, 8)) + '</td>' +
        '<td>' + (r.hasToken ? '<span class="tag">✔ 已携（值打码）</span>' : '<span class="tag">✗ 缺</span>') + '</td>' +
        '<td>' + st + '</td></tr>';
    }).join('');
    var logHtml = rows.length
      ? '<div style="max-height:280px;overflow-y:auto"><table class="tbl"><thead><tr><th>时刻</th><th>from → to</th><th>op</th><th>envelope</th><th>token</th><th>状态</th></tr></thead><tbody>' + logRows + '</tbody></table></div>'
      : '<div class="empty" style="padding:12px"><div class="e-title">落账窗内暂无 comm 流水（四 op 未被调用）</div></div>';
    return opCards +
      '<div class="grid" style="grid-template-columns:460px 1fr;margin-top:12px">' +
      '<div class="card"><div class="card-h"><span class="h-title">拓扑（from→to · 节点可点进 agent）</span></div><div class="card-b">' + topo + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">消息日志（' + rows.length + '，comm 落账 · token 值打码）</span><span class="h-sub">行点击=sessionId 深链</span></div><div class="card-b">' + logHtml + '</div></div></div>';
  }
  /* —— ConnectorOps 运行面 tab（kind 专属第五 tab；agent-comm=comm 落账活体） —— */
  function opsTabHtml(kind, scope, name) {
    var content = LIVE.docContent('ConnectorOps', scope, name);
    var wsRef = (/workservice:\s*["']?([A-Za-z0-9-_.]+)/.exec(content) || [])[1] || '';
    var escRe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var mounters = LIVE.refs('Agent').filter(function (o) {
      return new RegExp('connector-ops\\/' + escRe).test(LIVE.docContent('Agent', o.scope, o.name));
    });
    var head = '<div class="kv"><span class="k">workservice</span><span class="v mono">' +
      (wsRef ? '<span class="lk" data-act="go" data-go="ws/' + esc(encodeURIComponent(wsRef)) + '">' + esc(wsRef) + '</span>' : '<span class="faint">—</span>') + '</span>' +
      '<span class="k">挂载方（Agent spec.connectorOps 反查）</span><span class="v">' +
      (mounters.length ? mounters.map(function (o) { return '<span class="lk mono" data-act="go" data-go="agent/' + esc(o.name) + '">' + esc(o.name) + '</span>'; }).join(' · ') : '<span class="faint">无挂载</span>') + '</span></div>';
    if (name !== 'agent-comm') {
      var evs = (LIVE.state.events || []).filter(function (e) { return (e.involved || '').indexOf('ConnectorOps/' + scope + '/' + name) === 0; }).slice(0, 8);
      var evHtml = evs.length ? evs.map(function (e) {
        return '<div class="mini-row" data-act="go" data-go="event/' + esc(e.eventId) + '"><span class="lamp ' + (e.level === 'warn' || e.level === 'error' ? 'warn' : 'acc') + '"></span><div class="mr-main"><div>' + esc(e.type) + '</div><div class="mr-sub mono small">' + esc(String(e.ts || '').replace('T', ' ').slice(0, 19)) + '</div></div></div>';
      }).join('') : '<div class="empty" style="padding:12px"><div class="e-title">归档窗内暂无该对象事件</div></div>';
      var opsRow = (function () {
        var m = /ops:\s*\[(.*?)\]/.exec(content);
        var ops = m ? m[1].split(',').map(function (x) { return x.replace(/[\s"']/g, ''); }).filter(Boolean) : [];
        return ops.map(function (op) { return '<div class="op-card"><div class="oc-name">' + esc(name) + '.' + esc(op) + '</div><div class="oc-desc">op 原语（spec.ops 现读）</div></div>'; }).join('') ||
          '<div class="empty" style="padding:12px"><div class="e-title">spec.ops 未解析（正文现读）</div></div>';
      })();
      return head +
        '<div class="op-cards" style="margin-top:12px">' + opsRow + '</div>' +
        '<div class="card" style="margin-top:12px"><div class="card-h"><span class="h-title">相关事件（involved 过滤）</span></div><div class="card-b">' + evHtml + '</div></div>' +
        '<div class="small faint" style="margin-top:8px">非 agent-comm 挂载面：运行流水暂无独立落账面（declared 余量）——编辑器深链=本屏 tab「草稿」。</div>';
    }
    return head + '<div id="comm-live" style="margin-top:12px">' + liveSkeletonRows(3, 0) + '</div>';
  }
  function hydrateCommLive(kind, scope, name) {
    var el = $('#comm-live');
    if (!el) return;
    var stamp = S.route + '|' + S.segs.join('/');
    __CC.live.comm().then(function (data) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
      var el2 = $('#comm-live');
      if (!el2) return;
      el2.innerHTML = agentCommCommPanels(data) +
        '<div class="card" style="margin-top:12px"><div class="card-h"><span class="h-title">协议 envelope · v0.1 字段表</span><span class="h-sub">随协议演进（cross-agent.md §5）</span></div>' +
        envelopeTableHtml() + '</div>';
    }, function (e) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
      var el2 = $('#comm-live');
      if (el2) el2.innerHTML = '<div class="small faint">comm 落账读面暂不可达（' + esc(String((e && e.message) || e)) + '）——宿主未装配该路由（旧插件代）或恢复后重进即现读</div>';
    });
  }

  /* ================= Agent / Session 详情页 ================= */
  function screenSession(view) {
    LIVE.ensure();
    var ad = chatAd();
    var sid = S.params.id;
    var snap = ad.listSnapshot();
    var row = snap.rows.filter(function (r) { return r.id === sid; })[0];
    // 归属反查（哪个 agent 文档面证据命中该 session）：currentSession/agentRefs/console 发起三源
    var owner = null;
    liveChatAgents().forEach(function (n) {
      if (owner) return;
      var ev = agentSessionEvidence(n);
      if (ev.ownedIds.indexOf(sid) >= 0) owner = n;
    });
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '会话', go: owner ? 'chat/' + esc(owner) : 'welcome' }, { label: sid }]);
    if (!row && !owner) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('session 不在宿主会话清单', sid) + '</div>';
      return;
    }
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1 class="mono" style="font-size:18px">' + esc(sid) + '</h1>' +
      (row && row.running ? '<span class="chip ok tiny">running</span>' : '') + (row && row.blank ? '<span class="chip mute tiny">blank</span>' : '') + '</div>' +
      '<div class="dh-sub mono">' + (row ? esc(row.title) + ' · cwd: ' + esc(row.cwd || '—') : '宿主清单行缺席（roster 投影范围外）') +
      ' · agent: ' + (owner ? '<span class="lk" data-act="go" data-go="chat/' + esc(owner) + '">' + esc(owner) + '</span>' : '未归属（归属证据缺席=不冒充）') + '</div></div>' +
      '<div class="dh-actions"><button class="btn primary" data-act="chat-sess-go" data-id="' + esc(sid) + '"' + (owner ? ' data-agent="' + esc(owner) + '"' : ' disabled') + '>切回 Chat 视图 →</button></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">Trajectory（session 事件页读面 · 与聊天流同源不同呈现）</span></div>' +
      '<div class="card-b"><div id="sess-traj">' + liveSkeletonRows(3) + '</div></div></div></div>';
    // 转录注水（retain 持有+事件窗快照）：归属 agent 缺席时用空声明集（工具卡按普通卡渲染——不冒充判据）
    var declaredOps = owner ? agentDeclaredOps(owner) : [];
    var paint = function (snap) {
      var el = $('#sess-traj');
      if (!el) { releaseChatHold(); return; }
      var items = CHAT().projectTranscript(snap.entries, declaredOps);
      var html = items.map(function (it) {
        var kindCls = it.kind === 'user' || it.kind === 'context' ? 'user' : it.kind === 'assistant' ? 'agent' : 'tool';
        var label = it.kind === 'tool' ? (it.op + (it.connectorOps ? ' · ConnectorOps' : '')) : it.kind;
        return '<div class="traj-item kind-' + kindCls + '"><div class="traj-rail"><div class="traj-dot"></div><div class="traj-line"></div></div>' +
          '<div><div style="display:flex;gap:8px;align-items:center"><span class="traj-kind">' + esc(label) + '</span>' +
          '<span class="mono faint small">seq ' + esc(it.seq) + '</span></div>' +
          '<div class="traj-detail">' + esc(String(it.text || it.argsText || '').slice(0, 200)) + '</div></div></div>';
      }).join('');
      var toolUses = items.filter(function (it) { return it.kind === 'tool'; }).length;
      el.innerHTML = '<div class="statbar" style="grid-template-columns:repeat(2,1fr);margin-bottom:10px">' +
        '<div class="stat"><div class="st-num">' + items.length + '</div><div class="st-label">转录行（事件窗）</div></div>' +
        '<div class="stat"><div class="st-num">' + toolUses + '</div><div class="st-label">工具调用</div></div></div>' +
        (html || '<div class="empty"><div class="e-title">轨迹为空</div></div>');
    };
    releaseChatHold();
    var handle = chatAd().hold(sid);
    if (!handle) { $('#sess-traj').innerHTML = '<div class="small faint">宿主会话面缺席（ctx.sessions 未在册）——轨迹诚实降级</div>'; return; }
    S.chatHold = { sessionId: sid, handle: handle };
    handle.ready.then(function () {
      var cur = S.chatHold;
      if (!cur || cur.sessionId !== sid) return;
      paint(handle.snapshot());
      handle.subscribe(function () { paint(handle.snapshot()); });
    }, function (e) {
      var el = $('#sess-traj');
      if (el) el.innerHTML = '<div class="small faint">转录读面暂不可达（' + esc(String((e && e.message) || e)) + '）</div>';
    });
    paint(handle.snapshot());
  }
  ACTIONS['chat-sess-go'] = function (el) {
    var u = S.chatUi[el.dataset.agent] = S.chatUi[el.dataset.agent] || {};
    u.sessionId = el.dataset.id; u.view = 'chat'; u.tab = 'chat';
    go('chat/' + el.dataset.agent);
  };

  /* ================= 屏 9：事件流（E6 真数据换装；E7 全局/场景面共用核，console-adoption.md §1.13/§1.14） =================
   * 数据源=cored /v1/events 归档窗投影（LIVE 快照 limit=500 单窗）+ until 游标滚动加载更早页
   * （eventId 去重合并；页行数<500=到底 exhausted 如实标注）。
   * 三泳道=eventLaneOf 类型族映射；聚合面板=归档窗内实数（成功率/token=n/a 不冒充）；
   * 过滤条全局/单系统同款（screenEventsCore 同一函数同一状态）；合成压测窗=客户端合成展示层
   * （syn- 前缀+「合成」tag+不可点，不入归档不入聚合——§1.14 裁决，KI-001 审计账保真）。 */
  function evWindowOf(key) {
    if (!S.evWin[key]) S.evWin[key] = { rows: null, exhausted: false, busy: false };
    return S.evWin[key];
  }
  function evRowsOf(win) { return win.rows || (LIVE.state.events || []); }
  function evLoadOlder(win) {
    if (win.busy || win.exhausted || S.evSyn.on) return Promise.resolve(false);
    var rows = evRowsOf(win);
    var last = rows[rows.length - 1];
    if (!last || last.synthetic || !last.ts) return Promise.resolve(false);
    win.busy = true;
    return LIVE.eventsPage(String(last.ts)).then(function (body) {
      var page = body.events || [];
      win.rows = SCN.mergeEvents(rows, page);
      win.exhausted = page.length < SCN.EV_PAGE_LIMIT;
      win.busy = false;
      return true;
    }, function () { win.busy = false; return false; });
  }
  function eventLaneOf(type) {
    if (type === 'DocApplied') return 'phase';                      // 状态变迁=对象 rv 前进
    if (type === 'ExternalChanged' || type === 'MetricThreshold' ||
        type === 'DriftFixed' || type === 'ReconcileTick') return 'data'; // 数据事件=数据面/巡检驱动源族
    return 'event';                                                  // 事件流=其余（缺省不丢行）
  }
  var LANE_VIEW = { event: { label: '事件流', color: '#7fb0f9' }, phase: { label: '状态变迁', color: '#a78bfa' }, data: { label: '数据事件', color: '#22c55e' } };
  /* 过滤条=全局/单系统同款（同一渲染函数：type chips + 压测窗 / level + range + lane + q + 加载更早） */
  function evFilterBarHtml(types) {
    var f = S.evFilter;
    return '<div class="filter-bar"><svg class="ic" style="color:var(--text-3)"><use href="#cc-i-filter"/></svg>' +
      '<span class="fchip' + (!Object.keys(f.kinds).some(function (k) { return f.kinds[k]; }) ? ' on' : '') + '" data-act="ev-kind" data-k="">全部类型</span>' +
      types.map(function (k) { return '<span class="fchip' + (f.kinds[k] ? ' on' : '') + '" data-act="ev-kind" data-k="' + esc(k) + '">' + esc(k) + '</span>'; }).join('') +
      '<span class="fchip' + (S.evSyn.on ? ' on' : '') + '" data-act="ev-syn" title="客户端合成压测窗（展示层不入归档——千级虚拟滚动验收载荷，§1.14 裁决）">压测窗×' + S.evSyn.n + '</span></div>' +
      '<div class="filter-bar">' +
      '<select id="ev-level"><option value="">全部级别</option><option>info</option><option>warn</option><option>error</option><option>fatal</option></select>' +
      '<select id="ev-range">' + M.TIME_RANGES.map(function (r) { return '<option value="' + r.id + '">' + r.label + '</option>'; }).join('') + '</select>' +
      '<select id="ev-lane"><option value="">全部泳道</option><option value="event">事件流</option><option value="phase">状态变迁</option><option value="data">数据事件</option></select>' +
      '<input type="search" id="ev-q" placeholder="对象/类型搜索…" style="width:200px">' +
      '<button class="btn sm" data-act="ev-older" id="ev-older-btn">' + (S.evSyn.on ? '合成窗不停靠游标' : '加载更早（until 游标）') + '</button>' +
      '<span class="count-note" id="ev-count-note"></span></div>';
  }
  function evFiltered(base, sysName) {
    var f = S.evFilter;
    var range = byId(M.TIME_RANGES, 'id', f.range) || M.TIME_RANGES[2];
    var kinds = Object.keys(f.kinds).filter(function (k) { return f.kinds[k]; });
    var ql = (f.q || '').toLowerCase();
    var rows = S.evSyn.on ? SCN.synEvents(S.evSyn.n) : base;
    return rows.filter(function (e) {
      if (sysName && !S.evSyn.on && !SCN.evInScope(e, sysName)) return false;
      if (kinds.length && kinds.indexOf(e.type) < 0) return false;
      if (f.level && e.level !== f.level) return false;
      if (f.lane && eventLaneOf(e.type) !== f.lane) return false;
      var t = Date.parse(e.ts || '');
      if (!S.evSyn.on && !isNaN(t) && (Date.now() - t) > range.min * 60000) return false;
      if (ql && ((e.involved || '') + ' ' + e.type + ' ' + (e.source || '')).toLowerCase().indexOf(ql) < 0) return false;
      return true;
    });
  }
  function evRowHtml(e) {
    var dot = e.level === 'fatal' || e.level === 'error' ? 'var(--danger)' : e.level === 'warn' ? 'var(--warn)' : 'var(--accent)';
    var lane = LANE_VIEW[eventLaneOf(e.type)] || LANE_VIEW.event;
    return '<span class="vc" style="width:8px;height:8px;border-radius:50%;background:' + dot + '"></span>' +
      '<span class="vc mono faint" style="width:52px">' + esc(String(e.ts || '').slice(11, 19)) + '</span>' +
      '<span class="vc"><span class="tag" style="color:' + lane.color + ';border-color:' + lane.color + '44">' + lane.label + '</span></span>' +
      '<span class="vc mono" style="width:130px;color:' + lane.color + '">' + esc(e.type) + '</span>' +
      '<span class="vc mono faint" style="width:190px;overflow:hidden;text-overflow:ellipsis">' + esc(e.involved || '—') + '</span>' +
      '<span class="grow faint small mono">' + esc(String(e.dedupKey || '').slice(0, 60)) + '</span>' +
      (e.synthetic ? '<span class="vc"><span class="tag" style="color:var(--text-3)">合成</span></span>' : '') +
      '<span class="vc chip mute small">' + esc(e.level) + '</span>';
  }
  function paintEvRows(container, base, sysName, win) {
    var items = evFiltered(base, sysName);
    var note = $('#ev-count-note');
    if (note) note.textContent = S.evSyn.on
      ? '合成压测窗 ' + items.length + ' 行（客户端合成展示层——不入归档不入聚合）· 真实窗 ' + base.length + ' 行'
      : items.length + ' / ' + base.length + ' events（归档窗）' + (win && win.exhausted ? ' · 游标到底' : '');
    vlist(container, items, 36, evRowHtml, {
      onLoadMore: function () {
        return evLoadOlder(win).then(function (appended) {
          if (appended) {
            var fresh = evFiltered(evRowsOf(win), sysName);
            items.length = 0;
            fresh.forEach(function (e) { items.push(e); });
          }
          return appended;
        });
      },
      exhausted: function () { return win.exhausted || S.evSyn.on; }
    });
    container.onclick = function (ev) {
      var row = ev.target.closest('.vrow');
      if (!row) return;
      var idx = Math.floor((row.offsetTop + this.scrollTop) / 36);
      var it = items[idx];
      if (it && !it.synthetic) go('event/' + encodeURIComponent(it.eventId));
    };
    return items;
  }
  /* 全局（sysName=null）与场景面（sysName=系统名）同一屏核——过滤条/行渲染/游标加载全同款 */
  function screenEventsCore(view, sysName) {
    LIVE.ensure();
    var isSys = !!sysName;
    if (isSys && !LIVE.refByName('ServiceDesc', sysName)) {
      view.innerHTML = '<div class="view-inner">' + emptyBox('系统不在册（cored 读面）', sysName) + '</div>';
      return;
    }
    if (isSys) setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: sysName, go: 's/' + encodeURIComponent(sysName) }, { label: '事件面' }]);
    else setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '事件流' }]);
    var win = evWindowOf(isSys ? 'sys:' + sysName : 'global');
    var base = evRowsOf(win);
    var scoped = isSys ? base.filter(function (e) { return SCN.evInScope(e, sysName); }) : base;
    var types = [];
    scoped.forEach(function (e) { if (types.indexOf(e.type) < 0) types.push(e.type); });
    types.sort();
    var apN = base.filter(function (e) { return e.type === 'ApprovalNeeded'; }).length;
    var dead = base.length ? Math.round(base.filter(function (e) { return String(e.routedTo || '').indexOf('dead-letter') >= 0; }).length * 1000 / base.length) / 10 : 0;
    var typeCount = {};
    base.forEach(function (e) { typeCount[e.type] = (typeCount[e.type] || 0) + 1; });
    var top5 = Object.keys(typeCount).sort(function (a, b) { return typeCount[b] - typeCount[a]; }).slice(0, 5);
    var head = isSys
      ? scenarioHead({ name: sysName }, '事件面', '归档窗真数据（involved scope 过滤）· 过滤条=全局事件流同款 · until 游标滚动加载更早页 · 行点击进事件详情', '事件')
      : '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>事件流</h1><span class="chip kind">三泳道混排 · 归档窗 ' + base.length + ' 条</span></div>' +
        '<div class="dh-sub">Event / 状态变迁 / 数据事件 · 点任意一条跳相关对象（event→run→workflow→doc 链路）。数据源=event_log 归档投影（/v1/events limit=500 + until 游标滚动加载）。</div></div></div>';
    var sidePanel = '';
    if (!isSys) {
      sidePanel = '<div style="display:grid;gap:12px;align-self:start">' +
        '<div class="card"><div class="card-h"><span class="h-title">聚合面板</span><span class="h-sub">归档窗内实数</span></div><div class="card-b" style="display:grid;gap:10px">' +
        '<div class="kv"><span class="k">审批积压</span><span class="v mono" style="color:' + (apN ? 'var(--warn)' : 'var(--ok)') + '"><span class="lk" data-act="go" data-go="approvals">' + apN + '</span></span></div>' +
        '<div class="kv"><span class="k">死信率</span><span class="v mono">' + dead + '%</span></div>' +
        '<div class="kv"><span class="k">workflow 成功率</span><span class="v mono">n/a</span><span class="small faint">run 终态事件未落归档（declared 余量，不冒充）</span></div>' +
        '<div class="kv"><span class="k">token 消耗（24h）</span><span class="v mono">n/a</span><span class="small faint">数据面余量</span></div>' +
        '<div class="kv"><span class="k">类型分布</span><span class="v small">' + (top5.length ? top5.map(function (t) { return '<span class="tag mono">' + esc(t) + '×' + typeCount[t] + '</span>'; }).join(' ') : '<span class="faint">—</span>') + '</span></div>' +
        '</div></div>' +
        '<div class="card"><div class="card-h"><span class="h-title">泳道图例</span></div><div class="card-b small faint">' +
        Object.keys(LANE_VIEW).map(function (k) { return '<div style="margin:3px 0"><span class="tag" style="color:' + LANE_VIEW[k].color + ';border-color:' + LANE_VIEW[k].color + '44">' + LANE_VIEW[k].label + '</span> ' +
          (k === 'phase' ? 'DocApplied（对象 rv 前进）' : k === 'data' ? 'ExternalChanged / MetricThreshold / DriftFixed / ReconcileTick' : '其余（ApprovalNeeded / Escalate / HeartbeatLost…）') + '</div>'; }).join('') + '</div></div>' +
        '</div>';
    }
    view.innerHTML = '<div class="view-inner">' + head +
      '<div class="grid" style="grid-template-columns:' + (isSys ? '1fr' : '1fr 300px') + '">' +
      '<div>' + evFilterBarHtml(types) + '<div id="ev-vlist2"></div></div>' + sidePanel + '</div></div>';
    var f = S.evFilter;
    $('#ev-level').value = f.level; $('#ev-range').value = f.range; $('#ev-q').value = (f.q || '');
    if (f.lane) $('#ev-lane').value = f.lane;
    var listEl = $('#ev-vlist2');
    var repaintList = function () { paintEvRows(listEl, base, sysName, win); };
    repaintList();
    $('#ev-level').addEventListener('change', function () { f.level = this.value; repaintList(); });
    $('#ev-range').addEventListener('change', function () { f.range = this.value; repaintList(); });
    $('#ev-lane').addEventListener('change', function () { f.lane = this.value; repaintList(); });
    var deb;
    $('#ev-q').addEventListener('input', function () { var v = this.value; clearTimeout(deb); deb = setTimeout(function () { f.q = v; repaintList(); }, 160); });
  }
  function screenEvents(view) { screenEventsCore(view, null); }
  ACTIONS['ev-kind'] = function (el) {
    var k = el.dataset.k;
    if (!k) S.evFilter.kinds = {};
    else S.evFilter.kinds[k] = !S.evFilter.kinds[k];
    render();
  };
  /* E7：合成压测窗 toggle（人点为准——客户端合成展示层，不入归档不入聚合，§1.14 裁决） */
  ACTIONS['ev-syn'] = function () {
    S.evSyn.on = !S.evSyn.on;
    render();
  };
  /* E7：until 游标显式翻页（滚动近底自动加载为主路径，按钮=短列表兜底入口） */
  ACTIONS['ev-older'] = function () {
    var key = S.route === 'events' ? 'global' : 'sys:' + (S.params.name || '');
    var win = evWindowOf(key);
    evLoadOlder(win).then(function (appended) { if (appended) render(); });
  };

  /* 事件详情 */
  /* ================= 屏 10：审批（E6 真数据换装，console-adoption.md §1.13） =================
   * 待审区=草稿缓存 ∪ ApprovalNeeded 归档行；diff=稿 content vs 文档面现值（渲染时现读）；
   * 批准=Apply 全流程复用（dry-run 三检查→人确认→fromDraft 落库，E4 通路零旁路）；
   * 驳回=DELETE 弃稿（零文档面动作）；批量=同 kind 多稿顺序 Apply（独立判别不中断）。
   * ApprovalNeeded 无稿=只读待审卡（批准面缺席不冒充——深链 involved 对象编辑器）。
   * 已决账面（v0.46）：approval_log 审批判定独立账 GET /v1/approvals 现读——批准 granted
   * （rv=落库版本）/驳回 rejected（弃稿零文档面动作）判定行在册，审计不再只靠 apply_log 字符串考古。 */
  function apDiffHtml(diff, maxLines) { return renderDiff(diff, maxLines || 40); }
  function approvalItemHtml(it) {
    if (it.kind === 'draft') {
      var d = it.draft;
      var src = isConsoleFM(d.fieldManager) ? 'console 草稿' : 'LLM/agent 提案';
      return '<div class="ap-card" id="apcard-' + esc(cssId(it.key)) + '">' +
        '<div class="ap-head"><span class="ap-title mono">' + esc(d.kind) + '/' + esc(d.name) + '</span>' +
        '<span class="chip warn small">待审</span><span class="chip mute small">' + esc(src) + '</span></div>' +
        '<div class="ap-meta"><span>scope：<b class="mono">' + esc(d.scope || '—') + '</b></span>' +
        '<span>fieldManager：<b class="mono">' + esc(d.fieldManager) + '</b></span>' +
        '<span class="mono faint">' + esc(String(d.updatedAt || '').replace('T', ' ').slice(0, 19)) + '</span>' +
        '<span class="lk mono small" data-act="go" data-go="doc/' + esc(d.kind) + '/' + esc(d.scope || '') + '/' + esc(d.name) + '">对象编辑器 →</span></div>' +
        '<div class="ap-body" id="apdiff-' + esc(cssId(it.key)) + '">' + liveSkeletonRows(2, 0) + '</div>' +
        '<div class="ap-acts"><button class="btn ok" data-act="ap-approve" data-key="' + esc(it.key) + '">批准（=Apply）</button>' +
        '<button class="btn danger" data-act="ap-reject" data-key="' + esc(it.key) + '">驳回（弃稿）</button>' +
        '<span class="small faint" style="align-self:center">批准=dry-run 三检查→fromDraft 落库（Revision+1 · DocApplied）；驳回=弃稿（零文档面动作）</span></div></div>';
    }
    var e = it.event;
    return '<div class="ap-card resolved" id="apcard-' + esc(cssId(it.key)) + '">' +
      '<div class="ap-head"><span class="ap-title mono">' + esc(e.involved) + '</span>' +
      '<span class="chip warn small">待审（人审档）</span><span class="chip danger small small">无稿</span></div>' +
      '<div class="ap-meta"><span>来源：<b class="mono">' + esc(e.source) + '</b></span><span>level：<b class="mono">' + esc(e.level) + '</b></span>' +
      '<span class="mono faint">' + esc(String(e.ts || '').replace('T', ' ').slice(0, 19)) + '</span>' +
      '<span class="lk mono small" data-act="go" data-go="' + esc(involvedRoute(e.involved)) + '">involved 对象编辑器 →</span></div>' +
      '<div class="ap-body small faint">批准面缺席（该对象无草稿在稿）——变更未进稿不可批准（不冒充 diff）；落稿后本页即出现 diff 预览与批准动作。</div></div>';
  }
  function involvedRoute(inv) {
    var segs = String(inv || '').split('/');
    if (segs.length < 3) return 'welcome';
    return 'doc/' + segs.slice(0, -1).map(encodeURIComponent).join('/') + '/' + encodeURIComponent(segs[segs.length - 1]);
  }
  function apKeyOf(d) { return d.kind + '/' + (d.scope || '') + '/' + d.name; }
  /* DOM id 安全化（对象键含 '/' '.'——querySelector 语义非法；esc 只防 HTML 注入） */
  function cssId(key) { return String(key).replace(/[^A-Za-z0-9_-]/g, '_'); }
  function screenApprovals(view) {
    LIVE.ensure();
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '审批' }]);
    var items = approvalNeededObjects();
    var draftItems = items.filter(function (x) { return x.kind === 'draft'; });
    var evItems = items.filter(function (x) { return x.kind === 'event'; });
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>审批</h1><span class="chip ' + (draftItems.length || evItems.length ? 'warn' : 'ok') + '">' +
      (draftItems.length + evItems.length) + ' 条待审</span></div>' +
      '<div class="dh-sub">待审区=草稿缓存（代改代审的家）∪ ApprovalNeeded 归档行。批准/驳回均=人点（LLM 只提案）；diff=稿 vs 文档面现值现读。</div></div>' +
      '<div class="dh-actions"><button class="btn ok" data-act="ap-batch"' + (draftItems.length ? '' : ' disabled') + '>批量批准（' + draftItems.length + ' 稿）</button></div></div>' +
      draftItems.map(approvalItemHtml).join('') + evItems.map(approvalItemHtml).join('') +
      '<div id="ap-ledger" style="margin-top:24px">' + liveSkeletonRows(2, 0) + '</div>' +
      (!items.length ? '<div class="empty" style="padding:10vh"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">待审区为空（草稿缓存与 ApprovalNeeded 归档均空）</div><div class="e-act"><button class="btn primary" data-act="go" data-go="welcome">回 Welcome</button></div></div>' : '') +
      '</div>';
    hydrateApprovalLedger();
    draftItems.forEach(function (it) { hydrateApprovalDiff(it.draft); });
  }
  /* 已决账面（v0.46 审批独立账：GET /v1/approvals 现读不缓存——批准/驳回即决即见；
   * 驳回=弃稿零文档面动作亦落行；读面缺席=诚实降级注记，零 console error 零 4xx 调用）。 */
  function hydrateApprovalLedger() {
    var stamp = S.route + '|' + S.segs.join('/');
    LIVE.get('v1/approvals?limit=20').then(function (b) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
      var el = $('#ap-ledger');
      if (!el) return;
      var rows = (b && b.approvals) || [];
      if (!rows.length) {
        el.innerHTML = '<div class="small faint">已决账面暂无判定行（批准/驳回即决即见——approval_log 独立账：apply_log 承落库流水，本账承判定）。</div>';
        return;
      }
      el.innerHTML = '<div class="dh" style="margin-bottom:8px"><div class="dh-main"><div class="dh-title"><h2 style="font-size:16px;margin:0">已决账面</h2>' +
        '<span class="chip mute small">' + rows.length + ' 行</span></div>' +
        '<div class="dh-sub">approval_log 独立账（ops DB）：批准=granted（rv=落库版本，noop 照落）· 驳回=rejected（弃稿零文档面动作）。</div></div></div>' +
        '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>时刻</th><th>判定</th><th>对象</th><th>判定主体</th><th>rv</th><th>来源</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td class="mono small">' + esc(String(r.ts || '').replace('T', ' ').slice(0, 19)) + '</td>' +
            '<td><span class="chip ' + (r.decision === 'granted' ? 'ok' : 'danger') + ' small">' + esc(r.decision || '') + '</span></td>' +
            '<td class="mono small"><span class="lk" data-act="go" data-go="' + esc(involvedRoute(r.obj)) + '">' + esc(r.obj || '') + '</span></td>' +
            '<td class="mono small">' + esc(r.judgedBy || 'anonymous') + '</td>' +
            '<td class="mono small">' + (r.rv ? 'r' + r.rv : '—') + '</td>' +
            '<td class="mono small faint">' + esc(r.fieldManager || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }, function () {
      var el = $('#ap-ledger');
      if (el && (S.route + '|' + S.segs.join('/')) === stamp) el.innerHTML = '<div class="small faint">审批账面读面暂不可达（/v1/approvals 缺席或超时）——判定留痕暂只=apply_log（fieldManager=console:approve）。</div>';
    });
  }
  /* diff 注水：稿 content（GET /v1/drafts/{kind}/{name}）+ 面现值（GET /v1/objects）现读 */
  function hydrateApprovalDiff(d) {
    var key = apKeyOf(d);
    var stamp = S.route + '|' + S.segs.join('/');
    Promise.all([
      LIVE.get('v1/drafts/' + encodeURIComponent(d.kind) + '/' + encodeURIComponent(d.name) + (d.scope ? '?scope=' + encodeURIComponent(d.scope) : '')),
      LIVE.fetchObject(d.kind, d.scope, d.name).catch(function () { return null; }),
    ]).then(function (rs) {
      if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
      var el = $('#apdiff-' + cssId(key));
      if (!el) return;
      var dr = rs[0], face = rs[1];
      var base = face ? String(face.content || '') : '（对象不在册——apply 将 404）';
      var working = String((dr && dr.content) || '');
      el.innerHTML = (dr ? '' : '<div class="small faint">稿正文读面缺席（超时）——重进即现读</div>') + apDiffHtml(diffLines(base, working)) +
        '<div class="small faint" style="margin-top:4px">基准=r' + (dr ? dr.baseResourceVersion : '?') + ' · 稿 ' + working.length + 'B vs 面 ' + base.length + 'B（现读，不缓存）</div>';
    }, function (e) {
      var el = $('#apdiff-' + cssId(key));
      if (el && (S.route + '|' + S.segs.join('/')) === stamp) el.innerHTML = '<div class="small faint">diff 读面暂不可达（' + esc(String((e && e.message) || e)) + '）</div>';
    });
  }
  /* 批准=Apply 全流程复用（dry-run 三检查→人确认→fromDraft 落库）；fieldManager=console:approve */
  function approvalApply(it, onDone) {
    var d = it.draft;
    Promise.all([
      LIVE.get('v1/drafts/' + encodeURIComponent(d.kind) + '/' + encodeURIComponent(d.name) + (d.scope ? '?scope=' + encodeURIComponent(d.scope) : '')),
      LIVE.fetchObject(d.kind, d.scope, d.name).catch(function () { return null; }),
    ]).then(function (rs) {
      var dr = rs[0], face = rs[1];
      if (!dr) { toast('稿正文读面缺席', '无法预检（稿缺失）——刷新重试', 'warn'); return; }
      var base = face ? String(face.content || '') : '';
      var working = String(dr.content || '');
      var fullDiff = diffLines(base, working);
      var stats = diffStats(fullDiff);
      var baseRV = Number(dr.baseResourceVersion);
      openModal(
        '<div class="modal-h"><span class="m-title">批准（= Apply）· ' + esc(d.kind) + '/' + esc(d.name) + '</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
        '<div class="modal-b">' +
        '<div class="kv" style="margin-bottom:12px"><span class="k">变更</span><span class="v"><span class="chip ok small">+' + stats.add + '</span> <span class="chip danger small">-' + stats.del + '</span> · 来源 ' + esc(d.fieldManager) + '</span></div>' +
        '<div class="checklist" id="ap-checks">' +
        '<div class="check-item" data-c="scheme"><span class="ci-ic">…</span>Scheme 校验（kind 注册∧spec 结构）</div>' +
        '<div class="check-item" data-c="perm"><span class="ci-ic">…</span>权限准入（主体=宿主注入 console-operator）</div>' +
        '<div class="check-item" data-c="lock"><span class="ci-ic">…</span>乐观锁（稿基于 r' + baseRV + ' ↔ 面上现值）</div></div>' +
        renderDiff(fullDiff, 26) +
        '<div class="small faint" id="ap-dry-note" style="margin-top:6px">dry-run 预检中（POST /core-console/apply {fromDraft:true, dryRun:true}——零副作用）…</div>' +
        '</div>' +
        '<div class="modal-f"><button class="btn" data-act="close-modal">取消</button><button class="btn primary" id="ap-apply-go" disabled>确认批准（Apply）</button></div>',
        { cls: 'wide' });
      LIVE.apply({ kind: d.kind, scope: d.scope, name: d.name, fromDraft: true, dryRun: true,
        fieldManager: 'console:approve', reasonRef: 'console:approve-dry' }).then(function (res) {
        var mark = function (c, ok, note) {
          var row = $('.check-item[data-c="' + c + '"]');
          if (!row) return;
          row.classList.add(ok ? 'pass' : 'fail');
          var ic = row.querySelector('.ci-ic');
          if (ic) { ic.textContent = ok ? '✓' : '✗'; ic.style.color = ok ? 'var(--ok)' : 'var(--danger)'; }
          if (note) { var n = document.createElement('span'); n.className = 'ci-note'; n.textContent = note; row.appendChild(n); }
        };
        if (res.ok && res.data && res.data.action === 'dry-run') {
          var cur = Number(res.data.rv);
          var lockOk = cur === baseRV;
          mark('scheme', true, 'kind 在册∧spec 结构过（cored admit ①）');
          mark('perm', true, '主体准入过（cored admit ②）');
          mark('lock', lockOk, lockOk ? 'r' + baseRV + ' == 面上现值（可落）' : '稿基于 r' + baseRV + '，面上已 r' + cur + '——落库将 409（稿保留）');
          var go = $('#ap-apply-go');
          if (go && lockOk) {
            go.disabled = false;
            go.addEventListener('click', function () {
              go.disabled = true;
              LIVE.apply({ kind: d.kind, scope: d.scope, name: d.name, fromDraft: true,
                fieldManager: 'console:approve', reasonRef: 'console:approve' }).then(function (r2) {
                if (onDone) onDone(r2);
              });
            });
          }
        } else {
          var st = res.status;
          mark('scheme', st !== 404 && st !== 400, st === 404 || st === 400 ? String(res.error || ('HTTP ' + st)) : '—');
          mark('perm', st !== 403, st === 403 ? String(res.error || '权限准入拒绝') : '—');
          mark('lock', false, '预检未过（' + (st == null ? '传输层' : 'HTTP ' + st) + '）');
        }
      });
    });
  }
  ACTIONS['ap-approve'] = function (el) {
    var key = el.dataset.key;
    var it = approvalNeededObjects().filter(function (x) { return x.kind === 'draft' && apKeyOf(x.draft) === key; })[0];
    if (!it) return;
    approvalApply(it, function (r2) {
      if (r2.ok) {
        closeModal();
        toast('已批准（Apply 落库 r' + r2.data.rv + '）', key + ' · DocApplied 已归档 · 草稿已清', 'ok');
        LIVE.state.drafts = (LIVE.state.drafts || []).filter(function (x) { return apKeyOf(x) !== key; });
        LIVE.load().then(function () { render(); });
      } else if (r2.status === 409) {
        closeModal();
        toast('乐观锁冲突（409）——稿保留', String(r2.error || '') + '——重读后重整草稿再落', 'danger');
        LIVE.load().then(function () { render(); });
      } else {
        toast('批准失败（' + (r2.status == null ? '传输层' : 'HTTP ' + r2.status) + '）', String(r2.error || ''), 'danger');
      }
    });
  };
  ACTIONS['ap-reject'] = function (el) {
    var key = el.dataset.key;
    var it = approvalNeededObjects().filter(function (x) { return x.kind === 'draft' && apKeyOf(x.draft) === key; })[0];
    if (!it) return;
    confirmModal('驳回（弃稿）',
      '<div>弃稿 <b class="mono">' + esc(key) + '</b>？——零文档面动作（不发明反向写路径）；ApprovalNeeded 归档行保留（审计素材）。</div>',
      '确认驳回', function () {
        __CC.live.draftDelete(it.draft.kind, it.draft.name, it.draft.scope).then(function (r) {
          if (r.ok) {
            toast('已驳回（弃稿）', key + ' · 草稿清空（' + (r.status === 404 ? '本就无稿' : 'DELETE 200') + '）', 'warn');
            LIVE.state.drafts = (LIVE.state.drafts || []).filter(function (x) { return apKeyOf(x) !== key; });
            LIVE.load().then(function () { render(); });
          } else {
            toast('弃稿失败（' + (r.status == null ? '传输层' : 'HTTP ' + r.status) + '）', String(r.error || ''), 'danger');
          }
        });
      }, true);
  };
  ACTIONS['ap-batch'] = function () {
    var items = approvalNeededObjects().filter(function (x) { return x.kind === 'draft'; });
    if (!items.length) return;
    var kinds = {};
    items.forEach(function (x) { kinds[x.draft.kind] = 1; });
    var kindList = Object.keys(kinds);
    confirmModal('批量批准（' + items.length + ' 稿 · kind=' + kindList.join(',') + '）',
      '<div>' + items.map(function (x) { return '<div class="small mono" style="padding:3px 0">· ' + esc(apKeyOf(x.draft)) + '</div>'; }).join('') +
      '<div class="hr"></div><div class="small faint">同 kind 草稿组=批量档（高危单条必审判据未声明，机制如实标注）；顺序逐条 Apply，独立判别结果——单条失败不中断后续（各稿独立乐观锁）。</div></div>',
      '全部批准（Apply ×' + items.length + '）', function () {
        var results = [];
        var idx = 0;
        var next = function () {
          if (idx >= items.length) {
            var okN = results.filter(function (r) { return r.ok; }).length;
            closeModal();
            toast('批量完成：' + okN + '/' + items.length + ' 落库', results.map(function (r) { return r.key + '=' + (r.ok ? 'r' + r.rv : (r.status == null ? '传输层' : 'HTTP ' + r.status)); }).join('；'), okN === items.length ? 'ok' : 'warn');
            LIVE.load().then(function () { render(); });
            return;
          }
          var it = items[idx++];
          approvalApply(it, function (r2) {
            results.push({ key: apKeyOf(it.draft), ok: !!(r2 && r2.ok), rv: r2 && r2.ok ? r2.data.rv : null, status: r2 ? r2.status : null });
            next();
          });
        };
        next();
      });
  };

  /* ================= 需求提案（能力 B——console-adoption.md §1.24） ================= */
  /* 提交=草稿→Apply 全流程（fieldManager=console:propose）；批准/驳回=对象态翻转稿
   * （console:approve/console:reject——approval_log 判定行+审批信号族事件随行，cored 侧）；批准落库
   * 即 apply-workflow 派单受理投影（kind=proposal 行——受理≠拉起，诚实投影）。 */
  var PROP_PRIORITIES = [
    { id: 'low', label: 'low（低危）' }, { id: 'normal', label: 'normal' },
    { id: 'high', label: 'high（高危）' }, { id: 'critical', label: 'critical（高危）' }
  ];
  var PROP_STATUS_CLS = { draft: 'mute', submitted: 'warn', approved: 'ok', rejected: 'danger', landed: 'ok' };
  function propStatusChip(st, lg) {
    var cls = PROP_STATUS_CLS[st] || 'mute';
    return '<span class="chip ' + cls + (lg ? ' lg' : '') + '"><span class="lamp ' + cls + '"></span>' + esc(st || '?') + '</span>';
  }
  /* yaml 标量安全化（含 ": " / 前导特殊符 / 空串=双引号包裹——console 生成形态确定，解析权威在 cored 闸门） */
  function propScalar(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return '""';
    if (/[:#\-\?&*!>|%@`'"{[\],]/.test(s.charAt(0)) || /:\s/.test(s) || /\s$/.test(s)) {
      return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return s;
  }
  function propYaml(f) {
    var acc = (f.acceptance || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    return 'apiVersion: core/v1\nkind: Proposal\nmetadata: {name: ' + f.name + ', scope: ' + (f.scope || 'global') + '}\n' +
      'spec:\n' +
      '  title: ' + propScalar(f.title) + '\n' +
      '  summary: ' + propScalar(f.summary) + '\n' +
      (acc.length ? '  acceptance:\n' + acc.map(function (s) { return '    - ' + propScalar(s); }).join('\n') + '\n' : '') +
      '  impact: ' + propScalar(f.impact) + '\n' +
      '  priority: ' + (f.priority || 'normal') + '\n' +
      '  proposer: ' + propScalar(f.proposer) + '\n' +
      '  status: ' + f.status + '\n' +
      '  landing: {target: ' + (f.landing || 'doc') + '}\n';
  }
  function propSlug(title) {
    var s = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s ? s.slice(0, 40) : '';
  }
  function screenProposals(view) {
    LIVE.ensure();
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '提案' }]);
    var props = (LIVE.state.proposals || []);
    var loading = LIVE.state.status !== 'ok';
    var form =
      '<div class="settings-cards" style="margin-bottom:20px"><div class="set-card" style="grid-column:1/-1">' +
      '<div class="set-card-h">提交需求提案</div><div class="set-card-sub">提交=草稿→Apply 全流程（对象入库 status=submitted）；高危=人审（ApprovalNeeded 自产→审批屏），低危可自动（部署侧分流配置 --proposal-auto-approve）。</div>' +
      '<div class="prop-form" style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;padding:8px 16px 16px">' +
      '<div><label class="small muted">名称（slug）</label><input id="pf-name" class="inp mono" style="width:100%" placeholder="add-dark-mode" autocomplete="off"></div>' +
      '<div><label class="small muted">标题 *</label><input id="pf-title" class="inp" style="width:100%" placeholder="一句话说清做什么" autocomplete="off"></div>' +
      '<div style="grid-column:1/-1"><label class="small muted">目标 *</label><textarea id="pf-summary" class="inp" rows="2" style="width:100%" placeholder="做什么/为什么（批准后随派单载荷交给执行体）"></textarea></div>' +
      '<div style="grid-column:1/-1"><label class="small muted">验收标准 *（每行一条）</label><textarea id="pf-acceptance" class="inp" rows="3" style="width:100%" placeholder="可验证条目（Goal.acceptance 同词汇）"></textarea></div>' +
      '<div style="grid-column:1/-1"><label class="small muted">影响面</label><input id="pf-impact" class="inp" style="width:100%" placeholder="涉及系统/对象/风险说明（禁真实 IP/凭据——R-PUB）" autocomplete="off"></div>' +
      '<div><label class="small muted">优先级</label><select id="pf-priority" class="inp" style="width:100%">' +
      PROP_PRIORITIES.map(function (p) { return '<option value="' + p.id + '">' + esc(p.label) + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="small muted">产物落点</label><select id="pf-landing" class="inp" style="width:100%">' +
      '<option value="doc">doc（docsRoot 对象草稿）</option><option value="task">task（部署侧任务文件）</option></select></div>' +
      '<div><label class="small muted">提出人</label><input id="pf-proposer" class="inp" style="width:100%" value="console-operator" autocomplete="off"></div>' +
      '<div style="align-self:end"><button class="btn primary" data-act="prop-submit">提交提案（草稿→Apply）</button></div>' +
      '</div></div></div>';
    var rows = loading ? liveSkeletonRows(3, 0) : (props.length ?
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>标题</th><th>状态</th><th>优先级</th><th>提出人</th><th>验收</th><th>rv</th><th>落点</th></tr></thead><tbody>' +
      props.map(function (p) {
        return '<tr><td><span class="lk" data-act="go" data-go="proposal/' + esc(encodeURIComponent(p.scope || '')) + '/' + esc(encodeURIComponent(p.name)) + '">' + esc(p.title || p.name) + '</span>' +
          '<span class="mono faint small"> ' + esc(p.name) + '</span></td>' +
          '<td>' + propStatusChip(p.status) + '</td>' +
          '<td><span class="chip ' + (p.priority === 'low' ? 'mute' : (p.priority === 'normal' ? 'kind' : 'warn')) + ' small">' + esc(p.priority || '—') + '</span></td>' +
          '<td class="mono small">' + esc(p.proposer || '—') + '</td>' +
          '<td class="small">' + (p.acceptanceCount || 0) + ' 条</td>' +
          '<td class="mono small">r' + (p.resourceVersion || 0) + '</td>' +
          '<td class="mono small faint">' + esc((p.landing && p.landing.target) || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="empty" style="padding:6vh"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">提案库为空（提交第一条需求即入册）</div></div>');
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>需求提案</h1><span class="chip ' + (props.length ? 'kind' : 'mute') + '">' + props.length + ' 条在册</span></div>' +
      '<div class="dh-sub">需求先成为一等对象再成为工作（kind: Proposal）：标题/目标/验收/影响面/优先级/提出人入库 → 审批分流 → 批准即 apply-workflow 派单受理（受理≠拉起）→ 产物落盘回写 landed。</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="go" data-go="approvals">审批屏 →</button></div></div>' +
      form + '<div class="sec-title">提案库</div>' + rows + '</div>';
    // 标题→slug 预填（名称留空时提交自动生成；手填优先）。
    var tEl = $('#pf-title'), nEl = $('#pf-name');
    if (tEl && nEl) tEl.addEventListener('input', function () {
      if (nEl.dataset.touched) return;
      var s = propSlug(tEl.value); if (s) nEl.value = s;
    });
    if (nEl) nEl.addEventListener('input', function () { nEl.dataset.touched = '1'; });
  }
  ACTIONS['prop-submit'] = function () {
    var f = {
      name: ($('#pf-name') || {}).value || '', title: ($('#pf-title') || {}).value || '',
      summary: ($('#pf-summary') || {}).value || '', acceptance: ($('#pf-acceptance') || {}).value || '',
      impact: ($('#pf-impact') || {}).value || '', priority: ($('#pf-priority') || {}).value || 'normal',
      landing: ($('#pf-landing') || {}).value || 'doc', proposer: ($('#pf-proposer') || {}).value || 'console-operator',
      scope: 'global', status: 'submitted'
    };
    f.name = (f.name || propSlug(f.title) || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(f.name)) { toast('名称不合法', 'slug 形态 [a-z0-9-]（标题留空自动生成）', 'warn'); return; }
    if (!f.title.trim() || !f.summary.trim()) { toast('标题/目标必填', '需求先说清做什么', 'warn'); return; }
    if (!f.acceptance.split('\n').some(function (s) { return s.trim(); })) { toast('验收标准至少一条', '可验证条目=Verify 相位的复测依据', 'warn'); return; }
    var yaml = propYaml(f);
    // 提交=草稿→Apply 全流程（E4 通路复用；对象键 Proposal/global/<name>）。
    fetch('/core-console/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ kind: 'Proposal', scope: 'global', name: f.name, content: yaml,
        fieldManager: 'console:propose', reasonRef: 'console:propose', baseResourceVersion: 0 })
    }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (d) {
        if (!d.ok) { toast('落稿失败', String((d.body && d.body.error) || 'HTTP 错误'), 'danger'); return; }
        return LIVE.apply({ kind: 'Proposal', scope: 'global', name: f.name, fromDraft: true,
          fieldManager: 'console:propose', reasonRef: 'console:propose' });
      })
      .then(function (res) {
        if (!res) return;
        if (res.ok) {
          toast('提案已提交（r' + res.data.rv + ' status=submitted）', f.name + ' · DocApplied 已归档' +
            (f.priority === 'low' || f.priority === 'normal' ? ' · 低危视部署分流可自动' : ' · 高危待人审（ApprovalNeeded 已产）'), 'ok');
          LIVE.load().then(function () { go('proposal/global/' + f.name); });
        } else {
          toast('提交失败（' + (res.status == null ? '传输层' : 'HTTP ' + res.status) + '）', String(res.error || ''), 'danger');
        }
      });
  };
  function screenProposalDetail(view) {
    var scope = S.params.scope, name = S.params.name;
    LIVE.ensure();
    var stamp = S.route + '|' + S.segs.join('/');
    view.innerHTML = '<div class="view-inner">' + liveSkeletonRows(3, 0) + '</div>';
    LIVE.get('v1/proposals/' + encodeURIComponent(name) + (scope ? '?scope=' + encodeURIComponent(scope) : ''))
      .then(function (d) {
        if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
        renderProposalDetail(view, d);
      }, function (e) {
        if ((S.route + '|' + S.segs.join('/')) !== stamp) return;
        view.innerHTML = '<div class="view-inner"><div class="empty" style="padding:10vh"><svg class="ic"><use href="#cc-i-empty"/></svg>' +
          '<div class="e-title">提案读面不可达（' + esc(String((e && e.message) || e)) + '）</div>' +
          '<div class="e-act"><button class="btn primary" data-act="go" data-go="proposals">回提案库</button></div></div></div>';
      });
  }
  function renderProposalDetail(view, d) {
    var scope = String(d.scope || 'global'), name = String(d.name || '');
    var acc = (d.spec && d.spec.acceptance) || [];
    var dispatchUrl = 'v1/agents/dispatches';
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(d.title || name) + '</h1>' + propStatusChip(d.status, true) +
      '<span class="chip kind">' + esc(d.priority || '—') + '</span></div>' +
      '<div class="dh-sub mono small">' + esc('Proposal/' + scope + '/' + name) + ' · r' + (d.resourceVersion || 0) + ' · 提出人 ' + esc(d.proposer || '—') + '</div></div>' +
      '<div class="dh-actions">' + (d.status === 'submitted' ?
        '<button class="btn ok" data-act="prop-approve" data-scope="' + esc(scope) + '" data-name="' + esc(name) + '">批准</button>' +
        '<button class="btn danger" data-act="prop-reject" data-scope="' + esc(scope) + '" data-name="' + esc(name) + '">驳回</button>'
        : '<span class="small faint">状态=' + esc(d.status) + '（判定终态后无批准/驳回动作——状态机 proposal.md §4）</span>') + '</div></div>' +
      '<div class="settings-cards" style="grid-template-columns:1fr 1fr">' +
      '<div class="set-card"><div class="set-card-h">目标</div><div class="set-card-sub" style="white-space:pre-wrap">' + esc(d.summary || '—') + '</div></div>' +
      '<div class="set-card"><div class="set-card-h">影响面</div><div class="set-card-sub" style="white-space:pre-wrap">' + esc(d.spec && d.spec.impact || '—（未声明）') + '</div></div>' +
      '<div class="set-card" style="grid-column:1/-1"><div class="set-card-h">验收标准（' + acc.length + ' 条）</div>' +
      (acc.length ? '<div class="set-card-sub"><ul style="margin:4px 0 0 18px;padding:0">' + acc.map(function (a) { return '<li class="small" style="padding:2px 0">' + esc(a) + '</li>'; }).join('') + '</ul></div>' : '<div class="set-card-sub faint">未声明验收标准</div>') + '</div>' +
      '<div class="set-card" style="grid-column:1/-1"><div class="set-card-h">产物指针（landing）</div>' +
      '<div class="set-card-sub mono">' + esc('target=' + ((d.landing && d.landing.target) || '—') + (d.landing && d.landing.ref ? ' ref=' + d.landing.ref : '')) + '</div>' +
      '<div class="set-card-sub faint">产物真实落盘=apply-workflow agent 真实拉起段（declared-deferred）——落盘后状态回写 landed（本轮打通到派单受理+产物指针，不冒充产物已在）。</div></div>' +
      '<div class="set-card" style="grid-column:1/-1"><div class="set-card-h">派单（apply-workflow）</div><div id="pd-dispatch" style="padding:6px 16px 14px">' + liveSkeletonRows(1, 0) + '</div></div>' +
      '</div>' +
      '<div class="dh" style="margin-top:18px"><div class="dh-main"><div class="dh-title"><h2 style="font-size:16px;margin:0">对象原文</h2></div>' +
      '<div class="dh-sub">git 权威现读（ Proposal 走 apply 管线——幂等/乐观锁/审计全量继承）。</div></div></div>' +
      '<pre class="mono small" style="background:var(--bg2,#141a22);padding:12px 14px;border-radius:8px;overflow:auto;white-space:pre-wrap">' + esc(d.content || '') + '</pre></div>';
    // 派单投影注水（受理≠拉起——环归零/缺席=如实标注）。
    var dstamp = S.route + '|' + S.segs.join('/');
    LIVE.get(dispatchUrl).then(function (b) {
      if ((S.route + '|' + S.segs.join('/')) !== dstamp) return;
      var el = $('#pd-dispatch'); if (!el) return;
      var rows = ((b && b.dispatches) || []).filter(function (x) { return x.kind === 'proposal' && x.proposal === name; });
      if (!rows.length) {
        el.innerHTML = '<div class="small faint">暂无派单受理投影（status=' + esc(String(d.status)) + '——approved 落库即派单；受理≠agent 会话已拉起，真实拉起 deferred）。</div>';
        return;
      }
      var r0 = rows[rows.length - 1];
      el.innerHTML = '<div class="small" style="margin-bottom:6px"><span class="chip ok small">apply-workflow ×' + rows.length + '</span>' +
        '<span class="chip mute small">autoLevel=' + esc(r0.autoLevel || '') + '</span>' +
        '<span class="chip mute small">action=' + esc(r0.action || '') + '</span>' +
        '<span class="chip mute small">rv=' + (r0.rv || 0) + '</span>' +
        '<span class="chip mute small">eventId=' + esc(String(r0.eventId || '').slice(0, 28)) + '…</span></div>' +
        '<div class="small faint">受理 ≠ agent 会话已拉起（诚实投影——真实拉起=dsh 会话挂载，declared-deferred）；载荷带提案名/目标/验收（执行体输入）。</div>';
    }, function () {
      var el = $('#pd-dispatch');
      if (el) el.innerHTML = '<div class="small faint">派单投影读面暂不可达（/v1/agents/dispatches 缺席或超时）。</div>';
    });
  }
  /* 批准/驳回=对象态翻转稿（submitted→approved|rejected）→ fromDraft Apply
   * （console:approve|console:reject——cored 侧落判定行+审批信号族事件+派单受理）。 */
  function proposalFlip(scope, name, to) {
    var fm = to === 'approved' ? 'console:approve' : 'console:reject';
    LIVE.get('v1/proposals/' + encodeURIComponent(name) + '?scope=' + encodeURIComponent(scope)).then(function (d) {
      var flipped = propFlipStatus(String(d.content || ''), to);
      if (flipped == null) { toast('状态行翻转失败', 'spec.status=submitted 未命中（对象形态漂移——读原文手改）', 'danger'); return; }
      fetch('/core-console/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ kind: 'Proposal', scope: scope, name: name, content: flipped,
          fieldManager: fm, reasonRef: 'console:' + to, baseResourceVersion: d.resourceVersion })
      }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (st) {
          if (!st.ok) { toast('落稿失败', String((st.body && st.body.error) || ''), 'danger'); return; }
          LIVE.apply({ kind: 'Proposal', scope: scope, name: name, fromDraft: true,
            fieldManager: fm, reasonRef: 'console:' + to }).then(function (res) {
            if (res.ok) {
              toast(to === 'approved' ? '已批准（r' + res.data.rv + '）' : '已驳回（r' + res.data.rv + '）',
                name + ' · ' + (to === 'approved' ? 'apply-workflow 派单受理已产（受理≠拉起）' : '无派单（rejected 不派单）'), to === 'approved' ? 'ok' : 'warn');
              LIVE.load().then(function () { render(); });
            } else if (res.status === 409) {
              toast('乐观锁冲突（409）——稿保留', String(res.error || '') + '——重读后重试', 'danger');
              LIVE.load().then(function () { render(); });
            } else {
              toast('判定失败（' + (res.status == null ? '传输层' : 'HTTP ' + res.status) + '）', String(res.error || ''), 'danger');
            }
          });
        });
    }, function (e) { toast('提案现读失败', String((e && e.message) || e), 'danger'); });
  }
  function propFlipStatus(content, to) {
    var from = 'submitted';
    var re = new RegExp('^(\\s+status:\\s*)' + from + '(\\s*)$', 'm');
    if (!re.test(content)) return null;
    return content.replace(re, '$1' + to + '$2');
  }
  ACTIONS['prop-approve'] = function (el) { proposalFlip(el.dataset.scope, el.dataset.name, 'approved'); };
  ACTIONS['prop-reject'] = function (el) {
    confirmModal('驳回提案',
      '<div>驳回 <b class="mono">' + esc(el.dataset.name) + '</b>？——对象态写 rejected（fromDraft Apply fieldManager=console:reject）；approval_log rejected 行在账，<b>无派单</b>。</div>',
      '确认驳回', function () { proposalFlip(el.dataset.scope, el.dataset.name, 'rejected'); }, true);
  };

  /* ================= 帮助面板（dsh settings-card） ================= */
  function openHelp() {
    var rows = SHORTCUTS.slice(0, 6).map(function (s) {
      return '<div class="keys-row"><span class="kr-desc">' + esc(s.label) + '</span><span class="kr-keys">' + s.keys.map(kbd).join('') + '</span></div>';
    }).join('');
    openModal('<div class="modal-h"><span class="m-title">关于本原型</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b"><div class="settings-cards">' +
      '<div class="set-card"><div class="set-card-h">说明</div><div class="set-card-sub">core console v2（E0–E7 全收口——渲染数据全部来自 cored 读面 + ops DB）</div>' +
      '<div class="set-row"><span class="sr-label">设计文档</span><span class="sr-val mono">core_system_instance/runtime/console-ui.md</span></div>' +
      '<div class="set-row"><span class="sr-label">概念对齐</span><span class="sr-val mono">core_design/concepts/apply.md · workflow.md</span></div>' +
      '<div class="set-row"><span class="sr-label">数据</span><span class="sr-val">cored 读面（/v1/* 只读投影 + Apply/草稿写通路）——渲染数据无双源，console 不自建持久状态</span></div></div>' +
      '<div class="set-card"><div class="set-card-h">核心语义</div>' +
      '<div class="set-row"><span class="sr-label">Apply</span><span class="sr-val">编辑与发布分离：改动先进草稿，Apply 才落库（Revision+1 · DocApplied 必发）；LLM 只提案，Apply 必须人点</span></div>' +
      '<div class="set-row"><span class="sr-label">一切皆文档</span><span class="sr-val">文档与资源同规则渲染（同 kind 徽章 / revision / 草稿圆点 / 状态灯）</span></div>' +
      '<div class="set-row"><span class="sr-label">跨 Agent 通信</span><span class="sr-val">ConnectorOps · agent-comm：dispatch / query / interrupt / inbox；委派=token 整包下发，子 ⊆ 父</span></div></div>' +
      '<div class="set-card"><div class="set-card-h">快捷键（<span class="lk" data-act="open-cheatsheet">完整速查表</span>）</div><div style="padding:4px 16px 10px">' + rows + '</div></div>' +
      '</div></div>', { cls: '' });
  }
  ACTIONS['open-help'] = function () { openHelp(); };

  /* E7 收口清扫：workflow spec docs 兜底 mock 播种摘除（boot 不再向 M.docs 推 mock 文档——
   * 文档面唯一来源=cored objects 枚举）。 */
  function ago2(min) { return new Date(Date.now() - min * 60000); }

  /* ================= 路由注册 & 启动 ================= */
  // E2 路由换装：五屏真数据（Welcome/tree/s/:name/doc/object/event），其余屏保持 proto mock 待各自 E 轮
  route('welcome', screenWelcome);
  route('overview', screenOverview);
  route('tree', screenTree);
  route('s/:name', screenSystem);
  route('s/:name/i/:inst', screenInstance);
  route('s/:name/events', screenSysEvents);
  route('s/:name/metrics', screenSysMetrics);
  route('s/:name/docs', screenSysDocs);
  route('s/:name/permissions', screenSysPermissions);
  route('workflows', screenWorkflows);
  route('wf/:name', screenWorkflow); // E3：运行管理详情（六 tab；列表列=L38-05 活体判据）
  route('wf/:name/r/:n', screenWfRun);
  route('doc/:name', function (v) { screenEditor(v, null); });      // 名字解析（歧义=空态引导回系统树）
  route('doc/:kind/:scope/:name', function (v) { screenEditor(v); }); // 对象键直链（kind/scope/name）——E4 起编辑器
  route('docs', screenDocsGlobal);
  route('chat/:agent', screenChat);
  route('connectors', screenConnectors);
  route('connector/:name', function (v) { screenEditor(v, 'ConnectorOps'); }); // E4 起同屏=编辑器（文档与资源同规则）
  route('ws/:name', function (v) { screenEditor(v, 'WorkService'); });
  route('provider/:name', function (v) { screenEditor(v, 'Provider'); });
  route('ref/:name', function (v) { screenEditor(v, 'Ref'); });
  route('role/:name', function (v) { screenEditor(v, 'Role'); });
  route('agent/:name', function (v) { screenEditor(v, 'Agent'); }); // E5 起升会话屏（运行器四选+终端 tab）
  route('session/:id', screenSession);
  route('events', screenEvents);
  route('event/:id', screenEventLive);
  route('approvals', screenApprovals);
  route('proposals', screenProposals); // 能力 B：需求提案屏（列表+提交表单——console-adoption.md §1.24）
  route('proposal/:scope/:name', screenProposalDetail); // 详情（六要素+派单行+产物指针+批准/驳回）

  function boot() {
    // 侧栏折叠 / 帮助 / 铃铛 / 搜索
    $('#btn-side-collapse').addEventListener('click', toggleSide);
    $('#side-rail').addEventListener('click', toggleSide);
    $('#btn-help').addEventListener('click', openHelp);
    $('#top-search').addEventListener('click', openPalette);
    $('#btn-bell').addEventListener('click', function () { go('approvals'); });
    $('#pal-input').addEventListener('input', function () { palSel = 0; renderPalList(this.value); });
    if (!location.hash) location.replace('#/welcome');
    render();
  }

  /* ===== E1 连接态灯（§1.5 三色）与挂载/卸载 ===== */
  var CONN_VIEW = {
    connected:    { lamp: 'ok',   pulse: 'pulse-ok',     label: 'cored: connected' },
    reconnecting: { lamp: 'warn', pulse: 'pulse-warn',   label: 'cored: reconnecting' },
    rotated:      { lamp: 'esc',  pulse: 'pulse-danger', label: 'cored: rotated' }
  };
  function applyConnState(st, opts) {
    opts = opts || {};
    var v = CONN_VIEW[st.state] || CONN_VIEW.connected;
    var dot = $('#cc-conn-dot'), label = $('#cc-conn-label'), strip = $('#cc-conn-strip');
    if (dot) { dot.className = 'lamp ' + v.lamp + ' ' + v.pulse; }
    if (label) { label.textContent = st.state; }
    if (strip) {
      if (st.state === 'connected') { strip.hidden = true; }
      else {
        strip.hidden = false;
        var lampEl = $('#cc-conn-strip-lamp'); if (lampEl) lampEl.className = 'lamp ' + v.lamp;
        var tx = $('#cc-conn-strip-text');
        if (tx) tx.innerHTML = st.state === 'rotated'
          ? '入口已轮换（连续 401）→ 重走固定入口：<a href="#" data-act="conn-fixgate">打开固定入口</a>（书签恒定，门 302 到 fresh token）'
          : '重连中（第 ' + st.attempts + ' 次）——数据区保留最后基线渲染，不白屏（§1.4）';
      }
    }
    var sc = $('.side-conn');
    if (sc) {
      var l = sc.querySelector('.lamp'); if (l) l.className = 'lamp ' + v.lamp + ' ' + v.pulse;
      var mono = sc.querySelector('.mono'); if (mono) mono.textContent = v.label;
    }
  }
  ACTIONS['conn-fixgate'] = function () { location.assign('/'); }; // 落点=固定钥匙门入口（key 只存部署侧，§1.5）
  ACTIONS['conn-cycle-detail'] = function () { toast('连接态灯（§1.5）', '底座=dsh web 客户端通道活性：绿=帧新鲜（≤2×心跳周期）；琥珀=断开退避重试；红=登录面连续 3 次 401，重走固定入口即愈', ''); };

  function mountConsole(rootEl) {
    ROOT = rootEl;
    ROOT.innerHTML = CC_SHELL;
    if (!document.getElementById('cc-style')) {
      var st = document.createElement('style');
      st.id = 'cc-style';
      st.textContent = CC_CSS;
      document.head.appendChild(st);
    }
    bindDelegation();
    bindKeys();
    window.addEventListener('hashchange', render);
    __CC.conn = __CC.createConnMonitor({ onChange: function (st) { applyConnState(st, {}); } });
    __CC.conn.start();
    applyConnState(__CC.conn.state(), { silent: true });
    // E2 真数据层回调：装载完成即重渲染真数据屏（welcome/tree/s/doc——其余屏不受 LIVE 影响）
    __CC.live.onChange = function () {
      if (!ROOT) return;
      // 'doc'（编辑器）不在列：编辑器自注水（屏加载即现读），live 轻刷新不重渲染（编辑态/textarea 焦点保真）；
      // Apply 成功后的重渲染走 apply 回调显式 LIVE.load().then(render)。
      if (['welcome', 'tree', 's', 'wf', 'ws', 'provider', 'connector', 'ref', 'role', 'agent', 'event', 'events', 'approvals', 'proposals', 'connectors'].indexOf(S.route) >= 0) render();
    };
    boot();
  }
  function unmountConsole() {
    window.removeEventListener('hashchange', render);
    clearTimers();
    stopFollowTimers();
    try { releaseChatHold(); } catch (e) { /* 已离场 */ }
    if (__CC.conn) { __CC.conn.stop(); __CC.conn = null; }
    if (__CC.live) __CC.live.onChange = null;
    if (ROOT) ROOT.innerHTML = '';
    ROOT = null;
  }
  __CC.mountConsole = mountConsole;
  __CC.unmountConsole = unmountConsole;
})();
