/**
 * test-context-chunker.test.ts — T4.1.7 batch (3/4).
 *
 * **Critical tests** pinning the v1.1.14 infinite-loop fix:
 * `tests/test-context-chunker.test.ts:N` (the four-cases below)
 * MUST stay green in every future port. The bug is that prior to
 * v1.1.14 a long content with overlap >= chunk-size left `start`
 * stuck and `chunkContent` looped forever, OOMing the worker pool.
 *
 * @see bin/lib-ts/context-chunker.ts
 * @see CHANGELOG.md v1.1.14
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chunkContent,
  chunkImplementationPlan,
  estimateTokens,
  MODEL_CONTEXT_LIMITS,
} from '../bin/lib-ts/context-chunker.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'chunker-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('estimateTokens', () => {
  it('returns ceil(len / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('MODEL_CONTEXT_LIMITS', () => {
  it('exports the canonical model budgets', () => {
    expect(MODEL_CONTEXT_LIMITS['gpt-4'].tokens).toBe(8192);
    expect(MODEL_CONTEXT_LIMITS['claude-3-opus'].tokens).toBe(200000);
    expect(MODEL_CONTEXT_LIMITS.default.tokens).toBe(32000);
  });
});

describe('chunkContent — v1.1.14 forward-progress invariants', () => {
  it('terminates on the 200k char input that previously OOMed', () => {
    const huge = 'x'.repeat(200_000);
    const result = chunkContent(huge);
    expect(result.success).toBe(true);
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.total_chars).toBe(200_000);
  });

  it('terminates when overlap > chunk-size (the original infinite-loop trigger)', () => {
    const result = chunkContent('a'.repeat(1000), {
      max_tokens: 50, // 200 chars
      overlap: 100, // 400 chars overlap > 200 chunk → start += 1 path
    });
    expect(result.success).toBe(true);
    expect(result.chunks).toBeGreaterThan(0);
  });

  it('every chunk has length > 0', () => {
    const result = chunkContent('x'.repeat(50_000));
    for (const chunk of result.chunk_details) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
    }
  });

  it('the last chunk ends at content.length (no truncation)', () => {
    const result = chunkContent('x'.repeat(10_000));
    const last = result.chunk_details[result.chunk_details.length - 1];
    expect(last.end).toBe(10_000);
  });
});

describe('chunkContent — natural-boundary preference', () => {
  it('prefers a newline boundary in the trailing 50% of the chunk', () => {
    // Construct content where there's a newline near the end of the
    // first chunk; chunkContent should break on it.
    const chunk1 = `${'a'.repeat(50)}\n`;
    const chunk2 = 'b'.repeat(100);
    const content = chunk1 + chunk2;
    const result = chunkContent(content, { max_tokens: 16 }); // 64 chars per chunk
    // First chunk should end at the newline (51) since 51 > 64 * 0.5.
    expect(result.chunk_details[0].end).toBe(51);
  });
});

describe('chunkImplementationPlan', () => {
  it('returns success=false when the plan file is missing', () => {
    const r = chunkImplementationPlan(tmpDir);
    expect(r.success).toBe(false);
  });

  it('splits a real plan into per-## packets and recommends models', () => {
    mkdirSync(path.join(tmpDir, 'specs'), { recursive: true });
    // The legacy regex splits on any `^##` line; everything before the
    // FIRST `##` becomes its own packet too (including the title +
    // any preamble). We mirror that behavior verbatim.
    const planContent = '# Plan\n\n## Stage 1\nbody\n\n## Stage 2\nbody\n\n## Stage 3\nbody\n';
    writeFileSync(path.join(tmpDir, 'specs', 'implementation-plan.md'), planContent, 'utf8');
    const r = chunkImplementationPlan(tmpDir);
    if (!r.success) throw new Error('expected success');
    // 3 stages + the preamble segment (legacy quirk preserved).
    expect(r.total_sections).toBe(4);
    expect(r.packets.map((p) => p.title)).toContain('Stage 1');
    expect(r.packets.map((p) => p.title)).toContain('Stage 2');
    expect(r.packets.map((p) => p.title)).toContain('Stage 3');
    // model_recommendations excludes the 'default' bucket.
    expect(r.model_recommendations.find((m) => m.model === 'default')).toBeUndefined();
    // Tiny plan fits in a single call for every real model.
    for (const rec of r.model_recommendations) {
      expect(rec.fits_in_single_call).toBe(true);
      expect(rec.chunks_needed).toBe(1);
    }
  });
});
