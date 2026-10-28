import { readFileSync } from 'node:fs';

export function prompt(name: 'planner-v1' | 'writer-v1'): string {
  return readFileSync(new URL(`../../prompts/${name}.txt`, import.meta.url), 'utf8');
}
