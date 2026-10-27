#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { rankRollups } from './rank.ts';
import { validateRollups } from './validate.ts';
import type { RankedRollup } from './types.ts';

const usage = 'Usage: rollup-risk <input.json> [--json]';

type Arguments =
  | { help: true }
  | { help: false; json: boolean; path: string }
  | { help: false; error: string };

function parseArguments(args: readonly string[]): Arguments {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    return { help: true };
  }

  let json = false;
  const paths: string[] = [];

  for (const argument of args) {
    if (argument === '--json') {
      if (json) {
        return { help: false, error: 'The --json flag may only be used once.' };
      }
      json = true;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      return { help: false, error: 'The help flag must be used by itself.' };
    }

    if (argument.startsWith('-')) {
      return { help: false, error: `Unknown option: ${argument}` };
    }

    paths.push(argument);
  }

  if (paths.length !== 1) {
    return {
      help: false,
      error: paths.length === 0 ? 'An input JSON file is required.' : 'Only one input JSON file is allowed.',
    };
  }

  return { help: false, json, path: paths[0] };
}

function formatTable(ranked: readonly RankedRollup[]): string {
  const rows = ranked.map((entry) => [
    String(entry.rank),
    entry.rollup.name,
    String(entry.rollup.stage),
    String(entry.score),
  ]);
  const headers = ['Rank', 'Rollup', 'Stage', 'Score'];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const renderRow = (row: readonly string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd();

  return [renderRow(headers), ...rows.map(renderRow)].join('\n') + '\n';
}

/** Run the command-line program and return its process exit status. */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  const parsed = parseArguments(args);
  if (parsed.help) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }

  if ('error' in parsed) {
    process.stderr.write(`${parsed.error}\n${usage}\n`);
    return 1;
  }

  let text: string;
  try {
    text = readFileSync(parsed.path, 'utf8');
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not read ${parsed.path}: ${detail}\n`);
    return 1;
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not parse JSON in ${parsed.path}: ${detail}\n`);
    return 1;
  }

  const validation = validateRollups(input);
  if (!validation.valid) {
    process.stderr.write(
      `Validation failed:\n${validation.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}\n`,
    );
    return 1;
  }

  const ranked = rankRollups(validation.rollups);
  process.stdout.write(parsed.json ? `${JSON.stringify(ranked, null, 2)}\n` : formatTable(ranked));
  return 0;
}

if (import.meta.main) {
  process.exitCode = main();
}
