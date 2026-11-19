import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createWorkspace, CommitService } from '../src/application/workspace.js';
import { ProposalService } from '../src/application/proposals.js';
import { emptyStory } from '../src/domain/story-memory.js';
import { defaultConfig } from '../src/domain/model-config.js';
import { SelectionSchema } from '../src/domain/patch.js';
import { BookStore } from '../src/storage/book-store.js';
import { StoryStore } from '../src/storage/story-store.js';
import { FakeProvider } from '../src/llm/fake-provider.js';
import { ImpactWorkflow } from '../src/workflows/impact.js';
import { CreationWorkflow } from '../src/workflows/creation.js';
import { PatchService } from '../src/proposals/patches.js';
import { selectionContext } from '../src/context/selection.js';
import { blocks } from '../src/review/evidence.js';

it('C09 and C10 only accepts selected story sources and preserves history on undo', async () => {
  await mkdir('.tmp/story-memory-tests', { recursive: true }); const directory = await mkdtemp(resolve('.tmp/story-memory-tests/selection-'));
  createWorkspace(directory, '部分记忆验收'); const book = new BookStore(directory);
  try {
    await new CommitService(book).importFile('fixtures/novels/harbor-light.md', true);
    const config = defaultConfig(); config.model.contextWindowTokens = 100000; config.model.maxOutputTokens = 4000;
    const budget = { maxRequests: 12, maxTokens: 500000 };
    const story = emptyStory(); story.entities = [{ id: 'lin', name: '林舟', aliases: [] }];
    const chapters = book.snapshot().state.chapters;
    const references = chapters.map(chapter => { const revision = book.revision(chapter.revisionId); const block = blocks(revision.content)[1]!; return { chapterId: chapter.id, revisionId: revision.id, blockId: block.id, quote: block.text, contentHash: revision.contentHash }; });
    story.claims.push({ id: 'old', subjectId: 'lin', relation: 'event', value: '旧章线索', kind: 'fact', holderId: null, fromEventId: null, untilEventId: null, visibility: 'public', confirmed: true, status: 'fresh', dependsOn: [], correctsId: null, source: { ...references[0]!, kind: 'text' } });
    new StoryStore(book).save(story, 1); const before = book.snapshot();
    const impact = { impacts: [], groups: references.map((target, index) => ({ id: `g${index}`, reason: '核对线索', dependsOn: [], changes: [{ target, replacement: `林舟核对第 ${index} 处线索。` }] })) };
    const proposal = await new ImpactWorkflow(book, config, new FakeProvider([JSON.stringify(impact)]), budget).analyze(chapters[0]!.id, '改两处线索');
    const patches = new PatchService(book); const selected = patches.select(proposal.proposal.id, ['g0', 'g1']); const payload = SelectionSchema.parse(selected.payload);
    const context = selectionContext(book, selected, payload.drafts[0]!.revisionId);
    expect(JSON.parse(context.sources.find(item => item.kind === 'story-state')!.text).claims[0].status).toBe('stale');
    expect(context.sources.find(item => item.id === chapters[2]!.id)?.text).toBe(book.revision(chapters[2]!.revisionId).content);
    const clean = JSON.stringify({ summary: '已核对所选正文', issues: [] });
    const forged = { events: [], claims: [{ ...story.claims[0]!, id: 'bad-source', confirmed: false, status: 'pending' }], knowledge: [], disclosures: [], threads: [] };
    await expect(new CreationWorkflow(book, config, new FakeProvider([clean, JSON.stringify({ facts: [], story: forged })]), budget).review(payload.drafts[0]!.revisionId)).rejects.toThrow('引用来源');
    const service = new ProposalService(book); expect(() => service.approve(selected.id)).toThrow('提取');
    for (const draft of payload.drafts) await new CreationWorkflow(book, config, new FakeProvider([clean, JSON.stringify({ facts: [], story: { events: [], claims: [], knowledge: [], disclosures: [], threads: [] } })]), budget).review(draft.revisionId);
    service.approve(selected.id);
    expect(book.snapshot().state.chapters[2]!.revisionId).toBe(chapters[2]!.revisionId); expect(book.snapshot().state.story!.claims[0]!.status).toBe('stale');
    patches.undo(selected.id, book.project().version);
    expect(new CommitService(book).exportText()).toBe(new CommitService(book).exportText(before.version));
    expect(book.snapshot(before.version).state.story!.claims[0]!.status).toBe('fresh'); expect(book.snapshot().state.story!.claims[0]!.status).toBe('stale');
  } finally { book.close(); await rm(directory, { recursive: true }); }
});
