# core_system_dsh_plugin — dsh plugin 宿主 + connectors

> core_system 本体（控制面引擎）**还是 Go build 出来的**（在 [core_system_workservice](https://github.com/friddle-self-recursive-agent/core_system_workservice)，cmd/cored）；本仓承载 **dsh plugin + connector** 部分，plugin 通过 **git submodule `core_system/`** 引用 core 代码——**每次指向最新**（submodule update 即跟主）。

## 结构

```
core_system_dsh_plugin/
├── core_system/      # submodule → core_system_workservice（main 最新）
│   └── cmd/cored     # Go 控制面：go build 产出 cored 二进制
├── plugin/           # dsh plugin（TS/ESM，dsh 插件生态）
│   ├── cordis.patch.yml  # dsh.bundle patch 层（profile layer 声明，id=core-system）
│   └── src/index.ts  # 入口：cordis 插件 + cored 桥（桥契约见 instance 仓 runtime/cored-bridge.md）
├── connectors/       # connector 实现（dsh 侧宿主；每 connector 一目录，ops 契约见 concepts/connector.md）
└── docs/             # 本仓设计说明（细节设计仍在 core_system_instance 仓）
```

## 约定

1. **core = Go build**：`cd core_system && go build ./cmd/cored`；plugin 不重写引擎，只做宿主/桥接。
2. **submodule 每次指向最新**：core 仓 main 前进后，本仓 `git submodule update --remote core_system` 跟随（不锁死旧版）。
3. connector 契约（get/plan/apply/verify/undo 幂等）以 core_system 声明仓 concepts/connector.md 为准；本仓实现不定义新语义。
4. 声明/设计/可行性仍在 core_system（声明）与 core_system_instance（实现形式）两仓；本仓只放代码。
