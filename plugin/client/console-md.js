/* console-md.js —— R-UX-4 渲染优先（core_design@R-UX-4 · console-ui.md §13.2 落地，2026-11-26 用户裁决）
 * 最小自写 markdown 渲染器（零网络依赖、零外部库）：标题/列表/表格/代码块/链接/粗斜体/行内代码/引用/分隔线。
 * 安全红线（XSS）：一切内容先 HTML 转义再走结构化解析——输出 HTML 的非转义通道只有行内格式
 * 包装词形（标签名/类名/闭合结构恒为字面量常量），零原文直插；链接只接受 http(s)/agent/system/session/
 * doc/goal/desc/report/rule 五族内置 scheme 形（相对形一律降级纯文本），零 javascript:/data: 通路。
 * 结构化字段卡（R-UX-2 只读态映射）：yamlToCards() 把对象正文 YAML 解析为字段卡（卡片=字段名+值chip
 * +嵌套子卡），供对象详情默认视图与系统详情「声明」卡使用；裸 YAML 转储恒为折叠次级（<details>）。
 * 词汇纪律（R-UX-3）：本模块为展示层，用户可见文案零「面」字族工程词、零内部里程碑词形。 */
(function () {
  /* ---------- 基元 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // 链接白名单：零 javascript:/data:/vbscript: 通路（R-UX-4 XSS 红线的入口半边）
  function safeHref(u) {
    var s = String(u || '').trim();
    if (/^(https?:|agent:|system:|session:|doc:|goal:|desc:|report:|rule:)/i.test(s)) return s;
    return '';
  }
  /* ---------- 行内格式（输入恒为已转义文本） ---------- */
  function inline(s) {
    // s 已过 esc()——此处只做词形包装，不再引入未转义原文
    var out = s
      .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // 链接：[text](href)——text/href 均已转义；href 再过白名单（不过=整锚降级纯文本）
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, href) {
      var ok = safeHref(href);
      return ok ? '<a class="md-a" data-href="' + ok + '">' + text + '</a>' : text + ' <span class="mono faint small">(' + href + ')</span>';
    });
    return out;
  }
  /* ---------- 块级解析 ---------- */
  function renderMarkdown(src) {
    var lines = String(src == null ? '' : src).split(/\r?\n/);
    var out = [];
    var i = 0;
    var para = [];
    var flushPara = function () {
      if (para.length) { out.push('<p class="md-p">' + inline(esc(para.join(' '))) + '</p>'); para = []; }
    };
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*$/.test(line)) { flushPara(); i++; continue; }
      // 围栏代码块 ```…```（内容纯转义，零行内格式）
      if (/^\s*```/.test(line)) {
        flushPara();
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 收尾 ```
        out.push('<pre class="md-pre">' + esc(buf.join('\n')) + '</pre>');
        continue;
      }
      // 标题 #
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        flushPara();
        var lv = Math.min(h[1].length, 6);
        out.push('<h' + lv + ' class="md-h md-h' + lv + '">' + inline(esc(h[2])) + '</h' + lv + '>');
        i++; continue;
      }
      // 分隔线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); out.push('<hr class="md-hr">'); i++; continue; }
      // 引用块（连续 > 行合并）
      if (/^\s*>\s?/.test(line)) {
        flushPara();
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('<blockquote class="md-quote">' + inline(esc(q.join(' '))) + '</blockquote>');
        continue;
      }
      // 表格 |a|b| 与 |---|---|
      if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        flushPara();
        var heads = line.trim().replace(/^\||\|$/g, '').split('|').map(function (x) { return x.trim(); });
        i += 2;
        var body = [];
        while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
          body.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (x) { return x.trim(); }));
          i++;
        }
        var t = '<table class="md-tbl"><thead><tr>' + heads.map(function (x) { return '<th>' + inline(esc(x)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          body.map(function (row) { return '<tr>' + heads.map(function (_, ci) { return '<td>' + inline(esc(row[ci] == null ? '' : row[ci])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
        out.push(t);
        continue;
      }
      // 列表（有序/无序，支持单层嵌套两空格缩进）
      var isList = function (l) { return /^(\s*)([-*+]|\d+[.)])\s+/.test(l); };
      if (isList(line)) {
        flushPara();
        var items = [];
        while (i < lines.length && isList(lines[i])) {
          var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          var depth = (m[1].length >= 2) ? 1 : 0;
          items.push({ depth: depth, ord: /\d/.test(m[2]), text: m[3] });
          i++;
        }
        var html = '<' + (items[0].ord ? 'ol' : 'ul') + ' class="md-list md-list-root">';
        var stack = [{ tag: items[0].ord ? 'ol' : 'ul' }];
        var openLi = false;
        for (var k = 0; k < items.length; k++) {
          var it = items[k];
          if (openLi) { html += '</li>'; openLi = false; }
          while (stack.length > it.depth + 1) html += '</' + stack.pop().tag + '>';
          if (stack.length === it.depth + 1) {
            var want = it.ord ? 'ol' : 'ul';
            if (stack[stack.length - 1].tag !== want) { html += '</' + stack.pop().tag + '>'; html += '<' + want + ' class="md-list">'; stack.push({ tag: want }); }
          }
          while (stack.length < it.depth + 1) { var tg = it.ord ? 'ol' : 'ul'; html += '<' + tg + ' class="md-list">'; stack.push({ tag: tg }); }
          html += '<li class="md-li">' + inline(esc(it.text));
          openLi = true;
        }
        if (openLi) html += '</li>';
        while (stack.length) html += '</' + stack.pop().tag + '>';
        out.push('<div class="md-wrap">' + html + '</div>');
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flushPara();
    return out.join('');
  }
  /* ---------- 结构化字段卡（R-UX-2 只读态：scheme 控件映射的展示半边） ---------- */
  // 值渲染：标量=chip 文本；列表=逐项 chip；映射=子卡递归。深度有界（≤4）。
  function cardVal(v, depth) {
    if (v == null) return '<span class="faint">—</span>';
    if (Array.isArray(v)) {
      if (!v.length) return '<span class="faint">（空）</span>';
      return '<div class="md-chips">' + v.slice(0, 24).map(function (x) { return '<span class="chip mute small md-chip">' + cardVal(x, depth + 1) + '</span>'; }).join('') + (v.length > 24 ? '<span class="faint small">…共 ' + v.length + ' 项</span>' : '') + '</div>';
    }
    if (typeof v === 'object') {
      if (depth >= 4) return '<span class="mono faint small">（嵌套结构见「YAML」）</span>';
      var keys = Object.keys(v);
      if (!keys.length) return '<span class="faint">（空）</span>';
      return '<div class="md-subcards">' + keys.map(function (kk) {
        return '<div class="md-subcard"><div class="md-subcard-k">' + esc(kk) + '</div><div class="md-subcard-v">' + cardVal(v[kk], depth + 1) + '</div></div>';
      }).join('') + '</div>';
    }
    var s = String(v);
    var href = safeHref(s);
    if (/^(agent|system|session):/.test(s)) return '<span class="lk md-lk" data-href="' + esc(s) + '">' + esc(s) + '</span>';
    if (/^(https?:)/.test(s)) return '<a class="md-a" data-href="' + esc(href) + '">' + esc(s) + '</a>';
    return esc(s);
  }
  // 常用字段的人话释义（R-UX-4③：字段旁给人话；缺省=无释义行不冒充）
  var FIELD_GLOSS = {
    name: '名称', scope: '作用域', resourceVersion: '版本号', goalRef: '目标文档', descRef: '说明文档',
    docs: '相关文档', externalRefs: '外部依赖', instances: '服务实例', builtinServices: '内置服务',
    agentRefs: '对话入口（Agent）', phase: '运行状态', observedGeneration: '已应用的版本', labels: '标签',
    mounts: '已挂载连接', connectorOps: '已挂载连接', provider: '凭据源', session: '当前会话'
  };
  function cardHtml(key, v, depth) {
    var g = FIELD_GLOSS[String(key)];
    return '<div class="md-card" data-md-card="' + esc(String(key)) + '">' +
      '<div class="md-card-k">' + esc(String(key)) + (g ? '<span class="md-gloss">' + esc(g) + '</span>' : '') + '</div>' +
      '<div class="md-card-v">' + cardVal(v, depth) + '</div></div>';
  }
  /* ---------- 最小 YAML 解析（读侧投影：2 空格缩进 + 列表/映射/标量） ---------- */
  function scalar(s) {
    var t = String(s).trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (t === 'true' || t === 'false') return t === 'true';
    if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
    return t;
  }
  // 行内数组 [a, b] / ["x","y"] → string[]（读侧投影：展示用，非机读权威）
  function inlineArray(s) {
    var m = /^\[(.*)\]$/.exec(s.trim());
    if (!m) return null;
    var body = m[1].trim();
    if (!body) return [];
    return body.split(',').map(function (x) { return scalar(x); });
  }
  function parseSimpleYaml(src) {
    var lines = String(src == null ? '' : src).split(/\r?\n/);
    var root = {};
    // 栈：[{ind, obj}]；数组项容器通过「父键挂 []」+ 游标机制承载
    var stack = [{ ind: -1, obj: root }];
    var lastKey = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw.trim() || /^\s*#/.test(raw.trim())) continue;
      if (/^\s*---\s*$/.test(raw)) continue;
      var ind = (raw.match(/^ */) || [''])[0].length;
      var t = raw.trim();
      var listItem = /^-\s+(.*)$/.exec(t);
      if (listItem) {
        while (stack.length > 1 && stack[stack.length - 1].ind >= ind) stack.pop();
        var top = stack[stack.length - 1];
        var body = listItem[1];
        var kv = /^([A-Za-z0-9_.-]+):(?!\/)\s*(.*)$/.exec(body); // (?!\/)：system://… 等 URL scheme 不冒充键行
        if (!top.arr) {
          top.obj[lastKey] = Array.isArray(top.obj[lastKey]) ? top.obj[lastKey] : [];
          top.arr = top.obj[lastKey];
        }
        if (kv && kv.index === 0 && kv[2] === '') {
          var item = {};
          item[kv[1]] = {};
          top.arr.push(item);
          stack.push({ ind: ind, obj: item, arr: null, parent: top });
        } else if (kv && kv.index === 0) {
          var arr2 = inlineArray(kv[2]);
          top.arr.push(arr2 ? arr2 : scalar(kv[2]));
        } else {
          var arrB = inlineArray(body);
          top.arr.push(arrB ? arrB : scalar(body));
        }
        continue;
      }
      var kv2 = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(t);
      if (!kv2) continue;
      var key = kv2[1], val = kv2[2];
      lastKey = key;
      // 深层键：向上收缩到宿主层（父层缩进严格小于当前键缩进；列表项容器已随上一步收缩）
      while (stack.length > 1 && stack[stack.length - 1].ind >= ind) stack.pop();
      var top = stack[stack.length - 1];
      if (val === '') {
        // 看下一行缩进判容器类型（更深缩进=子映射；同/浅缩进或列表项=空数组占位）
        var nxt = lines[i + 1];
        var nInd = nxt && nxt.trim() ? (nxt.match(/^ */) || [''])[0].length : -1;
        var nItem = nxt && /^-\s+/.test(nxt.trim());
        if (nInd > ind && !nItem) { top.obj[key] = {}; stack.push({ ind: ind, obj: top.obj[key], arr: null, parent: top }); }
        else { top.obj[key] = []; }
      } else if (val === '[]' || val === '{}') {
        top.obj[key] = val === '[]' ? [] : {};
      } else {
        // 行内数组 [a, b] → 逐项 chips；行内 map {a: b, c: d} → 子卡
        var arr = inlineArray(val);
        if (arr) { top.obj[key] = arr; continue; }
        var inlineMap = /^\{(.*)\}$/.exec(val);
        if (inlineMap) {
          var m = {};
          inlineMap[1].split(',').forEach(function (p) {
            var kp = /^([^:]+):(.*)$/.exec(p.trim());
            if (kp) m[kp[1].trim()] = scalar(kp[2]);
          });
          top.obj[key] = m;
        } else {
          top.obj[key] = scalar(val);
        }
      }
    }
    return root;
  }
  function yamlToCards(src) {
    var tree = parseSimpleYaml(src);
    var keys = Object.keys(tree).filter(function (k) { return k !== '__items'; });
    if (!keys.length) return '';
    return '<div class="md-cards" data-md-cards="1">' + keys.map(function (k) { return cardHtml(k, tree[k], 0); }).join('') + '</div>';
  }
  /* ---------- 折叠次级（裸原文恒折叠——首屏禁裸转储） ---------- */
  function rawDisclosure(summaryText, content, mono) {
    return '<details class="md-raw"><summary>' + esc(summaryText || '原文') + '</summary>' +
      '<pre class="mono' + (mono === false ? '' : ' md-raw-pre') + '">' + esc(content == null ? '' : content) + '</pre></details>';
  }
  /* ---------- 视图切换 helper（渲染优先 · 原文/scheme 次级） ---------- */
  function viewSwitch(id, views) {
    // views: [{id:'render',label:'正文'},{id:'raw',label:'原文'}] → segmented 切换（dsh 原生 chip 语汇）
    var cur = (typeof window !== 'undefined' && window.__CC && window.__CC.mdView && window.__CC.mdView[id]) || (views[0] && views[0].id);
    return '<div class="md-switch" role="tablist">' + views.map(function (v) {
      return '<span class="chip click small' + (cur === v.id ? ' acc' : ' mute') + '" data-act="md-view" data-view="' + esc(id) + '" data-val="' + esc(v.id) + '">' + esc(v.label) + '</span>';
    }).join('') + '</div>';
  }
  var API = { esc: esc, renderMarkdown: renderMarkdown, inline: inline, yamlToCards: yamlToCards, parseSimpleYaml: parseSimpleYaml, rawDisclosure: rawDisclosure, viewSwitch: viewSwitch, cardHtml: cardHtml, safeHref: safeHref };
  if (typeof window !== 'undefined') window.__CC = window.__CC || {};
  if (typeof window !== 'undefined') window.__CC.md = API;
})();
