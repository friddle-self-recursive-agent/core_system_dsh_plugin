/* console-tasks.js —— 任务中心/任务详情/关注报告词形层（console-ui.md §16 + §14 报告三块，
 * R-UX-6，2026-11-26 用户裁决）。任务状态单一写者=调度器（Task.status）；本模块只做投影：
 *   ① 分组=确定性纯函数 groupTasks()（正在做/等人/卡住/完成/排队——§16.1 人话词形固定）；
 *   ② attention 卡=severity 排序+证据 ref 路由映射 evidenceRoute()（未知词形=不可点不冒充）；
 *   ③ loader 注入（同 console-obj 范式——模块零直接网络依赖；宿主侧接 /v1/tasks、/v1/attention）。
 * 数据纪律：零前端自建状态；清单/报告读取失败=显式降级词形（零命中不装假——L78 同款）；
 * contract 未携带的字段（并发上限/完成时刻/workflow 关联）一律不显示不编造。
 * 词汇纪律（R-UX-3）：用户可见文案零工程词形。安全红线（同 console-md.js）：
 * 一切动态文本先 HTML 转义再入卡，零原文直插。 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 相位人话词形（§16.2：禁 run #N/session id 当主标题——标题取 spec.title/name） ---------- */
  var PHASE_VIEW = {
    running: { label: '正在做', chip: 'acc' },
    verifying: { label: '验证中', chip: 'acc' },
    queued: { label: '排队中', chip: 'mute' },
    ready: { label: '待启动', chip: 'mute' },
    blocked: { label: '受阻', chip: 'warn' },
    failed: { label: '失败', chip: 'esc' },
    done: { label: '已完成', chip: 'ok' },
    canceled: { label: '已取消', chip: 'mute' }
  };
  function phaseChip(t) {
    var phase = String((t && t.status && t.status.phase) || '');
    var v = PHASE_VIEW[phase];
    if (!v) {
      // 未知相位不冒充人话——原词如实显示（不丢行不掉徽）
      return '<span class="chip mute tiny">' + esc(phase || '状态未知') + '</span>';
    }
    return '<span class="chip ' + v.chip + ' tiny">' + esc(v.label) + '</span>';
  }

  /* ---------- 分组（确定性纯函数——机械直测口径） ----------
   * 正在做=running/verifying；排队=queued/ready；完成=done；
   * blocked/failed 再分：原因（lastError+lastAction）命中审批词形=等人（等人裁决），否则=卡住；
   * canceled=完成组但徽标如实「已取消」（不冒充成功）；未知相位=排队组（原词徽显示，不丢行）。
   * 等人判定是词形规则且判据写明——契约未携带结构化「待审」标记，诚实下不猜更细。 */
  function humanWait(t) {
    var s = (t && t.status) || {};
    return /审批|批准|待审|等待人|approval|approve/i.test(String(s.lastError || '') + ' ' + String(s.lastAction || ''));
  }
  function groupOf(t) {
    var phase = String((t && t.status && t.status.phase) || '');
    if (phase === 'running' || phase === 'verifying') return 'doing';
    if (phase === 'done' || phase === 'canceled') return 'done';
    if (phase === 'blocked' || phase === 'failed') return humanWait(t) ? 'waiting' : 'stuck';
    return 'queued'; // queued/ready 与未知相位
  }
  var GROUPS = [
    { id: 'doing', label: '正在做' },
    { id: 'waiting', label: '等人' },
    { id: 'stuck', label: '卡住' },
    { id: 'done', label: '完成' },
    { id: 'queued', label: '排队' }
  ];
  function groupTasks(tasks) {
    var out = { doing: [], waiting: [], stuck: [], done: [], queued: [] };
    (tasks || []).forEach(function (t) { out[groupOf(t)].push(t); });
    return out;
  }
  function runningCount(tasks) {
    // 并发摘要只数 running（上限不在 contract——分母缺缺席即不显示，不装假）
    return (tasks || []).filter(function (t) { return String((t.status || {}).phase) === 'running'; }).length;
  }

  /* ---------- 任务标识与深链 ----------
   * taskId='<scope>/<name>'（contract 行含 kind/scope/name）；路由段整段单次编码（%2F 形——
   * designdoc 同词形，路由侧整体解回）。agentSession 深链=#/session/<id>（有才显示）。 */
  function taskIdOf(t) {
    if (!t) return '';
    if (t.taskId) return String(t.taskId);
    return (t.scope || 'global') + '/' + String(t.name || '');
  }
  function taskRoute(id) { return 'task/' + encodeURIComponent(String(id || '')); }
  function sessionRoute(sid) { return 'session/' + encodeURIComponent(String(sid || '')); }
  function taskTitle(t) {
    return String((t && t.spec && t.spec.title) || (t && t.name) || '未命名任务');
  }

  /* ---------- 任务行（§16.1 A：标题+一句话+相位徽+依赖数+对话深链） ---------- */
  function taskRow(t) {
    var id = taskIdOf(t);
    var s = (t && t.status) || {};
    var spec = (t && t.spec) || {};
    var deps = (spec.dependsOn || []).length;
    var last = String(s.lastAction || '').trim();
    var agent = String(s.agent || spec.agent || '').trim();
    var sess = String(s.agentSession || '').trim();
    return '<div class="task-row" data-act="go" data-go="' + esc(taskRoute(id)) + '">' +
      '<div class="task-main">' +
      '<div class="task-title"><b>' + esc(taskTitle(t)) + '</b>' + phaseChip(t) +
      '<span class="chip mute tiny">' + esc(id) + '</span>' +
      (deps ? '<span class="chip mute tiny">依赖 ' + esc(deps) + '</span>' : '') +
      (agent ? '<span class="chip mute tiny">负责 ' + esc(agent) + '</span>' : '') + '</div>' +
      '<div class="task-sub small">' + (last ? esc(last) : '最近动作：—') +
      (String(s.lastError || '').trim() ? ' · <span class="chip esc tiny">' + esc(String(s.lastError).slice(0, 60)) + '</span>' : '') +
      '</div></div>' +
      '<div class="task-acts">' +
      (sess ? '<button class="btn sm" data-act="go" data-go="' + esc(sessionRoute(sess)) + '">对话</button>' : '') +
      '</div></div>';
  }

  /* ---------- 会话头 chips（§16.1 D：Task/Workflow/节点/Run——可得的才显示，不猜） ----------
   * contract 只有 Task 锚（agentSession 反查）；workflow/节点/run 字段未携带=显式人话注记不编造。
   * tasks=null（清单不可读）=不显示（拿不到就显式不显示）；在册未命中=「未关联在册任务」。 */
  function sessionChips(tasks, sid) {
    if (!tasks) return '';
    var hit = null;
    (tasks || []).forEach(function (t) {
      if (hit) return;
      if (String((t.status || {}).agentSession || '') === String(sid || '')) hit = t;
    });
    if (!hit) return '<span class="faint small">未关联在册任务</span>';
    var id = taskIdOf(hit);
    var name = id.split('/').pop();
    return '<span class="chip acc tiny click" data-act="go" data-go="' + esc(taskRoute(id)) + '" title="' + esc(id) + '——查看任务详情">Task: ' + esc(name) + '</span>' +
      '<span class="faint small">会话型任务（无 workflow 关联）</span>';
  }

  /* ---------- attention：severity 词形与排序 ---------- */
  var SEV_VIEW = {
    critical: { label: '严重', chip: 'esc' },
    high: { label: '重要', chip: 'warn' },
    medium: { label: '一般', chip: 'mute' }
  };
  function sevView(sev) {
    return SEV_VIEW[String(sev || '')] || { label: String(sev || '未分级'), chip: 'mute' };
  }
  function sevRank(sev) {
    var s = String(sev || '');
    if (s === 'critical') return 0;
    if (s === 'high') return 1;
    if (s === 'medium') return 2;
    return 3;
  }
  function sortAttention(list) {
    return (list || []).slice().sort(function (a, b) { return sevRank(a && a.severity) - sevRank(b && b.severity); });
  }

  /* ---------- attention：证据 ref → 路由（已知词形可点，未知=纯文本不冒充） ----------
   * '#/wf/x[/r/n]' → 工作流/运行深链；'#/event/<id>' → 事件详情；'#/inbox' → 待你处理；
   * '#/obj/...' → 工作台；'Kind/scope/name' → 对象工作台（#/obj/Kind/scope/name）。 */
  function evidenceRoute(ref) {
    var r = String(ref || '').trim();
    if (!r) return null;
    if (r.indexOf('#/') === 0) {
      var segs = r.slice(2).split('/').filter(Boolean);
      if (!segs.length) return null;
      if (segs[0] === 'inbox') return 'inbox';
      if (segs[0] === 'wf' && segs.length >= 2) return segs.map(encodeURIComponent).join('/');
      if (segs[0] === 'event' && segs.length >= 2) return 'event/' + encodeURIComponent(segs.slice(1).join('/'));
      if (segs[0] === 'obj' && segs.length >= 4) return segs.map(encodeURIComponent).join('/');
      return null;
    }
    var m = /^([A-Za-z][A-Za-z0-9]*)\/([^/\s]+)\/([^/\s]+)$/.exec(r); // Kind/scope/name
    if (m) return 'obj/' + m.slice(1).map(encodeURIComponent).join('/');
    return null;
  }
  function evidenceChip(ev) {
    if (!ev) return '';
    var ref = String(ev.ref || '');
    var route = evidenceRoute(ref);
    var tip = [ev.hash ? 'hash ' + ev.hash : '', ev.at ? String(ev.at) : ''].filter(Boolean).join(' · ');
    var body = '<span class="chip mute tiny' + (route ? ' click' : '') + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' +
      (route ? '<span data-act="go" data-go="' + esc(route) + '">' + esc(ref) + '</span>' : esc(ref || ev.kind || '证据')) +
      '</span>';
    return body;
  }
  function actionLabel(kind) {
    var map = { approve: '去审批', chat: '聊聊', open: '打开', view: '查看', retry: '重试', fix: '去处理' };
    return map[String(kind || '')] || '去处理';
  }
  function attentionCard(a, i) {
    if (!a) return '';
    var sev = sevView(a.severity);
    var evs = (a.evidence || []).map(evidenceChip).filter(Boolean);
    var action = a.action || {};
    // action.target 即路由（contract）——'#/' 词形剥前缀后透传 go（不做词形判别不二次猜测）
    var route = action.target ? String(action.target).replace(/^#\/?/, '') : null;
    return '<div class="att-card sev-' + esc(String(a.severity || 'unknown')) + '" data-att-card="' + esc(i) + '">' +
      '<div class="att-h"><span class="chip ' + sev.chip + ' tiny">' + esc(sev.label) + '</span>' +
      (a.category ? '<span class="chip mute tiny">' + esc(a.category) + '</span>' : '') +
      '<b>' + esc(String(a.title || '未命名关注项')) + '</b></div>' +
      (a.why ? '<div class="att-why small">' + esc(String(a.why)) + '</div>' : '') +
      (evs.length ? '<div class="att-ev">' + evs.join('') + '</div>' : '<div class="att-ev small faint">证据：—</div>') +
      (route ? '<div class="att-acts"><button class="btn sm" data-act="go" data-go="' + esc(route) + '">' + esc(actionLabel(action.kind)) + '</button></div>' : '') +
      '</div>';
  }

  /* ---------- attention：facts / summary / 数据可信度 / clear ---------- */
  function factsHtml(facts) {
    if (facts == null || facts === '') return '<span class="faint small">事实注脚：—</span>';
    if (Array.isArray(facts)) {
      return facts.map(function (f) {
        if (typeof f === 'string') return '<span class="chip mute tiny">' + esc(f) + '</span>';
        return '<span class="chip mute tiny">' + esc(JSON.stringify(f)) + '</span>';
      }).join(' ');
    }
    if (typeof facts === 'object') {
      return Object.keys(facts).map(function (k) {
        return '<span class="chip mute tiny">' + esc(k) + ': ' + esc(facts[k]) + '</span>';
      }).join(' ');
    }
    return '<span class="small">' + esc(String(facts)) + '</span>';
  }
  function degradedBanner(dq) {
    if (!dq || !dq.degraded) return '';
    var missing = dq.missing;
    var missText = Array.isArray(missing) ? missing.map(esc).join('、') : esc(String(missing || '未说明'));
    return '<div class="att-banner" data-report-degraded="1">本轮报告数据可信度降级——以下数据缺席，结论按在册事实收敛：' + missText + '</div>';
  }
  function generatedByLabel(v) {
    return String(v || '') === 'llm' ? '智能归纳' : String(v || '') === 'rules' ? '基础汇总' : esc(String(v || '未注明生成方式'));
  }
  function reportFooter(body) {
    var b = body || {};
    var dq = b.dataQuality || {};
    var missing = dq.missing;
    var missText = Array.isArray(missing) ? missing.map(esc).join('、') : esc(String(missing || ''));
    return '<div class="report-foot small faint" data-report-foot="1">数据可信度：' + generatedByLabel(b.generatedBy) +
      ' · 检查范围 ' + esc(String(b.scope || 'global')) +
      (b.window ? ' · 窗口 ' + esc(String(b.window)) : '') +
      (b.asOf ? ' · 截至 ' + esc(String(b.asOf)) : '') +
      (missText ? ' · 缺席数据：' + missText : '') +
      ' · 报告为派生视图可随时重建，不落对象账。</div>';
  }
  function clearPanel(clear) {
    var rows = (clear || []);
    if (!rows.length) return '';
    return '<details class="cc-disclosure" data-report-clear="1"><summary>本窗口已澄清（clear ' + esc(rows.length) + ' 项）</summary>' +
      '<div class="cc-prose">' + rows.map(function (c) {
        return '<div class="small">' + esc(String((c && c.candidateId) || '')) +
          (c && c.note ? ' —— ' + esc(String(c.note)) : '') + '</div>';
      }).join('') + '</div></details>';
  }

  /* ---------- loader 注入（同 console-obj 范式——宿主挂 fetch 通路，模块零直接网络依赖） ----------
   * tasks 清单缓存 15s（对齐 live 轻刷新窗）；attention 缓存 60s（服务端另有缓存与限频）；
   * 单任务详情恒现读（对象正文同口径）；失败=落 null 不缓存失败态（下一拍自动重读）。 */
  var tasksLoader = null;
  var taskLoader = null;
  var attentionLoader = null;
  var tcache = { list: null, at: 0, promise: null };
  var acache = { body: null, at: 0, promise: null };
  var TASKS_TTL = 15000;
  var ATT_TTL = 60000;
  function setTasksLoader(fn) { tasksLoader = fn; tcache = { list: null, at: 0, promise: null }; }
  function setTaskLoader(fn) { taskLoader = fn; }
  function setAttentionLoader(fn) { attentionLoader = fn; acache = { body: null, at: 0, promise: null }; }
  function ensureTasks(force) {
    if (!force && tcache.list && (Date.now() - tcache.at) < TASKS_TTL) return Promise.resolve(tcache.list);
    if (!tasksLoader) return Promise.resolve(null);
    if (!tcache.promise) {
      tcache.promise = Promise.resolve().then(tasksLoader).then(function (b) {
        tcache.list = Array.isArray(b) ? b : ((b && b.tasks) || []);
        tcache.at = Date.now();
        tcache.promise = null;
        return tcache.list;
      }, function () {
        tcache.list = null;
        tcache.promise = null;
        return null;
      });
    }
    return tcache.promise;
  }
  function refreshTasks() { return ensureTasks(true); }
  function ensureTask(id) {
    if (!taskLoader) return Promise.resolve(null);
    return Promise.resolve().then(function () { return taskLoader(id); }, function () { return null; });
  }
  function ensureAttention(force) {
    if (!force && acache.body && (Date.now() - acache.at) < ATT_TTL) return Promise.resolve(acache.body);
    if (!attentionLoader) return Promise.resolve(null);
    if (!acache.promise) {
      acache.promise = Promise.resolve().then(attentionLoader).then(function (b) {
        acache.body = b || null;
        acache.at = Date.now();
        acache.promise = null;
        return acache.body;
      }, function () {
        acache.body = null;
        acache.promise = null;
        return null;
      });
    }
    return acache.promise;
  }
  function refreshAttention() { return ensureAttention(true); }

  var API = {
    esc: esc, phaseChip: phaseChip, groupOf: groupOf, groupTasks: groupTasks,
    runningCount: runningCount, taskIdOf: taskIdOf, taskRoute: taskRoute,
    sessionRoute: sessionRoute, taskTitle: taskTitle, taskRow: taskRow,
    sessionChips: sessionChips, sevView: sevView, sevRank: sevRank, sortAttention: sortAttention,
    evidenceRoute: evidenceRoute, attentionCard: attentionCard, factsHtml: factsHtml,
    degradedBanner: degradedBanner, generatedByLabel: generatedByLabel,
    reportFooter: reportFooter, clearPanel: clearPanel,
    setTasksLoader: setTasksLoader, setTaskLoader: setTaskLoader, setAttentionLoader: setAttentionLoader,
    ensureTasks: ensureTasks, refreshTasks: refreshTasks,
    ensureTask: ensureTask, ensureAttention: ensureAttention, refreshAttention: refreshAttention,
    GROUPS: GROUPS
  };
  if (typeof window !== 'undefined') {
    window.__CC = window.__CC || {};
    window.__CC.tasks = API;
  }
})();
