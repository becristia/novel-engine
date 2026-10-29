import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Library } from '../../src/server/library.js';
import { createHttpServer } from '../../src/server/http.js';
import { defaultConfig } from '../../src/domain/model-config.js';
import type { ModelRequest } from '../../src/llm/model-gateway.js';
import { RequestFailure } from '../../src/llm/request-failure.js';

const unknownPrompts = new Set<string>();

// This deterministic transport is only a browser-test fixture; it never constructs
// a real provider. Source IDs are read from the exact prompt sent by the core.
function fixtureResponse(request: ModelRequest): string {
  if (request.prompt.startsWith('你是小说规划助手')) {
    const count = Number(/章节数：(\d+)/u.exec(request.prompt)?.[1] ?? 3);
    return JSON.stringify({ chapters: Array.from({ length: count }, (_, index) => ({ title: ['雨夜归港', '封存的信', '旧伤'][index] ?? `后续章节 ${index + 1}`, goal: '寻找旧信与失踪航次的线索。', characters: ['林舟', '沈砚'], constraints: ['保留林舟的有限视角。'], events: ['发现线索', '决定继续调查'], targetLength: 3200, viewpointCharacter: '林舟' })) });
  }
  if (request.prompt.startsWith('你是小说写作助手')) {
    const context = JSON.parse(request.prompt.split('\n').find(line => line.startsWith('{"projectVersion"'))!) as { plan: { ordinal: number } };
    const injury = context.plan.ordinal === 1 && !request.prompt.includes('作者修订要求');
    return `雨停以后，码头只剩下缆绳轻碰船舷的声音。林舟推开旧屋的门，把那封没有署名的信放在灯下。\n\n沈砚没有跟进来。他站在门外，听见屋里传来纸页翻动的轻响。\n\n${injury ? '右手骨折，三天内不可执笔。当天傍晚，他用受伤的右手写下整页名单。' : '当天傍晚，他用左手记下名单。'}\n\n林舟把铜钥匙收进衣袋，转身离开了仓库。`;
  }
  if (request.prompt.startsWith('你是小说审稿助手')) {
    const input = JSON.parse(request.prompt.split('\n').find(line => line.startsWith('{"targetRevisionId"'))!) as { targetRevisionId: string; sources: { chapterId: string; revisionId: string; blocks: { id: string; text: string }[] }[] };
    const target = input.sources.find(source => source.revisionId === input.targetRevisionId)!;
    const conflict = target.blocks.find(block => block.text.includes('受伤的右手'));
    return JSON.stringify({ summary: conflict ? '需要处理伤势冲突。' : '本次审稿未发现问题。', issues: conflict ? [{ id: 'injury', kind: 'conflict', message: '伤势前后矛盾', suggestion: '改用左手记录。', evidence: [{ chapterId: target.chapterId, revisionId: target.revisionId, blockId: conflict.id, quote: conflict.text }] }] : [] });
  }
  if (request.prompt.startsWith('从目标候选正文')) {
    const source = JSON.parse(request.prompt.split('\n').find(line => line.startsWith('{"chapterId"'))!) as { chapterId: string; revisionId: string; blocks: { id: string; text: string }[] };
    const block = source.blocks.find(item => item.text.includes('铜钥匙'));
    return JSON.stringify({ facts: block ? [{ subject: '林舟', relation: 'possession', value: '铜钥匙', kind: 'fact', characterId: '林舟', storyTime: null, knowledgeTime: null, evidence: { chapterId: source.chapterId, revisionId: source.revisionId, blockId: block.id, quote: block.text } }] : [] });
  }
  if (request.prompt.startsWith('生成简短的章节摘要')) {
    const source = JSON.parse(request.prompt.split('\n').find(line => line.startsWith('{"chapterId"'))!) as { chapterId: string; revisionId: string; blocks: { id: string; text: string }[] };
    const block = source.blocks.find(item => !item.text.startsWith('##'))!;
    return JSON.stringify({ summary: block.text, evidence: [{ chapterId: source.chapterId, revisionId: source.revisionId, blockId: block.id, quote: block.text }] });
  }
  if (request.prompt.startsWith('返回一个对象')) return '{"ok":true}';
  throw new Error('Browser fixture received an unsupported prompt.');
}

await mkdir('.tmp/ui-implementation', { recursive: true });
const directory = await mkdtemp(resolve('.tmp/ui-implementation/browser-'));
const config = defaultConfig(); config.model.maxOutputTokens = 2048; config.model.contextWindowTokens = 32000;
if (config.model.provider === 'fake') config.model.responsesFile = 'browser-test-fixture';
const service = createHttpServer({ library: new Library(directory), config: async () => ({ config, source: 'builtin' }), staticDirectory: resolve('dist/web'), transport: async () => ({ generateText: async request => {
  await new Promise(resolveWait => setTimeout(resolveWait, request.prompt.includes('取消验收') ? 2200 : 120));
  if (request.prompt.includes('未知请求验收') && !unknownPrompts.has(request.prompt)) { unknownPrompts.add(request.prompt); throw new RequestFailure('unknown', false, 'fixture-disconnect'); }
  return { value: fixtureResponse(request), modelId: 'fake-v1', usage: null };
} }) });
await service.listen(3918);
const stop = () => { service.server.close(() => { void rm(directory, { recursive: true }).finally(() => process.exit(0)); }); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
