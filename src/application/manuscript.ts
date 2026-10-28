import { normalizeText } from '../domain/workspace.js';

export interface ImportedChapter { title: string; content: string }
export function decodeManuscript(raw: Uint8Array): { text: string; encoding: string } {
  const encoding = raw[0] === 0xff && raw[1] === 0xfe ? 'utf-16le'
    : raw[0] === 0xfe && raw[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    const text = normalizeText(new TextDecoder(encoding, { fatal: true }).decode(raw));
    if (!text.trim() || text.includes('\0')) throw new Error('invalid');
    return { text, encoding };
  } catch {
    throw new Error('稿件为空或编码无效，请提供 UTF-8 或带 BOM 的 UTF-16 文本。');
  }
}

export function splitChapters(text: string): ImportedChapter[] {
  const headings = [...text.matchAll(/^(?:##[ \t]+.+|第[零〇一二三四五六七八九十百千万两0-9]+[章回节][^\n]*)$/gmu)];
  if (!headings.length) return [{ title: '正文', content: text }];
  const chapters: ImportedChapter[] = [];
  const first = headings[0]!.index;
  if (text.slice(0, first).trim()) chapters.push({ title: '序言', content: text.slice(0, first) });
  else if (first > 0) headings[0]!.index = 0;
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    chapters.push({ title: heading[0].replace(/^##[ \t]+/u, '').trim(), content: text.slice(heading.index, headings[index + 1]?.index ?? text.length) });
  }
  return chapters;
}
