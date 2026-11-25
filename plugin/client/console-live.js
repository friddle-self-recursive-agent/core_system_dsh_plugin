// console-live.js —— E2 cored 读面真数据层（console-adoption.md §5 规则 2：渲染数据无双源——
// 全部来自 cored 读面+ops DB；console 不自建持久状态）。
// 通路：浏览器 → dsh web（同源）→ 宿主插件代理路由 /core-console/api（src/index.ts 注册，
// connection 鉴权栅栏 requestRejection 同 open-in-app 口径）→ cored 只读 GET 面（cored-bridge.md §2）。
// 本层只发 GET：写路径唯一入口是 cored POST /v1/apply（缺省关闭），客户端零旁路。
// 退化纪律（§1.4）：读面不可达=骨架空态+轻提示，不白屏不报错块——连接态灯（conn-monitor）已承载失联三色。
(function () {
  'use strict';

  var PREFIX = '/core-console/api';
  var REFRESH_MS = 15000; // 稳态轻刷新窗（读面快照老化阈值；不替代连接态灯的活性判定）

  var state = {
    status: 'idle', // idle | loading | ok | degraded
    at: 0,          // 最近一次成功装载时刻（Date.now）
    err: '',        // 退化原因（degraded 时非空）
    kinds: [],      // /v1/scheme/kinds 载荷（name/storage/spec/relations/...）
    objects: {},    // kind -> [{kind,name,scope,resourceVersion}]（瘦身引用，跨 scope 枚举）
    drafts: [],     // /v1/drafts 载荷（kind/scope/name/fieldManager/baseResourceVersion/updatedAt/bytes）
    runs: [],       // /v1/workflows/runs.runs（触发面 run 投影）
    runMeta: null,  // runs 面计数（started/dropped/advances/braked/capped）
    events: [],     // /v1/events 归档行（最新优先；event_log=Welcome 最近重要事件持久源）
    instanceStatus: {}, // ServiceInstance key -> {phase, observedGeneration}（status 回写在正文，逐个现读）
    docContent: {},     // 'Kind/scope/name' -> content 原文（E5：Agent/ServiceDesc/ConnectorOps 小对象现读——声明集/归属/owner 解析）
    triggers: null, // /v1/triggers（received/dropped/records——触发留痕，进程内投影）
    wfAgg: null,    // /v1/workflows 聚合面（v0.37 console 读面第二段——E3 运行管理数据面）
    deliveries: null,
    wakes: null,
    proposals: [],  // /v1/proposals 需求提案读面（v0.51 能力 B——console-adoption.md §1.24）
    dispatches: [], // /v1/agents/dispatches 派单受理投影（v0.50/0.56——积压族第三源 approval.state=pending）
    inbox: null,    // /v1/inbox 通知中心收件箱投影（v0.56 R-10——§1.25「待你处理」页面兜底）
    sessions: null, // /v1/sessions 会话活性查询面（v0.54 KI-003——watchdog 投影）
    metrics: [],
    pending: false
  };

  function api(p) { return PREFIX + '/' + String(p).replace(/^\/+/, ''); }
  function jget(p) {
    return fetch(api(p), { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json();
      });
  }
  function refList(k) { return (state.objects[k] || []); }

  /** console Apply（E3 写通路：POST /core-console/apply——宿主转发 cored POST /v1/apply
   *  唯一写入口，主体由宿主注入浏览器不携带；判别联合返回，不抛错）。 */
  function apply(payload) {
    return fetch('/core-console/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) return { ok: false, status: r.status, error: String(body && body.error || ('HTTP ' + r.status)) };
        return { ok: true, data: body };
      });
    }, function (e) {
      return { ok: false, status: null, error: String((e && e.message) || e) };
    });
  }

  /** agent-comm 读面（E6：GET /core-console/comm——插件宿主 comm 落账快照，
   *  连接页 agent-comm 详情=op 面/拓扑/消息日志数据源；token 值永不出现于载荷）。 */
  function comm() {
    return fetch('/core-console/comm', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json();
      });
  }

  /** 事件窗向后翻页（E7 虚拟滚动大列表：until 游标=严格早于，半开窗 [since,until)——
   *  cored v0.39 读面六参；limit=500 收敛口径（opslog.MaxEventLimit 同值）；返回 {count,events}）。 */
  function eventsPage(until) {
    return jget('v1/events?limit=500' + (until ? '&until=' + encodeURIComponent(until) : ''));
  }

  /* ===== 设计文档面（v0.52 能力 A——console 屏幕 6 直接编辑设计文档 md → Apply → git commit；
   *  cored-bridge.md §2.4。读面走既有只读代理 GET /v1/design-docs*（HEAD 权威零缓存）；
   *  写面走宿主路由 /core-console/design-docs（apply 主体宿主注入+draft 落稿/弃稿——
   *  白名单/lint/乐观锁三闸门在 cored 侧，客户端零旁路）。 ===== */
  /** 设计文档清单（{count, repos:[{name,files:[…]}], docs:[…]}；未装配=503 → 诚实降级）。 */
  function designDocs() { return jget('v1/design-docs'); }
  /** 设计文档 URL 路径段（repo + 逐段转义——路径段含 '.' 等字符统一转义）。 */
  function ddPath(repo, path) {
    return 'v1/design-docs/' + encodeURIComponent(repo) + '/' +
      String(path).split('/').map(encodeURIComponent).join('/');
  }
  /** 单文档现读：{repo, path, sha, bytes, content, lastCommit:{sha,subject,at}}（HEAD 权威，渲染即现读）。 */
  function designDoc(repo, path) { return jget(ddPath(repo, path)); }
  /** 应用史投影（apply_log 行——obj=DesignDoc/<repo>/<path>；result=ok|noop|denied|conflict）。 */
  function designHistory(repo, path) { return jget(ddPath(repo, path).replace('v1/design-docs/', 'v1/design-docs/history/')); }
  /** 草稿现读（kind=DesignDoc, scope=<repo>, name=<path>；无稿=404 → 判别联合）。 */
  function designDraft(repo, path) {
    return jget(ddPath(repo, path).replace('v1/design-docs/', 'v1/design-docs/draft/'))
      .then(null, function (e) { if (e && e.status === 404) return null; throw e; });
  }
  /** 落稿 upsert（POST /core-console/design-docs/draft——fieldManager 客户端缺主=宿主补缺省）。 */
  function designDraftPut(payload) {
    return postJson('/core-console/design-docs/draft', payload);
  }
  /** 弃稿（DELETE /core-console/design-docs/draft/{repo}/{path...}）。 */
  function designDraftDelete(repo, path) {
    return fetch('/core-console/design-docs/draft/' + encodeURIComponent(repo) + '/' +
      String(path).split('/').map(encodeURIComponent).join('/'),
      { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok && r.status !== 404) return { ok: false, status: r.status, error: String(body && body.error || ('HTTP ' + r.status)) };
          return { ok: true, status: r.status, data: body };
        });
      }, function (e) { return { ok: false, status: null, error: String((e && e.message) || e) }; });
  }
  /** 设计文档 Apply（POST /core-console/design-docs——dry-run/真落库；fromDraft=true 时
   *  content 须缺省；返回判别联合，409/403/400 状态码照传=三闸门判定面）。 */
  function designApply(payload) { return postJson('/core-console/design-docs', payload); }

  /* ===== 对话式录入与准入预检面（v0.53 能力 D + R-UX-1/R-UX-2——cored-bridge.md §2.5） ===== */
  /** 对话推进与字段卡双向同步（POST /core-console/intake/turn）。 */
  function intakeTurn(payload) { return postJson('/core-console/intake/turn', payload); }
  /** 提交节点对象生成与三重 dry-run 预检（POST /core-console/intake/generate）。 */
  function intakeGenerate(payload) { return postJson('/core-console/intake/generate', payload); }
  /** 会话留痕清单（GET /v1/intake/sessions——对话原文不入公共库）。 */
  function intakeSessions() { return jget('v1/intake/sessions'); }
  /** 单条会话留痕（GET /v1/intake/sessions/{id}）。 */
  function intakeSession(id) { return jget('v1/intake/sessions/' + encodeURIComponent(id)); }
  /** 按名称取已装载的 Kind 描述（含 R-UX-2 widgets 投影）。 */
  function kindOf(name) {
    var list = state.kinds || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }
  /** POST 判别联合（不抛错——写通路统一返回形态，与 apply() 同款）。 */
  function postJson(p, payload) {
    return fetch(p, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) return { ok: false, status: r.status, error: String(body && body.error || ('HTTP ' + r.status)), body: body };
        return { ok: true, status: r.status, data: body };
      });
    }, function (e) {
      return { ok: false, status: null, error: String((e && e.message) || e) };
    });
  }

  /** 草稿弃稿（E6 审批驳回=弃稿：DELETE /core-console/drafts/{kind}/{name}?scope=
   *  ——写路径仍唯一经宿主路由；零文档面动作，不发明反向写路径）。 */
  function draftDelete(kind, name, scope) {
    return fetch('/core-console/drafts/' + encodeURIComponent(kind) + '/' + encodeURIComponent(name) +
      (scope ? '?scope=' + encodeURIComponent(scope) : ''), { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok && r.status !== 404) return { ok: false, status: r.status, error: String(body && body.error || ('HTTP ' + r.status)) };
          return { ok: true, status: r.status, data: body };
        });
      }, function (e) {
        return { ok: false, status: null, error: String((e && e.message) || e) };
      });
  }

  /** 全量装载：scheme kinds → 逐 kind 对象枚举 + 四投影面 + 归档事件。任一子面失败=整轮退化（不半装载——
   *  投影一致性优先于可得性；连接态灯已把失联作常态设计，恢复后下轮整装替换）。 */
  function load() {
    if (state.pending) return state.cur || Promise.resolve();
    state.pending = true;
    state.status = state.at ? 'ok' : 'loading'; // 首装=loading（骨架），重装期间保旧面（§1.4 基线渲染）
    var cur = Promise.resolve()
      .then(function () { return jget('v1/scheme/kinds'); })
      .then(function (body) {
        state.kinds = body.kinds || [];
        return Promise.all(state.kinds.map(function (kd) {
          return jget('v1/objects/' + encodeURIComponent(kd.name)).catch(function () { return { objects: [] }; });
        })).then(function (all) {
          var m = {};
          state.kinds.forEach(function (kd, i) { m[kd.name] = (all[i] && all[i].objects) || []; });
          state.objects = m;
          // ServiceInstance status 回写在正文（InSync 率口径的数据面）：实例在册才逐个现读。
          var insts = m.ServiceInstance || [];
          state.instanceStatus = {};
          return Promise.all(insts.map(function (o) {
            return jget('v1/objects/ServiceInstance/' + encodeURIComponent(o.name) +
              (o.scope ? '?scope=' + encodeURIComponent(o.scope) : ''))
              .then(function (b) {
                var c = String(b.content || '');
                var ph = /phase:\s*([A-Za-z]+)/.exec(c);
                var og = /observedGeneration:\s*([0-9]+)/.exec(c);
                state.instanceStatus[o.kind + '/' + o.scope + '/' + o.name] = {
                  phase: ph ? ph[1] : '',
                  observedGeneration: og ? Number(og[1]) : null,
                };
              }).catch(function () { /* 单实例正文不可读=该实例无相位投影，不放大为整轮退化 */ });
          }));
        });
      })
      .then(function () {
        // E5 小对象现读（Agent/ServiceDesc/ConnectorOps）：agent 声明集/归属链/owner 解析数据面。
        // R-6（adoption §1.20）：授权面小对象 Role/Group 同批现读——permissions 屏「Role 授权矩阵」
        // spec 现读数据源（数量小——全量现读不拖库，limit 口径不适用）。
        state.docContent = {};
        var smallKinds = ['Agent', 'ServiceDesc', 'ConnectorOps', 'Role', 'Group'];
        var jobs = [];
        smallKinds.forEach(function (k) {
          (state.objects[k] || []).forEach(function (o) {
            jobs.push(jget('v1/objects/' + encodeURIComponent(k) + '/' + encodeURIComponent(o.name) +
              '?scope=' + encodeURIComponent(o.scope)).then(function (b) {
                state.docContent[k + '/' + o.scope + '/' + o.name] = String(b.content || '');
              }).catch(function () { /* 单对象不可读=该对象无声明投影，不放大为整轮退化 */ }));
          });
        });
        return Promise.all(jobs);
      })
      .then(function () {
        return Promise.all([
          jget('v1/workflows/runs').then(function (r) { state.runs = r.runs || []; state.runMeta = r; }),
          jget('v1/workflows').then(function (r) { state.wfAgg = r; }),
          jget('v1/triggers').then(function (r) { state.triggers = r; }),
          jget('v1/events?limit=500').then(function (r) { state.events = r.events || []; }),
          jget('v1/drafts').then(function (r) { state.drafts = r.drafts || []; }),
          jget('v1/notifications/deliveries').then(function (r) { state.deliveries = r; }).catch(function () { state.deliveries = null; }),
          jget('v1/agents/wakes').then(function (r) { state.wakes = r; }).catch(function () { state.wakes = null; }),
          jget('v1/proposals').then(function (r) { state.proposals = r.proposals || []; }).catch(function () { state.proposals = []; }),
          jget('v1/agents/dispatches').then(function (r) { state.dispatches = r.dispatches || []; }).catch(function () { state.dispatches = []; }),
          jget('v1/inbox').then(function (r) { state.inbox = r; }).catch(function () { state.inbox = null; }),
          jget('v1/sessions').then(function (r) { state.sessions = r; }).catch(function () { state.sessions = null; }),
          jget('v1/metrics').then(function (r) { state.metrics = r.metrics || []; }),
        ]);
      })
      .then(function () {
        state.status = 'ok'; state.at = Date.now(); state.err = '';
      })
      .catch(function (e) {
        state.status = 'degraded'; state.err = String((e && e.message) || e);
      })
      .then(function () {
        state.pending = false;
        if (typeof __CC.live.onChange === 'function') __CC.live.onChange();
        return state.status;
      });
    state.cur = cur;
    return cur;
  }

  /** 进入真数据屏（Welcome/系统树）的装载入口：首装即拉，稳态超窗轻刷新，装载中不重入。 */
  function ensure() {
    if (state.status === 'idle') { load(); return true; }
    if (state.status === 'ok' && Date.now() - state.at > REFRESH_MS) { load(); return true; }
    return state.status === 'ok';
  }

  /** 单对象读取（get 载荷含 content 原文；对象键=(kind,scope,name)）。不缓存——渲染即现读（git 后端权威）。 */
  function fetchObject(kind, scope, name) {
    var p = 'v1/objects/' + encodeURIComponent(kind) + '/' + encodeURIComponent(name) +
      (scope ? '?scope=' + encodeURIComponent(scope) : '');
    return jget(p);
  }

  /** 小对象原文现读（E5）：key='Kind/scope/name'；缺席=空串（诚实空态）。 */
  function docContent(kind, scope, name) {
    return state.docContent[kind + '/' + (scope || '') + '/' + name] || '';
  }
  /** 按名字找对象引用行（跨 scope）：{kind,name,scope,resourceVersion}|null。 */
  function refByName(kind, name) {
    var list = state.objects[kind] || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  __CC.live = {
    state: state,
    load: load,
    ensure: ensure,
    fetchObject: fetchObject,
    apply: apply,
    draftDelete: draftDelete,
    comm: comm,
    eventsPage: eventsPage,
    designDocs: designDocs,
    designDoc: designDoc,
    designHistory: designHistory,
    designDraft: designDraft,
    designDraftPut: designDraftPut,
    designDraftDelete: designDraftDelete,
    designApply: designApply,
    intakeTurn: intakeTurn,
    intakeGenerate: intakeGenerate,
    intakeSessions: intakeSessions,
    intakeSession: intakeSession,
    kindOf: kindOf,
    get: jget,
    refs: refList,
    docContent: docContent,
    refByName: refByName,
    onChange: null
  };
})();
