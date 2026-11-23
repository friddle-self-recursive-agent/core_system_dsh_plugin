// console-scenario.js —— E7 场景面纯函数层（console-adoption.md §1.14）：
// tag 现读解析 / involved scope 匹配 / 归档窗游标合并 / 合成压测窗——零 DOM 零 fetch，
// 入参全部来自调用方（live 读面快照/对象正文原文）；渲染数据无双源红线不受影响
// （本层只是投影函数，不持有状态不落库）。node --test 可直接沙箱执行（挂 __CC.scenario）。
(function () {
  'use strict';
  var SC = {};

  /** tagsOf 对象正文检索元数据现读（scheme.yaml conventions.tags：spec.metadata.tags "?[]string"；
   *  fallback metadata.tags）。支持 flow [a, b] 与 block 列表两种 YAML 形态 + 内联 map {tags: [..]}。
   *  非声明即空集（docsRoot 现状零 tag=诚实空集，不冒充）。去重保序；引号/空白剥离。 */
  function tagsOf(content) {
    var text = String(content || '');
    var raw = [];
    var m = /(^|\n)\s*tags:\s*\[([^\]]*)\]/.exec(text) || /tags:\s*\[([^\]]*)\]/.exec(text);
    if (m) {
      // 引号感知分词（引号内逗号不切——"q, x" 是一个 token；简单 token 口径的无引号项照常）
      raw = (m[2] || m[1]).match(/"[^"]*"|'[^']*'|[^,]+/g) || [];
    } else {
      var b = /(^|\n)\s*tags:\s*\n((?:[ \t]*-[^\n]*(?:\n|$))+)/.exec(text);
      if (b) raw = b[2].split(/\n/).map(function (l) { return l.replace(/^\s*-\s*/, ''); });
    }
    var out = [];
    (raw || []).forEach(function (x) {
      var t = String(x == null ? '' : x).replace(/^["'\s]+/, '').replace(/["'\s,]+$/, '');
      if (t && out.indexOf(t) < 0) out.push(t);
    });
    return out;
  }

  /** scopeOfInvolved 归档行 involved（"Kind/scope/name" 三段）中段=scope；非三段=空串
   *  （involved 未标注的事件不归属任何系统——场景面如实排除，不猜）。 */
  function scopeOfInvolved(inv) {
    var segs = String(inv || '').split('/');
    return segs.length >= 3 ? segs[segs.length - 2] : '';
  }

  /** evInScope 归档行是否属于系统（scope=系统裸名或 systems/<name> 前缀形——
   *  inScopeObjects 同一匹配口径，场景面与系统树不两套真相）。 */
  function evInScope(e, sysName) {
    if (!e || !sysName) return false;
    var sc = scopeOfInvolved(e.involved);
    return !!sc && (sc === sysName || sc === 'systems/' + sysName);
  }

  /** mergeEvents 相邻页合并：按 eventId 去重保序（base=最新优先，page=更早一页——
   *  游标语义下理论零重叠，幂等去重为防御面）。 */
  function mergeEvents(base, page) {
    var seen = {};
    (base || []).forEach(function (e) { if (e && e.eventId) seen[e.eventId] = true; });
    var out = (base || []).slice();
    (page || []).forEach(function (e) {
      if (e && e.eventId && !seen[e.eventId]) { seen[e.eventId] = true; out.push(e); }
    });
    return out;
  }

  /** mountsOf Agent 声明正文挂载现读：词表前缀（connector-ops/providers/refs）→ kind 映射。
   *  返回 [{kind, name, ref}]（ref=声明原文引用形，溯源=声明正文行）；正文缺席=空集。 */
  function mountsOf(content) {
    var vocab = { 'connector-ops': 'ConnectorOps', 'provider': 'Provider', 'providers': 'Provider', 'ref': 'Ref', 'refs': 'Ref' };
    var out = [], seen = {};
    var re = /([A-Za-z][A-Za-z0-9-]*)\/([A-Za-z0-9-_.]+)/g, m;
    var text = String(content || '');
    while ((m = re.exec(text)) !== null) {
      var kind = vocab[m[1]];
      if (!kind) continue;
      var key = kind + '/' + m[2];
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ kind: kind, name: m[2], ref: m[0] });
    }
    return out;
  }

  /** agentMountsKind Agent 是否挂载某对象（挂载行现读命中）。 */
  function agentMountsKind(content, kind, name) {
    var ms = mountsOf(content);
    for (var i = 0; i < ms.length; i++) if (ms[i].kind === kind && ms[i].name === name) return ms[i];
    return null;
  }

  /** synEvents 合成压测窗（E7 千级虚拟滚动验收载荷——客户端合成展示层：
   *  不入归档不入聚合面板，行带 synthetic 标记+「合成」tag+不可点；确定性种子=机械对账可复现）。
   *  类型族取自真实归档在册类型（泳道配色同款）；involved=Synthetic/probe/<i>（非真实对象——
   *  不与文档面键空间相交）。 */
  function synEvents(n, seed) {
    var types = ['DocApplied', 'Escalate', 'ApprovalNeeded', 'ExternalChanged', 'ReconcileTick'];
    var levels = ['info', 'info', 'info', 'warn', 'error'];
    var k = seed || 43;
    function rnd() { k = (k * 1103515245 + 12345) & 0x7fffffff; return k / 0x7fffffff; }
    var out = [];
    var now = Date.now();
    for (var i = 0; i < n; i++) {
      var ti = types[(rnd() * types.length) | 0];
      out.push({
        eventId: 'syn-' + (seed || 43) + '-' + i,
        type: ti,
        source: 'synthetic',
        involved: 'Synthetic/probe/' + i,
        dedupKey: 'synthetic:probe:' + i,
        level: levels[(rnd() * levels.length) | 0],
        routedTo: 'synthetic-window',
        ts: new Date(now - i * 1500 - (rnd() * 900 | 0)).toISOString(),
        synthetic: true
      });
    }
    return out;
  }

  SC.tagsOf = tagsOf;
  SC.scopeOfInvolved = scopeOfInvolved;
  SC.evInScope = evInScope;
  SC.mergeEvents = mergeEvents;
  SC.mountsOf = mountsOf;
  SC.agentMountsKind = agentMountsKind;
  SC.synEvents = synEvents;
  SC.EV_PAGE_LIMIT = 500; // cored opslog.MaxEventLimit 收敛口径同值（读面防拖库）
  __CC.scenario = SC;
})();
