/** Structural validation of rollup input with accumulated, path-addressed issues. */
import type { Rollup, ValidationCode, ValidationIssue, ValidationResult } from './types.ts';

const ROLLUP_FIELDS = [
  'name',
  'stage',
  'proofSystem',
  'permissionlessProving',
  'exitWindowDays',
  'upgrades',
  'dataAvailability',
  'forceInclusion',
] as const;

const STAGES: readonly unknown[] = [0, 1, 2];
const PROOF_SYSTEMS: readonly unknown[] = ['fraud', 'validity', 'none'];
const DATA_AVAILABILITY: readonly unknown[] = ['ethereumBlobs', 'ethereumCalldata', 'external'];
const UPGRADE_TYPES: readonly unknown[] = ['securityCouncil', 'multisig', 'singleKey'];

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Appends a property key to a path: dot notation for identifiers, JSON-quoted brackets otherwise. */
function childPath(path: string, key: string): string {
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** Describes a value's runtime type for messages. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'a non-plain object';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return `${typeof value} ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`;
}

/** True for objects created by literals, JSON.parse or Object.create(null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function listOf(values: readonly unknown[]): string {
  return values.map((v) => JSON.stringify(v)).join(', ');
}

/**
 * Validates untrusted input against the Rollup schema of src/types.ts.
 * Never coerces or mutates; on success returns a new array holding the same objects.
 */
export function validateRollups(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const add = (path: string, code: ValidationCode, message: string): void => {
    errors.push({ path, code, message });
  };

  if (!Array.isArray(input)) {
    add('$', 'invalid_type', `Expected an array of rollups, got ${describe(input)}.`);
    return { valid: false, errors };
  }

  const seenNames = new Set<string>();

  const checkEnum = (obj: Record<string, unknown>, key: string, path: string, allowed: readonly unknown[], kind: 'string' | 'number'): void => {
    const value = obj[key];
    if (typeof value !== kind) {
      add(path, 'invalid_type', `Expected ${kind} (one of ${listOf(allowed)}), got ${describe(value)}.`);
    } else if (!allowed.includes(value)) {
      add(path, 'invalid_value', `Expected one of ${listOf(allowed)}, got ${JSON.stringify(value)}.`);
    }
  };

  const checkBoolean = (obj: Record<string, unknown>, key: string, path: string): void => {
    if (typeof obj[key] !== 'boolean') {
      add(path, 'invalid_type', `Expected boolean, got ${describe(obj[key])}.`);
    }
  };

  /** Reports own enumerable keys not in `allowed`, in object order. */
  const checkUnknown = (obj: Record<string, unknown>, path: string, allowed: readonly string[]): void => {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        add(childPath(path, key), 'unknown_field', `Unknown field ${JSON.stringify(key)}; allowed fields are ${listOf(allowed)}.`);
      }
    }
  };

  /** Checks a council number; returns true when it is a positive safe integer. */
  const checkCouncilNumber = (obj: Record<string, unknown>, key: string, path: string): boolean => {
    if (!Object.hasOwn(obj, key)) {
      add(path, 'required', `Missing required field ${JSON.stringify(key)} for a security council.`);
      return false;
    }
    const value = obj[key];
    if (typeof value !== 'number') {
      add(path, 'invalid_type', `Expected number, got ${describe(value)}.`);
      return false;
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
      add(path, 'invalid_value', `Expected a positive safe integer, got ${String(value)}.`);
      return false;
    }
    return true;
  };

  const checkUpgrades = (value: unknown, path: string): void => {
    if (!isPlainObject(value)) {
      add(path, 'invalid_type', `Expected an upgrades object, got ${describe(value)}.`);
      return;
    }
    const typePath = `${path}.type`;
    if (!Object.hasOwn(value, 'type')) {
      add(typePath, 'required', `Missing required field "type" (one of ${listOf(UPGRADE_TYPES)}).`);
      return;
    }
    const type = value.type;
    if (typeof type !== 'string') {
      add(typePath, 'invalid_type', `Expected string (one of ${listOf(UPGRADE_TYPES)}), got ${describe(type)}.`);
      return;
    }
    if (!UPGRADE_TYPES.includes(type)) {
      add(typePath, 'invalid_value', `Expected one of ${listOf(UPGRADE_TYPES)}, got ${JSON.stringify(type)}.`);
      return;
    }
    if (type === 'securityCouncil') {
      const thresholdPath = `${path}.threshold`;
      const thresholdOk = checkCouncilNumber(value, 'threshold', thresholdPath);
      const membersOk = checkCouncilNumber(value, 'members', `${path}.members`);
      if (thresholdOk && membersOk && (value.threshold as number) > (value.members as number)) {
        add(thresholdPath, 'invalid_value', `Threshold ${String(value.threshold)} exceeds members ${String(value.members)}.`);
      }
      checkUnknown(value, path, ['type', 'threshold', 'members']);
    } else {
      checkUnknown(value, path, ['type']);
    }
  };

  input.forEach((row: unknown, index: number) => {
    const rowPath = `$[${index}]`;
    if (!isPlainObject(row)) {
      add(rowPath, 'invalid_type', `Expected a rollup object, got ${describe(row)}.`);
      return;
    }
    for (const field of ROLLUP_FIELDS) {
      const path = `${rowPath}.${field}`;
      if (!Object.hasOwn(row, field)) {
        add(path, 'required', `Missing required field ${JSON.stringify(field)}.`);
        continue;
      }
      const value = row[field];
      switch (field) {
        case 'name':
          if (typeof value !== 'string') {
            add(path, 'invalid_type', `Expected string, got ${describe(value)}.`);
          } else if (value.length === 0) {
            add(path, 'invalid_value', 'Name must not be empty.');
          } else if (value.trim() !== value) {
            add(path, 'invalid_value', `Name ${JSON.stringify(value)} must not have leading or trailing whitespace.`);
          } else if (seenNames.has(value)) {
            add(path, 'duplicate_name', `Duplicate name ${JSON.stringify(value)}; names must be unique.`);
          } else {
            seenNames.add(value);
          }
          break;
        case 'stage':
          checkEnum(row, field, path, STAGES, 'number');
          break;
        case 'proofSystem':
          checkEnum(row, field, path, PROOF_SYSTEMS, 'string');
          break;
        case 'permissionlessProving':
        case 'forceInclusion':
          checkBoolean(row, field, path);
          break;
        case 'exitWindowDays':
          if (typeof value !== 'number') {
            add(path, 'invalid_type', `Expected number, got ${describe(value)}.`);
          } else if (!Number.isFinite(value) || value < 0) {
            add(path, 'invalid_value', `Expected a finite number >= 0, got ${String(value)}.`);
          }
          break;
        case 'upgrades':
          checkUpgrades(value, path);
          break;
        case 'dataAvailability':
          checkEnum(row, field, path, DATA_AVAILABILITY, 'string');
          break;
      }
    }
    checkUnknown(row, rowPath, ROLLUP_FIELDS);
  });

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, rollups: input.slice() as Rollup[] };
}
