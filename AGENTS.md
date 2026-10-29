# novel-engine 项目规范

## 定位与入口

本项目提供单用户本地小说创作工作台，使用 TypeScript、ESM、SQLite、CLI 与 React Web 界面。开发状态以 [ROADMAP.md](ROADMAP.md) 为准；当前命令以 [README.md](README.md) 为准；目标流程与验收标准见 [开发计划](TypeScript%20小说多%20Agent%20项目开发计划.md)。

M0～M7 核心和 P0～P7 工作台已完成工程实现，[执行计划](docs/implementation/workbench-plan.md) 与[验收记录](docs/implementation/workbench-acceptance.md)保留范围与证据。工程验收与真实模型、人工创作效果验收分开记录；缺少凭据或人工标注时继续独立工程工作，但不能将未运行的验收标为通过。

## 目录约定

- `src/cli/`：参数解析、终端展示和退出码；供测试导入的模块不能自动执行 CLI。
- `src/domain/`：与供应商 SDK 无关的配置和产物契约。
- `src/llm/`：ModelGateway、配置读取、FakeProvider 与 OpenAI 兼容模型适配器。
- `src/storage/`：SQLite 迁移、事务与仓储；`src/application/`：工作区和统一提交等业务服务。
- `src/workflows/`：持久化任务、步骤、预算、运行所有权与恢复；`src/agents/`：只读输入到模型产物的转换。
- `src/context/`、`src/review/`、`src/proposals/`：上下文与记忆、证据检查、版本绑定的局部修改。
- `prompts/`：版本化提示词；`fixtures/evaluation/`：固定评测材料与标注状态。
- `tests/`：契约、配置、取消和 CLI 行为测试。
- `tests/support/`：只用于测试的子进程故障驱动，可终止自身进程；不得接入真实供应商或作为产品入口。
- `tests/browser/`：真实 SQLite 与固定响应的浏览器验收；测试专用服务不能作为产品入口。
- `fixtures/`：不含真实密钥的固定配置、响应与小说样例元数据。
- `docs/design/`：基于现有能力的交互设计与生成提示词；`docs/design/concepts/` 保存概念图，设计稿不代表功能已经实现。
- `docs/implementation/`：执行计划、验收证据与接口决定；`src/server/`：本地 HTTP 与后台任务接入；`web/`：浏览器界面，只通过接口访问工作区。
- `.tmp/<task-slug>/`：本次任务临时数据；`dist/`：可重建的编译结果。

按开发计划在需要时增加目录，不提前创建空的应用层、存储层或 Agent 框架。

## 工程边界

- 普通测试、模块导入和 `doctor --offline` 不得发送外部请求。真实模型探测和回归须使用独立、明确的入口，并执行请求预算。
- 模型只返回候选产物；正式正文和权威状态经 CommitService 提交。项目历史快照、审批及记忆失效遵循开发计划中的事务边界。
- Web 服务只监听本机，浏览器只能访问已登记的作品目录；模型配置和密钥留在服务端。任务启动与恢复必须保留请求身份、预算和版本校验，多章改稿必须整体批准。
- 配置错误只报告文件位置、字段和错误类别，不打印配置值、密钥或原始 JSON。终端文案在展示层处理中文间距与标点，路径、命令和用户正文保持原样。
- 单包、单个 `package-lock.json`；运行时版本见 `.node-version`。依赖按当前里程碑引入，新增核心依赖的选型与维护证据记入进度文档。

## 验证与维护

必要检查入口为 `npm run check`、`npm test`、`npm run build`；CLI 离线验收使用 `npm run novel -- doctor --offline`。新环境使用 `npm ci`，编译入口另外验证 `node dist/cli/main.js doctor --offline`。

涉及 Web 行为时，构建后运行 `npm run test:web`，浏览器选择和截图目录见 README；保留固定响应与真实模型验收的区别。

修改实现后同步真实使用说明与进度；设计变化先更新开发计划。M0 的无效配置、请求前与请求中取消、坏响应及导入无副作用需要回归覆盖。禁止用宽泛异常捕获把失败报告成成功。
