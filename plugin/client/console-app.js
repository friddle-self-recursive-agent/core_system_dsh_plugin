// console-proto app.js（整体内嵌起点代码）手术注记：M←__CC.MOCK；ROOT 容器纪律（$/委托/键盘收进容器）；监听与 boot 移入 mountConsole（可卸载）；连接态灯三色 UI 更新（§1.5）；图标 id 加 cc- 前缀
// E2 手术注记（console-adoption.md §1.8）：Welcome 大屏/系统树/系统详情/对象详情/事件详情五屏换 cored
// 读面真数据（__CC.live，经 /core-console/api 宿主代理只读 GET）；其余屏保持 proto mock 待各自 E 轮替换。
/* app.js — core console 原型逻辑（普通 script，无模块） */
(function () {
  'use strict';
  var M = __CC.MOCK;
  var LIVE = __CC.live; // E2 真数据层（console-live.js：cored 读面快照 + ensure/fetchObject）
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
    evFilter: { kinds: {}, level: '', range: '24h', q: '', lanes: {} },
    docFilter: { tags: {}, kind: '', draft: '', q: '' },
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
  function sysByName(n) { return byId(M.systems, 'name', n); }
  function docByName(n) { return byId(M.docs, 'name', n); }
  function wfByName(n) { return byId(M.workflows, 'name', n); }
  function agentByName(n) { return M.agents[n] || null; }
  function instByName(sys, inst) {
    return M.instances.filter(function (i) { return i.system === sys && i.name === inst; })[0] || null;
  }
  function sysDocs(sys) { return M.docs.filter(function (d) { return d.scope === 'systems/' + sys; }); }
  function sysInstances(sys) { return M.instances.filter(function (i) { return i.system === sys; }); }
  function sysAgents(sys) {
    var names = [];
    sysInstances(sys).forEach(function (i) { i.agents.forEach(function (a) { if (names.indexOf(a) < 0) names.push(a); }); });
    return names.map(agentByName).filter(Boolean);
  }
  function evCount24h() { return M.events.filter(function (e) { return (Date.now() - e.ts.getTime()) < 86400000; }).length; }
  function pendingApprovals() { return M.approvals.filter(function (a) { return a.status === '待审'; }); }
  function openDrifts() { return M.docs.filter(function (d) { return d.kind === 'DriftReport' && d.status !== 'Closed'; }); }
  function runningWfs() { return M.workflows.filter(function (w) { return w.phase !== 'Idle' && w.enabled; }); }

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
  function docState(name) {
    var doc = docByName(name);
    if (!doc) return null;
    if (!S.drafts[name]) {
      if (doc.draft) {
        S.drafts[name] = { working: doc.draft, base: doc.content, entries: [{ source: doc.draftSource || 'llm', summary: doc.draftSource === 'manual' ? '手动编辑' : 'LLM 提案', ts: doc.updated }] };
      } else {
        S.drafts[name] = { working: doc.content, base: doc.content, entries: [] };
      }
    }
    var st = S.drafts[name];
    st.base = doc.content;
    return st;
  }
  function docHasDraft(name) {
    var st = docState(name);
    return !!(st && st.working !== st.base);
  }
  function addEvent(lane, kind, level, system, object, msg, link) {
    M.events.unshift({ id: 'ev-live-' + Date.now(), lane: lane, kind: kind, level: level, system: system, object: object, msg: msg, ts: new Date(), link: link || null });
  }
  function resolveApproval(id, verdict) {
    var ap = byId(M.approvals, 'id', id);
    if (!ap || ap.status !== '待审') return;
    ap.status = verdict === 'ok' ? '已批准' : '已驳回';
    ap.resolvedAt = new Date();
    addEvent('event', verdict === 'ok' ? 'ApprovalGranted' : 'ApprovalRejected', verdict === 'ok' ? 'info' : 'warn', ap.scope.replace('systems/', ''), 'Approval/' + id, ap.title + ' → ' + ap.status + (verdict === 'ok' ? '（=Apply）' : ''), '#/approvals');
    if (verdict === 'ok' && ap.id === 'ap-2') { // 批准 ci-impl 提案 = 草稿自动进入文档草稿区（仍需人在编辑器 Apply）
      var doc = docByName('ci-impl');
      if (doc && !docHasDraft('ci-impl')) {
        var st = docState('ci-impl');
        st.working = doc.draft || st.working;
        st.entries.push({ source: 'manual', summary: '审批 ap-2 通过，提案转入草稿', ts: new Date() });
      }
    }
    if (verdict === 'ok' && ap.id === 'ap-1') {
      var prod = instByName('deploy-system', 'prod');
      if (prod) { prod.phase = 'Remediating'; }
      addEvent('phase', 'PhaseChanged', 'info', 'deploy-system', 'ServiceInstance/prod', 'Escalated → Remediating（reason: prod-gate-approved，dep-1 续跑 prod 段）', '#/s/deploy-system/i/prod');
    }
  }
  function healthScore() {
    var insync = M.systems.filter(function (s) { return s.phase === 'InSync'; }).length;
    var esc = M.instances.filter(function (i) { return i.phase === 'Escalated'; }).length;
    var drift = openDrifts().length;
    var pend = pendingApprovals().length;
    var score = 100 - esc * 4 - drift * 2 - pend * 1 - (6 - insync) * 2;
    return { score: Math.max(0, Math.min(100, score)), insync: insync, esc: esc, drift: drift, pend: pend };
  }
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
    add('动作', '与 root（builtinRoot）对话', '#/chat/builtinRoot', 'chat/builtinRoot', 'i-chat');
    add('动作', '打开审批页', pendingApprovals().length + ' 条待审', 'approvals', 'i-check');
    add('动作', '打开事件流', evCount24h() + ' events/24h', 'events', 'i-pulse');
    // 导航
    M.nav.forEach(function (n) { add('导航', n.label, n.route, n.route.replace('#/', ''), n.icon); });
    // 系统
    M.systems.forEach(function (s) { add('系统', s.name, s.phase + ' · ' + s.scope, 's/' + s.name, 'i-grid'); });
    // workflows
    M.workflows.forEach(function (w) { add('Workflows', w.name, (w.enabled ? 'enabled' : 'disabled') + ' · ' + w.phase + ' · ' + w.runsTotal + ' runs', 'wf/' + w.name, 'i-flow'); });
    // agents
    Object.keys(M.agents).forEach(function (a) { add('Agents', a, M.agents[a].phase + ' · ' + M.agents[a].instance, 'agent/' + a, 'i-bot'); });
    // connectors
    M.workservices.forEach(function (w) { add('连接', 'ws/' + w.name, w.kind + ' · ' + w.status, 'ws/' + w.name, 'i-plug'); });
    M.connectorops.forEach(function (c) { add('连接', 'ops/' + c.name, c.status, 'connector/' + c.name, 'i-plug'); });
    M.providers.forEach(function (p) { add('连接', p.name, p.status, 'provider/' + p.name, 'i-key'); });
    // docs（模糊搜索）
    var ql = (q || '').toLowerCase();
    var docs = M.docs;
    if (ql) docs = fuzzyFilter(docs, ql, function (d) { return d.name + ' ' + d.kind + ' ' + d.scope + ' ' + d.tags.join(' '); });
    docs.slice(0, 30).forEach(function (d) {
      add('文档', d.name, d.kind + ' r' + d.revision + (docHasDraft(d.name) ? ' ●draft' : ''), 'doc/' + d.name, 'i-doc');
    });
    // 运行轮次（活跃 + 匹配）
    var runs = [];
    M.workflows.forEach(function (w) {
      (w.runs || []).slice(0, 3).forEach(function (r) { runs.push({ w: w, r: r }); });
    });
    if (ql) runs = fuzzyFilter(runs, ql, function (x) { return x.w.name + ' #' + x.r.no + ' ' + x.r.phase; });
    runs.slice(0, 8).forEach(function (x) {
      add('运行轮次', '#' + x.r.no + ' · ' + x.w.name, x.r.phase + (x.r.trigger ? ' · ' + x.r.trigger : ''), 'wf/' + x.w.name + '/r/' + x.r.no, 'i-clock');
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
  function manualTick() {
    addEvent('event', 'ManualTick', 'info', 'self-recursive-core', 'workflow/core-workflow', '手动触发一轮（manual: root）→ 轮次 #130 入队', '#/wf/core-workflow');
    toast('已入队', 'core-workflow #130 · reason: manual:root', 'ok');
  }
  ACTIONS['manual-tick'] = function () { manualTick(); };
  function newGoalDraft(scope) {
    var name = 'new-goal-' + (Date.now() % 100000);
    var sys = scope === 'global' ? 'global' : scope;
    var doc = {
      name: name, kind: 'Goal', scope: sys === 'global' ? 'global' : 'systems/' + sys, revision: 1, generation: 1,
      status: 'Active', updated: new Date(), fieldManager: 'root', ownerRefs: [], tags: ['goal'], draft: null, draftSource: null,
      history: [{ rev: 1, author: 'root', ts: new Date(), summary: '新建（未 Apply；首次 Apply 才会落库）' }],
      content: 'apiVersion: core/v1\nkind: Goal\nmetadata:\n  name: ' + name + '\n  scope: ' + (sys === 'global' ? 'global' : 'systems/' + sys) + '\nspec:\n  intent: |\n    （写下目标意图；LLM 可在右侧协助完善）\n  slo:\n    metric: target',
      machineWrite: false
    };
    if (sys !== 'global') M.docs.push(doc); else M.docs.push(doc);
    toast('已创建草稿文档', name + '（未 Apply，不落库不发事件）');
    go('doc/' + name);
  }
  ACTIONS['new-goal'] = function (el) { newGoalDraft(el.dataset.scope || 'global'); };

  /* ================= 快捷键注册表 ================= */
  var SHORTCUTS = [
    { keys: ['⌘', 'K'], label: '命令面板', when: '全局', handler: function () { openPalette(); } },
    { keys: ['?'], label: '快捷键速查表', when: '全局（非输入框）', handler: function () { openCheatsheet(); } },
    { keys: ['Esc'], label: '关闭顶层浮层（面板/弹窗/抽屉，逐层退出并还焦点）', when: '全局' },
    { keys: ['['], label: '折叠 / 展开侧栏', when: '全局（非输入框）', handler: function () { toggleSide(); } },
    { keys: ['N'], label: '新建 Goal（草稿，Apply 后落库）', when: '全局（非输入框）', handler: function () { newGoalDraft('global'); } },
    { keys: ['T'], label: '手动触发一轮对账（=入队 toast）', when: '全局（非输入框）', handler: function () { manualTick(); } },
    { keys: ['C'], label: '与 root 对话', when: '全局（非输入框）', handler: function () { go('chat/builtinRoot'); } },
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
      't': manualTick, 'T': manualTick, 'c': function () { go('chat/builtinRoot'); }, 'C': function () { go('chat/builtinRoot'); },
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
  function vlist(container, items, rowH, rowHtml) {
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
    container.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; paint(); });
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
  function renderNav() {
    var pend = pendingApprovals().length;
    var html = '';
    M.nav.forEach(function (n) {
      html += '<div class="nav-item' + (navActive(n) ? ' active' : '') + '" data-act="go" data-go="' + n.route.replace('#/', '') + '" title="' + esc(n.label) + '">' +
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
      truncated: st.events.length >= 100
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

  /* ================= 屏 1：总览（服务关注区） ================= */
  function screenOverview(view) {
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '总览' }]);
    var h = healthScore();
    var stat = '<div class="statbar">' +
      '<div class="stat"><div class="st-num">' + h.insync + '<span class="dim">/6</span></div><div class="st-label"><span class="lamp ok pulse-ok"></span>系统 InSync</div></div>' +
      '<div class="stat"><div class="st-num">' + runningWfs().length + '</div><div class="st-label"><span class="lamp acc"></span>运行中 workflow</div></div>' +
      '<div class="stat"><div class="st-num">' + evCount24h() + '</div><div class="st-label"><span class="lamp acc"></span>24h 事件数</div></div>' +
      '<div class="stat"><div class="st-num">' + h.pend + '</div><div class="st-label"><span class="lamp warn"></span>待审批</div></div>' +
      '<div class="stat' + (h.esc ? ' alert' : '') + '"><div class="st-num">' + h.esc + '</div><div class="st-label"><span class="lamp esc pulse-danger"></span>Escalated</div></div>' +
      '</div>';
    var cards = M.systems.map(function (s) {
      var insts = sysInstances(s.name);
      var drifts = openDrifts().filter(function (d) { return d.scope === 'systems/' + s.name; }).length;
      return '<div class="syscard" data-act="go" data-go="s/' + s.name + '">' +
        '<div class="sc-top"><span class="lamp ' + PHASE_CLS[s.phase] + ' ' + (PHASE_PULSE[s.phase] || '') + '" style="width:10px;height:10px"></span>' +
        '<span class="sc-name">' + esc(s.name) + '</span>' + phaseChip(s.phase) + '</div>' +
        '<div class="sc-meta">' +
          '<span><span class="k">gen:</span> <span class="mono">' + s.observedGeneration + '/' + s.generation + '</span></span>' +
          '<span><span class="k">24h 运行:</span> <span class="mono">' + s.runs24h + '</span></span>' +
          '<span><span class="k">未解决 drift:</span> <span class="mono">' + drifts + '</span></span>' +
          '<span><span class="k">待审批:</span> <span class="mono">' + s.pending + '</span></span>' +
        '</div>' +
        '<div class="sc-foot"><span class="chip mute"><svg class="ic"><use href="#cc-i-bot"/></svg>' + esc(s.agent) + '</span>' +
        '<span class="faint small" style="margin-left:auto">' + insts.length + ' 实例 →</span></div>' +
        '</div>';
    }).join('');
    // 进行中的运行
    var runs = [];
    M.workflows.forEach(function (w) {
      var r = w.runs[0];
      if (r && (r.status === 'running' || r.status === 'waiting')) runs.push({ w: w, r: r });
    });
    var runsHtml = runs.map(function (x) {
      return '<div class="mini-row" data-act="go" data-go="wf/' + x.w.name + '/r/' + x.r.no + '">' +
        '<span class="mono" style="color:#7fb0f9;font-weight:700">#' + x.r.no + '</span>' +
        '<div class="mr-main"><div>' + esc(x.w.name) + '</div><div class="mr-sub">' + esc(x.r.trigger) + ' · ' + fmtAgo(x.r.start) + '</div></div>' +
        phaseChip(x.r.phase) + '</div>';
    }).join('');
    if (!runs.length) runsHtml = '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">没有进行中的运行</div></div>';
    // 最近事件
    var evs = M.events.slice(0, 8).map(function (e) {
      var dot = e.level === 'fatal' || e.level === 'error' ? 'danger' : e.level === 'warn' ? 'warn' : 'acc';
      return '<div class="mini-row" data-act="go" data-go="event/' + e.id + '">' +
        '<span class="lamp ' + dot + '" style="background:var(--' + (dot === 'danger' ? 'danger' : dot === 'warn' ? 'warn' : 'accent') + ')"></span>' +
        '<div class="mr-main"><div>' + esc(e.msg) + '</div><div class="mr-sub mono">' + esc(e.kind) + ' · ' + esc(e.object) + '</div></div>' +
        '<span class="faint mono small">' + fmtTime(e.ts) + '</span></div>';
    }).join('');
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
      '<div class="small faint" style="margin-top:10px">数据源=event_log 归档（/v1/events，最新优先投影）；involved 点击=对象详情（只读 viewer）</div></div>';
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
      '<div class="dh-sub" style="margin-top:8px">场景面（E7 落地，当前不渲染 mock）：<span class="chip mute small">事件面</span>' +
      '<span class="chip mute small">指标面</span><span class="chip mute small">文档面（tag 过滤）</span><span class="chip mute small">权限面</span></div>' +
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
    var inst = instByName(S.params.name, S.params.inst);
    var sys = sysByName(S.params.name);
    if (!inst || !sys) { view.innerHTML = emptyBox('实例不存在', S.params.name + '/' + S.params.inst); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs(sysCrumb(sys, [{ label: inst.name }]));
    var agent = M.agents[inst.agents[0]];
    var docLinks = [['impl', inst.docs.impl], ['verify', inst.docs.verify], ['drift', inst.docs.drift]];
    var docHtml = docLinks.map(function (x) {
      var d = x[1] ? docByName(x[1]) : null;
      return '<div class="kv"><span class="k">' + x[0] + ' 文档</span><span class="v">' +
        (d ? '<span class="lk mono" data-act="go" data-go="doc/' + esc(d.name) + '">' + esc(d.kind) + '/' + esc(d.name) + '</span>' + draftDot(docHasDraft(d.name)) + ' <span class="chip kind small">' + esc(d.kind) + '</span>' : '<span class="faint">—</span>') +
        '</span></div>';
    }).join('');
    var metricRows = inst.metrics.map(function (m2) {
      return '<tr><td class="mono">' + esc(m2.q) + '</td><td class="mono">' + esc(m2.target) + '</td><td class="mono" style="color:' + (/^[<>]/.test(m2.target) ? '#4ade80' : 'inherit') + '">' + esc(m2.current) + '</td></tr>';
    }).join('');
    var condRows = inst.conditions.map(function (c) {
      return '<tr><td>' + esc(c.type) + '</td><td>' + (c.status === 'True' ? '<span class="chip ok small">True</span>' : '<span class="chip danger small">False</span>') + '</td><td class="small muted">' + esc(c.reason) + '</td><td class="mono faint">' + fmtAgo(c.ts) + '</td></tr>';
    }).join('');
    var agentChips = inst.agents.map(function (a) { return '<span class="chip click mute" data-act="go" data-go="agent/' + esc(a) + '"><svg class="ic"><use href="#cc-i-bot"/></svg>' + esc(a) + '</span>'; }).join('');
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(inst.name) + '</h1>' + phaseChip(inst.phase, true) + '<span class="chip kind">ServiceInstance</span></div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(sys.scope) + '/instances/' + esc(inst.name) + '</span>' +
      '<span class="mono">observedGeneration ' + inst.observedGeneration + ' · gen ' + inst.generation + '</span>' +
      '<span>owner: <span class="lk mono" data-act="go" data-go="doc/' + esc(inst.owner) + '">' + esc(inst.owner) + '</span></span></div>' +
      '<div class="dh-sub" style="margin-top:6px">agentRefs: ' + agentChips + '</div></div>' +
      '<div class="dh-actions">' +
      (agent ? '<button class="btn primary lg" data-act="go" data-go="chat/' + esc(agent.name) + '">在对话框调用该 Agent →</button>' : '') +
      '<button class="btn lg" data-act="open-term" data-agent="' + esc(inst.agents[0] || '') + '"><svg class="ic"><use href="#cc-i-term"/></svg>终端 (gotty)</button></div></div>' +
      '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">文档链接</span></div><div class="card-b">' + docHtml + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">metrics 查询声明</span></div><table class="tbl"><thead><tr><th>query</th><th>target</th><th>current</th></tr></thead><tbody>' + metricRows + '</tbody></table></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">Status conditions</span></div><table class="tbl"><thead><tr><th>type</th><th>status</th><th>reason</th><th>时间</th></tr></thead><tbody>' + condRows + '</tbody></table></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">趋势 sparkline</span></div><div class="card-b" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center">' +
      '<div>' + sparkSVG(inst.system + '/' + inst.name + ':m1', '#3b82f6', 150, 44) + '<div class="small faint">' + esc(inst.metrics[0] ? inst.metrics[0].q : 'metric') + '</div></div>' +
      '<div>' + sparkSVG(inst.system + '/' + inst.name + ':m2', '#22c55e', 150, 44, 0.5) + '<div class="small faint">' + esc(inst.metrics[1] ? inst.metrics[1].q : 'metric') + '</div></div>' +
      '</div></div></div></div>';
  }

  /* ================= 场景面：#/:sys/events ================= */
  function scenarioHead(sys, title, sub, backTab) {
    return '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(sys.name) + ' <span style="color:var(--text-2)">' + esc(title) + '</span></h1>' + phaseChip(sys.phase) + '</div>' +
      '<div class="dh-sub">' + esc(sub) + '</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="go" data-go="s/' + esc(sys.name) + '">← 返回系统详情' + (backTab ? '（' + backTab + ' tab）' : '') + '</button></div></div>';
  }
  function screenSysEvents(view) {
    var sys = sysByName(S.params.name);
    if (!sys) { view.innerHTML = emptyBox('系统不存在', S.params.name); return; }
    setCrumbs(sysCrumb(sys, [{ label: '事件面' }]));
    var f = S.evFilter;
    var kinds = [];
    M.events.forEach(function (e) { if (e.system === sys.name && kinds.indexOf(e.kind) < 0) kinds.push(e.kind); });
    kinds.sort();
    var ranges = M.TIME_RANGES;
    view.innerHTML = '<div class="view-inner">' + scenarioHead(sys, '事件面', '类型多选 / 级别 / 时间范围 / 对象搜索 · 虚拟滚动（数据 ' + M.events.length + ' 条）· 行点击进事件详情', '事件') +
      '<div class="filter-bar">' +
      '<svg class="ic" style="color:var(--text-3)"><use href="#cc-i-filter"/></svg>' +
      '<span class="fchip' + (Object.keys(f.kinds).length === 0 ? ' on' : '') + '" data-act="ev-kind" data-k="">全部类型</span>' +
      kinds.map(function (k) { return '<span class="fchip' + (f.kinds[k] ? ' on' : '') + '" data-act="ev-kind" data-k="' + esc(k) + '">' + esc(k) + '</span>'; }).join('') +
      '<select id="ev-level"><option value="">全部级别</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option><option value="fatal">fatal</option></select>' +
      '<select id="ev-range">' + ranges.map(function (r) { return '<option value="' + r.id + '">' + r.label + '</option>'; }).join('') + '</select>' +
      '<input type="search" id="ev-q" placeholder="对象/消息搜索…" style="width:200px">' +
      '<span class="count-note" id="ev-count-note"></span></div>' +
      '<div id="ev-vlist"></div></div>';
    $('#ev-level').value = f.level; $('#ev-range').value = f.range; $('#ev-q').value = f.q;
    paintSysEvents(sys);
    $('#ev-level').addEventListener('change', function () { f.level = this.value; paintSysEvents(sys); });
    $('#ev-range').addEventListener('change', function () { f.range = this.value; paintSysEvents(sys); });
    var deb;
    $('#ev-q').addEventListener('input', function () {
      var v = this.value; clearTimeout(deb);
      deb = setTimeout(function () { f.q = v; paintSysEvents(sys); }, 160);
    });
  }
  function applyEvFilter(sys) {
    var f = S.evFilter;
    var range = byId(M.TIME_RANGES, 'id', f.range) || M.TIME_RANGES[3];
    var kinds = Object.keys(f.kinds).filter(function (k) { return f.kinds[k]; });
    var ql = f.q.toLowerCase();
    return M.events.filter(function (e) {
      if (sys && e.system !== sys.name) return false;
      if (kinds.length && kinds.indexOf(e.kind) < 0) return false;
      if (f.level && e.level !== f.level) return false;
      if ((Date.now() - e.ts.getTime()) > range.min * 60000) return false;
      if (ql && (e.object + ' ' + e.msg + ' ' + e.kind).toLowerCase().indexOf(ql) < 0) return false;
      return true;
    });
  }
  function paintSysEvents(sys) {
    var items = applyEvFilter(sys);
    $('#ev-count-note').textContent = items.length + ' / ' + M.events.length + ' events';
    vlist($('#ev-vlist'), items, 36, function (e) {
      var dot = e.level === 'fatal' || e.level === 'error' ? 'var(--danger)' : e.level === 'warn' ? 'var(--warn)' : 'var(--accent)';
      return '<span class="vc" style="width:8px;height:8px;border-radius:50%;background:' + dot + '"></span>' +
        '<span class="vc mono faint" style="width:52px">' + fmtTime(e.ts) + '</span>' +
        '<span class="vc"><span class="tag">' + esc(e.lane) + '</span></span>' +
        '<span class="vc mono" style="width:130px;color:#7fb0f9">' + esc(e.kind) + '</span>' +
        '<span class="vc mono faint" style="width:200px;overflow:hidden;text-overflow:ellipsis">' + esc(e.object) + '</span>' +
        '<span class="grow">' + esc(e.msg) + '</span>' +
        '<span class="vc chip mute small">' + esc(e.level) + '</span>';
    });
    $('#ev-vlist').onclick = function (ev) {
      var row = ev.target.closest('.vrow');
      if (!row) return;
      var idx = Math.floor((row.offsetTop + this.scrollTop) / 36);
      var it = items[idx];
      if (it) go('event/' + it.id);
    };
  }
  /* 场景面：metrics */
  function screenSysMetrics(view) {
    var sys = sysByName(S.params.name);
    if (!sys) { view.innerHTML = emptyBox('系统不存在', S.params.name); return; }
    setCrumbs(sysCrumb(sys, [{ label: '指标面' }]));
    var insts = sysInstances(sys.name);
    var charts = insts.map(function (i) {
      var rows = i.metrics.map(function (m2) {
        var thr = parseFloat((m2.target.match(/[\d.]+/) || ['1'])[0]);
        return '<div style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
          '<span class="mono" style="font-weight:650">' + esc(m2.q) + '</span><span class="chip mute small">target ' + esc(m2.target) + '</span>' +
          '<span class="chip ok small">current ' + esc(m2.current) + '</span></div>' +
          bigChart(i.system + '/' + i.name + ':' + m2.q, thr, 560, 120) + '</div>';
      }).join('');
      return '<div class="card"><div class="card-h"><span class="h-title mono">' + esc(i.name) + '</span>' + phaseChip(i.phase) +
        '<span class="h-right lk small" data-act="go" data-go="s/' + esc(i.system) + '/i/' + esc(i.name) + '">实例详情 →</span></div><div class="card-b">' + rows + '</div></div>';
    }).join('');
    var thrEvents = M.events.filter(function (e) { return e.kind === 'MetricThreshold' && e.system === sys.name; }).slice(0, 8);
    var thrHtml = thrEvents.length ? thrEvents.map(function (e) {
      return '<div class="mini-row" data-act="go" data-go="event/' + esc(e.id) + '"><span class="lamp warn"></span><div class="mr-main"><div>' + esc(e.msg) + '</div><div class="mr-sub mono">' + esc(e.object) + '</div></div><span class="faint mono small">' + fmtAgo(e.ts) + '</span></div>';
    }).join('') : '<div class="empty" style="padding:16px"><div class="e-title">24h 内无越线事件</div></div>';
    view.innerHTML = '<div class="view-inner">' + scenarioHead(sys, '指标面', '查询声明表 + mock 曲线（SVG path 自绘）+ 阈值线 + 最近越线事件', '状态') +
      '<div class="grid" style="grid-template-columns:1fr 320px">' +
      '<div style="display:grid;gap:14px">' + charts + '</div>' +
      '<div class="card" style="align-self:start"><div class="card-h"><span class="h-title">最近越线事件（MetricThreshold）</span></div><div class="mini-list">' + thrHtml + '</div></div>' +
      '</div></div>';
  }
  /* 场景面：docs（tag 过滤完整视图） */
  function allTags(docs) {
    var t = [];
    docs.forEach(function (d) { d.tags.forEach(function (x) { if (t.indexOf(x) < 0) t.push(x); }); });
    return t.sort();
  }
  function screenSysDocs(view) {
    var sys = sysByName(S.params.name);
    if (!sys) { view.innerHTML = emptyBox('系统不存在', S.params.name); return; }
    setCrumbs(sysCrumb(sys, [{ label: '文档面' }]));
    paintDocsScreen(view, sysDocs(sys.name), 's/' + sys.name, 'systems/' + sys.name);
  }
  function screenDocsGlobal(view) {
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '文档' }]);
    paintDocsScreen(view, M.docs, 'overview', '全部 scope（global + systems/*）');
  }
  function paintDocsScreen(view, baseDocs, backGo, scopeLabel) {
    var f = S.docFilter;
    var tags = allTags(baseDocs);
    var kinds = M.DOC_KINDS;
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>文档面</h1><span class="chip kind">' + esc(scopeLabel) + '</span></div>' +
      '<div class="dh-sub">tag chips 多选 × kind 过滤 × 草稿过滤 × 搜索 组合生效 · 虚拟滚动 · 共 ' + baseDocs.length + ' 文档对象（文档与资源同规则）</div></div>' +
      '<div class="dh-actions"><button class="btn primary" data-act="new-goal">+ 新建文档</button>' +
      (backGo ? '<button class="btn" data-act="go" data-go="' + esc(backGo) + '">← 返回</button>' : '') + '</div></div>' +
      '<div class="filter-bar">' +
      '<span class="fchip' + (Object.keys(f.tags).every(function (k) { return !f.tags[k]; }) ? ' on' : '') + '" data-act="doc-tag" data-t="">全部 tags</span>' +
      tags.map(function (t) { return '<span class="fchip' + (f.tags[t] ? ' on' : '') + '" data-act="doc-tag" data-t="' + esc(t) + '">#' + esc(t) + '</span>'; }).join('') +
      '</div>' +
      '<div class="filter-bar">' +
      '<select id="df-kind"><option value="">全部 kind</option>' + kinds.map(function (k) { return '<option>' + k + '</option>'; }).join('') + '</select>' +
      '<select id="df-draft"><option value="">全部草稿态</option><option value="has">仅未 Apply 草稿 ●</option><option value="none">无草稿</option></select>' +
      '<input type="search" id="df-q" placeholder="名称 / 内容搜索…" style="width:220px">' +
      '<span class="count-note" id="df-note"></span></div>' +
      '<div id="df-vlist"></div></div>';
    $('#df-kind').value = f.kind; $('#df-draft').value = f.draft; $('#df-q').value = f.q;
    paintDocsList(baseDocs);
    $('#df-kind').addEventListener('change', function () { f.kind = this.value; paintDocsList(baseDocs); });
    $('#df-draft').addEventListener('change', function () { f.draft = this.value; paintDocsList(baseDocs); });
    var deb;
    $('#df-q').addEventListener('input', function () { var v = this.value; clearTimeout(deb); deb = setTimeout(function () { f.q = v; paintDocsList(baseDocs); }, 160); });
  }
  ACTIONS['doc-tag'] = function (el) {
    var t = el.dataset.t;
    if (!t) S.docFilter.tags = {};
    else S.docFilter.tags[t] = !S.docFilter.tags[t];
    if (S.route === 'docs') render(); else render();
  };
  function filterDocs(baseDocs) {
    var f = S.docFilter;
    var sel = Object.keys(f.tags).filter(function (k) { return f.tags[k]; });
    var ql = f.q.toLowerCase();
    return baseDocs.filter(function (d) {
      if (sel.length && !sel.every(function (t) { return d.tags.indexOf(t) >= 0; })) return false;
      if (f.kind && d.kind !== f.kind) return false;
      var has = docHasDraft(d.name);
      if (f.draft === 'has' && !has) return false;
      if (f.draft === 'none' && has) return false;
      if (ql && (d.name + ' ' + d.content).toLowerCase().indexOf(ql) < 0) return false;
      return true;
    });
  }
  function paintDocsList(baseDocs) {
    var items = filterDocs(baseDocs);
    $('#df-note').textContent = items.length + ' / ' + baseDocs.length + ' docs';
    vlist($('#df-vlist'), items, 36, function (d) {
      return '<svg class="ic" style="color:#5b6378"><use href="#cc-i-doc"/></svg>' +
        '<span class="mono" style="width:230px;font-weight:600">' + esc(d.name) + '</span>' + draftDot(docHasDraft(d.name)) +
        '<span class="vc"><span class="chip kind">' + esc(d.kind) + '</span></span>' +
        '<span class="vc" style="width:150px">' + d.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(' ') + '</span>' +
        '<span class="vc mono faint" style="width:44px">r' + d.revision + '</span>' +
        (docHasDraft(d.name) ? '<span class="vc"><span class="chip warn small">● 未 Apply</span></span>' : '<span class="vc faint">—</span>') +
        '<span class="grow faint">' + esc(d.fieldManager) + ' · ' + fmtAgo(d.updated) + '</span>';
    });
    $('#df-vlist').onclick = function (ev) {
      var row = ev.target.closest('.vrow');
      if (!row) return;
      var idx = Math.floor((row.offsetTop + this.scrollTop) / 36);
      var it = items[idx];
      if (it) go('doc/' + it.name);
    };
  }
  /* 场景面：permissions */
  function screenSysPermissions(view) {
    var sys = sysByName(S.params.name);
    if (!sys) { view.innerHTML = emptyBox('系统不存在', S.params.name); return; }
    setCrumbs(sysCrumb(sys, [{ label: '权限面' }]));
    var agents = sysAgents(sys.name);
    var roles = M.roles.filter(function (r) { return r.scope.indexOf(sys.name) >= 0 || r.scope === 'global'; });
    var cops = M.connectorops;
    var opsCols = cops.map(function (c) { return c.name; }).concat(['Apply 写路径', 'Status 直写']);
    function cellFor(name, col) {
      var a = agentByName(name);
      var role = roles.filter(function (r) { return r.name === name; })[0];
      var perms = a ? a.perms : (role ? { connectorops: cops.filter(function (c) { return c.name !== 'gotty-web' || role.name !== 'ci-verify'; }).map(function (c) { return c.name; }), refs: [], providers: ['llm-main'], roles: [role.name] } : null);
      if (!perms) return ['✗', 'mute'];
      if (col === 'Apply 写路径') {
        if (name === 'builtinRoot' || role && role.name === 'approver') return ['部分', 'warn'];
        return ['✗', 'mute'];
      }
      if (col === 'Status 直写') return ['✓', 'ok'];
      if (perms.connectorops.indexOf(col) >= 0) {
        var partial = (name === 'dep-1' && col === 'onedev-ci') || (name === 'ci-verify');
        return [partial ? '部分' : '✓', partial ? 'warn' : 'ok'];
      }
      if (role && role.scope === 'global' && name.indexOf('root') >= 0) return ['✓', 'ok'];
      return ['✗', 'mute'];
    }
    var rows = agents.map(function (a) { return a.name; }).concat(roles.map(function (r) { return r.name; }));
    var matrix = '<div class="card"><div class="card-h"><span class="h-title">权限矩阵（行 = agent / role，列 = ConnectorOps / 写路径）</span><span class="h-sub">✓ 全量 · 部分（受 scope/gate 约束） · ✗ 无权限</span></div>' +
      '<div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table class="tbl"><thead><tr><th style="min-width:140px">agent / role</th>' +
      opsCols.map(function (c) { return '<th style="min-width:70px">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var isAgent = !!agentByName(r);
        return '<tr><td class="mono">' + (isAgent ? '<svg class="ic"><use href="#cc-i-bot"/></svg> ' : '<svg class="ic"><use href="#cc-i-key"/></svg> ') + esc(r) + '</td>' +
        opsCols.map(function (c) {
          var v = cellFor(r, c);
          var color = v[1] === 'ok' ? '#4ade80' : v[1] === 'warn' ? '#fbbf24' : 'var(--text-3)';
          return '<td class="mono" style="color:' + color + ';text-align:center">' + v[0] + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
    var mountRows = roles.map(function (r) {
      var holders = Object.keys(M.agents).filter(function (a) { return M.agents[a].perms.roles.indexOf(r.name) >= 0; });
      return '<tr><td class="mono">' + esc(r.name) + '</td><td><span class="path-mono">' + esc(r.scope) + '</span></td><td class="small muted">' + esc(r.desc) + '</td>' +
        '<td>' + (holders.length ? holders.map(function (h) { return '<span class="lk mono small" data-act="go" data-go="agent/' + esc(h) + '">' + esc(h) + '</span>'; }).join(' ') : '<span class="faint">未挂载</span>') + '</td></tr>';
    }).join('');
    var sens = [
      { op: 'deploy-system prod 段发布', gate: 'ask（高危门禁）', who: 'dep-1 提案 → root 批' },
      { op: 'global scope 文档 Apply', gate: 'approver role', who: 'root' },
      { op: '跨系统提案（默认进对方待审区）', gate: '对方 workflow/人审', who: 'dev-1 → deploy-system（ap-4）' },
      { op: 'Status 回写（机器直写）', gate: 'fieldManager 白名单', who: 'workflow/* · agent 回写' }
    ];
    var sensRows = sens.map(function (x) {
      return '<tr><td>' + esc(x.op) + '</td><td><span class="chip warn small">' + esc(x.gate) + '</span></td><td class="small muted">' + esc(x.who) + '</td></tr>';
    }).join('');
    view.innerHTML = '<div class="view-inner">' + scenarioHead(sys, '权限面', 'role 挂载表 + 权限矩阵 + 高敏操作（上级委派=token 整包下发，子 ⊆ 父）', 'Agent') +
      '<div class="grid" style="grid-template-columns:1fr">' + matrix +
      '<div class="card"><div class="card-h"><span class="h-title">Role 挂载表</span></div><table class="tbl"><thead><tr><th>role</th><th>scope</th><th>说明</th><th>挂载者</th></tr></thead><tbody>' + mountRows + '</tbody></table></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">高敏操作</span></div><table class="tbl"><thead><tr><th>操作</th><th>门禁</th><th>路径</th></tr></thead><tbody>' + sensRows + '</tbody></table></div>' +
      '</div></div>';
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
          '<td>' + (w.latest ? runStatusChip(w.latest.status, w.latest.phase) : '<span class="faint small">无现势 run</span>') + '</td>' +
          '<td class="mono num">' + w.runsTotal + ' <span class="faint">/ ' + w.runs24h + 'h</span></td>' +
          '<td><span class="faint small" title="成功率不投影：run 终态事件未落归档（declared 余量）——n/a 不冒充">n/a</span></td>' +
          '<td class="mono faint">' + (w.latest ? fmtAgo(new Date(w.latest.startedAt)) : '—') + '</td>' +
          '<td style="max-width:280px">' + docsChips + '</td></tr>';
      }).join('');
      inner = '<div class="card"><table class="tbl"><thead><tr><th>名称</th><th>生效 scope</th><th>启用 (=Apply)</th><th>当前相位</th>' +
        '<th>运行次数 总/24h</th><th>成功率</th><th>最近运行</th><th>涉及文档</th></tr></thead><tbody>' + (rowsHtml || '') + '</tbody></table></div>' +
        '<div class="small faint" style="margin-top:8px">计数口径=event_log 归档 ×dispatch 决议（含冷却窗内被拦阻触发——' + (st.wfAgg.scanCapped ? '扫描有界已收敛' : '全窗') + '）；启停=override 语义 Apply（builtin 本体不动）</div>';
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
  function wfLiveTabConfig(row) {
    var tt = wfToggleTarget(row);
    if (!tt.target) {
      return '<div class="card"><div class="card-h"><span class="h-title">spec（builtin 注册表——无文档本体）</span></div>' +
        '<div class="card-b"><div class="small faint" style="padding:4px 0">声明随运行时 builtin 注册表（相位词汇映射表同源，concepts/workflow.md §1）；override 编辑=E4 编辑器轮余量。</div>' +
        '<div class="yaml-block">' + esc('phases: [' + (row.phases || []).join(', ') + ']\nspecSource: ' + row.specSource) + '</div></div></div>';
    }
    var obj = tt.target;
    return '<div class="card"><div class="card-h"><span class="h-title">spec yaml（' + esc(obj.scope) + ' r' + obj.resourceVersion + ' · origin ' + esc(obj.origin) + '）</span>' +
      '<span class="h-right"><span class="lk small" data-act="wf-edit-spec" data-wf="' + esc(row.name) + '">编辑（→ 对象 viewer，E4 起 Apply 全链）</span></span></div>' +
      '<div class="card-b" id="wf-config-yaml"><div class="skel-row"><div class="skel" style="width:220px"></div></div></div></div>';
  }
  function hydrateWfConfig(row) {
    var obj = wfToggleTarget(row).target;
    if (!obj) return;
    hydrate('wf-config-yaml', 'v1/objects/Workflow/' + encodeURIComponent(row.name) + '?scope=' + encodeURIComponent(obj.scope),
      function (el, b) {
        el.innerHTML = '<div class="yaml-block">' + esc(String(b.content || '')) + '</div>';
      });
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
    var tabs = [['llm', 'LLM 提案'], ['draft', '草稿'], ['hist', '历史'], ['meta', '元数据']];
    var tab = S.docTab[key] || 'llm';
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
    var tab = S.docTab[key] || 'llm';
    var el = $('#collab-body');
    if (!el) return;
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
  /* ================= 屏 7：Agent 对话（dsh Conversation shell） ================= */
  function chatUiFor(agent) {
    var u = S.chatUi[agent] = S.chatUi[agent] || {};
    var sess = M.sessions.filter(function (s) { return s.agent === agent; });
    if (!u.sessionId || !sess.filter(function (s) { return s.id === u.sessionId; }).length) u.sessionId = sess[0] ? sess[0].id : null;
    if (!u.view) u.view = 'chat';
    if (!u.tab) u.tab = 'chat';
    if (!u.filter) u.filter = 'all';
    return u;
  }
  function ensureTermSession(agent) {
    var gs = M.sessions.filter(function (s) { return s.agent === agent && s.runner === 'gotty'; })[0];
    if (gs) return gs;
    var s = {
      id: 'sess-term-' + agent + '-' + (Date.now() % 10000), agent: agent, title: 'gotty 终端会话', runner: 'gotty',
      created: new Date(), pinned: false, archived: false, tokens: 0, messages: [
        { id: 'm-t0', role: 'agent', text: '终端会话已建立（gotty-web，runner=gotty）。切到「终端」tab 直接敲命令：status / tick / help。', ts: new Date(), cards: [], meta: null }
      ], traj: [{ ts: new Date(), kind: 'tool', label: 'gotty-web.open-terminal', detail: 'tty 建立成功' }]
    };
    M.sessions.unshift(s);
    return s;
  }
  function screenChat(view) {
    var agent = agentByName(S.params.agent);
    if (!agent) { view.innerHTML = emptyBox('agent 不存在', S.params.agent); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    var u = chatUiFor(agent.name);
    if (u.forceTerm) { u.forceTerm = false; var ts2 = ensureTermSession(agent.name); u.sessionId = ts2.id; u.tab = 'term'; }
    var sess = M.sessions.filter(function (s) { return s.agent === agent.name; });
    var cur = sess.filter(function (s) { return s.id === u.sessionId; })[0] || sess[0];
    if (cur && u.sessionId !== cur.id) u.sessionId = cur.id;
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '会话', go: 'chat/builtinRoot' }, { label: agent.name }]);
    var inst = agent.instance;
    var instLink = '<span class="lk mono small" data-act="go" data-go="s/' + esc(inst.split('/')[0]) + '/i/' + esc(inst.split('/')[1]) + '">' + esc(inst) + '</span>';
    /* 左栏 */
    var filtered = sess.filter(function (s) {
      if (u.filter === 'pinned' && !s.pinned) return false;
      if (u.filter === 'archived' && !s.archived) return false;
      if (u.filter === 'all' && s.archived) return false;
      if (u.search && (s.title + ' ' + s.id).toLowerCase().indexOf(u.search.toLowerCase()) < 0) return false;
      return true;
    });
    var sessRows = filtered.map(function (s) {
      return '<div class="sess-row' + (cur && s.id === cur.id ? ' sel' : '') + (s.archived ? ' archived' : '') + '" data-act="chat-sess" data-id="' + esc(s.id) + '">' +
        '<div class="ss-title">' + (s.pinned ? '<span style="color:var(--warn)">📌 </span>' : '') + esc(s.title) + '</div>' +
        '<div class="ss-sub"><span class="runner-tag">' + esc(s.runner) + '</span><span class="mono">' + fmtAgo(s.created) + '</span><span>' + (s.tokens ? (s.tokens / 1000).toFixed(1) + 'k tok' : '') + '</span></div>' +
        '<span class="ss-menu">' +
        '<button class="icon-btn" style="width:22px;height:22px" data-act="chat-pin" data-id="' + esc(s.id) + '" title="' + (s.pinned ? '取消置顶' : '置顶') + '"><svg class="ic"><use href="#cc-i-pin"/></svg></button>' +
        '<button class="icon-btn" style="width:22px;height:22px" data-act="chat-archive" data-id="' + esc(s.id) + '" title="' + (s.archived ? '取消归档' : '归档') + '"><svg class="ic"><use href="#cc-i-archive"/></svg></button>' +
        '</span></div>';
    }).join('');
    if (!sessRows.length) sessRows = '<div class="empty" style="padding:26px"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">无会话</div><div>' + (u.filter === 'archived' ? '归档区为空' : '新建一个开始对话') + '</div></div>';
    var left = '<div class="chat-sub"><div class="cs-head">' +
      '<div class="cs-agent"><span class="avatar" style="background:rgba(59,130,246,.2);color:#7fb0f9"><svg class="ic"><use href="#cc-i-bot"/></svg></span>' +
      '<div><div class="ca-name">' + esc(agent.name) + '</div><div class="ca-sub mono">' + esc(agent.phase) + ' · ' + instLink + '</div></div></div>' +
      '<div class="cs-filter">' + [['all', '全部'], ['pinned', '置顶'], ['archived', '已归档']].map(function (f) {
        return '<span class="cf-tab' + (u.filter === f[0] ? ' on' : '') + '" data-act="chat-filter" data-f="' + f[0] + '">' + f[1] + '</span>';
      }).join('') + '</div>' +
      '<div class="cs-search"><svg class="ic"><use href="#cc-i-search"/></svg><input id="chat-search" placeholder="搜索会话…" value="' + esc(u.search || '') + '"></div>' +
      '<button class="btn primary sm" data-act="chat-new" data-agent="' + esc(agent.name) + '">+ 新建会话</button>' +
      '</div><div class="cs-list">' + sessRows + '</div></div>';
    /* 中栏 */
    var isTerm = cur && (cur.runner === 'gotty' || u.tab === 'term');
    var tabs = isTerm ? '<div class="term-tabs">' +
      '<div class="term-tab' + (u.tab === 'chat' ? ' active' : '') + '" data-act="chat-tab" data-t="chat">对话</div>' +
      '<div class="term-tab' + (u.tab === 'term' ? ' active' : '') + '" data-act="chat-tab" data-t="term">终端</div></div>' : '';
    var center = '<div class="chat-main">' +
      '<div class="chat-headbar">' +
      '<div class="view-switch">' +
      '<div class="vs-opt' + (u.view === 'chat' ? ' on' : '') + '" data-act="chat-view" data-v="chat">Chat</div>' +
      '<div class="vs-opt' + (u.view === 'traj' ? ' on' : '') + '" data-act="chat-view" data-v="traj">Trajectory</div></div>' +
      '<span style="font-weight:650;font-size:13px">' + (cur ? esc(cur.title) : '无会话') + '</span>' +
      (cur ? '<span class="runner-tag">' + esc(cur.runner) + '</span>' : '') +
      '<span style="margin-left:auto" class="small faint">' + (cur ? cur.messages.length + ' 条消息 · ' + (cur.tokens / 1000 || 0).toFixed(1) + 'k tok' : '') + '</span></div>' +
      tabs + chatBody(agent, cur, u) + '</div>';
    /* 右栏 */
    var right = '<div class="chat-ctx">' +
      '<div class="ctx-sec"><div class="cx-h">权限面（token: ' + esc(agent.scopeSummary.split('：')[1] || '') + '）</div><div class="cx-b">' +
      '<div class="ctx-row"><span class="cr-k">ConnectorOps</span>' + agent.perms.connectorops.map(function (c) { return '<span class="chip click mute small" data-act="go" data-go="connector/' + esc(c) + '">' + esc(c) + '</span>'; }).join(' ') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">Ref</span>' + agent.perms.refs.map(function (r) { return '<span class="chip click mute small" data-act="go" data-go="ref/' + encodeURIComponent(r) + '">' + esc(r) + '</span>'; }).join(' ') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">Provider</span>' + agent.perms.providers.map(function (p) { return '<span class="chip click mute small" data-act="go" data-go="provider/' + esc(p) + '">' + esc(p) + '</span>'; }).join(' ') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">Role</span>' + agent.perms.roles.map(function (r) { return '<span class="chip click mute small" data-act="go" data-go="role/' + esc(r) + '">' + esc(r) + '</span>'; }).join(' ') + '</div>' +
      '<div class="small faint" style="margin-top:4px">' + esc(agent.scopeSummary) + ' · 子 agent 权限 ⊆ 父</div>' +
      '</div></div>' +
      '<div class="ctx-sec"><div class="cx-h">归属与任务</div><div class="cx-b">' +
      '<div class="ctx-row"><span class="cr-k">owner</span>' + instLink + '</div>' +
      '<div class="ctx-row"><span class="cr-k">父 agent</span>' + (agent.parent ? '<span class="lk mono" data-act="go" data-go="agent/' + esc(agent.parent) + '">' + esc(agent.parent) + '</span>' : '<span class="faint">—（root）</span>') + '</div>' +
      '<div class="ctx-row"><span class="cr-k">最近任务</span><span>' + esc(agent.lastTask) + '</span></div></div></div>' +
      '<div class="ctx-sec"><div class="cx-h">实时状态</div><div class="cx-b">' +
      '<div class="live-status"><span class="lamp acc pulse-dot"></span>' + esc(agent.phase) + ' · 心跳正常</div>' +
      '<div class="ctx-row"><span class="cr-k">token 用量</span></div>' +
      '<div class="progress" title="会话累计 / 30k 上下文窗口"><i style="width:' + Math.min(100, (cur ? cur.tokens : 0) / 300) + '%"></i></div>' +
      '<div class="small faint mono">' + (cur ? cur.tokens : 0) + ' / 30000</div></div></div>' +
      '<div class="ctx-sec"><div class="cx-h">详情</div><div class="cx-b"><span class="lk small" data-act="go" data-go="agent/' + esc(agent.name) + '">agent 详情页 →</span>' +
      (cur ? '<span class="lk small" data-act="go" data-go="session/' + esc(cur.id) + '">session 详情（trajectory 独立页）→</span>' : '') + '</div></div>' +
      '</div>';
    view.classList.add('nopad');
    view.innerHTML = '<div class="chat-layout">' + left + center + right + '</div>';
    bindChat(agent, cur, u);
    if (cur && u.tab === 'term' && isTerm) initTerminal(cur);
  }
  function chatBody(agent, cur, u) {
    if (!cur) return '<div class="chat-scroll"><div class="empty"><svg class="ic"><use href="#cc-i-chat"/></svg><div class="e-title">没有会话</div><div class="e-act"><button class="btn primary" data-act="chat-new" data-agent="' + esc(agent.name) + '">新建会话</button></div></div></div>' + inputBar(agent);
    if (u.view === 'traj') {
      var items = cur.traj || [];
      var html = items.map(function (t, i) {
        return '<div class="traj-item kind-' + esc(t.kind) + '"><div class="traj-rail"><div class="traj-dot"></div>' + (i < items.length - 1 ? '<div class="traj-line"></div>' : '') + '</div>' +
          '<div><div style="display:flex;gap:8px;align-items:center"><span class="traj-kind">' + esc(t.kind) + '</span><span class="traj-label">' + esc(t.label) + '</span>' +
          '<span class="mono faint small">' + fmtTime(t.ts) + '</span></div><div class="traj-detail">' + esc(t.detail) + '</div></div></div>';
      }).join('');
      return '<div class="traj-scroll">' + (html || '<div class="empty"><div class="e-title">轨迹为空</div></div>') + '</div>';
    }
    if (u.tab === 'term') return '<div class="term-wrap"><div class="term" id="term-box"></div></div>';
    var msgs = cur.messages.map(function (m) {
      var cards = (m.cards || []).map(cardHtml).join('');
      var tail = m.role === 'agent' && m.meta ? '<div class="turn-tail"><span>⏱ ' + fmtTime(m.ts) + '</span><span>' + m.meta.steps + ' steps</span><span>' + m.meta.tokens + ' tok</span><span>model: flash-tier</span><span>fieldManager: ' + esc(agent.name) + '</span></div>' : '';
      return '<div class="msg-row"><div class="msg-avatar ' + m.role + '">' + (m.role === 'agent' ? '◆' : '你') + '</div><div class="msg-body">' +
        '<div class="msg-who"><span class="who-name">' + (m.role === 'agent' ? esc(agent.name) : 'root') + '</span><span class="mono">' + fmtTime(m.ts) + '</span></div>' +
        '<div class="msg-text' + (m.streaming ? ' typing' : '') + '">' + esc(m.text) + (m.streaming ? '<span class="typing-caret"></span>' : '') + '</div>' +
        (cards ? '<div class="msg-cards">' + cards + '</div>' : '') + tail + '</div></div>';
    }).join('');
    return '<div class="chat-scroll" id="chat-scroll">' + (msgs || '<div class="empty"><div class="e-title">会话为空</div><div>发第一条消息</div></div>') + '</div>' + inputBar(agent);
  }
  function cardHtml(c) {
    if (c.type === 'op') {
      var payload = typeof c.payload === 'object' ? JSON.stringify(c.payload, null, 1) : String(c.payload);
      return '<div class="mcard op"><div class="mc-head" data-act="card-toggle"><svg class="ic"><use href="#cc-i-plug"/></svg><span class="mc-op">' + esc(c.op) + '</span>' +
        (c.target ? '<span>→ ' + esc(c.target) + '</span>' : '') + '<span class="mc-status">' + (c.status === '运行中' ? '<span class="chip acc small">运行中</span>' : '<span class="chip ok small">' + esc(c.status || '已确认') + '</span>') + '</span>' +
        '<svg class="ic" style="margin-left:4px"><use href="#cc-i-down"/></svg></div>' +
        '<div class="mc-body" hidden><div class="kv"><span class="k">payload</span><span class="v"><pre class="mono" style="white-space:pre-wrap;font-size:11px">' + esc(payload) + '</pre></span>' +
        (c.detail ? '<span class="k">detail</span><span class="v">' + esc(c.detail) + '</span>' : '') + '</div></div></div>';
    }
    if (c.type === 'files') {
      return '<div class="mcard files"><div class="mc-head" data-act="card-toggle"><svg class="ic"><use href="#cc-i-doc"/></svg><span class="mc-title">改动文件（changed-files）</span><span class="faint small">' + esc(c.note || '') + '</span><svg class="ic" style="margin-left:auto"><use href="#cc-i-down"/></svg></div>' +
        '<div class="mc-body">' + c.files.map(function (f) {
          return '<div class="file-row"><span class="fp grow">' + esc(f.path) + '</span><span class="fadd mono">' + f.add + '</span><span class="fdel mono">' + f.del + '</span><span class="fst"><span class="chip mute small">' + esc(f.status) + '</span></span></div>';
        }).join('') +
        '<div style="margin-top:8px"><span class="lk small" data-act="go" data-go="doc/quality-goal">打开相关文档编辑器（深链）→</span></div></div></div>';
    }
    if (c.type === 'proposal') {
      return '<div class="mcard proposal"><div class="mc-head" data-act="card-toggle"><svg class="ic" style="color:var(--llm)"><use href="#cc-i-spark"/></svg><span class="mc-title">文档修改提案 · ' + esc(c.doc) + '</span><span class="mc-status"><span class="chip llm small">LLM 只提案</span></span><svg class="ic"><use href="#cc-i-down"/></svg></div>' +
        '<div class="mc-body"><div class="small" style="margin-bottom:6px">' + esc(c.title) + '</div>' + renderDiff(c.diff, 20) +
        '<div style="margin-top:8px"><span class="lk small" data-act="go" data-go="doc/' + esc(c.doc) + '">打开编辑器（深链）→</span></div></div></div>';
    }
    if (c.type === 'approval') {
      var ap = byId(M.approvals, 'id', c.id);
      var st2 = ap ? ap.status : '待审';
      return '<div class="mcard approval"><div class="mc-head" style="cursor:default"><svg class="ic" style="color:var(--danger)"><use href="#cc-i-check"/></svg><span class="mc-title">审批请求</span>' +
        '<span class="mc-status">' + (st2 === '待审' ? '<span class="chip warn small">待审</span>' : '<span class="chip ok small">' + esc(st2) + '</span>') + '</span></div>' +
        '<div class="mc-body"><div class="small">' + esc(c.title) + '</div><div style="margin-top:8px"><span class="lk small" data-act="go" data-go="approvals">去审批页处理 →</span></div></div></div>';
    }
    if (c.type === 'diag') {
      return '<div class="mcard diag"><div class="mc-head" data-act="card-toggle"><svg class="ic" style="color:var(--esc)"><use href="#cc-i-warn"/></svg><span class="mc-title">诊断 view</span><svg class="ic" style="margin-left:auto"><use href="#cc-i-down"/></svg></div>' +
        '<div class="mc-body">' + (c.items || []).map(function (d) {
          return '<div class="diag-item"><span class="d-sev ' + esc(d.sev) + '">' + esc(d.sev) + '</span><span>' + esc(d.msg) + '</span></div>';
        }).join('') + '</div></div>';
    }
    return '';
  }
  ACTIONS['card-toggle'] = function (el) {
    var body = el.parentElement.querySelector('.mc-body');
    if (body) body.hidden = !body.hidden;
  };
  function inputBar(agent) {
    return '<div class="chat-inputbar"><div class="chat-input-wrap">' +
      '<textarea id="chat-input" rows="1" placeholder="发送给 ' + esc(agent.name) + '…（Enter 发送，LLM 改文档只进草稿）"></textarea>' +
      '<button class="btn primary sm" data-act="chat-send">发送</button></div>' +
      '<div class="chat-hints"><span>试问：' + esc(agent.persona) + '</span><span style="margin-left:auto">' + kbd('Enter') + ' 发送 · 权限见右栏</span></div></div>';
  }
  function bindChat(agent, cur, u) {
    var search = $('#chat-search');
    if (search) search.addEventListener('input', function () { u.search = this.value; paintSessListOnly(agent); });
    var ta = $('#chat-input');
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(agent, cur, ta.value); }
      });
      ta.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(120, this.scrollHeight) + 'px'; });
    }
    var scroll = $('#chat-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }
  function paintSessListOnly(agent) { render(); }
  ACTIONS['chat-filter'] = function (el) { S.chatUi[S.params.agent].filter = el.dataset.f; render(); };
  ACTIONS['chat-view'] = function (el) { S.chatUi[S.params.agent].view = el.dataset.v; render(); };
  ACTIONS['chat-tab'] = function (el) { S.chatUi[S.params.agent].tab = el.dataset.t; render(); };
  ACTIONS['chat-sess'] = function (el) { var u = S.chatUi[S.params.agent]; u.sessionId = el.dataset.id; u.tab = 'chat'; render(); };
  ACTIONS['chat-pin'] = function (el, e) {
    e.stopPropagation();
    var s = byId(M.sessions, 'id', el.dataset.id);
    if (s) { s.pinned = !s.pinned; toast(s.pinned ? '已置顶' : '已取消置顶', s.title); }
    render();
  };
  ACTIONS['chat-archive'] = function (el, e) {
    e.stopPropagation();
    var s = byId(M.sessions, 'id', el.dataset.id);
    if (s) {
      s.archived = !s.archived;
      toast(s.archived ? '已归档' : '已取消归档（unarchive）', s.title + (s.archived ? ' · 归档行置灰，可通过「已归档」过滤恢复' : ''));
      var u = S.chatUi[S.params.agent];
      if (s.archived && u.sessionId === s.id) { u.sessionId = null; }
    }
    render();
  };
  ACTIONS['chat-new'] = function (el) {
    var agentName = el.dataset.agent || S.params.agent;
    var runners = [
      { id: 'dsh', name: '内嵌 dsh', desc: '默认 runner：宿主内 ctx.agents 父子机制，权限 ⊆ 父' },
      { id: 'opencode', name: 'opencode cli', desc: '经 gotty-web 以 opencode cli 拉起，文件面操作' },
      { id: 'claude-code', name: 'claude-code', desc: '经 gotty-web 以 claude-code 拉起' },
      { id: 'gotty', name: 'gotty 终端', desc: '会话带终端 tab（网页终端直连）' }
    ];
    var sel = 'dsh';
    openModal('<div class="modal-h"><span class="m-title">新建会话 · 运行器选择</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b"><div class="runner-cards" id="runner-cards">' +
      runners.map(function (r) {
        return '<div class="runner-card' + (r.id === sel ? ' sel' : '') + '" data-runner="' + r.id + '"><div class="rc-name">' + esc(r.name) + '</div><div class="rc-desc">' + esc(r.desc) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="small faint" style="margin-top:10px">上级委派 = 权限整包下发（token），子 agent 权限 ⊆ 父（' + esc(agentName) + ' 的 token 见右栏）。</div></div>' +
      '<div class="modal-f"><button class="btn" data-act="close-modal">取消</button><button class="btn primary" id="sess-create">创建会话</button></div>');
    $all('#runner-cards .runner-card').forEach(function (c) {
      c.addEventListener('click', function () {
        $all('#runner-cards .runner-card').forEach(function (x) { x.classList.remove('sel'); });
        c.classList.add('sel');
        sel = c.dataset.runner;
      });
    });
    $('#sess-create').addEventListener('click', function () {
      var s = {
        id: 'sess-' + agentName + '-' + (Date.now() % 100000), agent: agentName,
        title: sel === 'gotty' ? '新终端会话' : '新会话', runner: sel,
        created: new Date(), pinned: false, archived: false, tokens: 0,
        messages: sel === 'gotty' ? [{ id: 'm-t0', role: 'agent', text: '终端会话已建立（gotty-web）。切到「终端」tab 敲命令：status / tick / help。', ts: new Date(), cards: [] }] : [{ id: 'm-t0', role: 'agent', text: '会话已建立。我的权限面与 owner instance 在右栏；文档修改我只提案进草稿。', ts: new Date(), cards: [] }],
        traj: [{ ts: new Date(), kind: 'agent', label: '会话建立', detail: 'runner: ' + sel + '（token 整包下发）' }]
      };
      M.sessions.unshift(s);
      closeModal();
      var u = S.chatUi[agentName] = S.chatUi[agentName] || {};
      u.sessionId = s.id;
      u.tab = sel === 'gotty' ? 'term' : 'chat';
      go('chat/' + agentName);
      toast('会话已创建', s.id + ' · runner: ' + sel);
    });
  };
  ACTIONS['chat-send'] = function () {
    var ta = $('#chat-input');
    var agent = agentByName(S.params.agent);
    var cur = byId(M.sessions, 'id', S.chatUi[S.params.agent].sessionId);
    if (ta && agent && cur) sendChat(agent, cur, ta.value);
  };
  function sendChat(agent, sess, text) {
    text = (text || '').trim();
    if (!text) return;
    sess.messages.push({ id: 'm-u' + Date.now(), role: 'user', text: text, ts: new Date(), cards: [] });
    sess.traj.push({ ts: new Date(), kind: 'user', label: '用户输入', detail: text.slice(0, 40) });
    var reply = M.personaReply(agent.name, text);
    var msg = { id: 'm-a' + Date.now(), role: 'agent', text: '', ts: new Date(), cards: [], streaming: true, meta: { tokens: 300 + Math.floor(Math.random() * 2200), steps: 1 } };
    sess.messages.push(msg);
    var u = S.chatUi[agent.name];
    u.view = 'chat'; u.tab = 'chat';
    render();
    var full = reply.text;
    var i = 0;
    var t = addInterval(function () {
      i += 2 + Math.floor(Math.random() * 3);
      msg.text = full.slice(0, i);
      var el = $all('#chat-scroll .msg-text');
      var last = el[el.length - 1];
      if (last && S.route === 'chat') {
        last.textContent = msg.text;
        last.insertAdjacentHTML('beforeend', '<span class="typing-caret"></span>');
        var sc = $('#chat-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
      }
      if (i >= full.length) {
        clearInterval(t);
        msg.text = full;
        msg.streaming = false;
        msg.cards = reply.cards;
        msg.meta.steps = 1 + Math.floor(Math.random() * 8);
        sess.tokens += msg.meta.tokens;
        sess.traj.push({ ts: new Date(), kind: 'agent', label: '回复（' + msg.meta.steps + ' 步 · ' + msg.meta.tokens + ' tok）', detail: full.slice(0, 40) });
        reply.cards.forEach(function (c) {
          if (c.type === 'op') sess.traj.push({ ts: new Date(), kind: 'tool', label: c.op + (c.target ? ' → ' + c.target : ''), detail: typeof c.payload === 'object' ? JSON.stringify(c.payload).slice(0, 60) : '' });
          if (c.type === 'proposal') sess.traj.push({ ts: new Date(), kind: 'doc', label: '草稿提案 ' + c.doc, detail: c.title + '（未 Apply）' });
          if (c.type === 'files') sess.traj.push({ ts: new Date(), kind: 'files', label: 'changed-files ×' + c.files.length, detail: c.files.map(function (f) { return f.path.split('/').pop(); }).join(', ') });
        });
        if (S.route === 'chat') render();
      }
    }, 14);
  }
  /* --- 仿 gotty 终端 --- */
  function initTerminal(sess) {
    var box = $('#term-box');
    if (!box) return;
    var T = S.term[sess.id] = S.term[sess.id] || { lines: [], started: false };
    if (!T.started) {
      T.started = true;
      T.lines.push({ html: '<span class="t-dim">gotty-web · tty-0 · core-dsh（plugin: console，mock shell）</span>' });
      T.lines.push({ html: '<span class="t-dim">输入 status / tick / help，或任意命令（echo 语义）。Esc 不影响终端。</span>' });
      // 自动演示：status → tick → help
      var script = M.termScript;
      var k = 0;
      function playNext() {
        if (k >= script.length || S.route !== 'chat') return;
        var step = script[k++];
        T.lines.push({ html: '<span class="t-cmd">user@core:~$</span> ' + esc(step.cmd) });
        step.out.forEach(function (o) { T.lines.push({ text: o }); });
        paintTerm(box, T);
        addTimer(playNext, 900);
      }
      paintTerm(box, T);
      addTimer(playNext, 700);
    } else paintTerm(box, T);
    // 输入行
    var input = document.createElement('div');
    input.innerHTML = '<span class="t-cmd">user@core:~$</span> <span id="term-echo"></span><span class="caret"></span>';
    input.style.marginTop = '6px';
    box.appendChild(input);
    var echo = $('#term-echo');
    var handler = function (e) {
      if (e.key === 'Enter') {
        var cmd = echo.textContent;
        echo.textContent = '';
        runTermCmd(box, T, cmd);
      } else if (e.key === 'Backspace') {
        echo.textContent = echo.textContent.slice(0, -1);
      } else if (e.key.length === 1) {
        echo.textContent += e.key;
      }
    };
    box.tabIndex = 0;
    box.addEventListener('keydown', handler);
    box.addEventListener('click', function () { box.focus(); });
    addTimer(function () { box.focus(); }, 100);
  }
  function paintTerm(box, T) {
    // 保留输入行（最后一个子元素）
    var inputRow = box.lastElementChild;
    box.innerHTML = T.lines.map(function (l) {
      return '<div class="t-line">' + (l.html || esc(l.text)) + '</div>';
    }).join('');
    if (inputRow) box.appendChild(inputRow);
    box.scrollTop = box.scrollHeight;
  }
  function runTermCmd(box, T, cmd) {
    T.lines.push({ html: '<span class="t-cmd">user@core:~$</span> ' + esc(cmd) });
    var c = cmd.trim();
    var found = null;
    M.termScript.forEach(function (s) { if (s.cmd === c) found = s; });
    if (c === 'clear') { T.lines = []; }
    else if (c === '') {}
    else if (found) { found.out.forEach(function (o) { T.lines.push({ text: o }); }); }
    else if (c.indexOf('doc ') === 0) {
      var d = docByName(c.slice(4).trim());
      T.lines.push(d ? { text: d.name + '  kind=' + d.kind + '  scope=' + d.scope + '  r' + d.revision + '  ' + (docHasDraft(d.name) ? 'DRAFT-PENDING' : 'clean') } : { text: 'doc not found: ' + c.slice(4) });
    } else if (c.indexOf('ls') === 0) {
      var scope = c.slice(2).trim() || 'systems';
      var hits = scope === 'systems' ? M.systems.map(function (s) { return s.name + '/'; }) : M.docs.filter(function (d) { return d.scope.indexOf(scope) >= 0; }).slice(0, 8).map(function (d) { return d.name; });
      T.lines.push({ text: hits.join('  ') || 'no match' });
    } else {
      T.lines.push({ text: 'mock-sh: ' + c.split(' ')[0] + ': command found（echo 语义，试 status / tick / help / ls / doc <name>）' });
    }
    paintTerm(box, T);
  }
  /* ================= 屏 8：连接 ================= */
  function screenConnectors(view) {
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '连接' }]);
    function cards(items, routeFn) {
      return items.map(function (x) {
        return '<div class="conncard" data-act="go" data-go="' + routeFn(x) + '">' +
          '<div class="cc-top">' + statusChip(x.status) + '<span class="cc-name">' + esc(x.name) + '</span></div>' +
          '<div class="cc-desc">' + esc(x.desc || '') + '</div>' +
          '<div class="mono faint small">' + esc(x.endpoint || (x.workService ? '挂载: ' + x.workService : x.ops ? 'ops: ' + x.ops.join(' / ') : '')) + '</div></div>';
      }).join('');
    }
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>连接</h1><span class="chip kind">WorkService · ConnectorOps · Provider</span></div>' +
      '<div class="dh-sub">连接系统把外部世界包装成可调用的面；跨 Agent 通信走 agent-comm（dispatch / query / interrupt / inbox）。</div></div></div>' +
      '<div class="conn-group"><div class="sec-title">WorkServices</div><div class="conncards">' + cards(M.workservices, function (x) { return 'ws/' + x.name; }) + '</div></div>' +
      '<div class="conn-group"><div class="sec-title">ConnectorOps 挂载</div><div class="conncards">' + cards(M.connectorops, function (x) { return 'connector/' + x.name; }) + '</div></div>' +
      '<div class="conn-group"><div class="sec-title">Providers</div><div class="conncards">' + cards(M.providers, function (x) { return 'provider/' + x.name; }) + '</div></div>' +
      '</div>';
  }
  function screenConnector(view) {
    var cop = byId(M.connectorops, 'name', S.params.name);
    if (!cop) { view.innerHTML = emptyBox('ConnectorOps 不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '连接', go: 'connectors' }, { label: cop.name }]);
    var head = '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(cop.name) + '</h1>' + statusChip(cop.status) + '<span class="chip kind">ConnectorOps</span></div>' +
      '<div class="dh-sub">' + esc(cop.desc) + (cop.workService ? ' · 挂在 <span class="lk mono" data-act="go" data-go="ws/' + esc(cop.workService) + '">' + esc(cop.workService) + '</span>' : '') + '</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="reconcile" data-sys="connector"><svg class="ic"><use href="#cc-i-refresh"/></svg>触发对账</button></div></div>';
    var opCards = '<div class="conn-group"><div class="sec-title">op 面（' + cop.ops.length + ' 个原语）</div><div class="op-cards">' +
      cop.ops.map(function (op) {
        var descMap = { dispatch: '委派任务（token 整包下发，子 ⊆ 父）', query: '询问/回报（一问一答）', interrupt: '打断/Escalate 通道', inbox: '收件面（未读按 session 归组）', build: '触发构建（branch/job）', 'poll-log': '拉取构建日志尾部', 'trigger-job': '触发指定 job', 'watch-queue': '注册队列 watch', 'open-terminal': '建立 tty 会话', exec: '终端执行命令', put: '产物入库（带 digest）', get: '按 digest 回源', 'verify-digest': 'sha256 校验' };
        return '<div class="op-card"><div class="oc-name">' + esc(cop.name) + '.' + esc(op) + '</div><div class="oc-desc">' + esc(descMap[op] || 'op 原语') + '</div></div>';
      }).join('') + '</div></div>';
    var extra = '';
    if (cop.name === 'agent-comm') extra = agentCommPanels();
    else if (cop.name === 'gotty-web') extra = gottyPanels();
    else extra = genericConnPanels(cop);
    view.innerHTML = '<div class="view-inner">' + head + opCards + extra + '</div>';
  }
  function agentCommPanels() {
    // 拓扑小地图
    var nodes = [
      { id: 'root', label: 'builtinRoot', x: 60, y: 90, sub: 'root' },
      { id: 'dev1', label: 'dev-1', x: 300, y: 30, sub: 'dev-pool' },
      { id: 'repair', label: 'ci-repair-agent', x: 300, y: 95, sub: 'ci' },
      { id: 'verify', label: 'ci-verifier', x: 300, y: 160, sub: 'ci' },
      { id: 'dep', label: 'dep-1', x: 300, y: 225, sub: 'prod' },
      { id: 'wf', label: 'workflow/engine', x: 60, y: 190, sub: 'dispatch 源' }
    ];
    var edges = [['root', 'dev1', 'token ⊆'], ['root', 'repair', 'token ⊆'], ['repair', 'verify', '只读'], ['root', 'dep', 'interrupt'], ['wf', 'repair', 'dispatch'], ['wf', 'dep', 'dispatch']];
    var edgeHtml = edges.map(function (e) {
      var a = nodes.filter(function (n) { return n.id === e[0]; })[0], b = nodes.filter(function (n) { return n.id === e[1]; })[0];
      return '<path class="topo-edge" d="M' + (a.x + 110) + ',' + (a.y + 20) + ' C' + ((a.x + b.x) / 2 + 60) + ',' + (a.y + 20) + ',' + ((a.x + b.x) / 2 + 60) + ',' + (b.y + 20) + ',' + (b.x - 6) + ',' + (b.y + 20) + '"/>' +
        '<text x="' + ((a.x + b.x) / 2 + 40) + '" y="' + ((a.y + b.y) / 2 + 16) + '" style="font-size:9.5px">' + esc(e[2]) + '</text>';
    }).join('');
    var topo = '<svg class="topo-svg" width="440" height="275" viewBox="0 0 440 275">' + edgeHtml +
      nodes.map(function (n) {
        return '<g class="topo-node" data-act="' + (n.id === 'wf' ? 'go' : 'go') + '" data-go="' + (n.id === 'wf' ? 'workflows' : 'agent/' + esc(n.label)) + '">' +
          '<rect x="' + n.x + '" y="' + n.y + '" width="116" height="40" rx="7"/><text x="' + (n.x + 10) + '" y="' + (n.y + 17) + '" style="fill:#e6e9ef;font-weight:600">' + esc(n.label) + '</text>' +
          '<text x="' + (n.x + 10) + '" y="' + (n.y + 32) + '">' + esc(n.sub) + '</text></g>';
      }).join('') + '</svg>';
    // 消息日志
    var logRows = M.commLog.map(function (l) {
      var st = l.status === '失败' ? '<span class="chip danger small">失败</span>' : l.status === '已确认' ? '<span class="chip ok small">已确认</span>' : '<span class="chip acc small">已送达</span>';
      return '<tr class="row-click" data-act="go" data-go="session/' + esc(l.session) + '"><td class="mono faint">' + fmtTime(l.ts) + '</td>' +
        '<td class="mono"><span class="lk" data-act="stop">' + esc(l.from) + '</span> → <span class="lk" data-act="stop">' + esc(l.to) + '</span></td>' +
        '<td><span class="chip acc small mono">' + esc(l.op) + '</span></td>' +
        '<td class="small">' + esc(l.payload) + '</td>' +
        '<td><span class="tag">' + esc(l.token) + '</span></td>' + '<td>' + st + '</td>' +
        '<td><span class="lk mono small">' + esc(l.session) + '</span></td></tr>';
    }).join('');
    var envRows = M.envelope.map(function (f) {
      return '<tr><td class="mono" style="color:#7fb0f9">' + esc(f.field) + '</td><td class="mono small">' + esc(f.type) + '</td>' +
        '<td>' + (f.req ? '<span class="chip warn small">必填</span>' : '<span class="chip mute small">可选</span>') + '</td><td class="small muted">' + esc(f.desc) + '</td></tr>';
    }).join('');
    return '<div class="grid" style="grid-template-columns:440px 1fr">' +
      '<div class="card"><div class="card-h"><span class="h-title">拓扑（agent ↔ 子 agent · 连线可点）</span></div><div class="card-b">' + topo +
      '<div class="small faint" style="margin-top:6px">上级委派 = 权限整包下发（token），子 agent 权限 ⊆ 父；打断走 interrupt（Escalate 通道）。</div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">消息日志（' + M.commLog.length + '）</span><span class="h-sub">行点击进所属 session</span></div>' +
      '<div style="max-height:300px;overflow-y:auto"><table class="tbl"><thead><tr><th>时间</th><th>from → to</th><th>op</th><th>payload 摘要</th><th>token scope</th><th>状态</th><th>session</th></tr></thead><tbody>' + logRows + '</tbody></table></div></div></div>' +
      '<div class="card" style="margin-top:14px"><div class="card-h"><span class="h-title">协议 envelope · v0.1 字段表</span></div>' +
      '<table class="env-table"><thead><tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>' + envRows + '</tbody></table></div>';
  }
  function gottyPanels() {
    var yaml = '# systems/connector/mounts/gotty-web.yaml\napiVersion: core/v1\nkind: ConnectorOps\nmetadata:\n  name: gotty-web\n  scope: systems/connector\nspec:\n  workService: onedev\n  terminal:\n    defaultRunner: gotty        # 网页终端（默认）\n    runners:\n      - {name: gotty,      image: gotty:2.0}\n      - {name: opencode,   cmd: "opencode"}\n      - {name: claude-code, cmd: "claude"}\n      - {name: dsh,        cmd: "dsh attach"}\n  heartbeat: 30s\n  remediate: {backoff: 30s*2^n, maxAttempts: 3}';
    var runnerRows = [
      ['gotty（默认）', '纯网页终端，ttys 直连', 'sess-repair-term-1 在用'],
      ['opencode cli', '终端内拉起 opencode', 'dev-1 的 opencode 会话同构'],
      ['claude-code', '终端内拉起 claude', 'sess-core-0 归档会话用过后归档'],
      ['内嵌 dsh', 'attach 到宿主 dsh 会话', '默认对话 runner 的终端形态']
    ];
    return '<div class="grid" style="grid-template-columns:1fr 1fr">' +
      '<div class="card"><div class="card-h"><span class="h-title">支持的 runner（默认 gotty 终端接入）</span></div><table class="tbl"><thead><tr><th>runner</th><th>说明</th><th>示例</th></tr></thead><tbody>' +
      runnerRows.map(function (r) { return '<tr><td class="mono">' + esc(r[0]) + '</td><td class="small muted">' + esc(r[1]) + '</td><td class="small faint">' + esc(r[2]) + '</td></tr>'; }).join('') +
      '</tbody></table><div class="card-b" style="border-top:1px solid var(--border)"><span class="lk small" data-act="open-term" data-agent="ci-repair-agent">体验：打开 ci-repair-agent 的 gotty 终端会话 →</span></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">挂载 yaml 示例（编辑 = Apply）</span></div><div class="card-b"><div class="yaml-block">' + esc(yaml) + '</div>' +
      '<div style="margin-top:8px"><span class="lk small" data-act="go" data-go="doc/connector-impl">相关 ImplDoc：connector-impl（挂载声明）→</span></div></div></div></div>' +
      '<div class="card" style="margin-top:14px"><div class="card-h"><span class="h-title">健康（conn-drift-017 修复中）</span></div><div class="card-b"><div class="kv"><span class="k">当前状态</span><span class="v">' + 'Degraded：gotty-web 心跳 3 次超时，Remediating attempt 1/3（backoff 30s）' + '</span>' +
      '<span class="k">相关 DriftReport</span><span class="v"><span class="lk mono" data-act="go" data-go="doc/conn-drift-017">conn-drift-017 →</span></span></div></div></div>';
  }
  function genericConnPanels(cop) {
    var evs = M.events.filter(function (e) { return e.object.indexOf(cop.name) >= 0 || (e.msg && e.msg.indexOf(cop.name) >= 0); }).slice(0, 8);
    var evHtml = evs.length ? evs.map(function (e) {
      return '<div class="mini-row" data-act="go" data-go="event/' + esc(e.id) + '"><span class="lamp ' + (e.level === 'warn' || e.level === 'error' ? 'warn' : 'acc') + '"></span><div class="mr-main"><div>' + esc(e.msg) + '</div><div class="mr-sub mono">' + esc(e.kind) + '</div></div><span class="faint mono small">' + fmtAgo(e.ts) + '</span></div>';
    }).join('') : '<div class="empty" style="padding:16px"><div class="e-title">近期无相关事件</div></div>';
    var users = Object.keys(M.agents).filter(function (a) { return M.agents[a].perms.connectorops.indexOf(cop.name) >= 0; });
    return '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">挂载方（agent 权限面引用）</span></div><div class="mini-list">' +
      users.map(function (u) { return '<div class="mini-row" data-act="go" data-go="agent/' + esc(u) + '"><svg class="ic"><use href="#cc-i-bot"/></svg><div class="mr-main"><div class="mono">' + esc(u) + '</div><div class="mr-sub">' + esc(M.agents[u].instance) + '</div></div></div>'; }).join('') +
      '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">相关事件</span></div><div class="mini-list">' + evHtml + '</div></div></div>';
  }
  function screenWorkService(view) {
    var ws = byId(M.workservices, 'name', S.params.name);
    if (!ws) { view.innerHTML = emptyBox('WorkService 不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '连接', go: 'connectors' }, { label: ws.name }]);
    var cops = M.connectorops.filter(function (c) { return c.workService === ws.name; });
    var evs = M.events.filter(function (e) { return e.object.indexOf(ws.name) >= 0; }).slice(0, 8);
    var facet = [
      ['端点', ws.endpoint], ['健康', ws.status === 'Ready' ? 'Ready（心跳新鲜）' : 'Degraded（5xx 抖动后恢复中）'],
      ['scope', ws.scope], ['描述', ws.desc]
    ];
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(ws.name) + '</h1>' + statusChip(ws.status) + '<span class="chip kind">WorkService</span></div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(ws.endpoint) + '</span></div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="reconcile" data-sys="connector">触发对账</button></div></div>' +
      '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">六面体信息</span></div><div class="card-b"><div class="kv">' +
      facet.map(function (f) { return '<span class="k">' + f[0] + '</span><span class="v">' + esc(f[1]) + '</span>'; }).join('') + '</div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">被挂载的 ConnectorOps（' + cops.length + '）</span></div><div class="mini-list">' +
      (cops.length ? cops.map(function (c) { return '<div class="mini-row" data-act="go" data-go="connector/' + esc(c.name) + '"><div class="mr-main"><div class="mono">' + esc(c.name) + '</div><div class="mr-sub">ops: ' + esc(c.ops.join(' / ')) + '</div></div>' + statusChip(c.status) + '</div>'; }).join('') : '<div class="empty" style="padding:16px"><div class="e-title">暂无挂载</div></div>') + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">最近事件</span></div><div class="mini-list">' +
      (evs.length ? evs.map(function (e) { return '<div class="mini-row" data-act="go" data-go="event/' + esc(e.id) + '"><span class="lamp ' + (e.level === 'warn' ? 'warn' : 'acc') + '"></span><div class="mr-main"><div>' + esc(e.msg) + '</div></div><span class="faint mono small">' + fmtAgo(e.ts) + '</span></div>'; }).join('') : '<div class="empty" style="padding:16px"><div class="e-title">近期无事件</div></div>') + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">趋势</span></div><div class="card-b" style="text-align:center">' + sparkSVG('ws:' + ws.name, ws.status === 'Ready' ? '#22c55e' : '#f59e0b', 260, 60, 0.5) + '<div class="small faint">24h 健康度</div></div></div>' +
      '</div></div>';
  }
  function screenProvider(view) {
    var p = byId(M.providers, 'name', S.params.name);
    if (!p) { view.innerHTML = emptyBox('Provider 不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '连接', go: 'connectors' }, { label: p.name }]);
    var users = Object.keys(M.agents).filter(function (a) { return M.agents[a].perms.providers.indexOf(p.name) >= 0; });
    var wfs = M.workflows.filter(function (w) { return w.services.llm && w.services.llm.provider === p.name; });
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(p.name) + '</h1>' + statusChip(p.status) + '<span class="chip kind">Provider</span></div>' +
      '<div class="dh-sub">' + esc(p.desc) + '</div></div></div>' +
      '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">账号引用（脱敏）</span></div><div class="card-b"><div class="kv">' +
      '<span class="k">凭据</span><span class="v mono">' + esc(p.name) + '-tok-****-' + M.hex(4, seeded(p.name)) + '（secret 面，不入公开仓）</span>' +
      '<span class="k">scope</span><span class="v mono">' + esc(p.scope) + '</span>' +
      '<span class="k">模型档</span><span class="v mono">' + (p.name === 'llm-main' ? 'flash-tier（R-PUB：选型不入公开仓）' : 'robot account') + '</span></div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">被引用（agent 权限面）</span></div><div class="mini-list">' +
      (users.length ? users.map(function (u) { return '<div class="mini-row" data-act="go" data-go="agent/' + esc(u) + '"><svg class="ic"><use href="#cc-i-bot"/></svg><div class="mr-main"><div class="mono">' + esc(u) + '</div><div class="mr-sub">' + esc(M.agents[u].instance) + '</div></div></div>'; }).join('') : '<div class="empty" style="padding:14px"><div class="e-title">无</div></div>') + '</div></div>' +
      '<div class="card" style="grid-column:1/-1"><div class="card-h"><span class="h-title">使用它的 workflows（llm provider 声明）</span></div><div class="mini-list">' +
      wfs.map(function (w) { return '<div class="mini-row" data-act="go" data-go="wf/' + esc(w.name) + '"><div class="mr-main"><div class="mono">' + esc(w.name) + '</div><div class="mr-sub">model: ' + esc(w.services.llm.model) + '</div></div>' + phaseChip(w.phase) + '</div>'; }).join('') + '</div></div>' +
      '</div></div>';
  }
  function screenRef(view) {
    var r = M.refs.filter(function (x) { return x.name === decodeURIComponent(S.params.name); })[0];
    if (!r) { view.innerHTML = emptyBox('Ref 不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '连接', go: 'connectors' }, { label: r.name }]);
    var backUsers = Object.keys(M.agents).filter(function (a) { return M.agents[a].perms.refs.indexOf(r.name) >= 0; });
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(r.name) + '</h1><span class="chip ok">' + esc(r.status) + '</span><span class="chip kind">Ref</span></div>' +
      '<div class="dh-sub">跨系统引用：' + esc(r.from) + ' → ' + esc(r.to) + '（解析后跳目标系统的树）</div></div></div>' +
      '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">解析目标</span></div><div class="mini-list">' +
      '<div class="mini-row" data-act="go" data-go="s/' + esc(r.to) + '"><svg class="ic"><use href="#cc-i-grid"/></svg><div class="mr-main"><div class="mono">' + esc(r.to) + '</div><div class="mr-sub">目标系统（ServiceDesc）</div></div>' + phaseChip(sysByName(r.to) ? sysByName(r.to).phase : 'Idle') + '</div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">引用者（反向链）</span></div><div class="mini-list">' +
      '<div class="mini-row" data-act="go" data-go="overview"><svg class="ic"><use href="#cc-i-plug"/></svg><div class="mr-main"><div class="mono">' + esc(r.from) + '</div><div class="mr-sub">来自系统/挂载</div></div></div>' +
      backUsers.map(function (u) { return '<div class="mini-row" data-act="go" data-go="agent/' + esc(u) + '"><svg class="ic"><use href="#cc-i-bot"/></svg><div class="mr-main"><div class="mono">' + esc(u) + '</div><div class="mr-sub">agent 权限面引用</div></div></div>'; }).join('') + '</div></div>' +
      '</div></div>';
  }
  function screenRole(view) {
    var role = byId(M.roles, 'name', S.params.name);
    if (!role) { view.innerHTML = emptyBox('Role 不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '连接', go: 'connectors' }, { label: role.name }]);
    var holders = Object.keys(M.agents).filter(function (a) { return M.agents[a].perms.roles.indexOf(role.name) >= 0; });
    var cops = M.connectorops;
    var rows = cops.map(function (c) {
      var v = holders.some(function (h) { return M.agents[h].perms.connectorops.indexOf(c.name) >= 0; }) || role.scope === 'global';
      return '<tr><td class="mono">' + esc(c.name) + '.' + esc(c.ops[0]) + '</td><td>' + (v ? '<span style="color:#4ade80">✓ 允许</span>' : '<span style="color:var(--text-3)">✗ 拒绝</span>') + '</td><td class="small muted">' + esc(c.desc) + '</td></tr>';
    }).join('');
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(role.name) + '</h1><span class="chip kind">Role</span></div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(role.scope) + '</span><span>' + esc(role.desc) + '</span></div></div></div>' +
      '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">权限条目矩阵</span></div><table class="tbl"><thead><tr><th>op</th><th>裁决</th><th>面说明</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">挂载者（agent）</span></div><div class="mini-list">' +
      (holders.length ? holders.map(function (h) { return '<div class="mini-row" data-act="go" data-go="agent/' + esc(h) + '"><svg class="ic"><use href="#cc-i-bot"/></svg><div class="mr-main"><div class="mono">' + esc(h) + '</div><div class="mr-sub">' + esc(M.agents[h].instance) + '</div></div>' + phaseChip(M.agents[h].phase) + '</div>'; }).join('') : '<div class="empty" style="padding:16px"><div class="e-title">未挂载到任何 agent</div></div>') + '</div></div>' +
      '</div></div>';
  }
  /* ================= Agent / Session 详情页 ================= */
  function screenAgent(view) {
    var a = agentByName(S.params.name);
    if (!a) { view.innerHTML = emptyBox('agent 不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '会话', go: 'chat/' + a.name }, { label: a.name + ' 详情' }]);
    var children = Object.keys(M.agents).filter(function (n) { return M.agents[n].parent === a.name; });
    var sess = M.sessions.filter(function (s) { return s.agent === a.name; });
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(a.name) + '</h1>' + phaseChip(a.phase) + '<span class="chip kind">Agent</span></div>' +
      '<div class="dh-sub">' + esc(a.persona) + ' · token: ' + esc(a.scopeSummary) + '</div></div>' +
      '<div class="dh-actions"><button class="btn primary" data-act="go" data-go="chat/' + esc(a.name) + '">对话</button>' +
      '<button class="btn" data-act="open-term" data-agent="' + esc(a.name) + '">终端</button></div></div>' +
      '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">权限面</span></div><div class="card-b">' +
      '<div class="kv"><span class="k">ConnectorOps</span><span class="v">' + a.perms.connectorops.map(function (c) { return '<span class="chip click mute small" data-act="go" data-go="connector/' + esc(c) + '">' + esc(c) + '</span>'; }).join(' ') + '</span>' +
      '<span class="k">Ref</span><span class="v">' + a.perms.refs.map(function (r) { return '<span class="lk mono small" data-act="go" data-go="ref/' + encodeURIComponent(r) + '">' + esc(r) + '</span>'; }).join(' ') + '</span>' +
      '<span class="k">Provider</span><span class="v">' + a.perms.providers.map(function (p) { return '<span class="lk mono small" data-act="go" data-go="provider/' + esc(p) + '">' + esc(p) + '</span>'; }).join(' ') + '</span>' +
      '<span class="k">Role</span><span class="v">' + a.perms.roles.map(function (r) { return '<span class="lk mono small" data-act="go" data-go="role/' + esc(r) + '">' + esc(r) + '</span>'; }).join(' ') + '</span>' +
      '<span class="k">owner</span><span class="v"><span class="lk mono" data-act="go" data-go="s/' + esc(a.instance.split('/')[0]) + '/i/' + esc(a.instance.split('/')[1]) + '">' + esc(a.instance) + '</span></span></div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">父 / 子 agent</span></div><div class="mini-list">' +
      '<div class="mini-row" data-act="go" data-go="' + (a.parent ? 'agent/' + esc(a.parent) : 'overview') + '"><svg class="ic"><use href="#cc-i-bot"/></svg><div class="mr-main"><div class="mono">' + esc(a.parent || '—（root）') + '</div><div class="mr-sub">parent（权限来源）</div></div></div>' +
      (children.length ? children.map(function (c) { return '<div class="mini-row" data-act="go" data-go="agent/' + esc(c) + '"><svg class="ic"><use href="#cc-i-bot"/></svg><div class="mr-main"><div class="mono">' + esc(c) + '</div><div class="mr-sub">' + esc(M.agents[c].instance) + ' · 权限 ⊆ ' + esc(a.name) + '</div></div>' + phaseChip(M.agents[c].phase) + '</div>'; }).join('') : '<div class="mini-row"><span class="faint">无子 agent</span></div>') + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">sessions（' + sess.length + '）</span><span class="h-right lk small" data-act="go" data-go="chat/' + esc(a.name) + '">进对话 →</span></div><div class="mini-list">' +
      sess.map(function (s) {
        return '<div class="mini-row" data-act="go" data-go="session/' + esc(s.id) + '"><div class="mr-main"><div>' + esc(s.title) + (s.pinned ? ' 📌' : '') + (s.archived ? ' <span class="chip mute small">已归档</span>' : '') + '</div><div class="mr-sub mono">' + esc(s.id) + ' · ' + esc(s.runner) + ' · ' + (s.tokens / 1000).toFixed(1) + 'k tok</div></div><span class="faint mono small">' + fmtAgo(s.created) + '</span></div>';
      }).join('') + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">最近任务</span></div><div class="card-b"><div class="kv">' +
      '<span class="k">当前</span><span class="v">' + esc(a.lastTask) + '</span>' +
      '<span class="k">alias</span><span class="v mono">' + esc(a.alias) + '</span>' +
      '<span class="k">实时</span><span class="v"><span class="lamp acc pulse-dot"></span> ' + esc(a.phase) + ' · 心跳正常</span></div></div></div>' +
      '</div></div>';
  }
  function screenSession(view) {
    var s = byId(M.sessions, 'id', S.params.id);
    if (!s) { view.innerHTML = emptyBox('session 不存在', S.params.id); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    var a = agentByName(s.agent);
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '会话', go: 'chat/' + s.agent }, { label: s.id }]);
    var items = (s.traj || []).map(function (t, i) {
      return '<div class="traj-item kind-' + esc(t.kind) + '"><div class="traj-rail"><div class="traj-dot"></div>' + (i < s.traj.length - 1 ? '<div class="traj-line"></div>' : '') + '</div>' +
        '<div><div style="display:flex;gap:8px;align-items:center"><span class="traj-kind">' + esc(t.kind) + '</span><span class="traj-label">' + esc(t.label) + '</span><span class="mono faint small">' + fmtTime(t.ts) + '</span></div>' +
        '<div class="traj-detail">' + esc(t.detail) + '</div></div></div>';
    }).join('');
    var msgCards = [];
    s.messages.forEach(function (m) { (m.cards || []).forEach(function (c) { if (c.type === 'op') msgCards.push(c); }); });
    var toolUses = (s.traj || []).filter(function (t) { return t.kind === 'tool'; }).length;
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(s.title) + '</h1><span class="runner-tag">' + esc(s.runner) + '</span>' + (s.archived ? '<span class="chip mute">已归档</span>' : '') + '</div>' +
      '<div class="dh-sub mono">' + esc(s.id) + ' · agent: <span class="lk" data-act="go" data-go="agent/' + esc(s.agent) + '">' + esc(s.agent) + '</span> · ' + (s.tokens / 1000).toFixed(1) + 'k tok · ' + toolUses + ' 次工具调用</div></div>' +
      '<div class="dh-actions"><button class="btn primary" data-act="chat-sess-go" data-id="' + esc(s.id) + '" data-agent="' + esc(s.agent) + '">切回 Chat 视图 →</button></div></div>' +
      '<div class="statbar" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="stat"><div class="st-num">' + s.messages.length + '</div><div class="st-label">消息数</div></div>' +
      '<div class="stat"><div class="st-num">' + toolUses + '</div><div class="st-label">工具调用（trajectory）</div></div>' +
      '<div class="stat"><div class="st-num">' + (s.tokens / 1000).toFixed(1) + 'k</div><div class="st-label">token 用量</div></div>' +
      '<div class="stat"><div class="st-num">' + msgCards.length + '</div><div class="st-label">ConnectorOps 调用卡</div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">Trajectory（事件时间线 · 与聊天流同源不同呈现）</span></div><div class="card-b">' + (items || '<div class="empty"><div class="e-title">轨迹为空</div></div>') + '</div></div></div>';
  }
  ACTIONS['chat-sess-go'] = function (el) {
    var u = S.chatUi[el.dataset.agent] = S.chatUi[el.dataset.agent] || {};
    u.sessionId = el.dataset.id; u.view = 'chat'; u.tab = 'chat';
    go('chat/' + el.dataset.agent);
  };

  /* ================= 屏 9：事件流（全局） ================= */
  function screenEvents(view) {
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '事件流' }]);
    var f = S.evFilter;
    var kinds = [];
    M.events.forEach(function (e) { if (kinds.indexOf(e.kind) < 0) kinds.push(e.kind); });
    kinds.sort();
    var topKinds = kinds.slice(0, 10);
    var driftN = openDrifts().length;
    var apN = pendingApprovals().length;
    var dead = 0.8;
    var okRate = Math.round(M.workflows.reduce(function (a, w) { return a + w.successRate; }, 0) / M.workflows.length);
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>事件流</h1><span class="chip kind">三泳道混排 · ' + M.events.length + ' 条</span></div>' +
      '<div class="dh-sub">Event / 状态变迁 / 数据事件 · 点任意一条跳相关对象（第二层信息流）</div></div></div>' +
      '<div class="grid" style="grid-template-columns:1fr 300px">' +
      '<div>' +
      '<div class="filter-bar"><svg class="ic" style="color:var(--text-3)"><use href="#cc-i-filter"/></svg>' +
      '<span class="fchip' + (!Object.keys(f.kinds).some(function (k) { return f.kinds[k]; }) ? ' on' : '') + '" data-act="ev-kind" data-k="">全部类型</span>' +
      topKinds.map(function (k) { return '<span class="fchip' + (f.kinds[k] ? ' on' : '') + '" data-act="ev-kind" data-k="' + esc(k) + '">' + esc(k) + '</span>'; }).join('') + '</div>' +
      '<div class="filter-bar">' +
      '<select id="ev-level"><option value="">全部级别</option><option>info</option><option>warn</option><option>error</option><option>fatal</option></select>' +
      '<select id="ev-range">' + M.TIME_RANGES.map(function (r) { return '<option value="' + r.id + '">' + r.label + '</option>'; }).join('') + '</select>' +
      '<select id="ev-sys"><option value="">全部系统</option>' + M.systems.map(function (s) { return '<option>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<input type="search" id="ev-q" placeholder="对象/消息搜索…" style="width:200px">' +
      '<span class="count-note" id="ev-count-note"></span></div>' +
      '<div id="ev-vlist2"></div></div>' +
      '<div style="display:grid;gap:12px;align-self:start">' +
      '<div class="card"><div class="card-h"><span class="h-title">聚合面板</span></div><div class="card-b" style="display:grid;gap:10px">' +
      '<div class="kv"><span class="k">driftOpen</span><span class="v mono" style="color:' + (driftN ? 'var(--warn)' : 'var(--ok)') + '">' + driftN + '</span></div>' +
      '<div class="kv"><span class="k">审批积压</span><span class="v mono" style="color:' + (apN ? 'var(--warn)' : 'var(--ok)') + '">' + apN + '</span></div>' +
      '<div class="kv"><span class="k">死信率</span><span class="v mono">' + dead + '%</span></div>' +
      '<div class="kv"><span class="k">workflow 成功率</span><span class="v mono">' + okRate + '%</span></div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">token 消耗（24h）</span></div><div class="card-b" style="text-align:center">' + sparkSVG('global:tokens', '#a78bfa', 240, 56) + '<div class="small faint mono">日预算 $15 · 当前 $9.4（62%）</div></div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">泳道图例</span></div><div class="card-b small faint">Event 流：ExternalChanged / ApprovalNeeded / DocApplied / Escalated…<br>状态变迁：phase/conditions 跳变（含 reason）<br>数据事件：阈值越线 / 产物入库 / 同步完成</div></div>' +
      '</div></div></div>';
    $('#ev-level').value = f.level; $('#ev-range').value = f.range; $('#ev-q').value = f.q;
    paintGlobalEvents();
    $('#ev-level').addEventListener('change', function () { f.level = this.value; paintGlobalEvents(); });
    $('#ev-range').addEventListener('change', function () { f.range = this.value; paintGlobalEvents(); });
    var deb;
    $('#ev-q').addEventListener('input', function () { var v = this.value; clearTimeout(deb); deb = setTimeout(function () { f.q = v; paintGlobalEvents(); }, 160); });
  }
  function paintGlobalEvents() {
    var f = S.evFilter;
    var range = byId(M.TIME_RANGES, 'id', f.range) || M.TIME_RANGES[2];
    var kinds = Object.keys(f.kinds).filter(function (k) { return f.kinds[k]; });
    var ql = f.q.toLowerCase();
    var items = M.events.filter(function (e) {
      if (kinds.length && kinds.indexOf(e.kind) < 0) return false;
      if (f.level && e.level !== f.level) return false;
      if ((Date.now() - e.ts.getTime()) > range.min * 60000) return false;
      if (ql && (e.object + ' ' + e.msg + ' ' + e.kind + ' ' + e.system).toLowerCase().indexOf(ql) < 0) return false;
      return true;
    });
    var note = $('#ev-count-note');
    if (note) note.textContent = items.length + ' / ' + M.events.length + ' events';
    vlist($('#ev-vlist2'), items, 36, function (e) {
      var dot = e.level === 'fatal' || e.level === 'error' ? 'var(--danger)' : e.level === 'warn' ? 'var(--warn)' : 'var(--accent)';
      var laneC = e.lane === 'phase' ? '#a78bfa' : e.lane === 'data' ? '#22c55e' : '#7fb0f9';
      return '<span class="vc" style="width:8px;height:8px;border-radius:50%;background:' + dot + '"></span>' +
        '<span class="vc mono faint" style="width:52px">' + fmtTime(e.ts) + '</span>' +
        '<span class="vc"><span class="tag" style="color:' + laneC + ';border-color:' + laneC + '44">' + esc(e.lane) + '</span></span>' +
        '<span class="vc mono" style="width:130px;color:' + laneC + '">' + esc(e.kind) + '</span>' +
        '<span class="vc mono faint" style="width:190px;overflow:hidden;text-overflow:ellipsis">' + esc(e.object) + '</span>' +
        '<span class="grow">' + esc(e.msg) + '</span>' +
        '<span class="vc chip mute small">' + esc(e.level) + '</span>';
    });
    $('#ev-vlist2').onclick = function (ev) {
      var row = ev.target.closest('.vrow');
      if (!row) return;
      var idx = Math.floor((row.offsetTop + this.scrollTop) / 36);
      var it = items[idx];
      if (it) go('event/' + it.id);
    };
  }
  ACTIONS['ev-kind'] = function (el) {
    var k = el.dataset.k;
    if (!k) S.evFilter.kinds = {};
    else S.evFilter.kinds[k] = !S.evFilter.kinds[k];
    render();
  };
  /* 事件详情 */
  function screenEvent(view) {
    var e = byId(M.events, 'id', S.params.id);
    if (!e) { view.innerHTML = emptyBox('事件不存在', S.params.id); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '事件流', go: 'events' }, { label: e.id }]);
    var sysInst = null;
    if (e.object.indexOf('ServiceInstance/') === 0) sysInst = e.object.split('/')[1];
    var chain = [
      { label: '系统 ' + e.system, go: 's/' + e.system },
      sysInst ? { label: '实例 ' + sysInst, go: 's/' + e.system + '/i/' + sysInst } : null,
      { label: '该系统事件面', go: 's/' + e.system + '/events' }
    ].filter(Boolean);
    if (e.object.indexOf('workflow/') === 0) chain.unshift({ label: 'workflow ' + e.object.split('/')[1].split('#')[0], go: 'wf/' + e.object.split('/')[1].split('#')[0] });
    if (e.object.indexOf('Goal/') === 0 || e.object.indexOf('ImplDoc/') === 0 || e.object.indexOf('Rule/') === 0) chain.unshift({ label: '文档 ' + e.object.split('/')[1], go: 'doc/' + e.object.split('/')[1] });
    var raw = {
      apiVersion: 'core/v1', kind: 'Event',
      metadata: { name: e.id, scope: e.system, createdAt: e.ts.toISOString() },
      involvedObject: { kind: e.object.split('/')[0], name: e.object.split('/').slice(1).join('/') },
      reason: e.kind, level: e.level, lane: e.lane, message: e.msg,
      reporter: e.kind === 'DocApplied' ? 'apply-gate' : 'ops-db', count: 1, sequence: M.hex(6, seeded(e.id))
    };
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(e.kind) + '</h1>' +
      '<span class="chip ' + (e.level === 'fatal' || e.level === 'error' ? 'danger' : e.level === 'warn' ? 'warn' : 'acc') + '">' + esc(e.level) + '</span><span class="chip kind">' + esc(e.lane) + ' 泳道</span></div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(e.id) + '</span><span class="mono">' + fmtDate(e.ts) + ' ' + fmtTimeS(e.ts) + '</span><span class="mono">' + esc(e.object) + '</span></div>' +
      '<div class="dh-sub" style="margin-top:4px;font-size:13px;color:var(--text)">' + esc(e.msg) + '</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="go" data-go="events">← 事件流</button></div></div>' +
      '<div class="sec-title">相关对象链（全可点）</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
      chain.map(function (c) { return '<span class="chip click acc" data-act="go" data-go="' + esc(c.go) + '">' + esc(c.label) + '</span>'; }).join('') + '</div>' +
      '<div class="card"><div class="card-h"><span class="h-title">事件信封（envelope · JSON）</span></div><div class="card-b"><div class="yaml-block">' + esc(JSON.stringify(raw, null, 2)) + '</div></div></div>' +
      '</div>';
  }
  /* ================= 屏 10：审批 ================= */
  function approvalCard(ap) {
    var pend = ap.status === '待审';
    return '<div class="ap-card' + (pend ? '' : ' resolved') + '">' +
      '<div class="ap-head"><span class="ap-title">' + esc(ap.title) + '</span>' +
      (pend ? '<span class="chip warn">待审</span>' : ap.status === '已批准' ? '<span class="chip ok">已批准</span>' : '<span class="chip danger">已驳回</span>') +
      '<span class="chip ' + (ap.level === 'fatal' ? 'danger' : ap.level === 'high' ? 'warn' : 'mute') + ' small">' + esc(ap.level) + '</span></div>' +
      '<div class="ap-meta"><span>来源：<b class="mono">' + esc(ap.source) + '</b></span><span>scope：<b class="mono">' + esc(ap.scope) + '</b></span>' +
      '<span class="mono faint">' + fmtAgo(ap.ts) + '</span>' +
      (ap.link ? '<span class="lk" data-act="go" data-go="' + esc(ap.link.replace('#/', '')) + '">相关对象 →</span>' : '') + '</div>' +
      '<div class="ap-body">' + renderDiff(ap.diff, 30) + '</div>' +
      (pend ? '<div class="ap-acts"><button class="btn ok" data-act="ap-approve" data-id="' + esc(ap.id) + '">批准（=Apply）</button><button class="btn danger" data-act="ap-reject" data-id="' + esc(ap.id) + '">驳回</button>' +
      '<span class="small faint" style="align-self:center">批准/驳回均走 Apply：落库 + DocApplied/回执事件</span></div>' : '') + '</div>';
  }
  function screenApprovals(view) {
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '审批' }]);
    var pend = pendingApprovals();
    var cards = M.approvals.slice().sort(function (a, b) { return (a.status === '待审' ? 0 : 1) - (b.status === '待审' ? 0 : 1) || b.ts - a.ts; }).map(approvalCard).join('');
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>审批</h1><span class="chip ' + (pend.length ? 'warn' : 'ok') + '">' + pend.length + ' 条待审</span></div>' +
      '<div class="dh-sub">ApprovalNeeded（role 挂载命中）→ console 批准/驳回（=Apply）。LLM 只提案，Apply 必须人点。</div></div>' +
      '<div class="dh-actions"><button class="btn ok" data-act="ap-batch"' + (pend.length ? '' : ' disabled') + '>批量批准（' + pend.length + '）</button></div></div>' +
      cards + '</div>';
  }
  ACTIONS['ap-approve'] = function (el) {
    var ap = byId(M.approvals, 'id', el.dataset.id);
    if (!ap) return;
    confirmModal('批准（= Apply）',
      '<div class="kv"><span class="k">对象</span><span class="v">' + esc(ap.title) + '</span>' +
      '<span class="k">来源</span><span class="v mono">' + esc(ap.source) + '</span>' +
      '<span class="k">效果</span><span class="v">草稿/提案落库 · Revision+1 · 发 DocApplied；prod 门禁将放行（若为发布类）</span></div>',
      '确认批准（Apply）', function () {
        resolveApproval(ap.id, 'ok');
        toast('已批准（Apply 落库）', ap.id + ' · ' + ap.title.slice(0, 30) + '…', 'ok');
        render();
      });
  };
  ACTIONS['ap-reject'] = function (el) {
    var ap = byId(M.approvals, 'id', el.dataset.id);
    if (!ap) return;
    confirmModal('驳回',
      '<div>驳回 <b>' + esc(ap.title) + '</b>？来源 <b class="mono">' + esc(ap.source) + '</b> 将收到回执并按 onFailed/backoff 处理。</div>',
      '确认驳回', function () {
        resolveApproval(ap.id, 'reject');
        toast('已驳回', ap.id + ' 回执已发（ApprovalRejected）', 'warn');
        render();
      }, true);
  };
  ACTIONS['ap-batch'] = function () {
    var pend = pendingApprovals();
    if (!pend.length) return;
    confirmModal('批量批准（' + pend.length + ' 条 = ' + pend.length + ' 次 Apply）',
      '<div>' + pend.map(function (a) { return '<div class="small" style="padding:3px 0">· ' + esc(a.title) + '</div>'; }).join('') +
      '<div class="hr"></div><div class="small faint">逐条落库，各发一条 DocApplied。</div></div>',
      '全部批准（Apply ×' + pend.length + '）', function () {
        pend.forEach(function (a) { resolveApproval(a.id, 'ok'); });
        toast('已批量批准 ' + pend.length + ' 条', '全部 Apply 落库，DocApplied 已发出', 'ok');
        render();
      });
  };
  /* ================= 帮助面板（dsh settings-card） ================= */
  function openHelp() {
    var rows = SHORTCUTS.slice(0, 6).map(function (s) {
      return '<div class="keys-row"><span class="kr-desc">' + esc(s.label) + '</span><span class="kr-keys">' + s.keys.map(kbd).join('') + '</span></div>';
    }).join('');
    openModal('<div class="modal-h"><span class="m-title">关于本原型</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b"><div class="settings-cards">' +
      '<div class="set-card"><div class="set-card-h">说明</div><div class="set-card-sub">本页为前端交互原型（mock 数据）</div>' +
      '<div class="set-row"><span class="sr-label">设计文档</span><span class="sr-val mono">core_system_instance/runtime/console-ui.md</span></div>' +
      '<div class="set-row"><span class="sr-label">概念对齐</span><span class="sr-val mono">core_design/concepts/apply.md · workflow.md</span></div>' +
      '<div class="set-row"><span class="sr-label">数据</span><span class="sr-val">全部本地 mock（' + M.docs.length + ' docs · ' + M.events.length + ' events · ' + M.transitions.length + ' 流转行），零后端零外链</span></div></div>' +
      '<div class="set-card"><div class="set-card-h">核心语义</div>' +
      '<div class="set-row"><span class="sr-label">Apply</span><span class="sr-val">编辑与发布分离：改动先进草稿，Apply 才落库（Revision+1 · DocApplied 必发）；LLM 只提案，Apply 必须人点</span></div>' +
      '<div class="set-row"><span class="sr-label">一切皆文档</span><span class="sr-val">文档与资源同规则渲染（同 kind 徽章 / revision / 草稿圆点 / 状态灯）</span></div>' +
      '<div class="set-row"><span class="sr-label">跨 Agent 通信</span><span class="sr-val">ConnectorOps · agent-comm：dispatch / query / interrupt / inbox；委派=token 整包下发，子 ⊆ 父</span></div></div>' +
      '<div class="set-card"><div class="set-card-h">快捷键（<span class="lk" data-act="open-cheatsheet">完整速查表</span>）</div><div style="padding:4px 16px 10px">' + rows + '</div></div>' +
      '</div></div>', { cls: '' });
  }
  ACTIONS['open-help'] = function () { openHelp(); };

  /* ================= workflow spec docs 兜底 ================= */
  function ensureWorkflowDocs() {
    M.workflows.forEach(function (w) {
      var dn = w.specDoc || w.name + '-spec';
      if (docByName(dn)) { w.specDoc = dn; return; }
      M.docs.push({
        name: dn, kind: 'Workflow', scope: w.scope, revision: 2, generation: 2, status: 'Active',
        updated: ago2(600), fieldManager: 'builtinRoot', ownerRefs: [w.name], tags: ['spec', 'impl'],
        draft: null, draftSource: null, machineWrite: false,
        history: [{ rev: 2, author: 'builtinRoot', ts: ago2(600), summary: 'builtin spec 固化为本 scope 文档（可 override）' }, { rev: 1, author: 'builtinRoot', ts: ago2(3000), summary: '初版' }],
        content: 'apiVersion: core/v1\nkind: Workflow\nmetadata:\n  name: ' + w.name + '\n  scope: ' + w.scope + (w.builtin ? '   # builtin（可同名 override）' : '') + '\nspec:\n  enabled: ' + w.enabled + '\n  services:\n    involved: [' + w.services.involved.join(', ') + ']\n    mode: ' + w.services.mode + '\n    llm: {provider: ' + w.services.llm.provider + ', model: ' + w.services.llm.model + '}\n  dataflow:\n    inputs:\n      - events: [' + (w.dataflow.inputs[0].events || ['ExternalChanged']).join(', ') + ']\n    outputs:\n      - status: self\n        notify: [bind-role]\n  triggers: ' + w.triggers + '\n  phases: [' + M.FSM.join(', ') + ', ' + M.FSM_ABNORMAL.join(', ') + ']\n  brakes: ' + w.brakes + '\n  regression: ' + w.regression + '\n  onEscalate: ' + w.onEscalate
      });
      w.specDoc = dn;
    });
  }
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

  function boot() {
    ensureWorkflowDocs();
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
      if (['welcome', 'tree', 's', 'wf', 'ws', 'provider', 'connector', 'ref', 'role', 'agent', 'event'].indexOf(S.route) >= 0) render();
    };
    boot();
  }
  function unmountConsole() {
    window.removeEventListener('hashchange', render);
    clearTimers();
    stopFollowTimers();
    if (__CC.conn) { __CC.conn.stop(); __CC.conn = null; }
    if (__CC.live) __CC.live.onChange = null;
    if (ROOT) ROOT.innerHTML = '';
    ROOT = null;
  }
  __CC.mountConsole = mountConsole;
  __CC.unmountConsole = unmountConsole;
})();
