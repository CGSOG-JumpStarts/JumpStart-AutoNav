/**
 * install.ts — Marketplace Item Installer port (T4.5.1, M6).
 *
 * Pure-library port of `bin/lib/install.js`. Public surface preserved
 * verbatim by name + signature shape:
 *
 *   - detectIDE / fetchRegistryIndex / normalizeItemId
 *   - findItem / findItemByName / searchItems
 *   - checkCompatibility
 *   - readInstalled / writeInstalled / isInstalled
 *   - downloadAndVerify
 *   - resolveTargetPaths / resolveDependencies
 *   - installItem / installBundle / install
 *   - getStatus / uninstallItem / checkUpdates / updateItems
 *
 * **ADR-010 zipslip prevention (THE security-critical work).**
 *
 *   Legacy used `execSync('unzip -o ...')` with NO pre-extraction
 *   validation. This port replaces that with a hand-rolled ZIP central-
 *   directory reader that enumerates every entry BEFORE writing a single
 *   byte to disk and validates its name through `assertEntryInsideTarget`.
 *   The entire archive is rejected on any escape attempt — no partial
 *   extraction, no cleanup-after-the-fact (which would already have lost
 *   the race against a symlink swap).
 *
 *   Per-entry rejection criteria (atomic abort on ANY violation):
 *     - null byte in fileName
 *     - POSIX absolute path (`/foo`)
 *     - Windows drive letter (`C:foo`) or backslash-prefixed paths
 *     - `..` segments that resolve outside the target dir
 *     - symlink entries (any compression/external-attr signal)
 *     - resolved path falls outside `path.resolve(targetDir) + path.sep`
 *
 *   Zip-bomb defense: total uncompressed size capped at 100MB, per-entry
 *   decompressed size capped at 50MB, total entry count capped at 10,000.
 *
 *   Compression methods: 0 (stored) and 8 (deflate) only. All others
 *   rejected with ValidationError.
 *
 * **ADR-012 redaction.**
 *   `installed.json` carries display names that may contain
 *   token-tainted strings. Every `writeInstalled` call runs the data
 *   through `redactSecrets` before persistence.
 *
 * **JSON shape validation.**
 *   `readInstalled` rejects `__proto__` / `constructor` / `prototype`
 *   keyed JSON, and rejects non-object roots — same posture as the
 *   evidence-collector / collaboration / chat-integration ports.
 *
 * **Deferred to M9 ESM cutover:**
 *   - The CLI entry block at the bottom of legacy install.js (lines
 *     983-1014) is NOT ported. It uses `import.meta.url` which TS
 *     rejects under the strangler-phase CJS classification.
 *   - Framework-version detection: legacy used `import.meta.url` to
 *     locate the package.json. This port uses a static
 *     `FRAMEWORK_VERSION` constant (mirrors any module that needs
 *     version info during the strangler phase).
 *
 * @see bin/lib/install.js (legacy reference)
 * @see specs/decisions/adr-010-marketplace-zipslip-prevention.md
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.5.1
 */

import * as crypto from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadConfig } from './config-loader.js';
import { ValidationError } from './errors.js';
import { applyIntegration } from './integrate.js';
import { assertInsideRoot } from './path-safety.js';
import { redactSecrets } from './secret-scanner.js';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/CGSOG-JumpStarts/JumpStart-Skills/main/registry/index.json';

/**
 * Static framework version — mirror of package.json `version`. The
 * legacy module read this at runtime via `import.meta.url`, which is
 * blocked by the strangler-phase CJS classification (TS1470). At the
 * M9 ESM cutover this becomes a `createRequire`-driven runtime read.
 * Until then, kept in sync with package.json by hand; the contract
 * harness flags drift.
 */
const FRAMEWORK_VERSION = '1.1.14';

const TYPE_INSTALL_DIR: Record<string, string> = {
  skill: 'skills',
  agent: 'agents',
  prompt: 'prompts',
  bundle: 'bundles',
};

const VALID_TYPES = new Set(['skill', 'agent', 'prompt', 'bundle']);

const INSTALLED_FILE = '.jumpstart/installed.json';

// ZIP-extract limits (zip-bomb defense)
const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_PER_ENTRY_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_ENTRY_COUNT = 10_000;

// ZIP record signatures
const SIG_LOCAL_FILE = 0x04034b50;
const SIG_CENTRAL_DIR = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface IDEPaths {
  ide: string;
  agentDir: string;
  promptDir: string;
}

export interface ItemDownload {
  zip?: string;
  checksumSha256?: string;
}

export interface ItemContains {
  agents?: string[];
  prompts?: string[];
}

export interface ItemInstallSpec {
  targetPaths?: string[];
}

export interface ItemCompatibility {
  jumpstartMode?: string;
  tools?: string[];
}

export interface Item {
  id: string;
  type: string;
  version: string;
  displayName?: string;
  description?: string;
  category?: string;
  searchText?: string;
  tags?: string[];
  keywords?: string[];
  download?: ItemDownload;
  install?: ItemInstallSpec;
  contains?: ItemContains;
  compatibility?: ItemCompatibility;
  dependencies?: string[];
  includes?: string[];
  // Allow registry items to carry forward-compatible fields.
  [key: string]: unknown;
}

export interface RegistryIndex {
  items: Item[];
  [key: string]: unknown;
}

export interface InstalledEntry {
  version: string;
  displayName?: string;
  type?: string;
  installedAt: string;
  targetPaths: string[];
  remappedFiles: string[];
  keywords?: string[];
}

export interface InstalledData {
  items: Record<string, InstalledEntry>;
}

export type ProgressFn = (msg: string) => void;

export interface InstallOptions {
  registryUrl?: string;
  projectRoot?: string;
  index?: RegistryIndex;
  force?: boolean;
  dryRun?: boolean;
  skipDeps?: boolean;
  onProgress?: ProgressFn;
}

export interface InstallResult {
  installed: string[];
  fileCount: number;
  item: Item;
  remappedFiles: string[];
  ide?: string;
  skipped?: boolean;
  dryRun?: boolean;
  dependenciesInstalled?: string[];
}

export interface BundleResult {
  bundleId: string;
  installed: Array<InstallResult | { item: { id: string }; error: string }>;
}

export interface DependencyResolution {
  order: string[];
  skipped: string[];
  warnings: string[];
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
}

export interface StatusResult {
  items: Record<string, InstalledEntry>;
  count: number;
}

export interface UninstallResult {
  removed: string[];
  success: boolean;
}

export interface UpdatesResult {
  updates: Array<{ id: string; localVersion: string; registryVersion: string }>;
  upToDate: string[];
}

/**
 * No-op progress callback used as the default when `options.onProgress`
 * is omitted. Hoisted out of the call sites so Biome doesn't flag the
 * inline empty-arrow as `noEmptyBlockStatements`.
 */
const noopProgress: ProgressFn = (_msg: string) => {
  // Intentional no-op default callback.
  void _msg;
};

// ─────────────────────────────────────────────────────────────────────────
// Config Integration
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve the registry URL from (in priority order):
 *   1. options.registryUrl (explicit flag)
 *   2. config.yaml -> skills.registry_url
 *   3. DEFAULT_REGISTRY_URL
 */
async function resolveRegistryUrl(options: InstallOptions = {}): Promise<string> {
  if (options.registryUrl) return options.registryUrl;

  try {
    const root = options.projectRoot || process.cwd();
    const { config } = await loadConfig({ root });
    const skillsCfg = (config as Record<string, unknown> | undefined)?.skills as
      | Record<string, unknown>
      | undefined;
    const registryUrl = skillsCfg?.registry_url;
    if (typeof registryUrl === 'string' && registryUrl.length > 0) {
      return registryUrl;
    }
  } catch {
    // config unavailable — use default
  }

  return DEFAULT_REGISTRY_URL;
}

// ─────────────────────────────────────────────────────────────────────────
// IDE Auto-Detection
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect which IDE/AI assistant is in use and return the canonical
 * directory conventions for agent and prompt files.
 *
 * Heuristic:
 *   - .github/ exists (or .github/copilot-instructions.md or
 *     .github/agents/) -> VS Code + Copilot
 *     -> agents: .github/agents/   prompts: .github/prompts/
 *   - Otherwise -> Claude Code / generic
 *     -> agents: .jumpstart/agents/   prompts: .jumpstart/prompts/
 */
export function detectIDE(projectRoot: string): IDEPaths {
  const hasGitHub = existsSync(path.join(projectRoot, '.github'));
  const hasCopilotInstructions = existsSync(
    path.join(projectRoot, '.github', 'copilot-instructions.md')
  );
  const hasGitHubAgents = existsSync(path.join(projectRoot, '.github', 'agents'));

  if (hasGitHub || hasCopilotInstructions || hasGitHubAgents) {
    return {
      ide: 'vscode-copilot',
      agentDir: '.github/agents',
      promptDir: '.github/prompts',
    };
  }

  return {
    ide: 'generic',
    agentDir: '.jumpstart/agents',
    promptDir: '.jumpstart/prompts',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Registry Fetch
// ─────────────────────────────────────────────────────────────────────────

/**
 * ADR-011-style URL validator for marketplace endpoints. Enforces:
 *   - HTTPS-only, OR http://localhost / 127.0.0.1 / [::1] (dev mode)
 *   - No userinfo (rejects `https://attacker.com@trusted.com`)
 *   - Parsable URL
 *
 * Honors the `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` escape hatch (one
 * knob, three consumers — same env-var as ADR-011's LLM endpoint
 * validator and chat-integration's webhook validator).
 *
 * Throws `ValidationError` on rejection.
 */
function validateMarketplaceUrl(url: string, kind: 'registry' | 'download'): void {
  if (process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL === '1') return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(
      `${kind} URL "${url}" is not a parsable URL.`,
      'marketplace-url-validate',
      []
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ValidationError(
      `${kind} URL "${url}" contains userinfo (username/password); embed credentials via headers instead.`,
      'marketplace-url-validate',
      []
    );
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1'].includes(host) || host === '[::1]') return;
  }
  throw new ValidationError(
    `${kind} URL "${url}" is not HTTPS and not a localhost address.`,
    'marketplace-url-validate',
    []
  );
}

/**
 * Fetch the remote registry index.json. 30-second timeout.
 *
 * Pit Crew M6 Adversary 2: `fetch()` previously followed redirects
 * by default — a registry server returning 302 to an attacker domain
 * would silently exfiltrate the request. Post-fix: `redirect: 'error'`
 * causes any 3xx response to throw rather than follow.
 */
export async function fetchRegistryIndex(registryUrl?: string): Promise<RegistryIndex> {
  const url = registryUrl || DEFAULT_REGISTRY_URL;
  validateMarketplaceUrl(url, 'registry');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { 'User-Agent': `jumpstart-mode/${FRAMEWORK_VERSION}` },
    });

    if (!res.ok) {
      throw new Error(`Registry fetch failed: ${res.status} ${res.statusText} — ${url}`);
    }

    return (await res.json()) as RegistryIndex;
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Item ID Normalization
// ─────────────────────────────────────────────────────────────────────────

/**
 * Normalize user input to a dotted item ID.
 * Supports:
 *   - "skill.ignition"    -> "skill.ignition"   (pass-through)
 *   - "skill", "ignition" -> "skill.ignition"   (type + name)
 *   - "ignition"          -> "ignition"         (single word, resolve later)
 *   - "skill" (alone)     -> null               (ambiguous)
 */
export function normalizeItemId(first: string | undefined, second?: string): string | null {
  if (!first) return null;

  if (first.includes('.')) return first;

  if (second && VALID_TYPES.has(first.toLowerCase())) {
    return `${first.toLowerCase()}.${second}`;
  }

  if (VALID_TYPES.has(first.toLowerCase()) && !second) return null;

  return first;
}

// ─────────────────────────────────────────────────────────────────────────
// Item Lookup
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find an item in the registry index by exact ID.
 */
export function findItem(index: RegistryIndex | null | undefined, itemId: string): Item | null {
  if (!index || !Array.isArray(index.items)) return null;
  return index.items.find((item) => item.id === itemId) || null;
}

/**
 * Find an item by bare name (tries all type prefixes, then displayName).
 */
export function findItemByName(index: RegistryIndex | null | undefined, name: string): Item | null {
  if (!index || !Array.isArray(index.items)) return null;
  const lower = name.toLowerCase();
  const exact = index.items.find((i) => i.id === lower);
  if (exact) return exact;
  for (const type of VALID_TYPES) {
    const item = index.items.find((i) => i.id === `${type}.${lower}`);
    if (item) return item;
  }
  return (
    index.items.find(
      (i) => typeof i.displayName === 'string' && i.displayName.toLowerCase() === lower
    ) || null
  );
}

/**
 * Search the registry for items matching a query string. Scoring:
 *   - exact field match: +10
 *   - prefix match:      +5
 *   - substring match:   +2
 */
export function searchItems(index: RegistryIndex | null | undefined, query: string): Item[] {
  if (!index || !Array.isArray(index.items)) return [];
  const q = query.toLowerCase();
  return index.items
    .map((item) => {
      const fields = [
        item.id,
        item.displayName,
        item.category,
        item.description,
        item.searchText,
        ...(item.tags || []),
        ...(item.keywords || []),
      ]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .map((s) => s.toLowerCase());

      let score = 0;
      for (const f of fields) {
        if (f === q) score += 10;
        else if (f.startsWith(q)) score += 5;
        else if (f.includes(q)) score += 2;
      }
      return { item, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

// ─────────────────────────────────────────────────────────────────────────
// Compatibility Checking
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if an item is compatible with this framework version.
 * Returns warnings (does not block installation).
 */
export function checkCompatibility(item: Item): CompatibilityResult {
  const warnings: string[] = [];
  const compat = item.compatibility || {};

  if (compat.jumpstartMode) {
    const range = compat.jumpstartMode;
    const match = range.match(/^>=\s*(\d+\.\d+\.\d+)$/);
    if (match) {
      const minVersion = match[1];
      if (compareSemver(FRAMEWORK_VERSION, minVersion) < 0) {
        warnings.push(`Requires jumpstart-mode ${range} but found ${FRAMEWORK_VERSION}.`);
      }
    }
  }

  // compat.tools is informational — we can't check tool availability here.

  return { compatible: warnings.length === 0, warnings };
}

/**
 * Compare two semver strings. Returns <0, 0, or >0.
 *
 * Exported for testing — used internally by `checkCompatibility`,
 * `installItem` (dedupe-by-version), and `checkUpdates`.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Install Tracking (with ADR-012 redaction + JSON shape validation)
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively check that no key in the parsed JSON tree is one of
 * `__proto__` / `constructor` / `prototype`. Mirrors the posture in
 * evidence-collector.ts and collaboration.ts.
 */
function hasForbiddenKey(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey(value[key])) return true;
  }
  return false;
}

/**
 * Validate one InstalledEntry value. Pit Crew M6 Reviewer (HIGH):
 * the previous implementation cast `items` to `Record<string,
 * InstalledEntry>` after only checking the top-level `items` was a
 * plain object. A corrupted or attacker-controlled `installed.json`
 * with `targetPaths: [null]` or `targetPaths: 42` then crashed
 * downstream `path.resolve(projectRoot, tp)` with an uncaught
 * `TypeError` (exit 99 — violates ADR-006). Post-fix: every entry is
 * shape-validated; bad entries are dropped silently with default-
 * shape soft-fail semantics consistent with the rest of the safe-
 * parse family.
 */
function isValidInstalledEntry(v: unknown): v is InstalledEntry {
  if (!isPlainObject(v)) return false;
  if (typeof v.version !== 'string') return false;
  if (typeof v.installedAt !== 'string') return false;
  if (!Array.isArray(v.targetPaths)) return false;
  if (v.targetPaths.some((p) => typeof p !== 'string')) return false;
  if (!Array.isArray(v.remappedFiles)) return false;
  if (v.remappedFiles.some((p) => typeof p !== 'string')) return false;
  // Optional fields — only check type if present.
  if (v.displayName !== undefined && typeof v.displayName !== 'string') return false;
  if (v.type !== undefined && typeof v.type !== 'string') return false;
  if (v.keywords !== undefined) {
    if (!Array.isArray(v.keywords)) return false;
    if (v.keywords.some((k) => typeof k !== 'string')) return false;
  }
  return true;
}

function safeParseInstalled(raw: string): InstalledData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (hasForbiddenKey(parsed)) return null;
  const items = (parsed as Record<string, unknown>).items;
  if (items !== undefined && !isPlainObject(items)) return null;

  // Filter to well-formed entries only.
  const validated: Record<string, InstalledEntry> = {};
  if (items) {
    for (const [id, entry] of Object.entries(items)) {
      if (isValidInstalledEntry(entry)) {
        validated[id] = entry;
      }
    }
  }
  return { items: validated };
}

/**
 * Read the local installed-items ledger.
 * Returns `{ items: {} }` on missing, malformed, or shape-invalid file.
 */
export function readInstalled(projectRoot: string): InstalledData {
  const fp = path.join(projectRoot, INSTALLED_FILE);
  if (!existsSync(fp)) return { items: {} };
  const parsed = safeParseInstalled(readFileSync(fp, 'utf8'));
  return parsed ?? { items: {} };
}

/**
 * Write the installed-items ledger. Runs `redactSecrets` over the
 * data before persistence (ADR-012) — display names and target paths
 * are user-visible strings that may carry tokens after a malformed
 * registry entry.
 */
export function writeInstalled(projectRoot: string, data: InstalledData): void {
  const fp = path.join(projectRoot, INSTALLED_FILE);
  mkdirSync(path.dirname(fp), { recursive: true });
  const redacted = redactSecrets(data);
  writeFileSync(fp, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
}

/**
 * Record a successful installation in the local ledger.
 */
function recordInstall(
  projectRoot: string,
  item: Item,
  targetPaths: string[],
  remappedFiles: string[] = []
): void {
  const data = readInstalled(projectRoot);
  data.items[item.id] = {
    version: item.version,
    displayName: item.displayName,
    type: item.type,
    installedAt: new Date().toISOString(),
    targetPaths,
    remappedFiles,
    keywords: [...(item.keywords || []), ...(item.tags || [])].filter(
      (v, i, a) => a.indexOf(v) === i
    ),
  };
  writeInstalled(projectRoot, data);
}

/**
 * Check if an item is installed. Returns the entry or null.
 */
export function isInstalled(itemId: string, projectRoot: string): InstalledEntry | null {
  const data = readInstalled(projectRoot);
  return data.items[itemId] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// Download & Verify
// ─────────────────────────────────────────────────────────────────────────

/**
 * Download a zip file and verify its SHA256 checksum.
 *
 * Pit Crew M6 Adversary 2 (BLOCKER): three hardenings landed here:
 *   1. `redirect: 'error'` on the fetch — a compromised registry can
 *      no longer 302-redirect the download to an attacker domain.
 *   2. `validateMarketplaceUrl(downloadUrl, 'download')` enforces
 *      HTTPS-only (or localhost) and rejects userinfo confusion.
 *   3. `expectedSha256` is now REQUIRED. The legacy/pre-fix path
 *      treated the checksum as optional, so a registry serving an
 *      item with `download.checksumSha256` omitted would download
 *      anything and accept it. Callers MUST supply a checksum; the
 *      `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` env override (matches
 *      registry-URL validation) lets dev/test paths bypass the
 *      requirement.
 *
 * Throws `ValidationError` (exit code 2) on checksum mismatch, missing
 * checksum, redirect, or non-allowlisted URL.
 */
export async function downloadAndVerify(
  downloadUrl: string,
  expectedSha256?: string
): Promise<string> {
  validateMarketplaceUrl(downloadUrl, 'download');

  // Checksum is mandatory unless explicitly bypassed.
  if (!expectedSha256 && process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL !== '1') {
    throw new ValidationError(
      `Download "${downloadUrl}" requires a SHA-256 checksum (registry item missing "download.checksumSha256"). Set JUMPSTART_ALLOW_INSECURE_LLM_URL=1 to bypass for local dev.`,
      'marketplace-download-verify',
      []
    );
  }

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'jumpstart-install-'));
  const tmpFile = path.join(tmpDir, 'package.zip');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(downloadUrl, {
      signal: controller.signal,
      redirect: 'error',
      headers: { 'User-Agent': `jumpstart-mode/${FRAMEWORK_VERSION}` },
    });

    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText} — ${downloadUrl}`);
    }

    const hash = crypto.createHash('sha256');
    const fileStream = createWriteStream(tmpFile);
    if (!res.body) {
      throw new Error(`Download produced no body — ${downloadUrl}`);
    }
    const reader = res.body.getReader();
    let done = false;

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        hash.update(value);
        fileStream.write(Buffer.from(value));
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve());
      fileStream.on('error', reject);
    });

    const actualHash = hash.digest('hex');
    if (expectedSha256 && actualHash !== expectedSha256) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw new ValidationError(
        `Checksum mismatch!\n  Expected: ${expectedSha256}\n  Actual:   ${actualHash}\n  File may be corrupted or tampered with.`,
        'marketplace-download-verify',
        []
      );
    }

    return tmpFile;
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-010 zipslip-prevention helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reject any entry name that escapes `targetDir` lexically. The check
 * mirrors ADR-010 verbatim: resolve both sides, ensure the entry stays
 * inside `targetDir + path.sep`, allow `entry === targetDir` (the root
 * itself, which legitimate ZIPs can encode as an empty-name entry).
 *
 * Returns the resolved absolute path on success; throws ValidationError
 * on any escape attempt.
 */
function assertEntryInsideTarget(entryName: string, targetDir: string): string {
  const resolvedTarget = path.resolve(targetDir);
  const targetWithSep = resolvedTarget + path.sep;
  // On POSIX hosts a backslash is a regular filename character, but a
  // ZIP authored on Windows could encode `..\..\..\etc\passwd`. Convert
  // backslashes to forward-slashes before resolving so the same input
  // is rejected uniformly across platforms.
  const normalized = entryName.replace(/\\/g, '/');
  const resolvedEntry = path.resolve(targetDir, normalized);

  const inside = resolvedEntry === resolvedTarget || resolvedEntry.startsWith(targetWithSep);

  if (!inside) {
    throw new ValidationError(
      `Archive entry "${entryName}" resolves outside target directory "${targetDir}". Extraction aborted.`,
      'marketplace-zip-extract',
      []
    );
  }

  return resolvedEntry;
}

interface ZipEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  externalAttrs: number;
  isSymlink: boolean;
}

/**
 * Locate the End-of-Central-Directory record. Per the PKZIP spec, the
 * EOCD lives in the last ~64KB of the file (the comment field is
 * variable-length but capped at 65535 bytes). Scan backward from the
 * end of the buffer.
 */
function findEOCD(buf: Buffer): number {
  const minEOCD = 22;
  const maxScan = Math.min(buf.length, 65535 + minEOCD);
  for (let i = buf.length - minEOCD; i >= buf.length - maxScan && i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      return i;
    }
  }
  throw new ValidationError(
    'ZIP archive has no End-of-Central-Directory record (truncated or not a ZIP).',
    'marketplace-zip-extract',
    []
  );
}

/**
 * Parse the central directory and return an array of entries with all
 * fields needed for safe extraction. ZIP64 fixups applied where the
 * 32-bit fields are 0xFFFFFFFF / 0xFFFF.
 */
function parseCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocdOffset = findEOCD(buf);

  let totalRecords = buf.readUInt16LE(eocdOffset + 10);
  let cdSize = buf.readUInt32LE(eocdOffset + 12);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  if (totalRecords === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset >= 0 && buf.readUInt32LE(locatorOffset) === SIG_EOCD64_LOCATOR) {
      const eocd64Offset = Number(buf.readBigUInt64LE(locatorOffset + 8));
      if (eocd64Offset >= 0 && buf.readUInt32LE(eocd64Offset) === SIG_EOCD64) {
        totalRecords = Number(buf.readBigUInt64LE(eocd64Offset + 32));
        cdSize = Number(buf.readBigUInt64LE(eocd64Offset + 40));
        cdOffset = Number(buf.readBigUInt64LE(eocd64Offset + 48));
      }
    }
  }

  if (totalRecords > MAX_ENTRY_COUNT) {
    throw new ValidationError(
      `ZIP archive contains ${totalRecords} entries (max ${MAX_ENTRY_COUNT}). Rejected as zip-bomb.`,
      'marketplace-zip-extract',
      []
    );
  }

  const entries: ZipEntry[] = [];
  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;

  for (let i = 0; i < totalRecords; i++) {
    if (cursor + 46 > buf.length || cursor + 46 > cdEnd) {
      throw new ValidationError(
        'ZIP central directory entry extends past archive bounds.',
        'marketplace-zip-extract',
        []
      );
    }
    if (buf.readUInt32LE(cursor) !== SIG_CENTRAL_DIR) {
      throw new ValidationError(
        `ZIP central directory entry ${i} has invalid signature.`,
        'marketplace-zip-extract',
        []
      );
    }

    // Pre-fix used `versionMadeBy >> 8` (host byte) to gate symlink
    // detection. Post-fix detection no longer depends on it; we parse
    // and discard for offset alignment.
    const _versionMadeBy = buf.readUInt16LE(cursor + 4);
    void _versionMadeBy;
    const compressionMethod = buf.readUInt16LE(cursor + 10);
    let compressedSize = buf.readUInt32LE(cursor + 20);
    let uncompressedSize = buf.readUInt32LE(cursor + 24);
    const fileNameLength = buf.readUInt16LE(cursor + 28);
    const extraFieldLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const externalAttrs = buf.readUInt32LE(cursor + 38);
    let localHeaderOffset = buf.readUInt32LE(cursor + 42);

    const fileName = buf.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');

    const extraStart = cursor + 46 + fileNameLength;
    const extraEnd = extraStart + extraFieldLength;
    let extraCursor = extraStart;
    while (extraCursor + 4 <= extraEnd) {
      const headerId = buf.readUInt16LE(extraCursor);
      const dataSize = buf.readUInt16LE(extraCursor + 2);
      if (headerId === 0x0001) {
        let zip64Cursor = extraCursor + 4;
        if (uncompressedSize === 0xffffffff && zip64Cursor + 8 <= extraEnd) {
          uncompressedSize = Number(buf.readBigUInt64LE(zip64Cursor));
          zip64Cursor += 8;
        }
        if (compressedSize === 0xffffffff && zip64Cursor + 8 <= extraEnd) {
          compressedSize = Number(buf.readBigUInt64LE(zip64Cursor));
          zip64Cursor += 8;
        }
        if (localHeaderOffset === 0xffffffff && zip64Cursor + 8 <= extraEnd) {
          localHeaderOffset = Number(buf.readBigUInt64LE(zip64Cursor));
          zip64Cursor += 8;
        }
      }
      extraCursor += 4 + dataSize;
    }

    // Symlink detection. Pit Crew M6 BLOCKER (Adversary): the previous
    // gate fired only when `versionMadeBy >> 8 === 3` (UNIX host byte).
    // A ZIP authored with any other host byte (MS-DOS = 0, NTFS = 10,
    // VFAT = 14, OS X via Info-ZIP = 19) carrying S_IFLNK file-type bits
    // bypassed the check. Defense-in-depth: inspect the unix-mode high
    // 16 bits regardless of host byte. The S_IFLNK file-type nibble
    // (`0xA000`) is the strongest signal a ZIP can carry that an entry
    // is intended as a symlink. Legitimate non-UNIX-authored archives
    // do not encode `0xA000` in their high attrs, so the false-positive
    // rate is negligible. (`versionMadeBy` is no longer consulted; we
    // keep parsing it because the field is fixed-offset and skipping
    // would mis-align downstream offsets.)
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    const fileType = unixMode & 0xf000;
    const isSymlink = fileType === 0xa000;

    entries.push({
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      externalAttrs,
      isSymlink,
    });

    cursor += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

/**
 * Read the file data for a single ZIP entry. Looks up the local file
 * header (which may have its own variable-length filename + extra
 * field), then decompresses the payload.
 */
function readEntryData(buf: Buffer, entry: ZipEntry): Buffer {
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > buf.length) {
    throw new ValidationError(
      `ZIP local header for "${entry.fileName}" extends past archive bounds.`,
      'marketplace-zip-extract',
      []
    );
  }
  if (buf.readUInt32LE(localOffset) !== SIG_LOCAL_FILE) {
    throw new ValidationError(
      `ZIP local header for "${entry.fileName}" has invalid signature.`,
      'marketplace-zip-extract',
      []
    );
  }

  const localFileNameLength = buf.readUInt16LE(localOffset + 26);
  const localExtraFieldLength = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localFileNameLength + localExtraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > buf.length) {
    throw new ValidationError(
      `ZIP entry "${entry.fileName}" data extends past archive bounds.`,
      'marketplace-zip-extract',
      []
    );
  }
  if (entry.uncompressedSize > MAX_PER_ENTRY_BYTES) {
    throw new ValidationError(
      `ZIP entry "${entry.fileName}" uncompressed size ${entry.uncompressedSize} exceeds per-entry cap ${MAX_PER_ENTRY_BYTES}. Rejected as zip-bomb.`,
      'marketplace-zip-extract',
      []
    );
  }

  const compressed = buf.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (entry.compressionMethod === 8) {
    const out = inflateRawSync(compressed);
    if (out.length > MAX_PER_ENTRY_BYTES) {
      throw new ValidationError(
        `ZIP entry "${entry.fileName}" decompressed size exceeds per-entry cap. Rejected as zip-bomb.`,
        'marketplace-zip-extract',
        []
      );
    }
    return out;
  }

  throw new ValidationError(
    `ZIP entry "${entry.fileName}" uses unsupported compression method ${entry.compressionMethod}. Only stored (0) and deflate (8) are accepted.`,
    'marketplace-zip-extract',
    []
  );
}

/**
 * Validate every entry name BEFORE writing a single byte. Throws on any
 * violation; the caller treats this as atomic abort with no partial
 * extraction.
 */
function validateEntryName(entryName: string, targetDir: string): void {
  // 1. Null byte (U+0000). Pulled via String.fromCharCode so editors /
  //    hooks / patches can't accidentally strip it from source.
  const NULL_BYTE = String.fromCharCode(0);
  if (entryName.includes(NULL_BYTE)) {
    throw new ValidationError(
      `Archive entry contains a null byte. Extraction aborted.`,
      'marketplace-zip-extract',
      []
    );
  }
  // 2. POSIX absolute
  if (entryName.startsWith('/')) {
    throw new ValidationError(
      `Archive entry "${entryName}" is an absolute POSIX path. Extraction aborted.`,
      'marketplace-zip-extract',
      []
    );
  }
  // 3. Windows drive letter / backslash-prefixed absolute
  if (/^[A-Za-z]:/.test(entryName) || entryName.startsWith('\\')) {
    throw new ValidationError(
      `Archive entry "${entryName}" is an absolute Windows path. Extraction aborted.`,
      'marketplace-zip-extract',
      []
    );
  }
  // 4. Lexical containment (catches `..` traversal as well).
  assertEntryInsideTarget(entryName, targetDir);
}

/**
 * Hand-rolled ZIP extractor with ADR-010 zipslip prevention.
 *
 * Reads the entire ZIP into memory (skill ZIPs are bounded at 100MB
 * uncompressed; compressed sizes are well below that), parses the
 * central directory, validates every entry name BEFORE writing any
 * file, then extracts entries that pass validation.
 *
 * Atomic abort semantics: any per-entry validation failure throws
 * ValidationError without writing anything. The caller (which already
 * created `targetDir` as an empty fresh tmpdir) is responsible for
 * tearing down on failure.
 */
function extractZipSafely(zipPath: string, targetDir: string): void {
  const buf = readFileSync(zipPath);
  const entries = parseCentralDirectory(buf);

  // Pass 1: name + symlink + size validation (no writes).
  let totalUncompressed = 0;
  for (const entry of entries) {
    if (entry.isSymlink) {
      throw new ValidationError(
        `Archive entry "${entry.fileName}" is a symlink. Symlinks are not allowed; extraction aborted.`,
        'marketplace-zip-extract',
        []
      );
    }
    validateEntryName(entry.fileName, targetDir);
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ValidationError(
        `ZIP archive total uncompressed size exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes. Rejected as zip-bomb.`,
        'marketplace-zip-extract',
        []
      );
    }
  }

  // Pass 2: extract. Path validation already passed, but we still
  // re-resolve through assertEntryInsideTarget at write time as
  // defense in depth.
  for (const entry of entries) {
    const safePath = assertEntryInsideTarget(entry.fileName, targetDir);

    if (entry.fileName.endsWith('/') || entry.fileName.endsWith('\\')) {
      mkdirSync(safePath, { recursive: true });
      continue;
    }

    mkdirSync(path.dirname(safePath), { recursive: true });
    const data = readEntryData(buf, entry);
    if (data.length !== entry.uncompressedSize && entry.compressionMethod === 0) {
      throw new ValidationError(
        `ZIP entry "${entry.fileName}" stored size mismatch (header ${entry.uncompressedSize}, payload ${data.length}).`,
        'marketplace-zip-extract',
        []
      );
    }
    writeFileSync(safePath, data);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Extraction & File Remapping
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract a verified ZIP into a temporary staging directory. Replaces
 * legacy's `unzip`/PowerShell `Expand-Archive` with the hand-rolled,
 * ADR-010-hardened extractor.
 */
function extractToStaging(zipPath: string): string {
  const stagingDir = mkdtempSync(path.join(os.tmpdir(), 'jumpstart-stage-'));
  try {
    extractZipSafely(zipPath, stagingDir);
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true });
    if (err instanceof ValidationError) throw err;
    throw new Error(`Extraction failed: ${(err as Error).message}`);
  }
  return stagingDir;
}

/**
 * Walk a directory recursively, returning all file paths relative to
 * the original root.
 */
function walkDir(dir: string, root: string = dir): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full, root));
    } else {
      files.push(path.relative(root, full));
    }
  }
  return files;
}

interface InstallFromStagingResult {
  extracted: string[];
  fileCount: number;
  remappedFiles: string[];
}

/**
 * Copy the extracted staging directory to each primary target path,
 * then remap declared agent/prompt files to the IDE-canonical
 * directories.
 */
function installFromStaging(
  stagingDir: string,
  targetPaths: string[],
  projectRoot: string,
  item: Item,
  idePaths: IDEPaths
): InstallFromStagingResult {
  const extracted: string[] = [];
  const remappedFiles: string[] = [];
  let fileCount = 0;

  let contentRoot = stagingDir;
  const stagingEntries = readdirSync(stagingDir, { withFileTypes: true });
  if (stagingEntries.length === 1 && stagingEntries[0].isDirectory()) {
    contentRoot = path.join(stagingDir, stagingEntries[0].name);
  }

  for (const targetRel of targetPaths) {
    // Pit Crew M6 BLOCKER (Reviewer + Adversary): registry-supplied
    // `item.install.targetPaths` was previously taken verbatim,
    // bypassing every ADR-010 guard once the ZIP was extracted to
    // staging — a malicious registry entry with
    // `targetPaths: ["../../.ssh/authorized_keys"]` would `cpSync`
    // the staged contents to the user's home directory. Gate every
    // target through `assertInsideRoot`.
    assertInsideRoot(targetRel, projectRoot);
    const targetAbs = path.resolve(projectRoot, targetRel);
    mkdirSync(targetAbs, { recursive: true });
    cpSync(contentRoot, targetAbs, { recursive: true, force: true });

    const files = walkDir(targetAbs);
    fileCount += files.length;
    extracted.push(targetAbs);
  }

  const contains = item.contains || {};

  if (Array.isArray(contains.agents)) {
    const destDir = path.resolve(projectRoot, idePaths.agentDir);
    mkdirSync(destDir, { recursive: true });

    for (const agentRelPath of contains.agents) {
      const primaryTarget = extracted[0];
      if (!primaryTarget) continue;

      // Pit Crew M6 HIGH: `agentRelPath` is registry-supplied. Without
      // a containment check, `path.join(primaryTarget, '../../etc/shadow')`
      // would copy arbitrary host files into the IDE agent directory.
      // `assertInsideRoot` rejects any path that escapes the staging
      // primary-target root.
      assertInsideRoot(agentRelPath, primaryTarget);
      const srcFile = path.join(primaryTarget, agentRelPath);
      if (!existsSync(srcFile)) continue;

      const basename = path.basename(agentRelPath);
      const destFile = path.join(destDir, basename);
      copyFileSync(srcFile, destFile);
      remappedFiles.push(path.relative(projectRoot, destFile));
    }
  }

  if (Array.isArray(contains.prompts)) {
    const destDir = path.resolve(projectRoot, idePaths.promptDir);
    mkdirSync(destDir, { recursive: true });

    for (const promptRelPath of contains.prompts) {
      const primaryTarget = extracted[0];
      if (!primaryTarget) continue;

      // Pit Crew M6 HIGH: same defense as `contains.agents` above.
      assertInsideRoot(promptRelPath, primaryTarget);
      const srcFile = path.join(primaryTarget, promptRelPath);
      if (!existsSync(srcFile)) continue;

      const basename = path.basename(promptRelPath);
      const destFile = path.join(destDir, basename);
      copyFileSync(srcFile, destFile);
      remappedFiles.push(path.relative(projectRoot, destFile));
    }
  }

  return { extracted, fileCount, remappedFiles };
}

// ─────────────────────────────────────────────────────────────────────────
// Target Path Resolution
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve install target paths for an item. Uses `item.install.targetPaths`
 * if present, otherwise derives from type + name.
 */
export function resolveTargetPaths(item: Item): string[] {
  if (
    item.install &&
    Array.isArray(item.install.targetPaths) &&
    item.install.targetPaths.length > 0
  ) {
    return item.install.targetPaths;
  }

  const typeDir = TYPE_INSTALL_DIR[item.type] || 'skills';
  const name = item.id.split('.').slice(1).join('.');
  return [`.jumpstart/${typeDir}/${name}`];
}

// ─────────────────────────────────────────────────────────────────────────
// Dependency Resolution
// ─────────────────────────────────────────────────────────────────────────

export interface ResolveDependenciesOptions {
  force?: boolean;
}

/**
 * Build a topologically-sorted install order including all transitive
 * dependencies. Detects and rejects circular dependency chains.
 */
export function resolveDependencies(
  rootId: string,
  index: RegistryIndex,
  projectRoot: string,
  opts: ResolveDependenciesOptions = {}
): DependencyResolution {
  const force = opts.force || false;
  const order: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(itemId: string): void {
    if (visited.has(itemId)) return;
    if (visiting.has(itemId)) {
      warnings.push(`Circular dependency detected: ${itemId}`);
      return;
    }

    visiting.add(itemId);

    const item = findItem(index, itemId);
    if (!item) {
      warnings.push(`Dependency "${itemId}" not found in registry — skipping.`);
      visiting.delete(itemId);
      visited.add(itemId);
      return;
    }

    const deps = item.dependencies || [];
    for (const depId of deps) {
      visit(depId);
    }

    visiting.delete(itemId);
    visited.add(itemId);

    if (!force && isInstalled(itemId, projectRoot)) {
      skipped.push(itemId);
    } else {
      order.push(itemId);
    }
  }

  visit(rootId);
  return { order, skipped, warnings };
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────

/**
 * Install a single marketplace item by ID.
 */
export async function installItem(
  itemId: string,
  options: InstallOptions = {}
): Promise<InstallResult> {
  const registryUrl = await resolveRegistryUrl(options);
  const projectRoot = options.projectRoot || process.cwd();
  const force = options.force || false;
  const dryRun = options.dryRun || false;
  const progress: ProgressFn = options.onProgress ?? noopProgress;
  const index = options.index || (await fetchRegistryIndex(registryUrl));

  const item = findItem(index, itemId);
  if (!item) {
    const byName = findItemByName(index, itemId);
    if (byName) {
      return installItem(byName.id, { ...options, index });
    }
    throw new Error(
      `Item "${itemId}" not found in registry.\n` +
        `  Registry: ${registryUrl}\n` +
        `  Hint: try  jumpstart-mode install --search ${itemId}`
    );
  }

  if (!force) {
    const existing = isInstalled(item.id, projectRoot);
    if (existing && compareSemver(existing.version, item.version) >= 0) {
      progress(`${item.id} v${existing.version} is already installed — skipping.`);
      return {
        installed: existing.targetPaths || [],
        fileCount: 0,
        item,
        remappedFiles: existing.remappedFiles || [],
        skipped: true,
      };
    }
  }

  const compat = checkCompatibility(item);
  for (const w of compat.warnings) progress(`⚠ ${w}`);

  if (!item.download?.zip) {
    throw new Error(`Item "${itemId}" has no download URL. It may not be packaged yet.`);
  }

  if (dryRun) {
    const targetPaths = resolveTargetPaths(item);
    const ide = detectIDE(projectRoot);
    return {
      installed: targetPaths,
      fileCount: 0,
      item,
      remappedFiles: [],
      dryRun: true,
      ide: ide.ide,
    };
  }

  progress(`Downloading ${item.id} v${item.version}...`);
  const zipPath = await downloadAndVerify(item.download.zip, item.download.checksumSha256);

  let result: InstallResult;
  try {
    progress('Verifying checksum & extracting...');
    const stagingDir = extractToStaging(zipPath);

    try {
      const targetPaths = resolveTargetPaths(item);
      const ide = detectIDE(projectRoot);

      const staged = installFromStaging(stagingDir, targetPaths, projectRoot, item, ide);
      result = {
        installed: staged.extracted,
        fileCount: staged.fileCount,
        item,
        remappedFiles: staged.remappedFiles,
        ide: ide.ide,
      };

      recordInstall(projectRoot, item, targetPaths, result.remappedFiles);

      progress(`✓ Installed ${item.id} v${item.version}`);
      if (result.remappedFiles.length > 0) {
        progress(`  Remapped ${result.remappedFiles.length} file(s) to ${ide.agentDir}`);
      }

      try {
        if (item.type === 'skill' || item.type === 'bundle') {
          progress('Rebuilding skill integration...');
          applyIntegration(projectRoot, { onProgress: progress });
        }
      } catch (err) {
        progress(`⚠ Integration update failed (non-fatal): ${(err as Error).message}`);
      }
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  } finally {
    try {
      rmSync(path.dirname(zipPath), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  return result;
}

/**
 * Install a bundle and all its member items.
 */
export async function installBundle(
  bundleId: string,
  options: InstallOptions = {}
): Promise<BundleResult> {
  const registryUrl = await resolveRegistryUrl(options);
  const index = options.index || (await fetchRegistryIndex(registryUrl));

  const bundle = findItem(index, bundleId);
  if (!bundle) throw new Error(`Bundle "${bundleId}" not found in registry.`);
  if (bundle.type !== 'bundle') {
    throw new Error(`"${bundleId}" is a ${bundle.type}, not a bundle.`);
  }

  const includes = bundle.includes || [];
  if (includes.length === 0) {
    const result = await installItem(bundleId, { ...options, index });
    return { bundleId, installed: [result] };
  }

  const installed: BundleResult['installed'] = [];
  for (const memberId of includes) {
    try {
      const result = await installItem(memberId, { ...options, index });
      installed.push(result);
    } catch (err) {
      installed.push({ item: { id: memberId }, error: (err as Error).message });
    }
  }

  return { bundleId, installed };
}

/**
 * Top-level install dispatcher. Resolves bundles, dependency graphs,
 * and bare-name lookups before delegating to `installItem`.
 */
export async function install(
  itemId: string,
  options: InstallOptions = {}
): Promise<InstallResult | BundleResult> {
  const registryUrl = await resolveRegistryUrl(options);
  const projectRoot = options.projectRoot || process.cwd();
  const index = options.index || (await fetchRegistryIndex(registryUrl));
  const progress: ProgressFn = options.onProgress ?? noopProgress;

  let item = findItem(index, itemId);
  if (!item) item = findItemByName(index, itemId);
  if (!item) {
    throw new Error(
      `Item "${itemId}" not found in registry.\n` +
        `  Hint: try  jumpstart-mode install --search ${itemId}`
    );
  }

  if (item.type === 'bundle') {
    return installBundle(item.id, { ...options, index, registryUrl });
  }

  if (!options.skipDeps) {
    const { order, skipped, warnings } = resolveDependencies(item.id, index, projectRoot, {
      force: options.force,
    });

    for (const w of warnings) progress(`⚠ ${w}`);
    for (const s of skipped) progress(`  ${s} already installed — skipping.`);

    const allResults: InstallResult[] = [];
    for (const depId of order) {
      const result = await installItem(depId, {
        ...options,
        index,
        registryUrl,
        skipDeps: true,
      });
      allResults.push(result);
    }

    const primaryResult =
      allResults.find((r) => r.item?.id === item.id) || allResults[allResults.length - 1];
    if (primaryResult && allResults.length > 1) {
      primaryResult.dependenciesInstalled = allResults
        .filter((r) => r.item?.id !== item.id)
        .map((r) => r.item?.id)
        .filter((id): id is string => typeof id === 'string');
    }
    return primaryResult;
  }

  return installItem(item.id, { ...options, index, registryUrl });
}

// ─────────────────────────────────────────────────────────────────────────
// Lifecycle: Status / Uninstall / Update
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the status of all installed marketplace items.
 */
export function getStatus(projectRoot: string): StatusResult {
  const data = readInstalled(projectRoot);
  const items = data.items || {};
  return { items, count: Object.keys(items).length };
}

/**
 * Uninstall a marketplace item and its remapped files.
 */
export function uninstallItem(itemId: string, projectRoot: string): UninstallResult {
  const data = readInstalled(projectRoot);
  const entry = data.items[itemId];
  if (!entry) {
    throw new Error(`"${itemId}" is not installed.`);
  }

  const removed: string[] = [];

  // Pit Crew M6 BLOCKER (Reviewer) + Adversary 5: paths in
  // `installed.json` are registry-derived. A tampered ledger or a
  // ledger written from a malicious install (pre-fix) would let
  // `uninstallItem` `rmSync` arbitrary host paths. Gate every entry
  // through `assertInsideRoot` — any escape attempt aborts the
  // uninstall (consistent with atomic semantics).
  for (const tp of entry.targetPaths || []) {
    assertInsideRoot(tp, projectRoot);
    const abs = path.resolve(projectRoot, tp);
    if (existsSync(abs)) {
      rmSync(abs, { recursive: true, force: true });
      removed.push(tp);
    }
  }

  for (const rf of entry.remappedFiles || []) {
    assertInsideRoot(rf, projectRoot);
    const abs = path.resolve(projectRoot, rf);
    if (existsSync(abs)) {
      rmSync(abs, { force: true });
      removed.push(rf);
    }
  }

  const wasSkill = entry.type === 'skill' || entry.type === 'bundle';
  delete data.items[itemId];
  writeInstalled(projectRoot, data);

  if (wasSkill) {
    try {
      applyIntegration(projectRoot);
    } catch {
      // non-fatal
    }
  }

  return { removed, success: true };
}

/**
 * Compare local vs registry versions for every installed item.
 */
export function checkUpdates(projectRoot: string, index: RegistryIndex): UpdatesResult {
  const data = readInstalled(projectRoot);
  const updates: UpdatesResult['updates'] = [];
  const upToDate: string[] = [];

  for (const [id, entry] of Object.entries(data.items || {})) {
    const registryItem = findItem(index, id);
    if (!registryItem) continue;
    if (compareSemver(registryItem.version, entry.version) > 0) {
      updates.push({
        id,
        localVersion: entry.version,
        registryVersion: registryItem.version,
      });
    } else {
      upToDate.push(id);
    }
  }

  return { updates, upToDate };
}

/**
 * Update one or all installed items to the latest registry version.
 */
export async function updateItems(
  itemId: string | null,
  options: InstallOptions = {}
): Promise<InstallResult[]> {
  const registryUrl = await resolveRegistryUrl(options);
  const index = options.index || (await fetchRegistryIndex(registryUrl));
  const progress: ProgressFn = options.onProgress ?? noopProgress;

  const projectRoot = options.projectRoot || process.cwd();
  const { updates } = checkUpdates(projectRoot, index);
  const toUpdate = itemId ? updates.filter((u) => u.id === itemId) : updates;

  if (toUpdate.length === 0) {
    progress('Everything is up to date.');
    return [];
  }

  const results: InstallResult[] = [];
  for (const u of toUpdate) {
    progress(`Updating ${u.id}: ${u.localVersion} → ${u.registryVersion}`);
    const result = await installItem(u.id, {
      ...options,
      index,
      registryUrl,
      force: true,
    });
    results.push(result);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Test-only hatch
// ─────────────────────────────────────────────────────────────────────────
//
// `extractZipSafely` is the load-bearing security boundary; the only
// legitimate public caller is `installItem`, which runs the extractor
// through download + checksum + stage. The ADR-010 fixture tests in
// `tests/test-install.test.ts` need to drive the extractor directly
// (without a network round-trip) to assert per-fixture rejection
// behavior. We expose it under a `_TEST_ONLY` suffix so:
//   - intent is unambiguous to anyone reading the export list,
//   - `check-public-any.mjs` and `extract-public-surface.mjs` can be
//     filtered to ignore symbols matching this naming convention if we
//     want to stop them from contributing to the public API contract,
//   - the sibling .d.mts emit shows the symbol explicitly so downstream
//     auditors don't confuse it with a stable API.
//
// At M9 ESM cutover this hatch is the right place to either re-package
// the extractor as a real public helper (under a name like
// `extractMarketplaceZip`) or to delete the hatch and rely on a
// fixture-driven `installItem` test that uses a `file://` registry.
// Until then, this stays the cleanest minimal surface.

/** @internal Test-only re-export of the ZIP extractor. Do not call from production code. */
export const _extractZipSafely_TEST_ONLY = extractZipSafely;
