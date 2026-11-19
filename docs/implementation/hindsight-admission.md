# Hindsight 准入记录

2026-10-31 11:01（北京时间）核对官方仓库、发布记录、TypeScript 客户端和 API 定义。结论：保留 Hindsight 作为待验证适配器，当前产品入口不启用，普通页面、预览与离线检查继续使用本地逻辑。

## 版本与维护

- 本次查询 GitHub 的 latest release 返回 [v1.1.0](https://github.com/vectorize-io/hindsight/releases/tag/v1.1.0)，发布时间为 2026-10-21；不是根据旧计划推测版本。
- [仓库元数据](https://api.github.com/repos/vectorize-io/hindsight) 标示 MIT、未归档，最近推送为 2026-10-31。近期有 [并发删除下实体计数修复](https://github.com/vectorize-io/hindsight/pull/6233) 和 [相关 issue](https://github.com/vectorize-io/hindsight/issues/6229) 的关闭记录，说明存在持续维护；没有据此估算全项目响应率。
- [官方 TypeScript 客户端](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-clients/typescript/package.json) 为 `@vectorize-io/hindsight-client` 1.1.0、MIT。本项目未安装该依赖：当前只需四个 HTTP 操作，Node.js 原生 fetch 足够；也避免引入 SDK 默认重试行为。

## 字段与语义核对

适配入口：[hindsight.ts](../../src/context/hindsight.ts)。字段按 [SDK 请求定义](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-clients/typescript/generated/sdk.gen.ts)、[类型定义](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-clients/typescript/generated/types.gen.ts) 及 [客户端实现](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-clients/typescript/src/index.ts) 核对。

| 操作 | 实际契约与本项目处理 |
| --- | --- |
| Recall | POST `/v1/default/banks/{bank_id}/memories/recall`；使用 `query`、`types`、`budget`、`max_tokens` 和严格来源 tags；只接纳允许集合中的 `document_id` 与来源元数据，不接纳服务生成的 text |
| Retain | POST `/v1/default/banks/{bank_id}/memories`；`items`、`async: true`、调用方 UUID `operation_id`；操作身份在发送前持久化 |
| Status | GET `/v1/default/banks/{bank_id}/operations/{operation_id}`；未知结果只查状态，不自动重新入库 |
| Cancel | DELETE 同一操作路径；协作取消后仍查询状态，不能把取消确认理解成没有费用 |
| 文档身份 | bank 由作品 ID 单独生成，document ID 含作品、不可变修订和哈希；不复用章节 ID 覆盖历史 |
| 时间 | 小说正文 `timestamp: unset`，不把导入时间当故事时间；`temporal_window` 是排序倾向，不是硬过滤，应用仍按事件与披露规则判断 |
| 请求限制 | 本地 HTTP 不自动重试，拒绝凭据内嵌 URL、跳转和超过 2 MiB 的响应；断网或取消保留未知费用 |

新版本的异步 Retain 支持调用方 `operation_id` 去重，和 `document_id` 的替换重处理是不同机制。该能力有利于恢复，但仍不能证明后台抽取、Embedding、重排、整合与供应商重试的总费用受本项目 RunBudget 限制。

官方 TypeScript 客户端默认对容量错误进行最多 3 次尝试；[后台任务文档](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-docs/docs/developer/api/operations.mdx) 还说明工作线程有独立重试。Recall 的返回 token 上限只统计结果事实文本，不能代替全部内部调用预算。当前没有生产可用的内部费用闸门，因此 `createHindsightAdapter()` 明确拒绝启用；适配器与同步函数只在注入测试替身时验证，不被页面或创作流程隐式调用。

## 中文部署验证要求

按 [官方多语言配置](https://github.com/vectorize-io/hindsight/blob/v1.1.0/hindsight-docs/docs/developer/multilingual.mdx) 与 [PGroonga 部署目录](https://github.com/vectorize-io/hindsight/tree/v1.1.0/docker/docker-compose/pgroonga) 准备独立临时作品和固定版本服务：

- Embedding 可验证 `HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-m3`。
- 重排可验证 `HINDSIGHT_API_RERANKER_LOCAL_MODEL=BAAI/bge-reranker-v2-m3`。
- 中文全文检索使用支持中文的后端，例如 `HINDSIGHT_API_TEXT_SEARCH_EXTENSION=pgroonga`；需要外部 PostgreSQL 的对应扩展，默认内嵌 pg0 不包含该扩展。
- 模型、数据库与工作线程配置单独管理，凭据不写进仓库。下载、初始化与维度探测也须记录请求；后台整合及重试的关闭或限额需在真实部署上验证。
- 在固定版本官方 Compose 目录完成配置后，使用该目录的 `docker compose up -d` 启动、`docker compose stop` 停止；停止不删除卷。此处是待执行流程，本机没有运行上述命令，尚无可宣称验证通过的本地服务配置。

## 当前准入结果

| 条件 | 结果 |
| --- | --- |
| 四类 API 的请求契约、作品隔离、版本与哈希过滤 | 8 项离线替身回归通过 |
| 原文重新解析、假 ID、取消后响应、未知结果只查询 | 离线回归通过 |
| 普通页面、模块导入、预览与 doctor 无外部请求 | 现有断网测试约束保留 |
| 本机真实服务与重启持久化 | 未验证；本机未找到 Docker |
| 中文向量、重排、全文检索与留出召回 | 未验证；未配置真实服务与模型 |
| 全部内部调用限额、供应商重试和完整费用 | 未验证；当前适配未提供此保障 |
| 服务在途取消、断网与后台任务恢复 | 仅替身验证，真实服务未验证 |

索引失效或不可用时只采用当前 SQLite 快照允许的来源；不会放宽角色知情与披露规则。查询准入记录使用 `novel story service-status`，该命令离线执行。
