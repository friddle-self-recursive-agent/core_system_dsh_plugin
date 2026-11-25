// console-chat.js —— E5 Agent 会话适配层（console-adoption.md §1.11）。
// 数据源裁决（§3.7）：会话=dsh session store（ctx.sessions，不复制状态）；身份=SessionId
// （cross-agent.md §5.7 #1）；发消息=session.prompt 真通路（§5.7 #2）；转录=session 事件页读面；
// 终端 roster=ctx.webTerminals（内置 PTY 为主，§5.7 #6）；渲染数据无双源红线不破——
// 会话面数据源=dsh session store 是 §3.7 显式裁决，与「全部来自 cored 读面」并存（两权威各管一面：
// 文档面/资源状态=cored；会话运行态=dsh session store）。
// 本模块 DOM 无关：faces 全部可注入（node --test 单测确定性）。
(function () {
  'use strict';

  /** 运行器四选（E5 内容列；cross-agent.md §5.7 映射）。
   *  内嵌 dsh=可用主案；claude-code=现成 subagent provider（preset 接线=E5b 挂账）；
   *  opencode/gotty=自写 SubagentProvider/跨机兜底（connector 代码 R-ENG-3——common_connector 余量）。
   *  诚实纪律：不可用 runner 在选择面在册但 disabled+why 标注，不冒充可用。 */
  var RUNNERS = [
    { id: 'dsh', name: '内嵌 dsh', desc: '默认 runner：宿主内原生会话（缺省 preset），身份=SessionId', enabled: true, why: '' },
    { id: 'claude-code', name: 'claude-code', desc: '经宿主现成 subagent provider 拉起（cross-agent.md §5.7）', enabled: false, why: 'provider/preset 接线=E5b 挂账（不冒充可用）' },
    { id: 'opencode', name: 'opencode cli', desc: '自写 SubagentProvider——connector 代码归 common_connector（R-ENG-3）', enabled: false, why: '自写 provider 余量（E5b 后排期）' },
    { id: 'gotty', name: 'gotty 终端', desc: '跨机兜底终端：经 piko 暴露、独立鉴权（本机主案=dsh 内置 PTY）', enabled: false, why: '跨机场景余量（§5.7 #6：内置 PTY 全面占优）' }
  ];
  function runnerList() {
    return RUNNERS.map(function (r) {
      return { id: r.id, name: r.name, desc: r.desc, enabled: r.enabled, why: r.why };
    });
  }
  function runnerById(id) {
    var hit = null;
    RUNNERS.forEach(function (r) { if (r.id === id) hit = r; });
    return hit;
  }

  /** ConnectorOps 卡判别（E5 转录渲染层）：op 名命中该 agent 文档面声明集→ConnectorOps 卡。
   *  声明集=Agent.spec.connectorOps[].ops（每条 {ops: <ConnectorOps ref>, as: <alias>}——
   *  判别输入=已解析的 op 名数组）。声明缺席=普通工具卡（不冒充协议挂载）。 */
  function isConnectorOp(toolName, declaredOps) {
    if (!toolName || !declaredOps || !declaredOps.length) return false;
    return declaredOps.indexOf(toolName) >= 0;
  }
  /** agent 文档面 connectorOps 声明解析：spec.connectorOps=[{ops:"connector-ops/x", as:"别名"}]
   *  × ConnectorOps 对象 spec.ops=[…] → op 名去重并集。声明/对象任一缺席=空集（诚实）。 */
  function declaredOpsOf(agentContent, connectorOpsIndex) {
    var out = [];
    var mounts = agentContent && agentContent.spec && agentContent.spec.connectorOps;
    if (!Array.isArray(mounts)) return out;
    mounts.forEach(function (m) {
      if (!m || !m.ops) return;
      var ref = String(m.ops);
      var obj = connectorOpsIndex && connectorOpsIndex[ref];
      if (obj && Array.isArray(obj.ops)) {
        obj.ops.forEach(function (op) { if (out.indexOf(op) < 0) out.push(op); });
      }
    });
    return out;
  }

  /** 归属过滤（§3.7 会话组织=按 agent 过滤的投影，不复制状态）。
   *  归属证据链：①Agent 文档面 status.currentSession.id 命中；②console 发起在册（本页内存 UI 态——
   *  不落库=零持久状态）；③ServiceInstance.agentRefs 显式 sessionId 形（session://<id>——§5.7 #1）。
   *  其余行=宿主会话（诚实标注非归属证据，不冒充归属）。 */
  function attributedSessions(rows, evidence) {
    var mine = [];
    var host = [];
    (rows || []).forEach(function (r) {
      if (evidence.currentSessionId && r.id === evidence.currentSessionId) mine.push(r);
      else if (evidence.ownedIds && evidence.ownedIds.indexOf(r.id) >= 0) mine.push(r);
      else host.push(r);
    });
    return { mine: mine, host: host };
  }
  /** ServiceInstance.agentRefs 中的显式 sessionId 形解析：session://<id>（§5.7 #1 文档面落点）。
   *  agent://<name> 形=文档面地址（经 Agent.status.currentSession 解析，不在此列）。 */
  function sessionIdsOfRefs(refs) {
    var out = [];
    (refs || []).forEach(function (r) {
      var s = String(r || '');
      if (s.indexOf('session://') === 0) {
        var id = s.slice('session://'.length);
        if (id && out.indexOf(id) < 0) out.push(id);
      }
    });
    return out;
  }

  /** 会话适配器：faces={sessions, webTerminals}（dsh client 服务面，全部可注入假体）。
   *  faces 可缺席（headless/未装配宿主）——ready()=false，调用面返回诚实降级不抛错。 */
  function createAdapter(faces) {
    faces = faces || {};
    var sessions = faces.sessions || null;
    var webTerminals = faces.webTerminals || null;
    var SOURCE = 'core-console'; // SessionReferenceSource 消费者标签（declaration-merge 扩展名）

    function ready() { return !!(sessions && typeof sessions.create === 'function'); }

    /** 会话清单快照投影（瘦身行；宿主列表顺序即权威序）。 */
    function listSnapshot() {
      if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return { ready: false, rows: [] };
      var snap = sessions.list.getSnapshot();
      var rows = [];
      ((snap && snap.ids) || []).forEach(function (id) {
        var r = snap.byId && snap.byId[id];
        if (!r) return;
        rows.push({
          id: String(id),
          title: String(r.displayTitle || r.title || id),
          cwd: r.cwd ? String(r.cwd) : '',
          running: !!r.running,
          blank: !!r.blank,
          updatedAt: Number(r.updatedAt || 0)
        });
      });
      return { ready: true, phase: String((snap && snap.phase) || ''), rows: rows };
    }
    /** 订阅清单变化（ObservableSnapshot.subscribe；返回退订函数）。 */
    function subscribe(fn) {
      if (!sessions || !sessions.list || typeof sessions.list.subscribe !== 'function') return function () {};
      return sessions.list.subscribe(function () { fn(); }) || function () {};
    }
    /** 刷新宿主清单（refresh() 返回 Promise）。 */
    function refresh() {
      if (!sessions || typeof sessions.refresh !== 'function') return Promise.resolve(false);
      return Promise.resolve(sessions.refresh()).then(function () { return true; }, function () { return false; });
    }
    /** 新建会话（opts={cwd?, agentPreset?, sessionId?}）→ 判别联合不抛错。 */
    function create(opts) {
      if (!ready()) return Promise.resolve({ ok: false, error: '宿主会话面缺席（ctx.sessions 未在册）' });
      var p;
      try { p = sessions.create(opts || {}); } catch (e) { return Promise.resolve({ ok: false, error: String(e) }); }
      return Promise.resolve(p).then(
        function (id) { return { ok: true, id: String(id) }; },
        function (e) { return { ok: false, error: String((e && e.message) || e) }; }
      );
    }
    /** 发消息真通路（§5.7 #2：session.prompt；mode=queue|steer）→ 判别联合。 */
    function prompt(sessionId, text, mode) {
      if (!ready() || typeof sessions.using !== 'function') return Promise.resolve({ ok: false, error: '宿主会话面缺席（ctx.sessions 未在册）' });
      if (!sessionId || !text || !String(text).trim()) return Promise.resolve({ ok: false, error: '空消息或空会话身份' });
      return sessions.using(sessionId, { source: SOURCE }, function (ref) {
        var s = ref.binding.session;
        var sub = s.beginSubmission({ mode: mode === 'steer' ? 'steer' : 'queue', text: String(text), attachments: [] });
        var content = [{ type: 'text', text: String(text) }];
        return Promise.resolve(s.prompt(content, mode === 'steer' ? 'steer' : 'queue', undefined, sub.requestId))
          .then(function (result) {
            if (result && result.ok) return { ok: true, accepted: true };
            return { ok: false, error: String((result && result.error && (result.error.message || result.error.code)) || 'prompt 被拒绝') };
          }, function (e) { return { ok: false, error: String((e && e.message) || e) }; });
      }).then(
        function (r) { return r && typeof r.ok === 'boolean' ? r : { ok: true, accepted: true }; },
        function (e) { return { ok: false, error: String((e && e.message) || e) }; }
      );
    }
    /** 会话改名（探针/识别锚：console 发起的会话显式命名）。 */
    function rename(sessionId, title) {
      if (!ready() || typeof sessions.using !== 'function') return Promise.resolve({ ok: false, error: '宿主会话面缺席' });
      return sessions.using(sessionId, { source: SOURCE }, function (ref) {
        return Promise.resolve(ref.binding.session.rename(String(title))).then(
          function (r) { return r && r.ok ? { ok: true } : { ok: false, error: String((r && r.error && (r.error.message || r.error.code)) || 'rename 被拒绝') }; },
          function (e) { return { ok: false, error: String((e && e.message) || e) }; }
        );
      }).then(function (r) { return r || { ok: false, error: 'rename 未返回' }; }, function (e) { return { ok: false, error: String((e && e.message) || e) }; });
    }
    /** 会话持有（sessions.retain——转录活体源）：ref.binding.eventSource=事件窗 ObservableSnapshot
     *  （retain 自带初始历史开窗；订阅=活体更新，不轮询不复制状态）。faces 缺席/retain 抛错=诚实降级。
     *  冷会话开窗兜底：ready 后 loadOlder()（≤500 条/两 turn 对齐——dsh 既有拉史原语，E5 探针实证
     *  冷 retain 开窗在 console 面板上下文可能空窗，loadOlder=显式补拉）。 */
    function hold(sessionId) {
      if (!ready() || typeof sessions.retain !== 'function') return null;
      var ref;
      try { ref = sessions.retain(String(sessionId), { source: SOURCE }); } catch (e) { return null; }
      return {
        sessionId: String(sessionId),
        ready: ref.ready || Promise.resolve(ref.binding),
        snapshot: function () {
          var snap = ref.binding.eventSource && typeof ref.binding.eventSource.getSnapshot === 'function'
            ? ref.binding.eventSource.getSnapshot() : null;
          return snap ? { entries: snap.entries || [], hasMore: !!snap.hasMore } : { entries: [], hasMore: false };
        },
        subscribe: function (fn) {
          if (!ref.binding.eventSource || typeof ref.binding.eventSource.subscribe !== 'function') return function () {};
          return ref.binding.eventSource.subscribe(fn) || function () {};
        },
        loadOlder: function () {
          try {
            var s = ref.binding.session;
            if (s && typeof s.loadOlder === 'function') return Promise.resolve(s.loadOlder()).then(function () { return true; }, function () { return false; });
          } catch (e) { /* 冷会话已离场 */ }
          return Promise.resolve(false);
        },
        release: function () { try { ref.release(); } catch (e) { /* 已离场 */ } }
      };
    }
    /** 终端 roster（ctx.webTerminals.watch；face 缺席=null=诚实降级）。返回 {unsubscribe, get}。 */
    function terminals(sessionId) {
      if (!webTerminals || typeof webTerminals.watch !== 'function') return null;
      var cur = null;
      var off = null;
      try {
        off = webTerminals.watch(String(sessionId), function (list) { cur = list || []; });
      } catch (e) { return null; }
      return {
        get: function () { return cur; },
        unsubscribe: function () { try { off && off(); } catch (e) { /* 已离场 */ } }
      };
    }
    return {
      ready: ready, listSnapshot: listSnapshot, subscribe: subscribe, refresh: refresh,
      create: create, prompt: prompt, rename: rename, hold: hold, terminals: terminals, SOURCE: SOURCE
    };
  }

  /** 事件页记录投影 → 转录行（DOM 无关，渲染层直用）。
   *  词汇表（dsh-session surface）：user/message、assistant/message、tool/call、tool/result。
   *  tool/call 与 tool/result 按 callId 配对；declaredOps 命中=ConnectorOps 卡。 */
  function projectTranscript(records, declaredOps) {
    var items = [];
    var openCalls = {};
    (records || []).forEach(function (rec) {
      var ev = rec && rec.event;
      if (!ev || typeof ev.type !== 'string') return;
      var d = ev.data || {};
      if (ev.type === 'user/message') {
        var text = textOfBlocks(d.message && d.message.content);
        var kind = d.message && d.message.source && d.message.source.kind;
        if (!text) return; // 注入上下文/空内容行不上屏（转录=对话面）
        items.push({ kind: kind === 'user' ? 'user' : 'context', text: text, seq: ev.seq, ts: ev.time, source: kind || '' });
      } else if (ev.type === 'assistant/message') {
        var atext = textOfBlocks(d.message && d.message.content);
        items.push({
          kind: 'assistant', text: atext, seq: ev.seq, ts: ev.time,
          interrupted: d.interrupted === true,
          usage: d.usage || null
        });
      } else if (ev.type === 'tool/call') {
        var call = { kind: 'tool', op: String(d.name || ''), argsText: String(d.arguments || ''), seq: ev.seq, ts: ev.time, callId: String(d.callId || ''), connectorOps: isConnectorOp(String(d.name || ''), declaredOps), result: null, isError: false };
        items.push(call);
        if (call.callId) openCalls[call.callId] = call;
      } else if (ev.type === 'tool/result') {
        var target = d.message && d.message.toolCallId ? (openCalls[String(d.message.toolCallId)] || null) : null;
        var rtext = textOfBlocks(d.message && d.message.content);
        if (target) { target.result = rtext; target.isError = d.message.isError === true || !!(d.error); }
        else items.push({ kind: 'tool-result-orphan', op: '', text: rtext, seq: ev.seq, ts: ev.time, isError: !!(d.error) });
      }
    });
    return items;
  }
  /** content 块 → 文本（text 块拼接；reasoning/tool-call 块不上对话面）。 */
  function textOfBlocks(blocks) {
    if (!Array.isArray(blocks)) return '';
    var out = [];
    blocks.forEach(function (b) {
      if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push(b.text);
    });
    return out.join('\n');
  }

  /** faces 绑定入口（entry.js 注入回调填充 __CC.chatFaces/__CC.termFaces 后调用）：
   *  从全局槽取 faces 建适配器并缓存；faces 未到齐=ready()=false（诚实降级，不抛错）。 */
  function bindFaces() {
    var faces = {};
    var cf = (typeof __CC !== 'undefined' && __CC.chatFaces) || null;
    var tf = (typeof __CC !== 'undefined' && __CC.termFaces) || null;
    if (cf && cf.sessions) faces.sessions = cf.sessions;
    if (tf && tf.webTerminals) faces.webTerminals = tf.webTerminals;
    var adapter = createAdapter(faces);
    __CC.chatAdapter = adapter;
    return adapter;
  }

  /** mergeCurrentSession 结构化合并纯映射（E5b 收口，console-adoption.md §1.35——§1.11 补注④
   *  余量摘除；lineback 裁决 2026-11-26：已有 status 块=键级合并不跳过，零盲写不变）。
   *  输入=Agent 文档正文原文+新身份（sessionId/startedAt）；输出={ok, content}——
   *  ok=false=预读口径缺席（无 metadata.name / status 块含 tab 缩进=保守拒绝）=诚实降级；
   *  零盲写红线=纯文本手术非 yaml 重编码：status 块外字节恒等，块内未知键原样保留，
   *  currentSession 只重写 id/startedAt/docsLoaded 三键（同参回放=幂等 noop 词形）。
   *  分支：①无 status 块=文末追加最小块；②有块无 currentSession=块内追加；
   *  ③有 currentSession=子块三键重写（其余子行保序）。 */
  function mergeCurrentSession(content, sessionId, startedAt) {
    var text = String(content == null ? '' : content);
    if (!/(^|\n)\s*name:\s*\S/.test(text)) return { ok: false, content: text };
    if (/^[\t]|\n[\t]/.test(text)) return { ok: false, content: text };
    var lines = text.split('\n');
    var si = -1;
    for (var i = 0; i < lines.length; i++) { if (/^status:(\s|#|$)/.test(lines[i])) { si = i; break; } }
    var mk = function () {
      return ['    id: ' + sessionId, '    startedAt: ' + startedAt, '    docsLoaded: []'];
    };
    if (si < 0) {
      return { ok: true, content: lines.join('\n').replace(/\n?$/, '\n') + ['status:', '  currentSession:'].concat(mk()).join('\n') + '\n' };
    }
    var bi = si + 1;
    while (bi < lines.length && (lines[bi] === '' || /^[ \t]/.test(lines[bi]))) bi++;
    var headLines = lines.slice(0, si);
    var blockLine = lines[si];
    var bodyLines = lines.slice(si + 1, bi);
    var tailLines = lines.slice(bi);
    var ci = -1;
    for (var k = 0; k < bodyLines.length; k++) { if (/^  currentSession:(\s|#|$)/.test(bodyLines[k])) { ci = k; break; } }
    if (ci < 0) {
      var nb = bodyLines.slice();
      while (nb.length && nb[nb.length - 1] === '') nb.pop();
      return { ok: true, content: headLines.concat([blockLine]).concat(nb).concat(['  currentSession:']).concat(mk()).concat(tailLines).join('\n') };
    }
    var cj = ci + 1;
    while (cj < bodyLines.length && (bodyLines[cj] === '' || /^(?:    |  [^\s])[^\n]*$/.test(bodyLines[cj]))) cj++;
    var csHead = bodyLines.slice(0, ci);
    var csBody = bodyLines.slice(ci + 1, cj);
    var csTail = bodyLines.slice(cj);
    var unknown = csBody.filter(function (l) { return !/^    (id|startedAt|docsLoaded):/.test(l); });
    while (unknown.length && unknown[unknown.length - 1] === '') unknown.pop();
    var merged = csHead.concat(['  currentSession:']).concat(unknown).concat(mk()).concat(csTail);
    return { ok: true, content: headLines.concat([blockLine]).concat(merged).concat(tailLines).join('\n') };
  }

  __CC.chat = {
    runnerList: runnerList,
    runnerById: runnerById,
    isConnectorOp: isConnectorOp,
    declaredOpsOf: declaredOpsOf,
    attributedSessions: attributedSessions,
    sessionIdsOfRefs: sessionIdsOfRefs,
    createAdapter: createAdapter,
    projectTranscript: projectTranscript,
    textOfBlocks: textOfBlocks,
    mergeCurrentSession: mergeCurrentSession,
    bindFaces: bindFaces
  };
})();
