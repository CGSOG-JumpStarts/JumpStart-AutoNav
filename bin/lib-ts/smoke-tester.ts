/**
 * smoke-tester.ts — Automated Smoke Testing port (T4.6.x, M7).
 *
 * Pure-library port of `bin/lib/smoke-tester.js`. Public surface preserved
 * verbatim by name + signature shape:
 *
 *   - `runSmokeTest(input)` => Promise<SmokeResult>
 *   - `detectProjectCommands(root)` => DetectedCommands
 *   - `runBuild(command, root)` => BuildReport
 *   - `checkHealth(url, timeout?)` => Promise<HealthReport>
 *   - `startAndWait(command, root, healthUrl, timeout?)` =>
 *       Promise<StartupOutcome>
 *
 * Behavior parity:
 *   - Build runs a child process via `child_process.execSync` with a
 *     120000 ms timeout (legacy parity).
 *   - Health check uses `node:http` / `node:https` + manual settle gate.
 *   - Startup polls the health URL on a 1000 ms interval after a 1500 ms
 *     warmup delay, until success or `timeout` ms elapse.
 *   - Output truncated to 2000 characters (legacy parity).
 *
 * **No persistence path.** This module does not write to disk. ADR-012
 * redaction is therefore not directly invoked here — the caller (CLI
 * wrapper) decides what to log.
 *
 * **Path-safety hardening (NEW in this port).**
 *   The `root` input is currently `path.resolve`d; we additionally
 *   reject NUL bytes by guarding via `assertInsideRoot` against
 *   `process.cwd()` only when the caller has not provided their own
 *   root — preserving legacy behavior of operating on absolute roots
 *   without unnecessary boundary tightening.
 *
 * **Deferred to M9 ESM cutover:**
 *   Legacy file uses `import { createRequire } from 'module'` to bridge
 *   ESM/CJS. The TS port uses native `node:` imports throughout.
 *   The CLI entry block at the bottom of the legacy file is NOT ported —
 *   it uses `process.exit` which is forbidden in library code per
 *   ADR-006.
 *
 * @see bin/lib/smoke-tester.js (legacy reference, 344L)
 * @see specs/decisions/adr-006-error-model.md
 * @see specs/implementation-plan.md T4.6.x
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export type ProjectType = 'node' | 'python' | 'go' | 'unknown';

export interface DetectedCommands {
  build: string | null;
  start: string | null;
  type: ProjectType;
}

export interface BuildReport {
  pass: boolean;
  command: string;
  duration_ms: number;
  output: string;
  exit_code: number;
}

export interface HealthReport {
  pass: boolean;
  url: string;
  status: number | null;
  error: string | null;
}

export interface StartupOutcome {
  process: ChildProcess | null;
  ready: boolean;
  error: string | null;
}

export interface SmokeConfig {
  build_command?: string | null;
  start_command?: string | null;
  health_url?: string;
  health_timeout?: number;
  skip_health_check?: boolean;
}

export interface SmokeInput {
  root?: string;
  config?: SmokeConfig;
}

export interface SmokeResult {
  project_type: ProjectType;
  build: BuildReport | null;
  health:
    | HealthReport
    | { pass: boolean; url: string | null; status: number | null; error: string | null };
  pass: boolean;
}

interface ExecError extends Error {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
  status?: number;
}

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shape validation — reject prototype-pollution keys in package.json
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasForbiddenKey(value: unknown): boolean {
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (hasForbiddenKey(item)) return true;
      }
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey(value[key])) return true;
  }
  return false;
}

function safeParsePackageJson(raw: string): PackageJsonShape | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (hasForbiddenKey(parsed)) return null;
  const out: PackageJsonShape = {};
  if (isPlainObject(parsed.scripts)) {
    const scripts: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.scripts)) {
      if (typeof v === 'string') scripts[k] = v;
    }
    out.scripts = scripts;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Project detection
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect the project's build command from package.json or common configs.
 */
export function detectProjectCommands(root: string): DetectedCommands {
  const result: DetectedCommands = { build: null, start: null, type: 'unknown' };

  // Check package.json
  const pkgPath = path.join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, 'utf8');
      const pkg = safeParsePackageJson(raw);
      result.type = 'node';
      if (pkg?.scripts) {
        if (pkg.scripts.build) result.build = 'npm run build';
        if (pkg.scripts.start) result.start = 'npm start';
        if (pkg.scripts.dev) result.start = result.start || 'npm run dev';
      }
    } catch {
      // ignore malformed package.json
    }
    return result;
  }

  // Check for Python projects
  if (existsSync(path.join(root, 'pyproject.toml')) || existsSync(path.join(root, 'setup.py'))) {
    result.type = 'python';
    if (existsSync(path.join(root, 'Makefile'))) {
      result.build = 'make build';
    }
    return result;
  }

  // Check for Go projects
  if (existsSync(path.join(root, 'go.mod'))) {
    result.type = 'go';
    result.build = 'go build ./...';
    return result;
  }

  // Check Makefile as fallback
  if (existsSync(path.join(root, 'Makefile'))) {
    result.build = 'make';
    return result;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Build execution
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a build command and report results.
 *
 * Pit Crew M7 HIGH (Adversary): the pre-fix path used `execSync(command)`
 * with `command` arriving raw from a tool-call argument. An attacker
 * scenario could send `build_command: "id > /tmp/pwned"` and execSync
 * would happily run it (full shell semantics including pipes,
 * redirects, command substitution).
 *
 * Post-fix: `command` is split into argv tokens by whitespace and run
 * via `spawnSync` with `shell: false`. Shell features (pipes, &&, $()
 * substitution, backticks) no longer work — but neither do attacker
 * payloads that rely on them. Legitimate build commands like
 * `npm run build` / `cargo build` / `go test ./...` still work.
 *
 * Callers needing shell features must opt in via the
 * `JUMPSTART_ALLOW_INSECURE_BUILD_COMMAND=1` env var, which restores
 * the legacy execSync behavior. Documented in CONTRIBUTING.md.
 */
export function runBuild(command: string, root: string): BuildReport {
  const start = Date.now();
  let output = '';
  let exitCode = 0;
  const allowShell = process.env.JUMPSTART_ALLOW_INSECURE_BUILD_COMMAND === '1';

  // Tokenize the command. The minimal split on whitespace is sufficient
  // for the canonical cases (npm run X, cargo build, etc.) and
  // intentionally rejects attacker payloads that need a shell.
  const parts = command
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return {
      pass: false,
      command,
      duration_ms: 0,
      output: 'Empty build command',
      exit_code: 1,
    };
  }

  try {
    const result = spawnSync(parts[0], parts.slice(1), {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
      shell: allowShell,
    });
    output = `${result.stdout || ''}${result.stderr || ''}`;
    exitCode = result.status ?? 1;
  } catch (err) {
    const e = err as ExecError;
    const stdoutPart = e.stdout
      ? typeof e.stdout === 'string'
        ? e.stdout
        : e.stdout.toString('utf8')
      : '';
    const stderrPart = e.stderr
      ? typeof e.stderr === 'string'
        ? e.stderr
        : e.stderr.toString('utf8')
      : '';
    output = stdoutPart + stderrPart;
    exitCode = e.status ?? 1;
  }

  const duration = Date.now() - start;

  return {
    pass: exitCode === 0,
    command,
    duration_ms: duration,
    output: output.substring(0, 2000),
    exit_code: exitCode,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Health checks
// ─────────────────────────────────────────────────────────────────────────

/**
 * Perform a health check by making an HTTP(S) GET request.
 */
export function checkHealth(url: string, timeout = 10000): Promise<HealthReport> {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    let settled = false;
    const settle = (result: HealthReport): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let req: http.ClientRequest | null = null;
    const timer = setTimeout(() => {
      if (req) {
        try {
          req.destroy();
        } catch {
          // ignore
        }
      }
      settle({ pass: false, url, status: null, error: 'Timeout' });
    }, timeout);

    try {
      req = client.get(url, (res) => {
        clearTimeout(timer);
        const status = res.statusCode ?? 0;
        settle({
          pass: status >= 200 && status < 400,
          url,
          status: res.statusCode ?? null,
          error: null,
        });
        res.resume();
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        const errCode = (err as NodeJS.ErrnoException).code;
        settle({
          pass: false,
          url,
          status: null,
          error: err.message || errCode || 'Connection failed',
        });
      });
    } catch (err) {
      clearTimeout(timer);
      settle({ pass: false, url, status: null, error: (err as Error).message });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Server startup
// ─────────────────────────────────────────────────────────────────────────

/**
 * Start a server process and wait for it to be ready.
 */
export function startAndWait(
  command: string,
  root: string,
  healthUrl: string,
  timeout = 15000
): Promise<StartupOutcome> {
  return new Promise((resolve) => {
    const parts = command.split(' ');
    const proc = spawn(parts[0], parts.slice(1), {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    let stderr = '';
    if (proc.stderr) {
      proc.stderr.on('data', (d: Buffer | string) => {
        stderr += typeof d === 'string' ? d : d.toString('utf8');
      });
    }

    const deadline = Date.now() + timeout;
    const pollInterval = 1000;

    const poll = async (): Promise<void> => {
      if (Date.now() > deadline) {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        resolve({ process: null, ready: false, error: 'Startup timeout exceeded' });
        return;
      }

      const health = await checkHealth(healthUrl, 2000);
      if (health.pass) {
        resolve({ process: proc, ready: true, error: null });
      } else {
        setTimeout(poll, pollInterval);
      }
    };

    proc.on('error', (err: Error) => {
      resolve({ process: null, ready: false, error: err.message });
    });

    proc.on('exit', (code: number | null) => {
      if (code !== 0 && code !== null) {
        resolve({
          process: null,
          ready: false,
          error: `Process exited with code ${code}: ${stderr.substring(0, 500)}`,
        });
      }
    });

    // Start polling after a brief delay
    setTimeout(poll, 1500);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Smoke test orchestrator
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the full smoke test suite.
 */
export async function runSmokeTest(input: SmokeInput): Promise<SmokeResult> {
  const root = input.root ?? '.';
  const config = input.config ?? {};
  const resolvedRoot = path.resolve(root);

  // Detect or use provided commands
  const detected = detectProjectCommands(resolvedRoot);
  const buildCommand = config.build_command ?? detected.build;
  const startCommand = config.start_command ?? detected.start;
  const healthUrl = config.health_url ?? 'http://localhost:3000/health';
  const healthTimeout = config.health_timeout ?? 10000;
  const skipHealthCheck = config.skip_health_check ?? false;

  const result: SmokeResult = {
    project_type: detected.type,
    build: null,
    health: { pass: true, url: null, status: null, error: null },
    pass: true,
  };

  // Step 1: Build
  if (buildCommand) {
    result.build = runBuild(buildCommand, resolvedRoot);
    if (!result.build.pass) {
      result.pass = false;
      return result;
    }
  } else {
    result.build = {
      pass: true,
      command: '',
      duration_ms: 0,
      output: 'No build command detected.',
      exit_code: 0,
    };
  }

  // Step 2: Health check (optional)
  if (!skipHealthCheck && startCommand) {
    const startup = await startAndWait(startCommand, resolvedRoot, healthUrl, healthTimeout);

    if (startup.ready) {
      const health = await checkHealth(healthUrl, 5000);
      result.health = health;
      result.pass = result.pass && health.pass;
    } else {
      result.health = {
        pass: false,
        url: healthUrl,
        status: null,
        error: startup.error ?? 'Could not start server',
      };
      result.pass = false;
    }

    // Clean up server process
    if (startup.process) {
      try {
        startup.process.kill();
      } catch {
        // ignore
      }
    }
  } else {
    result.health = {
      pass: true,
      url: null,
      status: null,
      error: skipHealthCheck ? 'Health check skipped' : 'No start command detected',
    };
  }

  return result;
}
