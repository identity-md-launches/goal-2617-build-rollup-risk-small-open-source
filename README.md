# rollup-risk

A small TypeScript library and CLI that scores Ethereum rollup trust minimization
from explicit, L2BEAT-style facts. It validates JSON, awards 0–100 points with a
reason for every factor, and ranks rollups. Higher scores mean more of the
properties rewarded by this rubric; they are not safety ratings.

There are **zero runtime or development dependencies**, no build step, and no
TypeScript loader to install. Node.js 24's built-in type stripping runs the source
directly. The tool reads your supplied facts; it does not fetch live assessments.

## Run from a source checkout

Clone or download this repository, open its root directory, and use a current
Node.js 24.x release or later. No `npm install` is needed.

```sh
node --version
npm test
node src/cli.ts --help
```

`npm test` runs `node --test test/*.test.ts` using `node:test` and Node's assertions.
The tests cover validation, all scoring factors and boundaries, ranking, and CLI
output. Source modules and public types live in `src/`; tests live in `test/`.
The [architecture](docs/architecture.md) and [types](src/types.ts) specify the
interfaces and rubric.

## CLI

Save the complete input below as `rollups.json` in the checkout root, then run:

```sh
node src/cli.ts rollups.json
node src/cli.ts rollups.json --json
node src/cli.ts --json rollups.json
node src/cli.ts --help
node src/cli.ts -h
npm start -- rollups.json
```

The default output is a table with `Rank`, `Rollup`, `Stage`, and integer `Score`
columns. Columns are left-aligned, padded to their widest value or header, and
separated by two spaces; lines have no trailing spaces. `--json` returns the full
ranked array, including each original rollup, score, factor breakdown, and rank,
with two-space indentation. Both formats end with a newline. An empty input array
prints only the table header, or `[]` in JSON mode.

Pass exactly one UTF-8 JSON file path. `--json` can precede or follow it and may
appear only once. Use either help flag by itself; help prints usage without
reading a file. Successful commands write the requested output to stdout and
exit 0. Missing or extra paths, unknown or repeated flags, unreadable files,
malformed JSON, and validation failures write errors to stderr and exit 1.
Validation failures include every reported issue's path and message.

## Public API

The public entrypoint is `src/index.ts`. Save this as `check-rollups.ts` in the
checkout root, beside the `rollups.json` saved above:

```ts
import { readFileSync } from 'node:fs';
import { rankRollups, scoreRollup, validateRollups } from './src/index.ts';
import type { Rollup } from './src/index.ts';

const input: unknown = JSON.parse(readFileSync('rollups.json', 'utf8'));
const validation = validateRollups(input);

if (!validation.valid) {
  for (const issue of validation.errors) {
    console.error(`${issue.path} [${issue.code}]: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  const rollups: Rollup[] = validation.rollups;
  const first = rollups[0];
  if (first) {
    const scored = scoreRollup(first);
    console.log(`${scored.rollup.name}: ${scored.score}`); // Arbitrum One: 85
    for (const factor of scored.factors) {
      console.log(`${factor.factor}: ${factor.points}/${factor.maxPoints} — ${factor.reason}`);
    }
  }
  const ranked = rankRollups(rollups);
  console.log(ranked.map(({ rank, rollup, score }) => ({ rank, name: rollup.name, score })));
}
```

```sh
node check-rollups.ts
```

| Function | Result |
| --- | --- |
| `validateRollups(input: unknown): ValidationResult` | `{ valid: true, rollups: Rollup[] }` or `{ valid: false, errors: ValidationIssue[] }` |
| `scoreRollup(rollup: Rollup): ScoredRollup` | `{ rollup, score, factors }` |
| `rankRollups(rollups: readonly Rollup[]): RankedRollup[]` | Scored entries with an additional numeric `rank` |

Each factor is `{ factor, points, maxPoints, reason }`; even zero-point awards
have an explanation. All public types are also exported from `src/index.ts`
using type-only exports: `Stage`, `ProofSystem`, `DataAvailability`, `Upgrades`,
`Rollup`, `ValidationCode`, `ValidationIssue`, `ValidationResult`, `Factor`,
`FactorScore`, `ScoredRollup`, and `RankedRollup`.

Validate untrusted input before scoring or ranking: those two functions assume
valid `Rollup` objects and do not validate them again. Validation accepts parsed
data, not JSON text; parse errors and file errors must be handled by the caller
when using the library. All three functions are synchronous, perform no I/O, and
do not mutate their inputs. Returned arrays are new, but rollup objects may be
shared; no deep cloning or runtime freezing is promised. Importing the public
entrypoint does not run the CLI.

## Input schema and validation

The top level must be a JSON array; `[]` is valid. Each row must be an object
with exactly the following required own properties. Values are case-sensitive;
validation never trims, coerces, normalizes, or changes them.

| Field | Accepted value and meaning |
| --- | --- |
| `name` | Nonempty string without leading or trailing whitespace; unique by exact, case-sensitive equality |
| `stage` | Number `0`, `1`, or `2`: the supplied L2BEAT stage |
| `proofSystem` | `"fraud"`, `"validity"`, or `"none"` (no live proofs) |
| `permissionlessProving` | Boolean: whether proving is open to anyone |
| `exitWindowDays` | Finite, nonnegative number of days; fractions are allowed |
| `upgrades` | One of the three exact object shapes below |
| `dataAvailability` | `"ethereumBlobs"`, `"ethereumCalldata"`, or `"external"` |
| `forceInclusion` | Boolean: whether users can force a transaction past a censoring sequencer |

The `upgrades` variants are:

| `type` | Exact fields | Constraints |
| --- | --- | --- |
| `"securityCouncil"` | `type`, `threshold`, `members` | Both numbers are positive safe integers (at most `Number.MAX_SAFE_INTEGER`), and `threshold <= members` |
| `"multisig"` | `type` only | No threshold or member fields |
| `"singleKey"` | `type` only | No additional fields |

Additional properties are rejected on rows and upgrade objects. Nulls and arrays
are not valid row or upgrade objects. For direct API calls, plain objects and
objects with a null prototype are accepted; class instances and custom-prototype
objects are rejected. Inherited properties cannot satisfy required fields.

Validation accumulates independent issues across rows, fields, and nested fields,
in input order and schema field order, with unknown keys in their object order.
A wrong container type produces an issue at that container without errors for
its inaccessible descendants. An invalid or missing upgrade `type` is reported
at `.type` before checking variant fields. A council relationship error is
attached to `.threshold` only after both numbers pass their individual checks.
Duplicate valid names are reported at the later row's `.name`.

Each issue contains `path`, `code`, and a human-readable `message`. Paths start
at `$`, for example `$[0].stage` or `$[0].upgrades.threshold`. Identifier-like
unknown keys use dots; other keys use JSON-quoted brackets, such as
`$[0]["odd.key"]`. Exact message wording is not an API guarantee.

| Code | Meaning |
| --- | --- |
| `required` | Missing required own property |
| `unknown_field` | Additional object property |
| `invalid_type` | Wrong primitive or container type, including null |
| `invalid_value` | Invalid enum, empty/untrimmed name, nonfinite/negative days, unsafe council integer, or threshold above membership |
| `duplicate_name` | Repeated otherwise valid name |

Validation is structural, not a fact check. Cross-factor combinations are allowed:
`permissionlessProving: true` with `proofSystem: "none"` is valid input, but
receives no permissionless-proving points.

## Scoring and ranking

The score is the sum of seven factors, in the order below. Their maxima total
100. All awards are integers, including when exit days are fractional.

| Factor | Maximum | Points awarded |
| --- | ---: | --- |
| `stage` | 20 | Stage 0: **0**; stage 1: **10**; stage 2: **20** |
| `proofSystem` | 20 | Live fraud or validity proofs: **20**; none live: **0** |
| `permissionlessProving` | 10 | `true` with live fraud or validity proofs: **10**; otherwise **0** |
| `exitWindowDays` | 15 | `0`: **0**; `0 < days < 7`: **5**; `7 <= days < 30`: **10**; `days >= 30`: **15** |
| `upgrades` | 15 | Single key: **0**; multisig: **5**; council threshold 1: **0**; other councils: ratio `>= 3/4`: **15**, `>= 2/3` and `< 3/4`: **10**, `< 2/3`: **5** |
| `dataAvailability` | 10 | Ethereum blobs or calldata: **10**; external DA: **0** |
| `forceInclusion` | 10 | `true`: **10**; `false`: **0** |

Council ratio means `threshold / members`. Threshold 1 takes precedence even for
a 1-of-1 council. Exactly 2/3 earns 10 and exactly 3/4 earns 15; for example,
8/12 earns 10 and 9/12 earns 15. A 0.5-day exit window earns 5, exactly 7 days
earns 10, and exactly 30 days earns 15.

Proof gating applies to the permissionless-proving factor: it cannot earn points
without a live proof system. There is no overall score cap or gate on the other
factors when proofs are absent.

Ranking sorts by score descending, then name ascending using JavaScript string
comparison (`<` / `>`), not locale sorting. If both score and name tie, original
input order is preserved, including for direct ranking calls with duplicate
names. Ranks are consecutive `1..n`, with no shared ranks. Ranking `[]` returns
`[]`; the caller's array is never sorted in place.

## Six-rollup snapshot

This supplied historical L2BEAT-derived snapshot is dated **2026-10-27**. It is
an illustrative input, not a freshly verified live assessment. See the
[example sources and modeling notes](docs/example-sources.md) for provenance and
assumptions. The following input preserves the supplied row and key order.

Save as `rollups.json`:

```json
[
  {
    "name": "Arbitrum One",
    "stage": 1,
    "proofSystem": "fraud",
    "permissionlessProving": true,
    "exitWindowDays": 10,
    "upgrades": {
      "type": "securityCouncil",
      "threshold": 9,
      "members": 12
    },
    "dataAvailability": "ethereumBlobs",
    "forceInclusion": true
  },
  {
    "name": "OP Mainnet",
    "stage": 1,
    "proofSystem": "fraud",
    "permissionlessProving": true,
    "exitWindowDays": 0,
    "upgrades": {
      "type": "securityCouncil",
      "threshold": 10,
      "members": 13
    },
    "dataAvailability": "ethereumBlobs",
    "forceInclusion": true
  },
  {
    "name": "Base",
    "stage": 1,
    "proofSystem": "fraud",
    "permissionlessProving": true,
    "exitWindowDays": 0,
    "upgrades": {
      "type": "securityCouncil",
      "threshold": 8,
      "members": 11
    },
    "dataAvailability": "ethereumBlobs",
    "forceInclusion": true
  },
  {
    "name": "ZKsync Era",
    "stage": 0,
    "proofSystem": "validity",
    "permissionlessProving": false,
    "exitWindowDays": 5,
    "upgrades": {
      "type": "securityCouncil",
      "threshold": 6,
      "members": 8
    },
    "dataAvailability": "ethereumBlobs",
    "forceInclusion": false
  },
  {
    "name": "Starknet",
    "stage": 1,
    "proofSystem": "validity",
    "permissionlessProving": false,
    "exitWindowDays": 7,
    "upgrades": {
      "type": "securityCouncil",
      "threshold": 9,
      "members": 12
    },
    "dataAvailability": "ethereumBlobs",
    "forceInclusion": false
  },
  {
    "name": "Scroll",
    "stage": 0,
    "proofSystem": "validity",
    "permissionlessProving": false,
    "exitWindowDays": 0,
    "upgrades": {
      "type": "multisig"
    },
    "dataAvailability": "ethereumBlobs",
    "forceInclusion": true
  }
]
```

Expected output of `node src/cli.ts rollups.json`:

```text
Rank  Rollup        Stage  Score
1     Arbitrum One  1      85
2     OP Mainnet    1      75
3     Base          1      70
4     Starknet      1      65
5     ZKsync Era    0      50
6     Scroll        0      45
```

For example, Arbitrum One's 85 points are
`10 + 20 + 10 + 10 + 15 + 10 + 10`, in rubric order. Use `--json` to inspect every
rollup's factor points and reasons.

These snapshot caveats are part of interpreting the example:

- Exit days describe regular upgrade paths. **All six have emergency paths
  without an exit window**, which this single number does not capture.
- Council thresholds describe the council Safe alone and omit co-signers;
  they do not describe all parties or powers in an upgrade path.
- The supplied notes describe Base's validity label as a simplification of its
  hybrid TEE/ZK system, while the supplied input row specifies `"fraud"`. The row
  above preserves that input. Both labels earn the same proof points here, but
  that equality does not resolve the difference in descriptions.
- Scroll uses a 3/4 team multisig, represented by the schema's generic
  `"multisig"` variant. It can disable enforced batches, a limitation not captured
  by its `forceInclusion: true` value.
- ZKsync's queue and Starknet's council minority do not count as user force
  inclusion in this snapshot, so both values are `false`.

## Limits of the heuristic

The score is not a probability of loss, a safety certification, or an investment
recommendation. Stage and the individual factors can overlap, and supplied facts
can become stale. Validation checks the shape of the facts, not their truth.
The model omits implementation bugs, actual council member independence,
detailed upgrade powers and emergency routes, DA design details, and
force-inclusion delays or disablement. A higher council ratio alone cannot
establish decentralization.

Equal points for fraud and validity proofs, or for blobs and calldata, do not
assert that their designs offer equivalent security. Scores summarize this
fixed rubric; read the factor reasons and source assumptions alongside them.

## License

[MIT](LICENSE), copyright 2026 rollup-risk contributors.
