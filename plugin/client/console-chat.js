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

  /** 会话适配器：faces={sessions, remote, webTerminals}（dsh client 服务面，全部可注入假体）。
   *  faces 可缺席（headless/未装配宿主）——ready()=false，调用面返回诚实降级不抛错。 */
  function createAdapter(faces) {
    faces = faces || {};
    var sessions = faces.sessions || null;
    var remote = faces.remote || null;
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
    /** 转录事件页读面（remote.session.page；records=[{type,event}]）→ 投影行。
     *  faces 缺席/读面失败=诚实降级（ok:false+error），不冒充空转录。 */
    function page(sessionId, opt) {
      opt = opt || {};
      if (!remote || typeof remote !== 'object') {
        return Promise.resolve({ ok: false, error: '宿主转录读面缺席（ctx.remote 未在册）' });
      }
      var arg = { address: { sessionId: String(sessionId) }, maxMessages: opt.maxMessages || 200 };
      if (opt.throughSeq !== undefined) arg.throughSeq = opt.throughSeq;
      var p;
      try {
        if (!remote.session || typeof remote.session.page !== 'function') {
          return Promise.resolve({ ok: false, error: '宿主转录读面缺席（remote.session 未在册）' });
        }
        p = remote.session.page(arg, undefined);
      } catch (e) { return Promise.resolve({ ok: false, error: '转录读面不可用: ' + String((e && e.message) || e) }); }
      return Promise.resolve(p).then(
        function (result) {
          if (!result || !result.ok) return { ok: false, error: String((result && result.error && (result.error.message || result.error.code)) || 'page 读面失败') };
          return { ok: true, records: (result.value && result.value.records) || [], hasMore: !!(result.value && result.value.hasMore) };
        },
        function (e) { return { ok: false, error: String((e && e.message) || e) }; }
      );
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
      create: create, prompt: prompt, rename: rename, page: page, terminals: terminals, SOURCE: SOURCE
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
    if (cf && cf.remote) faces.remote = cf.remote;
    if (tf && tf.webTerminals) faces.webTerminals = tf.webTerminals;
    var adapter = createAdapter(faces);
    __CC.chatAdapter = adapter;
    return adapter;
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
    bindFaces: bindFaces
  };
})();
