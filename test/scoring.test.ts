import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRollup } from '../src/score.ts';
import type { Factor, Rollup, Upgrades } from '../src/types.ts';

const best: Rollup = {
  name: 'Best', stage: 2, proofSystem: 'validity', permissionlessProving: true, exitWindowDays: 30,
  upgrades: { type: 'securityCouncil', threshold: 12, members: 12 }, dataAvailability: 'ethereumBlobs', forceInclusion: true,
};
const worst: Rollup = {
  name: 'Worst', stage: 0, proofSystem: 'none', permissionlessProving: false, exitWindowDays: 0,
  upgrades: { type: 'singleKey' }, dataAvailability: 'external', forceInclusion: false,
};

function pts(r: Partial<Rollup>, factor: Factor): number {
  const f = scoreRollup({ ...best, ...r }).factors.find((x) => x.factor === factor);
  assert.ok(f);
  return f.points;
}

test('factor order, maxPoints sum 100, totals 100 and 0', () => {
  const s = scoreRollup(best);
  assert.deepEqual(s.factors.map((f) => f.factor), ['stage', 'proofSystem', 'permissionlessProving', 'exitWindowDays', 'upgrades', 'dataAvailability', 'forceInclusion']);
  assert.deepEqual(s.factors.map((f) => f.maxPoints), [20, 20, 10, 15, 15, 10, 10]);
  assert.equal(s.factors.reduce((a, f) => a + f.maxPoints, 0), 100);
  assert.equal(s.score, 100);
  assert.equal(s.rollup, best);
  const w = scoreRollup(worst);
  assert.equal(w.score, 0);
  for (const f of w.factors) { assert.equal(f.points, 0); assert.ok(f.reason.length > 0); }
});

test('score is sum of points and an integer', () => {
  const s = scoreRollup({ ...best, stage: 1, exitWindowDays: 3.5, upgrades: { type: 'multisig' } });
  assert.equal(s.score, s.factors.reduce((a, f) => a + f.points, 0));
  assert.equal(s.score, 100 - 10 - 10 - 10);
  assert.ok(Number.isInteger(s.score));
});

test('stage', () => {
  assert.equal(pts({ stage: 0 }, 'stage'), 0);
  assert.equal(pts({ stage: 1 }, 'stage'), 10);
  assert.equal(pts({ stage: 2 }, 'stage'), 20);
});

test('proof system', () => {
  assert.equal(pts({ proofSystem: 'fraud' }, 'proofSystem'), 20);
  assert.equal(pts({ proofSystem: 'validity' }, 'proofSystem'), 20);
  assert.equal(pts({ proofSystem: 'none' }, 'proofSystem'), 0);
});

test('permissionless proving gated on live proofs', () => {
  assert.equal(pts({ proofSystem: 'fraud', permissionlessProving: true }, 'permissionlessProving'), 10);
  assert.equal(pts({ proofSystem: 'validity', permissionlessProving: true }, 'permissionlessProving'), 10);
  assert.equal(pts({ proofSystem: 'fraud', permissionlessProving: false }, 'permissionlessProving'), 0);
  assert.equal(pts({ proofSystem: 'none', permissionlessProving: true }, 'permissionlessProving'), 0);
  const f = scoreRollup({ ...best, proofSystem: 'none' }).factors[2];
  assert.match(f.reason, /none/);
  assert.match(f.reason, /live/);
});

test('exit window boundaries', () => {
  const cases: [number, number][] = [[0, 0], [0.5, 5], [6.99, 5], [7, 10], [29.99, 10], [30, 15], [365, 15]];
  for (const [d, p] of cases) {
    assert.equal(pts({ exitWindowDays: d }, 'exitWindowDays'), p, `days ${d}`);
    assert.match(scoreRollup({ ...best, exitWindowDays: d }).factors[3].reason, new RegExp(String(d).replace('.', '\\.')));
  }
});

test('upgrades branches and council boundaries', () => {
  const cases: [Upgrades, number][] = [
    [{ type: 'singleKey' }, 0],
    [{ type: 'multisig' }, 5],
    [{ type: 'securityCouncil', threshold: 1, members: 1 }, 0],
    [{ type: 'securityCouncil', threshold: 1, members: 12 }, 0],
    [{ type: 'securityCouncil', threshold: 2, members: 3 }, 10],
    [{ type: 'securityCouncil', threshold: 3, members: 4 }, 15],
    [{ type: 'securityCouncil', threshold: 7, members: 12 }, 5],
    [{ type: 'securityCouncil', threshold: 8, members: 12 }, 10],
    [{ type: 'securityCouncil', threshold: 9, members: 12 }, 15],
    [{ type: 'securityCouncil', threshold: 12, members: 12 }, 15],
  ];
  for (const [u, p] of cases) {
    assert.equal(pts({ upgrades: u }, 'upgrades'), p, JSON.stringify(u));
    if (u.type === 'securityCouncil') assert.match(scoreRollup({ ...best, upgrades: u }).factors[4].reason, new RegExp(`${u.threshold} of ${u.members}`));
  }
});

test('data availability', () => {
  assert.equal(pts({ dataAvailability: 'ethereumBlobs' }, 'dataAvailability'), 10);
  assert.equal(pts({ dataAvailability: 'ethereumCalldata' }, 'dataAvailability'), 10);
  assert.equal(pts({ dataAvailability: 'external' }, 'dataAvailability'), 0);
});

test('force inclusion', () => {
  assert.equal(pts({ forceInclusion: true }, 'forceInclusion'), 10);
  assert.equal(pts({ forceInclusion: false }, 'forceInclusion'), 0);
});

test('does not mutate input', () => {
  const r = structuredClone(best);
  scoreRollup(r);
  assert.deepEqual(r, best);
});
