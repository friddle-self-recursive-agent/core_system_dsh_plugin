// Service → dsh Workspace 最小映射（console-adoption.md §1.23）。
// 真相分两层：Service/Agent 归属=cored 读面；Workspace 注册与 Session 归属=dsh workspace/session store。
// 本模块只做组织投影：不迁移旧会话、不归档、不改变 Agent 概念模型。
(function () {
  'use strict';

  var state = {
    services: [],
    projects: {},
    ready: false,
    busy: false,
    error: ''
  };

  function faces() {
    return (typeof __CC !== 'undefined' && __CC.hostFaces) || {};
  }

  function request(path, opts) {
    return fetch(path, Object.assign({
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      credentials: 'same-origin'
    }, opts || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error(String(body && body.error || ('HTTP ' + r.status)));
        return body;
      });
    });
  }

  function workspaceItems() {
    var ws = faces().workspaces;
    if (!ws || !ws.list || typeof ws.list.getSnapshot !== 'function') return [];
    var snap = ws.list.getSnapshot();
    return (snap && snap.items) || [];
  }

  function matchWorkspace(service, path) {
    var rows = workspaceItems();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].title === service || (path && rows[i].path === path)) return rows[i];
    }
    return null;
  }

  function ensure() {
    if (state.ready) return Promise.resolve(state)
    if (state.busy) return state.cur || Promise.resolve(state);
    var ws = faces().workspaces;
    if (!ws || typeof ws.create !== 'function') {
      state.ready = false;
      state.error = 'dsh Workspace 通道缺席';
      return Promise.resolve(state);
    }
    state.busy = true;
    state.error = '';
    state.cur = request('/core-console/service-projects')
      .then(function (body) {
        state.services = body.services || [];
        return request('/core-console/service-projects', {
          method: 'POST',
          body: JSON.stringify({ services: state.services.map(function (s) { return s.name; }) })
        });
      })
      .then(function (body) {
        var jobs = (body.projects || []).map(function (p) {
          var found = matchWorkspace(p.service, p.path);
          if (found) return Promise.resolve(found);
          return ws.create({ path: p.path }).then(function (created) { return created; }, function (e) {
            // 并发创建/宿主刚同步：以 list 快照复核一次，仍无则诚实报错。
            var raced = matchWorkspace(p.service, p.path);
            if (raced) return raced;
            throw e;
          });
        });
        return Promise.all(jobs);
      })
      .then(function (rows) {
        var map = {};
        rows.forEach(function (row, i) {
          var service = state.services[i];
          if (service && row) map[service.name] = { service: service.name, workspaceId: row.workspaceId, title: row.title };
        });
        state.projects = map;
        state.ready = true;
        return state;
      })
      .catch(function (e) {
        state.ready = false;
        state.error = String((e && e.message) || e);
        return state;
      })
      .then(function () {
        state.busy = false;
        if (typeof __CC.serviceProjects.onChange === 'function') __CC.serviceProjects.onChange();
        return state;
      });
    return state.cur;
  }

  function ownerOf(agent) {
    if (typeof __CC.agentOwnerOf === 'function') return __CC.agentOwnerOf(agent);
    return null;
  }

  function projectForAgent(agent) {
    var owner = ownerOf(agent);
    var service = owner && owner.system;
    if (!service) {
      for (var i = 0; i < state.services.length; i++) {
        if ((state.services[i].agents || []).indexOf(agent) >= 0) { service = state.services[i].name; break; }
      }
    }
    return service ? state.projects[service] || null : null;
  }

  function bind() {
    if (faces().workspaces) ensure();
  }

  __CC.serviceProjects = {
    state: state,
    ensure: ensure,
    bind: bind,
    projectForAgent: projectForAgent,
    workspaceItems: workspaceItems,
    onChange: null
  };
})();
