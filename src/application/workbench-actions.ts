import { ActionSchema } from '../domain/workbench.js';
import { CommitService } from './workspace.js';
import { ProposalService } from './proposals.js';
import { MemoryStore } from '../storage/memory-store.js';
import { RunStore } from '../storage/run-store.js';
import { BookStore } from '../storage/book-store.js';
import { PatchService } from '../proposals/patches.js';
import { StoryStore } from '../storage/story-store.js';

export function workbenchAction(book: BookStore, value: unknown): unknown {
  const input = ActionSchema.parse(value);
  if (input.action === 'cancel') { new RunStore(book).cancel(input.runId); return { cancelled: true }; }
  return book.db.transaction(() => {
    if (book.project().version !== input.expectedVersion) throw new Error('项目版本已改变，请刷新后重新确认操作。');
    const proposals = new ProposalService(book); const memory = new MemoryStore(book);
    const commits = new CommitService(book); const patches = new PatchService(book);
    switch (input.action) {
      case 'story-save': return new StoryStore(book).save(input.story, input.expectedVersion);
      case 'story-set': return new StoryStore(book).upsert(input.collection, input.value, input.expectedVersion);
      case 'story-confirm': return new StoryStore(book).confirm(input.ids, input.expectedVersion);
      case 'story-apply': return new StoryStore(book).applyCandidate(input.revisionId, input.expectedVersion);
      case 'story-correct': return new StoryStore(book).correct(input.id, input.value, input.expectedVersion);
      case 'approve': return proposals.approve(input.proposalId, input.reason);
      case 'reject': proposals.reject(input.proposalId); return { rejected: true };
      case 'edit-plan': return proposals.editPlan(input.proposalId, input.chapter, input.plan);
      case 'replace': return commits.replace(input.chapterId, input.content, input.expectedVersion, input.requestId);
      case 'insert': return commits.insert(input.title, input.content, input.position, input.expectedVersion);
      case 'reorder': return commits.reorder(input.chapterIds, input.expectedVersion);
      case 'confirm-facts': return memory.confirm(input.ids);
      case 'correct-fact': return memory.correct(input.id, input.fact);
      case 'aliases': memory.setAliases(input.entity, input.names); return { updated: true };
      case 'constraints': memory.setConstraints(input.values, input.expectedVersion); return { updated: true };
      case 'select-patch': return patches.select(input.proposalId, input.groups);
      case 'lock': return { id: patches.lock(input.chapterId, input.blockId) };
      case 'unlock': patches.unlock(input.id); return { unlocked: true };
      case 'undo': return patches.undo(input.proposalId, input.expectedVersion);
      case 'restore': {
        const revision = book.revision(input.revisionId);
        if (revision.chapterId !== input.chapterId) throw new Error('历史正文不属于该章节。');
        return commits.replace(input.chapterId, revision.content, input.expectedVersion);
      }
    }
  }).immediate();
}
