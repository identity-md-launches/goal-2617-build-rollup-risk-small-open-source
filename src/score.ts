import type { FactorScore, Rollup, ScoredRollup } from './types.ts';

function stage(r: Rollup): FactorScore {
  const points = r.stage === 2 ? 20 : r.stage === 1 ? 10 : 0;
  return { factor: 'stage', points, maxPoints: 20, reason: `L2BEAT stage ${r.stage}: stage 0 earns 0, stage 1 earns 10, stage 2 earns 20, so ${points} points.` };
}

function proofSystem(r: Rollup): FactorScore {
  const live = r.proofSystem !== 'none';
  const points = live ? 20 : 0;
  const reason = live
    ? `Proof system '${r.proofSystem}': live ${r.proofSystem} proofs earn 20 points.`
    : `Proof system 'none': no live proof system earns 0 points.`;
  return { factor: 'proofSystem', points, maxPoints: 20, reason };
}

function permissionlessProving(r: Rollup): FactorScore {
  const live = r.proofSystem !== 'none';
  let points = 0;
  let reason: string;
  if (r.permissionlessProving && live) {
    points = 10;
    reason = `Permissionless proving is true with live '${r.proofSystem}' proofs: earns 10 points.`;
  } else if (r.permissionlessProving) {
    reason = `Permissionless proving is true but proof system is 'none': it only counts when proofs are live, so 0 points.`;
  } else {
    reason = `Permissionless proving is false (proof system '${r.proofSystem}'): only permissionless proving with live proofs earns 10, so 0 points.`;
  }
  return { factor: 'permissionlessProving', points, maxPoints: 10, reason };
}

function exitWindowDays(r: Rollup): FactorScore {
  const d = r.exitWindowDays;
  let points: number;
  let rule: string;
  if (d >= 30) { points = 15; rule = 'at least 30 days earns 15'; }
  else if (d >= 7) { points = 10; rule = 'at least 7 and below 30 days earns 10'; }
  else if (d > 0) { points = 5; rule = 'more than 0 and below 7 days earns 5'; }
  else { points = 0; rule = 'no exit window (0 days) earns 0'; }
  return { factor: 'exitWindowDays', points, maxPoints: 15, reason: `Exit window of ${d} days: ${rule} points.` };
}

function upgrades(r: Rollup): FactorScore {
  const u = r.upgrades;
  let points: number;
  let reason: string;
  if (u.type === 'singleKey') {
    points = 0;
    reason = 'Upgradable by a single key: earns 0 points.';
  } else if (u.type === 'multisig') {
    points = 5;
    reason = 'Upgradable by a multisig: earns 5 points.';
  } else {
    const { threshold: t, members: m } = u;
    const desc = `Security council with threshold ${t} of ${m}`;
    if (t === 1) { points = 0; reason = `${desc}: a threshold of 1 lets one member act alone, so 0 points.`; }
    else if (4 * t >= 3 * m) { points = 15; reason = `${desc}: ratio at least 3/4 earns 15 points.`; }
    else if (3 * t >= 2 * m) { points = 10; reason = `${desc}: ratio at least 2/3 but below 3/4 earns 10 points.`; }
    else { points = 5; reason = `${desc}: ratio below 2/3 earns 5 points.`; }
  }
  return { factor: 'upgrades', points, maxPoints: 15, reason };
}

function dataAvailability(r: Rollup): FactorScore {
  const onEth = r.dataAvailability !== 'external';
  const points = onEth ? 10 : 0;
  const reason = onEth
    ? `Data availability '${r.dataAvailability}': data posted to Ethereum earns 10 points.`
    : `Data availability 'external': data posted outside Ethereum earns 0 points.`;
  return { factor: 'dataAvailability', points, maxPoints: 10, reason };
}

function forceInclusion(r: Rollup): FactorScore {
  const points = r.forceInclusion ? 10 : 0;
  const reason = r.forceInclusion
    ? 'Force inclusion is true: users can force transactions past a censoring sequencer, earning 10 points.'
    : 'Force inclusion is false: users cannot force transactions past a censoring sequencer, so 0 points.';
  return { factor: 'forceInclusion', points, maxPoints: 10, reason };
}

/** Scores a validated rollup from 0 to 100 with a per-factor breakdown. */
export function scoreRollup(rollup: Rollup): ScoredRollup {
  const factors = [stage, proofSystem, permissionlessProving, exitWindowDays, upgrades, dataAvailability, forceInclusion]
    .map((f) => f(rollup));
  const score = factors.reduce((sum, f) => sum + f.points, 0);
  return { rollup, score, factors };
}
