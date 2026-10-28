# 项目进度

## 当前状态

本轮按 M0～M7 顺序实现并逐阶段提交、推送。M0 已推送，M1 工程验收通过；下一里程碑为 M2。仓库为 https://github.com/becristia/novel-engine 。真实模型凭据当前未配置，真实模型与作者效果评测单独保持待验证。后续目标与验收见 [开发计划](TypeScript%20小说多%20Agent%20项目开发计划.md)。

## 最近完成

- 2026-10-29 00:42：完成 M1 SQLite 工作区、原始稿件保存与导入去重、不可变正文及项目快照、版本冲突保护、幂等提交、插章重排与历史导出。
- 2026-10-29 00:29：完成 M0 单包工程、离线 doctor、配置校验与脱敏、文本和结构化 FakeProvider、取消支持、三章样例元数据及项目文档；本地 Git 使用 main 分支，尚无提交。
- 2026-10-29 00:29：补齐开发计划中的项目历史快照、部分采纳后的新候选审稿、追加与改旧章的记忆失效规则、效果对照门槛及 M2～M4 基础恢复边界。

## 最近验证

- 2026-10-29 00:44：M1 类型检查、47 项测试与构建通过；编译后 CLI 的初始化、预览、导入、章节列表和历史导出通过。修复并回归验证应用版本参数与历史导出版本参数冲突；覆盖旧版还原、并发旧写入拒绝、不可变数据、未知数据库版本拒绝、重复提交与拒绝覆盖已有导出文件。
- 2026-10-29 00:34：本轮开始前复验 M0，类型检查、37 项测试、构建和编译后离线 doctor 全部通过。
- 2026-10-29 00:29：在独立干净目录使用同一 package.json、锁文件和源码执行 npm ci，再运行 doctor --offline --json，安装与启动通过；无待审查安装脚本。
- 2026-10-29 00:29：在 macOS arm64、Node.js 24.22.1、npm 11.19.1 下执行 npm run check、npm test、npm run build，全部通过，5 个测试文件共 37 项测试通过；编译后 CLI 的离线 JSON 检查通过。测试禁止网络连接，覆盖坏配置、脱敏、响应校验、取消、退出码与无副作用导入。
- 2026-10-29 00:29：npm audit --omit=dev 报告运行时依赖的已知漏洞为零；git check-ignore 确认依赖、构建、临时数据、真实配置与本地 Agent 配置被排除，配置示例允许纳入版本控制。

## 尚未验证

- Linux 环境尚未实跑；当前兼容性结果来自 macOS arm64。
- 尚未接入真实模型或小说生成业务；费用、创作质量及长篇效果留待对应里程碑验证。
- 效果目标中的修稿时间降低 20% 是初始验证假设，须在 M2 小样本摸底后冻结评测版本与阈值。

## 下一步

- M2：真实供应商网关、请求记录和预算，以及固定参考集与效果对照。
- M3～M4：三章创作闭环、基础恢复和效果验收。
- M5～M7：达到效果门槛后推进长篇记忆、改稿与完整故障回归。

## 依赖选型依据

M0 的运行时依赖仅引入 Commander 与 Zod。Commander 提供子命令、帮助和一致的解析错误处理，避免手写 CLI 分派；Zod 在运行时校验配置及模型输出，并推导 TypeScript 类型，标准库没有对应的类型化 schema 校验能力。SQLite、AI SDK 和 provider adapter 按里程碑延后引入。

- Commander：npm 元数据确认 `15.0.0` 要求 Node.js `>=22.12.0`；[正式发布](https://github.com/tj/commander.js/releases/tag/v15.0.0)与[近期维护记录](https://github.com/tj/commander.js/pull/2663)可核对。
- Zod：npm 与 [v4.6.7 发布记录](https://github.com/colinhacks/zod/releases/tag/v4.6.7)一致；[维护者近期提交](https://github.com/colinhacks/zod/pull/6675)显示项目仍在维护。近期已关闭 Issues 中包含旧问题的后续讨论，不能把更新时间误当修复时间。
- 开发工具采用 TypeScript、tsx、Vitest 和 Node.js 24 对应类型，精确版本由 `package.json` 与锁文件记录；兼容性以本项目安装和检查结果为准。
- M1 引入 better-sqlite3 13.0.3，提供显式同步事务、成熟数据库接口和预编译原生绑定；采用计划中的独立 SQLite 驱动，避免依赖运行时版本中的 SQLite API 差异。[发布记录](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3)与[近期平台维护](https://github.com/WiseLibs/better-sqlite3/commit/f8e2d541208281368129929a96f70f937c0735ef)已核对。本机直接使用包内预编译绑定，禁止隐式 node-gyp 编译脚本，其他平台须先验证预编译绑定可用。
- 安装脚本已查看：仅允许当前 `esbuild@0.28.2` 的平台二进制准备与版本检查脚本；当前命令不需要原生文件监听，明确禁用可选 `fsevents` 的安装脚本。决定保存在项目 package.json 中，不修改全局 npm 配置。
