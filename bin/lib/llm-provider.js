/**
 * llm-provider.js — LLM Provider abstraction backed by LiteLLM
 *
 * Uses the OpenAI Node.js SDK pointed at a LiteLLM proxy server.
 * LiteLLM provides a unified OpenAI-compatible API for 100+ LLM providers
 * (OpenAI, Anthropic, Google, Bedrock, etc.) via a single gateway.
 *
 * [Context7: litellm@v1.81.9-stable]
 *
 * Configuration:
 *   LITELLM_BASE_URL  — LiteLLM proxy URL (default: http://localhost:4000)
 *   LITELLM_API_KEY   — API key for the LiteLLM proxy (default: empty)
 *
 * In mock mode, no network calls are made — synthetic responses are returned.
 */

'use strict';

// ─── Model Registry ──────────────────────────────────────────────────────────

/**
 * Maps unified model IDs (provider/model) to their LiteLLM-compatible config.
 * LiteLLM routes these to the correct upstream provider automatically.
 */
const MODEL_REGISTRY = {
  // OpenAI models
  'openai/gpt-5.2':        { provider: 'openai',    apiModel: 'gpt-5.2',                   supportsTools: true,  maxTokens: 128000 },
  'openai/gpt-5-mini':     { provider: 'openai',    apiModel: 'gpt-5-mini',                 supportsTools: true,  maxTokens: 128000 },
  'openai/gpt-4o':         { provider: 'openai',    apiModel: 'gpt-4o',                     supportsTools: true,  maxTokens: 128000 },
  'openai/gpt-4o-mini':    { provider: 'openai',    apiModel: 'gpt-4o-mini',                supportsTools: true,  maxTokens: 128000 },
  'openai/o3':             { provider: 'openai',    apiModel: 'o3',                         supportsTools: true,  maxTokens: 200000 },
  'openai/o3-mini':        { provider: 'openai',    apiModel: 'o3-mini',                    supportsTools: true,  maxTokens: 200000 },
  'openai/o4-mini':        { provider: 'openai',    apiModel: 'o4-mini',                    supportsTools: true,  maxTokens: 200000 },

  // Anthropic models
  'anthropic/claude-opus-4-5':       { provider: 'anthropic', apiModel: 'claude-opus-4-5',       supportsTools: true,  maxTokens: 200000 },
  'anthropic/claude-sonnet-4':       { provider: 'anthropic', apiModel: 'claude-sonnet-4',       supportsTools: true,  maxTokens: 200000 },
  'anthropic/claude-haiku-3.5':      { provider: 'anthropic', apiModel: 'claude-haiku-3.5',      supportsTools: true,  maxTokens: 200000 },

  // Google Gemini models
  'gemini/gemini-3-flash-preview':   { provider: 'gemini',    apiModel: 'gemini-3-flash-preview',   supportsTools: true,  maxTokens: 1000000 },
  'gemini/gemini-2.5-flash':         { provider: 'gemini',    apiModel: 'gemini-2.5-flash',         supportsTools: true,  maxTokens: 1000000 },
  'gemini/gemini-2.5-pro':           { provider: 'gemini',    apiModel: 'gemini-2.5-pro',           supportsTools: true,  maxTokens: 1000000 },
};

/**
 * List all registered model IDs.
 * @returns {string[]}
 */
function listModels() {
  return Object.keys(MODEL_REGISTRY);
}

/**
 * Get the configuration for a specific model.
 * @param {string} modelId — e.g. 'openai/gpt-5-mini'
 * @returns {object|null}
 */
function getModelConfig(modelId) {
  return MODEL_REGISTRY[modelId] || null;
}

// ─── Provider Factory ────────────────────────────────────────────────────────

/**
 * Create an LLM provider instance.
 *
 * Live mode routes through LiteLLM proxy using the OpenAI SDK.
 * Mock mode returns synthetic responses without network calls.
 *
 * @param {object} options
 * @param {string} options.model — Model ID from the registry (e.g. 'openai/gpt-4o')
 * @param {string} [options.mode='live'] — 'live' or 'mock'
 * @param {object} [options.mockResponses] — Mock response registry (for mock mode)
 * @param {string} [options.reasoningEffort='medium'] — Reasoning effort hint
 * @param {string} [options.baseURL] — Override LiteLLM proxy URL
 * @param {string} [options.apiKey] — Override API key
 * @returns {object} Provider with .completion() and .getUsage()
 */
function createProvider(options = {}) {
  const {
    model = 'openai/gpt-4o',
    mode = 'live',
    mockResponses = null,
    reasoningEffort = 'medium',
    baseURL = process.env.LITELLM_BASE_URL || 'http://localhost:4000',
    apiKey = process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY || ''
  } = options;

  const modelConfig = MODEL_REGISTRY[model] || { provider: 'unknown', apiModel: model, supportsTools: true, maxTokens: 128000 };

  // Usage tracking
  let totalCalls = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  // ── Mock provider ───────────────────────────────────────────────────────
  if (mode === 'mock') {
    return {
      mode: 'mock',
      model,
      modelConfig,

      /**
       * Return a synthetic completion without making network calls.
       * @param {Array} messages — Chat messages array
       * @param {Array} [tools] — Tool definitions (ignored in mock mode)
       * @returns {Promise<object>} OpenAI-compatible response
       */
      async completion(messages, tools) {
        totalCalls++;
        const promptTokens = messages.reduce((sum, m) => sum + (m.content || '').length / 4, 0) | 0;
        const completionTokens = 50;
        totalPromptTokens += promptTokens;
        totalCompletionTokens += completionTokens;
        totalTokens += promptTokens + completionTokens;

        // If a mock registry provides a custom completion, use it
        let content = 'This is a mock response from the headless agent emulator.';
        if (mockResponses && typeof mockResponses.getCompletionResponse === 'function') {
          const custom = mockResponses.getCompletionResponse(messages);
          if (custom) content = custom;
        }

        return {
          id: `mock-${Date.now()}-${totalCalls}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: modelConfig.apiModel,
          choices: [{
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        };
      },

      /**
       * Get cumulative usage statistics.
       * @returns {object}
       */
      getUsage() {
        return { calls: totalCalls, totalTokens, promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens };
      }
    };
  }

  // ── Live provider (LiteLLM via OpenAI SDK) ──────────────────────────────
  // Lazy-load OpenAI SDK to avoid requiring it for mock-only use.
  let openaiClient = null;

  function getClient() {
    if (!openaiClient) {
      // eslint-disable-next-line global-require
      const { OpenAI } = require('openai');
      openaiClient = new OpenAI({
        apiKey: apiKey || 'not-set',
        baseURL: baseURL.replace(/\/+$/, '') // strip trailing slash
      });
    }
    return openaiClient;
  }

  return {
    mode: 'live',
    model,
    modelConfig,

    /**
     * Send a chat completion request through the LiteLLM proxy.
     *
     * LiteLLM receives the request on its OpenAI-compatible endpoint
     * and routes it to the correct upstream provider based on the model name.
     *
     * @param {Array} messages — Chat messages
     * @param {Array} [tools] — Tool definitions for function calling
     * @returns {Promise<object>} OpenAI-compatible response
     */
    async completion(messages, tools) {
      totalCalls++;
      const client = getClient();

      const requestBody = {
        model: modelConfig.apiModel,
        messages
      };

      // Tool / function calling — LiteLLM proxies this to all supported providers
      if (tools && tools.length > 0 && modelConfig.supportsTools) {
        requestBody.tools = tools;
        requestBody.tool_choice = 'auto';
      }

      const response = await client.chat.completions.create(requestBody);

      // Track usage
      if (response.usage) {
        totalPromptTokens += response.usage.prompt_tokens || 0;
        totalCompletionTokens += response.usage.completion_tokens || 0;
        totalTokens += response.usage.total_tokens || 0;
      }

      return response;
    },

    getUsage() {
      return { calls: totalCalls, totalTokens, promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens };
    }
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { createProvider, listModels, getModelConfig, MODEL_REGISTRY };
