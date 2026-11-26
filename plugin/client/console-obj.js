/* console-obj.js —— 通用对象工作台（core_design rule/rule_ux.md R-UX-7 + console-ui.md §14.5 落地，
 * 2026-11-26 用户裁决）。一个组件服务所有对象（文档/会话/Workflow/系统/实例/事件/提案/审批）：
 * 六片固定=标签 / 适用规则 / 上下文 / 操作 / 内容 / scheme；缺片显式「无」不装假（无适用规则/
 * 暂无标签/未装配——诚实空态词形）；对话是一等片=工作台右侧常驻会话栏（同一 dsh 会话机制投影，
 * 深链 chat/<agent> 不跳页不丢上下文——锚点随对象 tag）。
 * 单一真相（§14.5 硬线）：片内数据全部来自 Scheme kinds + 对象枚举 + 对象正文现读 + 命中规则原文
 * （零前端自建状态；零新端点——全走既有 GET 面）。标识符全可点（既有硬线）。
 * 规则命中=确定性纯函数 rulesFor()（kind/scope/tag 三路：对象正文提到 rule 文档主题词=词形命中；
 * 对象 kind/scope/tag 与规则文档 tag 交集=标签命中；scope 名出现在规则原文=scope 命中）——
 * 命中来源显式标注（§14.5「显式列命中来源」）；规则文档族索引由宿主注入（同 console-ctx 范式，
 * 模块零直接网络依赖）。tagType 分组=正文 tags 现读（SCN.tagsOf 同源解析——scheme conventions
 * spec.metadata.tags），词表 tagType 归组缺省=「未分组」不冒充。
 * scheme 片=kinds 载荷有 spec → 只读字段卡（md.yamlToCards）+「YAML」折叠次级（R-UX-2 映射）；
 * 对象正文=markdown 类渲染原文（R-UX-4）+ 声明类字段卡（同一渲染核——零第二套渲染器）。
 * 安全红线（同 console-md.js）：一切动态文本先 HTML 转义再入卡，零原文直插。
 * 词汇纪律（R-UX-3）：用户可见文案零工程词形；本模块注释与字符串同步守约。 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* ---------- 对象键与缓存（键='Kind|scope|name'——与 console-ctx 同形） ---------- */
  function keyOf(kind, scope, name) { return kind + '|' + (scope || 'global') + '|' + (name || ''); }

  /* ---------- tagType 分组（§14.5 标签片） ----------
   * 词表归组：tag→tagType 映射来自规则文档族索引 tags（宿主注入）；未命中词表=「未分组」。
   * 返回 [{type, tags:[…]}]，type 稳定排序（未分组恒殿后），tags 字典序。 */
  function tagGroups(tags, vocab) {
    var V = vocab || {};
    var m = {};
    (tags || []).forEach(function (t) {
      var type = V[t] || '未分组';
      (m[type] = m[type] || []).push(t);
    });
    return Object.keys(m).sort(function (a, b) {
      if (a === '未分组') return 1;
      if (b === '未分组') return -1;
      return a < b ? -1 : 1;
    }).map(function (type) { return { type: type, tags: m[type].sort() }; });
  }

  /* ---------- 规则命中（§14.5 规则片——确定性纯函数，机械直测口径） ----------
   * obj: {kind, scope, name, content}；rules: [{repo, path, name, title, tags, content}]
   * （宿主注入 loader 现读规则文档族；content 缺席=降级「规则索引暂不可达」）。
   * 返回 {hits:[{ref, name, why:[来源…], anchor}], degraded, reason, scanned}。
   * 三路来源（显式标注）：kind=对象 kind 在规则原文提到；tag=对象 tag 与规则 tag 交集；
   * scope=对象 scope 名在规则原文提到。theme=对象 name/标题词与规则主题词同族（词形交叉引用）。
   * 阈值纪律：≥1 路命中即列；零命中=空数组（「无适用规则」诚实空态，不兜底罗列全部规则）。 */
  function rulesFor(obj, rules) {
    if (!rules) return { hits: [], degraded: true, reason: '规则文档族索引暂不可达——命中判定暂缺（不冒充无适用）。', scanned: 0 };
    var o = obj || {};
    var text = String(o.content || '');
    var low = text.toLowerCase();
    var nameLow = String(o.name || '').toLowerCase();
    var scopeLow = String(o.scope || '').toLowerCase();
    var kindLow = String(o.kind || '').toLowerCase();
    var objTags = o.tags || [];
    var out = [];
    rules.forEach(function (r) {
      if (!r || !r.path) return;
      var base = String(r.path).replace(/^.*\//, '').replace(/\.md$/, '');
      var rlow = String(r.content || '').toLowerCase();
      var rtags = r.tags || [];
      var why = [];
      var tagHit = objTags.filter(function (t) { return rtags.indexOf(t) >= 0; });
      if (tagHit.length) why.push('标签「' + tagHit.join('、') + '」同组');
      if (kindLow && rlow.indexOf(kindLow) >= 0) why.push('规则原文提及 ' + o.kind);
      if (scopeLow && scopeLow !== 'global' && scopeLow !== 'builtin' && rlow.indexOf(scopeLow) >= 0) why.push('规则原文提及 ' + o.scope);
      var nameStem = nameLow.replace(/[-_].*$/, '');
      if (nameStem && nameStem.length >= 3 && rlow.indexOf(nameStem) >= 0) why.push('规则原文提及 ' + nameStem);
      if (base && low && low.indexOf(base.toLowerCase()) >= 0) why.push('对象正文引用 ' + base);
      if (!why.length) return;
      out.push({
        ref: (r.repo || 'core_design') + '/' + r.path + '#' + base,
        name: base,
        why: why,
        anchor: base
      });
    });
    out.sort(function (a, b) { return b.why.length - a.why.length || (a.name < b.name ? -1 : 1); });
    return { hits: out.slice(0, 8), degraded: false, reason: '', scanned: rules.length };
  }

  /* ---------- 必填段完成度（§14.5 scheme 片——文档类无 spec 时的结构段卡） ----------
   * requiredSections: ['a','b'] 与正文「## a」标题对照 → [{name, done}]；无注册=空数组（诚实空态）。 */
  function sectionCompletion(content, requiredSections) {
    var secs = requiredSections || [];
    if (!secs.length) return [];
    var heads = {};
    String(content || '').split('\n').forEach(function (line) {
      var m = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line);
      if (m) heads[m[1].toLowerCase()] = true;
    });
    return secs.map(function (s) {
      var key = String(s).toLowerCase();
      var done = !!heads[key] || String(content || '').toLowerCase().indexOf(key) >= 0;
      return { name: String(s), done: done };
    });
  }

  /* ---------- ctx pack 摘要（§14.5 上下文片——纯函数，会话数据宿主注入） ----------
   * sess: null=本会话未装配；{sessionId, tagSig, chunks:[{ref,hash,tokens}], …}。
   * 返回人话摘要行（不上工程词形——tokens 归并为「规模」档位）。 */
  function ctxSummary(sess) {
    if (!sess || !sess.sessionId) return { state: 'none', text: '本会话未装配——可在会话栏就地开聊（上下文随后自动装配）。' };
    var n = (sess.chunks || []).length;
    var toks = 0;
    (sess.chunks || []).forEach(function (c) { toks += Number(c.tokens || 0); });
    var scale = toks > 8000 ? '较大' : toks > 2000 ? '中等' : '较小';
    return {
      state: 'ok',
      text: '已装配 ' + n + ' 段（' + scale + '）' + (sess.tagSig ? ' · 指纹 ' + String(sess.tagSig).slice(0, 12) : ''),
      sessionId: sess.sessionId,
      chunks: sess.chunks || []
    };
  }

  /* ---------- scheme 声明投影（§14.5 scheme 片） ----------
   * kindReg: /v1/scheme/kinds 载荷行 {name, builtin, storage, spec, relations, widgets}——
   * 投影为声明卡 yaml（md.yamlToCards 同一渲染核）；空 spec=空串（该 kind 无 scheme，整片不显示）。 */
  function kindRegYaml(k) {
    if (!k) return '';
    var L = ['kind: ' + (k.name || '')];
    if (k.builtin) L.push('builtin: true');
    if (k.storage) L.push('storage: ' + k.storage);
    var spec = k.spec || {};
    var keys = Object.keys(spec);
    if (keys.length) {
      L.push('spec:');
      keys.forEach(function (f) { L.push('  ' + f + ': ' + String(spec[f])); });
    }
    var rel = k.relations || {};
    var rk = Object.keys(rel);
    if (rk.length) {
      L.push('relations:');
      rk.forEach(function (f) { L.push('  ' + f + ': ' + String(rel[f])); });
    }
    return L.join('\n');
  }

  /* ---------- 规则文档族索引（宿主注入 loader——同 console-ctx 范式，模块零直接网络依赖） ----------
   * loader: function() → Promise<{rules:[{repo,path,title,tags,content}], tagTypes:{tag→type}}|null>
   * 会话内缓存 120s（同 ctx 索引口径）；失败=降级不缓存失败态。 */
  var ruleLoader = null;
  var tagLoader = null;
  var traceLoader = null;
  var findLoader = null;
  var ridx = { rules: null, at: 0, promise: null };
  var tidx = { map: null, at: 0, promise: null };
  function setRuleDocsLoader(fn) { ruleLoader = fn; ridx = { rules: null, at: 0, promise: null }; }
  function setTagTypesLoader(fn) { tagLoader = fn; tidx = { map: null, at: 0, promise: null }; }
  function setTraceLoader(fn) { traceLoader = fn; }
  function setContextFindLoader(fn) { findLoader = fn; }
  function ensureTrace(kind, scope, name) {
    if (!traceLoader) return Promise.resolve(undefined);
    return Promise.resolve().then(function () { return traceLoader(kind, scope || 'global', name); }).catch(function () { return null; });
  }
  function ensureRelated(q, tags) {
    if (!findLoader) return Promise.resolve(undefined);
    return Promise.resolve().then(function () { return findLoader(q || '', tags || []); }).then(function (b) {
      if (!b) return null;
      return Array.isArray(b) ? b : (b.hits || []);
    }, function () { return null; });
  }
  function ensureRules() {
    if (ridx.rules && (Date.now() - ridx.at) < 120000) return Promise.resolve(ridx.rules);
    if (!ruleLoader) return Promise.resolve(null);
    if (!ridx.promise) {
      ridx.promise = Promise.resolve().then(ruleLoader).then(function (b) {
        ridx.rules = (b && (b.rules || b)) || null;
        ridx.at = Date.now();
        ridx.promise = null;
        return ridx.rules;
      }, function () {
        ridx.rules = null;
        ridx.promise = null;
        return null;
      });
    }
    return ridx.promise;
  }
  function ensureTagTypes() {
    if (tidx.map && (Date.now() - tidx.at) < 120000) return Promise.resolve(tidx.map);
    if (!tagLoader) return Promise.resolve(null);
    if (!tidx.promise) {
      tidx.promise = Promise.resolve().then(tagLoader).then(function (b) {
        tidx.map = (b && b.tagTypes) || null;
        tidx.at = Date.now();
        tidx.promise = null;
        return tidx.map;
      }, function () {
        tidx.map = null;
        tidx.promise = null;
        return null;
      });
    }
    return tidx.promise;
  }
  /* 强制现读（换对象进工作台不复用上一对象窗——索引缓存保留，对象面恒现读）。 */
  function refreshIndex() {
    ridx.rules = null; ridx.at = 0;
    tidx.map = null; tidx.at = 0;
    return Promise.all([ensureRules(), ensureTagTypes()]);
  }

  /* ---------- 六片渲染（纯 HTML 串——app 侧 assemble 注水；一切动态值先 esc） ---------- */
  function tagPanel(groups, opts) {
    var editRoute = opts && opts.editRoute ? String(opts.editRoute) : '';
    var editBtn = editRoute
      ? ' <button class="btn sm" data-act="go" data-go="' + esc(editRoute) + '" data-obj-tag-edit="1" title="去编辑器补充标签（经 Apply 落库）">补标</button>'
      : '';
    if (!groups || !groups.length) {
      return '<div class="ob-empty" data-obj-tags-empty="1">暂无标签——对象正文未声明 spec.metadata.tags（声明经 Apply 落库后此处现读）。' + editBtn + '</div>';
    }
    return '<div data-obj-tags="1">' + groups.map(function (g) {
      return '<div class="ob-tagrow"><span class="chip mute tiny">' + esc(g.type) + '</span> ' +
        g.tags.map(function (t) {
          return '<span class="tag click" data-act="obj-tag" data-t="' + esc(t) + '" title="看同 tag 对象">#' + esc(t) + '</span>';
        }).join(' ') + '</div>';
    }).join('') + (editBtn ? '<div class="ob-tagrow" style="margin-top:6px">' + editBtn + '</div>' : '') + '</div>';
  }
  function rulePanel(res) {
    if (res.degraded) {
      return '<div class="ob-empty" data-obj-rules-degraded="1">' + esc(res.reason) +
        ' <button class="btn sm" data-act="obj-rules-retry" data-rules-retry="1">重试加载规则索引</button></div>';
    }
    if (!res.hits.length) {
      return '<div class="ob-empty" data-obj-rules-none="1">无适用规则——按 kind/scope/tag/正文引用四路检查零命中（检查范围=' + res.scanned + ' 份规则文档）。</div>';
    }
    return '<div data-obj-rules="1">' + res.hits.map(function (h, i) {
      return '<details class="ob-rule" data-obj-rule="' + i + '"><summary>' +
        '<span class="lk mono" data-act="go" data-go="' + esc(objRouteOfRef(h.ref)) + '">' + esc(h.ref) + '</span></summary>' +
        '<div class="ob-rule-why small">' + h.why.map(function (w) { return '<span class="chip mute tiny">' + esc(w) + '</span>'; }).join(' ') + '</div></details>';
    }).join('') + '</div>';
  }
  /* ref='repo/rule/rule_ux.md#rule_ux' → 设计文档工作台深链（规则文档族=设计文档面原文可点；
   * path 段整段单次编码（%2F 形——involvedRoute 同词形，路由侧整体解回）。 */
  function objRouteOfRef(ref) {
    var m = /^([^/]+)\/(.+)\.md#/.exec(String(ref || ''));
    if (!m) return 'docs';
    return 'designdoc/' + encodeURIComponent(m[1]) + '/' + encodeURIComponent(m[2] + '.md');
  }

  /* ---------- v0.65 trace 双向追踪 + context/find 相关对象（R-DOC-9 / R-UX-7） ----------
   * docStr='Kind/scope/name'（scope 允许多段）→ 'obj/<Kind>/<scope>/<name>'；非三段=空串（不编假路由）。 */
  function traceRouteOf(docStr) {
    var s = String(docStr || '').trim();
    var segs = s.split('/');
    if (segs.length < 3 || !segs[0] || !segs[segs.length - 1]) return '';
    var kind = segs[0];
    var name = segs[segs.length - 1];
    var scope = segs.slice(1, segs.length - 1).join('/');
    if (!scope) return '';
    return 'obj/' + encodeURIComponent(kind) + '/' + encodeURIComponent(scope) + '/' + encodeURIComponent(name);
  }
  function traceEntryHtml(e) {
    var doc = String((e && e.doc) || '');
    var route = (e && e.resolved !== false) ? traceRouteOf(doc) : '';
    var link = route
      ? '<span class="lk mono" data-act="go" data-go="' + esc(route) + '">' + esc(doc) + '</span>'
      : '<span class="mono">' + esc(doc || '—') + '</span>' + (e && e.resolved === false ? ' <span class="chip mute tiny">未解析</span>' : '');
    var stale = (e && e.stale) ? ' <span class="chip warn tiny" data-trace-stale="1">待对齐</span>' : '';
    var rev = (e && e.designRev) ? ' <span class="chip mute tiny">对齐 r' + esc(e.designRev) + '</span>' : '';
    var secs = (e && Array.isArray(e.sections) && e.sections.length)
      ? ' <span class="faint tiny">[' + e.sections.map(esc).join(' · ') + ']</span>' : '';
    return '<div class="ob-trace-row">' + link + stale + rev + secs + '</div>';
  }
  function tracePanel(trace) {
    if (trace === undefined) return '';
    if (trace === null) {
      return '<div class="ob-sub" data-obj-trace-degraded="1"><span class="small faint">上下游追踪暂不可达（不冒充无关联）。</span></div>';
    }
    if (trace.missing) {
      return '<div class="ob-sub" data-obj-trace-missing="1"><span class="small faint">上下游追踪：当前对象未入上下文索引。</span></div>';
    }
    var groups = [
      { id: 'implements', label: '实现自', rows: Array.isArray(trace.implements) ? trace.implements : [] },
      { id: 'implemented_by', label: '被实现', rows: Array.isArray(trace.implemented_by) ? trace.implemented_by : [] },
      { id: 'verified_by', label: '验证关联', rows: Array.isArray(trace.verified_by) ? trace.verified_by : [] }
    ];
    var total = groups.reduce(function (n, g) { return n + g.rows.length; }, 0);
    if (!total) {
      return '<div class="ob-sub" data-obj-trace-empty="1"><span class="chip mute tiny">追踪</span> <span class="small faint">无上下游追踪声明（未声明 implements / verified_by，且暂无下游引用）。</span></div>';
    }
    return '<div class="ob-sub ob-trace" data-obj-trace="1">' + groups.map(function (g) {
      if (!g.rows.length) return '';
      return '<div class="ob-trace-grp" data-trace-dir="' + esc(g.id) + '"><div class="ob-trace-h small muted">' +
        esc(g.label) + ' <span class="chip mute tiny">' + g.rows.length + '</span></div>' +
        g.rows.map(traceEntryHtml).join('') + '</div>';
    }).join('') + '</div>';
  }
  function relatedPanel(hits, selfKey) {
    if (hits === undefined) return '';
    if (hits === null) {
      return '<div class="ob-sub" data-obj-related-degraded="1"><span class="small faint">相关对象检索暂不可达。</span></div>';
    }
    var list = (hits || []).filter(function (h) {
      if (!h || !h.kind || !h.name) return false;
      var k = h.kind + '/' + (h.scope || 'global') + '/' + h.name;
      return !selfKey || k !== selfKey;
    }).slice(0, 5);
    if (!list.length) {
      return '<div class="ob-sub" data-obj-related-empty="1"><span class="chip mute tiny">相关</span> <span class="small faint">暂无高相关在册对象。</span></div>';
    }
    return '<div class="ob-sub ob-rel" data-obj-related="1"><div class="ob-trace-h small muted">相关对象（相关性检索）</div>' +
      list.map(function (h) {
        var scope = h.scope || 'global';
        var route = 'obj/' + encodeURIComponent(h.kind) + '/' + encodeURIComponent(scope) + '/' + encodeURIComponent(h.name);
        var sc = h.score != null ? Number(h.score).toFixed(1) : '0';
        return '<div class="ob-rel-row"><span class="lk mono" data-act="go" data-go="' + esc(route) + '">' +
          esc(h.name) + '</span> <span class="chip mute tiny">' + esc(h.kind) + '</span> ' +
          '<span class="chip acc tiny">' + esc(sc) + '</span>' +
          (h.why ? ' <span class="faint tiny">' + esc(h.why) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
  }

  /* 历史正文快照来源人话标注（双后端分立：sqlite-doc-history vs git——不冒充同源）。 */
  function revSourceLabel(src) {
    var s = String(src || '');
    if (s === 'sqlite-doc-history') return 'sqlite 逐次正文账';
    if (s === 'git') return 'git 正文快照';
    return s || '正文快照';
  }

  function ctxPanel(sum, trace, related, selfKey) {
    var s = sum || { state: 'none', text: '本会话未装配。' };
    var cls = s.state === 'ok' ? 'ok' : 'mute';
    return '<div class="ob-ctx" data-obj-ctx="' + esc(s.state) + '"><span class="chip ' + cls + ' tiny">' +
      (s.state === 'ok' ? '已装配' : '未装配') + '</span> <span class="small">' + esc(s.text || '') + '</span>' +
      (s.state === 'ok' ? ' <button class="btn sm" data-act="obj-chat" data-obj-chat="1">就地续聊</button>' : '') + '</div>' +
      tracePanel(trace) + relatedPanel(related, selfKey);
  }
  function opsPanel(ops) {
    if (!ops || !ops.length) return '';
    return '<div data-obj-ops="1">' + ops.map(function (o) {
      return '<button class="btn sm' + (o.primary ? ' primary' : '') + '" data-act="' + esc(o.act) + '"' +
        Object.keys(o.data || {}).map(function (k) { return ' data-' + esc(k) + '="' + esc(o.data[k]) + '"'; }).join('') +
        (o.href ? ' data-go="' + esc(o.href) + '"' : '') + '>' + esc(o.label) + '</button>';
    }).join(' ') + '</div>';
  }
  function schemePanel(kindReg, content, completion) {
    if (!kindReg || !kindReg.spec) return '';
    var md = (typeof window !== 'undefined' && window.__CC && window.__CC.md) || null;
    var body = md ? (md.yamlToCards(content) || '') : '';
    var comp = (completion || []).length
      ? '<div class="ob-seccomp" data-obj-seccomp="1">' + completion.map(function (c) {
          return '<span class="chip ' + (c.done ? 'ok' : 'mute') + ' tiny">' + esc(c.name) + (c.done ? ' ✓' : ' 缺') + '</span>';
        }).join(' ') + '</div>'
      : '';
    return '<div data-obj-scheme="1">' + comp +
      '<div data-md-cards="1">' + body + '</div>' +
      (md ? md.rawDisclosure('YAML', content) : '') + '</div>';
  }
  function contentPanel(kind, name, content, mk) {
    var md = (typeof window !== 'undefined' && window.__CC && window.__CC.md) || null;
    if (!String(content || '').trim()) {
      return '<div class="ob-empty" data-obj-content-empty="1">本文档暂无正文。</div>';
    }
    if (md && mk) {
      return '<div data-obj-content="1" data-md-render="1">' + md.renderMarkdown(content) + '</div>';
    }
    return '';
  }

  var API = {
    esc: esc, keyOf: keyOf, tagGroups: tagGroups, rulesFor: rulesFor,
    sectionCompletion: sectionCompletion, ctxSummary: ctxSummary,
    setRuleDocsLoader: setRuleDocsLoader, setTagTypesLoader: setTagTypesLoader,
    setTraceLoader: setTraceLoader, setContextFindLoader: setContextFindLoader,
    ensureRules: ensureRules, ensureTagTypes: ensureTagTypes,
    ensureTrace: ensureTrace, ensureRelated: ensureRelated, refreshIndex: refreshIndex,
    traceRouteOf: traceRouteOf, tracePanel: tracePanel, relatedPanel: relatedPanel,
    revSourceLabel: revSourceLabel,
    tagPanel: tagPanel, rulePanel: rulePanel, ctxPanel: ctxPanel, opsPanel: opsPanel,
    schemePanel: schemePanel, contentPanel: contentPanel, objRouteOfRef: objRouteOfRef,
    kindRegYaml: kindRegYaml
  };
  if (typeof window !== 'undefined') {
    window.__CC = window.__CC || {};
    window.__CC.obj = API;
  }
})();
