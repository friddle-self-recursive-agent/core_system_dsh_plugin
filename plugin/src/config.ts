// config.ts —— 插件配置面 + 各路由常量（R-ENG-7 拆分：原 index.ts 的声明面收拢于此，零语义变化）。
// 部署锚点一律经配置或环境注入，不内置真实路径（rule.md R-PUB-1/2）。
import type { ApplySubject } from './http.ts'

export interface Config {
  /** 启动时拉起 cored 子进程（缺省 true）；coredUrl 存在时忽略本项。 */
  autoSpawn?: boolean
  /** cored 可执行文件路径；缺省读 CORE_SYSTEM_CORED_BIN，再退化为 PATH 上的 cored。 */
  coredBin?: string
  /** 传给 cored 的附加参数（--scheme 由 schemePath 注入，不在此重复）。 */
  coredArgs?: string[]
  /** core/scheme.yaml 源路径；缺省读 CORE_SYSTEM_SCHEME。为空且无 coredUrl 时桥接不启动。 */
  schemePath?: string
  /** 已在运行的 cored 基址（http://127.0.0.1:port）；设置则跳过 spawn 直接查询。 */
  coredUrl?: string
  /** 等待就绪行的超时（毫秒，缺省 10000）。 */
  readyTimeoutMs?: number
  /** console Apply 写路由的请求级主体（E3 起；缺省=内置 admin 全权字面量——
   *  cored-bridge.md §3 config.applySubject；主体注入属宿主行为，浏览器不携带主体）。 */
  applySubject?: ApplySubject
  /** Service project 的本地目录根（Workspace 注册用）；缺省=$DSH_HOME/service-projects。 */
  serviceProjectsRoot?: string
  /** 自循环拉起命令（部署侧；LoopRequested 唤醒到达时执行；空=wake 桥禁用——
   *  只落唤醒投影不拉起会话；命令是配置项，事件载荷不参与命令构造）。 */
  loopCommand?: string
  /** 单飞检测模式（pgrep -f；空=不检测，由部署侧 loop 命令自行保证单飞）。 */
  loopRunningPattern?: string
  /** 已有循环时 pending 重试间隔毫秒（缺省 30000）。 */
  loopRetryMs?: number
  /** pending 持久化文件（空=仅内存；建议部署侧配，跨插件重启不丢事件）。 */
  wakePendingFile?: string
  /** 任务 spawn 桥固定命令（部署侧；cored 调度器 POST /task/spawn 到达时执行；空=桥禁用——
   *  载荷不参与命令构造，taskPath 只经 stdin 喂给命令；task-scheduler.md §4）。 */
  taskSpawnCommand?: string
  /** 任务单飞锁目录（按 taskId 锁文件+进程活性判定；空=不落锁，部署侧自行保证同任务单飞）。 */
  taskSpawnLockDir?: string
  /** task spawn 桥地址发现文件（就绪后写入实际监听地址，0600；空=不写）。 */
  taskSpawnAddrFile?: string
  /** cored 地址发现文件（部署侧；就绪后写入基址，corectl 缺省读取；
   *  空=不写（仅 core-system 等主控制面 profile 配置——避免多 profile 互相覆盖））。 */
  coredAddrFile?: string
}

/** console 只读代理路由前缀（宿主 web 路由；浏览器同源 fetch，cookies 随行）。 */
export const CONSOLE_API_PREFIX = '/core-console/api'

/** console Apply 写路由（E3 起，exact 路径；与只读代理前缀分立）。宿主转发 cored
 *  POST /v1/apply（写路径唯一入口，三步闸门零旁路——cored-bridge.md §2.1）；主体由宿主
 *  注入（config.applySubject），浏览器不携带主体；鉴权边界=connection 鉴权栅栏（与读代理
 *  同 fail-closed 口径）。 */
export const CONSOLE_APPLY_PATH = '/core-console/apply'

/** console 草稿路由（E4 起，prefix；落稿/弃稿——cored-bridge.md §2.2 草稿缓存面）。
 *  POST /core-console/drafts（exact 段）→ cored POST /v1/drafts 落稿 upsert；
 *  DELETE /core-console/drafts/{kind}/{name}?scope= → cored DELETE 弃稿。
 *  草稿不触文档面（零 Revision 零事件），但写操作随 cored --allow-apply 开关（缺省 405）；
 *  fieldManager=客户端溯源串（溯源非授权——授权主体只在 apply 路由由宿主注入），客户端
 *  缺主=宿主补缺省（无主稿 cored 侧 400 拒绝）。 */
export const CONSOLE_DRAFTS_PATH = '/core-console/drafts'

/** console 设计文档写路由（v0.52 能力 A——console 屏幕 6 直接编辑设计文档 md → Apply →
 *  git commit；cored-bridge.md §2.4）。prefix 路由内按方法+路径分立：
 *  POST /core-console/design-docs（exact 段）→ cored POST /v1/design-docs/apply（dry-run/
 *  真落库；主体由宿主注入同 apply 路由）；POST /core-console/design-docs/draft → cored
 *  POST /v1/design-docs/draft（落稿 upsert，fieldManager 客户端缺主=宿主补缺省）；
 *  DELETE /core-console/design-docs/draft/{repo}/{path...} → cored DELETE 弃稿。
 *  读面（清单/单文档/史/草稿读）不经本路由——走既有只读代理 /core-console/api/v1/*（GET
 *  /v1/ 前缀已放行）。白名单/lint/乐观锁三闸门在 cored 侧，宿主零旁路。 */
export const CONSOLE_DESIGN_DOCS_PATH = '/core-console/design-docs'

/** console 对话式录入与准入预检路由（v0.53 能力 D + R-UX-1/R-UX-2——cored-bridge.md §2.5）。
 *  POST /core-console/intake/turn（或 exact 段）→ cored POST /v1/intake/turn（自由描述抽取/自动补充/缺少询问/字段卡双向同步）；
 *  POST /core-console/intake/generate → cored POST /v1/intake/generate（提交节点生成标准 YAML + 系统补缺省 + 三重 dry-run 字段级归因）。
 *  主体由宿主注入（剥除客户端声明）；读面 GET /v1/intake/sessions* 走既有只读代理 /core-console/api/v1/*。 */
export const CONSOLE_INTAKE_PATH = '/core-console/intake'
/** 会话活性心跳注册通路（v0.54 KI-003）：POST /core-console/session-heartbeat → cored POST /v1/sessions/heartbeat。 */
export const CONSOLE_SESSION_HEARTBEAT_PATH = '/core-console/session-heartbeat'

/** console 实时流 WS 代理路由（upgrade 注册；宿主 registerUpgrade 能力面）：浏览器
 *  ws://…/core-console/ws → connection 鉴权栅栏（fail-closed 同款）→ TCP 透传
 *  cored <bridge.url>/v1/stream（事件/trace 活体流）。宿主零旁路：鉴权在栅栏，
 *  流帧内容不经宿主解析（纯 pipe）。 */
export const CONSOLE_WS_PATH = '/core-console/ws'
// 控制台 Web 前端产物面（默认入口——产物=workservice submodule web/dist；2026-11-27 用户裁决：
// v1 旧 client 载体删除、v2 名称退役，console 即默认入口）。
// assets 用非嵌套兄弟前缀——避免 exact(/core-console) 与 prefix(/core-console/assets) 同树嵌套的宿主路由匹配歧义
// （CT116 活体实证：嵌套形态壳页在册而 assets 404）。
export const CONSOLE_LEGACY_V2_PATH = '/core-console/v2'
// 控制台对话通路（bridge chatfaces——send=sessionController.prompt queue|steer；stop=cancel）
export const CONSOLE_CHAT_SEND_PATH = '/core-console/chat-send'
export const CONSOLE_EVENT_PUB_PATH = '/core-console/event-pub'
// 控制台自有对话面转录桥（bridge transcript——sc.list/create/page/state 直读直写）
export const CONSOLE_CHAT_SESSIONS_PATH = '/core-console/chat-sessions'
export const CONSOLE_CHAT_CREATE_PATH = '/core-console/chat-create'
export const CONSOLE_CHAT_TRANSCRIPT_PATH = '/core-console/chat-transcript'
export const CONSOLE_CHAT_STATE_PATH = '/core-console/chat-state'
export const CONSOLE_CHAT_STOP_PATH = '/core-console/chat-stop'
export const CONSOLE_CHATFACES_CLIENT_PATH = '/core-console/chatfaces.js'
// Task→真实 dsh session 映射（journal taskId 反查；旧 agentSession=taskId 不是 sessionId）
export const CONSOLE_TASK_SESSIONS_PATH = '/core-console/task-sessions'
// 无尾斜杠——宿主 prefix 匹配语义= url===path || url.startsWith(path+'/')，尾斜杠致双斜杠永不匹配
// （CT116 活体实证：registered=2 而子路径 404）。
export const CONSOLE_WEB_ASSETS_PREFIX = '/core-console/assets'

/** cored 实时流上游路径（WS 代理透传目标；bridge.url + 本路径）。 */
export const CONSOLE_WS_UPSTREAM_PATH = '/v1/stream'

/** SelfHeal 注入桥监听面（v0.56 R-10——agent-session.md §7 自愈第一动作真实接线）：
 *  cored watchdog（--session-watch-interval 开启）经 CORE_SYSTEM_SELFHEAL_ADDR（宿主 loopback
 *  HTTP 面）路由到本 listener；POST /selfheal/bounce 载荷 {sessionId, word, source} →
 *  sessionController.prompt(mode=queue) 注入固定 prompt（缺省「继续」——保留上下文不重启）。
 *  **红线**：注入只对「已判停滞的会话」发固定 prompt——不新增任何自动任务/自动执行面；
 *  会话侧探针回执心跳（POST /core-console/session-heartbeat，source=session，非 watchdog）
 *  照既有通路——非续租，恢复判据=会话侧真实推进心跳。 */
export const SELFHEAL_BOUNCE_PATH = '/selfheal/bounce'

/** 自愈第一动作注入词缺省（cored --self-heal-word 单点声明同值；agent-session.md §7 固定 prompt）。 */
export const DEFAULT_HEAL_WORD = '继续'

/** SelfHeal 会话侧探针回执心跳词形（phase=inject-continue——注入后的活性观测心跳）。
 *  **非续租语义**：cored Beat 内部 attempts>0 分支只在会话侧真实推进（phase 词汇非 inject）
 *  时记 SessionHealed；本词形=注入受理后的活性观测（v0.56 桥探针回执）。
 *  防伪：cored POST /v1/sessions/heartbeat 拒收 source=watchdog（判定面自续租禁入）。 */
export const SELFHEAL_HEARTBEAT_PHASE = 'inject-continue'

/** 草稿 fieldManager 缺省（客户端缺主时宿主补——无主稿 cored 拒绝 400，兜底保 UX）。 */
export const DEFAULT_DRAFT_FIELD_MANAGER = 'console:editor'

/** agent-comm 读路由（E6，exact 路径）：`GET /core-console/comm`——agent-comm 运行时
 *  落账面（CommJournal+mailbox）的浏览器读出口（console 连接页 agent-comm 详情=
 *  op 面/拓扑/消息日志数据源，console-adoption.md §1.13）。只读 GET（其余 405 allow: GET）；
 *  connection 栅栏 fail-closed 与 apply 路由同款（handler 内再锁一道）；**token 值永不
 *  出现于载荷**（落账面只记 hasToken 布尔——凭据红线）。 */
export const CONSOLE_COMM_PATH = '/core-console/comm'

/** Service → Workspace 最小映射读/准备路由（能力 C）：GET 列 Service；POST 仅确保本地
 *  project 目录存在，Workspace 注册仍由客户端 ctx.workspaces.create 走 dsh 权威面。 */
export const CONSOLE_SERVICE_PROJECTS_PATH = '/core-console/service-projects'

/** Apply 主体缺省（permission.DefaultAdmin 全权字面量；部署可经 config.applySubject 覆写
 *  为受限 role——cored-bridge.md §3 config.applySubject）。 */
export const DEFAULT_APPLY_SUBJECT = { user: 'console-operator', roles: ['role/global/admin'] }

/** Wake 桥监听面路径（事件→自循环拉起；core_design concepts/cli.md / R-UX-8）：
 *  cored 侧 wake 桥（CORE_SYSTEM_WAKE_ADDR）把白名单唤醒（缺省 LoopRequested）POST 到本桥。 */
export const WAKE_SPAWN_PATH = '/wake/spawn'

/** Task spawn 桥监听面路径（多任务并发调度宿主面——task-scheduler.md §4；与 wake 桥同族）：
 *  cored 侧调度器租约命中任务 → POST /task/spawn {taskId, taskPath, workspace, agent}。 */
export const TASK_SPAWN_PATH = '/task/spawn'
