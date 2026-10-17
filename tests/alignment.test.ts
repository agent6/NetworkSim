import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignMove, type AlignmentItem } from '../src/alignment.ts';
const item = (id: string, x: number, y: number, halfWidth = 30): AlignmentItem => ({ id, x, y, halfWidth, halfHeight: 30 });
test('center snapping has a consistent screen tolerance at different zoom levels', () => {
  assert.equal(alignMove(item('move', 106, 200), [item('fixed', 100, 0)], 1).x, 100);
  assert.equal(alignMove(item('move', 106, 200), [item('fixed', 100, 0)], 2).guides.length, 0);
  assert.equal(alignMove(item('move', 112, 200), [item('fixed', 100, 0)], .5).x, 100);
});
test('equal spacing snaps between and beyond an aligned pair', () => {
  const peers = [item('left', 0, 100), item('right', 200, 100)];
  assert.equal(alignMove(item('move', 103, 100), peers, 1).x, 100);
  const result = alignMove(item('move', 396, 100), peers, 1);
  assert.equal(result.x, 400); assert.equal(result.guides.filter(g => g.spacing).length, 2);
});
test('spacing accounts for item widths and ignores unrelated rows', () => {
  const peers = [item('left', 0, 100, 20), item('right', 240, 100, 40)];
  assert.equal(alignMove(item('move', 114, 100, 30), peers, 1).x, 110);
  assert.equal(alignMove(item('move', 114, 400, 30), peers, 1).guides.length, 0);
});
test('Alt bypass preserves precise coordinates without guides or grid snapping', () => {
  assert.deepEqual(alignMove(item('move', 106.5, 204.2), [item('fixed', 100, 200)], 1, true), { x: 106.5, y: 204.2, guides: [] });
});
