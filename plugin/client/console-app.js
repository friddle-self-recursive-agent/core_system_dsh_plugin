// console-proto app.js（整体内嵌起点代码）手术注记：M←__CC.MOCK；ROOT 容器纪律（$/委托/键盘收进容器）；监听与 boot 移入 mountConsole（可卸载）；连接态灯三色 UI 更新（§1.5）；图标 id 加 cc- 前缀
/* app.js — core console 原型逻辑（普通 script，无模块） */
(function () {
  'use strict';
  var M = __CC.MOCK;
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
  // 历史版本内容（确定性扰动，演示用）
  function revContent(doc, rev) {
    if (rev >= doc.revision) return doc.content;
    var lines = doc.content.split('\n');
    var delta = doc.revision - rev;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/\d+\.\d+/.test(ln)) { lines[i] = ln.replace(/(\d+)\.(\d+)/, function (mm, a, b) { var v = Math.max(0, (parseFloat(mm) - delta * 0.02)).toFixed(2); return v; }); break; }
      if (/revision|rev:/.test(ln)) { lines[i] = ln.replace(/\d+/, String(Math.max(1, parseInt(ln.match(/\d+/)[0], 10) - delta))); break; }
    }
    return lines.join('\n');
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
  function applyPatch(docName, findText, replaceText, summary, source) {
    var st = docState(docName);
    if (st.working.indexOf(findText) < 0) return false;
    st.working = st.working.replace(findText, replaceText);
    st.entries.push({ source: source || 'llm', summary: summary, ts: new Date() });
    return true;
  }
  function addEvent(lane, kind, level, system, object, msg, link) {
    M.events.unshift({ id: 'ev-live-' + Date.now(), lane: lane, kind: kind, level: level, system: system, object: object, msg: msg, ts: new Date(), link: link || null });
  }
  function doApplyDoc(name) {
    var doc = docByName(name), st = docState(name);
    if (!doc || st.working === st.base) return null;
    var newRev = doc.revision + 1;
    var specChange = doc.kind === 'Workflow' || doc.kind === 'Goal' || doc.kind === 'Rule' || doc.kind === 'ImplDoc';
    doc.revision = newRev;
    if (specChange) doc.generation = doc.generation + 1;
    doc.content = st.working;
    doc.draft = null;
    doc.draftSource = null;
    doc.updated = new Date();
    doc.history.unshift({ rev: newRev, author: 'root', ts: new Date(), summary: 'Apply：草稿落库（' + st.entries.length + ' 处变更，fieldManager: root）' });
    addEvent('event', 'DocApplied', 'info', doc.scope.replace('systems/', ''), doc.kind + '/' + doc.name, newRev + ' 落库（fieldManager: root），DocApplied 回执', '#/doc/' + doc.name);
    S.drafts[name] = { working: doc.content, base: doc.content, entries: [] };
    return { rev: newRev, n: st.entries.length };
  }
  function applyWorkflowToggle(wfName) {
    var wf = wfByName(wfName);
    wf.enabled = !wf.enabled;
    wf.phase = wf.enabled ? 'Idle' : 'Idle';
    var specDoc = docByName(wf.specDoc || wfName + '-spec');
    if (specDoc) {
      specDoc.revision += 1;
      specDoc.updated = new Date();
      specDoc.content = specDoc.content.replace(/enabled: (true|false)/, 'enabled: ' + wf.enabled);
      specDoc.history.unshift({ rev: specDoc.revision, author: 'root', ts: new Date(), summary: 'Apply：spec.enabled → ' + wf.enabled });
    }
    addEvent('event', 'DocApplied', 'info', wf.scope.replace('systems/', '') || 'global', 'Workflow/' + wfName, 'spec.enabled → ' + wf.enabled + '（Apply 落库）', '#/wf/' + wfName);
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
  /* ================= 屏 0：Welcome 大屏 ================= */
  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return '夜深了，root';
    if (h < 11) return '早上好，root';
    if (h < 14) return '中午好，root';
    if (h < 19) return '下午好，root';
    return '晚上好，root';
  }
  function devDeliveryStageState() {
    var wf = wfByName('dev-delivery');
    var run = wf.runs[0];
    var tl = run.timeline;
    function find(phase) { for (var i = 0; i < tl.length; i++) if (tl[i].phase === phase) return tl[i]; return null; }
    var cur = tl.filter(function (t) { return t.state === 'current'; })[0];
    var phaseOf = { analyze: 'Analyzing', gate: 'AwaitingApproval', plan: 'Planning', execute: 'Executing', verify: 'Verifying', deploy: 'Executing', report: 'Reporting' };
    var curPhase = cur ? cur.phase : null;
    return wf.stages.map(function (st) {
      var ph = phaseOf[st.id];
      var t = find(ph);
      var state = 'wait';
      if (t && t.state === 'done') state = 'done';
      if (curPhase && ph === curPhase) state = (st.id === 'gate') ? 'wait' : 'current';
      if (st.id === 'gate') { state = find('AwaitingApproval') ? 'wait' : (curPhase && curPhase !== 'AwaitingApproval' && t ? 'done' : 'done'); if (curPhase === 'AwaitingApproval') state = 'wait'; }
      return {
        id: st.id, label: st.label, note: st.note, state: state,
        dur: t && t.dur ? t.dur + 'm' : (state === 'current' ? '进行中' : '—'),
        detail: t ? t.note : st.note
      };
    });
  }
  function screenWelcome(view) {
    var h = healthScore();
    var cls = h.score >= 90 ? 'good' : h.score >= 70 ? 'mid' : 'bad';
    var stages = devDeliveryStageState();
    var wfs = wfByName('dev-delivery');
    setCrumbs([{ label: 'Welcome' }]);
    var cells = M.systems.map(function (s) {
      var lit = s.phase === 'InSync' ? 'lit-ok' : s.phase === 'Drifting' ? 'lit-warn' : s.phase === 'Remediating' ? 'lit-acc' : 'lit-esc';
      return '<div class="w-insync-cell ' + lit + '" data-act="go" data-go="s/' + s.name + '" title="' + esc(s.name + ' · ' + s.phase) + '"><span class="cell-tip">' + esc(s.name) + '</span></div>';
    }).join('');
    var stagesHtml = stages.map(function (st, i) {
      var dot = st.state === 'done' ? '✓' : (i + 1);
      return '<div class="w-stage ' + st.state + '" data-act="go" data-go="wf/dev-delivery" title="跳转 dev-delivery 运行详情">' +
        '<div class="w-stage-dot">' + dot + '</div><div class="ws-name">' + esc(st.label) + '</div>' +
        '<div class="ws-sub">' + esc(st.dur) + '</div><div class="ws-note">' + esc(st.note) + '</div></div>';
    }).join('');
    var svcHtml = M.systems.map(function (s) {
      var dN = openDrifts().filter(function (d) { return d.scope === 'systems/' + s.name; }).length;
      var desc = s.phase === 'Drifting' ? '漂移未解决 ' + dN + ' 条，修复循环进行中'
        : s.phase === 'Remediating' ? 'gotty-web 挂载重建 attempt 1/3'
        : s.phase === 'Escalated' ? 'prod 门禁无人在环，等待 root'
        : '对账正常，observedGeneration 已追平';
      return '<div class="w-svc" data-act="go" data-go="s/' + s.name + '">' +
        '<span class="lamp ' + (PHASE_CLS[s.phase] || 'mute') + ' ' + (PHASE_PULSE[s.phase] || '') + '" style="width:10px;height:10px"></span>' +
        '<div class="ws-main"><div class="ws-title">' + esc(s.name) + '</div><div class="ws-desc">' + esc(desc) + '</div></div>' +
        '<span class="ws-chip">' + phaseChip(s.phase) + '</span></div>';
    }).join('');
    // 重要事件（业务化标题）
    var bizEvents = M.events.filter(function (e) { return e.lane === 'event'; }).slice(0, 60).map(function (e) {
      var lvl = e.level === 'fatal' ? 'critical' : e.level === 'warn' ? 'high' : 'info';
      var title = e.msg;
      if (e.kind === 'Escalated') title = '部署 prod 待审批：' + e.msg;
      else if (e.kind === 'ApprovalNeeded') title = '有审批在等你：' + e.msg;
      else if (e.kind === 'MetricThreshold') title = '指标越线：' + e.msg;
      else if (e.kind === 'DocApplied') title = '文档落库：' + e.msg;
      else if (e.kind === 'ExternalChanged' && e.level === 'warn') title = '外部变化需关注：' + e.msg;
      return { e: e, lvl: lvl, title: title };
    });
    var lvlFilter = S.wImpLevel;
    var shown = bizEvents.filter(function (x) { return lvlFilter === 'all' || x.lvl === lvlFilter; }).slice(0, 10);
    var evHtml = shown.map(function (x) {
      var dotc = x.lvl === 'critical' ? 'var(--danger)' : x.lvl === 'high' ? 'var(--warn)' : 'var(--accent)';
      var lnk = x.e.link || '#/event/' + x.e.id;
      return '<div class="w-ev-item"><span class="w-ev-dot" style="background:' + dotc + '"></span>' +
        '<span class="w-ev-title">' + esc(x.title) + '</span>' +
        '<span class="w-ev-obj"><span class="lk mono small" data-act="go" data-go="' + esc(lnk.replace('#/', '')) + '">' + esc(x.e.object) + '</span></span>' +
        '<span class="w-ev-time mono">' + fmtTime(x.e.ts) + '</span></div>';
    }).join('');
    if (!evHtml) evHtml = '<div class="empty" style="padding:24px"><div class="e-title">该级别暂无事件</div></div>';
    view.innerHTML = '<div class="welcome">' +
      '<div class="w-hello"><h1>' + esc(greeting()) + '</h1><span class="w-date">' + fmtDate(new Date()) + ' · core console proto · 全部为 mock 数据</span></div>' +
      '<div class="w-health-row">' +
        '<div class="w-health ' + cls + '" title="健康度构成：100 − Escalated×' + 4 + '（' + h.esc + '） − 未解决drift×2（' + h.drift + '） − 待审批×1（' + h.pend + '） − 非InSync系统×2（' + (6 - h.insync) + '）' +
          ' = ' + h.score + '">' +
          '<div class="w-health-num">' + h.score + '<span class="unit">/100</span></div>' +
          '<div class="w-health-meta"><b>业务健康度</b><br>构成见 tooltip · 悬停查看</div>' +
        '</div>' +
        '<div class="w-insync">' +
          '<div class="w-insync-num">' + h.insync + '<span class="dim">/6</span> <span class="small muted">系统 InSync</span></div>' +
          '<div class="w-insync-bar">' + cells + '</div>' +
          '<div class="small faint">漂移 ' + h.drift + ' · 待审批 ' + h.pend + ' · Escalated ' + h.esc + '</div>' +
        '</div>' +
        '<div class="w-quick">' +
          '<button class="btn" data-act="manual-tick"><svg class="ic"><use href="#cc-i-refresh"/></svg>手动触发一轮</button>' +
          '<button class="btn" data-act="new-goal"><svg class="ic"><use href="#cc-i-plus"/></svg>新建 Goal</button>' +
          '<button class="btn primary" data-act="go" data-go="chat/builtinRoot"><svg class="ic"><use href="#cc-i-chat"/></svg>与 root 对话</button>' +
        '</div>' +
      '</div>' +
      '<div class="w-stagebar"><div class="sec-title">默认流转 · dev-delivery（最近一轮 #' + wfs.runs[0].no + '，点击阶段进入运行管理）</div>' +
        '<div class="w-stages">' + stagesHtml + '</div></div>' +
      '<div class="sec-title">服务状态（Service 关注行）</div>' +
      '<div class="w-services">' + svcHtml + '</div>' +
      '<div class="sec-title">最近重要事件</div>' +
      '<div class="w-ev-filter">' +
        [['all', '全部'], ['critical', 'critical'], ['high', 'high'], ['info', 'info']].map(function (f) {
          return '<span class="fchip' + (f[0] === 'crit' ? ' crit' : '') + (S.wImpLevel === f[0] ? ' on' : '') + '" data-act="w-ev-level" data-lv="' + f[0] + '">' + f[1] + '</span>';
        }).join('') +
      '</div>' +
      '<div class="card"><div class="card-b" style="padding:6px 16px">' + evHtml + '</div></div>' +
      '</div>';
  }
  ACTIONS['w-ev-level'] = function (el) { S.wImpLevel = el.dataset.lv; render(); };

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

  /* ================= 屏 2：系统树 ================= */
  function treeDocNode(d, depth) {
    return '<div class="tree-node"><div class="tree-row" style="padding-left:' + (12 + depth * 22) + 'px" data-act="go" data-go="doc/' + d.name + '">' +
      '<span class="t-caret"></span><svg class="ic" style="color:#5b6378"><use href="#cc-i-doc"/></svg>' +
      '<span class="t-name">' + esc(d.name) + '</span>' + kindBadge(d.kind) + draftDot(docHasDraft(d.name)) +
      '<span class="t-meta"><span class="t-rev">r' + d.revision + '</span>' + statusChip(d.status === 'Closed' ? 'Idle' : (d.status === 'Open' || d.status === 'Escalated' || d.status === 'Remediating' ? d.status : 'InSync')) + '</span></div></div>';
  }
  function treeSystemChildren(sysName) {
    var sys = sysByName(sysName);
    var kids = '';
    // 文档（与资源完全同构的行）
    var sdocs = sysDocs(sysName);
    kids += '<div class="tree-node"><div class="tree-row" style="padding-left:34px" data-act="tree-toggle" data-key="docs:' + sysName + '">' +
      '<span class="t-caret' + (S.treeOpen['docs:' + sysName] ? ' open' : '') + '">▶</span><svg class="ic" style="color:#5b6378"><use href="#cc-i-folder"/></svg>' +
      '<span class="t-name" style="font-family:var(--sans);font-weight:600">docs</span>' + kindBadge(DOC_GROUP) +
      '<span class="t-meta"><span>' + sdocs.length + ' 对象</span></span></div>';
    if (S.treeOpen['docs:' + sysName]) {
      kids += '<div class="tree-children' + (S.treeLoaded['docs:' + sysName] ? '' : ' skeletonizing') + '" id="tc-docs-' + esc(sysName) + '">' +
        (S.treeLoaded['docs:' + sysName] ? sdocs.map(function (d) { return treeDocNode(d, 2); }).join('') :
          '<div class="skel-row" style="padding-left:56px"><div class="skel" style="width:180px"></div><div class="skel" style="width:60px"></div></div><div class="skel-row" style="padding-left:56px"><div class="skel" style="width:220px"></div><div class="skel" style="width:60px"></div></div><div class="skel-row" style="padding-left:56px"><div class="skel" style="width:150px"></div><div class="skel" style="width:60px"></div></div>') +
        '</div>';
    }
    kids += '</div>';
    // instances
    var insts = sysInstances(sysName);
    kids += '<div class="tree-node"><div class="tree-row" style="padding-left:34px" data-act="tree-toggle" data-key="inst:' + sysName + '">' +
      '<span class="t-caret' + (S.treeOpen['inst:' + sysName] ? ' open' : '') + '">▶</span><svg class="ic" style="color:#5b6378"><use href="#cc-i-db"/></svg>' +
      '<span class="t-name" style="font-family:var(--sans);font-weight:600">instances</span><span class="t-meta"><span>' + insts.length + '</span></span></div>';
    if (S.treeOpen['inst:' + sysName]) {
      kids += '<div class="tree-children">' + insts.map(function (i) {
        var chips = i.agents.map(function (a) { return '<span class="chip click mute" data-act="go" data-go="agent/' + a + '"><svg class="ic"><use href="#cc-i-bot"/></svg>' + esc(a) + '</span>'; }).join('');
        return '<div class="tree-node"><div class="tree-row" style="padding-left:56px" data-act="go" data-go="s/' + sysName + '/i/' + i.name + '">' +
          '<span class="t-caret"></span><span class="t-name">' + esc(i.name) + '</span><span class="chip kind">ServiceInstance</span>' +
          '<span class="t-meta">' + chips + phaseChip(i.phase) + '</span></div></div>';
      }).join('') + '</div>';
    }
    kids += '</div>';
    // workflows
    var wfs = M.workflows.filter(function (w) { return w.scope === 'systems/' + sysName; });
    if (!wfs.length) wfs = M.workflows.filter(function (w) { return w.scope === 'global'; });
    kids += '<div class="tree-node"><div class="tree-row" style="padding-left:34px" data-act="tree-toggle" data-key="wf:' + sysName + '">' +
      '<span class="t-caret' + (S.treeOpen['wf:' + sysName] ? ' open' : '') + '">▶</span><svg class="ic" style="color:#5b6378"><use href="#cc-i-flow"/></svg>' +
      '<span class="t-name" style="font-family:var(--sans);font-weight:600">workflows</span><span class="t-meta"><span>' + wfs.length + '</span></span></div>';
    if (S.treeOpen['wf:' + sysName]) {
      kids += '<div class="tree-children">' + wfs.map(function (w) {
        return '<div class="tree-row" style="padding-left:56px" data-act="go" data-go="wf/' + w.name + '">' +
          '<span class="t-caret"></span><span class="t-name">' + esc(w.name) + '</span>' + (w.builtin ? '<span class="chip mute small">builtin</span>' : '') +
          '<span class="t-meta"><span class="mono">' + w.runsTotal + ' runs</span>' + phaseChip(w.phase) + (w.enabled ? '' : '<span class="chip mute">disabled</span>') + '</span></div>';
      }).join('') + '</div>';
    }
    kids += '</div>';
    // workservices → connectorops / providers / refs
    var wss = M.workservices.filter(function (w) { return w.scope.indexOf(sysName) >= 0; });
    var cops = M.connectorops.filter(function (c) { return sysName === 'connector' || sysName === 'storage-system' || sysName === 'developer-system' && (c.name === 'onedev-ci' || c.name === 'agent-comm'); });
    var provs = M.providers.filter(function (p) { return p.scope.indexOf(sysName) >= 0; });
    var rfs = M.refs.filter(function (r) { return r.to === sysName; });
    var wssAll = wss.length ? wss : (sysName === 'connector' ? M.workservices : []);
    var resKids = wssAll.map(function (w) {
      var copKids = M.connectorops.filter(function (c) { return c.workService === w.name; }).map(function (c) {
        return '<div class="tree-row" style="padding-left:100px" data-act="go" data-go="connector/' + c.name + '">' +
          '<span class="t-caret"></span><span class="t-name">' + esc(c.name) + '</span><span class="chip kind">ConnectorOps</span>' +
          '<span class="t-meta">' + statusChip(c.status) + '</span></div>';
      }).join('');
      return '<div class="tree-node"><div class="tree-row" style="padding-left:56px" data-act="go" data-go="ws/' + w.name + '">' +
        '<span class="t-caret"></span><span class="t-name">' + esc(w.name) + '</span><span class="chip kind">WorkService</span>' +
        '<span class="t-meta">' + statusChip(w.status) + '</span></div>' + copKids + '</div>';
    }).join('');
    resKids += provs.map(function (p) {
      return '<div class="tree-row" style="padding-left:56px" data-act="go" data-go="provider/' + p.name + '">' +
        '<span class="t-caret"></span><span class="t-name">' + esc(p.name) + '</span><span class="chip kind">Provider</span>' +
        '<span class="t-meta">' + statusChip(p.status) + '</span></div>';
    }).join('');
    resKids += rfs.map(function (r) {
      return '<div class="tree-row" style="padding-left:56px" data-act="go" data-go="ref/' + encodeURIComponent(r.name) + '">' +
        '<span class="t-caret"></span><span class="t-name">' + esc(r.name) + '</span><span class="chip kind">Ref</span>' +
        '<span class="t-meta"><span class="chip ok small">' + esc(r.status) + '</span></span></div>';
    }).join('');
    kids += '<div class="tree-node"><div class="tree-row" style="padding-left:34px" data-act="tree-toggle" data-key="res:' + sysName + '">' +
      '<span class="t-caret' + (S.treeOpen['res:' + sysName] ? ' open' : '') + '">▶</span><svg class="ic" style="color:#5b6378"><use href="#cc-i-plug"/></svg>' +
      '<span class="t-name" style="font-family:var(--sans);font-weight:600">workservices</span><span class="t-meta"><span>' + (wssAll.length + provs.length + rfs.length) + '</span></span></div>' +
      (S.treeOpen['res:' + sysName] ? '<div class="tree-children">' + resKids + '</div>' : '') + '</div>';
    return kids;
  }
  var DOC_GROUP = 'docs·同规则';
  function screenTree(view) {
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '系统树' }]);
    var totalDocs = M.docs.length;
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>系统树</h1><span class="chip kind">Global → ServiceDesc → …</span></div>' +
      '<div class="dh-sub">文档节点与资源节点完全同构：同样的行样式 / kind 徽章 / revision / 草稿圆点 / 状态灯。树上出现的任何标识符都可点。<span class="mono faint">' + totalDocs + ' 文档对象 · ' + M.workflows.length + ' workflow · ' + M.instances.length + ' instance</span></div></div></div>' +
      '<div class="tree-toolbar">' +
        '<input type="search" id="tree-q" placeholder="按 kind / 名称 / 状态过滤…" style="flex:1;max-width:360px;background:var(--bg);border:1px solid var(--border-2);border-radius:7px;padding:6px 11px;color:var(--text);outline:none;font-size:12.5px">' +
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
    var ql = (q || '').toLowerCase().trim();
    var systems = M.systems;
    if (ql) systems = systems.filter(function (s) { return (s.name + ' ' + s.phase).toLowerCase().indexOf(ql) >= 0; });
    var html = '<div class="tree-node"><div class="tree-row" style="padding-left:10px" data-act="go" data-go="overview">' +
      '<span class="t-caret"></span><svg class="ic" style="color:#a78bfa"><use href="#cc-i-home"/></svg>' +
      '<span class="t-name">Global</span><span class="tree-root-badge">root scope</span>' +
      '<span class="t-meta"><span class="mono">' + M.docs.filter(function (d) { return d.scope === 'global'; }).length + ' global docs</span>' + phaseChip('InSync') + '</span></div>';
    html += '<div class="tree-children">';
    systems.forEach(function (s) {
      var matchKids = ql && ql.length > 2;
      html += '<div class="tree-node"><div class="tree-row" style="padding-left:30px" data-act="go" data-go="s/' + s.name + '">' +
        '<span class="t-caret' + ((matchKids || S.treeOpen['sys:' + s.name]) ? ' open' : '') + '" data-act="tree-sys-toggle" data-key="sys:' + esc(s.name) + '">▶</span><svg class="ic" style="color:#5b6378"><use href="#cc-i-grid"/></svg>' +
        '<span class="t-name">' + esc(s.name) + '</span><span class="chip kind">ServiceDesc</span>' +
        '<span class="t-meta"><span class="t-rev">gen ' + s.observedGeneration + '/' + s.generation + '</span>' + phaseChip(s.phase) + '</span></div>';
      if (matchKids || S.treeOpen['sys:' + s.name]) html += '<div class="tree-children" data-sys="' + esc(s.name) + '">' + treeSystemChildren(s.name) + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
    box.innerHTML = html;
    var total = systems.length;
    $('#tree-count').textContent = ql ? systems.length + '/' + M.systems.length + ' 系统匹配' : M.systems.length + ' 系统 · 全部子层点击展开（模拟异步 300ms）';
    if (ql) expandMatched(ql);
  }
  function expandMatched(ql) {
    // 搜索时自动展开有匹配子节点的组
    M.systems.forEach(function (s) {
      var docs = sysDocs(s.name).filter(function (d) { return (d.name + ' ' + d.kind).toLowerCase().indexOf(ql) >= 0; });
      var insts = sysInstances(s.name).filter(function (i) { return i.name.toLowerCase().indexOf(ql) >= 0; });
      var wfs = M.workflows.filter(function (w) { return w.name.toLowerCase().indexOf(ql) >= 0; });
      if (docs.length) { S.treeOpen['docs:' + s.name] = true; S.treeLoaded['docs:' + s.name] = true; }
      if (insts.length || wfs.length || docs.length) { S.treeOpen['inst:' + s.name] = true; S.treeOpen['wf:' + s.name] = true; }
    });
  }
  ACTIONS['tree-sys-toggle'] = function (el) {
    var key = el.dataset.key;               // sys:<name>
    var sys = key.slice(4);
    S.treeOpen[key] = !S.treeOpen[key];
    if (S.treeOpen[key]) {
      // 展开系统子层：docs 组自动打开并模拟异步 300ms 加载（skeleton）
      if (!S.treeOpen['docs:' + sys]) S.treeOpen['docs:' + sys] = true;
      if (!S.treeLoaded['docs:' + sys]) {
        S.treeLoaded['docs:' + sys] = false;
        render();
        setTimeout(function () {
          if (S.route !== 'tree') return;
          S.treeLoaded['docs:' + sys] = true;
          render();
        }, 300);
        return;
      }
    }
    render();
  };
  ACTIONS['tree-toggle'] = function (el) {
    var key = el.dataset.key;
    if (S.treeOpen[key]) { S.treeOpen[key] = false; render(); return; }
    S.treeOpen[key] = true;
    S.treeLoaded[key] = false;
    render();
    // 模拟异步 300ms 加载
    setTimeout(function () {
      if (!parseHash().length || S.route !== 'tree') return;
      S.treeLoaded[key] = true;
      if (S.route === 'tree') render();
    }, 300);
  };
  ACTIONS['tree-expand'] = function () {
    M.systems.forEach(function (s) {
      ['sys:', 'docs:', 'inst:', 'wf:', 'res:'].forEach(function (p) { S.treeOpen[p + s.name] = true; });
      S.treeLoaded['docs:' + s.name] = true;
    });
    render();
  };
  ACTIONS['tree-collapse'] = function () { S.treeOpen = {}; render(); };
  /* ================= 屏 3：系统详情 ================= */
  var SYS_TABS = [
    { id: 'docs', label: '文档' }, { id: 'res', label: '资源' }, { id: 'status', label: '状态' },
    { id: 'agents', label: 'Agent' }, { id: 'cross', label: '跨系统申请' }, { id: 'events', label: '事件' }
  ];
  function sysHeaderActions(sys) {
    return '<div class="dh-actions">' +
      '<button class="btn primary" data-act="go" data-go="chat/' + esc(sys.agent) + '"><svg class="ic"><use href="#cc-i-chat"/></svg>与该系统 Agent 对话</button>' +
      '<button class="btn" data-act="edit-desc" data-sys="' + esc(sys.name) + '">编辑声明</button>' +
      '<button class="btn" data-act="reconcile" data-sys="' + esc(sys.name) + '"><svg class="ic"><use href="#cc-i-refresh"/></svg>触发对账</button>' +
      '</div>';
  }
  ACTIONS['reconcile'] = function (el) { toast('已入队', esc(el.dataset.sys) + ' 对账请求已提交（reason: manual:console）', 'ok'); };
  ACTIONS['edit-desc'] = function (el) {
    var sd = M.docs.filter(function (d) { return d.kind === 'ServiceDesc' && d.scope === 'systems/' + el.dataset.sys; })[0];
    if (sd) go('doc/' + sd.name);
    else toast('未找到 ServiceDesc', el.dataset.sys, 'warn');
  };
  function sysCrumb(sys, extra) {
    var c = [{ label: 'Welcome', go: 'welcome' }, { label: sys.name, go: 's/' + sys.name }];
    return extra ? c.concat(extra) : c;
  }
  function screenSystem(view) {
    var sys = sysByName(S.params.name);
    if (!sys) { view.innerHTML = emptyBox('系统不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '404' }]); return; }
    var tab = S.sysTab[sys.name] || 'docs';
    setCrumbs(sysCrumb(sys, tab === 'docs' ? null : [{ label: SYS_TABS.filter(function (t) { return t.id === tab; })[0].label }]));
    var drifts = openDrifts().filter(function (d) { return d.scope === 'systems/' + sys.name; });
    var head = '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(sys.name) + '</h1>' + phaseChip(sys.phase) +
      '<span class="chip kind">ServiceDesc</span>' + draftDot(sysDocs(sys.name).some(function (d) { return docHasDraft(d.name); })) + '</div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(sys.scope) + '</span><span class="mono">gen ' + sys.observedGeneration + '/' + sys.generation + '</span>' +
      '<span>' + esc(sys.desc) + '</span></div>' +
      '<div class="dh-sub" style="margin-top:8px">场景面：<span class="chip click acc" data-act="go" data-go="s/' + esc(sys.name) + '/docs">文档面（tag 过滤）</span>' +
      '<span class="chip click acc" data-act="go" data-go="s/' + esc(sys.name) + '/metrics">指标面</span>' +
      '<span class="chip click acc" data-act="go" data-go="s/' + esc(sys.name) + '/permissions">权限面</span>' +
      '<span class="chip click acc" data-act="go" data-go="s/' + esc(sys.name) + '/events">事件面</span></div>' +
      '</div>' + sysHeaderActions(sys) + '</div>';
    var tabs = '<div class="tabs">' + SYS_TABS.map(function (t) {
      return '<div class="tab' + (t.id === tab ? ' active' : '') + '" data-act="sys-tab" data-t="' + t.id + '">' + t.label + '</div>';
    }).join('') + '</div>';
    var body = '';
    if (tab === 'docs') body = sysTabDocs(sys);
    else if (tab === 'res') body = sysTabRes(sys);
    else if (tab === 'status') body = sysTabStatus(sys, drifts);
    else if (tab === 'agents') body = sysTabAgents(sys);
    else if (tab === 'cross') body = sysTabCross(sys);
    else if (tab === 'events') body = sysTabEvents(sys);
    view.innerHTML = '<div class="view-inner">' + head + tabs + body + '</div>';
  }
  ACTIONS['sys-tab'] = function (el) { S.sysTab[S.params.name] = el.dataset.t; render(); };
  function docRowsHtml(docs) {
    return docs.map(function (d) {
      return '<tr class="row-click" data-act="go" data-go="doc/' + esc(d.name) + '">' +
        '<td class="mono">' + esc(d.name) + draftDot(docHasDraft(d.name)) + '</td>' +
        '<td>' + kindBadge(d.kind) + '</td>' +
        '<td>' + d.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(' ') + '</td>' +
        '<td class="mono num">r' + d.revision + '</td>' +
        '<td>' + (docHasDraft(d.name) ? '<span class="chip warn small">● 未 Apply</span>' : '<span class="faint">—</span>') + '</td>' +
        '<td>' + statusChip(d.kind === 'DriftReport' ? (d.status === 'Closed' ? 'InSync' : d.status) : 'InSync') + '</td>' +
        '<td class="mono faint">' + fmtAgo(d.updated) + '</td></tr>';
    }).join('');
  }
  function sysTabDocs(sys) {
    var docs = sysDocs(sys.name);
    var th = '<div class="card"><div class="card-h"><span class="h-title">文档（' + docs.length + '）· 该 scope 全部对象</span>' +
      '<span class="h-right lk small" data-act="go" data-go="s/' + esc(sys.name) + '/docs">展开完整视图（tag 过滤）→</span>' +
      '<button class="btn sm primary" data-act="new-goal" data-sys="' + esc(sys.name) + '">+ 新建文档</button></div>' +
      '<div style="max-height:520px;overflow-y:auto"><table class="tbl"><thead><tr><th>名称</th><th>kind</th><th>tags</th><th>revision</th><th>草稿</th><th>状态</th><th>更新</th></tr></thead><tbody>' +
      docRowsHtml(docs) + '</tbody></table></div></div>';
    return th;
  }
  function sysTabRes(sys) {
    var insts = sysInstances(sys.name);
    var instCards = insts.map(function (i) {
      return '<div class="syscard" data-act="go" data-go="s/' + esc(sys.name) + '/i/' + esc(i.name) + '">' +
        '<div class="sc-top"><span class="sc-name">' + esc(i.name) + '</span>' + phaseChip(i.phase) + '</div>' +
        '<div class="sc-meta"><span><span class="k">gen:</span> <span class="mono">' + i.observedGeneration + '/' + i.generation + '</span></span>' +
        '<span><span class="k">agents:</span> ' + i.agents.map(function (a) { return '<span class="lk mono" data-act="go" data-go="agent/' + esc(a) + '">' + esc(a) + '</span>'; }).join(' ') + '</span></div>' +
        '<div class="sc-foot"><span class="chip kind">ServiceInstance</span><span class="faint small" style="margin-left:auto">详情 →</span></div></div>';
    }).join('');
    var sysWs = M.workservices.filter(function (w) { return w.scope.indexOf(sys.name) >= 0 || sys.name === 'connector'; });
    var sysCops = M.connectorops.filter(function (c) { return sys.name === 'connector' || sys.name === 'storage-system' || sys.name === 'developer-system' || sys.name === 'deploy-system'; });
    var sysRefs = M.refs.filter(function (r) { return r.to === sys.name || r.from === sys.name; });
    var sysProv = M.providers.filter(function (p) { return p.scope.indexOf(sys.name) >= 0 || p.scope === 'global'; });
    function linkList(items, routeFn) {
      if (!items.length) return '<div class="empty" style="padding:18px"><div class="e-title">无</div></div>';
      return items.map(function (x) {
        return '<div class="mini-row" data-act="go" data-go="' + routeFn(x) + '"><div class="mr-main"><div class="mono" style="font-weight:600">' + esc(x.name) + '</div><div class="mr-sub">' + esc(x.desc || '') + '</div></div>' + statusChip(x.status) + '</div>';
      }).join('');
    }
    return '<div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="card"><div class="card-h"><span class="h-title">ServiceInstance（' + insts.length + '）</span></div><div class="grid" style="grid-template-columns:1fr;gap:10px;padding:12px">' + instCards + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">WorkService</span></div><div class="mini-list">' + linkList(sysWs, function (x) { return 'ws/' + x.name; }) + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">ConnectorOps 挂载</span></div><div class="mini-list">' + linkList(sysCops, function (x) { return 'connector/' + x.name; }) + '</div></div>' +
      '<div class="card"><div class="card-h"><span class="h-title">Ref / Provider</span></div>' +
      '<div class="mini-list">' + sysRefs.map(function (r) { return '<div class="mini-row" data-act="go" data-go="ref/' + encodeURIComponent(r.name) + '"><div class="mr-main"><div class="mono">' + esc(r.name) + '</div><div class="mr-sub">Ref · ' + esc(r.from) + ' → ' + esc(r.to) + '</div></div><span class="chip ok small">' + esc(r.status) + '</span></div>'; }).join('') +
      sysProv.map(function (p) { return '<div class="mini-row" data-act="go" data-go="provider/' + esc(p.name) + '"><div class="mr-main"><div class="mono">' + esc(p.name) + '</div><div class="mr-sub">' + esc(p.desc) + '</div></div>' + statusChip(p.status) + '</div>'; }).join('') +
      '</div></div></div>';
  }
  function sysTabStatus(sys, drifts) {
    var conds = sysInstances(sys.name).map(function (i) {
      return i.conditions.map(function (c) {
        return '<tr><td class="mono">' + esc(i.name) + '</td><td>' + esc(c.type) + '</td><td>' + (c.status === 'True' ? '<span class="chip ok small">True</span>' : '<span class="chip danger small">False</span>') + '</td><td class="small muted">' + esc(c.reason) + '</td><td class="mono faint">' + fmtAgo(c.ts) + '</td></tr>';
      }).join('');
    }).join('');
    var driftRows = drifts.length ? drifts.map(function (d) {
      return '<div class="mini-row" data-act="go" data-go="doc/' + esc(d.name) + '"><div class="mr-main"><div class="mono">' + esc(d.name) + '</div><div class="mr-sub">' + esc((d.content.match(/observed: (.*)/) || ['', ''])[0].replace('observed: ', '')) + '</div></div>' + statusChip(d.status) + '</div>';
    }).join('') : '<div class="empty" style="padding:18px"><svg class="ic"><use href="#cc-i-check"/></svg><div class="e-title">无未解决 drift</div></div>';
    var lastDrift = drifts[0];
    return '<div class="grid cols-2">' +
      '<div class="card"><div class="card-h"><span class="h-title">Conditions</span><span class="h-right lk small" data-act="go" data-go="s/' + esc(sys.name) + '/metrics">指标面（曲线/阈值）→</span></div>' +
      '<div style="max-height:300px;overflow-y:auto"><table class="tbl"><thead><tr><th>instance</th><th>type</th><th>status</th><th>reason</th><th>时间</th></tr></thead><tbody>' + conds + '</tbody></table></div></div>' +
      '<div style="display:grid;gap:14px">' +
      '<div class="card"><div class="card-h"><span class="h-title">Drift 摘要（' + drifts.length + '）</span></div><div class="mini-list">' + driftRows + '</div>' +
      (lastDrift ? '<div class="card-b" style="border-top:1px solid var(--border);padding:10px 14px"><span class="lk small" data-act="go" data-go="doc/' + esc(lastDrift.name) + '">最新 DriftReport：' + esc(lastDrift.name) + ' →</span></div>' : '') + '</div>' +
      '<div class="card"><div class="card-h"><span class="h-title">趋势（mock sparkline · 24h）</span></div><div class="card-b" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center">' +
      '<div>' + sparkSVG(sys.name + ':tick', '#3b82f6', 120, 40) + '<div class="small faint" style="margin-top:4px">tick lag</div></div>' +
      '<div>' + sparkSVG(sys.name + ':drift', '#f59e0b', 120, 40, 0.62) + '<div class="small faint" style="margin-top:4px">drift score</div></div>' +
      '<div>' + sparkSVG(sys.name + ':run', '#22c55e', 120, 40, 0.45) + '<div class="small faint" style="margin-top:4px">run 成功率</div></div>' +
      '</div></div></div></div>';
  }
  function sysTabAgents(sys) {
    var agents = sysAgents(sys.name);
    if (!agents.length) return '<div class="empty"><svg class="ic"><use href="#cc-i-bot"/></svg><div class="e-title">该系统暂无挂载 agent</div></div>';
    var cards = agents.map(function (a) {
      var gottySess = M.sessions.filter(function (s) { return s.agent === a.name && s.runner === 'gotty'; })[0];
      return '<div class="card"><div class="card-h"><svg class="ic" style="color:#7fb0f9"><use href="#cc-i-bot"/></svg><span class="h-title mono">' + esc(a.name) + '</span>' + phaseChip(a.phase) +
        '<span class="h-right"><button class="btn sm primary" data-act="go" data-go="chat/' + esc(a.name) + '">对话</button>' +
        '<button class="btn sm" data-act="open-term" data-agent="' + esc(a.name) + '">终端</button></span></div>' +
        '<div class="card-b" style="display:grid;gap:8px">' +
        '<div class="kv"><span class="k">owner instance</span><span class="v"><span class="lk mono" data-act="go" data-go="s/' + esc(sys.name) + '/i/' + esc(a.instance.split('/')[1]) + '">' + esc(a.instance) + '</span></span></div>' +
        '<div class="kv"><span class="k">当前 session</span><span class="v"><span class="lk mono" data-act="go" data-go="session/' + esc(a.currentSession) + '">' + esc(a.currentSession) + '</span></span></div>' +
        '<div class="kv"><span class="k">最近任务</span><span class="v">' + esc(a.lastTask) + '</span></div>' +
        '<div class="kv"><span class="k">权限面</span><span class="v">' + a.perms.connectorops.map(function (c) { return '<span class="chip mute small">' + esc(c) + '</span>'; }).join(' ') + '</span></div>' +
        '</div></div>';
    }).join('');
    return '<div class="grid" style="grid-template-columns:1fr 1fr">' + cards + '</div>' +
      '<div style="margin-top:10px"><span class="lk small" data-act="go" data-go="s/' + esc(sys.name) + '/permissions">展开完整权限面（role 挂载 / 权限矩阵）→</span></div>';
  }
  ACTIONS['open-term'] = function (el) {
    var a = el.dataset.agent;
    S.chatUi[a] = S.chatUi[a] || {};
    var gs = M.sessions.filter(function (s) { return s.agent === a && s.runner === 'gotty'; })[0];
    if (gs) { S.chatUi[a].sessionId = gs.id; S.chatUi[a].tab = 'term'; }
    else { S.chatUi[a].forceTerm = true; }
    go('chat/' + a);
  };
  function sysTabCross(sys) {
    var rows = M.crossRequests.filter(function (r) { return r.from === sys.name || r.to === sys.name; });
    if (!rows.length) return '<div class="empty"><svg class="ic"><use href="#cc-i-link"/></svg><div class="e-title">无跨系统申请流水</div><div>跨系统影响 = 对方文档 Apply 提案，默认进待审区</div></div>';
    var trs = rows.map(function (r) {
      var st = r.status === '待审' ? '<span class="chip warn small">待审</span>' : r.status === '已合入' ? '<span class="chip ok small">已合入</span>' : '<span class="chip danger small">驳回</span>';
      return '<tr class="row-click" data-act="go" data-go="doc/' + esc(r.doc) + '"><td>' + (r.dir === 'in' ? '<span class="chip acc small">进</span>' : '<span class="chip mute small">出</span>') + '</td>' +
        '<td class="mono">' + esc(r.from) + '</td><td class="mono">' + esc(r.to) + '</td><td>' + esc(r.topic) + '</td><td>' + st + '</td>' +
        '<td class="mono faint">' + fmtAgo(r.ts) + '</td></tr>';
    }).join('');
    return '<div class="card"><div class="card-h"><span class="h-title">跨系统提案（Ref 解析 / A46）</span><span class="h-sub">点行进对应文档编辑器</span></div>' +
      '<table class="tbl"><thead><tr><th>方向</th><th>from</th><th>to</th><th>主题</th><th>状态</th><th>时间</th></tr></thead><tbody>' + trs + '</tbody></table></div>';
  }
  function sysTabEvents(sys) {
    var evs = M.events.filter(function (e) { return e.system === sys.name; }).slice(0, 14);
    var html = evs.map(function (e) {
      var dot = e.level === 'fatal' || e.level === 'error' ? 'danger' : e.level === 'warn' ? 'warn' : 'acc';
      return '<div class="mini-row" data-act="go" data-go="event/' + esc(e.id) + '">' +
        '<span class="lamp ' + dot + '"></span><div class="mr-main"><div>' + esc(e.msg) + '</div><div class="mr-sub mono">' + esc(e.kind) + ' · ' + esc(e.lane) + '泳道 · ' + esc(e.object) + '</div></div>' +
        '<span class="faint mono small">' + fmtAgo(e.ts) + '</span></div>';
    }).join('');
    return '<div class="card"><div class="card-h"><span class="h-title">该 scope 事件时间线</span><span class="h-right lk small" data-act="go" data-go="s/' + esc(sys.name) + '/events">展开完整事件面（过滤/虚拟滚动）→</span></div><div class="mini-list">' + html + '</div></div>';
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
  /* ================= 屏 5：Workflows ================= */
  function screenWorkflows(view) {
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: 'Workflows' }]);
    var rows = M.workflows.map(function (w) {
      var bar = w.successRate >= 95 ? '' : w.successRate >= 85 ? ' mid' : ' low';
      var docsChips = w.involvedDocs.slice(0, 3).map(function (d) {
        return '<span class="chip click mute small" data-act="go" data-go="doc/' + esc(d) + '">' + esc(d) + '</span>';
      }).join(' ');
      return '<tr class="row-click" data-act="go" data-go="wf/' + esc(w.name) + '">' +
        '<td class="mono" style="font-weight:650">' + esc(w.name) + (w.builtin ? ' <span class="chip mute tiny" style="font-size:9px">builtin</span>' : '') + '</td>' +
        '<td><span class="path-mono">' + esc(w.scope) + '</span></td>' +
        '<td><span class="switch' + (w.enabled ? ' on' : '') + '" data-act="wf-toggle" data-wf="' + esc(w.name) + '" title="启用/停用 = Apply"></span></td>' +
        '<td>' + phaseChip(w.phase) + '</td>' +
        '<td class="mono num">' + w.runsTotal + ' <span class="faint">/ ' + w.runs24h + 'h</span></td>' +
        '<td><span class="bar-mini' + bar + '"><i style="width:' + w.successRate + '%"></i></span><span class="mono small">' + w.successRate + '%</span></td>' +
        '<td class="mono faint">' + fmtAgo(w.lastRun) + '</td>' +
        '<td style="max-width:260px">' + docsChips + '</td></tr>';
    }).join('');
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>Workflows</h1><span class="chip kind">' + M.workflows.length + ' 条规则</span></div>' +
      '<div class="dh-sub">Workflow = 触发规则 → 事件整理 → 相位态机 → 文档回归。启停 / 编辑 / 克隆 / 导入 全部 = Apply。</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="wf-import"><svg class="ic"><use href="#cc-i-import"/></svg>导入</button></div></div>' +
      '<div class="card"><table class="tbl"><thead><tr><th>名称</th><th>scope</th><th>启用 (=Apply)</th><th>当前相位</th><th>运行次数 总/24h</th><th>成功率</th><th>最近运行</th><th>涉及文档</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  ACTIONS['wf-toggle'] = function (el, e) {
    e.stopPropagation();
    var wf = wfByName(el.dataset.wf);
    var to = wf.enabled ? '停用' : '启用';
    confirmModal(to + ' workflow（= Apply）',
      '<div class="kv" style="gap:8px"><span class="k">对象</span><span class="v mono">' + esc(wf.name) + '</span>' +
      '<span class="k">变更</span><span class="v mono">spec.enabled: ' + wf.enabled + ' → ' + (!wf.enabled) + '</span>' +
      '<span class="k">语义</span><span class="v">' + (wf.enabled ? '该规则不再触发、不再消耗；已完成轮次与回归记录保留。' : '规则重新生效，触发源重新接线。') + '</span>' +
      '<span class="k">效果</span><span class="v">Revision+1 · 发 DocApplied 事件（编辑与发布分离，此操作即发布）</span></div>',
      '确认 ' + to + '（Apply）', function () {
        applyWorkflowToggle(wf.name);
        toast('已落库（Apply）', wf.name + ' spec.enabled → ' + wf.enabled + ' · DocApplied 已发出', 'ok');
        render();
      });
  };
  ACTIONS['wf-import'] = function () {
    toast('ImportRequested 已发', 'install-service 将做模板发现（asks 在审批页呈现）');
    addEvent('event', 'InstallRequested', 'info', 'connector', 'install-service', 'workflow 导入请求：模板发现中（asks: 2）', '#/connectors');
  };
  var WF_TABS = [
    { id: 'runs', label: '运行' }, { id: 'flow', label: '流程图' }, { id: 'events', label: '事件' },
    { id: 'transitions', label: '流转' }, { id: 'dataflow', label: '数据流' }, { id: 'config', label: '配置' }
  ];
  function screenWorkflow(view) {
    var wf = wfByName(S.params.name);
    if (!wf) { view.innerHTML = emptyBox('workflow 不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    var tab = S.wfTab[wf.name] || 'runs';
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: 'Workflows', go: 'workflows' }, { label: wf.name, go: 'wf/' + wf.name },
      tab === 'runs' ? null : { label: WF_TABS.filter(function (t) { return t.id === tab; })[0].label }].filter(Boolean));
    var avgDur = Math.round(wf.runs.reduce(function (a, r) { return a + (r.durMin || 8); }, 0) / Math.max(1, wf.runs.length));
    var head = '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(wf.name) + '</h1>' + phaseChip(wf.phase) +
      '<span class="chip kind">Workflow</span>' + (wf.builtin ? '<span class="chip mute">builtin · ' + esc(wf.origin) + '</span>' : '<span class="chip mute">system</span>') +
      (wf.enabled ? '' : '<span class="chip warn">已停用</span>') + '</div>' +
      '<div class="dh-sub"><span class="path-mono">' + esc(wf.scope) + '</span><span>' + esc(wf.triggers) + '</span></div></div>' +
      '<div class="dh-actions">' +
      '<button class="btn ' + (wf.enabled ? 'danger' : 'ok') + '" data-act="wf-toggle" data-wf="' + esc(wf.name) + '">' + (wf.enabled ? '停用' : '启用') + '</button>' +
      '<button class="btn" data-act="wf-edit-spec" data-wf="' + esc(wf.name) + '" title="全部 = Apply">编辑 spec</button>' +
      '<button class="btn" data-act="wf-clone" data-wf="' + esc(wf.name) + '" title="克隆 = Apply 落一份新 spec"><svg class="ic"><use href="#cc-i-clone"/></svg>克隆</button>' +
      '<button class="btn" data-act="wf-import" title="导入 = Apply"><svg class="ic"><use href="#cc-i-import"/></svg>导入</button>' +
      '</div></div>';
    var kpi = '<div class="statbar" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="stat"><div class="st-num">' + wf.runsTotal + '</div><div class="st-label">总运行</div></div>' +
      '<div class="stat"><div class="st-num">' + wf.successRate + '%</div><div class="st-label">成功率</div></div>' +
      '<div class="stat"><div class="st-num">~' + avgDur + 'm</div><div class="st-label">平均时长</div></div>' +
      '<div class="stat"><div class="st-num">' + (wf.activeApproval && byId(M.approvals, 'id', wf.activeApproval).status === '待审' ? 1 : 0) + '</div><div class="st-label">活跃审批</div></div></div>';
    var tabs = '<div class="tabs">' + WF_TABS.map(function (t) {
      return '<div class="tab' + (t.id === tab ? ' active' : '') + '" data-act="wf-tab" data-t="' + t.id + '">' + t.label + '</div>';
    }).join('') + '</div>';
    var body = '';
    if (tab === 'runs') body = wfTabRuns(wf);
    else if (tab === 'flow') body = wfTabFlow(wf);
    else if (tab === 'events') body = wfTabEvents(wf);
    else if (tab === 'transitions') body = wfTabTransitions(wf);
    else if (tab === 'dataflow') body = wfTabDataflow(wf);
    else if (tab === 'config') body = wfTabConfig(wf);
    view.innerHTML = '<div class="view-inner">' + head + kpi + tabs + body + '</div>';
    if (tab === 'transitions') paintTransitions(wf);
    if (tab === 'runs') wireFollow(wf);
  }
  ACTIONS['wf-tab'] = function (el) { S.wfTab[S.params.name] = el.dataset.t; render(); };
  ACTIONS['wf-edit-spec'] = function (el) {
    var wf = wfByName(el.dataset.wf);
    go('doc/' + (wf.specDoc || wf.name + '-spec'));
  };
  ACTIONS['wf-clone'] = function (el) {
    var wf = wfByName(el.dataset.wf);
    var cloneName = wf.name + '-clone';
    if (!wfByName(cloneName)) {
      var c = JSON.parse(JSON.stringify(wf));
      c.name = cloneName; c.builtin = false; c.runsTotal = 0; c.runs24h = 0; c.runs = []; c.phase = 'Idle'; c.origin = 'cloned-from:' + wf.name;
      M.workflows.push(c);
    }
    toast('已克隆（=Apply 落库）', cloneName + ' · spec 已写入本系统 workflows/');
    addEvent('event', 'DocApplied', 'info', wf.scope.replace('systems/', '') || 'global', 'Workflow/' + cloneName, '克隆自 ' + wf.name + '（Apply 落库）', '#/wf/' + cloneName);
    go('wf/' + cloneName);
  };
  /* --- 运行 tab：dsh Jobs 面板（任务列表 + 详情面板 + follow） --- */
  function wfTabRuns(wf) {
    var selNo = S.wfRunSel[wf.name] != null ? S.wfRunSel[wf.name] : (wf.runs[0] ? wf.runs[0].no : null);
    var sel = wf.runs.filter(function (r) { return r.no === selNo; })[0] || wf.runs[0];
    var list = wf.runs.map(function (r) {
      var stChip = r.status === 'running' ? phaseChip(r.phase) : r.status === 'waiting' ? '<span class="chip warn"><span class="lamp warn pulse-warn"></span>待审批</span>' : r.status === 'failed' ? '<span class="chip danger">failed</span>' : '<span class="chip ok">ok</span>';
      return '<div class="job-item' + (r.no === sel.no ? ' sel' : '') + '" data-act="wf-run-sel" data-no="' + r.no + '">' +
        '<div class="ji-top"><span class="ji-no">#' + r.no + '</span>' + stChip +
        '<span class="faint mono small" style="margin-left:auto">' + fmtAgo(r.start) + '</span></div>' +
        '<div class="ji-sub"><span>' + esc(r.trigger) + '</span><span>·</span><span>' + (r.durMin ? r.durMin + 'm' : '进行中') + '</span><span>·</span><span>' + r.docsCount + ' docs</span></div></div>';
    }).join('');
    var detail = sel ? jobDetailHtml(wf, sel) : '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">无运行轮次</div><div class="e-act"><button class="btn primary" data-act="wf-rerun" data-wf="' + esc(wf.name) + '">手动触发一轮</button></div></div>';
    return '<div class="jobs-layout"><div class="jobs-list"><div class="card-h"><span class="h-title">运行轮次</span><span class="h-sub">' + wf.runs.length + ' 轮（页面内 follow）</span></div><div class="jl-scroll">' + list + '</div></div>' +
      '<div class="job-detail" id="job-detail">' + detail + '</div></div>';
  }
  ACTIONS['wf-run-sel'] = function (el) { S.wfRunSel[S.params.name] = parseInt(el.dataset.no, 10); render(); };
  function jobDetailHtml(wf, r) {
    var runKey = wf.name + ':' + r.no;
    var docs = wf.involvedDocs;
    var tl = r.timeline.map(function (t, i) {
      var cls = t.state === 'current' ? 'current' : (t.note && t.note.indexOf('backoff') >= 0 ? 'fail' : 'done');
      return '<div class="ptl-item ' + cls + '"><div class="ptl-rail"><div class="ptl-node"></div>' + (i < r.timeline.length - 1 ? '<div class="ptl-line"></div>' : '') + '</div>' +
        '<div class="ptl-main"><div class="ptl-head"><span class="ptl-phase">' + esc(t.phase) + '</span><span class="ptl-ts">' + fmtTime(t.ts) + ' · ' + (t.state === 'current' ? '进行中' : t.dur + 'm') + '</span></div>' +
        '<div class="ptl-note">' + esc(t.note) + '</div></div></div>';
    }).join('');
    var shownActions = r.actions.slice(0, S.logShown && S.logShown[runKey] ? S.logShown[runKey] : 3);
    var moreBtn = r.actions.length > shownActions.length ? '<button class="log-more" data-act="log-more" data-key="' + esc(runKey) + '" data-total="' + r.actions.length + '">加载更早 action（' + (r.actions.length - shownActions.length) + ' 条 · 模拟 follow/page）</button>' : '';
    var logHtml = shownActions.slice().reverse().map(function (a) {
      return '<div class="log-line"><span class="lg-ts">' + fmtTime(a.ts) + '</span><span class="lg-op">' + esc(a.op) + '</span><span class="grow">' + esc(a.detail) + '</span></div>';
    }).join('');
    var followOn = S.follow[runKey] !== false;
    var isLive = r.status === 'running' || r.status === 'waiting';
    var docsChips = docs.map(function (d) { return '<span class="chip click mute small" data-act="go" data-go="doc/' + esc(d) + '">' + esc(d) + '</span>'; }).join(' ');
    return '<div class="jd-head"><span class="jd-title mono">#' + r.no + ' · ' + esc(wf.name) + '</span>' + phaseChip(r.phase) +
      (isLive ? '<span class="follow-tag' + (followOn ? '' : ' off') + '" data-act="follow-toggle" data-key="' + esc(runKey) + '"><span class="lamp ' + (followOn ? 'ok pulse-ok' : 'off') + '" style="width:7px;height:7px"></span>' + (followOn ? '跟随中' : '已暂停跟随（点击恢复）') + '</span>' : '') +
      '<span style="margin-left:auto"></span>' +
      '<span class="lk small" data-act="go" data-go="wf/' + esc(wf.name) + '/r/' + r.no + '">在独立页打开 →</span></div>' +
      '<div class="jd-kvrow">' +
      '<span>kind <b>workflow-round</b></span><span>label <b>#' + r.no + ' ' + esc(wf.name) + '</b></span>' +
      '<span>status <b>' + esc(r.status) + '</b></span><span>trigger <b class="mono">' + esc(r.trigger) + '</b></span>' +
      '<span>startedAt <b class="mono">' + fmtTimeS(r.start) + '</b></span>' +
      '<span>detail <b>' + esc(r.result) + '</b></span></div>' +
      '<div class="jd-body">' +
      '<div><div class="sec-title">相位时间线（FSM）</div><div class="phase-tl">' + tl + '</div></div>' +
      '<div><div class="sec-title">action log（ConnectorOps 调用 · op 等宽）</div><div class="logbox" id="log-' + esc(runKey.replace(/[^a-z0-9]/gi, '')) + '">' + logHtml + moreBtn + '</div></div>' +
      '<div><div class="sec-title">涉及文档（' + docs.length + ' · 点击进编辑器）</div><div style="display:flex;gap:6px;flex-wrap:wrap">' + docsChips + '</div></div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<span class="lk small" data-act="go" data-go="session/' + esc(r.session) + '">SessionLog：' + esc(r.session) + ' →</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn sm" data-act="wf-rerun" data-wf="' + esc(wf.name) + '">重跑</button>' +
      '<button class="btn sm danger" data-act="wf-cancel" data-wf="' + esc(wf.name) + '" data-no="' + r.no + '">取消</button></div>' +
      '</div>';
  }
  ACTIONS['log-more'] = function (el) {
    var key = el.dataset.key, total = parseInt(el.dataset.total, 10);
    S.logShown = S.logShown || {};
    S.logShown[key] = Math.min(total, (S.logShown[key] || 3) + 4);
    render();
  };
  ACTIONS['follow-toggle'] = function (el) {
    var key = el.dataset.key;
    S.follow[key] = S.follow[key] === false ? true : false;
    render();
  };
  function wireFollow(wf) {
    var r = wf.runs[0];
    if (!r) return;
    var runKey = wf.name + ':' + r.no;
    var isLive = r.status === 'running' || r.status === 'waiting';
    if (!isLive || S.follow[runKey] === false) return;
    var extra = ['agent-comm.inbox', 'onedev-ci.poll-log', 'oss-artifacts.verify-digest', 'gitfs.pull'];
    var n = 0;
    var t = addInterval(function () {
      n++;
      var box = $('#job-detail .logbox');
      if (!box) return;
      var op = extra[n % extra.length];
      var line = document.createElement('div');
      line.className = 'log-line';
      line.innerHTML = '<span class="lg-ts">' + fmtTimeS(new Date()) + '</span><span class="lg-op">' + op + '</span><span class="grow">follow 追加 #' + n + '（live tail，间隔 2.5s 模拟）</span>';
      box.insertBefore(line, box.firstChild);
    }, 2500);
    stopFollowTimers();
    S.followTimers = [t];
  }
  ACTIONS['wf-rerun'] = function (el) {
    var wf = wfByName(el.dataset.wf);
    var no = wf.runs[0].no + 1;
    addEvent('event', 'ManualTick', 'info', wf.scope.replace('systems/', '') || 'global', 'workflow/' + wf.name, '手动触发一轮（manual: root）→ 轮次 #' + no + ' 入队', '#/wf/' + wf.name);
    toast('已入队', wf.name + ' #' + no + ' · =Apply 语义（触发设置生效）', 'ok');
  };
  ACTIONS['wf-cancel'] = function (el) {
    var wf = wfByName(el.dataset.wf);
    confirmModal('取消运行轮次（= Apply）',
      '<div>将取消 <b class="mono">' + esc(wf.name) + ' #' + esc(el.dataset.no) + '</b>：相位冻结、现场保留，SessionLog 可续。该操作走 Apply 落库并发出事件。</div>',
      '确认取消（Apply）', function () {
        addEvent('phase', 'PhaseChanged', 'warn', wf.scope.replace('systems/', '') || 'global', 'workflow/' + wf.name + '#' + el.dataset.no, '手动取消（Paused，reason: manual:console）', '#/wf/' + wf.name);
        toast('已取消（Apply 落库）', wf.name + ' #' + el.dataset.no + ' → Paused', 'warn');
        render();
      });
  };
  /* --- 流程图 tab --- */
  function wfTabFlow(wf) {
    var phases = M.FSM;
    var W = 1180, H = 300;
    var cols = 4;
    var pos = {};
    phases.forEach(function (p, i) {
      pos[p] = { x: 60 + (i % cols) * 270, y: 60 + Math.floor(i / cols) * 120 };
    });
    var abn = { Failed: { x: 60 + 3 * 270, y: 60 + 120 }, Paused: { x: 60 + 2 * 270, y: 60 + 120 } };
    var cur = wf.phase;
    function node(p, p2, sub) {
      var c = pos[p] || abn[p];
      var isCur = p === cur;
      var isAbn = p === 'Failed' || p === 'Paused';
      return '<g class="fnode' + (isCur ? ' cur' : '') + (isAbn ? ' abn' : '') + '" data-act="flow-node" data-ph="' + esc(p) + '">' +
        '<rect x="' + c.x + '" y="' + c.y + '" width="200" height="54" rx="8"/>' +
        '<text x="' + (c.x + 14) + '" y="' + (c.y + 23) + '">' + esc(p) + '</text>' +
        '<text class="fsub" x="' + (c.x + 14) + '" y="' + (c.y + 41) + '">' + esc(sub) + '</text></g>';
    }
    var subs = { Idle: '待触发', Analyzing: '读文档 对比现实', Planning: '选 TaskScheme', AwaitingApproval: '高危人批', Executing: 'ConnectorOps 执行', Verifying: '探针复测', Reporting: 'Status 回归归档', Failed: 'backoff 30s*2^n', Paused: '断点保留 等人批 Resume' };
    var edges = [];
    for (var i = 0; i < phases.length - 1; i++) {
      var a = pos[phases[i]], b = pos[phases[i + 1]];
      var ax = a.x + 200, ay = a.y + 27, bx = b.x, by = b.y + 27;
      if (Math.abs(a.y - b.y) < 5) {
        edges.push('<path class="fedge' + (wf.phase === phases[i + 1] ? ' hot' : '') + '" d="M' + ax + ',' + ay + ' L' + (bx - 8) + ',' + by + '"/>');
      } else {
        edges.push('<path class="fedge" d="M' + (a.x + 100) + ',' + (a.y + 54) + ' L' + (a.x + 100) + ',' + (a.y + 90) + ' L' + (b.x + 100) + ',' + (b.y - 36) + ' L' + (b.x + 100) + ',' + (b.y - 6) + '"/>');
      }
    }
    edges.push('<path class="fedge abn" d="M' + (pos.Executing.x + 200) + ',' + (pos.Executing.y + 40) + ' C' + (pos.Executing.x + 240) + ',' + (pos.Executing.y + 120) + ',' + (abn.Failed.x - 40) + ',' + (abn.Failed.y + 60) + ',' + (abn.Failed.x) + ',' + (abn.Failed.y + 27) + '"/>');
    edges.push('<path class="fedge abn" d="M' + (pos.Executing.x + 210) + ',' + (pos.Executing.y + 27) + ' L' + (abn.Paused.x - 8) + ',' + (abn.Paused.y + 27) + '"/>');
    var arrowDef = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2b3646"/></marker></defs>';
    return '<div class="flowwrap"><svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + arrowDef + edges +
      phases.map(function (p) { return node(p, null, subs[p]); }).join('') +
      Object.keys(abn).map(function (p) { return node(p, null, subs[p]); }).join('') +
      '<text x="60" y="270" style="fill:#8b93a7;font-size:11px">当前相位：<tspan fill="#7fb0f9" style="font-weight:700">' + esc(cur) + '</tspan> · 蓝色描边=当前 · 红色虚线=异常路径 · 点击节点过滤「流转」</text></svg></div>' +
      '<div id="flow-note" class="small faint" style="margin-top:8px">onEscalate: ' + esc(wf.onEscalate) + ' · onFailed: escalate to root + notify bind-role</div>';
  }
  ACTIONS['flow-node'] = function (el) {
    S.trFilter.phase = el.dataset.ph;
    S.wfTab[S.params.name] = 'transitions';
    render();
  };
  /* --- 事件 tab --- */
  function wfTabEvents(wf) {
    var evs = M.events.filter(function (e) { return e.object.indexOf(wf.name) >= 0 || (e.msg && e.msg.indexOf(wf.name) >= 0); }).slice(0, 40);
    var html = evs.length ? evs.map(function (e) {
      var dot = e.level === 'fatal' || e.level === 'error' ? 'danger' : e.level === 'warn' ? 'warn' : 'acc';
      return '<div class="mini-row" data-act="go" data-go="event/' + esc(e.id) + '"><span class="lamp ' + dot + '"></span>' +
        '<div class="mr-main"><div>' + esc(e.msg) + '</div><div class="mr-sub mono">' + esc(e.kind) + ' · ' + esc(e.object) + '</div></div>' +
        '<span class="faint mono small">' + fmtAgo(e.ts) + '</span></div>';
    }).join('') : '<div class="empty"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">该 workflow 暂无事件</div></div>';
    return '<div class="card"><div class="card-h"><span class="h-title">该 workflow 触发与消费的事件流</span></div><div class="mini-list" style="max-height:520px;overflow-y:auto">' + html + '</div></div>';
  }
  /* --- 流转 tab（≥800 行虚拟滚动） --- */
  function wfTabTransitions(wf) {
    var rows = M.transitions.filter(function (t) { return t.wf === wf.name && (!S.trFilter.phase || t.phase === S.trFilter.phase); });
    var phaseOpts = [''].concat(M.FSM, M.FSM_ABNORMAL);
    var head = '<div class="filter-bar"><span class="small muted">相位过滤：</span>' +
      '<select id="tr-phase">' + phaseOpts.map(function (p) { return '<option value="' + p + '"' + (S.trFilter.phase === p ? ' selected' : '') + '>' + (p || '全部相位') + '</option>'; }).join('') + '</select>' +
      '<span class="count-note" id="tr-count">' + rows.length + ' 行（全量 ' + M.transitions.length + ' · 虚拟滚动）</span></div>';
    return head + '<div id="tr-vlist"></div>';
  }
  function paintTransitions(wf) {
    var rows = M.transitions.filter(function (t) { return t.wf === wf.name && (!S.trFilter.phase || t.phase === S.trFilter.phase); });
    var note = $('#tr-count');
    if (note) note.textContent = rows.length + ' 行（全量 ' + M.transitions.length + ' · 虚拟滚动）';
    vlist($('#tr-vlist'), rows, 34, function (t) {
      var dirChip = t.dir === 'in' ? '<span class="chip acc small">→ in</span>' : '<span class="chip mute small">← out</span>';
      var phChip = t.phase === 'Failed' || t.phase === 'Paused' ? '<span class="chip danger small">' + t.phase + '</span>' : '<span class="chip kind">' + esc(t.phase) + '</span>';
      return '<span class="vc mono faint" style="width:110px">' + esc(t.wf) + ' #' + t.run + '</span>' +
        '<span class="vc">' + dirChip + '</span>' + phChip +
        '<span class="grow">' + esc(t.note) + '</span>' +
        '<span class="vc mono faint" style="width:120px">' + esc(t.reason) + '</span>' +
        '<span class="vc mono faint" style="width:60px">' + fmtTime(t.ts) + '</span>';
    });
    $('#tr-vlist').onclick = function (ev) {
      var row = ev.target.closest('.vrow');
      if (!row) return;
      var idx = Math.floor((row.offsetTop + this.scrollTop) / 34);
      var it = rows[idx];
      if (it) { S.wfRunSel[wf.name] = it.run; S.wfTab[wf.name] = 'runs'; render(); }
    };
  }
  /* --- 数据流 tab --- */
  function wfTabDataflow(wf) {
    var df = wf.dataflow;
    function nodeCol(title, items, kind) {
      return '<div><div class="sec-title">' + esc(title) + '</div><div style="display:grid;gap:8px">' +
        items.map(function (x) {
          var label = x.events ? 'events: ' + x.events.join(', ') : x.docs ? 'docs: ' + x.docs : x.status ? 'status: ' + x.status : '';
          var extra = x.notify ? ' notify: ' + x.notify.join(',') : x.artifacts ? ' artifacts: ' + x.artifacts : x.reports ? ' reports: ' + x.reports.join(',') : '';
          var go_ = x.artifacts ? 'ws/oss' : x.docs && x.docs.indexOf('systems/') >= 0 ? 's/' + x.docs.split('/')[1] : x.events ? 'events' : 'overview';
          return '<div class="op-card" style="cursor:pointer" data-act="go" data-go="' + esc(go_) + '"><div class="oc-name mono">' + esc(label) + '</div><div class="oc-desc">' + esc(extra) + '</div></div>';
        }).join('') + '</div></div>';
    }
    return '<div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:14px">' +
      nodeCol('① 输入（触发源）', df.inputs) +
      '<div><div class="sec-title">② 处理（相位态机）</div><div class="op-card"><div class="oc-name">phases</div><div class="oc-desc">' + esc(df.process) + '</div>' +
      '<div class="hr"></div><div class="oc-desc">brakes: ' + esc(wf.brakes) + '</div><div class="oc-desc" style="margin-top:6px">regression: ' + esc(wf.regression) + '</div>' +
      '<div style="margin-top:10px"><span class="lk small" data-act="wf-tab-go" data-t="flow">查看流程图 →</span></div></div></div>' +
      nodeCol('③ 输出（回归/产物）', df.outputs) + '</div>' +
      '<div class="small faint" style="margin-top:10px">节点全部可点：artifacts → oss WorkService；docs → 系统详情；events → 事件流。</div>';
  }
  ACTIONS['wf-tab-go'] = function (el) { S.wfTab[S.params.name] = el.dataset.t; render(); };
  /* --- 配置 tab --- */
  function wfSpecYaml(wf) {
    var doc = docByName(wf.specDoc || wf.name + '-spec');
    if (doc) return doc.content;
    return 'apiVersion: core/v1\nkind: Workflow\nmetadata:\n  name: ' + wf.name + '\n  scope: ' + wf.scope + '\nspec:\n  enabled: ' + wf.enabled + '\n  services:\n    involved: [' + wf.services.involved.join(', ') + ']\n    mode: ' + wf.services.mode + '\n    llm: {provider: ' + wf.services.llm.provider + ', model: ' + wf.services.llm.model + '}\n  triggers: ' + wf.triggers + '\n  brakes: ' + wf.brakes + '\n  regression: ' + wf.regression + '\n  onEscalate: ' + wf.onEscalate;
  }
  function wfTabConfig(wf) {
    var specDoc = docByName(wf.specDoc || wf.name + '-spec');
    return '<div class="card"><div class="card-h"><span class="h-title">spec yaml（只读视图）</span>' +
      '<span class="h-right"><span class="lk small" data-act="wf-edit-spec" data-wf="' + esc(wf.name) + '">编辑' + (specDoc ? '（→ ' + esc(specDoc.name) + ' 编辑器，Apply 落库）' : '') + '</span></span></div>' +
      '<div class="card-b"><div class="yaml-block">' + esc(wfSpecYaml(wf)) + '</div></div></div>';
  }
  /* --- 运行独立页 #/wf/:name/r/:n --- */
  function screenWfRun(view) {
    var wf = wfByName(S.params.name);
    if (!wf) { view.innerHTML = emptyBox('workflow 不存在', S.params.name); return; }
    var r = wf.runs.filter(function (x) { return x.no === parseInt(S.params.n, 10); })[0];
    if (!r) { view.innerHTML = emptyBox('运行轮次不存在', wf.name + ' #' + S.params.n); return; }
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: 'Workflows', go: 'workflows' }, { label: wf.name, go: 'wf/' + wf.name }, { label: '运行 #' + r.no }]);
    view.innerHTML = '<div class="view-inner">' +
      '<div class="dh"><div class="dh-main"><div class="dh-title"><h1>' + esc(wf.name) + ' <span style="color:var(--text-2)">#' + r.no + '</span></h1>' + phaseChip(r.phase) + '</div>' +
      '<div class="dh-sub">' + esc(r.trigger) + ' · 开始 ' + fmtTime(r.start) + ' · ' + esc(r.result) + '</div></div>' +
      '<div class="dh-actions"><button class="btn" data-act="go" data-go="wf/' + esc(wf.name) + '">← 返回运行管理</button>' +
      '<button class="btn" data-act="wf-rerun" data-wf="' + esc(wf.name) + '">重跑</button></div></div>' +
      '<div class="card" id="job-detail">' + jobDetailHtml(wf, r) + '</div></div>';
    wireFollow(wf);
  }
  /* ================= 屏 6：文档编辑器 ================= */
  S.docLLM = {};   // docName -> {msgs:[{role,text,cards,done}], tab:'llm'}
  S.docTab = {};   // docName -> collab tab
  var LLM_CHIPS = [
    { id: 'scheme', label: '检查与 Scheme 一致性' },
    { id: 'goal', label: '按 Goal 修正' },
    { id: 'plain', label: '生成白话描述' },
    { id: 'sum', label: '总结变更' }
  ];
  function llmPatchFor(doc, chipId) {
    var c = doc.content;
    if (chipId === 'scheme') {
      if (/progress: on-track/.test(c)) return { find: 'progress: on-track', replace: 'progress: at-risk   # scheme-check: SLO 0.92 高于当前实测 0.88', summary: '标记 progress 为 at-risk（Scheme SLO 与实测差异）' };
      if (/severity: info/.test(c)) return { find: 'severity: info', replace: 'severity: warn   # scheme-check: drift 报告缺 severity 依据，按 Scheme 默认 warn', summary: '补 severity 字段对齐 Scheme 枚举' };
      var fm = c.match(/(metadata:\n(?:  .*\n)*?  ownerRefs:(?:\n    - .*)*\n)/);
      if (fm) return { find: fm[1], replace: fm[1] + '  annotations:\n    scheme-check: pass   # LLM 复核 ' + new Date().toISOString().slice(0, 10) + '：结构与 core-scheme 一致\n', summary: '写入 scheme-check 注解（元数据面，语义不变）' };
      return { find: c.split('\n')[0], replace: c.split('\n')[0] + '\n# scheme-check ' + new Date().toISOString().slice(0, 10) + ': 结构复核通过（LLM 注记，Apply 后随文档落库）', summary: '追加 scheme 复核注记' };
    }
    if (chipId === 'goal') {
      var m = c.match(/(\w+Rate): '>= (\d+\.\d+)'/);
      if (m) return { find: m[0], replace: m[1] + ": '>= " + (parseFloat(m[2]) + 0.02).toFixed(2) + "'   # goal: 上一轮实测已达标，可安全收紧", summary: '按 Goal 收紧 ' + m[1] + ' 目标' };
      if (/retention: \{nas: 30d/.test(c)) return { find: 'retention: {nas: 30d', replace: 'retention: {nas: 45d   # goal: developer-system 提案（跨系统申请已合入）', summary: '按 Goal 对齐保留期 45d' };
      var m2 = c.match(/(backlog\w*|limit\w*|Max\w*|max\w*): (\d+)/);
      if (m2) return { find: m2[0], replace: m2[1] + ': ' + (parseInt(m2[2], 10) + 2) + '   # goal: 为收敛留出余量', summary: '按 Goal 调整 ' + m2[1] + ' 参数' };
      return { find: c.split('\n')[0], replace: c.split('\n')[0] + '\n# goal-align ' + new Date().toISOString().slice(0, 10) + ': 与归属 Goal 的 northStars 对齐（LLM 注记）', summary: '追加 Goal 对齐注记' };
    }
    return null;
  }
  function llmReplyFor(doc, chipId, userText) {
    var patch = llmPatchFor(doc, chipId);
    if (chipId === 'scheme') return {
      text: '对照 core-scheme 逐项检查了这份 ' + doc.kind + '：\n\n- apiVersion/kind/metadata 结构 ✓ 符合 Scheme 注册表\n- scope 路径 ' + doc.scope + ' ✓ 归属正确\n' + (patch ? '- ⚠ 发现 1 处不一致：' + patch.summary + '\n\n我准备了一条修改提案（见下方卡片），加入草稿后由你 Apply——LLM 只提案，Apply 必须人点。' : '- 语义字段 ✓ 与 Scheme 不变量一致\n\n没有发现需要修改的地方。'),
      patch: patch
    };
    if (chipId === 'goal') return {
      text: '按归属 Goal（' + (doc.scope === 'global' ? 'core-goal' : '该系统 Goal') + '）复核了本文档：\n\n- 意图声明与 Goal 的 northStars 对齐\n' + (patch ? '- 有 1 处可以更接近目标：' + patch.summary + '\n\n提案已生成，[加入草稿] 后在「草稿」tab 统一 Apply。' : '- 当前内容已满足 Goal 约束，无需修正。'),
      patch: patch
    };
    if (chipId === 'plain') {
      var first = (doc.content.match(/intent: \|?\n?([\s\S]{0,120})/) || ['', doc.content.slice(0, 120)])[1];
      return { text: '白话版：这份 ' + doc.kind + ' 说的是——\n\n「' + first.replace(/\n/g, ' ').trim() + '…」\n\n一句话总结：它是 ' + doc.scope + ' scope 下的一份' + ({ Goal: '目标声明', Rule: '行为规则', ImplDoc: '实现声明', VerifyDoc: '验证探针集', DriftReport: '漂移报告', Runbook: '操作手册', Scheme: '对象注册表', Workflow: '循环流程声明', ServiceDesc: '系统描述', Desc: '设计说明' }[doc.kind] || '文档') + '，改它要经 Apply（Revision ' + doc.revision + ' → ' + (doc.revision + 1) + '）。', patch: null };
    }
    // sum
    var st = docState(doc.name);
    var has = st.working !== st.base;
    if (!has) return { text: '当前草稿区没有任何变更（working == base）。所以没有可总结的差异；想改的话直接编辑左侧内容，或让我提案。', patch: null };
    var stats = diffStats(diffLines(st.base, st.working));
    return { text: '草稿区变更摘要：' + stats.add + ' 行新增 / ' + stats.del + ' 行删除，来源 ' + st.entries.map(function (e) { return e.source === 'llm' ? 'LLM 提案' : '手动编辑'; }).join(' + ') + '。\n\n主要改动落在 ' + firstChangedArea(st.base, st.working) + '。确认无误就点底部「Apply」——落库后 Revision ' + doc.revision + ' → ' + (doc.revision + 1) + '，并发出 DocApplied。', patch: null };
  }
  function firstChangedArea(a, b) {
    var la = a.split('\n'), lb = b.split('\n');
    for (var i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) {
      var ln = (la[i] || lb[i] || '');
      var key = ln.match(/^(\s*)([\w-]+):/) || ['', '', ln.slice(0, 24)];
      return (key[2] || '正文') + ' 附近';
    }
    return '正文';
  }
  function screenDoc(view) {
    var doc = docByName(S.params.name);
    if (!doc) { view.innerHTML = emptyBox('文档不存在', S.params.name); setCrumbs([{ label: 'Welcome', go: 'welcome' }]); return; }
    var st = docState(doc.name);
    var tab = S.docTab[doc.name] || 'llm';
    var has = st.working !== st.base;
    setCrumbs([{ label: 'Welcome', go: 'welcome' }, { label: '文档', go: 'docs' }, { label: doc.scope === 'global' ? 'global' : doc.scope.replace('systems/', ''), go: doc.scope === 'global' ? 'overview' : 's/' + doc.scope.replace('systems/', '') }, { label: doc.name }]);
    var sysName = doc.scope.replace('systems/', '');
    var scopeLink = doc.scope === 'global' ? '<span class="chip click mute" data-act="go" data-go="overview">global</span>' : '<span class="chip click mute" data-act="go" data-go="s/' + esc(sysName) + '">' + esc(doc.scope) + '</span>';
    var head = '<div class="doc-headbar"><span class="doc-path">' + esc(doc.scope) + '/' + esc(doc.name) + '</span>' + kindBadge(doc.kind) +
      (doc.machineWrite ? '<span class="chip mute small">机器直写 · 不经 Apply</span>' : '') + '</div>' +
      '<div class="doc-meta-row"><span class="chip mute small">scope ' + '</span>' + scopeLink +
      '<span class="mono small">Revision r' + doc.revision + ' · generation ' + doc.generation + '</span>' + statusChip('InSync') +
      '<span class="mono faint small">fieldManager: ' + esc(doc.fieldManager) + '</span>' +
      '<span class="mono faint small">更新 ' + fmtAgo(doc.updated) + '</span>' +
      (has ? '<span class="chip warn small" id="doc-draft-flag">● 未 Apply（草稿 ' + st.entries.length + ' 处）</span>' : '<span class="chip ok small" id="doc-draft-flag">无草稿</span>') +
      '</div>';
    var tags = doc.tags.length ? '<div style="margin-top:6px">' + doc.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(' ') + '</div>' : '';
    var collabTabs = [['llm', 'LLM'], ['draft', '草稿'], ['hist', '历史'], ['meta', '元数据']];
    var collab = '<div class="doc-collab"><div class="collab-tabs">' + collabTabs.map(function (t) {
      var badge = t[0] === 'draft' && has ? '<span class="ct-badge">' + st.entries.length + '</span>' : '';
      return '<div class="collab-tab' + (tab === t[0] ? ' active' : '') + '" data-act="doc-tab" data-t="' + t[0] + '">' + t[1] + badge + '</div>';
    }).join('') + '</div><div class="collab-body" id="collab-body">' + collabBody(doc, st, tab) + '</div></div>';
    view.innerHTML = '<div class="view-inner"><div class="doc-layout"><div class="doc-main">' + head + tags +
      '<div class="doc-editor-wrap"><textarea class="doc-editor" id="doc-editor" spellcheck="false">' + esc(st.working) + '</textarea></div>' +
      '<div class="small faint">编辑即累积草稿 diff（与 base r' + doc.revision + ' 对比）；同一 Apply 按钮统一落库。LLM 在右侧面板只提案。</div>' +
      '</div>' + collab + '</div></div>';
    bindDocEditor(doc);
  }
  ACTIONS['doc-tab'] = function (el) { S.docTab[S.params.name] = el.dataset.t; render(); };
  function collabBody(doc, st, tab) {
    if (tab === 'llm') {
      var L = S.docLLM[doc.name] = S.docLLM[doc.name] || { msgs: [] };
      var msgs = L.msgs.map(function (m, i) {
        var cards = m.cards || '';
        return '<div class="llm-msg ' + m.role + '">' + (m.role === 'agent' ? '<svg class="ic" style="color:var(--llm)"><use href="#cc-i-spark"/></svg> ' : '') + esc(m.text) + (m.streaming ? '<span class="typing-caret"></span>' : '') + cards + '</div>';
      }).join('');
      return '<div class="llm-chips">' + LLM_CHIPS.map(function (c) {
        return '<span class="llm-chip" data-act="llm-chip" data-id="' + c.id + '">' + esc(c.label) + '</span>';
      }).join('') + '</div>' +
      '<div class="llm-msgs" id="llm-msgs">' + (msgs || '<div class="small faint" style="padding:6px 2px">与本文档上下文的 LLM 对话：它会读 ' + esc(doc.name) + '（r' + doc.revision + '）与其 Goal/Rule 引用；所有修改只进草稿。</div>') + '</div>' +
      '<div class="llm-input-row"><input id="llm-input" placeholder="问点什么，或让它改…（Enter 发送）"><button class="btn llm sm" data-act="llm-send">发送</button></div>';
    }
    if (tab === 'draft') {
      var has = st.working !== st.base;
      var fullDiff = diffLines(st.base, st.working);
      var stats = diffStats(fullDiff);
      var entries = has && st.entries.length ? st.entries.map(function (e, i) {
        return '<div class="draft-item"><div class="di-head"><span class="di-src ' + e.source + '">' + (e.source === 'llm' ? 'LLM' : '手动') + '</span>' +
          '<span>' + esc(e.summary) + '</span><span class="faint mono small" style="margin-left:auto">' + fmtTime(e.ts) + '</span>' +
          '<span class="lk small" style="margin-left:8px" data-act="draft-drop" data-i="' + i + '">弃用</span></div></div>';
      }).join('') : '<div class="empty" style="padding:26px"><svg class="ic"><use href="#cc-i-empty"/></svg><div class="e-title">草稿区为空</div><div>编辑左侧内容或让 LLM 提案；改动先落草稿，Apply 才落库（Revision+1 · DocApplied）。</div></div>';
      return '<div style="flex:1;overflow-y:auto;min-height:0">' + entries +
        (has ? '<div class="hr"></div><div class="sec-title">完整草稿 diff（base r' + doc.revision + ' → 草稿）<span class="chip ok small" style="margin-left:6px">+' + stats.add + '</span><span class="chip danger small">-' + stats.del + '</span></div>' +
        renderDiff(fullDiff, 60) + '<div class="lk small" style="display:inline-block;margin-top:6px" data-act="draft-full-diff">查看完整 diff →</div>' : '') + '</div>' +
        '<div class="apply-dock"><div class="hint">Apply = 唯一写路径：乐观锁 r' + doc.revision + ' → Revision+1 → DocApplied 必发。空草稿=无操作。</div>' +
        '<button class="btn primary lg block" data-act="doc-apply" ' + (has ? '' : 'disabled') + '>Apply（' + (has ? st.entries.length : 0) + ' 处变更）</button></div>';
    }
    if (tab === 'hist') {
      var rows = doc.history.map(function (h, i) {
        var prevRev = i + 1 < doc.history.length ? doc.history[i + 1].rev : Math.max(1, h.rev - 1);
        return '<div class="rev-item" data-act="hist-open" data-rev="' + h.rev + '" data-prev="' + prevRev + '">' +
          '<span class="rv-no">r' + h.rev + '</span><span class="rv-author">' + esc(h.author) + '</span>' +
          '<span class="rv-sum">' + esc(h.summary) + '<br><span class="mono">' + fmtAgo(h.ts) + '</span></span></div>';
      }).join('');
      return '<div style="flex:1;overflow-y:auto">' + rows + '<div class="small faint" style="margin-top:8px">点任一 revision 看与上一版的 diff（git 历史语义；Status/记录类机器直写不出现在这里）。</div></div>';
    }
    // meta
    var fm = parseFrontmatter(doc.content);
    var kv = Object.keys(fm).map(function (k) {
      var v = fm[k];
      var links = '';
      if (/ownerRefs/i.test(k) && typeof v === 'object') {
        links = '<div style="margin-top:4px">' + v.map(function (o) {
          var dn = String(o).replace(/-desc$/, '-desc');
          return '<span class="lk mono small" data-act="go" data-go="doc/' + esc(o) + '">' + esc(o) + '</span>';
        }).join(' ') + '</div>';
        v = v.join(', ');
      }
      return '<div class="kv" style="margin-bottom:6px"><span class="k mono">' + esc(k) + '</span><span class="v mono">' + esc(typeof v === 'object' ? JSON.stringify(v) : v) + links + '</span></div>';
    }).join('');
    return '<div style="flex:1;overflow-y:auto"><div class="sec-title">frontmatter（键值表）</div>' + (kv || '<div class="faint small">无 frontmatter</div>') +
      '<div class="hr"></div><div class="sec-title">对象规则（与资源同构）</div>' +
      '<div class="kv"><span class="k">kind</span><span class="v mono">' + esc(doc.kind) + '</span></div>' +
      '<div class="kv" style="margin-top:4px"><span class="k">scope</span><span class="v mono">' + esc(doc.scope) + '</span></div>' +
      '<div class="kv" style="margin-top:4px"><span class="k">revision</span><span class="v mono">r' + doc.revision + '（乐观锁）</span></div>' +
      '<div class="kv" style="margin-top:4px"><span class="k">写路径</span><span class="v">' + (doc.machineWrite ? '机器直写（fieldManager 白名单，不经 Apply、不发 DocApplied）' : '草稿 → 人点 Apply → DocApplied') + '</span></div></div>';
  }
  function parseFrontmatter(content) {
    var out = {}, lines = content.split('\n'), curKey = null;
    var started = /^(\w[\w-]*):/.exec(lines[0]) || (/^---/.test(lines[0]) && null);
    var i0 = /^---/.test(lines[0]) ? 1 : 0;
    for (var i = i0; i < Math.min(lines.length, 40); i++) {
      var ln = lines[i];
      if (ln === '' || ln[0] === '#' || /^spec:|intent: \|/.test(ln)) break;
      var top = /^(\w[\w-]*):(?: (.*))?$/.exec(ln);
      if (top && ln[0] !== ' ') {
        curKey = top[1];
        if (top[2] && top[2].charAt(0) !== '-') out[curKey] = top[2].replace(/^["']|["']$/g, '');
        else out[curKey] = [];
        continue;
      }
      var sub = /^\s+- (.+)$/.exec(ln);
      if (sub && curKey) { if (!Array.isArray(out[curKey])) out[curKey] = []; out[curKey].push(sub[1].trim()); continue; }
      var kv2 = /^\s+([\w-]+): (.+)$/.exec(ln);
      if (kv2 && curKey && typeof out[curKey] === 'string') { /* 忽略深层，只展示顶层 */ }
    }
    return out;
  }
  function bindDocEditor(doc) {
    var ta = $('#doc-editor');
    if (!ta) return;
    var deb = null;
    ta.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () {
        var st = docState(doc.name);
        st.working = ta.value;
        var has = st.working !== st.base;
        // 更新手动条目
        if (has) {
          var manual = st.entries.filter(function (e) { return e.source === 'manual'; })[0];
          if (!manual) st.entries.push({ source: 'manual', summary: '手动编辑（textarea 直改）', ts: new Date() });
          else manual.summary = '手动编辑（textarea 直改）';
        } else {
          st.entries = st.entries.filter(function (e) { return e.source !== 'manual'; });
        }
        updateDocBadges(doc, st, has);
      }, 200);
    });
    // LLM 输入 Enter
    var inp = $('#llm-input');
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendLLM(doc, this.value, null); });
  }
  function updateDocBadges(doc, st, has) {
    var flag = $('#doc-draft-flag');
    if (flag) {
      flag.className = has ? 'chip warn small' : 'chip ok small';
      flag.id = 'doc-draft-flag';
      flag.textContent = has ? '● 未 Apply（草稿 ' + st.entries.length + ' 处）' : '无草稿';
    }
    // 更新草稿 tab 若打开
    if ((S.docTab[doc.name] || 'llm') === 'draft') render();
  }
  /* --- LLM 对话 --- */
  ACTIONS['llm-chip'] = function (el) {
    var doc = docByName(S.params.name);
    if (doc) sendLLM(doc, null, el.dataset.id);
  };
  ACTIONS['llm-send'] = function () {
    var doc = docByName(S.params.name);
    var inp = $('#llm-input');
    if (doc && inp) sendLLM(doc, inp.value, null);
  };
  ACTIONS['draft-accept'] = function (el) {
    var doc = docByName(S.params.name);
    var L = S.docLLM[doc.name];
    var p = L.pending;
    if (p && applyPatch(doc.name, p.find, p.replace, p.summary, 'llm')) {
      L.msgs.push({ role: 'agent', text: '已加入草稿（未落库）。在「草稿」tab 可查看完整 diff，确认后点 Apply。' });
      toast('已加入草稿', p.summary + '（未 Apply，不发事件）');
    }
    L.pending = null;
    render();
    var ta = $('#doc-editor');
    if (ta) { var st = docState(doc.name); ta.value = st.working; }
  };
  ACTIONS['draft-reject'] = function () {
    var doc = docByName(S.params.name);
    var L = S.docLLM[doc.name];
    L.pending = null;
    L.msgs.push({ role: 'agent', text: '提案已丢弃，文档保持不变。' });
    render();
  };
  function sendLLM(doc, userText, chipId) {
    var L = S.docLLM[doc.name] = S.docLLM[doc.name] || { msgs: [] };
    var label = chipId ? (LLM_CHIPS.filter(function (c) { return c.id === chipId; })[0] || {}).label : null;
    L.msgs.push({ role: 'user', text: label || userText });
    var reply = llmReplyFor(doc, chipId || 'sum', userText);
    var streaming = { role: 'agent', text: '', streaming: true };
    L.msgs.push(streaming);
    render();
    var ta = $('#doc-editor');
    if (ta) { var stt = docState(doc.name); ta.value = stt.working; }
    // 打字机流式
    var full = reply.text;
    var i = 0;
    var t = addInterval(function () {
      i += 3;
      streaming.text = full.slice(0, i);
      var el = $('#llm-msgs .llm-msg.agent:last-child');
      if (el) {
        el.textContent = '';
        el.innerHTML = '<svg class="ic" style="color:var(--llm)"><use href="#cc-i-spark"/></svg> ' + esc(streaming.text) + '<span class="typing-caret"></span>';
        var box = $('#llm-msgs');
        if (box) box.scrollTop = box.scrollHeight;
      }
      if (i >= full.length) {
        clearInterval(t);
        streaming.text = full;
        streaming.streaming = false;
        if (reply.patch) {
          L.pending = reply.patch;
          streaming.cards = '<div class="draft-card"><div class="dc-head"><svg class="ic"><use href="#cc-i-spark"/></svg>LLM 修改提案 · ' + esc(reply.patch.summary) + '</div>' +
            '<div class="dc-body">' + renderDiff([{ t: '-', s: reply.patch.find }, { t: '+', s: reply.patch.replace }], 20) + '</div>' +
            '<div class="dc-acts"><button class="btn sm llm" data-act="draft-accept">加入草稿</button><button class="btn sm" data-act="draft-reject">丢弃</button></div></div>';
        }
        if (S.route === 'doc') render();
      }
    }, 16);
  }
  /* --- 草稿操作 --- */
  ACTIONS['draft-drop'] = function (el) {
    var doc = docByName(S.params.name);
    var st = docState(doc.name);
    var i = parseInt(el.dataset.i, 10);
    var e = st.entries[i];
    st.entries.splice(i, 1);
    toast('已弃用 1 处草稿', e ? e.summary : '', 'warn');
    if (!st.entries.length) { st.working = st.base; }
    render();
    var ta = $('#doc-editor');
    if (ta) ta.value = st.working;
  };
  ACTIONS['draft-full-diff'] = function () {
    var doc = docByName(S.params.name);
    var st = docState(doc.name);
    openModal('<div class="modal-h"><span class="m-title">完整 diff · r' + doc.revision + ' → 草稿</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b">' + renderDiff(diffLines(st.base, st.working), 400) + '</div>');
  };
  /* --- Apply 全流程 --- */
  ACTIONS['doc-apply'] = function () {
    var doc = docByName(S.params.name);
    if (!doc) return;
    var st = docState(doc.name);
    if (st.working === st.base) { toast('无需 Apply', '草稿与文档面无差异（不落库不发事件）'); return; }
    var fullDiff = diffLines(st.base, st.working);
    var stats = diffStats(fullDiff);
    var modal = openModal(
      '<div class="modal-h"><span class="m-title">Apply 确认 · ' + esc(doc.name) + '</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b">' +
      '<div class="kv" style="margin-bottom:12px"><span class="k">乐观锁</span><span class="v mono">base r' + doc.revision + ' ✓（后写者须重读）</span>' +
      '<span class="k">变更</span><span class="v"><span class="chip ok small">+' + stats.add + '</span> <span class="chip danger small">-' + stats.del + '</span> · 来源 ' + st.entries.map(function (e) { return e.source === 'llm' ? 'LLM' : '手动'; }).join('+') + '</span></div>' +
      '<div class="checklist" id="apply-checks">' +
      '<div class="check-item" data-c="1"><span class="ci-ic">…</span>Scheme 校验（apiVersion/kind/scope 结构）</div>' +
      '<div class="check-item" data-c="2"><span class="ci-ic">…</span>权限准入（fieldManager: root · approver role）</div>' +
      '<div class="check-item" data-c="3"><span class="ci-ic">…</span>乐观锁 r' + doc.revision + ' 比对</div></div>' +
      renderDiff(fullDiff, 26) +
      '<div class="apply-progress" id="apply-progress" hidden><div class="progress"><i style="width:0%"></i></div><div class="small faint" style="margin-top:4px" id="apply-progress-text">落库中…</div></div>' +
      '</div>' +
      '<div class="modal-f"><button class="btn" data-act="close-modal">取消</button><button class="btn primary" id="apply-go">确认 Apply</button></div>',
      { cls: 'wide' });
    // 逐项检查动画
    var checks = $all('#apply-checks .check-item');
    checks.forEach(function (c, i) {
      addTimer(function () {
        c.classList.add('pass');
        c.querySelector('.ci-ic').textContent = '✓';
        c.querySelector('.ci-ic').style.color = 'var(--ok)';
      }, 260 + i * 260);
    });
    $('#apply-go').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      $('#apply-progress').hidden = false;
      var bar = $('#apply-progress .progress > i');
      var txt = $('#apply-progress-text');
      var p = 0;
      var t = addInterval(function () {
        p += 18 + Math.random() * 14;
        bar.style.width = Math.min(100, p) + '%';
        txt.textContent = p < 45 ? '乐观锁提交（git commit）…' : p < 80 ? '写 ops DB 审计…' : '发 DocApplied 事件…';
        if (p >= 100) {
          clearInterval(t);
          var res = doApplyDoc(doc.name);
          closeModal();
          if (res) {
            toast('已落库 r' + res.rev + ' · DocApplied 已发出', doc.name + '（' + res.n + ' 处变更，generation → ' + doc.generation + '）', 'ok');
            render();
          }
        }
      }, 130);
    });
  };
  ACTIONS['hist-open'] = function (el) {
    var doc = docByName(S.params.name);
    var rev = parseInt(el.dataset.rev, 10), prev = parseInt(el.dataset.prev, 10);
    var h = doc.history.filter(function (x) { return x.rev === rev; })[0];
    var a = revContent(doc, prev), b = revContent(doc, rev);
    openModal('<div class="modal-h"><span class="m-title">r' + prev + ' → r' + rev + ' · ' + esc(h ? h.author : '') + '</span><button class="icon-btn" data-act="close-modal"><svg class="ic"><use href="#cc-i-close"/></svg></button></div>' +
      '<div class="modal-b"><div class="kv" style="margin-bottom:10px"><span class="k">summary</span><span class="v">' + esc(h ? h.summary : '') + '</span></div>' +
      renderDiff(diffLines(a, b), 200) + '</div>');
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
  route('wf/:name', screenWorkflow);
  route('wf/:name/r/:n', screenWfRun);
  route('doc/:name', screenDoc);
  route('docs', screenDocsGlobal);
  route('chat/:agent', screenChat);
  route('connectors', screenConnectors);
  route('connector/:name', screenConnector);
  route('ws/:name', screenWorkService);
  route('provider/:name', screenProvider);
  route('ref/:name', screenRef);
  route('role/:name', screenRole);
  route('agent/:name', screenAgent);
  route('session/:id', screenSession);
  route('events', screenEvents);
  route('event/:id', screenEvent);
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
    boot();
  }
  function unmountConsole() {
    window.removeEventListener('hashchange', render);
    clearTimers();
    stopFollowTimers();
    if (__CC.conn) { __CC.conn.stop(); __CC.conn = null; }
    if (ROOT) ROOT.innerHTML = '';
    ROOT = null;
  }
  __CC.mountConsole = mountConsole;
  __CC.unmountConsole = unmountConsole;
})();
