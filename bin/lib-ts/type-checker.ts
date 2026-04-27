/**
 * type-checker.ts — automated type-check gate port (T4.4.1, cluster J).
 *
 * Pure-library port of `bin/lib/type-checker.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `runTypeCheck(input)` => RunTypeCheckResult
 *   - `detectTypeChecker(root)` => TypeCheckerInfo | null
 *   - `parseTypeErrors(output, checkerName)` => TypeCheckFinding[]
 *
 * Behavior parity:
 *   - Detector probes `tsconfig.json` -> `jsconfig.json` ->
 *     `pyrightconfig.json` -> `mypy.ini` -> `.mypy.ini`, plus
 *     `pyproject.toml` table sniffing for `[tool.mypy]` / `[tool.pyright]`.
 *   - Output parsers match legacy regex shapes for TypeScript (two
 *     forms), mypy, and Pyright. mypy `note:` is mapped to `warning`,
 *     Pyright `information:` is mapped to `warning` (legacy parity).
 *   - When `files` filter is supplied, findings are restricted to that
 *     subset (path-normalized to project root).
 *   - When no checker is detected, returns `{pass: true, checker: null}`
 *     plus the legacy advisory message.
 *
 * Security improvement (only behavior change vs legacy):
 *   - Legacy file invoked the detected `command` via a shell-spawning
 *     synchronous helper. Combined with the `config.type_command`
 *     override that arbitrary-strings into the shell, this was a command
 *     injection vector. The port uses `execFileSync` with the command
 *     tokenized into argv — same approach proven in `versioning.ts`.
 *     Override commands are tokenized via whitespace-split (the
 *     legacy contract was a string command — there is no escaping
 *     mechanism; callers passing flags-with-spaces in values were
 *     always broken).
 *   - The CLI entry point from the legacy file is intentionally NOT ported
 *     (matches T4.4.1 contract). Library consumers stay; CLI users keep
 *     using `bin/lib/type-checker.js` until M9 strangler cutover.
 *
 * Hardening (F2/F4/F9/F13 lessons from M3/M4):
 *   - Static `node:fs` + `node:path` imports.
 *   - Detector lookup never uses attacker-controlled keys.
 *
 * @see bin/lib/type-checker.js (legacy reference)
 * @see specs/decisions/adr-009-ipc-stdin-path-traversal.md
 * @see specs/implementation-plan.md T4.4.1
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

// Public types

export interface TypeCheckerInfo {
  command: string;
  name: string;
}

export interface TypeCheckFinding {
  file: string;
  line: number | null;
  severity: 'error' | 'warning';
  message: string;
  code: string | null;
}

export interface TypeCheckConfig {
  type_command?: string;
  strict?: boolean;
}

export interface RunTypeCheckInput {
  files?: string[];
  root?: string;
  config?: TypeCheckConfig;
}

export interface RunTypeCheckResult {
  files_checked: number | string;
  errors: number;
  warnings: number;
  findings: TypeCheckFinding[];
  pass: boolean;
  checker: string | null;
  message?: string;
  exit_code?: number;
}

interface DetectorEntry {
  file: string;
  command: string;
  name: string;
}

const DETECTORS: DetectorEntry[] = [
  { file: 'tsconfig.json', command: 'npx tsc --noEmit', name: 'TypeScript' },
  { file: 'jsconfig.json', command: 'npx tsc --noEmit --allowJs', name: 'TypeScript (JS)' },
  { file: 'pyrightconfig.json', command: 'npx pyright', name: 'Pyright' },
  { file: 'mypy.ini', command: 'python -m mypy', name: 'mypy' },
  { file: '.mypy.ini', command: 'python -m mypy', name: 'mypy' },
];

/** Detect the project's type checker from configuration files. */
export function detectTypeChecker(root: string): TypeCheckerInfo | null {
  const pyprojectPath = join(root, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, 'utf8');
      if (content.includes('[tool.mypy]')) {
        return { command: 'python -m mypy', name: 'mypy' };
      }
      if (content.includes('[tool.pyright]')) {
        return { command: 'npx pyright', name: 'Pyright' };
      }
    } catch {
      // ignore (legacy parity)
    }
  }

  for (const check of DETECTORS) {
    if (existsSync(join(root, check.file))) {
      return { command: check.command, name: check.name };
    }
  }
  return null;
}

/** Parse type-checker output into structured findings (TS/mypy/Pyright). */
export function parseTypeErrors(output: string, _checkerName: string): TypeCheckFinding[] {
  const findings: TypeCheckFinding[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // TypeScript format: src/index.ts(10,5): error TS2322: Type 'string'...
    const tsMatch = line.match(/^(.+?)\((\d+),\d+\):\s+(error|warning)\s+(TS\d+):\s+(.+)/);
    if (tsMatch) {
      findings.push({
        file: tsMatch[1],
        line: Number.parseInt(tsMatch[2], 10),
        severity: tsMatch[3] as 'error' | 'warning',
        code: tsMatch[4],
        message: tsMatch[5].trim(),
      });
      continue;
    }

    // TypeScript alt format: src/index.ts:10:5 - error TS2322: ...
    const tsAltMatch = line.match(/^(.+?):(\d+):\d+\s+-\s+(error|warning)\s+(TS\d+):\s+(.+)/);
    if (tsAltMatch) {
      findings.push({
        file: tsAltMatch[1],
        line: Number.parseInt(tsAltMatch[2], 10),
        severity: tsAltMatch[3] as 'error' | 'warning',
        code: tsAltMatch[4],
        message: tsAltMatch[5].trim(),
      });
      continue;
    }

    // mypy format: src/main.py:10: error: Incompatible types... [assignment]
    const mypyMatch = line.match(/^(.+?):(\d+):\s+(error|warning|note):\s+(.+?)(?:\s+\[(.+?)\])?$/);
    if (mypyMatch && !line.startsWith(' ')) {
      const sev = mypyMatch[3] === 'note' ? 'warning' : (mypyMatch[3] as 'error' | 'warning');
      findings.push({
        file: mypyMatch[1],
        line: Number.parseInt(mypyMatch[2], 10),
        severity: sev,
        code: mypyMatch[5] || null,
        message: mypyMatch[4].trim(),
      });
      continue;
    }

    // Pyright format: src/main.py:10:5 - error: Cannot assign... (reportGeneralClassIssues)
    const pyrightMatch = line.match(
      /^(.+?):(\d+):\d+\s+-\s+(error|warning|information):\s+(.+?)(?:\s+\((.+?)\))?$/
    );
    if (pyrightMatch) {
      const sev =
        pyrightMatch[3] === 'information' ? 'warning' : (pyrightMatch[3] as 'error' | 'warning');
      findings.push({
        file: pyrightMatch[1],
        line: Number.parseInt(pyrightMatch[2], 10),
        severity: sev,
        code: pyrightMatch[5] || null,
        message: pyrightMatch[4].trim(),
      });
    }
  }

  return findings;
}

/**
 * Tokenize a legacy command string into argv. Whitespace-split is faithful
 * to the legacy "string command" contract (no shell quoting was supported).
 */
function tokenizeCommand(cmd: string): { argv0: string; args: string[] } {
  const tokens = cmd.trim().split(/\s+/);
  const argv0 = tokens[0] || '';
  return { argv0, args: tokens.slice(1) };
}

interface ProcessError extends Error {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
  status?: number;
}

/** Run the configured/detected type checker and parse its output. */
export function runTypeCheck(input: RunTypeCheckInput): RunTypeCheckResult {
  const files = input.files || [];
  const root = input.root || '.';
  const config = input.config || {};
  const resolvedRoot = resolve(root);

  let checkerInfo: TypeCheckerInfo | null;
  if (config.type_command) {
    checkerInfo = { command: config.type_command, name: 'custom' };
  } else {
    checkerInfo = detectTypeChecker(resolvedRoot);
  }

  if (!checkerInfo) {
    return {
      files_checked: files.length,
      errors: 0,
      warnings: 0,
      findings: [],
      pass: true,
      checker: null,
      message:
        'No type checker detected. Consider adding tsconfig.json (TypeScript) or mypy.ini (Python).',
    };
  }

  let cmd = checkerInfo.command;
  if (config.strict && checkerInfo.name === 'TypeScript') {
    cmd += ' --strict';
  }

  const { argv0, args } = tokenizeCommand(cmd);
  let output = '';
  let exitCode = 0;

  try {
    const result = execFileSync(argv0, args, {
      cwd: resolvedRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
    });
    // With encoding: 'utf8', execFileSync returns string (Node typings).
    output = result;
  } catch (err) {
    const e = err as ProcessError;
    const stdout = e.stdout
      ? typeof e.stdout === 'string'
        ? e.stdout
        : e.stdout.toString('utf8')
      : '';
    const stderr = e.stderr
      ? typeof e.stderr === 'string'
        ? e.stderr
        : e.stderr.toString('utf8')
      : '';
    output = stdout + stderr;
    exitCode = e.status || 1;
  }

  let findings = parseTypeErrors(output, checkerInfo.name);

  if (files.length > 0) {
    const normalizedFiles = new Set(
      files.map((f) => (isAbsolute(f) ? relative(resolvedRoot, f) : f))
    );
    findings = findings.filter((f) => {
      const normalized = isAbsolute(f.file) ? relative(resolvedRoot, f.file) : f.file;
      return normalizedFiles.has(normalized);
    });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  return {
    files_checked: files.length || '(project-wide)',
    errors,
    warnings,
    findings,
    pass: errors === 0,
    checker: checkerInfo.name,
    exit_code: exitCode,
  };
}
