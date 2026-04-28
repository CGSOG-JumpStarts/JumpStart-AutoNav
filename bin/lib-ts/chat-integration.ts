/**
 * chat-integration.ts — Slack/Teams Chat Integration port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/chat-integration.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `PLATFORMS` (constant array)
 *   - `EVENT_TYPES` (constant array)
 *   - `defaultState()` => ChatIntegrationState
 *   - `loadState(stateFile?)` => ChatIntegrationState
 *   - `saveState(state, stateFile?)` => void
 *   - `configure(platform, options?)` => ConfigureResult
 *   - `queueNotification(eventType, message, options?)` => QueueResult
 *   - `getStatus(options?)` => StatusResult
 *
 * **ADR-012 redaction (NEW in this port).**
 *   Webhooks and notifications can carry secrets in `webhook_url` (e.g.
 *   tokens embedded in URL paths) and `message` payloads (LLM outputs,
 *   error stacks, debug info). All persisted state is run through
 *   `redactSecrets` before write — covering both webhook configuration
 *   and queued notification messages.
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/chat-integration.json`.
 *   - Platform validation: slack/teams only.
 *   - Event types: approval, risk, drift, blocker, phase_change, comment.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/chat-integration.js (legacy reference)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redactSecrets } from './secret-scanner.js';

export type Platform = 'slack' | 'teams';

export type EventType = 'approval' | 'risk' | 'drift' | 'blocker' | 'phase_change' | 'comment';

export interface ChatConfiguration {
  id: string;
  platform: Platform;
  channel: string;
  webhook_url: string | null;
  events: string[];
  enabled: boolean;
  configured_at: string;
}

export interface ChatNotification {
  id: string;
  event_type: string;
  message: string;
  platform: string;
  status: 'queued' | 'sent';
  created_at: string;
  sent_at: string | null;
}

export interface ChatIntegrationState {
  version: string;
  configurations: ChatConfiguration[];
  notifications: ChatNotification[];
  last_updated: string | null;
}

export interface ConfigureOptions {
  stateFile?: string;
  channel?: string;
  webhook_url?: string;
  events?: string[];
}

export interface ConfigureResult {
  success: boolean;
  configuration?: ChatConfiguration;
  error?: string;
}

export interface QueueOptions {
  stateFile?: string;
  platform?: string;
}

export interface QueueResult {
  success: boolean;
  notification?: ChatNotification;
  error?: string;
}

export interface StatusOptions {
  stateFile?: string;
}

export interface StatusResult {
  success: boolean;
  configurations: number;
  active: number;
  notifications_queued: number;
  notifications_sent: number;
  platforms: string[];
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'chat-integration.json');

export const PLATFORMS: Platform[] = ['slack', 'teams'];
export const EVENT_TYPES: EventType[] = [
  'approval',
  'risk',
  'drift',
  'blocker',
  'phase_change',
  'comment',
];

export function defaultState(): ChatIntegrationState {
  return {
    version: '1.0.0',
    configurations: [],
    notifications: [],
    last_updated: null,
  };
}

function _safeParseState(content: string): ChatIntegrationState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  const base = defaultState();
  return {
    ...base,
    ...obj,
    configurations: Array.isArray(obj.configurations)
      ? (obj.configurations as ChatConfiguration[])
      : [],
    notifications: Array.isArray(obj.notifications)
      ? (obj.notifications as ChatNotification[])
      : [],
  };
}

export function loadState(stateFile?: string): ChatIntegrationState {
  const fp = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(fp)) return defaultState();
  const parsed = _safeParseState(readFileSync(fp, 'utf8'));
  return parsed || defaultState();
}

/**
 * Save state. ADR-012: redact every persisted state object before
 * writing — webhook URLs may contain bearer tokens / authentication
 * fragments, and notification messages may embed LLM-derived secrets.
 */
export function saveState(state: ChatIntegrationState, stateFile?: string): void {
  const fp = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  const redacted: ChatIntegrationState = redactSecrets(state);
  writeFileSync(fp, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
}

/** ADR-011-style webhook URL validation for chat integrations.
 *  Same allowlist family as `llm-provider.validateLLMEndpoint`:
 *    - HTTPS-only with no userinfo (rejects `https://attacker.com@trusted.com`)
 *    - http://localhost / 127.0.0.1 / [::1] (dev-mode self-host)
 *  Returns null on success, an error string on rejection.
 *
 *  Pit Crew M5 Adversary: configure() previously stored any
 *  `webhook_url` value verbatim, allowing env-injection-driven
 *  exfiltration (an attacker setting a chat-webhook env var to
 *  `https://attacker.com@trusted-slack.com` would route every
 *  notification through their proxy).
 */
function _validateWebhookUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `webhook_url "${url}" is not a parsable URL.`;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return `webhook_url "${url}" contains userinfo (username/password); embed credentials via headers instead.`;
  }
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1'].includes(host) || host === '[::1]') return null;
  }
  return `webhook_url "${url}" is not HTTPS and not a localhost address.`;
}

/**
 * Configure a chat integration.
 */
export function configure(platform: string, options: ConfigureOptions = {}): ConfigureResult {
  if (!PLATFORMS.includes(platform as Platform)) {
    return {
      success: false,
      error: `Unknown platform: ${platform}. Valid: ${PLATFORMS.join(', ')}`,
    };
  }

  // Validate webhook_url against the allowlist if supplied. Honors
  // `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` override (same env-var as
  // ADR-011 — one knob, two consumers).
  if (options.webhook_url && process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL !== '1') {
    const err = _validateWebhookUrl(options.webhook_url);
    if (err) {
      return { success: false, error: err };
    }
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const config: ChatConfiguration = {
    id: `CHAT-${Date.now()}`,
    platform: platform as Platform,
    channel: options.channel || 'general',
    webhook_url: options.webhook_url || null,
    events: options.events || EVENT_TYPES,
    enabled: true,
    configured_at: new Date().toISOString(),
  };

  state.configurations.push(config);
  saveState(state, stateFile);

  return { success: true, configuration: config };
}

/**
 * Queue a notification. The message body and metadata are redacted via
 * `saveState` before persistence (ADR-012).
 */
export function queueNotification(
  eventType: string,
  message: string,
  options: QueueOptions = {}
): QueueResult {
  if (!EVENT_TYPES.includes(eventType as EventType)) {
    return {
      success: false,
      error: `Unknown event type: ${eventType}. Valid: ${EVENT_TYPES.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const notification: ChatNotification = {
    id: `NOTIF-${Date.now()}`,
    event_type: eventType,
    message,
    platform: options.platform || 'all',
    status: 'queued',
    created_at: new Date().toISOString(),
    sent_at: null,
  };

  state.notifications.push(notification);
  saveState(state, stateFile);

  return { success: true, notification };
}

/**
 * Get integration status.
 */
export function getStatus(options: StatusOptions = {}): StatusResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    configurations: state.configurations.length,
    active: state.configurations.filter((c) => c.enabled).length,
    notifications_queued: state.notifications.filter((n) => n.status === 'queued').length,
    notifications_sent: state.notifications.filter((n) => n.status === 'sent').length,
    platforms: state.configurations.map((c) => c.platform),
  };
}
