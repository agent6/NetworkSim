export interface AlignmentItem { id: string; x: number; y: number; halfWidth: number; halfHeight: number }
export interface AlignmentGuide { x1: number; y1: number; x2: number; y2: number; spacing?: boolean }
export interface AlignedMove { x: number; y: number; guides: AlignmentGuide[] }

/** Screen-sized magnetic tolerance, center guides, and equal edge spacing. */
export function alignMove(moving: AlignmentItem, others: AlignmentItem[], scale: number, bypass = false): AlignedMove {
  if (bypass) return { x: moving.x, y: moving.y, guides: [] };
  const threshold = 8 / Math.max(.2, scale), guides: AlignmentGuide[] = [];
  let x = Math.round(moving.x / 10) * 10, y = Math.round(moving.y / 10) * 10;
  for (const axis of ['x', 'y'] as const) {
    const cross = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'halfWidth' : 'halfHeight';
    let best: { value: number; distance: number; partners: AlignmentItem[]; spacing: boolean } | undefined;
    const offer = (value: number, partners: AlignmentItem[], spacing: boolean) => {
      const distance = Math.abs(value - moving[axis]);
      if (distance <= threshold && (!best || distance < best.distance - .01)) best = { value, distance, partners, spacing };
    };
    for (const item of others) offer(item[axis], [item], false);
    const row = others.filter(item => Math.abs(item[cross] - moving[cross]) < 28 / Math.max(.2, scale)).sort((a, b) => a[axis] - b[axis]);
    for (let index = 1; index < row.length; index++) {
      const a = row[index - 1], b = row[index], gap = b[axis] - a[axis] - a[size] - b[size];
      if (gap < 12) continue;
      const middle = (a[axis] + b[axis] + a[size] - b[size]) / 2;
      if (middle - moving[size] - a[axis] - a[size] >= 10) offer(middle, [a, b], true);
      offer(b[axis] + b[size] + gap + moving[size], [a, b], true);
      offer(a[axis] - a[size] - gap - moving[size], [a, b], true);
    }
    if (!best) continue;
    const chosen = best as { value: number; partners: AlignmentItem[]; spacing: boolean };
    if (axis === 'x') x = chosen.value; else y = chosen.value;
    if (!chosen.spacing) {
      const min = Math.min(moving[cross], ...chosen.partners.map(p => p[cross])) - 52;
      const max = Math.max(moving[cross], ...chosen.partners.map(p => p[cross])) + 52;
      guides.push(axis === 'x' ? { x1: x, x2: x, y1: min, y2: max } : { y1: y, y2: y, x1: min, x2: max });
    } else {
      const ordered = [...chosen.partners, { ...moving, [axis]: chosen.value }].sort((a, b) => a[axis] - b[axis]);
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1], b = ordered[i], crossAt = Math.max(a[cross], b[cross]) + 36;
        guides.push(axis === 'x' ? { x1: a.x + a.halfWidth, x2: b.x - b.halfWidth, y1: crossAt, y2: crossAt, spacing: true } : { y1: a.y + a.halfHeight, y2: b.y - b.halfHeight, x1: crossAt, x2: crossAt, spacing: true });
      }
    }
  }
  return { x, y, guides };
}
