const punctuation: Record<string, string> = {
  ',': '，', ':': '：', ';': '；', '?': '？', '!': '！', '.': '。',
};

// Use only for application-authored messages, never manuscript text or literal paths.
export function formatHumanText(text: string): string {
  return text
    .replace(/—+/gu, '--')
    .replace(/(\p{Script=Han})([A-Za-z0-9])/gu, '$1 $2')
    .replace(/([A-Za-z0-9])(\p{Script=Han})/gu, '$1 $2')
    .replace(/(\p{Script=Han})([,:;?!.])/gu, (_, han: string, mark: string) => `${han}${punctuation[mark]}`)
    .replace(/([,:;?!.])(?=\p{Script=Han})/gu, (mark) => punctuation[mark] ?? mark)
    .replace(/\s*([，。：；！？])\s*/gu, '$1');
}

export function formatField(label: string, literal: string): string {
  return `${formatHumanText(label)}：${literal}`;
}
