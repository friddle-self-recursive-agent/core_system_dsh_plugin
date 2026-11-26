# core_system_dsh_plugin — dsh plugin 宿主 + connectors

> core_system 本体（控制面引擎）**还是 Go build 出来的**（在 [core_system_workservice](https://github.com/friddle-self-recursive-agent/core_system_workservice)，cmd/cored）；本仓承载 **dsh plugin + connector** 部分，plugin 通过 **git submodule `core_system/`** 引用 core 代码——**每次指向最新**（submodule update 即跟主）。

## 结构

```
core_system_dsh_plugin/
├── core_system/      # submodule → core_system_workservice（main 最新）
│   └── cmd/cored     # Go 控制面：go build 产出 cored 二进制
├── plugin/           # dsh plugin（TS/ESM，dsh 插件生态）
│   ├── cordis.patch.yml  # dsh.bundle patch 层（profile layer 声明，id=core-system）
│   ├── src/          # 薄 adapter（桥+路由，源文件 ≤800 行 R-ENG-7）
│   │   └── index.ts  # 入口：default apply() 编排 + 既有导出 re-export（桥契约见 instance 仓 runtime/cored-bridge.md）
│   ├── client/       # 过渡期前端载体（巨石拆分不做——core_system_workservice web/ 接管后整体删除）
│   ├── lint/         # max-file-lines.sh（R-ENG-7 本仓 checker；豁免集=仓根 .max-file-lines-allowlist）
│   └── test/         # node --test：桥单元 + 真实 cored 端到端（契约 §3.1 机械验证）
└── connectors/       # connector 实现（dsh 侧宿主；每 connector 一目录，ops 契约见 concepts/connector.md）
```

## 约定

1. **core = Go build**：`cd core_system && go build ./cmd/cored`；plugin 不重写引擎，只做宿主/桥接。
2. **submodule 每次指向最新**：core 仓 main 前进后，本仓 `git submodule update --remote core_system` 跟随（不锁死旧版）。
3. connector 契约（get/plan/apply/verify/undo 幂等）以 core_system 声明仓 concepts/connector.md 为准；本仓实现不定义新语义。
4. 声明/设计/可行性仍在 core_system（声明）与 core_system_instance（实现形式）两仓；本仓只放代码。
5. **前端权威 = core_system_workservice `web/`**：本仓 plugin/client 为过渡期载体（保底可用），web/dist 合入 workservice main 后本仓更新 submodule 指针并退役 client/。
6. **源文件 ≤800 行（R-ENG-7 红线）**：.ts/.js/.mjs/.css/.go 全适用；checker=core_design `lint/max-file-lines.sh`（本仓随行副本 `plugin/lint/max-file-lines.sh`，过渡期巨石经仓根 `.max-file-lines-allowlist` 豁免，web/ 接管后删除豁免项）。
