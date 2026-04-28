/**
 * test-m5-pitcrew-regressions.test.ts — M5 Pit Crew remediation pins.
 *
 * Pins every confirmed-exploit and parity-divergence finding from the
 * M5 Pit Crew round (Reviewer + QA + Adversary) so a future refactor
 * cannot silently re-open them.
 *
 * Findings covered:
 *   - Reviewer (HIGH): evidence-collector.ts persisted state + audit
 *     manifest without ADR-012 redactSecrets — bearer tokens / API
 *     keys captured in tool-call payloads, CLI invocations, or config
 *     snapshots could leak through audit trails.
 *   - Adversary (BLOCKER): chat-integration.ts stored webhook_url
 *     verbatim. An attacker controlling the chat-webhook env var
 *     could set `https://attacker.com@trusted-slack.com` (URL
 *     userinfo confusion) and route every notification through their
 *     proxy. ADR-011 endpoint allowlist family was missing here.
 *
 * @see specs/implementation-plan.md §Deviation Log (M5 entries)
 * @see specs/decisions/adr-011-llm-endpoint-allowlist.md
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configure as configureChat, queueNotification } from '../bin/lib-ts/chat-integration.js';
import {
  collectEvidence,
  packageEvidence,
  saveState as saveEvidenceState,
} from '../bin/lib-ts/evidence-collector.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'm5-pit-'));
  mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  mkdirSync(path.join(tmpDir, '.jumpstart', 'evidence'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL;
});

// ─────────────────────────────────────────────────────────────────────────
// Reviewer (HIGH) — evidence-collector ADR-012 redaction wiring
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M5 Reviewer (HIGH) — evidence-collector redacts secrets', () => {
  it('saveState redacts GitHub PAT embedded in evidence-item source path', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'evidence.json');
    const fakeToken = `ghp_${'A'.repeat(36)}`;
    saveEvidenceState(
      {
        version: '1.0.0',
        created_at: new Date().toISOString(),
        last_updated: null,
        collections: [],
        evidence_items: [
          {
            type: 'audit-logs',
            source: `tool_call:fetch token=${fakeToken}`,
            collected_at: new Date().toISOString(),
          },
        ],
      },
      statePath
    );
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).not.toContain(fakeToken);
    expect(raw).toContain('[REDACTED:GitHub Token]');
  });

  it('saveState redacts AWS access keys in nested evidence metadata', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'evidence.json');
    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    saveEvidenceState(
      {
        version: '1.0.0',
        created_at: new Date().toISOString(),
        last_updated: null,
        collections: [],
        evidence_items: [
          {
            type: 'security-scans',
            // Embed the key in `source` — redactSecrets walks every
            // string field. Use a space separator so the AWS Access
            // Key negative-lookbehind `(?<![A-Za-z0-9/+=])` matches.
            source: `cli aws s3 ls leaked ${awsKey} from logs`,
            collected_at: new Date().toISOString(),
          },
        ],
      },
      statePath
    );
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).not.toContain(awsKey);
    expect(raw).toContain('[REDACTED:AWS Access Key]');
  });

  it('packageEvidence redacts secrets in audit-manifest.json', () => {
    // Seed an evidence-state file containing a secret-tainted item via
    // saveState (which itself redacts), but bypass redaction by writing
    // raw JSON so packageEvidence has live secrets to scrub.
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'evidence.json');
    const slackToken = `xoxb-${'1'.repeat(11)}-${'2'.repeat(11)}-${'A'.repeat(24)}`;
    const rawState = {
      version: '1.0.0',
      created_at: new Date().toISOString(),
      last_updated: null,
      collections: [
        {
          id: 'ev-1',
          collected_at: new Date().toISOString(),
          items_count: 1,
          types: ['audit-logs'],
        },
      ],
      evidence_items: [
        {
          type: 'audit-logs',
          source: `slack notify token=${slackToken}`,
          collected_at: new Date().toISOString(),
        },
      ],
    };
    // Write raw — bypass saveState's redaction so the manifest path
    // gets to do its own scrub.
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(statePath, JSON.stringify(rawState, null, 2), 'utf8');

    const out = packageEvidence(tmpDir, { stateFile: statePath });
    expect(out.success).toBe(true);
    const manifestRaw = readFileSync(out.output, 'utf8');
    expect(manifestRaw).not.toContain(slackToken);
    expect(manifestRaw).toContain('[REDACTED:Slack Bot Token]');
  });

  it('collectEvidence end-to-end: state file persists no raw secrets', () => {
    // Drop a fake "approval" file with a secret in its name's
    // collected_at metadata via direct call.
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'evidence.json');
    const approvalsPath = path.join(tmpDir, '.jumpstart', 'state', 'role-approvals.json');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(approvalsPath, '{}', 'utf8');

    const r = collectEvidence(tmpDir, { stateFile: statePath });
    expect(r.success).toBe(true);

    // Now jam a secret into the persisted state via saveState and
    // verify it gets scrubbed.
    saveEvidenceState(
      {
        ...JSON.parse(readFileSync(statePath, 'utf8')),
        evidence_items: [
          {
            type: 'audit-logs',
            source: 'authorization: Bearer abcdefghijklmnopqrstuvwxyz1234',
            collected_at: new Date().toISOString(),
          },
        ],
      },
      statePath
    );
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).not.toContain('Bearer abcdefghijklmnopqrstuvwxyz1234');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Adversary (BLOCKER) — chat-integration webhook URL allowlist
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M5 Adversary (BLOCKER) — chat-integration webhook allowlist', () => {
  it('rejects userinfo-confused webhook `https://attacker.com@trusted-slack.com`', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const r = configureChat('slack', {
      stateFile: statePath,
      webhook_url: 'https://attacker.com@trusted-slack.com/services/T0/B0/x',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/userinfo|username|password/i);
  });

  it('rejects http://localhost@evil.com (userinfo dressed as localhost)', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const r = configureChat('teams', {
      stateFile: statePath,
      webhook_url: 'http://localhost@evil.com/webhook',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/userinfo|username|password/i);
  });

  it('rejects subdomain spoof http://localhost.evil.com', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const r = configureChat('slack', {
      stateFile: statePath,
      webhook_url: 'http://localhost.evil.com/hook',
    });
    expect(r.success).toBe(false);
    // Falls into the not-HTTPS-not-localhost branch.
    expect(r.error).toMatch(/HTTPS|localhost/i);
  });

  it('rejects unparsable webhook URL', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const r = configureChat('slack', {
      stateFile: statePath,
      webhook_url: 'not://a valid url with spaces',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/parsable|HTTPS|localhost/i);
  });

  it('rejects plain HTTP non-localhost webhook', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const r = configureChat('slack', {
      stateFile: statePath,
      webhook_url: 'http://hooks.slack.com/services/T0/B0/X',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/HTTPS|localhost/i);
  });

  it('accepts canonical HTTPS Slack webhook', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const r = configureChat('slack', {
      stateFile: statePath,
      webhook_url: 'https://hooks.slack.com/services/T00000000/B00000000/abcdefABCDEF',
    });
    expect(r.success).toBe(true);
    expect(r.configuration?.platform).toBe('slack');
  });

  it('accepts http://localhost / 127.0.0.1 / [::1] dev-mode endpoints', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    expect(
      configureChat('slack', {
        stateFile: statePath,
        webhook_url: 'http://localhost:4000/webhook',
      }).success
    ).toBe(true);
    expect(
      configureChat('teams', {
        stateFile: statePath,
        webhook_url: 'http://127.0.0.1:4001/hook',
      }).success
    ).toBe(true);
    expect(
      configureChat('slack', {
        stateFile: statePath,
        webhook_url: 'http://[::1]:4002/hook',
      }).success
    ).toBe(true);
  });

  it('honors JUMPSTART_ALLOW_INSECURE_LLM_URL=1 escape hatch', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL = '1';
    const r = configureChat('slack', {
      stateFile: statePath,
      webhook_url: 'http://anything-goes-here.example.com/hook',
    });
    expect(r.success).toBe(true);
  });

  it('still validates platform name even with insecure-URL override', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL = '1';
    const r = configureChat('discord', {
      stateFile: statePath,
      webhook_url: 'https://hooks.slack.com/services/T0/B0/X',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown platform/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ADR-012 expansion — chat-integration notification message redaction
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M5 — chat-integration redacts secrets in queued notifications', () => {
  it('queueNotification persists redacted message body', () => {
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const fakeToken = `ghp_${'B'.repeat(36)}`;
    const r = queueNotification(
      'risk',
      `New high-severity risk: leaked credential ${fakeToken} in PR #42`,
      { stateFile: statePath }
    );
    expect(r.success).toBe(true);
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).not.toContain(fakeToken);
    expect(raw).toContain('[REDACTED:GitHub Token]');
  });

  it('saved configuration redacts secret-shaped channel webhook on subsequent saves', () => {
    // Configure with a clean webhook, then jam a secret into another
    // field and re-save: the persisted file must scrub the secret.
    const statePath = path.join(tmpDir, '.jumpstart', 'state', 'chat-integration.json');
    const r = configureChat('slack', {
      stateFile: statePath,
      channel: 'incidents',
      webhook_url: 'https://hooks.slack.com/services/T00/B00/abcdefghABCDEFGH',
      events: ['risk', 'blocker'],
    });
    expect(r.success).toBe(true);

    // Now queue a notification whose body embeds a secret — verifies
    // the saveState path scrubs it before persistence.
    const slackToken = `xoxb-${'1'.repeat(11)}-${'2'.repeat(11)}-${'C'.repeat(24)}`;
    queueNotification('blocker', `outage: bot token ${slackToken} rotated`, {
      stateFile: statePath,
    });
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).not.toContain(slackToken);
    expect(raw).toContain('[REDACTED:Slack Bot Token]');
  });
});
