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

配置格式：

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

`maxOutputTokens` 必须是正的安全整数。配置仅接受示例中的字段及 provider、modelId；多余字段、无效 JSON 或显式指定但不存在的文件都会失败，不会静默回退。错误输出不包含配置值或原始 JSON。

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
