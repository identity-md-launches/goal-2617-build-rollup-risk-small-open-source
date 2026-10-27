/** Public, erasable contracts. This module deliberately has no runtime values. */
export type Stage = 0 | 1 | 2;
export type ProofSystem = 'fraud' | 'validity' | 'none';
export type DataAvailability = 'ethereumBlobs' | 'ethereumCalldata' | 'external';

export type Upgrades =
  | { type: 'securityCouncil'; threshold: number; members: number }
  | { type: 'multisig' }
  | { type: 'singleKey' };

export interface Rollup {
  name: string;
  stage: Stage;
  proofSystem: ProofSystem;
  permissionlessProving: boolean;
  exitWindowDays: number;
  upgrades: Upgrades;
  dataAvailability: DataAvailability;
  forceInclusion: boolean;
}

/** Codes identify the failed rule; messages explain it to a human. */
export type ValidationCode =
  | 'required'
  | 'unknown_field'
  | 'invalid_type'
  | 'invalid_value'
  | 'duplicate_name';

export interface ValidationIssue {
  path: string;
  code: ValidationCode;
  message: string;
}

export type ValidationResult =
  | { valid: true; rollups: Rollup[] }
  | { valid: false; errors: ValidationIssue[] };

export type Factor =
  | 'stage'
  | 'proofSystem'
  | 'permissionlessProving'
  | 'exitWindowDays'
  | 'upgrades'
  | 'dataAvailability'
  | 'forceInclusion';

export interface FactorScore {
  factor: Factor;
  points: number;
  maxPoints: number;
  reason: string;
}

export interface ScoredRollup {
  rollup: Rollup;
  score: number;
  factors: FactorScore[];
}

export interface RankedRollup extends ScoredRollup {
  rank: number;
}
