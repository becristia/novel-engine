import { readFileSync } from 'node:fs';

export function prompt(name: 'planner-v1' | 'writer-v1' | 'reviewer-v1' | 'extractor-v1' | 'impact-v1' | 'planner-story-v1' | 'writer-story-v1' | 'reviewer-story-v1' | 'extractor-story-v1'): string {
  return readFileSync(new URL(`../../prompts/${name}.txt`, import.meta.url), 'utf8');
}
