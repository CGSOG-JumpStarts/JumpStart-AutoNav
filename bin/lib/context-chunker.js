/**
 * context-chunker.js — Implementation Chunking by Context Window (Item 53)
 *
 * Split large work into optimized execution packets for different models.
 *
 * Usage:
 *   node bin/lib/context-chunker.js chunk|estimate|report [options]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODEL_CONTEXT_LIMITS = {
  'gpt-4': { tokens: 8192, chars: 32768 },
  'gpt-4-turbo': { tokens: 128000, chars: 512000 },
  'gpt-4o': { tokens: 128000, chars: 512000 },
  'claude-3-sonnet': { tokens: 200000, chars: 800000 },
  'claude-3-opus': { tokens: 200000, chars: 800000 },
  'claude-3-haiku': { tokens: 200000, chars: 800000 },
  'default': { tokens: 32000, chars: 128000 }
};

/**
 * Estimate token count from text (rough: ~4 chars per token).
 *
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Chunk a large text into context-window-sized pieces.
 *
 * @param {string} content - Content to chunk.
 * @param {object} [options] - { model?, max_tokens?, overlap? }
 * @returns {object}
 */
function chunkContent(content, options = {}) {
  const model = options.model || 'default';
  const limits = MODEL_CONTEXT_LIMITS[model] || MODEL_CONTEXT_LIMITS.default;
  const maxTokens = options.max_tokens || Math.floor(limits.tokens * 0.8); // 80% of limit for safety
  const overlapTokens = options.overlap || Math.floor(maxTokens * 0.05); // 5% overlap

  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  const chunks = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + maxChars, content.length);

    // Try to break at a natural boundary
    if (end < content.length) {
      const lastNewline = content.lastIndexOf('\n', end);
      if (lastNewline > start + maxChars * 0.5) end = lastNewline + 1;
    }

    chunks.push({
      index: chunks.length,
      start,
      end,
      length: end - start,
      estimated_tokens: estimateTokens(content.substring(start, end))
    });

    start = end - overlapChars;
    if (start >= content.length) break;
  }

  return {
    success: true,
    total_chars: content.length,
    total_tokens: estimateTokens(content),
    model,
    max_tokens: maxTokens,
    chunks: chunks.length,
    chunk_details: chunks
  };
}

/**
 * Chunk implementation plan tasks into execution packets.
 *
 * @param {string} root - Project root.
 * @param {object} [options]
 * @returns {object}
 */
function chunkImplementationPlan(root, options = {}) {
  const planFile = path.join(root, 'specs', 'implementation-plan.md');
  if (!fs.existsSync(planFile)) {
    return { success: false, error: 'Implementation plan not found at specs/implementation-plan.md' };
  }

  const content = fs.readFileSync(planFile, 'utf8');

  // Split by milestone/task sections
  const sections = content.split(/^##\s+/m).filter(Boolean);
  const packets = sections.map((section, i) => ({
    index: i,
    title: section.split('\n')[0].trim(),
    estimated_tokens: estimateTokens(section),
    lines: section.split('\n').length
  }));

  return {
    success: true,
    total_sections: packets.length,
    total_tokens: estimateTokens(content),
    packets,
    model_recommendations: Object.entries(MODEL_CONTEXT_LIMITS).map(([model, limits]) => ({
      model,
      fits_in_single_call: estimateTokens(content) <= limits.tokens * 0.8,
      chunks_needed: Math.ceil(estimateTokens(content) / (limits.tokens * 0.8))
    })).filter(r => r.model !== 'default')
  };
}

module.exports = {
  estimateTokens,
  chunkContent,
  chunkImplementationPlan,
  MODEL_CONTEXT_LIMITS
};
