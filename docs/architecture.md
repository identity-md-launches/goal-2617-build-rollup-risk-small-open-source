# rollup-risk architecture and frozen contracts

This foundation fixes the package metadata, shared types, API and scoring method
before implementation. Run source directly with Node >=24's built-in TypeScript
stripping and ECMAScript modules. There is no build step, configuration file,
dependency or development dependency. Use erasable syntax, explicit `.ts` import
extensions and `import type` / `export type` for types. Do not introduce enums,
parameter properties or other TypeScript constructs requiring transformation.

## File ownership and dependency direction

Each row is a separate implementation scope that can proceed in parallel after
this foundation. Owners must not edit another row's files. Package configuration
and public contracts are frozen for later waves.

| Owner | Files | Responsibility |
| --- | --- | --- |
| Foundation (this item) | `package.json`, `LICENSE`, `src/types.ts`, `docs/architecture.md` | Immutable configuration, MIT license, types and contracts |
| Validation | `src/validate.ts`, `test/validation.test.ts` | Structural validation and accumulated issues |
| Scoring | `src/score.ts`, `test/scoring.test.ts` | Seven factors, boundaries and explanations |
| Ranking | `src/rank.ts`, `test/ranking.test.ts` | Nonmutating ranking and deterministic ties |
| Public API and CLI | `src/index.ts`, `src/cli.ts`, `test/cli.test.ts` | Reexports, arguments, file I/O and output |
| Examples and documentation | `README.md`, `examples/rollups.json`, `examples/expected.json`, `examples/expected.txt`, `docs/example-sources.md`, `test/examples.test.ts` | Method, six sourced rollups, reproducible outputs and example checks |

`validate.ts` and `score.ts` depend only on types. `rank.ts` depends on `score.ts`
and types. `index.ts` reexports public functions and all public types without side
effects. `cli.ts` uses validation and ranking plus Node built-ins. Tests use
`node:test` and `node:assert/strict`; CLI tests invoke Node as a subprocess.
Examples depend on the frozen rubric, not on changing its contracts.

## Public API

The exact signatures exported by `src/index.ts` are:

```ts
validateRollups(input: unknown): ValidationResult
scoreRollup(rollup: Rollup): ScoredRollup
rankRollups(rollups: readonly Rollup[]): RankedRollup[]
```

`src/types.ts` defines `Stage`, `ProofSystem`, `DataAvailability`, `Upgrades`,
`Rollup`, `ValidationCode`, `ValidationIssue`, `ValidationResult`, `Factor`,
`FactorScore`, `ScoredRollup` and `RankedRollup`. Export these with `export type`.
Do not implement runtime stubs in this foundation. Scoring and ranking assume
validated inputs; validation is an explicit caller step. All functions are
synchronous, do not mutate inputs, and perform no I/O. Returned arrays are new;
no deep-cloning or runtime freezing guarantee is required. "Frozen" means this
API is fixed, not that returned JavaScript objects use `Object.freeze`.

`ValidationResult` is `{ valid: true, rollups: Rollup[] }` or
`{ valid: false, errors: ValidationIssue[] }`. Each issue has string `path`,
`code` and human-readable `message`. `ScoredRollup` is `{ rollup, score, factors }`;
`RankedRollup` adds numeric `rank`. Each factor is
`{ factor, points, maxPoints, reason }`. Reasons must explain the observed input
and awarded points, including zero points and relevant conditions.

## Input and validation

Input is a JSON array; an empty array succeeds. Each element must be an object
(not null or an array) with exactly these required fields:

| Field | Accepted value |
| --- | --- |
| `name` | Nonempty string already trimmed; unique by exact, case-sensitive string equality |
| `stage` | Number `0`, `1` or `2` |
| `proofSystem` | `'fraud'`, `'validity'` or `'none'` |
| `permissionlessProving` | Boolean |
| `exitWindowDays` | Finite nonnegative number; fractions allowed |
| `upgrades` | One of the exact object shapes below |
| `dataAvailability` | `'ethereumBlobs'`, `'ethereumCalldata'` or `'external'` |
| `forceInclusion` | Boolean |

Upgrade shapes are `{ type: 'securityCouncil', threshold: number, members: number }`,
`{ type: 'multisig' }`, and `{ type: 'singleKey' }`. Council numbers must be
positive safe integers and `threshold <= members`. Reject additional fields in
every object, including `threshold` or `members` on a multisig or single key.
Every required property must be present as an own property. Do not trim, coerce,
normalize or mutate input. Reject surrounding whitespace in names. Do not reject
cross-factor combinations: for example, permissionless proving with no live
proofs is structurally valid but earns zero for that factor.

Accumulate independent errors across fields, nested fields and array elements.
If a container has the wrong type, report that error without inventing errors
for inaccessible descendants. Paths start at `$`, for example `$`, `$[0]`,
`$[0].stage`, `$[0].upgrades.threshold`. Unknown identifier-like keys use dot
notation; other keys use JSON-quoted brackets, such as `$[0]["odd.key"]`.
Report a duplicate at the later element's `.name`. Use deterministic traversal
in input order and schema field order; unknown keys follow their object order.
Literal message wording is not an API guarantee, but every issue must be clear.

| Code | Meaning |
| --- | --- |
| `required` | Missing required own property |
| `unknown_field` | Additional object property |
| `invalid_type` | Wrong primitive/container type (including null) |
| `invalid_value` | Invalid enum, whitespace/empty name, nonfinite/negative number, unsafe council integer or threshold above members |
| `duplicate_name` | Repeated otherwise valid name |

An invalid discriminator receives an issue at `.type`; validate its type or
allowed values before applying a variant's fields. Attach a council relationship
error to `.threshold` only when both numbers independently pass their checks.

## Fixed scoring rubric

Factors appear in exactly this order, matching the seven non-name fields.
Their maximum points sum to 100; `score` is the sum of their awarded points.

| Factor | Maximum | Award |
| --- | ---: | --- |
| `stage` | 20 | Stage 0: 0; stage 1: 10; stage 2: 20 |
| `proofSystem` | 20 | Fraud or validity: 20; none live: 0 |
| `permissionlessProving` | 10 | 10 only when true and proof system is fraud or validity; otherwise 0 |
| `exitWindowDays` | 15 | 0 days: 0; strictly between 0 and 7: 5; at least 7 and below 30: 10; at least 30: 15 |
| `upgrades` | 15 | Single key: 0; multisig: 5; council threshold 1: 0; otherwise threshold/members >= 3/4: 15, >= 2/3: 10, below 2/3: 5 |
| `dataAvailability` | 10 | Ethereum blobs or calldata: 10; external: 0 |
| `forceInclusion` | 10 | True: 10; false: 0 |

Council threshold 1 takes precedence even for a 1-of-1 council. Test exact ratio
boundaries, both live proof systems, permissionless proving with no live proofs,
fractional exit days, and every branch. Prefer cross-multiplication for council
ratio comparisons. The score is a transparent heuristic, not a probability of
loss or a safety certification. Stage and individual factors can overlap; facts
can become stale; this model omits implementation bugs, actual council member
independence, detailed upgrade powers, DA designs, and force-inclusion delays.
Equal points for fraud/validity and blobs/calldata do not assert equivalence of
their designs. Document these limits in the README and explain every factor.

## Ranking

Score each input and sort by score descending, then name ascending using JS
string comparison (`a < b`, `a > b`), never locale-sensitive comparison.
Preserve original order when both score and name tie, including direct callers
passing duplicate names. Assign consecutive ranks `1..n` (no shared ranks).
Return `[]` for `[]`; do not sort or otherwise mutate the caller's array.

## CLI and output

Supported invocation is `node src/cli.ts path [--json]`, with `--json` on either
side of the single path. `--help` and `-h` print usage to stdout and succeed
without reading an input file. Reject missing/extra paths, repeated flags and
unknown options with an explanatory stderr message and nonzero status.
Read UTF-8, parse JSON, validate, then rank. File, JSON and validation errors go
to stderr with nonzero status; validation failures include every issue's path
and message. Successful execution writes only the requested output to stdout
and exits 0. JSON output is `JSON.stringify(ranked, null, 2) + '\n'`.

Text output uses columns `Rank`, `Rollup`, `Stage`, `Score` in that order. Render
stage as 0/1/2 and score as its integer total (not a percent or `/100` suffix).
For reproducible examples, use two spaces between columns, left-align each
column to the maximum width of its header and values, remove trailing spaces
on every line, and append one newline. The empty case prints the header only.
`cli.ts` needs `#!/usr/bin/env node` and executable mode for the package bin.
Importing the public index must never run the CLI, read files or print output.

## Examples, checks and remaining implementation

README must explain installation/use, the full rubric and heuristic limits,
show an input containing six well-known rollups and show its ranked output.
`docs/example-sources.md` must identify dated sources and assumptions for each
example's facts; do not present example snapshots as live assessments. Commit
the same six inputs in `examples/rollups.json`, the exact pretty JSON result in
`examples/expected.json`, and exact table in `examples/expected.txt`. Example
tests should establish that both output artifacts agree with library/CLI results.

Run `npm test` (`node --test test/*.test.ts`) once implementation scopes exist.
Use `npm start -- examples/rollups.json` or
`node src/cli.ts --json examples/rollups.json` for direct execution. Foundation
checks only metadata, erasable types and Node 24 loading: runtime modules, all
five test suites, examples and README remain assigned to the owners above.
