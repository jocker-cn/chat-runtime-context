/** Keep narrative text and a small table preview in the analytics copy. */
export function compactAgentResponse(content: string): string {
  const lines = content
    .replace(/^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^ {0,3}\1[ \t]*\r?$/gm, "[代码块已省略]")
    .split(/\r?\n/);
  const result: string[] = [];
  const tableSeparator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    if (!lines[i].includes("|") || !tableSeparator.test(lines[i + 1] ?? "")) continue;
    result.push(lines[++i]);
    let rows = 0;
    while (i + 1 < lines.length && lines[i + 1].includes("|")) {
      const row = lines[++i];
      if (rows++ < 2) result.push(row);
    }
    if (rows > 2) result.push(`[表格其余 ${rows - 2} 行已省略]`);
  }
  return result.join("\n");
}
