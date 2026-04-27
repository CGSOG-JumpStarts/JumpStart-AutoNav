/**
 * context-chunker.ts — context-window chunking (T4.1.7 batch).
 *
 * Pure-library port of `bin/lib/context-chunker.js`. Four exports
 * preserved: `estimateTokens`, `chunkContent`, `chunkImplementationPlan`,
 * `MODEL_CONTEXT_LIMITS`. Token-estimate heuristic (~4 chars/token)
 * preserved verbatim — the same number `chunkContent` and the
 * model-recommendation pass both feed off.
 *
 * **Critical invariant preserved from v1.1.14 fix (commit 92daf04):**
 *   The chunking loop uses two separate guards to prevent the infinite
 *   loop that bricked the test pool:
 *     1. `start = Math.max(end - overlapChars, start + 1)` — start
 *        ALWAYS advances by at least 1 character per iteration even
 *        when `overlapChars >= (end - start)`.
 *     2. `if (end >= content.length) break` — terminates the moment
 *        we've consumed the whole input, regardless of overlap math.
 *   Both guards are pinned by `tests/test-context-chunker.test.ts`.
 *
 * The legacy CLI driver is intentionally NOT ported.
 *
 * @see bin/lib/context-chunker.js (legacy reference)
 * @see CHANGELOG.md v1.1.14 — Critical: context-chunker infinite loop
 * @see specs/implementation-plan.md T4.1.7
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface ContextLimits {
  tokens: number;
  chars: number;
}

/**
 * Per-model context budgets. The numbers match the legacy module
 * verbatim — downstream `chunks_needed` math relies on this exact
 * mapping for budget projections.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, ContextLimits> = {
  'gpt-4': { tokens: 8192, chars: 32768 },
  'gpt-4-turbo': { tokens: 128000, chars: 512000 },
  'gpt-4o': { tokens: 128000, chars: 512000 },
  'claude-3-sonnet': { tokens: 200000, chars: 800000 },
  'claude-3-opus': { tokens: 200000, chars: 800000 },
  'claude-3-haiku': { tokens: 200000, chars: 800000 },
  default: { tokens: 32000, chars: 128000 },
};

export interface ChunkOptions {
  model?: string;
  max_tokens?: number;
  overlap?: number;
}

export interface ChunkDetail {
  index: number;
  start: number;
  end: number;
  length: number;
  estimated_tokens: number;
}

export interface ChunkResult {
  success: true;
  total_chars: number;
  total_tokens: number;
  model: string;
  max_tokens: number;
  chunks: number;
  chunk_details: ChunkDetail[];
}

export interface PlanPacket {
  index: number;
  title: string;
  estimated_tokens: number;
  lines: number;
}

export interface ModelRecommendation {
  model: string;
  fits_in_single_call: boolean;
  chunks_needed: number;
}

export type PlanResult =
  | { success: false; error: string }
  | {
      success: true;
      total_sections: number;
      total_tokens: number;
      packets: PlanPacket[];
      model_recommendations: ModelRecommendation[];
    };

/** Rough character-based token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Chunk arbitrary content into context-window-sized pieces. Tries to
 * break on `\n` boundaries within the trailing 50% of each chunk;
 * falls back to a hard char cut otherwise.
 *
 * Forward-progress invariants (v1.1.14 fix — DO NOT REMOVE):
 *   1. `start = Math.max(end - overlapChars, start + 1)` advances at
 *      least one char per iteration.
 *   2. `if (end >= content.length) break` terminates the moment we
 *      reach the end, regardless of what overlap math says.
 */
export function chunkContent(content: string, options: ChunkOptions = {}): ChunkResult {
  const model = options.model || 'default';
  const limits = MODEL_CONTEXT_LIMITS[model] || MODEL_CONTEXT_LIMITS.default;
  const maxTokens = options.max_tokens || Math.floor(limits.tokens * 0.8);
  const overlapTokens = options.overlap || Math.floor(maxTokens * 0.05);

  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  const chunks: ChunkDetail[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + maxChars, content.length);

    if (end < content.length) {
      const lastNewline = content.lastIndexOf('\n', end);
      if (lastNewline > start + maxChars * 0.5) end = lastNewline + 1;
    }

    chunks.push({
      index: chunks.length,
      start,
      end,
      length: end - start,
      estimated_tokens: estimateTokens(content.substring(start, end)),
    });

    if (end >= content.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }

  return {
    success: true,
    total_chars: content.length,
    total_tokens: estimateTokens(content),
    model,
    max_tokens: maxTokens,
    chunks: chunks.length,
    chunk_details: chunks,
  };
}

/**
 * Chunk an implementation-plan markdown file into per-`##` packets and
 * report which models can fit the whole thing in a single call.
 */
export function chunkImplementationPlan(root: string, _options: ChunkOptions = {}): PlanResult {
  const planFile = path.join(root, 'specs', 'implementation-plan.md');
  if (!existsSync(planFile)) {
    return {
      success: false,
      error: 'Implementation plan not found at specs/implementation-plan.md',
    };
  }

  const content = readFileSync(planFile, 'utf8');
  const sections = content.split(/^##\s+/m).filter(Boolean);

  const packets: PlanPacket[] = sections.map((section, i) => ({
    index: i,
    title: section.split('\n')[0].trim(),
    estimated_tokens: estimateTokens(section),
    lines: section.split('\n').length,
  }));

  const total = estimateTokens(content);
  const model_recommendations: ModelRecommendation[] = Object.entries(MODEL_CONTEXT_LIMITS)
    .map(([model, limits]) => ({
      model,
      fits_in_single_call: total <= limits.tokens * 0.8,
      chunks_needed: Math.ceil(total / (limits.tokens * 0.8)),
    }))
    .filter((r) => r.model !== 'default');

  return {
    success: true,
    total_sections: packets.length,
    total_tokens: total,
    packets,
    model_recommendations,
  };
}
