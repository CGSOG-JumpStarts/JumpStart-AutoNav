/**
 * secret-scanner.ts — secret-scanner port (T4.2.4b).
 *
 * Pure-library port of `bin/lib/secret-scanner.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `DEFAULT_PATTERNS` (constant array)
 *   - `compileCustomPatterns(customPatterns)`
 *   - `shouldSkip(filePath, allowlist?)`
 *   - `scanFile(filePath, patterns)`
 *   - `runSecretScan(input)`
 *
 * **Plus the ADR-012 redaction helper added in this port:**
 *   - `scanForSecrets(input: string): SecretMatch[]`
 *     Scans an arbitrary string (NOT a file) and returns matches with
 *     pattern metadata. Used by `usage.ts` and `timeline.ts`
 *     (T4.3.1, T4.3.3) to redact log payloads before persistence.
 *   - `redactSecrets<T>(value: T): T`
 *     Recursively walks an object/array/string and replaces every
 *     match of `DEFAULT_PATTERNS` with a `[REDACTED:<pattern-name>]`
 *     marker. Preserves shape — string fields stay strings, objects
 *     stay objects, arrays stay arrays, primitives unchanged.
 *
 * Behavior parity:
 *   - Pattern catalog (12 entries) is verbatim from legacy.
 *   - Skip lists (`DEFAULT_SKIP`, `BINARY_EXTENSIONS`) verbatim.
 *   - Match-redaction shape: `prefix4 + '****' + suffix4`, or `'****'`
 *     for matches <= 8 chars.
 *   - `requires_context` filter is honored on the AWS Secret Key
 *     pattern (only emits a match when the line ALSO mentions
 *     `aws_secret`/`secret_access_key`/`AWS_SECRET`).
 *
 * @see bin/lib/secret-scanner.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.2.4b
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

// Public types

export type SecretSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: SecretSeverity;
  requires_context?: RegExp;
}

export interface CustomPatternInput {
  name?: string;
  pattern: string;
  severity?: SecretSeverity;
}

export interface SecretFinding {
  file: string;
  line: number;
  pattern_name: string;
  severity: SecretSeverity;
  match: string;
}

export interface SecretMatch {
  pattern_name: string;
  severity: SecretSeverity;
  match: string;
  start: number;
  end: number;
}

export interface SecretScanInput {
  files?: string[];
  root?: string;
  config?: {
    custom_patterns?: CustomPatternInput[];
    allowlist?: string[];
  };
}

export interface SecretScanResult {
  files_scanned: number;
  secrets_found: number;
  critical: number;
  high: number;
  findings: SecretFinding[];
  pass: boolean;
}

// Built-in patterns (preserved verbatim from legacy)

export const DEFAULT_PATTERNS: SecretPattern[] = [
  {
    name: 'AWS Access Key',
    pattern: /(?<![A-Za-z0-9/+=])(AKIA[0-9A-Z]{16})(?![A-Za-z0-9/+=])/,
    severity: 'critical',
  },
  {
    name: 'AWS Secret Key',
    pattern: /(?<![A-Za-z0-9/+=])([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/,
    severity: 'critical',
    requires_context: /aws_secret|secret_access_key|AWS_SECRET/i,
  },
  {
    name: 'GitHub Token',
    pattern: /(?<![A-Za-z0-9_])(gh[ps]_[A-Za-z0-9_]{36,})(?![A-Za-z0-9_])/,
    severity: 'critical',
  },
  {
    name: 'GitHub Fine-grained PAT',
    pattern: /(?<![A-Za-z0-9_])(github_pat_[A-Za-z0-9_]{22,})(?![A-Za-z0-9_])/,
    severity: 'critical',
  },
  {
    name: 'Generic API Key Assignment',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/i,
    severity: 'high',
  },
  {
    name: 'Generic Secret Assignment',
    pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*["']([^\s"']{8,})["']/i,
    severity: 'high',
  },
  {
    name: 'Generic Token Assignment',
    pattern: /(?:token|auth_token|access_token)\s*[:=]\s*["']([A-Za-z0-9_\-.]{20,})["']/i,
    severity: 'high',
  },
  {
    name: 'Private Key Header',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
  },
  {
    name: 'Slack Webhook',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
    severity: 'high',
  },
  {
    name: 'Slack Bot Token',
    pattern: /(?<![A-Za-z0-9_-])(xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,})(?![A-Za-z0-9_-])/,
    severity: 'critical',
  },
  {
    name: 'Database Connection String',
    pattern: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s"'<>]{10,}/i,
    severity: 'high',
  },
  {
    name: 'Bearer Token',
    pattern: /(?:Authorization|Bearer)\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9_\-.]{20,}/i,
    severity: 'high',
  },
];

// Skip lists (preserved verbatim)

const DEFAULT_SKIP: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

const BINARY_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
]);

// Implementation

/**
 * Compile custom pattern strings into RegExp objects. Drops entries
 * whose pattern is too long (>500 chars — defense against ReDoS-prone
 * input) or fails to parse.
 */
export function compileCustomPatterns(customPatterns?: CustomPatternInput[]): SecretPattern[] {
  return (customPatterns || [])
    .map((p): SecretPattern | null => {
      if (typeof p.pattern === 'string' && p.pattern.length > 500) {
        return null;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(p.pattern);
      } catch {
        return null;
      }
      return {
        name: p.name || 'Custom Pattern',
        pattern: regex,
        severity: p.severity || 'high',
      };
    })
    .filter((entry): entry is SecretPattern => entry !== null);
}

/**
 * Check if a file path should be skipped (binary extension, default
 * skip directory, or in caller's allowlist).
 *
 * `DEFAULT_SKIP` matches against full path SEGMENTS (not substring) so
 * `build` doesn't false-match `rebuild` or `buildUtils.js`. Allowlist
 * supports exact match, suffix match, and basename match.
 */
export function shouldSkip(filePath: string, allowlist: string[] = []): boolean {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) return true;

  const segments = filePath.split(path.sep).flatMap((s) => s.split('/'));
  for (const skip of DEFAULT_SKIP) {
    if (segments.includes(skip)) return true;
  }

  for (const allowed of allowlist) {
    if (filePath === allowed || filePath.endsWith(allowed) || basename === allowed) {
      return true;
    }
  }

  return false;
}

/** Redact a matched substring for safe reporting: `prefix4****suffix4`
 *  or `'****'` for matches <= 8 chars. */
function redactMatch(matched: string): string {
  return matched.length > 8
    ? `${matched.substring(0, 4)}****${matched.substring(matched.length - 4)}`
    : '****';
}

/**
 * Scan a single file's contents for secrets matching the supplied
 * patterns. Returns one finding per match.
 *
 * Skips lines whose only content is a comment marker (`#`, `//`)
 * followed by `example`/`TODO`/`FIXME`/`NOTE` — these are intentionally
 * planted example values, not real secrets.
 */
export function scanFile(filePath: string, patterns: SecretPattern[]): SecretFinding[] {
  const findings: SecretFinding[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return findings;
  }

  // Split on either LF or CRLF so Windows-style line endings don't
  // leave \r on the line content (which the patterns and the comment-
  // skip regex would otherwise treat as part of the match).
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Pit Crew M3 Reviewer M4 (DEFERRED): the legacy skip-line regex
    // `^\s*(#|\/\/)\s*(example|TODO|FIXME|NOTE)` allows `// TODO
    // actualSecret = "ghp_..."` to bypass the scanner. Tightening it
    // breaks the parity test in `test-secret-scanner.test.ts` which
    // explicitly validates that a `// example: ghp_<40 X>` line is
    // skipped. Logged in Deviation Log under T4.2.4b for a coordinated
    // ADR-012 v2 amendment alongside the M4 redaction layer.
    if (/^\s*(#|\/\/)\s*(example|TODO|FIXME|NOTE)/i.test(line)) continue;

    for (const patternDef of patterns) {
      if (patternDef.requires_context && !patternDef.requires_context.test(line)) {
        continue;
      }

      // Pit Crew M3 Reviewer M10: legacy used `.match(pattern)` which
      // returns ONLY the first match for non-global regexes. That
      // silently drops multi-secret-per-line. Build a global variant
      // and iterate every match (mirroring `scanForSecrets` semantics).
      const globalPattern = patternDef.pattern.flags.includes('g')
        ? patternDef.pattern
        : new RegExp(patternDef.pattern.source, `${patternDef.pattern.flags}g`);
      for (const m of line.matchAll(globalPattern)) {
        const matched = m[1] || m[0];
        findings.push({
          file: filePath,
          line: i + 1,
          pattern_name: patternDef.name,
          severity: patternDef.severity,
          match: redactMatch(matched),
        });
      }
    }
  }

  return findings;
}

/**
 * Run secret scanning on the supplied file list. Defaults match
 * legacy: `files=[]`, `root='.'`, `config={}`.
 */
export function runSecretScan(input: SecretScanInput): SecretScanResult {
  const { files = [], root = '.', config = {} } = input;
  const resolvedRoot = path.resolve(root);
  const allowlist = config.allowlist || [];

  const patterns: SecretPattern[] = [
    ...DEFAULT_PATTERNS,
    ...compileCustomPatterns(config.custom_patterns),
  ];

  const allFindings: SecretFinding[] = [];
  let filesScanned = 0;

  for (const file of files) {
    const fullPath = path.isAbsolute(file) ? file : path.join(resolvedRoot, file);
    const resolvedFull = path.resolve(fullPath);

    // Pit Crew M3 Adversary F3 (BLOCKER, confirmed exploit): legacy
    // accepted any absolute path including `/etc/passwd`, then read
    // and scanned it. Filter to paths that lexically resolve under
    // `resolvedRoot`. Skip silently (rather than throw) so caller can
    // pass a heterogeneous list of files without surface-level
    // failure — consistent with the existing skip-on-error pattern.
    //
    // Edge case: when `resolvedRoot === '/'` (or `'C:\\'` on Windows),
    // appending a separator would produce `'//'` which never starts
    // any real path. Use `path.relative` and accept the result iff it
    // doesn't ascend (no leading `..`) and isn't absolute.
    const rel = path.relative(resolvedRoot, resolvedFull);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      continue;
    }

    if (!existsSync(fullPath)) continue;
    if (shouldSkip(file, allowlist)) continue;

    filesScanned++;
    const fileFindings = scanFile(fullPath, patterns);
    allFindings.push(...fileFindings);
  }

  const critical = allFindings.filter((f) => f.severity === 'critical').length;
  const high = allFindings.filter((f) => f.severity === 'high').length;

  return {
    files_scanned: filesScanned,
    secrets_found: allFindings.length,
    critical,
    high,
    findings: allFindings,
    pass: allFindings.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-012 redaction helpers (added in this port)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scan an arbitrary string for secret matches against `DEFAULT_PATTERNS`.
 * Returns one entry per match with start/end offsets so callers can do
 * structured replacement. Used by `redactSecrets` and intended for
 * direct use by ADR-012-mandated redaction in `usage.ts` and
 * `timeline.ts`.
 *
 * `requires_context` is honored: a pattern that requires surrounding
 * context (AWS Secret Key) only matches when the input ALSO contains
 * the context keyword.
 */
export function scanForSecrets(input: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  if (typeof input !== 'string' || input.length === 0) return matches;

  for (const patternDef of DEFAULT_PATTERNS) {
    if (patternDef.requires_context && !patternDef.requires_context.test(input)) {
      continue;
    }

    // Build a global variant of the pattern so we can iterate every
    // match (the canonical patterns are non-global by default).
    const globalPattern = new RegExp(
      patternDef.pattern.source,
      patternDef.pattern.flags.includes('g')
        ? patternDef.pattern.flags
        : `${patternDef.pattern.flags}g`
    );
    const all = input.matchAll(globalPattern);
    for (const m of all) {
      const captured = m[1] || m[0];
      const start = m.index ?? 0;
      const end = start + (m[0]?.length ?? 0);
      matches.push({
        pattern_name: patternDef.name,
        severity: patternDef.severity,
        match: captured,
        start,
        end,
      });
    }
  }

  // Sort by start offset for deterministic processing order.
  matches.sort((a, b) => a.start - b.start);
  return matches;
}

/**
 * Recursively redact secrets inside `value`. Returns a new value of
 * the SAME shape with every detected secret substring replaced by
 * `[REDACTED:<pattern-name>]`. Strings, plain objects, and arrays are
 * walked; other types pass through unchanged.
 *
 * Type parameter `T` flows through to the return so callers don't lose
 * static typing — the runtime value is shape-equivalent but with
 * sensitive substrings replaced.
 *
 * @example
 *   redactSecrets({auth: {token: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}})
 *   // => {auth: {token: '[REDACTED:GitHub Token]'}}
 *
 * Performance note: for very large strings (>1MB) this calls
 * `scanForSecrets` once and walks matches in a single replace pass.
 * Object/array recursion is depth-first; cycle detection uses a
 * WeakSet so circular references don't infinite-loop.
 */
export function redactSecrets<T>(value: T): T {
  return redactSecretsImpl(value, new WeakSet()) as T;
}

function redactSecretsImpl(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // Cycle protection (covers direct AND indirect cycles via the
  // shared WeakSet across the entire walk).
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsImpl(item, seen));
  }

  // Pit Crew M3 Reviewer H2 + M4 Adv F11: Buffer / Map / Set handling.
  // ADR-012 mandates redaction on every log-write path. Map/Set
  // round-tripped as Map/Set would JSON.stringify to `{}`/`{}` (silent
  // data loss — Pit Crew M4 Adv F11 confirmed exploit). To preserve
  // BOTH shape AND JSON-serializability we project them to plain
  // arrays/objects post-redaction. Buffer round-trips through utf-8.
  //
  // Trade-off: in-process consumers that received a Map/Set from
  // redactSecrets pre-fix and depended on `.get`/`.has` will now
  // receive an array. Documented as intentional behavior change in
  // the Deviation Log under T4.3.3.
  if (Buffer.isBuffer(value)) {
    return Buffer.from(redactString(value.toString('utf8')), 'utf8');
  }
  if (value instanceof Map) {
    // Project Map to an array of [key, value] tuples — JSON-safe and
    // round-trips via `new Map(arr)` if the consumer needs a Map.
    const out: Array<[unknown, unknown]> = [];
    for (const [k, v] of value.entries()) {
      out.push([redactSecretsImpl(k, seen), redactSecretsImpl(v, seen)]);
    }
    return out;
  }
  if (value instanceof Set) {
    // Project Set to an array — JSON-safe and round-trips via
    // `new Set(arr)`.
    const out: unknown[] = [];
    for (const v of value) {
      out.push(redactSecretsImpl(v, seen));
    }
    return out;
  }

  // Plain object recursion. Class instances (Date, RegExp, Error, and
  // user-land classes) pass through by reference per the shape-
  // preservation contract — callers that want them redacted should
  // stringify first. Pit Crew M3 Adversary F11 noted that classes
  // with dynamic toString() can leak via downstream String() coercion;
  // this is documented behavior, not a regression.
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = redactSecretsImpl(child, seen);
  }
  return result;
}

/**
 * Replace every secret match in `input` with `[REDACTED:<pattern>]`.
 * Walks matches sorted by start offset, building the output in one
 * pass to handle overlapping matches correctly (last-match-wins
 * doesn't apply here — patterns are catalogued so collisions are
 * vanishingly rare; if they occur we still produce a safe redacted
 * output).
 */
function redactString(input: string): string {
  const matches = scanForSecrets(input);
  if (matches.length === 0) return input;

  // Resolve overlaps: keep earliest-start, longest-match. Tie-break
  // first by length (longest wins), then by pattern_name (alphabetical)
  // so the kept marker is DETERMINISTIC across runs — Pit Crew M3
  // Reviewer H3 caught that the previous tie-break by length-only
  // could pick either of two equal-length matches non-deterministically
  // depending on V8's sort stability across versions.
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    return a.pattern_name.localeCompare(b.pattern_name);
  });
  const kept: SecretMatch[] = [];
  let cursor = -1;
  for (const m of sorted) {
    if (m.start >= cursor) {
      kept.push(m);
      cursor = m.end;
    }
  }

  let out = '';
  let lastEnd = 0;
  for (const m of kept) {
    out += input.substring(lastEnd, m.start);
    out += `[REDACTED:${m.pattern_name}]`;
    lastEnd = m.end;
  }
  out += input.substring(lastEnd);
  return out;
}
