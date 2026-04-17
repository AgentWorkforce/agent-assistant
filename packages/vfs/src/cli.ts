import {
  dirname,
  formatEntries,
  formatReadResult,
  formatSearchResults,
  formatTree,
  normalizeVfsPath,
  toJson,
  truncateReadResult,
} from './output.js';
import type {
  VfsCliOptions,
  VfsCliWritable,
  VfsEntry,
  VfsProvider,
} from './types.js';

const DEFAULT_MAX_CONTENT_CHARS = 80_000;
const DEFAULT_MAX_RESULTS = 100;

type FlagValue = boolean | string;

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, FlagValue>;
}

class UsageError extends Error {}

export async function runVfsCli(options: VfsCliOptions): Promise<number> {
  const name = options.name ?? 'vfs';
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const [command = 'help', ...rest] = argv;
    if (command === 'help' || command === '--help' || command === '-h') {
      write(stdout, helpText(name));
      return 0;
    }

    const parsed = parseArgs(rest);
    switch (command) {
      case 'list':
        return await runList(name, options.provider, parsed, options, stdout);
      case 'tree':
        return await runTree(name, options.provider, parsed, options, stdout);
      case 'read':
        return await runRead(name, options.provider, parsed, options, stdout, stderr);
      case 'search':
        return await runSearch(name, options.provider, parsed, options, stdout);
      case 'stat':
        return await runStat(name, options.provider, parsed, options, stdout, stderr);
      default:
        throw new UsageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      write(stderr, `${error.message}\n\n${helpText(name)}`);
      return 2;
    }

    write(stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runList(
  name: string,
  provider: VfsProvider,
  parsed: ParsedArgs,
  options: VfsCliOptions,
  stdout: VfsCliWritable,
): Promise<number> {
  const rootPath = normalizeVfsPath(parsed.positionals[0] ?? '/');
  const depth = readPositiveInteger(parsed, 'depth', 1);
  const limit = readPositiveInteger(parsed, 'limit', options.maxResults ?? DEFAULT_MAX_RESULTS);
  ensureNoUnknownFlags(parsed, ['json', 'depth', 'limit']);
  ensurePositionals(parsed, 0, 1, `${name} list [path] [--depth N] [--limit N] [--json]`);

  const entries = await provider.list(rootPath, { depth, limit });
  write(stdout, hasFlag(parsed, 'json') ? toJson(entries) : `${formatEntries(entries)}\n`);
  return 0;
}

async function runTree(
  name: string,
  provider: VfsProvider,
  parsed: ParsedArgs,
  options: VfsCliOptions,
  stdout: VfsCliWritable,
): Promise<number> {
  const rootPath = normalizeVfsPath(parsed.positionals[0] ?? '/');
  const depth = readPositiveInteger(parsed, 'depth', 3);
  const limit = readPositiveInteger(parsed, 'limit', options.maxResults ?? DEFAULT_MAX_RESULTS);
  ensureNoUnknownFlags(parsed, ['json', 'depth', 'limit']);
  ensurePositionals(parsed, 0, 1, `${name} tree [path] [--depth N] [--limit N] [--json]`);

  const entries = await provider.list(rootPath, { depth, limit });
  write(stdout, hasFlag(parsed, 'json') ? toJson(entries) : `${formatTree(rootPath, entries)}\n`);
  return 0;
}

async function runRead(
  name: string,
  provider: VfsProvider,
  parsed: ParsedArgs,
  options: VfsCliOptions,
  stdout: VfsCliWritable,
  stderr: VfsCliWritable,
): Promise<number> {
  ensureNoUnknownFlags(parsed, ['json', 'max-chars']);
  ensurePositionals(parsed, 1, 1, `${name} read <path> [--max-chars N] [--json]`);

  const maxContentChars = readPositiveInteger(
    parsed,
    'max-chars',
    options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
  );
  const result = await provider.read(normalizeVfsPath(parsed.positionals[0] ?? ''));
  if (!result) {
    write(stderr, `Not found: ${parsed.positionals[0]}\n`);
    return 1;
  }

  const truncated = truncateReadResult(result, maxContentChars);
  write(stdout, hasFlag(parsed, 'json') ? toJson(truncated) : `${formatReadResult(truncated)}\n`);
  return 0;
}

async function runSearch(
  name: string,
  provider: VfsProvider,
  parsed: ParsedArgs,
  options: VfsCliOptions,
  stdout: VfsCliWritable,
): Promise<number> {
  ensureNoUnknownFlags(parsed, ['json', 'provider', 'limit']);
  ensurePositionals(parsed, 1, Number.POSITIVE_INFINITY, `${name} search <query> [--provider NAME] [--limit N] [--json]`);

  const query = parsed.positionals.join(' ').trim();
  const limit = readPositiveInteger(parsed, 'limit', options.maxResults ?? DEFAULT_MAX_RESULTS);
  const providerFilter = readStringFlag(parsed, 'provider');
  const results = await provider.search(query, { provider: providerFilter, limit });
  write(stdout, hasFlag(parsed, 'json') ? toJson(results) : `${formatSearchResults(results)}\n`);
  return 0;
}

async function runStat(
  name: string,
  provider: VfsProvider,
  parsed: ParsedArgs,
  options: VfsCliOptions,
  stdout: VfsCliWritable,
  stderr: VfsCliWritable,
): Promise<number> {
  ensureNoUnknownFlags(parsed, ['json', 'limit']);
  ensurePositionals(parsed, 1, 1, `${name} stat <path> [--json]`);

  const targetPath = normalizeVfsPath(parsed.positionals[0] ?? '');
  const result = await resolveStat(provider, targetPath, options.maxResults ?? DEFAULT_MAX_RESULTS);
  if (!result) {
    write(stderr, `Not found: ${targetPath}\n`);
    return 1;
  }

  write(stdout, hasFlag(parsed, 'json') ? toJson(result) : `${formatEntries([result])}\n`);
  return 0;
}

async function resolveStat(
  provider: VfsProvider,
  targetPath: string,
  limit: number,
): Promise<VfsEntry | null> {
  if (provider.stat) {
    return provider.stat(targetPath);
  }

  const parent = dirname(targetPath);
  const entries = await provider.list(parent, { depth: 1, limit });
  return entries.find((entry) => normalizeVfsPath(entry.path) === targetPath) ?? null;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, FlagValue>();
  let positionalOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (positionalOnly) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      positionalOnly = true;
      continue;
    }
    if (!arg.startsWith('--') || arg === '--') {
      positionals.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('-') && flagRequiresValue(withoutPrefix)) {
      flags.set(withoutPrefix, next);
      index += 1;
      continue;
    }

    flags.set(withoutPrefix, true);
  }

  return { positionals, flags };
}

function flagRequiresValue(name: string): boolean {
  return name === 'depth' || name === 'limit' || name === 'provider' || name === 'max-chars';
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

function readStringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim() || undefined;
}

function readPositiveInteger(parsed: ParsedArgs, name: string, fallback: number): number {
  const value = parsed.flags.get(name);
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new UsageError(`--${name} must be a positive integer`);
  }

  return parsedValue;
}

function ensureNoUnknownFlags(parsed: ParsedArgs, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const flag of parsed.flags.keys()) {
    if (!allowedSet.has(flag)) {
      throw new UsageError(`Unknown flag: --${flag}`);
    }
  }
}

function ensurePositionals(
  parsed: ParsedArgs,
  min: number,
  max: number,
  usage: string,
): void {
  if (parsed.positionals.length < min || parsed.positionals.length > max) {
    throw new UsageError(`Usage: ${usage}`);
  }
}

function write(stream: VfsCliWritable, value: string): void {
  stream.write(value);
}

function helpText(name: string): string {
  return [
    `Usage: ${name} <command> [options]`,
    '',
    'Commands:',
    `  ${name} list [path] [--depth N] [--limit N] [--json]`,
    `  ${name} tree [path] [--depth N] [--limit N] [--json]`,
    `  ${name} read <path> [--max-chars N] [--json]`,
    `  ${name} search <query> [--provider NAME] [--limit N] [--json]`,
    `  ${name} stat <path> [--json]`,
    '',
  ].join('\n');
}
