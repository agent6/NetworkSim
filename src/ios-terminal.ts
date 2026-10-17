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

/** Fit one page to the visible terminal cells, reserving room for the prompt and command echo. */
export function terminalPage(lines: string[], options: { columns: number; rows: number; length: number; reservedRows?: number }): { visible: string[]; pending: string[] } {
  if (options.length === 0) return { visible: [...lines], pending: [] };
  const wrapped = terminalRows(lines, options.columns);
  const count = Math.min(options.length, Math.max(1, Math.floor(options.rows) - (options.reservedRows ?? 1)));
  return { visible: wrapped.slice(0, count), pending: wrapped.slice(count) };
}

/** Apply completion at the caret without duplicating a word's existing suffix or separator. */
export function terminalCompletionEdit(value:string,start:number,end:number,completion:string):{value:string;start:number;end:number} {
  const prefix=value.slice(0,start);
  if(completion===prefix)return {value,start,end};
  let suffix=value.slice(end),insert=completion;
  const typed=prefix.match(/\S*$/)![0],completed=completion.trimEnd().match(/\S*$/)![0],remainder=suffix.match(/^\S*/)![0];
  if(remainder&&completed.toLowerCase().startsWith((typed+remainder).toLowerCase()))suffix=suffix.slice(remainder.length);
  const separator=/\s$/.test(insert)&&/^\s/.test(suffix);
  if(separator)insert=insert.slice(0,-1);
  const cursor=insert.length+(separator?1:0);
  return {value:insert+suffix,start:cursor,end:cursor};
}
