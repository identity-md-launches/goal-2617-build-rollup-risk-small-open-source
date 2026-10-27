import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const strongest = {
  name: 'Alpha',
  stage: 2,
  proofSystem: 'validity',
  permissionlessProving: true,
  exitWindowDays: 30,
  upgrades: { type: 'securityCouncil', threshold: 3, members: 4 },
  dataAvailability: 'ethereumBlobs',
  forceInclusion: true,
};

const lesser = {
  name: 'Beta',
  stage: 1,
  proofSystem: 'fraud',
  permissionlessProving: false,
  exitWindowDays: 7,
  upgrades: { type: 'multisig' },
  dataAvailability: 'ethereumCalldata',
  forceInclusion: false,
};

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function fixture(t: test.TestContext, name: string, value: unknown): string {
  mkdirSync(tmpdir(), { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'rollup-risk-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function textFixture(t: test.TestContext, name: string, text: string): string {
  mkdirSync(tmpdir(), { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'rollup-risk-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

test('prints a ranked table', (t) => {
  const path = fixture(t, 'rollups.json', [lesser, strongest]);
  const result = run([path]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    'Rank  Rollup  Stage  Score\n1     Alpha   2      100\n2     Beta    1      55\n',
  );
});

test('prints ranked JSON with --json before or after the path', (t) => {
  const path = fixture(t, 'rollups.json', [lesser, strongest]);
  const before = run(['--json', path]);
  const after = run([path, '--json']);

  assert.equal(before.status, 0);
  assert.equal(after.status, 0);
  assert.equal(before.stderr, '');
  assert.equal(after.stderr, '');
  assert.equal(before.stdout, after.stdout);
  assert.deepEqual(JSON.parse(before.stdout).map((entry: { rollup: { name: string } }) => entry.rollup.name), [
    'Alpha',
    'Beta',
  ]);
  assert.equal(before.stdout.endsWith('\n'), true);
});

test('prints help without reading an input file', () => {
  for (const flag of ['--help', '-h']) {
    const result = run([flag]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'Usage: rollup-risk <input.json> [--json]\n');
    assert.equal(result.stderr, '');
  }
});

test('reports file and JSON parsing failures only on stderr', (t) => {
  const missing = run([join(tmpdir(), 'rollup-risk-file-that-does-not-exist.json')]);
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /Could not read/);

  const path = textFixture(t, 'broken.json', '{not JSON');
  const broken = run([path]);
  assert.notEqual(broken.status, 0);
  assert.equal(broken.stdout, '');
  assert.match(broken.stderr, /Could not parse JSON/);
});

test('reports every validation issue only on stderr', (t) => {
  const path = fixture(t, 'invalid.json', [{}]);
  const result = run([path]);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Validation failed:/);
  assert.match(result.stderr, /\$\[0\]\.name:/);
  assert.match(result.stderr, /\$\[0\]\.stage:/);
  assert.match(result.stderr, /\$\[0\]\.forceInclusion:/);
});

test('prints only the table header for an empty array', (t) => {
  const path = fixture(t, 'empty.json', []);
  const result = run([path]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'Rank  Rollup  Stage  Score\n');
});

test('importing the public entrypoint has no output or CLI side effects', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', "import './src/index.ts';"], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
