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
  function statusOf(t) { return (t && t.status) || t || {}; }
  function specOf(t) { return (t && t.spec) || t || {}; }
  function phaseChip(t) {
    var phase = String(statusOf(t).phase || '');
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
    var s = statusOf(t);
    return /审批|批准|待审|等待人|approval|approve/i.test(String(s.lastError || '') + ' ' + String(s.lastAction || ''));
  }
  function groupOf(t) {
    var phase = String(statusOf(t).phase || '');
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
    return (tasks || []).filter(function (t) { return String(statusOf(t).phase || '') === 'running'; }).length;
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
    var spec = specOf(t);
    return String(spec.title || (t && t.title) || (t && t.name) || '未命名任务');
  }

  /* ---------- 任务行（§16.1 A：标题+一句话+相位徽+依赖数+对话深链） ---------- */
  function taskRow(t) {
    var id = taskIdOf(t);
    var s = statusOf(t);
    var spec = specOf(t);
    var deps = (spec.dependsOn || s.dependsOn || []).length;
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
      if (String(statusOf(t).agentSession || '') === String(sid || '')) hit = t;
    });
    if (!hit) return '<span class="faint small">未关联在册任务</span>';
    var id = taskIdOf(hit);
    var name = id.split('/').pop();
    // §16.1 D 增强（loop-82）：命中任务随行相位徽+最近一句话（人话状态不再只给锚）；词形零新增工程词。
    var last = String(statusOf(hit).lastAction || '').trim();
    return '<span class="chip acc tiny click" data-act="go" data-go="' + esc(taskRoute(id)) + '" title="' + esc(id) + '——查看任务详情">Task: ' + esc(name) + '</span>' +
      phaseChip(hit) +
      (last ? '<span class="faint small" data-sess-task-last="1">' + esc(last.slice(0, 48)) + '</span>' : '') +
      '<span class="faint small">会话型任务（无 workflow 关联）</span>';
  }

  /* ---------- Task↔workflow 关联（§16.1 E①：节点/流程图视图叠加关联活跃 Task 计数+快速跳达） ----------
   * 机械键=Task.spec.touches.objects（scheme.yaml 在册 `objects: []ref`；Go Touches.Objects 同源）——
   * ref 词形 Kind/scope/name 三段或 Kind/name 两段（global scope 缺省），Kind 命中即关联。
   * 节点级映射：契约未携带 Task↔节点字段（loop 会话型任务无 workflow run，无节点落点）——
   * 不猜；workflow 级关联=写集声明真实命中，计数与跳达全是真实对象。 */
  function refText(r) {
    if (r == null) return '';
    if (typeof r === 'string') return r;
    if (typeof r === 'object') {
      var k = String(r.kind || ''), sc = String(r.scope || ''), nm = String(r.name || '');
      if (k && nm) return sc ? k + '/' + sc + '/' + nm : k + '/' + nm;
    }
    return '';
  }
  function taskObjRefs(t) {
    var s = specOf(t);
    var arr = (s.touches && s.touches.objects) || (t && t.touches && t.touches.objects) || [];
    return (Array.isArray(arr) ? arr : []).map(refText).filter(Boolean);
  }
  function taskMatchesWf(t, wfName) {
    var nm = String(wfName || '');
    return taskObjRefs(t).some(function (ref) {
      var segs = ref.split('/');
      return segs[0] === 'Workflow' && segs[segs.length - 1] === nm;
    });
  }
  function wfTaskRelHtml(tasks, wfName) {
    if (tasks == null) return '<div class="small faint">任务清单暂不可读——关联不显示（零编造）</div>';
    var hits = (tasks || []).filter(function (t) { return taskMatchesWf(t, wfName); });
    var active = hits.filter(function (t) {
      var p = String(statusOf(t).phase || '');
      return p !== 'done' && p !== 'canceled';
    });
    var head = '<div class="small faint" data-wf-task-rel-head="1" style="margin-bottom:4px">在册任务 ' + esc(hits.length) + ' 关联 · 活跃 ' + esc(active.length) +
      ' · 关联源=任务写集声明（spec.touches.objects） · 节点级映射未携带（会话型任务无 workflow run）——按 workflow 级写集关联</div>';
    if (!hits.length) return head + '<div class="small faint">暂无在册任务声明触及本 workflow——零关联不编造</div>';
    var rows = hits.map(function (t) {
      var id = taskIdOf(t);
      var doing = groupOf(t) === 'doing';
      return '<span class="chip ' + (doing ? 'acc' : 'mute') + ' tiny click" data-wf-task-ref="1" data-act="go" data-go="' + esc(taskRoute(id)) +
        '" title="' + esc(id) + '——查看任务详情">' + esc(taskTitle(t)) + ' · ' + phaseChip(t) + '</span>';
    }).join(' ');
    return head + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + rows + '</div>';
  }

  /* ---------- 会话触发上下文卡（§16.1 D②：会话页头串联触发 wake 上下文） ----------
   * 数据=GET /v1/agents/wakes 最新 LoopRequested 行。诚实口径：sessionId↔wake 无机械键
   * （宿主会话记录不携带触发 wake 锚）——卡只呈现最近在册唤醒上下文，并显式标注
   * 「非断言本会话由其触发」；唤醒缺席/读面不可达=对应诚实词形，零编造。 */
  function sessWakeCard(wakesBody, opts) {
    var o = opts || {};
    var nowMs = o.now || Date.now();
    if (wakesBody == null) return '<div class="small faint">唤醒记录暂不可读——触发上下文不显示（零编造）</div>';
    var wakes = (Array.isArray(wakesBody.wakes) ? wakesBody.wakes : []).filter(function (w) {
      return w && String(w.type || '') === 'LoopRequested';
    });
    if (!wakes.length) return '<div class="small faint">在册无 LoopRequested 唤醒——本会话页暂无触发上下文可给</div>';
    wakes.sort(function (a, b) {
      var dt = (Date.parse(String(b.at || '')) || 0) - (Date.parse(String(a.at || '')) || 0);
      return dt || (Number(b.wake || 0) - Number(a.wake || 0));
    });
    var w = wakes[0];
    var age = relAge(w.at, nowMs);
    var evBtn = w.eventId
      ? '<button class="btn sm" data-act="go" data-go="event/' + encodeURIComponent(String(w.eventId)) + '">触发事件</button>'
      : '';
    return '<div data-sess-wake="1"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      '<span class="chip acc tiny">最近 loop 唤醒</span>' +
      '<span class="mono small">' + esc(String(w.dedupKey || ('wake #' + (w.wake || '')))) + '</span>' +
      (age ? '<span class="chip mute tiny">' + esc(age) + '</span>' : '') +
      '<span class="chip mute tiny">' + esc(String(w.status || '状态未知')) + '</span>' +
      (w.route ? '<span class="chip mute tiny">路由 ' + esc(String(w.route)) + '</span>' : '') +
      '<span class="chip mute tiny">累计 ' + esc(wakes.length) + ' 次唤醒</span>' +
      (evBtn ? '<span data-sess-wake-acts="1">' + evBtn + '<button class="btn sm" data-act="go" data-go="tasks">任务中心</button></span>' : '') +
      '</div>' +
      '<div class="small faint" style="margin-top:4px">本会话与唤醒无直接映射键（宿主会话记录不携带触发锚）——此处呈现最近在册唤醒上下文，非断言本会话由其触发</div></div>';
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
      if (segs[0] === 'approvals') return 'approvals';
      if (segs[0] === 'tasks') return 'tasks';
      if (segs[0] === 's' && segs.length >= 2) return segs.map(encodeURIComponent).join('/');
      if (segs[0] === 'wf' && segs.length >= 2) return segs.map(encodeURIComponent).join('/');
      if (segs[0] === 'event' && segs.length >= 2) return 'event/' + encodeURIComponent(segs.slice(1).join('/'));
      if (segs[0] === 'task' && segs.length >= 2) return 'task/' + encodeURIComponent(segs.slice(1).join('/'));
      if (segs[0] === 'session' && segs.length >= 2) return 'session/' + encodeURIComponent(segs.slice(1).join('/'));
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
  function windowLabel(w) {
    if (!w) return '';
    if (typeof w === 'string') return w;
    if (typeof w === 'object') {
      var f = String(w.from || ''), t = String(w.to || '');
      var tf = Date.parse(f), tt = Date.parse(t);
      if (!isNaN(tf) && !isNaN(tt) && tt > tf) {
        var h = Math.round((tt - tf) / 3600000);
        if (h > 0) return h + 'h';
      }
      if (f || t) return (f || '—') + ' ~ ' + (t || '—');
      return '';
    }
    return String(w);
  }
  function reportFooter(body) {
    var b = body || {};
    var dq = b.dataQuality || {};
    var missing = dq.missing;
    var missText = Array.isArray(missing) ? missing.map(esc).join('、') : esc(String(missing || ''));
    var win = windowLabel(b.window);
    return '<div class="report-foot small faint" data-report-foot="1">数据可信度：' + generatedByLabel(b.generatedBy) +
      ' · 检查范围 ' + esc(String(b.scope || 'global')) +
      (win ? ' · 窗口 ' + esc(win) : '') +
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

  /* ---------- 当前循环卡（console-ui.md §16.1 C——报告首屏循环状态，零前端自建状态） ----------
   * 数据来源=GET /v1/agents/wakes（LoopRequested 唤醒记录）+ GET /v1/sessions（会话活性）；
   * 显式标注 loop 与 workflow run 的关系（当前=会话型任务，无 workflow run——不误导用户）。 */
  function relAge(ts, nowMs) {
    var t = Date.parse(String(ts || ''));
    if (isNaN(t)) return '';
    var d = Math.max(0, Math.round(((nowMs || Date.now()) - t) / 1000));
    if (d < 60) return d + 's 前';
    if (d < 3600) return Math.round(d / 60) + 'm 前';
    if (d < 86400) return Math.round(d / 3600) + 'h 前';
    return Math.round(d / 86400) + 'd 前';
  }

  /* ---------- 运行形态徽（console-ui.md §16.1 E——「事件对账 run」vs「loop 会话型任务」区分） ----------
   * 判据=wake 记录字段族机械对账：workflow run 行（runs 面/触发留痕）恒无 dedupKey 键（触发面
   * 只有 cli-next-* 形 dedupKey 的 LoopRequested 唤醒才带），以此键有无做代际判别——零字段假造。
   * 显示词形恒标「会话型任务（无 workflow run）」——loop 与 run 的关系显式，不让用户把 run #1 误当 loop。 */
  function wakeRunWord(w) { return (w && w.dedupKey != null && String(w.dedupKey) !== '') ? 'loop 会话型任务' : '事件对账 run'; }

  /* ---------- 环绕循环卡（console-ui.md §16.1 C/E——workflow 详情页页头复用零自建状态） ----------
   * loopCard 的参数化形态：与报告首屏同一 LoopRequested 判据/相对时长/停滞计数，三差异——
   * ① 不渲染主行动按钮（页头已有 workflow 自身动作，报告版按钮只属报告）；② 变体标注
   * 「最近 loop 唤醒（该 workflow 声明≠loop 运行）」——不让用户把 wf 详情页当成 loop 卡片；
   * ③ attrs 由调用方传（data-wf-loop 页头锚 / data-report-loop 报告锚），测试与 UI 拍同锚。 */
  function loopCardFor(wakesBody, sessionsBody, opts) {
    var o = opts || {};
    var html = loopCard(wakesBody, sessionsBody, o);
    var attr = o.attr || 'data-report-loop';
    return html.replace('data-report-loop=', attr + '=').replace('会话型任务（无 workflow run）',
      '会话型任务（无 workflow run）· loop 唤醒≠该 workflow run');
  }
  function loopCard(wakesBody, sessionsBody, opts) {
    var o = opts || {};
    var nowMs = o.now || Date.now();
    var agent = String(o.agent || 'core-headless');
    if (wakesBody == null && sessionsBody == null) {
      return '<div class="card report-loop" data-report-loop="degraded"><div class="card-b">' +
        '<div class="report-loop-top"><span class="chip mute tiny">当前循环</span>' +
        '<span class="small faint">唤醒与会话状态暂不可达（不冒充无循环）。</span></div></div></div>';
    }
    var wakes = (wakesBody && Array.isArray(wakesBody.wakes)) ? wakesBody.wakes : [];
    var loops = wakes.filter(function (w) { return w && String(w.type || '') === 'LoopRequested'; });
    loops.sort(function (a, b) {
      var dt = (Date.parse(String(b.at || '')) || 0) - (Date.parse(String(a.at || '')) || 0);
      return dt || (Number(b.wake || 0) - Number(a.wake || 0));
    });
    var latest = loops[0] || null;
    var sessions = (sessionsBody && Array.isArray(sessionsBody.sessions)) ? sessionsBody.sessions : [];
    var stalledN = sessions.filter(function (s) {
      var st = String((s && s.state) || '');
      return st === 'suspected-stall' || st === 'escalated';
    }).length;
    var sessNote = sessions.length
      ? ' · 监控会话 ' + sessions.length + ' 个' + (stalledN ? '（含停滞/升级 ' + stalledN + '）' : '')
      : '';
    if (!latest) {
      return '<div class="card report-loop" data-report-loop="idle"><div class="card-b">' +
        '<div class="report-loop-top"><span class="chip mute tiny">当前无进行中循环</span>' +
        '<span class="chip mute tiny">会话型任务（无 workflow run）</span>' +
        '<span class="small faint">本周期暂无 LoopRequested 唤醒记录' + esc(sessNote) + '</span></div>' +
        '<div class="report-loop-sub small faint">用 CLI 点火下一轮：<code class="mono">corectl loop</code></div></div></div>';
    }
    var ts = Date.parse(String(latest.at || ''));
    var recent = !isNaN(ts) && (nowMs - ts) <= 3600000;
    var stateAttr = recent ? 'active' : 'recorded';
    var badge = recent ? '<span class="chip acc tiny">最近循环</span>' : '<span class="chip mute tiny">历史唤醒</span>';
    var age = relAge(latest.at, nowMs);
    var evBtn = latest.eventId
      ? '<button class="btn sm" data-act="go" data-go="event/' + encodeURIComponent(String(latest.eventId)) + '">触发事件</button>'
      : '';
    return '<div class="card report-loop" data-report-loop="' + stateAttr + '"><div class="card-b">' +
      '<div class="report-loop-top">' + badge +
      '<span class="mono small">' + esc(String(latest.dedupKey || ('wake #' + (latest.wake || '')))) + '</span>' +
      (age ? '<span class="chip mute tiny">' + esc(age) + '</span>' : '') +
      '<span class="chip mute tiny">会话型任务（无 workflow run）</span>' +
      '<span class="report-loop-acts">' +
      '<button class="btn sm primary" data-act="go" data-go="chat/' + encodeURIComponent(agent) + '">看完整对话</button>' +
      '<button class="btn sm" data-act="go" data-go="tasks">任务中心</button>' + evBtn +
      '</span></div>' +
      '<div class="report-loop-sub small faint">最近 LoopRequested 唤醒 #' + esc(String(latest.wake || '—')) +
      ' · 路由 ' + esc(String(latest.route || latest.agent || 'root-agent')) +
      ' · 状态 ' + esc(String(latest.status || '—')) +
      ' · 累计唤醒 ' + esc(String(loops.length)) + ' 次' + esc(sessNote) + '</div></div></div>';
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
    sessionChips: sessionChips, wfTaskRelHtml: wfTaskRelHtml, sessWakeCard: sessWakeCard,
    taskObjRefs: taskObjRefs, taskMatchesWf: taskMatchesWf, sevView: sevView, sevRank: sevRank, sortAttention: sortAttention,
    evidenceRoute: evidenceRoute, attentionCard: attentionCard, factsHtml: factsHtml,
    degradedBanner: degradedBanner, generatedByLabel: generatedByLabel, windowLabel: windowLabel,
    reportFooter: reportFooter, clearPanel: clearPanel, loopCard: loopCard, relAge: relAge,
    loopCardFor: loopCardFor, wakeRunWord: wakeRunWord,
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
