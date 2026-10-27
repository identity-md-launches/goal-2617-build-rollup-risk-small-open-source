import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankRollups } from '../src/rank.ts';
import type { Rollup } from '../src/types.ts';

const base: Rollup = {
  name: 'X', stage: 2, proofSystem: 'fraud', permissionlessProving: true, exitWindowDays: 30,
  upgrades: { type: 'securityCouncil', threshold: 9, members: 12 }, dataAvailability: 'ethereumBlobs', forceInclusion: true,
};
const mk = (name: string, o: Partial<Rollup> = {}): Rollup => ({ ...base, name, ...o });

test('empty input', () => {
  assert.deepEqual(rankRollups([]), []);
});

test('orders by score descending with ranks 1..n', () => {
  const input = [mk('Low', { stage: 0 }), mk('High'), mk('Mid', { stage: 1 })];
  const out = rankRollups(input);
  assert.deepEqual(out.map((r) => r.rollup.name), ['High', 'Mid', 'Low']);
  assert.deepEqual(out.map((r) => r.score), [100, 90, 80]);
  assert.deepEqual(out.map((r) => r.rank), [1, 2, 3]);
  assert.equal(out[0].factors.length, 7);
});

test('name tie-break uses plain string comparison', () => {
  const out = rankRollups([mk('b'), mk('B'), mk('a'), mk('A')]);
  assert.deepEqual(out.map((r) => r.rollup.name), ['A', 'B', 'a', 'b']);
  assert.deepEqual(out.map((r) => r.rank), [1, 2, 3, 4]);
});

test('exact ties keep original order', () => {
  const first = mk('Same', { upgrades: { type: 'securityCouncil', threshold: 3, members: 4 } });
  const second = mk('Same');
  const out = rankRollups([first, second]);
  assert.equal(out[0].rollup, first);
  assert.equal(out[1].rollup, second);
  assert.deepEqual(out.map((r) => r.rank), [1, 2]);
});

test('does not mutate input', () => {
  const input = [mk('Low', { stage: 0 }), mk('High')];
  const copy = structuredClone(input);
  const out = rankRollups(input);
  assert.deepEqual(input, copy);
  assert.notEqual(out as unknown, input as unknown);
});
