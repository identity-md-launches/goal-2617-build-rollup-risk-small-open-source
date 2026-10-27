import type { RankedRollup, Rollup } from './types.ts';
import { scoreRollup } from './score.ts';

/** Scores and ranks rollups: score descending, then name ascending, stable; ranks 1..n. */
export function rankRollups(rollups: readonly Rollup[]): RankedRollup[] {
  const scored = rollups.map((r, index) => ({ s: scoreRollup(r), index }));
  scored.sort((a, b) => {
    if (a.s.score !== b.s.score) return b.s.score - a.s.score;
    const an = a.s.rollup.name;
    const bn = b.s.rollup.name;
    if (an < bn) return -1;
    if (an > bn) return 1;
    return a.index - b.index;
  });
  return scored.map(({ s }, i) => ({ ...s, rank: i + 1 }));
}
