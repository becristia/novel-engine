# novel-engine

单用户小说创作核心，提供离线 CLI、配置校验、FakeProvider 和带历史快照的 SQLite 稿件工作区。工程使用 ESM、TypeScript strict、Commander、Zod、better-sqlite3 与 Vitest。

## 环境与安装

开发环境固定为 Node.js `24.22.1`、npm `11.19.1`，Node.js 版本记录在 `.node-version`，依赖精确版本记录在 `package-lock.json`。项目接受 Node.js `>=24.22.1 <25` 和 npm `>=11 <12`。

在项目根目录运行：

```bash
npm ci
npm run novel -- --help
npm run novel -- doctor --offline
```

依赖安装需要访问 npm。CLI 离线检查和普通测试不调用模型；测试环境同时禁止 `fetch` 和 Socket 网络连接。

## 配置检查

不传 `--config` 时，doctor 校验内置的 FakeProvider 配置。它不会自动读取当前目录的配置文件。

```bash
npm run novel -- doctor --offline --config ./novel.config.example.json
npm run novel -- doctor --offline --json
```

假模型配置格式：

```json
{
  "schemaVersion": 1,
  "model": {
    "provider": "fake",
    "modelId": "fake-v1",
    "maxOutputTokens": 1024
  }
}
```

`maxOutputTokens` 必须是正的安全整数。模型配置还支持 `contextWindowTokens`（默认 16384）与 `timeoutMs`（默认 30000）。多余字段、无效 JSON 或显式指定但不存在的文件都会失败，不会静默回退。错误输出不包含配置值或原始 JSON。

真实模型配置示例见 [compatible.example.json](fixtures/config/compatible.example.json)，使用 HTTPS 的 OpenAI 兼容 Chat Completions 接口，密钥只通过 `apiKeyEnv` 指定的环境变量读取。示例中的地址与模型名应按实际供应商配置。离线 doctor 只检查配置，不测试服务连通。

## 模型探测与运行记录

```bash
npm run novel -- --project ./books/demo models probe --max-requests 1 --max-tokens 4096
npm run novel -- --project ./books/demo --config ./fixtures/config/compatible.example.json models probe
npm run novel -- --project ./books/demo run inspect <run-id>
npm run novel -- --project ./books/demo run cancel <run-id>
```

第一条命令使用内置假模型；第二条在配置对应密钥后会调用真实 API，产生供应商用量。普通测试使用模拟 HTTP 响应验证适配器，不连接真实供应商。

每次请求发送前持久化预算预留，原始响应先保存再解析；SDK 自动重试关闭，输出修复与重试最多两次尝试且共享运行预算。缺失 usage 或价格时费用保持未知；可选 `prices` 包含 `inputPerMillion`、`outputPerMillion`（USD／百万 token）与 `version`，估算不是最终账单。超时或断线的请求记录为 unknown，不自动重发，也不会释放可能已消费的预算。取消后的结果不能继续提交。

FakeProvider 可用 `responsesFile` 指定 JSON 字符串数组，路径相对于配置文件；未指定时只提供一次探测响应。模型原始输出与提示词保存在本地工作区，分享运行记录前应检查其中的稿件内容。

成功退出码为 `0`；参数、配置或运行环境错误为 `1`。`--json` 的成功输出是单个 JSON 对象，失败诊断写入标准错误。可以用以下命令检查配置失败路径，预期退出码为 `1`：

```bash
npm run novel -- doctor --offline --config ./fixtures/config/invalid.json
```

## 稿件工作区

```bash
npm run novel -- init ./books/demo --title "港口旧灯"
npm run novel -- --project ./books/demo import ./fixtures/novels/harbor-light.md --preview
npm run novel -- --project ./books/demo import ./fixtures/novels/harbor-light.md --apply
npm run novel -- --project ./books/demo chapter list
npm run novel -- --project ./books/demo export --version 1 --format markdown --out ./exports/version-1.md
```

导入支持 UTF-8 和带 BOM 的 UTF-16，以 Markdown 二级标题或独立的“第 N 章／回／节”行拆章。导入保留原始字节，正文统一换行为 LF；重复导入相同内容不会新增章节，同一路径内容变化时要求显式替换章节。

`chapter replace <id> --file <file> --expected-version <version>` 替换作者正文；`chapter insert --title <title> --file <file> --position <n> --expected-version <version>` 插章；`chapter reorder <ids...> --expected-version <version>` 重排。章节 ID 从 list 返回，顺序变化不会改变 ID。历史项目快照固定正文与顺序，过期版本写入会失败。

`chapter show <id> --version <version>` 查看历史正文；导出支持 markdown 和 txt（去除二级标题标记），目标文件必须不存在，避免覆盖已有稿件。工作区权威数据位于 novel.db，导出文件的修改不会自动回写。

## 规划与候选稿

```bash
npm run novel -- --project ./books/demo --config ./novel.config.json plan --brief ./brief.txt --chapters 3
npm run novel -- --project ./books/demo proposal list
npm run novel -- --project ./books/demo proposal show <proposal-id>
npm run novel -- --project ./books/demo proposal edit-plan <proposal-id> --chapter 2 --file ./chapter-plan.json
npm run novel -- --project ./books/demo proposal approve <proposal-id>
npm run novel -- --project ./books/demo chapter draft --chapter 1 --dry-run
npm run novel -- --project ./books/demo --config ./novel.config.json chapter draft --chapter 1
npm run novel -- --project ./books/demo proposal reject <proposal-id>
```

全局 `--project` 与 `--config` 放在子命令前。计划编辑文件包含 title、goal、characters、constraints、events 和 targetLength；编辑产生新的提案 ID，原提案标记为 superseded。每批规划支持 1～20 章。

Writer 只使用已批准的计划和正式正文；候选与拒绝稿不会进入导出或后续上下文。dry-run 只读取固定来源，不创建运行或调用模型。每部作品同时只允许一个模型写任务；运行检查输入版本与写入权，旧进程的迟到响应不能保存为新候选。请求数默认上限为 8，运行 token 预算默认 64000，可用 `--max-requests` 与 `--max-tokens` 调整。

## 写作、审稿与恢复

```bash
npm run novel -- --project ./books/demo --config ./novel.config.json workflow write --chapter 1
npm run novel -- --project ./books/demo --config ./novel.config.json chapter review --revision <revision-id>
npm run novel -- --project ./books/demo --config ./novel.config.json chapter revise --revision <revision-id> --instruction "明确章末转折。"
npm run novel -- --project ./books/demo proposal approve <proposal-id> --reason "保留审稿指出的慢节奏作为铺垫。"
npm run novel -- --project ./books/demo run list
npm run novel -- --project ./books/demo run resume <run-id>
```

workflow write 执行生成、检查、审稿和事实提取，完成后退出并等待批准，不自动写入正式稿。`--revise-once` 允许根据审稿结果最多自动修订一轮，并为新正文重新审稿。chapter revise 同样生成新的候选及报告，原稿保留。

批准需要绑定同一正文版本、内容哈希和项目基线的有效审稿与提取结果。确定冲突阻止批准；待核查和风格意见需要作者说明理由。事实提取结果保留为待确认信息。引用使用正文版本、非空文本行区块 b1、b2 等及原句；可选 start/end 为全文 UTF-16 偏移，重复原句必须给出准确位置。

resume 复用保存的步骤和产物，输入版本改变时拒绝继续；unknown 请求需显式 `--retry-unknown`，且仍受原预算约束。运行中断后可通过 run list 找到 ID。当前恢复入口面向 plan、draft、write、review 和 revise 创作运行。

## 记忆、来源与上下文

```bash
npm run novel -- --project ./books/demo memory status
npm run novel -- --project ./books/demo memory confirm <fact-id> <fact-id>
npm run novel -- --project ./books/demo memory correct <fact-id> --file ./corrected-fact.json
npm run novel -- --project ./books/demo memory alias --entity lin-zhou --names 林舟 小林
npm run novel -- --project ./books/demo --config ./novel.config.json memory rebuild
npm run novel -- --project ./books/demo context show --chapter 4
npm run novel -- --project ./books/demo constraints set --file ./constraints.json --expected-version <version>
```

事实默认未确认。确认候选事实不会改变项目基线，候选批准时同时提升为正式来源；确认或纠正正式稿事实会产生新的项目版本，已有候选可能因此过期。纠正保留旧条目、来源和作者决定。constraints 文件是作者独立声明的字符串数组。

新增章节保留来源未变的旧章记忆，只重建新增或失效来源；替换旧正文、重排或改变作者约束会在正文事务里使旧派生记忆失效。失效摘要和事实不参与上下文，预算允许时回退正式原文。rebuild 涉及模型请求，默认最多 16 次请求、128000 token，可单独指定 `--chapter <id>`。

上下文保留硬约束和当前计划，优先最近正式正文，再按人物、别名和关键词选择已确认事实及旧章来源；每项来源记录版本、选择理由和估算，省略项也记录原因。事实、角色误信、未来计划分别分组。计划可设置 viewpointCharacter；仅有明确角色和获知时间证据的信息进入该视角的已知组，缺少证据保留未知。章序只用于叙述披露范围，不推断故事发生时间。单值关系在同一明确时间出现多个值时显示待核对冲突，多件物品会并存。

## 模型契约与离线响应

[ModelGateway](src/llm/model-gateway.ts) 定义文本、结构化结果和 AbortSignal 接口。[FakeProvider](src/llm/fake-provider.ts) 按调用顺序返回预置字符串；结构化生成会解析 JSON 并通过调用方的 Zod schema 校验。

空响应、错误 JSON、schema 不匹配或固定响应耗尽会明确失败。请求前取消不消耗固定响应；请求开始后取消会拒绝该次调用，该响应已被本次尝试消费。FakeProvider 不模拟模型分词和输出截断，usage 返回 `null`，不能用于估计真实费用或写作质量。

`fixtures/config/` 提供有效与无效配置，`fixtures/novels/three-chapter.json` 提供三章人物、约束和目标元数据。

## 检查与构建

```bash
npm run check
npm test
npm run build
node dist/cli/main.js doctor --offline
node dist/cli/main.js doctor --offline --json
```

`check` 执行类型检查；测试覆盖配置失败与脱敏、结构化响应、取消、CLI 退出码、中文展示以及模块导入无自动执行行为。`build` 将源码编译到 `dist/`；该目录为可重建产物，不纳入 Git。

## 文档入口

- [项目规范](AGENTS.md)：目录职责、工程边界与验证入口。
- [项目进度](ROADMAP.md)：当前状态、后续工作与验证记录。
- [开发计划](TypeScript%20小说多%20Agent%20项目开发计划.md)：目标流程、数据契约、里程碑和效果验收。

工程为私有本地项目，`package.json` 设置了 `private: true` 和 `UNLICENSED`。
