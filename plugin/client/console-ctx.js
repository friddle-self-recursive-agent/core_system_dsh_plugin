/* console-ctx.js —— 提案×上下文对照卡（concepts/proposal.md §4.6 + console-ui.md §12 落地，2026-11-26 用户裁决）
 * 提交节点（生成预览/直接填表提交）对提案摘要跑上下文对照：conflicts（与现有文档冲突的结论）/
 * supplements（建议随行补充更新的文档）——对话区独立卡片明确展示（不静默、不折叠进其他），
 * 审批详情屏同屏携带；对照失败降级 degraded 卡片可见（不阻断提交）。
 * 判定=确定性检索（文档库索引 basename/主题词 × YAML 域关键词），对照=辅助判定信息，
 * 不改变准入判定本身（准入仍=scheme+权限+lint）；同提案同摘要复用会话内缓存（复用=tagSig 语义）。
 * 引用纪律：每条 ref=<repo>/<path>#<锚> + hash（文档库索引现读 sha，逐字节对账口径）；可展开核对。
 * 安全红线（同 console-md.js）：一切动态文本先 HTML 转义再入卡，零原文直插。
 * 词汇纪律（R-UX-3）：用户可见文案零工程词形；本模块注释与字符串同步守约。 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* 会话内缓存：key='Kind|scope|name' → 对照状态（含 sig 复用判定）。 */
  var byKey = {};
  function keyOf(kind, scope, name) { return kind + '|' + (scope || 'global') + '|' + (name || ''); }
  function sigOf(yaml) {
    var s = String(yaml || ''), h = 5381, i;
    for (i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return 'sig' + (h >>> 0).toString(36) + ':' + s.length;
  }
  /* 中文主题词 → 文档 basename（确定性词表——标题/目标中文提及映射到文档族）。 */
  var ZH_DOC = {
    '事件': 'event', '指标': 'metrics', '监控': 'metrics', '权限': 'permission', '角色': 'permission',
    '工作流': 'workflow', '流程': 'workflow', '提案': 'proposal', '审批': 'proposal', '连接': 'connector',
    '凭据': 'provider', '账号': 'provider', '上下文': 'context', '会话': 'agent', '智能体': 'agent',
    '代理': 'agent', '通知': 'notification', '文档': 'ref', '引用': 'ref', '版本': 'revision', '模板': 'template'
  };
  /* YAML 域关键词（字段族 → 所属文档 basename）：声明触及该域即计数。 */
  var DOMAIN_KEYS = {
    'proposal': 'approve|reject|approval|origin',
    'permission': 'role|permission|subject|authz',
    'apply': 'fieldmanager|dry-run|baseSha',
    'provider': 'secret|auth|vault|provider',
    'connector': 'connectorrefs|connector|connectorops',
    'workflow': 'workflows|flowbind|steps|schedule',
    'event': 'triggers|events|eventid',
    'ref': 'docrefs|docsroot',
    'context': 'tags|pack|tagSig',
    'revision': 'resourceversion|rv',
    'doctype': 'doctype'
  };
  function tokensOf(text) {
    var out = {}, parts = String(text || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/);
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i];
      if (!t) continue;
      out[t] = true;
      if (ZH_DOC[t] && !out[ZH_DOC[t]]) { out['@' + ZH_DOC[t]] = true; }
    }
    /* 中文长词含主题词（如「提案审批」含「提案」「审批」）——子串命中映射。 */
    Object.keys(ZH_DOC).forEach(function (zh) {
      if (String(text || '').indexOf(zh) >= 0 && !out['@' + ZH_DOC[zh]]) out['@' + ZH_DOC[zh]] = true;
    });
    return out;
  }
  /* ---------- 确定性对照分析（纯函数——可机械直测） ----------
   * docs: [{repo, path, sha}] 文档库索引现读；缺/null → degraded（不阻断）。
   * 返回 {conflicts, supplements, degraded, reason, scanned}。 */
  function analyze(yaml, docs) {
    var y = String(yaml || '');
    var low = y.toLowerCase();
    /* 主题 token 只取标题/目标（人话文本）——YAML 键名（scope:/status: 等每案必有）不参与主题命中。 */
    var toks = tokensOf(extractScalar(y, 'title') + ' ' + extractScalar(y, 'summary'));
    if (!docs || !docs.length) {
      return { conflicts: [], supplements: [], degraded: true, reason: '文档库索引暂不可达——对照已跳过（不阻断提交）；提交后可在文档页签人工复核。', scanned: 0 };
    }
    var conflicts = [], supplements = [];
    docs.forEach(function (d) {
      if (!d || !d.path) return;
      var base = String(d.path).replace(/^.*\//, '').replace(/\.md$/, '').toLowerCase();
      if (!base) return;
      var nameHit = !!(toks[base] || toks['@' + base]);
      var domainHit = false;
      var domRe = DOMAIN_KEYS[base];
      if (domRe) domainHit = new RegExp('(^|[^a-z])(' + domRe + ')([^a-z]|$)', 'i').test(low);
      var signals = (nameHit ? 1 : 0) + (domainHit ? 1 : 0);
      if (!signals) return;
      var ref = (d.repo || 'core_design') + '/' + d.path + '#' + base;
      var item = { ref: ref, hash: String(d.sha || ''), base: base, signals: signals };
      if (nameHit && domainHit) {
        item.why = '标题/目标提及「' + base + '」主题，且对象声明触及' + base + ' 文档的关键域——结论可能与现有文档冲突，建议点开对照复核（可回对话修改或标注已知取舍）。';
        conflicts.push(item);
      } else {
        item.why = nameHit
          ? '提案触及「' + base + '」文档的主题——建议随行核对并在实现后更新该文档（更新义务随派工下发）。'
          : '对象声明触及 ' + base + ' 文档的关联域——建议随行核对该文档当前约定。';
        supplements.push(item);
      }
    });
    conflicts.sort(function (a, b) { return b.signals - a.signals || (a.base < b.base ? -1 : 1); });
    supplements.sort(function (a, b) { return b.signals - a.signals || (a.base < b.base ? -1 : 1); });
    return { conflicts: conflicts.slice(0, 5), supplements: supplements.slice(0, 6), degraded: false, reason: '', scanned: docs.length };
  }
  /* 提取 YAML 顶层/嵌套标量（title/summary——轻量按行解析，零外部库）。 */
  function extractScalar(yamlText, leaf) {
    if (!yamlText) return '';
    var re = new RegExp('^\\s*' + leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'm');
    var m = re.exec(String(yamlText));
    if (!m) return '';
    return m[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
  }
  /* ---------- 文档库索引接入（宿主注入 loader——模块零直接网络依赖） ----------
   * loader: function() → Promise<{docs:[{repo,path,sha}]}>（宿主转接只读设计文档清单）。
   * 会话内缓存 120s（现读 sha 口径不变即复用；失败=降级不缓存失败态）。 */
  var loader = null;
  var idx = { docs: null, at: 0, promise: null };
  function setDocsLoader(fn) { loader = fn; idx = { docs: null, at: 0, promise: null }; }
  function ensureDocs() {
    if (idx.docs && (Date.now() - idx.at) < 120000) return Promise.resolve(idx.docs);
    if (!loader) return Promise.resolve(null);
    if (!idx.promise) {
      idx.promise = Promise.resolve().then(loader).then(function (b) {
        idx.docs = (b && (b.docs || b)) || [];
        idx.at = Date.now();
        idx.promise = null;
        return idx.docs;
      }, function () {
        idx.docs = null;
        idx.promise = null;
        return null;
      });
    }
    return idx.promise;
  }
  /* ---------- 对照入口（提交节点随行调用） ----------
   * 同键同摘要（sig 一致）复用既有对照（tagSig 复用语义）——不重复装配。 */
  function check(kind, scope, name, yaml) {
    return ensureDocs().then(function (docs) {
      var sig = sigOf(yaml);
      var k = keyOf(kind, scope, name);
      var prev = byKey[k];
      if (prev && prev.sig === sig && prev.cx && !prev.cx.degraded) return { cx: prev.cx, reused: true };
      var cx = analyze(yaml, docs);
      byKey[k] = { sig: sig, cx: cx, at: Date.now() };
      return { cx: cx, reused: false };
    });
  }
  /* ---------- 对话区独立卡（提交节点随行） ----------
   * cx: analyze() 产出的对照状态（conflicts/supplements/degraded/reason/scanned）。
   * 冲突卡引用可展开（<details>）；补充卡一键加入提案 supplements 随行。 */
  function card(cx) {
    var conf = (cx && cx.conflicts) || [];
    var supp = (cx && cx.supplements) || [];
    var degraded = !!(cx && cx.degraded);
    var stateCls = degraded ? 'mute' : (conf.length ? 'warn' : 'ok');
    var stateText = degraded ? '对照降级（不阻断）' : (conf.length ? ('发现 ' + conf.length + ' 处待复核冲突') : (supp.length ? ('有 ' + supp.length + ' 份文档建议随行核对') : '未发现冲突'));
    var html = '<div class="ctx-card" id="intake-ctx-card" data-ctx-card="1" data-ctx-state="' + (degraded ? 'degraded' : (conf.length ? 'conflicts' : 'supplements')) + '">' +
      '<div class="ctx-h"><span class="chip ' + stateCls + ' small">提案×文档对照</span>' +
      '<span class="small ' + (degraded ? 'faint' : 'muted') + '">' + esc(stateText) + '</span>' +
      '<span class="mono faint small">' + (degraded ? '' : ('文档 ' + esc(String(cx.scanned || 0)) + ' 份')) + '</span></div>';
    if (degraded) {
      html += '<div class="ctx-degraded" data-ctx-degraded="1">' + esc(cx.reason || '对照暂不可用——不阻断提交。') + '</div></div>';
      return html;
    }
    if (conf.length) {
      html += '<div class="ctx-sec"><div class="ctx-sec-h">冲突点（建议先复核）</div>';
      conf.forEach(function (c, i) {
        html += '<details class="ctx-item" data-ctx-conflict="' + i + '"><summary>' +
          '<span class="mono">' + esc(c.ref) + '</span> <span class="mono faint small">' + esc(shortSha(c.hash)) + '</span></summary>' +
          '<div class="ctx-item-why">' + esc(c.why) + '</div>' +
          '<div class="mono faint small ctx-hash-full">hash=' + esc(c.hash) + '</div></details>';
      });
      html += '<div class="faint small" style="margin-top:4px">冲突取舍留在审批记录（approval_log）——对照仅辅助判定，不改准入结果。</div></div>';
    }
    if (supp.length) {
      html += '<div class="ctx-sec"><div class="ctx-sec-h">建议随行核对（实现后更新对应文档）</div>';
      supp.forEach(function (s, i) {
        var taken = window.__CC && window.__CC.ctx && window.__CC.ctx.taken && window.__CC.ctx.taken[s.ref];
        html += '<div class="ctx-item ctx-supp" data-ctx-supp="' + i + '">' +
          '<span class="mono">' + esc(s.ref) + '</span> <span class="mono faint small">' + esc(shortSha(s.hash)) + '</span>' +
          '<div class="ctx-item-why">' + esc(s.why) + '</div>' +
          '<button class="btn sm' + (taken ? ' ok' : '') + '" data-act="ctx-supplement-add" data-ref="' + esc(s.ref) + '" data-hash="' + esc(s.hash) + '" data-base="' + esc(s.base) + '"' + (taken ? ' disabled' : '') + '>' + (taken ? '✓ 已加入随行清单' : '加入随行清单') + '</button></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }
  function shortSha(h) { var s = String(h || ''); return s ? s.slice(0, 8) : '—'; }
  /* ---------- 审批详情屏同屏携带（折叠次级——非首屏主体） ----------
   * live 侧数据在册 → 完整对照卡；缺席 → 降级行（可见不静默）。 */
  function approvalStrip(cx, name) {
    var conf = (cx && cx.conflicts) || [];
    var supp = (cx && cx.supplements) || [];
    var degraded = !cx || !!cx.degraded;
    var stateText = degraded
      ? '对照暂不可见（' + esc((cx && cx.reason) || '本次会话未携带——可在文档页签人工复核。') + ')'
      : (conf.length ? ('发现 ' + conf.length + ' 处待复核冲突') : (supp.length ? ('有 ' + supp.length + ' 份文档建议随行核对') : '未发现冲突'));
    var body = degraded
      ? '<div class="ctx-degraded" data-ctx-degraded="1">' + esc((cx && cx.reason) || '本次会话未携带对照——可在文档页签人工复核。') + '</div>'
      : card(cx).replace(/^<div class="ctx-card"[^>]*>/, '').replace(/<\/div>$/, '');
    return '<details class="ctx-approval" data-ctx-approval="' + esc(name || '') + '"><summary>' +
      '<span class="chip small ' + (degraded ? 'mute' : (conf.length ? 'warn' : 'ok')) + '">提案×文档对照</span>' +
      '<span class="small muted">' + stateText + '</span></summary>' +
      '<div class="ctx-approval-body">' + body + '</div></details>';
  }
  var API = { analyze: analyze, card: card, approvalStrip: approvalStrip, sigOf: sigOf, keyOf: keyOf, extractScalar: extractScalar, shortSha: shortSha, taken: {}, check: check, setDocsLoader: setDocsLoader, cachedOf: function (kind, scope, name) { var e = byKey[keyOf(kind, scope, name)]; return e && e.cx; } };
  if (typeof window !== 'undefined') {
    window.__CC = window.__CC || {};
    window.__CC.ctx = API;
  }
})();
