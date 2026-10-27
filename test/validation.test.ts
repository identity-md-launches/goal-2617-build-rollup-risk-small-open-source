import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRollups } from '../src/validate.ts';
import type { ValidationIssue } from '../src/types.ts';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Example',
    stage: 1,
    proofSystem: 'fraud',
    permissionlessProving: true,
    exitWindowDays: 7,
    upgrades: { type: 'securityCouncil', threshold: 9, members: 12 },
    dataAvailability: 'ethereumBlobs',
    forceInclusion: true,
    ...overrides,
  };
}

function without(key: string): Record<string, unknown> {
  const row = valid();
  delete row[key];
  return row;
}

function issues(input: unknown): ValidationIssue[] {
  const result = validateRollups(input);
  assert.equal(result.valid, false, 'expected invalid input');
  if (result.valid) throw new Error('unreachable');
  for (const issue of result.errors) {
    assert.equal(typeof issue.message, 'string');
    assert.ok(issue.message.length > 0, `empty message at ${issue.path}`);
  }
  return result.errors;
}

/** Path and code pairs, ignoring wording. */
function codes(input: unknown): [string, string][] {
  return issues(input).map((issue) => [issue.path, issue.code]);
}

function assertValid(input: unknown[]): void {
  const result = validateRollups(input);
  assert.equal(result.valid, true, JSON.stringify(result));
  if (!result.valid) return;
  assert.notEqual(result.rollups, input, 'returned array must be new');
  assert.deepEqual(result.rollups, input);
}

test('empty array is valid and returns a new empty array', () => {
  const input: unknown[] = [];
  const result = validateRollups(input);
  assert.deepEqual(result, { valid: true, rollups: [] });
  if (result.valid) assert.notEqual(result.rollups, input);
});

test('a fully valid row is accepted with the same objects and no mutation', () => {
  const row = valid();
  const snapshot = structuredClone(row);
  const input = [row];
  const result = validateRollups(input);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.rollups[0], row);
  assert.deepEqual(row, snapshot);
  assert.equal(input.length, 1);
});

test('top-level input that is not an array is rejected at $', () => {
  for (const input of [null, undefined, {}, 'x', 1, true, valid()]) {
    assert.deepEqual(codes(input), [['$', 'invalid_type']], String(input));
  }
});

test('non-object rows are rejected without descendant errors', () => {
  assert.deepEqual(codes([null, [], 'row', 3, false, undefined, valid()]), [
    ['$[0]', 'invalid_type'],
    ['$[1]', 'invalid_type'],
    ['$[2]', 'invalid_type'],
    ['$[3]', 'invalid_type'],
    ['$[4]', 'invalid_type'],
    ['$[5]', 'invalid_type'],
  ]);
});

test('prototype edge cases: null prototype ok, inherited fields missing, class instances rejected', () => {
  const nullProto = Object.assign(Object.create(null), valid());
  assertValid([nullProto]);

  // An object with a custom prototype is not plain, even if it inherits every field.
  assert.deepEqual(codes([Object.create(valid())]), [['$[0]', 'invalid_type']]);

  // Fields inherited from a polluted Object.prototype are not own properties.
  const proto = Object.prototype as Record<string, unknown>;
  proto.stage = 1;
  proto.extraInherited = true;
  try {
    assert.deepEqual(codes([without('stage')]), [['$[0].stage', 'required']]);
    assertValid([valid()]);
  } finally {
    delete proto.stage;
    delete proto.extraInherited;
  }

  class Row {}
  assert.deepEqual(codes([new Row(), new Date(), new Map()]), [
    ['$[0]', 'invalid_type'],
    ['$[1]', 'invalid_type'],
    ['$[2]', 'invalid_type'],
  ]);

  // Inherited Object.prototype members such as toString are not own properties.
  const parsed = JSON.parse('[{"__proto__": {"x": 1}, "constructor": 1}]');
  assert.deepEqual(codes(parsed).filter(([, c]) => c === 'unknown_field'), [
    ['$[0].__proto__', 'unknown_field'],
    ['$[0].constructor', 'unknown_field'],
  ]);
  assert.equal(codes(parsed).filter(([, c]) => c === 'required').length, 8);
});

test('every missing field is reported as required in schema order', () => {
  assert.deepEqual(
    codes([{}]),
    ['name', 'stage', 'proofSystem', 'permissionlessProving', 'exitWindowDays', 'upgrades', 'dataAvailability', 'forceInclusion']
      .map((f) => [`$[0].${f}`, 'required']),
  );
  assert.deepEqual(codes([without('exitWindowDays')]), [['$[0].exitWindowDays', 'required']]);
  // undefined value is present as an own property, so it is a type error, not required.
  assert.deepEqual(codes([valid({ forceInclusion: undefined })]), [['$[0].forceInclusion', 'invalid_type']]);
});

test('unknown keys are reported after schema fields in object order with path quoting', () => {
  const row = { zeta: 1, ...valid(), 'odd.key': 2, 'has space': 3, _ok$1: 4, '1abc': 5 };
  assert.deepEqual(codes([row]), [
    ['$[0].zeta', 'unknown_field'],
    ['$[0]["odd.key"]', 'unknown_field'],
    ['$[0]["has space"]', 'unknown_field'],
    ['$[0]._ok$1', 'unknown_field'],
    ['$[0]["1abc"]', 'unknown_field'],
  ]);
  assert.deepEqual(codes([valid({ Name: 'x' })]), [['$[0].Name', 'unknown_field']]);
  assert.deepEqual(codes([{ ...without('stage'), 'quote"d': 1 }]), [
    ['$[0].stage', 'required'],
    ['$[0]["quote\\"d"]', 'unknown_field'],
  ]);
});

test('name: nonempty trimmed string', () => {
  assertValid([valid({ name: 'A b' }), valid({ name: 'x' })]);
  assert.deepEqual(codes([valid({ name: 1 })]), [['$[0].name', 'invalid_type']]);
  assert.deepEqual(codes([valid({ name: null })]), [['$[0].name', 'invalid_type']]);
  for (const name of ['', ' ', ' Arbitrum', 'Arbitrum ', '\tBase', 'Base\n', ' Base']) {
    assert.deepEqual(codes([valid({ name })]), [['$[0].name', 'invalid_value']], JSON.stringify(name));
  }
});

test('name: duplicates are case-sensitive and reported on the later row', () => {
  assertValid([valid({ name: 'Base' }), valid({ name: 'base' }), valid({ name: 'BASE' })]);
  assert.deepEqual(codes([valid({ name: 'Base' }), valid({ name: 'Other' }), valid({ name: 'Base' }), valid({ name: 'Base' })]), [
    ['$[2].name', 'duplicate_name'],
    ['$[3].name', 'duplicate_name'],
  ]);
  // Only otherwise valid names count; a duplicate on a row with other errors is still reported.
  assert.deepEqual(codes([valid({ name: ' Base' }), valid({ name: ' Base' })]), [
    ['$[0].name', 'invalid_value'],
    ['$[1].name', 'invalid_value'],
  ]);
  assert.deepEqual(codes([valid({ name: 'Base' }), valid({ name: 'Base', stage: 5 })]), [
    ['$[1].name', 'duplicate_name'],
    ['$[1].stage', 'invalid_value'],
  ]);
  // An invalid row before still registers its valid name.
  assert.deepEqual(codes([valid({ name: 'Base', stage: '1' }), valid({ name: 'Base' })]), [
    ['$[0].stage', 'invalid_type'],
    ['$[1].name', 'duplicate_name'],
  ]);
});

test('stage: number 0, 1 or 2 only', () => {
  assertValid([valid({ name: 'a', stage: 0 }), valid({ name: 'b', stage: 1 }), valid({ name: 'c', stage: 2 })]);
  for (const stage of [3, -1, 1.5, NaN, Infinity]) {
    assert.deepEqual(codes([valid({ stage })]), [['$[0].stage', 'invalid_value']], String(stage));
  }
  for (const stage of ['1', null, true, [1], { stage: 1 }]) {
    assert.deepEqual(codes([valid({ stage })]), [['$[0].stage', 'invalid_type']], String(stage));
  }
});

test('proofSystem: fraud, validity or none', () => {
  assertValid([valid({ name: 'a', proofSystem: 'fraud' }), valid({ name: 'b', proofSystem: 'validity' }), valid({ name: 'c', proofSystem: 'none' })]);
  for (const proofSystem of ['Fraud', 'zk', '', ' fraud']) {
    assert.deepEqual(codes([valid({ proofSystem })]), [['$[0].proofSystem', 'invalid_value']]);
  }
  for (const proofSystem of [0, null, false]) {
    assert.deepEqual(codes([valid({ proofSystem })]), [['$[0].proofSystem', 'invalid_type']]);
  }
});

test('permissionlessProving and forceInclusion: booleans without coercion', () => {
  assertValid([valid({ name: 'a', permissionlessProving: false, forceInclusion: false })]);
  for (const v of [0, 1, 'true', null, 'false']) {
    assert.deepEqual(codes([valid({ permissionlessProving: v, forceInclusion: v })]), [
      ['$[0].permissionlessProving', 'invalid_type'],
      ['$[0].forceInclusion', 'invalid_type'],
    ]);
  }
});

test('cross-factor combinations are not rejected', () => {
  assertValid([valid({ proofSystem: 'none', permissionlessProving: true, stage: 2, exitWindowDays: 0, forceInclusion: false })]);
});

test('exitWindowDays: finite number >= 0, fractions allowed', () => {
  assertValid([
    valid({ name: 'a', exitWindowDays: 0 }),
    valid({ name: 'b', exitWindowDays: 0.5 }),
    valid({ name: 'c', exitWindowDays: 6.999 }),
    valid({ name: 'd', exitWindowDays: 1e6 }),
    valid({ name: 'e', exitWindowDays: -0 }),
  ]);
  for (const exitWindowDays of [-1, -0.001, NaN, Infinity, -Infinity]) {
    assert.deepEqual(codes([valid({ exitWindowDays })]), [['$[0].exitWindowDays', 'invalid_value']], String(exitWindowDays));
  }
  for (const exitWindowDays of ['7', null, true, []]) {
    assert.deepEqual(codes([valid({ exitWindowDays })]), [['$[0].exitWindowDays', 'invalid_type']]);
  }
});

test('dataAvailability: ethereumBlobs, ethereumCalldata or external', () => {
  assertValid([
    valid({ name: 'a', dataAvailability: 'ethereumBlobs' }),
    valid({ name: 'b', dataAvailability: 'ethereumCalldata' }),
    valid({ name: 'c', dataAvailability: 'external' }),
  ]);
  assert.deepEqual(codes([valid({ dataAvailability: 'celestia' })]), [['$[0].dataAvailability', 'invalid_value']]);
  assert.deepEqual(codes([valid({ dataAvailability: 'EthereumBlobs' })]), [['$[0].dataAvailability', 'invalid_value']]);
  assert.deepEqual(codes([valid({ dataAvailability: 1 })]), [['$[0].dataAvailability', 'invalid_type']]);
});

test('upgrades: valid shapes', () => {
  assertValid([
    valid({ name: 'a', upgrades: { type: 'multisig' } }),
    valid({ name: 'b', upgrades: { type: 'singleKey' } }),
    valid({ name: 'c', upgrades: { type: 'securityCouncil', threshold: 1, members: 1 } }),
    valid({ name: 'd', upgrades: { members: 12, threshold: 12, type: 'securityCouncil' } }),
    valid({ name: 'e', upgrades: { type: 'securityCouncil', threshold: 1, members: Number.MAX_SAFE_INTEGER } }),
    valid({ name: 'f', upgrades: Object.assign(Object.create(null), { type: 'multisig' }) }),
  ]);
});

test('upgrades: container type errors do not descend', () => {
  for (const upgrades of [null, 'multisig', 1, [], [{ type: 'multisig' }], new Date()]) {
    assert.deepEqual(codes([valid({ upgrades })]), [['$[0].upgrades', 'invalid_type']], String(upgrades));
  }
});

test('upgrades: discriminator is checked before variant fields', () => {
  assert.deepEqual(codes([valid({ upgrades: {} })]), [['$[0].upgrades.type', 'required']]);
  assert.deepEqual(codes([valid({ upgrades: { threshold: 1, members: 2, extra: 1 } })]), [['$[0].upgrades.type', 'required']]);
  assert.deepEqual(codes([valid({ upgrades: { type: 3, threshold: 1 } })]), [['$[0].upgrades.type', 'invalid_type']]);
  assert.deepEqual(codes([valid({ upgrades: { type: null } })]), [['$[0].upgrades.type', 'invalid_type']]);
  assert.deepEqual(codes([valid({ upgrades: { type: 'council', threshold: 1, members: 2 } })]), [['$[0].upgrades.type', 'invalid_value']]);
  assert.deepEqual(codes([valid({ upgrades: Object.create({ type: 'multisig' }) })]), [['$[0].upgrades', 'invalid_type']]);
});

test('upgrades: multisig and singleKey reject every extra key', () => {
  assert.deepEqual(codes([valid({ upgrades: { type: 'multisig', threshold: 3, members: 5 } })]), [
    ['$[0].upgrades.threshold', 'unknown_field'],
    ['$[0].upgrades.members', 'unknown_field'],
  ]);
  assert.deepEqual(codes([valid({ upgrades: { type: 'singleKey', 'key holder': 'x' } })]), [
    ['$[0].upgrades["key holder"]', 'unknown_field'],
  ]);
});

test('upgrades: security council numbers and relationship', () => {
  const council = (threshold: unknown, members: unknown) => valid({ upgrades: { type: 'securityCouncil', threshold, members } });
  assert.deepEqual(codes([valid({ upgrades: { type: 'securityCouncil' } })]), [
    ['$[0].upgrades.threshold', 'required'],
    ['$[0].upgrades.members', 'required'],
  ]);
  assert.deepEqual(codes([valid({ upgrades: { type: 'securityCouncil', members: 3 } })]), [['$[0].upgrades.threshold', 'required']]);
  assert.deepEqual(codes([council('2', null)]), [
    ['$[0].upgrades.threshold', 'invalid_type'],
    ['$[0].upgrades.members', 'invalid_type'],
  ]);
  for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(codes([council(bad, 5)]), [['$[0].upgrades.threshold', 'invalid_value']], `threshold ${bad}`);
    assert.deepEqual(codes([council(1, bad)]), [['$[0].upgrades.members', 'invalid_value']], `members ${bad}`);
  }
  assert.deepEqual(codes([council(6, 5)]), [['$[0].upgrades.threshold', 'invalid_value']]);
  // Relationship is checked only when both numbers pass on their own.
  assert.deepEqual(codes([council(6, 2.5)]), [['$[0].upgrades.members', 'invalid_value']]);
  assert.deepEqual(codes([council(10, '5')]), [['$[0].upgrades.members', 'invalid_type']]);
  assert.deepEqual(codes([valid({ upgrades: { type: 'securityCouncil', threshold: 9, members: 8, quorum: 1 } })]), [
    ['$[0].upgrades.threshold', 'invalid_value'],
    ['$[0].upgrades.quorum', 'unknown_field'],
  ]);
});

test('several bad fields in one row are all reported in schema order', () => {
  const row = {
    extra: true,
    name: ' ',
    stage: '2',
    proofSystem: 'optimistic',
    permissionlessProving: 'yes',
    exitWindowDays: -3,
    upgrades: { type: 'securityCouncil', threshold: 0, members: 'many', more: 1 },
    dataAvailability: null,
  };
  assert.deepEqual(codes([row]), [
    ['$[0].name', 'invalid_value'],
    ['$[0].stage', 'invalid_type'],
    ['$[0].proofSystem', 'invalid_value'],
    ['$[0].permissionlessProving', 'invalid_type'],
    ['$[0].exitWindowDays', 'invalid_value'],
    ['$[0].upgrades.threshold', 'invalid_value'],
    ['$[0].upgrades.members', 'invalid_type'],
    ['$[0].upgrades.more', 'unknown_field'],
    ['$[0].dataAvailability', 'invalid_type'],
    ['$[0].forceInclusion', 'required'],
    ['$[0].extra', 'unknown_field'],
  ]);
});

test('issues accumulate across rows in input order and valid rows add none', () => {
  assert.deepEqual(codes([valid({ name: 'A' }), valid({ name: 'B', stage: 9 }), null, valid({ name: 'C' }), without('name'), valid({ name: 'A', forceInclusion: 1 })]), [
    ['$[1].stage', 'invalid_value'],
    ['$[2]', 'invalid_type'],
    ['$[4].name', 'required'],
    ['$[5].name', 'duplicate_name'],
    ['$[5].forceInclusion', 'invalid_type'],
  ]);
});

test('invalid input is not mutated and each issue has path, code and message only', () => {
  const row = valid({ name: ' x ', upgrades: { type: 'multisig', threshold: 1 } });
  const snapshot = structuredClone(row);
  const result = issues([row]);
  assert.deepEqual(row, snapshot);
  for (const issue of result) assert.deepEqual(Object.keys(issue).sort(), ['code', 'message', 'path']);
});

test('works on JSON parsed input', () => {
  const text = JSON.stringify([valid({ name: 'Arbitrum One' }), valid({ name: 'Base', upgrades: { type: 'multisig' } })]);
  assert.equal(validateRollups(JSON.parse(text)).valid, true);
});
