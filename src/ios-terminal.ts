/** Apply the session's terminal column limit before counting pager rows. Width 0 disables wrapping. */
export function terminalRows(lines: string[], width: number): string[] {
  if (!Number.isInteger(width) || width <= 0) return [...lines];
  return lines.flatMap(line => {
    const columns: string[] = [];
    for (const character of line) {
      if (character === '\t') columns.push(...Array(8 - columns.length % 8).fill(' '));
      else columns.push(character);
    }
    if (!columns.length) return [''];
    const rows: string[] = [];
    for (let offset = 0; offset < columns.length; offset += width) rows.push(columns.slice(offset, offset + width).join(''));
    return rows;
  });
}
