/**
 * mock-responses.js — Mock Response Registry for Headless Agent Testing
 *
 * Provides canned answers to ask_questions tool calls so agents can run
 * headlessly without a human in the loop. Supports persona-specific overrides.
 */

'use strict';

// ─── Default Responses ───────────────────────────────────────────────────────

const DEFAULT_ASK_RESPONSES = {
  // Common agent questions and sensible defaults
  TechPrefs:    { selected: ['Node.js with Express'], freeText: null, skipped: false },
  Database:     { selected: ['PostgreSQL'],            freeText: null, skipped: false },
  Frontend:     { selected: ['React'],                 freeText: null, skipped: false },
  Hosting:      { selected: ['Vercel'],                freeText: null, skipped: false },
  TestFramework:{ selected: ['Vitest'],                freeText: null, skipped: false },
  Ceremony:     { selected: ['Standard'],              freeText: null, skipped: false },
  ProjectType:  { selected: ['greenfield'],            freeText: null, skipped: false },
  Approval:     { selected: ['Approved'],              freeText: null, skipped: false },
};

// ─── Persona Overrides ──────────────────────────────────────────────────────

const PERSONA_OVERRIDES = {
  'compliant-user': {
    // Uses all defaults — approves quickly, picks sensible options
  },
  'enterprise-user': {
    TechPrefs:    { selected: ['Java with Spring Boot'],  freeText: null, skipped: false },
    Database:     { selected: ['Oracle'],                  freeText: null, skipped: false },
    Frontend:     { selected: ['Angular'],                 freeText: null, skipped: false },
    Hosting:      { selected: ['AWS ECS'],                 freeText: null, skipped: false },
    Ceremony:     { selected: ['Rigorous'],                freeText: null, skipped: false },
  },
  'strict-user': {
    Ceremony:     { selected: ['Rigorous'],                freeText: null, skipped: false },
  },
};

// ─── Registry Factory ────────────────────────────────────────────────────────

/**
 * Create a mock response registry with default responses.
 * @returns {object} Registry with getAskQuestionsResponse, setAskQuestionsResponse, getCallCount
 */
function createMockRegistry() {
  const customResponses = {};
  let callCount = 0;

  return {
    /**
     * Get mock answers for an ask_questions tool call.
     * Priority: custom > default > recommended option > first option
     *
     * @param {object} args — The ask_questions arguments { questions: [...] }
     * @returns {object} { answers: { [header]: { selected, freeText, skipped } } }
     */
    getAskQuestionsResponse(args) {
      callCount++;
      const answers = {};

      for (const q of args.questions) {
        const header = q.header;

        // 1. Custom override
        if (customResponses[header]) {
          answers[header] = customResponses[header];
          continue;
        }

        // 2. Default registry
        if (DEFAULT_ASK_RESPONSES[header]) {
          answers[header] = DEFAULT_ASK_RESPONSES[header];
          continue;
        }

        // 3. Fallback: pick recommended option, else first option
        if (q.options && q.options.length > 0) {
          const recommended = q.options.find(o => o.recommended);
          const selected = recommended ? recommended.label : q.options[0].label;
          answers[header] = { selected: [selected], freeText: null, skipped: false };
        } else {
          answers[header] = { selected: [], freeText: 'Approved', skipped: false };
        }
      }

      return { answers };
    },

    /**
     * Override the response for a specific question header.
     * @param {string} header
     * @param {object} response — { selected, freeText, skipped }
     */
    setAskQuestionsResponse(header, response) {
      customResponses[header] = response;
    },

    /**
     * Get the total number of getAskQuestionsResponse calls.
     * @returns {number}
     */
    getCallCount() {
      return callCount;
    },

    /**
     * Optional: provide a custom completion response for mock LLM provider.
     * @param {Array} messages
     * @returns {string|null}
     */
    getCompletionResponse(messages) {
      return null; // Default: let mock provider use its own default
    }
  };
}

/**
 * Create a persona-specific mock registry.
 * @param {string} persona — Persona name (compliant-user, enterprise-user, strict-user)
 * @returns {object} Registry with persona overrides baked in
 */
function createPersonaRegistry(persona) {
  const registry = createMockRegistry();
  const overrides = PERSONA_OVERRIDES[persona] || {};

  for (const [header, response] of Object.entries(overrides)) {
    registry.setAskQuestionsResponse(header, response);
  }

  return registry;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { createMockRegistry, createPersonaRegistry };
