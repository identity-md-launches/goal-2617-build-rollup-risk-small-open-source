import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { rankRollups, scoreRollup, validateRollups } from '../src/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const inputPath = fileURLToPath(new URL('../examples/rollups.json', import.meta.url));
const expectedTextPath = fileURLToPath(new URL('../examples/expected.txt', import.meta.url));
const expectedJsonPath = fileURLToPath(new URL('../examples/expected.json', import.meta.url));

const inputText = readFileSync(inputPath, 'utf8');
const expectedText = readFileSync(expectedTextPath, 'utf8');
const expectedJson = readFileSync(expectedJsonPath, 'utf8');

const fieldOrder = [
  'name',
  'stage',
  'proofSystem',
  'permissionlessProving',
  'exitWindowDays',
  'upgrades',
  'dataAvailability',
  'forceInclusion',
];

const inputOrder = ['Arbitrum One', 'OP Mainnet', 'Base', 'ZKsync Era', 'Starknet', 'Scroll'];

const expectedRanking: Array<[string, number]> = [
  ['Arbitrum One', 85],
  ['OP Mainnet', 75],
  ['Base', 70],
  ['Starknet', 65],
  ['ZKsync Era', 50],
  ['Scroll', 45],
];

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}

test('example input is canonical two-space JSON with a trailing newline', () => {
  assert.equal(JSON.stringify(JSON.parse(inputText), null, 2) + '\n', inputText);
});

test('example input keeps the snapshot order, key order and blob DA', () => {
  const rows = JSON.parse(inputText) as Array<Record<string, unknown>>;
  assert.deepEqual(
    rows.map((row) => row.name),
    inputOrder,
  );
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), fieldOrder);
    assert.equal(row.dataAvailability, 'ethereumBlobs');
  }
});

test('all six example rows validate without issues', () => {
  const input = JSON.parse(inputText);
  const result = validateRollups(input);
  assert.equal(result.valid, true, JSON.stringify(result));
  if (result.valid) {
    assert.equal(result.rollups.length, 6);
    assert.deepEqual(result.rollups, input);
  }
});

test('each example row validates on its own', () => {
  for (const row of JSON.parse(inputText)) {
    assert.equal(validateRollups([row]).valid, true, row.name);
  }
});

test('example scores match the stated per-rollup totals', () => {
  const byName = new Map(expectedRanking);
  for (const row of JSON.parse(inputText)) {
    const scored = scoreRollup(row);
    assert.equal(scored.score, byName.get(row.name), row.name);
    assert.equal(
      scored.factors.reduce((sum, factor) => sum + factor.points, 0),
      scored.score,
    );
  }
});

test('example ranking matches the stated order and ranks 1..6', () => {
  const ranked = rankRollups(JSON.parse(inputText));
  assert.deepEqual(
    ranked.map((entry) => [entry.rollup.name, entry.score]),
    expectedRanking,
  );
  assert.deepEqual(
    ranked.map((entry) => entry.rank),
    [1, 2, 3, 4, 5, 6],
  );
});

test('expected.json equals the library result in CLI JSON format', () => {
  const ranked = rankRollups(JSON.parse(inputText));
  assert.equal(JSON.stringify(ranked, null, 2) + '\n', expectedJson);
});

test('CLI table output equals expected.txt byte for byte', () => {
  const result = runCli(['examples/rollups.json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, expectedText);
  assert.ok(expectedText.endsWith('\n') && !expectedText.endsWith('\n\n'));
});

test('CLI JSON output equals expected.json byte for byte, flag on either side', () => {
  for (const args of [['--json', 'examples/rollups.json'], ['examples/rollups.json', '--json']]) {
    const result = runCli(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, expectedJson);
  }
  assert.ok(expectedJson.endsWith(']\n'));
});

test('expected.txt lists the stated ranking with stages and scores', () => {
  const lines = expectedText.slice(0, -1).split('\n');
  assert.deepEqual(lines[0].split(/\s{2,}/), ['Rank', 'Rollup', 'Stage', 'Score']);
  const stages = new Map(
    (JSON.parse(inputText) as Array<{ name: string; stage: number }>).map((row) => [row.name, row.stage]),
  );
  assert.deepEqual(
    lines.slice(1).map((line) => line.split(/\s{2,}/)),
    expectedRanking.map(([name, score], index) => [
      String(index + 1),
      name,
      String(stages.get(name)),
      String(score),
    ]),
  );
  for (const line of lines) assert.equal(line, line.trimEnd());
});
