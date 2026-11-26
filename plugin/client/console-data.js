// console-proto data.js（整体内嵌起点代码）：window.MOCK → 闭包 __CC.MOCK（不落 window 全局）
/* data.js — core console 原型 mock 数据（单一 MOCK 对象，所有屏共享；普通 script）
 * 概念对齐: core_design/concepts/{apply,workflow}.md · core_system_instance/runtime/console-ui.md
 */
(function () {
  'use strict';

  // ---------- 工具：相对时间基准 ----------
  var NOW = Date.now();
  function ago(min) { return new Date(NOW - min * 60000); }
  function ahead(sec) { return new Date(NOW + sec * 1000); }

  // 种子随机（保证每次刷新数据一致）
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- 系统（ServiceDesc）----------
  var systems = [
    { name: 'self-recursive-core', scope: 'systems/self-recursive-core', phase: 'InSync',
      generation: 9, observedGeneration: 9, agent: 'builtinRoot', runs24h: 5, driftOpen: 0,
      pending: 0, desc: '自递归内核：Goal 驱动、文档对账、递归改进自身的核心控制。' },
    { name: 'developer-system', scope: 'systems/developer-system', phase: 'Drifting',
      generation: 11, observedGeneration: 8, agent: 'dev-1', runs24h: 8, driftOpen: 2,
      pending: 1, desc: '研发系统：pull 源码 → build+test → 产物 digest → 修复循环。' },
    { name: 'deploy-system', scope: 'systems/deploy-system', phase: 'InSync',
      generation: 7, observedGeneration: 7, agent: 'dep-1', runs24h: 3, driftOpen: 0,
      pending: 1, desc: '部署系统：按 DeployDesign.envs 升序发布，prod 段人批。' },
    { name: 'storage-system', scope: 'systems/storage-system', phase: 'InSync',
      generation: 4, observedGeneration: 4, agent: 'builtinRoot', runs24h: 2, driftOpen: 0,
      pending: 0, desc: '存储系统：nas / oss 双后端，产物入库（digest）与回源。' },
    { name: 'connector', scope: 'systems/connector', phase: 'Remediating',
      generation: 6, observedGeneration: 5, agent: 'builtinRoot', runs24h: 4, driftOpen: 1,
      pending: 0, desc: '连接系统：WorkService / ConnectorOps / Provider 的挂载与保活。' },
    { name: 'user-system', scope: 'systems/user-system', phase: 'InSync',
      generation: 3, observedGeneration: 3, agent: 'builtinRoot', runs24h: 1, driftOpen: 0,
      pending: 0, desc: '用户系统：会话、通知出口（Notification）与 bind-role 挂载。' }
  ];

  // ---------- ServiceInstance ----------
  var instances = [
    { name: 'default', system: 'self-recursive-core', phase: 'InSync',
      agents: ['builtinRoot'], observedGeneration: 9, generation: 9,
      owner: 'self-desc', docs: { impl: 'core-impl', verify: 'core-verify', drift: null },
      conditions: [
        { type: 'Reconciled', status: 'True', reason: 'LastTickClean', ts: ago(3) },
        { type: 'DocsApplied', status: 'True', reason: 'r9', ts: ago(120) },
        { type: 'AgentAlive', status: 'True', reason: 'builtinRoot heartbeat 12s', ts: ago(1) }
      ],
      metrics: [
        { q: 'tick_lag_seconds', target: '< 30', current: '4.2' },
        { q: 'open_drifts', target: '0', current: '0' }
      ] },
    { name: 'ci', system: 'developer-system', phase: 'Drifting',
      agents: ['ci-repair-agent', 'ci-verifier'], observedGeneration: 8, generation: 9,
      owner: 'dev-desc', docs: { impl: 'ci-impl', verify: 'ci-verify', drift: 'ci-drift-042' },
      conditions: [
        { type: 'Reconciled', status: 'False', reason: 'DriftDetected: onedev-ci 队列配置与 ImplDoc 不一致', ts: ago(26) },
        { type: 'AgentAlive', status: 'True', reason: '2/2 agents heartbeat', ts: ago(1) },
        { type: 'DocsApplied', status: 'True', reason: 'r8', ts: ago(400) }
      ],
      metrics: [
        { q: 'repair_success_rate', target: '>= 0.85', current: '0.88' },
        { q: 'verify_pass_rate', target: '>= 0.95', current: '0.93' },
        { q: 'onedev_queue_backlog', target: '< 10', current: '14' }
      ] },
    { name: 'dev-pool', system: 'developer-system', phase: 'InSync',
      agents: ['dev-1'], observedGeneration: 8, generation: 8,
      owner: 'dev-desc', docs: { impl: 'dev-impl', verify: 'dev-verify', drift: null },
      conditions: [
        { type: 'Reconciled', status: 'True', reason: 'LastTickClean', ts: ago(9) },
        { type: 'AgentAlive', status: 'True', reason: 'dev-1 heartbeat 8s', ts: ago(1) }
      ],
      metrics: [
        { q: 'build_pass_rate', target: '>= 0.9', current: '0.94' },
        { q: 'pull_lag_seconds', target: '< 60', current: '11' }
      ] },
    { name: 'prod', system: 'deploy-system', phase: 'Escalated',
      agents: ['dep-1'], observedGeneration: 6, generation: 7,
      owner: 'deploy-desc', docs: { impl: 'deploy-impl', verify: 'deploy-verify', drift: 'escalated-drift' },
      conditions: [
        { type: 'Reconciled', status: 'False', reason: 'Escalated: prod 发布被高危门禁拦截，等待 root', ts: ago(18) },
        { type: 'AutoLevel', status: 'False', reason: 'scope=prod 命中 ask 档', ts: ago(18) },
        { type: 'AgentAlive', status: 'True', reason: 'dep-1 heartbeat 9s', ts: ago(1) }
      ],
      metrics: [
        { q: 'rollout_progress', target: '100%', current: '2/4 envs' },
        { q: 'prod_gate', target: 'approved', current: 'pending' }
      ] },
    { name: 'staging', system: 'deploy-system', phase: 'InSync',
      agents: ['dep-1'], observedGeneration: 7, generation: 7,
      owner: 'deploy-desc', docs: { impl: 'deploy-impl', verify: 'deploy-verify', drift: null },
      conditions: [
        { type: 'Reconciled', status: 'True', reason: 'LastTickClean', ts: ago(6) },
        { type: 'AgentAlive', status: 'True', reason: 'dep-1 heartbeat 9s', ts: ago(1) }
      ],
      metrics: [{ q: 'rollout_progress', target: '100%', current: '100%' }] },
    { name: 'nas-oss', system: 'storage-system', phase: 'InSync',
      agents: ['builtinRoot'], observedGeneration: 4, generation: 4,
      owner: 'storage-desc', docs: { impl: 'storage-impl', verify: 'storage-verify', drift: null },
      conditions: [
        { type: 'Reconciled', status: 'True', reason: 'sync ok', ts: ago(12) },
        { type: 'ArtifactsSynced', status: 'True', reason: 'digest 3f2a…9c', ts: ago(41) }
      ],
      metrics: [
        { q: 'oss_sync_lag_seconds', target: '< 120', current: '38' },
        { q: 'nas_free_gb', target: '> 200', current: '412' }
      ] },
    { name: 'mesh-1', system: 'connector', phase: 'Remediating',
      agents: ['builtinRoot'], observedGeneration: 5, generation: 6,
      owner: 'conn-desc-sd', docs: { impl: 'connector-impl', verify: 'connector-verify', drift: 'conn-drift-017' },
      conditions: [
        { type: 'Reconciled', status: 'False', reason: 'Remediating: gotty-web 心跳超时，正在重建挂载', ts: ago(14) },
        { type: 'MountsHealthy', status: 'False', reason: '3/4 mounts ok', ts: ago(14) }
      ],
      metrics: [
        { q: 'mount_health', target: '4/4', current: '3/4' },
        { q: 'comm_dispatch_p95_ms', target: '< 800', current: '640' }
      ] },
    { name: 'default', system: 'user-system', phase: 'InSync',
      agents: ['builtinRoot'], observedGeneration: 3, generation: 3,
      owner: 'user-desc-sd', docs: { impl: 'user-impl', verify: 'user-verify', drift: null },
      conditions: [
        { type: 'Reconciled', status: 'True', reason: 'LastTickClean', ts: ago(7) },
        { type: 'NotifyOutlet', status: 'True', reason: 'bind-role ok', ts: ago(60) }
      ],
      metrics: [{ q: 'notify_deliver_rate', target: '>= 0.99', current: '0.997' }] }
  ];

  // ---------- Agent ----------
  var agents = {
    'builtinRoot': {
      name: 'builtinRoot', alias: 'root', instance: 'self-recursive-core/default', parent: null,
      phase: 'Idle', currentSession: 'sess-root-1', lastTask: '对账 self-recursive-core r9',
      perms: {
        connectorops: ['agent-comm', 'gotty-web', 'onedev-ci', 'oss-artifacts'],
        refs: ['storage-system/nas-oss', 'deploy-system/prod'],
        providers: ['llm-main', 'onedev-robot'],
        roles: ['root-all', 'approver']
      },
      scopeSummary: 'token: global（父级，权限整包）',
      persona: '内核 root agent，语气克制、给结论、附证据链。'
    },
    'ci-repair-agent': {
      name: 'ci-repair-agent', alias: 'repair', instance: 'developer-system/ci', parent: 'builtinRoot',
      phase: 'Executing', currentSession: 'sess-repair-1', lastTask: '修复 onedev-ci 队列漂移 #042',
      perms: {
        connectorops: ['onedev-ci', 'gitfs', 'agent-comm'],
        refs: ['developer-system/ci'],
        providers: ['llm-main'],
        roles: ['ci-repair']
      },
      scopeSummary: 'token: systems/developer-system/ci（⊆ builtinRoot）',
      persona: 'CI 修复 agent，先诊断后动手，每步留 action log。'
    },
    'ci-verifier': {
      name: 'ci-verifier', alias: 'verifier', instance: 'developer-system/ci', parent: 'builtinRoot',
      phase: 'Verifying', currentSession: 'sess-verify-1', lastTask: '复测 ci-verify 探针集',
      perms: {
        connectorops: ['onedev-ci', 'agent-comm'],
        refs: ['developer-system/ci'],
        providers: ['llm-main'],
        roles: ['ci-verify']
      },
      scopeSummary: 'token: systems/developer-system/ci（只读 + 探针）',
      persona: '验证 agent，只报事实与指标，不修复。'
    },
    'dep-1': {
      name: 'dep-1', alias: 'dep', instance: 'deploy-system/prod', parent: 'builtinRoot',
      phase: 'Paused', currentSession: 'sess-dep-1', lastTask: 'prod 发布 2/4 envs，等待 prod 门禁',
      perms: {
        connectorops: ['onedev-ci', 'oss-artifacts', 'agent-comm', 'gotty-web'],
        refs: ['deploy-system/prod', 'storage-system/nas-oss'],
        providers: ['onedev-robot', 'llm-main'],
        roles: ['deploy-operator', 'approver-staging']
      },
      scopeSummary: 'token: systems/deploy-system（prod 段 ask，须 root 批）',
      persona: '部署 agent，严格按 DeployDesign.envs 升序，绝不跳段。'
    },
    'dev-1': {
      name: 'dev-1', alias: 'dev', instance: 'developer-system/dev-pool', parent: 'builtinRoot',
      phase: 'Analyzing', currentSession: 'sess-dev-1', lastTask: '拆解新需求 req-118',
      perms: {
        connectorops: ['gitfs', 'onedev-ci', 'nas', 'agent-comm'],
        refs: ['developer-system/dev-pool', 'storage-system/nas-oss'],
        providers: ['llm-main'],
        roles: ['developer']
      },
      scopeSummary: 'token: systems/developer-system/dev-pool（⊆ builtinRoot）',
      persona: '研发 agent，习惯先读 Goal/ImplDoc 再写代码。'
    }
  };

  // ---------- WorkService / ConnectorOps / Provider / Ref / Role ----------
  var workservices = [
    { name: 'onedev', kind: 'WorkService', scope: 'systems/connector', status: 'Ready', endpoint: 'https://onedev.internal', desc: 'OneDev 代码与 CI 服务（git 托管 + 构建）。' },
    { name: 'gitfs', kind: 'WorkService', scope: 'systems/connector', status: 'Ready', endpoint: 'gitfs:///srv/git', desc: 'Git 文档/代码双库存储（文档版本化后端）。' },
    { name: 'nas', kind: 'WorkService', scope: 'systems/storage-system', status: 'Ready', endpoint: 'nas:///mnt/builds', desc: 'NAS 本地构建产物卷。' },
    { name: 'oss', kind: 'WorkService', scope: 'systems/storage-system', status: 'Degraded', endpoint: 'oss://builds', desc: 'OSS 对象存储（产物入库 digest）。' }
  ];

  var connectorops = [
    { name: 'onedev-ci', kind: 'ConnectorOps', workService: 'onedev', status: 'Ready',
      ops: ['build', 'poll-log', 'trigger-job', 'watch-queue'], desc: 'OneDev CI：触发构建、拉日志、盯队列。' },
    { name: 'gotty-web', kind: 'ConnectorOps', workService: 'onedev', status: 'Degraded',
      ops: ['open-terminal', 'exec'], desc: '网页终端挂载（gotty）：默认终端接入，可选 opencode cli / claude-code / 内嵌 dsh 三种 runner。' },
    { name: 'agent-comm', kind: 'ConnectorOps', workService: null, status: 'Ready',
      ops: ['dispatch', 'query', 'interrupt', 'inbox'], desc: '跨 Agent 通信：dispatch / query / interrupt / inbox；上级委派=权限整包下发（token），子 agent 权限 ⊆ 父。' },
    { name: 'oss-artifacts', kind: 'ConnectorOps', workService: 'oss', status: 'Ready',
      ops: ['put', 'get', 'verify-digest'], desc: '产物入库：digest 校验 + 回源。' }
  ];

  var providers = [
    { name: 'onedev-robot', kind: 'Provider', scope: 'systems/connector', status: 'Ready', desc: 'OneDev 机器人账号（token 型 Provider，供 onedev-ci 调用）。' },
    { name: 'llm-main', kind: 'Provider', scope: 'global', status: 'Ready', desc: '主力 LLM Provider（flash-tier 模型档，Agent/生成相位共用）。' }
  ];

  var refs = [
    { name: 'developer-system/ci', from: 'onedev-ci', to: 'developer-system', kind: 'Ref', status: 'Resolved' },
    { name: 'storage-system/nas-oss', from: 'deploy-system', to: 'storage-system', kind: 'Ref', status: 'Resolved' },
    { name: 'deploy-system/prod', from: 'builtinRoot', to: 'deploy-system', kind: 'Ref', status: 'Resolved' },
    { name: 'user-system/notify', from: 'bind-role', to: 'user-system', kind: 'Ref', status: 'Resolved' }
  ];

  var roles = [
    { name: 'root-all', scope: 'global', desc: 'root 全量权限（仅 builtinRoot）。' },
    { name: 'approver', scope: 'global', desc: '审批者：可批准/驳回 ApprovalNeeded。' },
    { name: 'ci-repair', scope: 'systems/developer-system/ci', desc: 'CI 修复：onedev-ci 写 + gitfs 读写。' },
    { name: 'ci-verify', scope: 'systems/developer-system/ci', desc: 'CI 验证：只读 + 探针执行。' },
    { name: 'deploy-operator', scope: 'systems/deploy-system', desc: '部署执行：staging 直发，prod 段 ask。' },
    { name: 'developer', scope: 'systems/developer-system/dev-pool', desc: '研发：gitfs 读写 + 构建触发。' }
  ];

  __CC.MOCK = {
    meta: { now: NOW, ago: ago, ahead: ahead, seeded: mulberry32(20261123) },
    user: { name: 'root', label: 'root@core', cored: 'connected' },
    systems: systems,
    instances: instances,
    agents: agents,
    workservices: workservices,
    connectorops: connectorops,
    providers: providers,
    refs: refs,
    roles: roles
  };
  // ---------- 文档对象（与资源同规则：name/kind/scope/revision/status） ----------
  function D(o) {
    return Object.assign({
      kind: 'Rule', revision: 1, generation: 1, status: 'Active',
      updated: ago(60), fieldManager: 'root', ownerRefs: [],
      draft: null, draftSource: null, draftFrom: null, history: []
    }, o);
  }
  function H(rev, author, minAgo, summary) { return { rev: rev, author: author, ts: ago(minAgo), summary: summary }; }

  var docs = [
    D({ name: 'core-goal', kind: 'Goal', scope: 'global', revision: 21, generation: 12,
      updated: ago(180), fieldManager: 'root', ownerRefs: ['self-desc'],
      history: [H(21, 'root', 180, '提升自递归收敛指标'), H(20, 'builtinRoot', 2600, '初始化全局目标'), H(19, 'root', 5200, '措辞修订')],
      content:
"apiVersion: core/v1\nkind: Goal\nmetadata:\n  name: core-goal\n  scope: global\n  ownerRefs:\n    - self-desc\nspec:\n  intent: |\n    core_system 以「一切皆文档」的方式管理 AI Agent 集群：\n    每个 Service 由 ServiceDesc 声明，由 Workflow 对账，\n    偏差进 DriftReport，收敛靠 developer-system 与 deploy-system。\n  northStars:\n    - 系统集长期自治运行，人工只处理 Escalated 与审批\n    - 任意对象可从树上一跳可达，标识符皆可点\n    - 文档唯一写路径是 Apply（乐观锁 + DocApplied 回执）\n  slo:\n    convergenceP95Minutes: 30\n    escalatedPer24h: 2\n    docDriftOpenMax: 3\nstatus:\n  progress: on-track\n  lastReview: 2026-11-21" }),
    D({ name: 'apply-rule', kind: 'Rule', scope: 'global', revision: 7, generation: 7,
      updated: ago(2400), fieldManager: 'builtinRoot', ownerRefs: ['apply-rule'],
      history: [H(7, 'builtinRoot', 2400, '明确 Status 直写豁免'), H(6, 'root', 8000, '初版：草稿缓存语义')],
      content:
"apiVersion: core/v1\nkind: Rule\nmetadata:\n  name: apply-rule\n  scope: global\nspec:\n  statement: |\n    文档唯一写路径是 Apply。人/LLM 的改动先进草稿缓存，\n    Apply 落库时 Revision+1 并必发 DocApplied 事件。\n    LLM 只提案，Apply 必须人点。\n  exemptions:\n    - Status 回写（fieldManager 白名单，机器直写）\n    - SessionLog / DriftReport（记录类，不经 Apply）\n  lock: document-level-optimistic\n  conflict: re-read + LLM 语义 diff，人裁兜底" }),
    D({ name: 'core-scheme', kind: 'Scheme', scope: 'global', revision: 14, generation: 14,
      updated: ago(420), fieldManager: 'builtinRoot', ownerRefs: [],
      history: [H(14, 'builtinRoot', 420, '注册 ConnectorOps/agent-comm 四原语'), H(13, 'builtinRoot', 3000, 'Workflow phases 增加 Paused')],
      content:
"apiVersion: core/v1\nkind: Scheme\nmetadata:\n  name: core-scheme\n  scope: global\nspec:\n  objects:\n    - {kind: Goal, scope: any, revisioned: true}\n    - {kind: Rule, scope: any, revisioned: true}\n    - {kind: Desc, scope: any, revisioned: true}\n    - {kind: ImplDoc, scope: instance, revisioned: true}\n    - {kind: VerifyDoc, scope: instance, revisioned: true}\n    - {kind: DriftReport, scope: instance, machineWrite: true}\n    - {kind: Runbook, scope: system, revisioned: true}\n    - {kind: Workflow, scope: builtin|system, revisioned: true}\n    - {kind: ServiceInstance, scope: system, statusMachine: true}\n  invariants:\n    - 界面上出现的任何资源标识符必须可点\n    - 渲染数据只来自 Scheme + ops DB，无独立前端状态" }),
    D({ name: 'quality-goal', kind: 'Goal', scope: 'systems/developer-system', revision: 12, generation: 8,
      updated: ago(35), fieldManager: 'root', ownerRefs: ['dev-desc'],
      draftFrom: 'builtinRoot',
      draft:
"apiVersion: core/v1\nkind: Goal\nmetadata:\n  name: quality-goal\n  scope: systems/developer-system\n  ownerRefs:\n    - dev-desc\nspec:\n  intent: |\n    developer-system 交付的每一次变更都必须可验证：\n    红线测试全绿才允许产物入库（digest），\n    修复循环不得引入新的漂移。\n  slo:\n    buildPassRate: '>= 0.92'      # 由 0.90 提升：ci 队列积压时更容易跌破\n    repairSuccessRate: '>= 0.90'  # 由 0.85 提升：配合 avoidRepeatFix 刹车\n    verifyPassRate: '>= 0.95'\n    driftOpenMax: 2\n  review:\n    cadence: weekly\n    reviewer: root\nstatus:\n  progress: at-risk   # onedev 队列积压 14，见 ci-drift-042\n  lastReview: 2026-11-22",
      draftSource: 'llm',
      history: [H(12, 'root', 35, '收紧 buildPassRate 至 0.92'), H(11, 'dev-1', 1500, '增加 driftOpenMax'), H(10, 'root', 4200, '初版')],
      content:
"apiVersion: core/v1\nkind: Goal\nmetadata:\n  name: quality-goal\n  scope: systems/developer-system\n  ownerRefs:\n    - dev-desc\nspec:\n  intent: |\n    developer-system 交付的每一次变更都必须可验证：\n    红线测试全绿才允许产物入库（digest），\n    修复循环不得引入新的漂移。\n  slo:\n    buildPassRate: '>= 0.90'\n    repairSuccessRate: '>= 0.85'\n    verifyPassRate: '>= 0.95'\n    driftOpenMax: 2\n  review:\n    cadence: weekly\n    reviewer: root\nstatus:\n  progress: on-track\n  lastReview: 2026-11-22" }),
    D({ name: 'dev-desc', kind: 'ServiceDesc', scope: 'systems/developer-system', revision: 11, generation: 11,
      updated: ago(600), fieldManager: 'root', ownerRefs: [],
      history: [H(11, 'root', 600, '实例拆分 ci / dev-pool'), H(10, 'root', 9000, '初版')],
      content:
"apiVersion: core/v1\nkind: ServiceDesc\nmetadata:\n  name: dev-desc\n  scope: systems/developer-system\nspec:\n  purpose: 研发交付：pull 源码 → build+test → 产物 digest → 修复循环\n  instances:\n    - {name: ci, agents: [ci-repair-agent, ci-verifier]}\n    - {name: dev-pool, agents: [dev-1]}\n  workservices: [onedev, gitfs, nas]\n  workflows: [dev-delivery, default-task]" }),
    D({ name: 'ci-impl', kind: 'ImplDoc', scope: 'systems/developer-system', instance: 'ci', revision: 8, generation: 6,
      updated: ago(12), fieldManager: 'ci-repair-agent', ownerRefs: ['ci'],
      draftFrom: 'ci-repair-agent',
      draft:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: ci-impl\n  scope: systems/developer-system\n  instance: ci\n  ownerRefs:\n    - ci\nspec:\n  repairLoop:\n    trigger: onedev-ci watch-queue (backlog > 10 或 job failed)\n    steps:\n      - poll-log 拉取失败构建日志（保留尾部 200 行）\n      - 定位失败层：dependency / compile / test\n      - 按 Runbook 决策：重跑 / 降级依赖 / 上报 drift\n      - 修复后必须触发 ci-verifier 探针复测\n    brake:\n      avoidRepeatFix: true    # DriftReport 记录改过什么\n      maxAttemptsPerHour: 3\n  queuePolicy:\n    backlogSoftLimit: 10\n    backlogHardLimit: 20      # 草稿：由 12 上调，配合并行 worker 扩容\n    overflow: escalate-to-builtinRoot",
      draftSource: 'manual',
      history: [H(8, 'ci-repair-agent', 12, '草稿：backlogHardLimit 12→20（待 Apply）'), H(7, 'ci-repair-agent', 90, '增加 avoidRepeatFix 刹车'), H(6, 'root', 1800, '初版')],
      content:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: ci-impl\n  scope: systems/developer-system\n  instance: ci\n  ownerRefs:\n    - ci\nspec:\n  repairLoop:\n    trigger: onedev-ci watch-queue (backlog > 10 或 job failed)\n    steps:\n      - poll-log 拉取失败构建日志（保留尾部 200 行）\n      - 定位失败层：dependency / compile / test\n      - 按 Runbook 决策：重跑 / 降级依赖 / 上报 drift\n      - 修复后必须触发 ci-verifier 探针复测\n    brake:\n      avoidRepeatFix: true\n      maxAttemptsPerHour: 3\n  queuePolicy:\n    backlogSoftLimit: 10\n    backlogHardLimit: 12\n    overflow: escalate-to-builtinRoot" }),
    D({ name: 'ci-verify', kind: 'VerifyDoc', scope: 'systems/developer-system', instance: 'ci', revision: 5, generation: 5,
      updated: ago(300), fieldManager: 'ci-verifier', ownerRefs: ['ci'],
      history: [H(5, 'ci-verifier', 300, '探针集增至 6 条'), H(4, 'root', 2200, '初版')],
      content:
"apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: ci-verify\n  scope: systems/developer-system\n  instance: ci\nspec:\n  probes:\n    - {id: queue-drain, expect: 'backlog 回落 < 10 在 15m 内'}\n    - {id: repair-green, expect: '修复后首轮构建 exit 0'}\n    - {id: verifier-pass, expect: 'ci-verifier 6/6 探针通过'}\n    - {id: no-repeat-fix, expect: 'DriftReport 无同类重复修复'}\n    - {id: digest-match, expect: 'oss 产物 digest 与构建一致'}\n    - {id: notify-outlet, expect: 'bind-role 收到收敛回执'}" }),
    D({ name: 'ci-drift-042', kind: 'DriftReport', scope: 'systems/developer-system', instance: 'ci', revision: 1, generation: 1,
      updated: ago(26), fieldManager: 'workflow/dev-delivery', ownerRefs: ['ci'], status: 'Open', machineWrite: true,
      history: [H(1, 'workflow/dev-delivery', 26, '机器直写：发现队列配置漂移')],
      content:
"apiVersion: core/v1\nkind: DriftReport\nmetadata:\n  name: ci-drift-042\n  scope: systems/developer-system\n  instance: ci\nstatus: Open\nspec:\n  detected: 2026-11-23T09:41+08:00\n  observed: onedev-ci 队列 backlogHardLimit=12，实际 onedev 侧 parallel=4 无上限\n  expected: ImplDoc queuePolicy.backlogHardLimit=12 生效\n  severity: warn\n  remediation: ci-repair-agent 起草 queuePolicy 调整（草稿待 Apply）\n  fixedBy: null" }),
    D({ name: 'dev-impl', kind: 'ImplDoc', scope: 'systems/developer-system', instance: 'dev-pool', revision: 4, generation: 4,
      updated: ago(700), fieldManager: 'dev-1', ownerRefs: ['dev-pool'],
      history: [H(4, 'dev-1', 700, 'pull 策略改 shallow clone')],
      content:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: dev-impl\n  scope: systems/developer-system\n  instance: dev-pool\nspec:\n  pull: {source: 'gitfs:///srv/git/dsh-core', strategy: shallow, depth: 1}\n  build: {runner: onedev-ci, jdk: 21, redLines: [unit, lint, license]}\n  artifact: {target: 'nas:///mnt/builds/$DIGEST', then: oss-artifacts.put}" }),
    D({ name: 'dev-verify', kind: 'VerifyDoc', scope: 'systems/developer-system', instance: 'dev-pool', revision: 3, generation: 3,
      updated: ago(720), fieldManager: 'dev-1', ownerRefs: ['dev-pool'],
      history: [H(3, 'dev-1', 720, '增加红线 lint')],
      content:
"apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: dev-verify\n  scope: systems/developer-system\n  instance: dev-pool\nspec:\n  probes:\n    - {id: build-green, expect: '红线全绿后产物才入库'}\n    - {id: digest-intact, expect: 'oss digest 校验通过'}" }),
    D({ name: 'deploy-desc', kind: 'ServiceDesc', scope: 'systems/deploy-system', revision: 7, generation: 7,
      updated: ago(900), fieldManager: 'root', ownerRefs: [],
      history: [H(7, 'root', 900, '增加 prod 高危门禁声明')],
      content:
"apiVersion: core/v1\nkind: ServiceDesc\nmetadata:\n  name: deploy-desc\n  scope: systems/deploy-system\nspec:\n  purpose: 按 DeployDesign.envs 升序发布\n  instances:\n    - {name: prod, agents: [dep-1], autoLevel: ask}\n    - {name: staging, agents: [dep-1], autoLevel: auto}\n  workservices: [oss, nas]\n  workflows: [deploy-rollout]" }),
    D({ name: 'deploy-goal', kind: 'Goal', scope: 'systems/deploy-system', revision: 4, generation: 4,
      updated: ago(1500), fieldManager: 'root', ownerRefs: ['deploy-desc'],
      history: [H(4, 'root', 1500, 'prod 门禁写死为 ask')],
      content:
"apiVersion: core/v1\nkind: Goal\nmetadata:\n  name: deploy-goal\n  scope: systems/deploy-system\nspec:\n  intent: |\n    发布永远是升序渐进：dev → staging → prod。\n    prod 段必须人批（ask 档），绝不自动越段。\n  slo:\n    rolloutSuccessRate: '>= 0.97'\n    rollbackTimeMinutes: 5" }),
    D({ name: 'deploy-impl', kind: 'ImplDoc', scope: 'systems/deploy-system', revision: 6, generation: 5,
      updated: ago(60), fieldManager: 'dep-1', ownerRefs: ['prod', 'staging'],
      history: [H(6, 'dep-1', 60, '增加回滚检查点'), H(5, 'dep-1', 2600, '初版')],
      content:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: deploy-impl\n  scope: systems/deploy-system\n  instance: '*'\nspec:\n  order: [dev, staging, prod]\n  gate:\n    staging: auto\n    prod: ask        # ApprovalNeeded → console 审批页\n  rollback:\n    checkpoint: per-env\n    maxTimeMinutes: 5\n  artifact: {from: 'oss://builds/$DIGEST', verify: digest}" }),
    D({ name: 'deploy-verify', kind: 'VerifyDoc', scope: 'systems/deploy-system', revision: 2, generation: 2,
      updated: ago(2400), fieldManager: 'dep-1', ownerRefs: ['prod'],
      history: [H(2, 'dep-1', 2400, '增加 prod 探针')],
      content:
"apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: deploy-verify\n  scope: systems/deploy-system\nspec:\n  probes:\n    - {id: env-order, expect: 'envs 严格升序，无跳段'}\n    - {id: prod-approved, expect: 'prod 段存在已批准的 Approval'}" }),
    D({ name: 'escalated-drift', kind: 'DriftReport', scope: 'systems/deploy-system', instance: 'prod', revision: 1, generation: 1,
      updated: ago(18), fieldManager: 'workflow/deploy-rollout', ownerRefs: ['prod'], status: 'Escalated', machineWrite: true,
      history: [H(1, 'workflow/deploy-rollout', 18, '机器直写：prod 门禁拦截上报')],
      content:
"apiVersion: core/v1\nkind: DriftReport\nmetadata:\n  name: escalated-drift\n  scope: systems/deploy-system\n  instance: prod\nstatus: Escalated\nspec:\n  detected: 2026-11-23T10:05+08:00\n  observed: rollout 停在 staging→prod，gate=ask 无人在环超 15m\n  expected: prod 段审批通过后继续\n  severity: fatal\n  remediation: escalate-to-root（console 审批页待批）\n  fixedBy: null" }),
    D({ name: 'deploy-runbook', kind: 'Runbook', scope: 'systems/deploy-system', revision: 2, generation: 2,
      updated: ago(3000), fieldManager: 'root', ownerRefs: ['dep-1'],
      history: [H(2, 'root', 3000, '回滚步骤细化')],
      content:
"# Runbook: 发布卡住怎么办\n\n1. 查 escalated-drift 的 severity 与卡住 env。\n2. staging 段问题：dep-1 自动回滚检查点，无需人工。\n3. prod 段问题：必须在审批页批准或驳回；\n   驳回 = 回滚到 staging 最后好版本（digest 回源 oss）。\n4. 处理后 tick 会在 10m 内对账追平 Status。" }),
    D({ name: 'storage-desc', kind: 'ServiceDesc', scope: 'systems/storage-system', revision: 4, generation: 4,
      updated: ago(1800), fieldManager: 'root', ownerRefs: [],
      history: [H(4, 'root', 1800, 'oss 降级声明')],
      content:
"apiVersion: core/v1\nkind: ServiceDesc\nmetadata:\n  name: storage-desc\n  scope: systems/storage-system\nspec:\n  purpose: 产物存储：nas 本地卷 + oss 对象存储\n  instances:\n    - {name: nas-oss, agents: [builtinRoot]}\n  workservices: [nas, oss]" }),
    D({ name: 'storage-impl', kind: 'ImplDoc', scope: 'systems/storage-system', instance: 'nas-oss', revision: 3, generation: 3,
      updated: ago(2000), fieldManager: 'builtinRoot', ownerRefs: ['nas-oss'],
      history: [H(3, 'builtinRoot', 2000, 'digest 校验前置')],
      content:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: storage-impl\n  scope: systems/storage-system\n  instance: nas-oss\nspec:\n  pipeline: nas → oss-artifacts.put（先 verify-digest 再入库）\n  retention: {nas: 30d, oss: 180d}" }),
    D({ name: 'storage-verify', kind: 'VerifyDoc', scope: 'systems/storage-system', instance: 'nas-oss', revision: 2, generation: 2,
      updated: ago(2100), fieldManager: 'builtinRoot', ownerRefs: ['nas-oss'],
      history: [H(2, 'builtinRoot', 2100, '初版')],
      content:
"apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: storage-verify\n  scope: systems/storage-system\n  instance: nas-oss\nspec:\n  probes:\n    - {id: digest-match, expect: 'oss/nas digest 一致'}\n    - {id: lag-ok, expect: 'oss_sync_lag < 120s'}" }),
    D({ name: 'self-desc', kind: 'ServiceDesc', scope: 'systems/self-recursive-core', revision: 9, generation: 9,
      updated: ago(500), fieldManager: 'root', ownerRefs: [],
      history: [H(9, 'root', 500, '对账周期 10m→5m')],
      content:
"apiVersion: core/v1\nkind: ServiceDesc\nmetadata:\n  name: self-desc\n  scope: systems/self-recursive-core\nspec:\n  purpose: 自递归内核：对账、审批、树索引\n  instances:\n    - {name: default, agents: [builtinRoot]}\n  workflows: [core-workflow, watch-only, apply-workflow, simple-shot, default-task]" }),
    D({ name: 'core-impl', kind: 'ImplDoc', scope: 'systems/self-recursive-core', instance: 'default', revision: 7, generation: 6,
      updated: ago(800), fieldManager: 'builtinRoot', ownerRefs: ['default'],
      history: [H(7, 'builtinRoot', 800, 'tick 周期改 5m')],
      content:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: core-impl\n  scope: systems/self-recursive-core\n  instance: default\nspec:\n  tick: {period: 5m, jitter: 10%}\n  reconcile: {order: [docs, instances, workflows, mounts]}\n  escalate: {to: root, via: agent-comm.interrupt}" }),
    D({ name: 'core-verify', kind: 'VerifyDoc', scope: 'systems/self-recursive-core', instance: 'default', revision: 4, generation: 4,
      updated: ago(820), fieldManager: 'builtinRoot', ownerRefs: ['default'],
      history: [H(4, 'builtinRoot', 820, '初版')],
      content:
"apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: core-verify\n  scope: systems/self-recursive-core\n  instance: default\nspec:\n  probes:\n    - {id: tick-fresh, expect: 'tick_lag < 30s'}\n    - {id: ids-clickable, expect: '树上标识符 100% 可点（console 自检）'}" }),
    D({ name: 'conn-desc-sd', kind: 'ServiceDesc', scope: 'systems/connector', revision: 5, generation: 5,
      updated: ago(1100), fieldManager: 'root', ownerRefs: [],
      history: [H(5, 'root', 1100, '挂载 agent-comm')],
      content:
"apiVersion: core/v1\nkind: ServiceDesc\nmetadata:\n  name: conn-desc-sd\n  scope: systems/connector\nspec:\n  purpose: 连接层：WorkService / ConnectorOps / Provider\n  instances:\n    - {name: mesh-1, agents: [builtinRoot]}\n  workservices: [onedev, gitfs, nas, oss]\n  connectorops: [onedev-ci, gotty-web, agent-comm, oss-artifacts]\n  providers: [onedev-robot, llm-main]" }),
    D({ name: 'connector-impl', kind: 'ImplDoc', scope: 'systems/connector', instance: 'mesh-1', revision: 5, generation: 4,
      updated: ago(1400), fieldManager: 'builtinRoot', ownerRefs: ['mesh-1'],
      history: [H(5, 'builtinRoot', 1400, '挂载心跳 30s')],
      content:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: connector-impl\n  scope: systems/connector\n  instance: mesh-1\nspec:\n  mounts:\n    - {name: onedev-ci, heartbeat: 30s}\n    - {name: gotty-web, heartbeat: 30s, runner: default-gotty}\n    - {name: agent-comm, transport: inbox}\n    - {name: oss-artifacts, digest: sha256}\n  remediate: 重建挂载（指数退避 30s*2^n，max 3 次）" }),
    D({ name: 'connector-verify', kind: 'VerifyDoc', scope: 'systems/connector', instance: 'mesh-1', revision: 3, generation: 3,
      updated: ago(1500), fieldManager: 'builtinRoot', ownerRefs: ['mesh-1'],
      history: [H(3, 'builtinRoot', 1500, '初版')],
      content:
"apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: connector-verify\n  scope: systems/connector\n  instance: mesh-1\nspec:\n  probes:\n    - {id: mounts-4of4, expect: '全部挂载心跳新鲜'}\n    - {id: comm-p95, expect: 'dispatch p95 < 800ms'}" }),
    D({ name: 'conn-drift-017', kind: 'DriftReport', scope: 'systems/connector', instance: 'mesh-1', revision: 1, generation: 1,
      updated: ago(14), fieldManager: 'workflow/core-workflow', ownerRefs: ['mesh-1'], status: 'Remediating', machineWrite: true,
      history: [H(1, 'workflow/core-workflow', 14, '机器直写：gotty-web 心跳超时')],
      content:
"apiVersion: core/v1\nkind: DriftReport\nmetadata:\n  name: conn-drift-017\n  scope: systems/connector\n  instance: mesh-1\nstatus: Remediating\nspec:\n  detected: 2026-11-23T10:12+08:00\n  observed: gotty-web 心跳 3 次超时（>90s）\n  expected: heartbeat 30s\n  severity: warn\n  remediation: 正在重建挂载（attempt 1/3）\n  fixedBy: null" }),
    D({ name: 'connector-desc', kind: 'Desc', scope: 'systems/connector', revision: 2, generation: 2,
      updated: ago(2600), fieldManager: 'root', ownerRefs: ['conn-desc-sd'],
      history: [H(2, 'root', 2600, '补充 runner 说明')],
      content:
"# connector 系统说明\n\nconnector 系统是连接层：把外部世界（git/CI/存储/终端）\n包装成 WorkService + ConnectorOps，供 Agent 与 Workflow 调用。\n\ngotty-web 挂载默认支持网页终端接入；\n会话 runner 可选 opencode cli / claude-code / 内嵌 dsh。" }),
    D({ name: 'connector-runbook', kind: 'Runbook', scope: 'systems/connector', revision: 1, generation: 1,
      updated: ago(2800), fieldManager: 'builtinRoot', ownerRefs: ['builtinRoot'],
      history: [H(1, 'builtinRoot', 2800, '初版')],
      content:
"# Runbook: 挂载心跳超时\n\n1. 看 conn-drift-* 最新一条的 observed。\n2. attempt < 3：不干预，Remediating 自愈。\n3. attempt = 3 且 Failed：检查 WorkService endpoint，\n   修复后在系统详情页点「触发对账」。" }),
    D({ name: 'user-desc-sd', kind: 'ServiceDesc', scope: 'systems/user-system', revision: 3, generation: 3,
      updated: ago(1600), fieldManager: 'root', ownerRefs: [],
      history: [H(3, 'root', 1600, '初版')],
      content:
"apiVersion: core/v1\nkind: ServiceDesc\nmetadata:\n  name: user-desc-sd\n  scope: systems/user-system\nspec:\n  purpose: 会话、通知出口（Notification）与 bind-role\n  instances:\n    - {name: default, agents: [builtinRoot]}\n  refs: [user-system/notify]" }),
    D({ name: 'user-impl', kind: 'ImplDoc', scope: 'systems/user-system', instance: 'default', revision: 2, generation: 2,
      updated: ago(1700), fieldManager: 'builtinRoot', ownerRefs: ['default'],
      history: [H(2, 'builtinRoot', 1700, '初版')],
      content:
"apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: user-impl\n  scope: systems/user-system\n  instance: default\nspec:\n  notification: {on: [DocApplied, ApprovalNeeded, Escalated], via: bind-role}" }),
    D({ name: 'user-verify', kind: 'VerifyDoc', scope: 'systems/user-system', instance: 'default', revision: 1, generation: 1,
      updated: ago(1750), fieldManager: 'builtinRoot', ownerRefs: ['default'],
      history: [H(1, 'builtinRoot', 1750, '初版')],
      content:
"apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: user-verify\n  scope: systems/user-system\n  instance: default\nspec:\n  probes:\n    - {id: deliver-rate, expect: '>= 0.99'}" }),
    D({ name: 'watcher-goal', kind: 'Goal', scope: 'systems/connector', revision: 1, generation: 1,
      updated: ago(20), fieldManager: 'builtinRoot', ownerRefs: ['conn-desc-sd'],
      draftFrom: 'builtinRoot',
      draft:
"apiVersion: core/v1\nkind: Goal\nmetadata:\n  name: watcher-goal\n  scope: systems/connector\nspec:\n  intent: |\n    watch-only 只观察不执行：盯 workflow 成功率、死信与成本，\n    异常回 Event 走修复循环（自举监控）。\n  thresholds:\n    successRateMin: '0.90'   # 草稿：由 0.85 收紧，deploy-rollout 近期波动\n    deadLetterMax: '0.01'\n    costPerDayUsdMax: 12",
      draftSource: 'llm',
      history: [H(1, 'builtinRoot', 4300, '初版')],
      content:
"apiVersion: core/v1\nkind: Goal\nmetadata:\n  name: watcher-goal\n  scope: systems/connector\nspec:\n  intent: |\n    watch-only 只观察不执行：盯 workflow 成功率、死信与成本，\n    异常回 Event 走修复循环（自举监控）。\n  thresholds:\n    successRateMin: '0.85'\n    deadLetterMax: '0.01'\n    costPerDayUsdMax: 12" }),
    D({ name: 'budget-rule', kind: 'Rule', scope: 'global', revision: 2, generation: 2,
      updated: ago(3300), fieldManager: 'root', ownerRefs: ['core-scheme'],
      history: [H(2, 'root', 3300, '日预算 15 USD')],
      content:
"apiVersion: core/v1\nkind: Rule\nmetadata:\n  name: budget-rule\n  scope: global\nspec:\n  statement: |\n    LLM token 日预算 15 USD（llm-main）。越线 → MetricThreshold\n    事件 → watch-only 收敛（先降档 flash-tier，再暂停低优 workflow）。" })
  ];
  // ---------- Workflow（相位态机 + 运行轮次 + 流转流水） ----------
  var FSM = ['Idle', 'Analyzing', 'Planning', 'AwaitingApproval', 'Executing', 'Verifying', 'Reporting'];
  var FSM_ABNORMAL = ['Failed', 'Paused'];

  var OPS_POOL = [
    { op: 'onedev-ci.build', d: '触发构建 job #{n}（branch: main）' },
    { op: 'onedev-ci.poll-log', d: '拉取构建日志尾部 200 行' },
    { op: 'onedev-ci.watch-queue', d: '注册队列 watch（backlog 阈值 10）' },
    { op: 'gitfs.pull', d: 'shallow clone depth=1 @ main' },
    { op: 'gitfs.commit', d: '文档落库（经 Apply，fieldManager=workflow/{wf}）' },
    { op: 'oss-artifacts.put', d: '产物入库 digest=sha256:{h}' },
    { op: 'oss-artifacts.verify-digest', d: 'digest 校验通过' },
    { op: 'agent-comm.dispatch', d: '委派子任务（token 下发，权限 ⊆ 父）' },
    { op: 'agent-comm.query', d: '询问子 agent 当前进度' },
    { op: 'agent-comm.interrupt', d: '打断子 agent（Escalate 通道）' },
    { op: 'gotty-web.exec', d: '终端执行 status 采集' }
  ];

  function hex(n, rnd) { var s = ''; for (var i = 0; i < n; i++) s += '0123456789abcdef'[(rnd() * 16) | 0]; return s; }
  function fmtMin(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function genActions(wf, rnd, count) {
    var acts = [], t = rnd() * 30 + 5;
    for (var i = 0; i < count; i++) {
      var p = OPS_POOL[(rnd() * OPS_POOL.length) | 0];
      t += (rnd() * 90 + 20) | 0;
      acts.push({
        ts: ago(t),
        op: p.op.replace('{n}', String(1 + ((rnd() * 400) | 0))).replace('{h}', hex(6, rnd)).replace('{wf}', wf.name),
        detail: p.d.replace('{n}', String(1 + ((rnd() * 400) | 0))).replace('{h}', hex(6, rnd)).replace('{wf}', wf.name)
      });
    }
    return acts;
  }

  function genTimeline(phases, startMin, rnd, opts) {
    opts = opts || {};
    var tl = [], t = startMin, seq = phases.slice();
    if (!seq.length) return tl;
    for (var i = 0; i < seq.length; i++) {
      var ph = seq[i], dur = (rnd() * 4 + 1) * 3 | 0;
      var note = '';
      if (ph === 'Analyzing') note = opts.analyzeNote || '读 L0/L1 文档，对比现实';
      else if (ph === 'Planning') note = '选定 TaskScheme：' + (opts.scheme || 'default-task');
      else if (ph === 'AwaitingApproval') note = opts.gateNote || '高危命中 ask 档，ApprovalNeeded 已发';
      else if (ph === 'Executing') note = opts.execNote || '经 ConnectorOps 执行（action log 见抽屉）';
      else if (ph === 'Verifying') note = opts.verifyNote || '探针复测 ' + (2 + ((rnd() * 4) | 0)) + '/组全绿';
      else if (ph === 'Reporting') note = 'Status 追平 + DriftReport 归档 + DocApplied';
      else if (ph === 'Failed') note = opts.failNote || 'attempt 1 失败，backoff 30s*2^n';
      else if (ph === 'Paused') note = opts.pauseNote || 'Escalate→pause，断点保留，等待 Resume';
      var state = (i === seq.length - 1) ? (opts.lastState || 'done') : 'done';
      tl.push({ phase: ph, ts: ago(t), dur: dur, state: state, note: note });
      t -= dur;
    }
    return tl;
  }

  function genRuns(wf, n, seed) {
    var rnd = mulberry32(seed), runs = [];
    var triggers = ['event: ExternalChanged', 'event: MetricThreshold', 'timer: resync 10m', 'manual: root'];
    for (var i = 0; i < n; i++) {
      var idx = i + 1, failed = rnd() < (1 - wf.successRate / 100);
      var trig = triggers[(rnd() * triggers.length) | 0];
      var startT = 40 + i * (60 + rnd() * 200);
      var durM = (rnd() * 16 + 2) | 0;
      var seq = ['Analyzing', 'Planning'];
      if (rnd() < 0.3) seq.push('AwaitingApproval');
      seq.push('Executing', 'Verifying', 'Reporting');
      if (failed) { seq = ['Analyzing', 'Planning', 'Executing', 'Failed']; }
      var tl = genTimeline(seq, startT, rnd, { lastState: 'done', failNote: failed ? '探针红线未绿：verify_pass 0.71，backoff 30s' : null });
      runs.push({
        no: idx, trigger: trig, start: ago(startT), durMin: durM,
        phase: 'Idle', status: failed ? 'failed' : 'ok',
        result: failed ? 'Failed：' + ['探针未绿', '依赖拉取超时', '审批驳回'][ (rnd() * 3) | 0 ] : '收敛完成，Status 已追平',
        docsCount: 2 + ((rnd() * 3) | 0),
        timeline: tl,
        actions: genActions(wf, rnd, 3 + ((rnd() * 3) | 0)),
        session: 'sess-' + wf.name + '-' + idx
      });
    }
    return runs;
  }

  var workflows = [
    {
      name: 'core-workflow', scope: 'global', builtin: true, origin: 'builtin', enabled: true, phase: 'Verifying',
      runsTotal: 128, runs24h: 6, successRate: 96.8, lastRun: ago(9), activeRun: 129,
      specDoc: null, involvedDocs: ['core-goal', 'apply-rule', 'core-scheme'],
      services: { involved: ['self-recursive-core', 'developer-system', 'deploy-system'], mode: 'act', llm: { provider: 'llm-main', model: 'flash-tier' } },
      triggers: 'events: ExternalChanged, MetricThreshold (minLevel warn) · timer: resync 10m',
      brakes: 'cooldown 2m · maxMutationsPerTick 10 · avoidRepeatFix true',
      regression: 'statusWriteback true · reports: [DriftReport, SessionLog]',
      onEscalate: 'pause（断点保留，人批 Resume=Apply）',
      dataflow: {
        inputs: [{ events: ['ExternalChanged', 'MetricThreshold'], docs: 'global/*' }],
        process: 'analysis → autolevel 裁决（auto / ask）→ plan → ConnectorOps 执行 → status 回写',
        outputs: [{ status: 'self', notify: ['bind-role'], reports: ['DriftReport', 'SessionLog'] }]
      },
      activeApproval: null
    },
    {
      name: 'dev-delivery', scope: 'systems/developer-system', builtin: true, origin: 'builtin（系统 override 生效层）', enabled: true, phase: 'Executing',
      runsTotal: 42, runs24h: 8, successRate: 88.1, lastRun: ago(4), activeRun: 43,
      specDoc: 'dev-delivery-spec', involvedDocs: ['quality-goal', 'ci-impl', 'dev-delivery-spec', 'ci-drift-042'],
      services: { involved: ['developer-system', 'deploy-system'], mode: 'act', llm: { provider: 'llm-main', model: 'flash-tier' } },
      triggers: 'events: onedev 错误日志 ≥error / 新需求 / 用户请求 · timer: resync 10m',
      brakes: 'cooldown 2m · maxMutationsPerTick 10 · avoidRepeatFix true',
      regression: 'statusWriteback true · reports: [DriftReport, SessionLog]',
      onEscalate: 'finish-tick（跑完本轮再停，防半成品）',
      stages: [
        { id: 'analyze', label: 'Analyze', note: '定位错误/拆解需求' },
        { id: 'gate', label: 'Gate', note: '高危人批，auto 白名单直过' },
        { id: 'plan', label: 'Plan', note: '选 TaskScheme 模板' },
        { id: 'execute', label: 'Execute', note: 'pull → build+test 红线全绿 → digest' },
        { id: 'verify', label: 'Verify', note: '探针复测' },
        { id: 'deploy', label: 'Deploy', note: 'envs 升序发布，prod 人批' },
        { id: 'report', label: 'Report', note: 'Status 追平+归档+Event' }
      ],
      dataflow: {
        inputs: [{ events: ['ExternalChanged(onedev)', 'MetricThreshold(queue)', '用户请求'], docs: 'systems/developer-system/*' }],
        process: 'Analyze → Gate → Plan(选 TaskScheme) → Execute(developer-system pull/build/test) → Verify → Deploy → Report',
        outputs: [{ status: 'self', notify: ['bind-role'], artifacts: 'oss://builds', reports: ['DriftReport', 'SessionLog'] }]
      },
      activeApproval: 'ap-1'
    },
    {
      name: 'default-task', scope: 'global', builtin: true, origin: 'builtin', enabled: true, phase: 'Idle',
      runsTotal: 310, runs24h: 12, successRate: 99.2, lastRun: ago(22), activeRun: null,
      specDoc: null, involvedDocs: ['core-goal'],
      services: { involved: [], mode: 'act', llm: { provider: 'llm-main', model: 'flash-tier' } },
      triggers: 'agent 引用（单任务态机）',
      brakes: 'maxMutationsPerTick 10',
      regression: 'reports: [SessionLog]',
      onEscalate: 'continue（只通知不暂停）',
      dataflow: {
        inputs: [{ events: ['agent dispatch'], docs: 'task payload' }],
        process: '单任务执行态机（Agent 引用）',
        outputs: [{ status: 'session', reports: ['SessionLog'] }]
      },
      activeApproval: null
    },
    {
      name: 'simple-shot', scope: 'global', builtin: true, origin: 'builtin', enabled: true, phase: 'Idle',
      runsTotal: 96, runs24h: 3, successRate: 97.9, lastRun: ago(52), activeRun: null,
      specDoc: null, involvedDocs: ['apply-rule'],
      services: { involved: [], mode: 'act', llm: { provider: 'llm-main', model: 'flash-tier' } },
      triggers: 'manual / event 单发',
      brakes: 'cooldown 30s',
      regression: 'reports: [SessionLog]',
      onEscalate: 'pause',
      dataflow: {
        inputs: [{ events: ['manual', 'Event'], docs: '-' }],
        process: '简单派发：一次 ConnectorOps 调用 + 回执',
        outputs: [{ status: 'session' }]
      },
      activeApproval: null
    },
    {
      name: 'watch-only', scope: 'global', builtin: true, origin: 'builtin', enabled: true, phase: 'Reporting',
      runsTotal: 77, runs24h: 5, successRate: 100, lastRun: ago(7), activeRun: 77,
      specDoc: null, involvedDocs: ['watcher-goal', 'budget-rule'],
      services: { involved: ['connector'], mode: 'observe', llm: { provider: 'llm-main', model: 'flash-tier' } },
      triggers: 'events: MetricThreshold · timer: resync 5m',
      brakes: 'observe-only（无变更权限）',
      regression: 'reports: [DriftReport（只读观察）]',
      onEscalate: 'notify only',
      dataflow: {
        inputs: [{ events: ['MetricThreshold', 'DeadLetter'], docs: 'global/workflows/*' }],
        process: '只观察：成功率/死信/成本聚合，异常回 Event（自举监控）',
        outputs: [{ notify: ['bind-role'], reports: ['DriftReport'] }]
      },
      activeApproval: null
    },
    {
      name: 'apply-workflow', scope: 'global', builtin: true, origin: 'builtin', enabled: false, phase: 'Idle',
      runsTotal: 15, runs24h: 0, successRate: 93.3, lastRun: ago(5400), activeRun: null,
      specDoc: null, involvedDocs: ['core-scheme', 'apply-rule'],
      services: { involved: ['connector', 'developer-system'], mode: 'act', llm: { provider: 'llm-main', model: 'flash-tier' } },
      triggers: 'WorkflowRegistered / spec 变更',
      brakes: 'maxMutationsPerTick 5',
      regression: 'reports: [SessionLog]',
      onEscalate: 'pause',
      dataflow: {
        inputs: [{ events: ['WorkflowRegistered'], docs: 'global/workflows/*' }],
        process: '解析 spec 接线触发源 → 缺的连接层调 developer-system（pull/写 connector/build）→ 落地后注册 watch-only 自监控',
        outputs: [{ status: 'self', notify: ['bind-role'] }]
      },
      activeApproval: null
    },
    {
      name: 'deploy-rollout', scope: 'systems/deploy-system', builtin: false, origin: 'systems/deploy-system/workflows/deploy-rollout.yaml', enabled: true, phase: 'AwaitingApproval',
      runsTotal: 31, runs24h: 3, successRate: 87.5, lastRun: ago(18), activeRun: 31,
      specDoc: null, involvedDocs: ['deploy-goal', 'deploy-impl', 'deploy-verify', 'escalated-drift'],
      services: { involved: ['deploy-system', 'storage-system'], mode: 'act', llm: { provider: 'llm-main', model: 'flash-tier' } },
      triggers: 'events: ArtifactReady(digest) · timer: resync 10m',
      brakes: 'cooldown 5m · per-env checkpoint',
      regression: 'statusWriteback true · reports: [DriftReport]',
      onEscalate: 'pause（prod 门禁无人在环 → Escalated）',
      dataflow: {
        inputs: [{ events: ['ArtifactReady'], docs: 'systems/deploy-system/*' }],
        process: '取 digest → dev → staging → prod（ask 门禁）逐段验证',
        outputs: [{ status: 'self', notify: ['bind-role'], artifacts: 'oss://releases' }]
      },
      activeApproval: 'ap-1'
    }
  ];

  // dev-delivery / core-workflow / deploy-rollout / watch-only 的活跃轮手写，其余历史轮生成
  function buildRuns() {
    var rnd = mulberry32(777);
    workflows.forEach(function (wf, wi) {
      var gen = genRuns(wf, 12, 1000 + wi * 97);
      if (wf.name === 'dev-delivery') {
        gen.unshift({
          no: 43, trigger: 'event: ExternalChanged(onedev-ci queue)', start: ago(26), durMin: null,
          phase: 'Executing', status: 'running',
          result: '修复 ci 队列漂移：queuePolicy 草稿已备，待 Apply 后验证',
          docsCount: 4,
          timeline: [
            { phase: 'Analyzing', ts: ago(26), dur: 4, state: 'done', note: '定位 ci-drift-042：backlogHardLimit 与 onedev 实际不一致' },
            { phase: 'Planning', ts: ago(22), dur: 3, state: 'done', note: '选定 TaskScheme：ci-queue-remediate' },
            { phase: 'Executing', ts: ago(19), dur: 0, state: 'current', note: 'ci-repair-agent 改 ImplDoc 草稿 + 待 ci-verifier 复测' }
          ],
          actions: [
            { ts: ago(25), op: 'onedev-ci.watch-queue', detail: '注册队列 watch（backlog 阈值 10，当前 14）' },
            { ts: ago(24), op: 'onedev-ci.poll-log', detail: '拉取 job #3871 日志：3 个 test 超时' },
            { ts: ago(20), op: 'agent-comm.dispatch', detail: '→ ci-repair-agent（token: systems/developer-system/ci ⊆ 父）' },
            { ts: ago(16), op: 'agent-comm.query', detail: 'ci-verifier 回报：探针 5/6，queue-drain 未过' },
            { ts: ago(12), op: 'gitfs.commit', detail: '草稿写入 ci-impl（未 Apply，不发事件）' }
          ],
          session: 'sess-repair-1'
        });
      } else if (wf.name === 'core-workflow') {
        gen.unshift({
          no: 129, trigger: 'timer: resync 10m', start: ago(9), durMin: null,
          phase: 'Verifying', status: 'running',
          result: '全系统对账轮：connector gotty-web 挂载重建验证中',
          docsCount: 3,
          timeline: [
            { phase: 'Analyzing', ts: ago(9), dur: 2, state: 'done', note: 'diff Scheme 与实际挂载表' },
            { phase: 'Planning', ts: ago(7), dur: 1, state: 'done', note: 'auto 直执行（权限白名单内）' },
            { phase: 'Executing', ts: ago(6), dur: 2, state: 'done', note: 'gotty-web 挂载重建 attempt 1' },
            { phase: 'Verifying', ts: ago(4), dur: 0, state: 'current', note: '心跳 2/3 样本新鲜，等第 3 个样本' }
          ],
          actions: [
            { ts: ago(8), op: 'gotty-web.exec', detail: '终端探活：tty-0 回 200，tty-1 超时' },
            { ts: ago(6), op: 'agent-comm.interrupt', detail: '→ mesh-1 builtinRoot：重建挂载（Escalate 通道未用）' },
            { ts: ago(5), op: 'oss-artifacts.verify-digest', detail: '采样校验 builds/3f2a…9c 通过' }
          ],
          session: 'sess-core-129'
        });
      } else if (wf.name === 'deploy-rollout') {
        gen.unshift({
          no: 31, trigger: 'event: ArtifactReady(digest 3f2a…9c)', start: ago(33), durMin: null,
          phase: 'AwaitingApproval', status: 'waiting',
          result: 'staging 绿 → prod 门禁 ask，等待审批（已 Escalated 18m）',
          docsCount: 3,
          timeline: [
            { phase: 'Analyzing', ts: ago(33), dur: 2, state: 'done', note: '校验 digest 3f2a…9c 与构建一致' },
            { phase: 'Planning', ts: ago(31), dur: 2, state: 'done', note: 'envs 升序：dev → staging → prod' },
            { phase: 'Executing', ts: ago(29), dur: 6, state: 'done', note: 'dev ✅ staging ✅（探针全绿）' },
            { phase: 'AwaitingApproval', ts: ago(23), dur: 0, state: 'current', note: 'prod 门禁 ask → ApprovalNeeded → 无人在环 15m → Escalated' }
          ],
          actions: [
            { ts: ago(32), op: 'oss-artifacts.verify-digest', detail: '3f2a…9c 校验通过' },
            { ts: ago(29), op: 'gotty-web.exec', detail: 'staging 段发布脚本 exit 0' },
            { ts: ago(23), op: 'agent-comm.dispatch', detail: '→ builtinRoot：prod 审批请求（ApprovalNeeded）' },
            { ts: ago(18), op: 'agent-comm.interrupt', detail: 'Escalate → root：prod 门禁无人在环' }
          ],
          session: 'sess-dep-1'
        });
      } else if (wf.name === 'watch-only') {
        gen.unshift({
          no: 77, trigger: 'timer: resync 5m', start: ago(7), durMin: null,
          phase: 'Reporting', status: 'running',
          result: '观察轮：workflow 成功率 92.4%（阈值 0.90 之上），死信 0.8%',
          docsCount: 2,
          timeline: [
            { phase: 'Analyzing', ts: ago(7), dur: 2, state: 'done', note: '聚合 6 workflow 24h 指标' },
            { phase: 'Reporting', ts: ago(5), dur: 0, state: 'current', note: '写观察 DriftReport（只读，不执行）' }
          ],
          actions: [
            { ts: ago(6), op: 'agent-comm.query', detail: 'inbox 采样：12 条待读，0 条死信新增' }
          ],
          session: 'sess-core-77'
        });
      }
      wf.runs = gen;
      if (wf.enabled === false) wf.runs = gen.slice(0, 6);
    });
  }
  buildRuns();

  // 流转流水（每轮相位进出 ×2 行，总量 >800）
  var transitions = [];
  workflows.forEach(function (wf) {
    wf.runs.forEach(function (r) {
      var prev = 'Idle';
      r.timeline.forEach(function (tl, i) {
        var durS = (tl.dur || 1) * 60;
        transitions.push({ wf: wf.name, run: r.no, dir: 'in', phase: tl.phase, ts: tl.ts, reason: 'from ' + prev, note: tl.note });
        transitions.push({ wf: wf.name, run: r.no, dir: 'out', phase: tl.phase, ts: new Date(tl.ts.getTime() + durS * 60000 * 0.9), reason: (tl.state === 'current' ? 'holding' : '→ ' + (r.timeline[i + 1] ? r.timeline[i + 1].phase : 'Idle')), note: (tl.state === 'current' ? '当前相位' : '耗时 ' + tl.dur + 'm') });
        prev = tl.phase;
      });
      transitions.push({ wf: wf.name, run: r.no, dir: 'out', phase: prev, ts: r.start, reason: '→ Idle', note: r.status === 'running' ? '运行中' : '回归完成，冷却 2m' });
    });
  });
  // 补足历史轮流水至 800+（生成轮的 timeline 已含；下面再补旧批次）
  (function () {
    var rnd = mulberry32(31337);
    for (var batch = 0; batch < 5; batch++) {
      workflows.forEach(function (wf, wi) {
        var base = 2000 + batch * 40 + wi * 7;
        for (var i = 0; i < 6; i++) {
          var t = base + i * 3;
          var seq = ['Analyzing', 'Planning', 'Executing', 'Verifying', 'Reporting'];
          seq.forEach(function (ph, j) {
            transitions.push({ wf: wf.name, run: 1000 + batch * 10 + i, dir: 'in', phase: ph, ts: ago(t - j * 2), reason: 'from ' + (j === 0 ? 'Idle' : seq[j - 1]), note: '历史轮（batch ' + (batch + 1) + '）' });
            transitions.push({ wf: wf.name, run: 1000 + batch * 10 + i, dir: 'out', phase: ph, ts: ago(t - j * 2 - 1), reason: '→ ' + (j === seq.length - 1 ? 'Idle' : seq[j + 1]), note: '耗时 ' + (1 + ((rnd() * 5) | 0)) + 'm' });
          });
        }
      });
    }
    transitions.sort(function (a, b) { return b.ts - a.ts; });
  })();
  // ---------- 事件流（curated + bulk ≥1500，三泳道） ----------
  function mkEvent(id, lane, kind, level, system, obj, msg, minAgo, link, extra) {
    return Object.assign({ id: id, lane: lane, kind: kind, level: level, system: system, object: obj, msg: msg, ts: ago(minAgo), link: link || null }, extra || {});
  }
  var events = [
    mkEvent('ev-9001', 'event', 'Escalated', 'fatal', 'deploy-system', 'deploy-system/prod', 'prod 发布无人在环 15m，AUTOLEVEL=ask → 上报 root', 18, '#/s/deploy-system/i/prod'),
    mkEvent('ev-9002', 'event', 'ApprovalNeeded', 'warn', 'deploy-system', 'workflow/deploy-rollout#31', 'prod 段发布请求（digest 3f2a…9c），等待批准', 23, '#/approvals'),
    mkEvent('ev-9003', 'phase', 'PhaseChanged', 'warn', 'deploy-system', 'ServiceInstance/prod', 'InSync → Escalated（reason: prod-gate-no-human）', 18, '#/s/deploy-system/i/prod'),
    mkEvent('ev-9004', 'phase', 'PhaseChanged', 'warn', 'developer-system', 'ServiceInstance/ci', 'InSync → Drifting（reason: queue-policy-mismatch）', 26, '#/s/developer-system/i/ci'),
    mkEvent('ev-9005', 'event', 'MetricThreshold', 'warn', 'developer-system', 'ci/onedev_queue_backlog', '队列积压 14 > 阈值 10，持续 12m', 27, '#/s/developer-system/metrics'),
    mkEvent('ev-9006', 'data', 'DataEvent', 'warn', 'developer-system', 'onedev-ci/job#3871', '构建红线未全绿：3 个 test 超时（digest 未入库）', 30, '#/wf/dev-delivery'),
    mkEvent('ev-9007', 'event', 'ExternalChanged', 'info', 'developer-system', 'onedev/main', '远端 main 有新提交（a91f…c2，dev-1 已 pull）', 41, '#/s/developer-system'),
    mkEvent('ev-9008', 'phase', 'PhaseChanged', 'info', 'connector', 'ServiceInstance/mesh-1', 'InSync → Remediating（reason: gotty-web-heartbeat-timeout）', 14, '#/s/connector/i/mesh-1'),
    mkEvent('ev-9009', 'event', 'ExternalChanged', 'warn', 'connector', 'connectorops/gotty-web', '挂载心跳 3 次超时（>90s），进入重建', 16, '#/connector/gotty-web'),
    mkEvent('ev-9010', 'data', 'DataEvent', 'info', 'storage-system', 'oss://builds/3f2a…9c', '产物入库：digest 校验通过，size 41.2MB', 33, '#/ws/oss'),
    mkEvent('ev-9011', 'event', 'DocApplied', 'info', 'developer-system', 'Goal/quality-goal', 'r12 落库（fieldManager: root），DocApplied 回执', 35, '#/doc/quality-goal'),
    mkEvent('ev-9012', 'event', 'DocApplied', 'info', 'deploy-system', 'ImplDoc/deploy-impl', 'r6 落库（fieldManager: dep-1）', 60, '#/doc/deploy-impl'),
    mkEvent('ev-9013', 'event', 'SessionArchived', 'info', 'self-recursive-core', 'sess-root-0', '对账会话归档（SessionLog 已写 ops DB）', 88, '#/agent/builtinRoot'),
    mkEvent('ev-9014', 'phase', 'PhaseChanged', 'info', 'self-recursive-core', 'workflow/core-workflow#129', 'Idle → Analyzing → Executing（timer resync）', 9, '#/wf/core-workflow'),
    mkEvent('ev-9015', 'event', 'MetricThreshold', 'info', 'global', 'llm-main/token', '日 token 消耗 $9.4 / 预算 $15（62%）', 120, '#/events'),
    mkEvent('ev-9016', 'event', 'InstallRequested', 'info', 'connector', 'install-service', '模板发现完成：connector-nats 可安装（asks: 2）', 300, '#/connectors'),
    mkEvent('ev-9017', 'data', 'DataEvent', 'info', 'storage-system', 'nas-oss sync', '同步完成：nas → oss 41 个对象，lag 38s', 41, '#/s/storage-system/i/nas-oss'),
    mkEvent('ev-9018', 'event', 'ExternalChanged', 'warn', 'storage-system', 'oss', 'oss 网关 5xx 抖动 2 分钟（Degraded）', 200, '#/ws/oss'),
    mkEvent('ev-9019', 'phase', 'PhaseChanged', 'info', 'developer-system', 'workflow/dev-delivery#43', 'Planning → Executing（TaskScheme: ci-queue-remediate）', 19, '#/wf/dev-delivery'),
    mkEvent('ev-9020', 'event', 'ApprovalGranted', 'info', 'deploy-system', 'workflow/deploy-rollout#30', '上一轮 prod 审批由 root 批准，发布完成', 420, '#/approvals')
  ];
  // bulk 生成到 1500+
  (function () {
    var rnd = mulberry32(424242);
    var kindsE = ['ExternalChanged', 'DocApplied', 'SessionArchived', 'ApprovalNeeded', 'InstallRequested', 'MetricThreshold'];
    var lanes = { ExternalChanged: 'event', DocApplied: 'event', SessionArchived: 'event', ApprovalNeeded: 'event', InstallRequested: 'event', MetricThreshold: 'data', SyncDone: 'data', DigestStored: 'data', HeartbeatMiss: 'data', PhaseChanged: 'phase' };
    var levelBy = { ExternalChanged: 'info', DocApplied: 'info', SessionArchived: 'info', ApprovalNeeded: 'warn', InstallRequested: 'info', MetricThreshold: 'warn', SyncDone: 'info', DigestStored: 'info', HeartbeatMiss: 'warn', PhaseChanged: 'info' };
    var sysObjs = {
      'self-recursive-core': ['ServiceInstance/default', 'workflow/core-workflow', 'workflow/watch-only', 'workflow/apply-workflow', 'Scheme/core-scheme', 'agent/builtinRoot'],
      'developer-system': ['ServiceInstance/ci', 'ServiceInstance/dev-pool', 'workflow/dev-delivery', 'onedev-ci/queue', 'gitfs/main', 'agent/dev-1', 'agent/ci-repair-agent', 'agent/ci-verifier'],
      'deploy-system': ['ServiceInstance/prod', 'ServiceInstance/staging', 'workflow/deploy-rollout', 'oss://releases', 'agent/dep-1'],
      'storage-system': ['ServiceInstance/nas-oss', 'nas:///mnt/builds', 'oss://builds'],
      'connector': ['ServiceInstance/mesh-1', 'connectorops/onedev-ci', 'connectorops/gotty-web', 'connectorops/agent-comm', 'connectorops/oss-artifacts', 'provider/llm-main'],
      'user-system': ['ServiceInstance/default', 'bind-role/notify', 'session/outlet']
    };
    var sysNames = Object.keys(sysObjs);
    for (var i = 0; i < 1560; i++) {
      var kind = kindsE[(rnd() * kindsE.length) | 0];
      if (rnd() < 0.22) kind = ['PhaseChanged', 'SyncDone', 'DigestStored', 'HeartbeatMiss'][(rnd() * 4) | 0];
      var sys = sysNames[(rnd() * sysNames.length) | 0];
      var objs = sysObjs[sys];
      var obj = objs[(rnd() * objs.length) | 0];
      var minAgo = 20 + rnd() * 1420;
      var lvl = levelBy[kind];
      if (kind === 'HeartbeatMiss' && rnd() < 0.15) lvl = 'error';
      var msgMap = {
        ExternalChanged: { 'onedev-ci/queue': '远端队列状态变化（depth {n}）', 'gitfs/main': '远端引用更新（{h}）', default: '外部对象状态变化（watch 命中）' },
        DocApplied: '文档落库 r{r}（fieldManager: {fm}），DocApplied 回执',
        SessionArchived: '会话归档，SessionLog 已写 ops DB',
        ApprovalNeeded: '待审项进入队列（role 挂载命中）',
        InstallRequested: 'install 模板发现（asks: {n}）',
        MetricThreshold: '指标越线：{q} = {v}（阈值 {t}）',
        SyncDone: '同步完成：lag {n}s',
        DigestStored: '产物入库 digest=sha256:{h}',
        HeartbeatMiss: '心跳超时：{obj}（>90s）',
        PhaseChanged: '相位跳变（reason: {rsn}）'
      };
      var tpl = (msgMap[kind] && (msgMap[kind][obj] || msgMap[kind].default)) || msgMap[kind] || '事件';
      var msg = tpl.replace('{n}', String((rnd() * 40) | 0)).replace('{h}', hex(8, rnd)).replace('{r}', String(2 + ((rnd() * 12) | 0))).replace('{fm}', ['root', 'builtinRoot', 'dev-1', 'dep-1', 'ci-repair-agent', 'workflow/dev-delivery'][(rnd() * 6) | 0]).replace('{q}', ['build_pass_rate', 'queue_backlog', 'tick_lag', 'sync_lag', 'token_cost'][(rnd() * 5) | 0]).replace('{v}', String((rnd() * 100) | 0) / 10).replace('{t}', String((rnd() * 50) | 0) / 10).replace('{rsn}', ['reconcile-ok', 'drift-detected', 'remediation-started', 'gate-hit', 'cooldown-done'][(rnd() * 5) | 0]);
      events.push(mkEvent('ev-' + (1000 + i), lanes[kind] || 'event', kind, lvl, sys, obj, msg, minAgo, obj.indexOf('/') === 0 || obj.indexOf('connectorops/') === 0 ? '#/connectors' : (obj.indexOf('workflow/') === 0 ? '#/workflows' : '#/tree')));
    }
    events.sort(function (a, b) { return b.ts - a.ts; });
  })();

  // ---------- 审批 ----------
  var approvals = [
    { id: 'ap-1', source: 'workflow/deploy-rollout 轮次 #31', scope: 'systems/deploy-system', title: 'prod 段发布批准（digest 3f2a…9c，envs dev→staging→prod 第 3 段）',
      status: '待审', ts: ago(23), level: 'fatal', wf: 'deploy-rollout', run: 31, link: '#/s/deploy-system/i/prod',
      diff: [
        { t: ' ', s: 'spec.rollout.envs:' },
        { t: ' ', s: '  - dev      status: done   probes 6/6' },
        { t: ' ', s: '  - staging  status: done   probes 4/4' },
        { t: '-', s: '  - prod     status: pending-gate   autoLevel: ask' },
        { t: '+', s: '  - prod     status: approved-by-root   digest: 3f2a…9c' },
        { t: '+', s: '  rollback.checkpoint: staging@8f1c…d2（可 5m 内回滚）' }
      ] },
    { id: 'ap-2', source: 'agent/ci-repair-agent', scope: 'systems/developer-system', title: 'ci-impl 草稿提案：backlogHardLimit 12 → 20（配并行 worker 扩容）',
      status: '待审', ts: ago(12), level: 'high', wf: null, run: null, link: '#/doc/ci-impl',
      diff: [
        { t: ' ', s: 'spec.queuePolicy:' },
        { t: '-', s: '    backlogHardLimit: 12' },
        { t: '+', s: '    backlogHardLimit: 20      # 配合 onedev 并行 worker 4→8' },
        { t: ' ', s: '    overflow: escalate-to-builtinRoot' }
      ] },
    { id: 'ap-3', source: 'workflow/watch-only 轮次 #76', scope: 'systems/connector', title: 'watcher-goal 提案：successRateMin 0.85 → 0.90（deploy-rollout 波动后收紧）',
      status: '待审', ts: ago(120), level: 'high', wf: 'watch-only', run: 76, link: '#/doc/watcher-goal',
      diff: [
        { t: ' ', s: 'spec.thresholds:' },
        { t: '-', s: "    successRateMin: '0.85'" },
        { t: '+', s: "    successRateMin: '0.90'   # dev-delivery 近 3 轮波动，收紧自监控阈值" }
      ] },
    { id: 'ap-4', source: 'agent/dev-1（跨系统提案）', scope: 'systems/deploy-system', title: 'deploy-impl 提案：staging 探针增加 canary 流量 5% 检查',
      status: '待审', ts: ago(200), level: 'info', wf: null, run: null, link: '#/doc/deploy-impl',
      diff: [
        { t: ' ', s: '  gate:' },
        { t: ' ', s: '    staging: auto' },
        { t: '+', s: '    stagingProbes:' },
        { t: '+', s: '      - canary-traffic-5pct' }
      ] },
    { id: 'ap-5', source: 'agent/dep-1', scope: 'systems/user-system', title: '通知模板变更：Escalated 事件附 DriftReport 深链',
      status: '待审', ts: ago(300), level: 'info', wf: null, run: null, link: '#/s/user-system',
      diff: [
        { t: '-', s: 'notification.on: [DocApplied, ApprovalNeeded]' },
        { t: '+', s: 'notification.on: [DocApplied, ApprovalNeeded, Escalated]' },
        { t: '+', s: 'notification.escalatedTemplate: attach-driftreport-link' }
      ] }
  ];

  // ---------- 跨系统申请（Ref 解析与提案进出流水） ----------
  var crossRequests = [
    { dir: 'in', from: 'developer-system', to: 'deploy-system', topic: 'staging canary 探针提案（deploy-impl）', status: '待审', ts: ago(200), doc: 'deploy-impl' },
    { dir: 'out', from: 'developer-system', to: 'storage-system', topic: '构建产物保留期 30d → 45d（storage-impl）', status: '待审', ts: ago(400), doc: 'storage-impl' },
    { dir: 'in', from: 'user-system', to: 'deploy-system', topic: 'Escalated 通知模板附深链', status: '待审', ts: ago(300), doc: 'user-impl' },
    { dir: 'out', from: 'deploy-system', to: 'storage-system', topic: 'releases 桶生命周期规则变更', status: '已合入', ts: ago(1500), doc: 'storage-desc' },
    { dir: 'in', from: 'connector', to: 'developer-system', topic: '自定义 connector-nats 代码生成请求', status: '已合入', ts: ago(2200), doc: 'connector-desc' },
    { dir: 'out', from: 'developer-system', to: 'deploy-system', topic: '发布顺序 dev→staging→prod 增加 smoke 段', status: '驳回', ts: ago(3000), doc: 'deploy-impl' },
    { dir: 'in', from: 'deploy-system', to: 'developer-system', topic: '红线测试拆分（unit/lint/license 并行）', status: '已合入', ts: ago(4200), doc: 'dev-impl' }
  ];

  // ---------- agent-comm 消息日志 ----------
  var commLog = [
    { ts: ago(12), from: 'builtinRoot', to: 'ci-repair-agent', op: 'dispatch', payload: '修复 ci 队列漂移 #042（附 DriftReport 深链）', token: 'systems/developer-system/ci', status: '已确认', session: 'sess-repair-1' },
    { ts: ago(16), from: 'ci-verifier', to: 'builtinRoot', op: 'query', payload: '回报：探针 5/6，queue-drain 未过', token: '-', status: '已确认', session: 'sess-core-129' },
    { ts: ago(18), from: 'dep-1', to: 'builtinRoot', op: 'interrupt', payload: 'prod 门禁无人在环，Escalate 上报', token: '-', status: '已送达', session: 'sess-dep-1' },
    { ts: ago(23), from: 'deploy-rollout#31', to: 'dep-1', op: 'dispatch', payload: 'prod 段发布任务（digest 3f2a…9c）', token: 'systems/deploy-system', status: '已确认', session: 'sess-dep-1' },
    { ts: ago(26), from: 'dev-delivery#43', to: 'ci-repair-agent', op: 'dispatch', payload: '拉取 job #3871 日志并定位失败层', token: 'systems/developer-system/ci', status: '已确认', session: 'sess-repair-1' },
    { ts: ago(35), from: 'builtinRoot', to: 'dev-1', op: 'query', payload: 'req-118 拆解进度？', token: 'systems/developer-system/dev-pool', status: '已确认', session: 'sess-dev-1' },
    { ts: ago(41), from: 'dev-1', to: 'builtinRoot', op: 'query', payload: '回复：3 子任务，2 完成，1 执行中', token: '-', status: '已确认', session: 'sess-root-1' },
    { ts: ago(55), from: 'builtinRoot', to: 'dep-1', op: 'interrupt', payload: '暂停 prod 段（等待 staging 探针补充）', token: '-', status: '失败', session: 'sess-dep-1' },
    { ts: ago(70), from: 'ci-repair-agent', to: 'ci-verifier', op: 'dispatch', payload: '复测请求：queue-drain 探针（改动后）', token: 'systems/developer-system/ci（只读）', status: '已确认', session: 'sess-verify-1' },
    { ts: ago(90), from: 'watch-only#76', to: 'builtinRoot', op: 'query', payload: '观察报告：成功率 91.8%，建议收紧阈值', token: '-', status: '已送达', session: 'sess-core-77' },
    { ts: ago(120), from: 'builtinRoot', to: 'dep-1', op: 'dispatch', payload: '上一轮 prod 批准：继续发布', token: 'systems/deploy-system', status: '已确认', session: 'sess-dep-1' },
    { ts: ago(150), from: 'user-system', to: 'builtinRoot', op: 'inbox', payload: 'bind-role 回执：3 条通知送达（DocApplied x2, ApprovalNeeded x1）', token: '-', status: '已确认', session: 'sess-root-1' }
  ];

  // ---------- 协议 envelope 字段（agent-comm v0.1） ----------
  var envelope = [
    { field: 'v', type: 'string', req: true, desc: '协议版本，固定 "0.1"' },
    { field: 'id', type: 'uuid', req: true, desc: '消息 id（幂等去重键）' },
    { field: 'ts', type: 'rfc3339', req: true, desc: '发送时间' },
    { field: 'from', type: 'agentRef', req: true, desc: '发送方 agent 全名（system/instance/agent）' },
    { field: 'to', type: 'agentRef', req: true, desc: '接收方 agent 全名；inbox 投递' },
    { field: 'kind', type: 'enum', req: true, desc: 'dispatch | query | interrupt | inbox | reply | ack' },
    { field: 'payload', type: 'object', req: false, desc: '任务/问题/打断语义负载（JSON）' },
    { field: 'refs', type: 'array', req: false, desc: '关联对象链（文档/事件/运行）' },
    { field: 'token', type: 'jwt-like', req: false, desc: '权限整包（下发委派时携带，子 ⊆ 父；缺失=仅 inbox 可读）' }
  ];
  // ---------- dev-delivery 的 workflow spec 文档（可编辑的第 3 份主文档） ----------
  docs.push(D({
    name: 'dev-delivery-spec', kind: 'Workflow', scope: 'systems/developer-system', revision: 5, generation: 5,
    updated: ago(90), fieldManager: 'root', ownerRefs: ['dev-delivery'],
    tags: ['spec', 'impl'],
    history: [H(5, 'root', 90, 'Deploy 段 prod 门禁写死 ask'), H(4, 'root', 1200, 'Gate 增加 auto 白名单'), H(3, 'builtinRoot', 4000, '初版（override of builtin）')],
    content:
"apiVersion: core/v1\nkind: Workflow\nmetadata:\n  name: dev-delivery\n  scope: systems/developer-system   # override-of-builtin\nspec:\n  enabled: true\n  services:\n    involved: [developer-system, deploy-system]\n    mode: act\n    llm: {provider: llm-main, model: flash-tier}\n  dataflow:\n    inputs:\n      - {events: [ExternalChanged, MetricThreshold, 用户请求], docs: 'systems/developer-system/*'}\n    outputs:\n      - {status: self, notify: [bind-role], artifacts: 'oss://builds'}\n  triggers:\n    events: {types: [ExternalChanged, MetricThreshold, UserRequest], minLevel: warn}\n    timer: {resync: 10m}\n  ingest:\n    dedup: {window: 5m}\n    group: {by: dedupKey, max: 100}\n  phases: [Idle, Analyzing, Planning, AwaitingApproval, Executing, Verifying, Reporting, Failed, Paused]\n  steps:\n    - {id: analyze,  phase: Analyzing,       do: 定位错误/拆解需求}\n    - {id: gate,     phase: AwaitingApproval, do: 高危人批（auto 白名单直过）}\n    - {id: plan,     phase: Planning,        do: 选 TaskScheme 模板}\n    - {id: execute,  phase: Executing,       do: developer-system pull → build+test 红线全绿 → 产物 digest}\n    - {id: verify,   phase: Verifying,       do: 探针复测}\n    - {id: deploy,   phase: Executing,       do: deploy-system 按 DeployDesign.envs 升序发布，prod 人批}\n    - {id: report,   phase: Reporting,       do: Status 追平+归档+Event}\n  onEscalate: {action: finish-tick, notify: bind-role}\n  onFailed: {backoff: 30s*2^n, maxAttempts: 3, escalate: {to: root, notify: bind-role}}\n  brakes:\n    cooldown: 2m\n    maxMutationsPerTick: 10\n    avoidRepeatFix: true\n  regression:\n    statusWriteback: true\n    reports: [DriftReport, SessionLog]"
  }));

  // ---------- 文档 tags（curated 补 tags；kind → 默认 tags） ----------
  var TAG_BY_KIND = {
    Goal: ['goal'], Rule: ['rule'], Scheme: ['design', 'builtin'], ServiceDesc: ['design'],
    Desc: ['design'], ImplDoc: ['impl'], VerifyDoc: ['impl'], DriftReport: ['report', 'machine'],
    Runbook: ['ops'], Workflow: ['spec', 'impl']
  };
  docs.forEach(function (d) { if (!d.tags) d.tags = TAG_BY_KIND[d.kind] ? TAG_BY_KIND[d.kind].slice() : []; });
  docs.forEach(function (d) {
    if (d.scope === 'global') d.tags.push('builtin');
    d.tags = d.tags.filter(function (t, i) { return d.tags.indexOf(t) === i; });
  });

  // ---------- bulk 文档生成（补足 ≥200） ----------
  (function () {
    var rnd = mulberry32(90210);
    var plans = [
      { sys: 'developer-system', p: 'dev', n: 42 },
      { sys: 'deploy-system', p: 'dep', n: 30 },
      { sys: 'self-recursive-core', p: 'core', n: 30 },
      { sys: 'connector', p: 'conn', n: 28 },
      { sys: 'storage-system', p: 'sto', n: 24 },
      { sys: 'user-system', p: 'usr', n: 22 }
    ];
    var kindSpec = [
      { kind: 'Desc', suf: 'design-note', tag: 'design' },
      { kind: 'Rule', suf: 'rule', tag: 'rule' },
      { kind: 'Runbook', suf: 'runbook', tag: 'ops' },
      { kind: 'ImplDoc', suf: 'impl-note', tag: 'impl' },
      { kind: 'VerifyDoc', suf: 'verify-note', tag: 'impl' },
      { kind: 'DriftReport', suf: 'drift', tag: 'report' }
    ];
    var bodyByKind = {
      Desc: function (t) {
        return "# " + t.title + "\n\n设计说明（归档批次）：\n- 背景：对应 " + t.sys + " 的迭代需求\n- 结论：按 Scheme 约定落在本 scope，revision 随 Apply 递增\n- 关联：ownerRefs 指向本系统 ServiceDesc\n\n> 本条目为历史设计归档，最新语义以各系统 ServiceDesc 与 Goal 为准。";
      },
      Rule: function (t) {
        return "apiVersion: core/v1\nkind: Rule\nmetadata:\n  name: " + t.name + "\n  scope: " + t.scope + "\nspec:\n  statement: |\n    " + t.sys + " 局部规则（第 " + t.idx + " 条）：约束该 scope 内的\n    行为边界，违反即产生 DriftReport 由 workflow 收敛。\n  enforcement: reconcile-loop";
      },
      Runbook: function (t) {
        return "# Runbook: " + t.title + "\n\n1. 看该 scope 最新 DriftReport 的 observed 字段。\n2. severity ≤ warn：不干预，等待自动收敛。\n3. severity ≥ error：按步骤操作后点「触发对账」。\n4. 处理完在本页留一条 SessionLog 备注。";
      },
      ImplDoc: function (t) {
        return "apiVersion: core/v1\nkind: ImplDoc\nmetadata:\n  name: " + t.name + "\n  scope: " + t.scope + "\nspec:\n  note" + t.idx + ":\n    trigger: 对账批次 " + t.idx + "\n    steps:\n      - 采集现状（只读）\n      - 与声明 diff\n      - 差异进草稿，Apply 落库\n    brake: {maxAttempts: 3}";
      },
      VerifyDoc: function (t) {
        return "apiVersion: core/v1\nkind: VerifyDoc\nmetadata:\n  name: " + t.name + "\n  scope: " + t.scope + "\nspec:\n  probes:\n    - {id: probe-" + t.idx + ", expect: '批次 " + t.idx + " 全绿后才能进 Reporting'}";
      },
      DriftReport: function (t) {
        return "apiVersion: core/v1\nkind: DriftReport\nmetadata:\n  name: " + t.name + "\n  scope: " + t.scope + "\nstatus: Closed\nspec:\n  detected: 历史批次 " + t.idx + "\n  observed: 声明与现状不一致（已收敛）\n  severity: info\n  remediation: workflow 自动修复并归档\n  fixedBy: workflow/" + t.sys + "-workflow";
      }
    };
    plans.forEach(function (pl) {
      for (var i = 1; i <= pl.n; i++) {
        var ks = kindSpec[i % kindSpec.length];
        var name = pl.p + '-' + ks.suf + '-' + (100 + i);
        var t = { name: name, sys: pl.sys, scope: 'systems/' + pl.sys, idx: i, title: pl.sys + ' 归档批次 #' + (100 + i) };
        docs.push(D({
          name: name, kind: ks.kind, scope: t.scope, revision: 1 + ((rnd() * 4) | 0), generation: 1 + ((rnd() * 3) | 0),
          status: ks.kind === 'DriftReport' ? (i % 7 === 0 ? 'Open' : 'Closed') : 'Active',
          updated: ago((120 + rnd() * 4000) | 0),
          fieldManager: ['root', 'builtinRoot', 'dev-1', 'dep-1', 'ci-repair-agent', 'workflow/core-workflow'][(rnd() * 6) | 0],
          ownerRefs: [], tags: [ks.tag].concat(rnd() < 0.2 ? ['review'] : []),
          history: [H(1, 'builtinRoot', (120 + rnd() * 4000) | 0, '归档批次入库（机器/人写混合）')],
          content: bodyByKind[ks.kind](t)
        }));
      }
    });
  })();

  // ---------- 会话（dsh Conversation 数据形态） ----------
  function M(id, role, text, minAgo, cards, meta) {
    return { id: id, role: role, text: text, ts: ago(minAgo), cards: cards || [], meta: meta || null };
  }
  function OP(op, target, payload, status, detail) { return { type: 'op', op: op, target: target, payload: payload, status: status || '已确认', detail: detail || '' }; }
  function FILES(files, note) { return { type: 'files', files: files, note: note || '' }; }
  function PROPOSAL(doc, title, diff) { return { type: 'proposal', doc: doc, title: title, diff: diff }; }
  function APPROVALC(id, title) { return { type: 'approval', id: id, title: title }; }

  var sessions = [
    {
      id: 'sess-root-1', agent: 'builtinRoot', title: '全局对账：Escalated 处置', runner: 'dsh', created: ago(360),
      pinned: true, archived: false, tokens: 18240,
      messages: [
        M('m-1', 'user', '现在全局什么状态？Escalated 的那条怎么处理？', 46),
        M('m-2', 'agent',
          '当前 6 系统：4 InSync，developer-system Drifting（ci 队列策略不一致），connector Remediating（gotty-web 重建中），deploy-system/prod Escalated。\n\nEscalated 处置建议：\n1. prod 门禁（deploy-rollout #31）等你批准——staging 已全绿，digest 3f2a…9c 校验通过；\n2. 批准后 dep-1 会继续 prod 段并在 5m 检查点观察；\n3. ci 的漂移不必现在处理，dev-delivery #43 已在修复循环里。\n\n证据链：escalated-drift（severity fatal）、commLog 18m 前 dep-1 的 interrupt。', 45, [
          APPROVALC('ap-1', 'prod 段发布批准（digest 3f2a…9c）'),
          OP('agent-comm.interrupt', 'dep-1', { reason: 'prod-gate-no-human', escalateTo: 'root' }, '已送达')
        ], { tokens: 3120, steps: 6 }),
        M('m-3', 'user', '先批准 prod。另外给 watcher-goal 提一条收紧阈值的提案。', 20),
        M('m-4', 'agent',
          '已受理：\n1. ap-1 我无法替你批——Apply 必须人点，请到审批页操作；\n2. watcher-goal 阈值提案我已写入草稿（不动正式文档），可在编辑器里查看并 Apply。', 19, [
          OP('agent-comm.dispatch', 'watch-only#76', { proposal: 'successRateMin 0.85→0.90' }, '已确认'),
          PROPOSAL('watcher-goal', 'successRateMin 0.85 → 0.90', [
            { t: '-', s: "    successRateMin: '0.85'" },
            { t: '+', s: "    successRateMin: '0.90'   # deploy-rollout 近 3 轮波动后收紧" }
          ])
        ], { tokens: 980, steps: 2 })
      ],
      traj: [
        { ts: ago(46), kind: 'user', label: '用户输入', detail: '全局状态 + Escalated 处置' },
        { ts: ago(45), kind: 'tool', label: 'agent-comm.query → ci-verifier', detail: '回报：探针 5/6' },
        { ts: ago(45), kind: 'tool', label: 'gitfs.read escalated-drift', detail: 'severity: fatal' },
        { ts: ago(45), kind: 'doc', label: '引用 quality-goal', detail: 'SLO 对照（只读）' },
        { ts: ago(45), kind: 'agent', label: '回复（6 步 · 3120 tok）', detail: '结论 + 处置建议 + 审批卡' },
        { ts: ago(19), kind: 'tool', label: 'agent-comm.dispatch → watch-only#76', detail: '阈值提案下发' },
        { ts: ago(19), kind: 'doc', label: '草稿 watcher-goal', detail: '未 Apply，不发事件' }
      ]
    },
    {
      id: 'sess-repair-1', agent: 'ci-repair-agent', title: '修复 onedev-ci 队列漂移 #042', runner: 'dsh', created: ago(180),
      pinned: true, archived: false, tokens: 22900,
      messages: [
        M('m-1', 'user', 'ci-drift-042 定位到了吗？给修复方案。', 26),
        M('m-2', 'agent',
          '已定位。observed：onedev 侧 parallel=4 且无上限，ImplDoc 声明 backlogHardLimit=12 未生效——声明与现实漂移。\n\n修复方案（两段）：\n1. 短平快：把 queuePolicy.backlogHardLimit 上调到 20，配合 onedev 并行 worker 4→8；草案已进草稿缓存（下面卡片，未 Apply）。\n2. 长期：overflow 策略保持 escalate-to-builtinRoot，防止再次无上限积压。\n\n已让 ci-verifier 准备 queue-drain 探针复测。要我现在把草稿提交审批吗？', 24, [
          FILES([
            { path: 'systems/developer-system/ci-impl.yaml', add: '+2', del: '-1', status: 'M' },
            { path: 'systems/developer-system/ci-drift-042.yaml', add: '+1', del: '-0', status: 'M' }
          ], '草稿改动（未 Apply）'),
          PROPOSAL('ci-impl', 'backlogHardLimit 12 → 20', [
            { t: '-', s: '    backlogHardLimit: 12' },
            { t: '+', s: '    backlogHardLimit: 20      # 配合 onedev 并行 worker 4→8' }
          ]),
          OP('onedev-ci.watch-queue', 'onedev', { threshold: 10, current: 14 }, '运行中')
        ], { tokens: 5400, steps: 9 }),
        M('m-3', 'user', '提交审批，然后盯构建。', 13),
        M('m-4', 'agent',
          '已提交：草稿以 ci-repair-agent 的 fieldManager 进入待审区（ap-2）。\n构建侧：job #3871 的 3 个 test 超时已复判——test-ordering 问题，重跑通过率 62%，建议等 Apply 后一并跑全量红线。我会继续盯队列。', 12, [
          APPROVALC('ap-2', 'ci-impl 草稿提案：backlogHardLimit 12 → 20'),
          OP('onedev-ci.poll-log', 'onedev/job#3871', { tail: 200 }, '已确认')
        ], { tokens: 2100, steps: 4 })
      ],
      traj: [
        { ts: ago(26), kind: 'user', label: '用户输入', detail: '定位 + 修复方案' },
        { ts: ago(25), kind: 'tool', label: 'onedev-ci.watch-queue', detail: 'backlog=14 > 10' },
        { ts: ago(25), kind: 'tool', label: 'onedev-ci.poll-log job#3871', detail: '3 个 test 超时' },
        { ts: ago(24), kind: 'tool', label: 'gitfs.read ci-drift-042', detail: 'observed/expected 对照' },
        { ts: ago(24), kind: 'diag', label: '诊断 view', detail: 'test-ordering 疑似：2 个用例共享临时目录' },
        { ts: ago(24), kind: 'doc', label: '草稿 ci-impl', detail: '+2/-1（未 Apply）' },
        { ts: ago(24), kind: 'agent', label: '回复（9 步 · 5400 tok）', detail: '定位结论 + 两段方案' },
        { ts: ago(12), kind: 'tool', label: 'approval.submit ap-2', detail: '草稿入待审区' }
      ]
    },
    {
      id: 'sess-repair-term-1', agent: 'ci-repair-agent', title: 'gotty 终端：onedev runner 排障', runner: 'gotty', created: ago(95),
      pinned: false, archived: false, tokens: 4100,
      messages: [
        M('m-1', 'agent', '终端会话已建立（gotty-web，runner=gotty）。可以直接敲命令，或让我代跑。常用：status / tick / help。', 95)
      ],
      traj: [{ ts: ago(95), kind: 'tool', label: 'gotty-web.open-terminal', detail: 'tty-0 建立（300ms）' }]
    },
    {
      id: 'sess-verify-1', agent: 'ci-verifier', title: 'ci 探针复测集（6 组）', runner: 'dsh', created: ago(150),
      pinned: false, archived: false, tokens: 8600,
      messages: [
        M('m-1', 'user', '复测进度如何？', 16),
        M('m-2', 'agent',
          '6 组探针：5 绿 1 未过。\n\n- ✅ repair-green：修复后首轮构建 exit 0\n- ✅ verifier-pass：6/6 → 5/6（本轮 queue-drain 除外）\n- ✅ no-repeat-fix：DriftReport 无同类重复修复\n- ✅ digest-match：oss 产物一致\n- ✅ notify-outlet：bind-role 收到收敛回执\n- ❌ queue-drain：15m 内 backlog 未回落到 < 10（当前 14）\n\n结论：queue-drain 依赖 ap-2 落库（backlogHardLimit 12→20）。我不修，只报事实。', 15, [
          OP('onedev-ci.watch-queue', 'onedev', { mode: 'observe' }, '运行中')
        ], { tokens: 1900, steps: 3 })
      ],
      traj: [
        { ts: ago(16), kind: 'user', label: '用户输入', detail: '复测进度' },
        { ts: ago(16), kind: 'tool', label: 'onedev-ci.watch-queue（观察）', detail: 'backlog 14' },
        { ts: ago(15), kind: 'agent', label: '回复（3 步 · 1900 tok）', detail: '5 绿 1 未过' }
      ]
    },
    {
      id: 'sess-dep-1', agent: 'dep-1', title: 'prod 发布 2/4 envs（等待门禁）', runner: 'dsh', created: ago(33),
      pinned: false, archived: false, tokens: 9700,
      messages: [
        M('m-1', 'user', '现在卡在哪一步？', 18),
        M('m-2', 'agent',
          'deploy-rollout #31：dev ✅ → staging ✅（探针 4/4）→ prod 门禁 ask，已 18m 无人在环，触发 Escalated。我按 onEscalate=pause 冻结相位，断点保留。\n\n给你两个选项：\n1. 审批页批准 ap-1 → 我继续 prod 段（5m 检查点）；\n2. 驳回 → 我回滚到 staging 最后好版本（digest 8f1c…d2）。', 17, [
          APPROVALC('ap-1', 'prod 段发布批准'),
          OP('agent-comm.interrupt', 'builtinRoot', { reason: 'prod-gate-no-human' }, '已送达')
        ], { tokens: 2400, steps: 4 })
      ],
      traj: [
        { ts: ago(18), kind: 'user', label: '用户输入', detail: '卡点询问' },
        { ts: ago(17), kind: 'tool', label: 'oss-artifacts.verify-digest', detail: '3f2a…9c 通过' },
        { ts: ago(17), kind: 'tool', label: 'agent-comm.interrupt → root', detail: 'Escalate 上报' },
        { ts: ago(17), kind: 'agent', label: '回复（4 步 · 2400 tok）', detail: 'pause + 两个选项' }
      ]
    },
    {
      id: 'sess-dev-1', agent: 'dev-1', title: '新需求 req-118 拆解', runner: 'opencode', created: ago(80),
      pinned: false, archived: false, tokens: 15300,
      messages: [
        M('m-1', 'user', 'req-118 拆完了吗？改哪些文件？', 42),
        M('m-2', 'agent',
          '拆解完成，3 个子任务：\n1. queue 观测指标补齐（done）\n2. onedev connector 重试语义（done）\n3. 红线测试拆分并行（执行中，依赖 ap-4 的 deploy-impl 提案合入）\n\n改动文件（工作区，未 Apply 文档）：', 41, [
          FILES([
            { path: 'lib/connector/onedev/retry.ts', add: '+34', del: '-6', status: 'M' },
            { path: 'lib/metrics/queue.ts', add: '+58', del: '-0', status: 'A' },
            { path: 'test/redline/split.test.ts', add: '+21', del: '-40', status: 'M' }
          ], '本地构建红线：unit ✅ lint ✅ license ✅')
        ], { tokens: 4100, steps: 12 }),
        M('m-3', 'user', '继续，完成后走 dev-delivery 全流程。', 30),
        M('m-4', 'agent', '收到。完成后我会触发 dev-delivery（event: ExternalChanged），Gate 段如命中高危会自动转审批。执行结果会以 digest 入 oss，drift 归档进 SessionLog。', 29, [], { tokens: 700, steps: 1 })
      ],
      traj: [
        { ts: ago(42), kind: 'user', label: '用户输入', detail: 'req-118 进度' },
        { ts: ago(42), kind: 'tool', label: 'gitfs.pull', detail: 'shallow @ a91f…c2' },
        { ts: ago(41), kind: 'files', label: 'changed-files ×3', detail: '+113/-46' },
        { ts: ago(41), kind: 'tool', label: 'onedev-ci.build', detail: '红线全绿' },
        { ts: ago(41), kind: 'agent', label: '回复（12 步 · 4100 tok）', detail: '3 子任务拆解' }
      ]
    },
    {
      id: 'sess-core-0', agent: 'builtinRoot', title: 'Scheme 注册审查（已归档）', runner: 'claude-code', created: ago(5200),
      pinned: false, archived: true, tokens: 6600,
      messages: [
        M('m-1', 'user', '把 agent-comm 四原语注册进 core-scheme。', 5100),
        M('m-2', 'agent', '已注册 dispatch/query/interrupt/inbox 四原语（core-scheme r14），DocApplied 回执见事件流。', 5090, [
          OP('gitfs.commit', 'core-scheme', { revision: 14 }, '已确认')
        ], { tokens: 2200, steps: 3 })
      ],
      traj: [{ ts: ago(5100), kind: 'doc', label: 'Apply core-scheme r14', detail: 'DocApplied 已发' }]
    },
    {
      id: 'sess-core-129', agent: 'builtinRoot', title: 'core-workflow #129 对账轮', runner: 'dsh', created: ago(9),
      pinned: false, archived: false, tokens: 1600,
      messages: [
        M('m-1', 'agent', '对账轮 #129 运行中：Analyzing → Executing 已完成 gotty-web 挂载重建，Verifying 等第 3 个心跳样本。有情况我会 interrupt 你。', 8)
      ],
      traj: [{ ts: ago(8), kind: 'tool', label: 'gotty-web.exec', detail: 'tty-0 回 200，tty-1 超时' }]
    }
  ];

  // ---------- Agent 人设问答（chat mock 回复库） ----------
  var personas = {
    'builtinRoot': [
      { k: ['状态', 'status', '总览', '全局'], text: '全局快照：6 系统里 4 个 InSync；developer-system Drifting（ci 队列策略漂移，dev-delivery #43 修复中）；connector Remediating（gotty-web 挂载重建 attempt 1/3）；deploy-system/prod Escalated（prod 门禁等你批）。待审批 5 条。建议先看审批页的 ap-1。', cards: [OP('agent-comm.query', 'ci-verifier', { q: 'probe status' }, '已确认')] },
      { k: ['触发', '手动', '一轮', 'tick'], text: '已手动触发一轮对账（core-workflow #130 入队，reason: manual:root）。轮次开始后你会在运行抽屉里看到相位时间线与 action log。', cards: [OP('workflow.trigger', 'core-workflow', { round: 130, reason: 'manual' }, '已入队')] },
      { k: ['goal', '目标', '新建'], text: '新建 Goal 走文档通道：我可以在 global scope 起一份草稿（不动正式文档、不发事件），你确认内容后点 Apply 落库。要现在起草吗？给我一句话意图即可。', cards: [] },
      { k: ['审批', '批准', 'reject', '驳回'], text: '审批必须人点（LLM 只提案）。当前待审 5 条：ap-1 prod 发布（fatal）、ap-2 ci-impl 队列参数（high）、ap-3 watcher 阈值、ap-4 staging canary、ap-5 通知模板。批准=Apply，落库必发 DocApplied。', cards: [] },
      { k: ['漂移', 'drift', '不一致'], text: '当前未解决 drift 3 条：ci-drift-042（warn，修复中）、conn-drift-017（warn，自愈中）、escalated-drift（fatal，等你批 ap-1）。全部有 DriftReport 深链可点。', cards: [] }
    ],
    'ci-repair-agent': [
      { k: ['队列', '积压', 'backlog'], text: '队列现状：backlog 14（soft 10 / hard 12→草稿 20）。job #3871 是 test-ordering 问题：两个用例共享临时目录，隔离后重跑通过率 62%。我已把 queuePolicy 调整放进草稿（ap-2），Apply 后 15m 内应回落。', cards: [OP('onedev-ci.watch-queue', 'onedev', { threshold: 10, current: 14 }, '运行中')] },
      { k: ['构建', 'build', '日志'], text: '最近失败构建 job #3871：compile ✅ → test ❌（3 超时）→ digest 未入库（红线没全绿）。尾部日志已留档 SessionLog。修复循环 brake：avoidRepeatFix=true，同类失败不会重复盲试。', cards: [OP('onedev-ci.poll-log', 'onedev/job#3871', { tail: 200 }, '已确认')] },
      { k: ['修复', '方案', '怎么办'], text: '标准修复路径：① 定位失败层（dependency/compile/test）② 按 Runbook 决策（重跑/降级依赖/上报）③ 修完必须 ci-verifier 探针复测 ④ 结果写 DriftReport。本次 #042 走的是"改声明对齐现实"，所以草稿进审批而不是直接动代码。', cards: [] }
    ],
    'ci-verifier': [
      { k: ['探针', '复测', 'verify'], text: '探针集 6 组：5 绿 1 未过。未过的是 queue-drain（15m 内 backlog 未 <10）。我只报事实不修复——未过项的修复责任在 ci-repair-agent，等 ap-2 落库后我会自动复测。', cards: [OP('onedev-ci.watch-queue', 'onedev', { mode: 'observe' }, '运行中')] },
      { k: ['digest', '产物'], text: 'digest-match ✅：oss://builds/3f2a…9c 与构建输出 sha256 一致，size 41.2MB。verify-digest 是入库前置，不是事后抽检。', cards: [] }
    ],
    'dep-1': [
      { k: ['发布', 'prod', '部署', '卡'], text: 'deploy-rollout #31：dev ✅ staging ✅ prod 待门禁。Escalated 18m。你批 ap-1 我就继续（5m 检查点）；驳回我 5m 内回滚到 staging@8f1c…d2。绝不跳段。', cards: [APPROVALC('ap-1', 'prod 段发布批准')] },
      { k: ['回滚', 'rollback'], text: '回滚预案：checkpoint=per-env，staging 最后好版本 digest 8f1c…d2（oss 可回源），回滚时限 5m（deploy-goal SLO）。触发条件=prod 探针连续 2 次失败或你驳回。', cards: [] },
      { k: ['staging'], text: 'staging 段：探针 4/4 全绿，耗时 6m。canary 5% 流量检查是 ap-4 提案（待审），合入前 staging 不做 canary 门禁。', cards: [] }
    ],
    'dev-1': [
      { k: ['需求', 'req', '拆解', '任务'], text: 'req-118 三个子任务完成 2 个，第 3 个（红线测试拆分）在等 ap-4 合入。changed-files 3 个（+113/-46），本地红线 unit/lint/license 全绿。产物暂未入库——等 dev-delivery 全流程统一走 digest。', cards: [FILES([{ path: 'lib/connector/onedev/retry.ts', add: '+34', del: '-6', status: 'M' }, { path: 'lib/metrics/queue.ts', add: '+58', del: '-0', status: 'A' }, { path: 'test/redline/split.test.ts', add: '+21', del: '-40', status: 'M' }], '工作区改动')] },
      { k: ['pull', '远端'], text: 'gitfs.pull：shallow depth=1 @ main（a91f…c2），lag 11s，无冲突。远端有新提交时 ExternalChanged 会触发 dev-delivery。', cards: [OP('gitfs.pull', 'gitfs:///srv/git/dsh-core', { depth: 1 }, '已确认')] }
    ]
  };
  function personaReply(agentName, userText) {
    var list = personas[agentName] || personas['builtinRoot'];
    var low = (userText || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var hit = list[i].k.some(function (kw) { return low.indexOf(kw.toLowerCase()) >= 0; });
      if (hit) return { text: list[i].text, cards: list[i].cards || [] };
    }
    return {
      text: '收到（' + agentName + '）。我的权限范围是 ' + (__CC.MOCK ? '见右栏' : '') + '：ConnectorOps 挂载与 Ref 都在范围内。这句话我归纳为一条新任务，会以 SessionLog 留痕；若涉及文档修改，我只提案进草稿，Apply 由你点。需要我先给现状摘要还是直接动手？',
      cards: []
    };
  }

  // ---------- token 消耗（24h sparkline） ----------
  var tokenSpark = [3.1, 3.4, 2.8, 4.2, 5.1, 4.6, 6.2, 7.4, 6.8, 8.1, 7.2, 6.4, 7.8, 9.4, 8.6, 7.9, 8.8, 9.9, 8.4, 7.1, 6.2, 5.4, 4.8, 5.2];
  // ---------- gotty 终端演示脚本 ----------
  var termScript = [
    { cmd: 'status', out: [
      'core-dsh v0.9.2 (plugin: console)',
      'cored: connected   generation: 9/9   tick lag: 4.2s',
      'systems: 6   InSync: 4   Drifting: 1   Remediating: 1   Escalated: 1',
      'workflows: 7 enabled (apply-workflow disabled)',
      'drift open: 3   approvals pending: 5',
      'tip: type "help" for commands'
    ] },
    { cmd: 'tick', out: [
      'tick #4129 fired (period 5m, jitter 10%)',
      'reconcile order: docs → instances → workflows → mounts',
      'docs: 208 objects scanned, 3 drafts pending apply',
      'instances: 8/8 phases settled (1 escalated, held)',
      'result: converged with 2 warnings (0.42s)'
    ] },
    { cmd: 'help', out: [
      'commands:',
      '  status        cluster snapshot',
      '  tick          force one reconcile round (manual: gotty)',
      '  ls <scope>    list objects under scope',
      '  doc <name>    print document head',
      '  help          this text'
    ] }
  ];

  // ---------- 侧栏导航 / 路由元数据 ----------
  var nav = [
    { id: 'welcome', label: 'Welcome', route: '#/welcome', icon: 'home' },
    { id: 'overview', label: '总览', route: '#/overview', icon: 'grid' },
    { id: 'tree', label: '系统树', route: '#/tree', icon: 'tree' },
    { id: 'workflows', label: 'Workflows', route: '#/workflows', icon: 'flow' },
    { id: 'docs', label: '文档', route: '#/docs', icon: 'doc' },
    { id: 'events', label: '事件', route: '#/events', icon: 'pulse' },
    { id: 'proposals', label: '提案', route: '#/proposals', icon: 'plus' }, // 需求提案（能力 B——console 提需求→审批→派工的一等对象）
    { id: 'approvals', label: '审批', route: '#/approvals', icon: 'check', badge: 'approvals' },
    { id: 'connectors', label: '连接', route: '#/connectors', icon: 'plug' },
    { id: 'chat-root', label: '会话', route: '#/chat/root-agent', icon: 'chat' } // root-agent=动态锚（renderNav/palItems 经 navRouteOf 解析文档面在册 agent）
  ];

  // ---------- 全局 docs 视图路由 #/docs 需要的分组 ----------
  var DOC_KINDS = ['Goal', 'Rule', 'Desc', 'ImplDoc', 'VerifyDoc', 'DriftReport', 'Runbook', 'Scheme', 'Workflow', 'ServiceDesc'];

  // ---------- 事件时间范围（过滤用） ----------
  var TIME_RANGES = [
    { id: '1h', label: '近 1 小时', min: 60 },
    { id: '6h', label: '近 6 小时', min: 360 },
    { id: '24h', label: '近 24 小时', min: 1440 },
    { id: 'all', label: '全部', min: 1e9 }
  ];

  // ---------- 暴露 ----------
  __CC.MOCK.docs = docs;
  __CC.MOCK.workflows = workflows;
  __CC.MOCK.transitions = transitions;
  __CC.MOCK.events = events;
  __CC.MOCK.approvals = approvals;
  __CC.MOCK.crossRequests = crossRequests;
  __CC.MOCK.commLog = commLog;
  __CC.MOCK.envelope = envelope;
  __CC.MOCK.sessions = sessions;
  __CC.MOCK.personaReply = personaReply;
  __CC.MOCK.tokenSpark = tokenSpark;
  __CC.MOCK.termScript = termScript;
  __CC.MOCK.nav = nav;
  __CC.MOCK.FSM = FSM;
  __CC.MOCK.FSM_ABNORMAL = FSM_ABNORMAL;
  __CC.MOCK.DOC_KINDS = DOC_KINDS;
  __CC.MOCK.TIME_RANGES = TIME_RANGES;
  __CC.MOCK.fmtMin = fmtMin;
  __CC.MOCK.hex = hex;
})();
