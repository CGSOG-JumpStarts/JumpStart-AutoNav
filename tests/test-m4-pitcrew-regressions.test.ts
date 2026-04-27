/**
 * test-m4-pitcrew-regressions.test.ts — M4 Pit Crew remediation pins.
 *
 * Pins every confirmed-exploit and parity-divergence finding from the
 * M4 Pit Crew round (Reviewer + QA + Adversary) so a future refactor
 * cannot silently re-open them.
 *
 * @see specs/implementation-plan.md §Deviation Log (M4 entries)
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyProfile, expandDotNotation } from '../bin/lib-ts/ceremony.js';
import { routeByCost } from '../bin/lib-ts/cost-router.js';
import { LLMError } from '../bin/lib-ts/errors.js';
import { validateLLMEndpoint } from '../bin/lib-ts/llm-provider.js';
import { redactSecrets } from '../bin/lib-ts/secret-scanner.js';
import {
  createCheckpoint,
  loadState,
  restoreCheckpoint,
  updateState,
} from '../bin/lib-ts/state-store.js';
import { createTimeline, loadTimeline, renderHTML } from '../bin/lib-ts/timeline.js';
import { logUsage } from '../bin/lib-ts/usage.js';

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'm4-pit-'));
  mkdirSync(path.join(tmpDir, '.jumpstart', 'state'), { recursive: true });
  statePath = path.join(tmpDir, '.jumpstart', 'state', 'state.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// F1 — timeline.renderHTML XSS
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Adversary F1 (BLOCKER) — timeline.renderHTML XSS defense', () => {
  it('escapes </script> in event metadata so embedded JSON cannot break out of the script tag', () => {
    const events = [
      {
        id: 'xss-1',
        timestamp: '2026-04-27T00:00:00.000Z',
        session_id: 'xss-test',
        event_type: 'tool_call' as const,
        phase: 0,
        agent: 'attacker',
        parent_agent: null,
        action: '</script><script>window.X="PWNED"</script>',
        duration_ms: null,
        metadata: {},
      },
    ];
    const html = renderHTML(events as never);
    // Verbatim payload must NOT appear; only the escaped form
    expect(html).not.toContain('</script><script>');
    expect(html).not.toContain('window.X="PWNED"</script>');
    // Escaped form: `<\/script>` (backslash before slash) survives JSON parse
    expect(html).toContain('<\\/script');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F2 — ceremony.expandDotNotation prototype pollution
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Adversary F2 (BLOCKER) — expandDotNotation proto pollution defense', () => {
  it('rejects __proto__ as a dotted-path segment', () => {
    expect(() => expandDotNotation({ '__proto__.polluted': 'PWNED' })).toThrow(
      /forbidden key|prototype pollution/i
    );
    // Confirm Object.prototype was NOT polluted
    const probe: Record<string, unknown> = {};
    expect(probe.polluted).toBeUndefined();
  });
  it('rejects constructor / prototype segments', () => {
    expect(() => expandDotNotation({ 'constructor.x': 1 })).toThrow();
    expect(() => expandDotNotation({ 'prototype.y': 2 })).toThrow();
  });
  it('rejects mid-path forbidden segments too', () => {
    expect(() => expandDotNotation({ 'a.__proto__.b': 'evil' })).toThrow();
  });
  it('applyProfile is unaffected by the new guard (uses hardcoded settings)', () => {
    expect(() => applyProfile({}, 'light')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// M6 — ADR-011 endpoint userinfo bypass
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Reviewer M6 (BLOCKER) — ADR-011 endpoint via URL parser', () => {
  it('rejects userinfo-confused URL `https://attacker.com@trusted-proxy.local`', () => {
    expect(() => validateLLMEndpoint('https://attacker.com@trusted-proxy.local')).toThrow(LLMError);
  });
  it('rejects http://localhost@evil.com', () => {
    expect(() => validateLLMEndpoint('http://localhost@evil.com')).toThrow(LLMError);
  });
  it('rejects subdomain spoof http://localhost.evil.com', () => {
    expect(() => validateLLMEndpoint('http://localhost.evil.com')).toThrow(LLMError);
  });
  it('rejects unparsable URL', () => {
    expect(() => validateLLMEndpoint('not://a valid url')).toThrow(LLMError);
  });
  it('still accepts canonical https/localhost URLs', () => {
    expect(() => validateLLMEndpoint('https://api.openai.com/v1')).not.toThrow();
    expect(() => validateLLMEndpoint('http://localhost:4000')).not.toThrow();
    expect(() => validateLLMEndpoint('http://127.0.0.1:4000/v1')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F12 — checkpoint ID collision
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Adversary F12 (HIGH) — checkpoint ID uniqueness within same second', () => {
  it('two checkpoints created in rapid succession have distinct IDs', () => {
    updateState({ phase: 1 }, statePath);
    const a = createCheckpoint('A', { statePath });
    const b = createCheckpoint('B', { statePath });
    expect(a.checkpoint.id).not.toBe(b.checkpoint.id);
    // Both are restorable by their distinct IDs
    expect(restoreCheckpoint(a.checkpoint.id, statePath).success).toBe(true);
    expect(restoreCheckpoint(b.checkpoint.id, statePath).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F13 — JSON.parse shape validation in load* functions
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Adversary F13 (HIGH) — JSON shape validation in load* functions', () => {
  it('loadState rejects string-root JSON (returns defaults)', () => {
    writeFileSync(statePath, '"PWNED"', 'utf8');
    const s = loadState(statePath);
    expect(s.current_phase).toBeNull();
    expect(Array.isArray(s.phase_history)).toBe(true);
  });
  it('loadState rejects array-root JSON', () => {
    writeFileSync(statePath, '[1,2,3]', 'utf8');
    const s = loadState(statePath);
    expect(Array.isArray(s.phase_history)).toBe(true);
  });
  it('loadState rejects __proto__-keyed JSON', () => {
    writeFileSync(statePath, '{"__proto__": {"polluted": true}}', 'utf8');
    const s = loadState(statePath);
    expect(s.current_phase).toBeNull();
    const probe: Record<string, unknown> = {};
    expect(probe.polluted).toBeUndefined();
  });
  it('loadState normalizes wrong-typed sub-fields', () => {
    writeFileSync(statePath, '{"phase_history": "not-an-array"}', 'utf8');
    const s = loadState(statePath);
    expect(Array.isArray(s.phase_history)).toBe(true);
  });
  it('loadTimeline rejects non-object root', () => {
    const tlPath = path.join(tmpDir, 'tl.json');
    writeFileSync(tlPath, '"PWNED"', 'utf8');
    const data = loadTimeline(tlPath);
    expect(Array.isArray(data.events)).toBe(true);
    expect(data.events.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F10 — timeline cyclic-metadata DoS
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Adversary F10 (HIGH) — timeline cyclic JSON.stringify safety', () => {
  it('flush() does not crash on cyclic metadata', () => {
    const tlPath = path.join(tmpDir, 'tl.json');
    const tl = createTimeline({ filePath: tlPath, sessionId: 'cyc' });
    interface Cyc {
      a: string;
      self?: Cyc;
    }
    const cyc: Cyc = { a: 'leaf' };
    cyc.self = cyc;
    expect(() => {
      tl.recordEvent({
        event_type: 'tool_call',
        phase: 0,
        agent: 'x',
        action: 'cyclic',
        metadata: { cyc },
      });
      tl.flush();
    }).not.toThrow();
    const raw = readFileSync(tlPath, 'utf8');
    expect(raw).toContain('[Circular]');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F11 — Map/Set serialization
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Adversary F11 (HIGH) — Map/Set become JSON-safe arrays', () => {
  it('Map projects to array of [key, value] tuples (not silent {})', () => {
    const m = new Map([['k1', 'v1']]);
    const out = JSON.parse(JSON.stringify(redactSecrets(m)));
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]).toEqual(['k1', 'v1']);
  });
  it('Set projects to plain array', () => {
    const s = new Set(['a', 'b']);
    const out = JSON.parse(JSON.stringify(redactSecrets(s)));
    expect(Array.isArray(out)).toBe(true);
    expect(out).toContain('a');
    expect(out).toContain('b');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// H3 — restoreCheckpoint resume_context null fallback
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Reviewer H3 (HIGH) — restoreCheckpoint preserves null resume_context', () => {
  it('returns null (not defaultState()) when checkpoint has no resume_context', () => {
    updateState({ phase: 1 }, statePath);
    const cp = createCheckpoint('test', { statePath }).checkpoint;
    // Manually clear the checkpoint's resume_context
    const s = loadState(statePath);
    const cps = s.checkpoints || [];
    cps[cps.length - 1].resume_context = null;
    writeFileSync(statePath, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
    restoreCheckpoint(cp.id, statePath);
    const after = loadState(statePath);
    expect(after.resume_context).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// M1 — cost-router min_quality semantic
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 Reviewer M1 — cost-router min_quality uses || not ??', () => {
  it('min_quality=0 falls through to profile default (legacy ||) — does not pin 0', () => {
    const cfg = path.join(tmpDir, 'cost.json');
    const r = routeByCost({ min_quality: 0 }, { configFile: cfg });
    // Profile default is balanced (min_quality=80), so the result
    // model has quality >= 80, NOT just any model.
    expect(r.quality).toBeGreaterThanOrEqual(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ADR-012 expansion — secrets in action/agent fields
// ─────────────────────────────────────────────────────────────────────────

describe('Pit Crew M4 QA — ADR-012 redaction covers action/agent fields too', () => {
  it('usage.logUsage redacts secrets in action description', () => {
    const log = path.join(tmpDir, 'usage.json');
    const fakeToken = `ghp_${'A'.repeat(36)}`;
    logUsage(log, {
      phase: 'phase-3',
      agent: 'Architect',
      action: `tool_call: api_key="${fakeToken}"`,
      estimated_tokens: 100,
      estimated_cost_usd: 0.01,
    });
    const raw = readFileSync(log, 'utf8');
    expect(raw).not.toContain(fakeToken);
  });
});
