/**
 * llm-provider.ts — LLM provider abstraction port (T4.3.1).
 *
 * Pure-library port of `bin/lib/llm-provider.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `MODEL_REGISTRY` (constant catalog)
 *   - `listModels()` => string[]
 *   - `getModelConfig(modelId)` => ModelConfig | null
 *   - `createProvider(options?)` => Provider
 *
 * **ADR-011 endpoint validation (NEW in this port).**
 *   `LITELLM_BASE_URL` is now validated at provider construction
 *   against an allowlist of safe endpoint patterns:
 *     - any HTTPS URL
 *     - http://localhost:* / http://127.0.0.1:* / http://[::1]:*
 *   Anything else throws `LLMError` (exit 3) unless the env var
 *   `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` overrides. Closes
 *   v1.1.14 SEC-004 — env-injection-driven prompt exfiltration to
 *   an attacker-controlled proxy.
 *
 * **Mock vs live mode.**
 *   `mode: 'mock'` returns synthetic responses without network calls;
 *   `mode: 'live'` lazy-loads the OpenAI SDK and routes via the
 *   LiteLLM proxy.
 *
 * @see bin/lib/llm-provider.js (legacy reference)
 * @see specs/decisions/adr-011-llm-endpoint-validation.md
 * @see specs/implementation-plan.md T4.3.1
 */

import { LLMError } from './errors.js';

// Public types

export interface ModelConfig {
  provider: string;
  apiModel: string;
  supportsTools: boolean;
  maxTokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: unknown[];
  };
  finish_reason: string;
}

export interface CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage?: CompletionUsage;
}

export interface UsageStats {
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ProviderOptions {
  model?: string;
  mode?: 'live' | 'mock';
  mockResponses?: { getCompletionResponse?: (messages: ChatMessage[]) => string | null } | null;
  reasoningEffort?: string;
  baseURL?: string;
  apiKey?: string;
}

export interface Provider {
  mode: 'live' | 'mock';
  model: string;
  modelConfig: ModelConfig;
  completion(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<CompletionResponse>;
  getUsage(): UsageStats;
}

// Catalog (preserved verbatim from legacy)

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'openai/gpt-5.2': {
    provider: 'openai',
    apiModel: 'gpt-5.2',
    supportsTools: true,
    maxTokens: 128000,
  },
  'openai/gpt-5-mini': {
    provider: 'openai',
    apiModel: 'gpt-5-mini',
    supportsTools: true,
    maxTokens: 128000,
  },
  'openai/gpt-4o': {
    provider: 'openai',
    apiModel: 'gpt-4o',
    supportsTools: true,
    maxTokens: 128000,
  },
  'openai/gpt-4o-mini': {
    provider: 'openai',
    apiModel: 'gpt-4o-mini',
    supportsTools: true,
    maxTokens: 128000,
  },
  'openai/o3': { provider: 'openai', apiModel: 'o3', supportsTools: true, maxTokens: 200000 },
  'openai/o3-mini': {
    provider: 'openai',
    apiModel: 'o3-mini',
    supportsTools: true,
    maxTokens: 200000,
  },
  'openai/o4-mini': {
    provider: 'openai',
    apiModel: 'o4-mini',
    supportsTools: true,
    maxTokens: 200000,
  },
  'anthropic/claude-opus-4-5': {
    provider: 'anthropic',
    apiModel: 'claude-opus-4-5',
    supportsTools: true,
    maxTokens: 200000,
  },
  'anthropic/claude-sonnet-4': {
    provider: 'anthropic',
    apiModel: 'claude-sonnet-4',
    supportsTools: true,
    maxTokens: 200000,
  },
  'anthropic/claude-haiku-3.5': {
    provider: 'anthropic',
    apiModel: 'claude-haiku-3.5',
    supportsTools: true,
    maxTokens: 200000,
  },
  'gemini/gemini-3-flash-preview': {
    provider: 'gemini',
    apiModel: 'gemini-3-flash-preview',
    supportsTools: true,
    maxTokens: 1000000,
  },
  'gemini/gemini-2.5-flash': {
    provider: 'gemini',
    apiModel: 'gemini-2.5-flash',
    supportsTools: true,
    maxTokens: 1000000,
  },
  'gemini/gemini-2.5-pro': {
    provider: 'gemini',
    apiModel: 'gemini-2.5-pro',
    supportsTools: true,
    maxTokens: 1000000,
  },
};

/** ADR-011 localhost hostnames (case-insensitive). */
const ALLOWED_LOCALHOST_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
]);

/**
 * Validate a LiteLLM endpoint against the ADR-011 allowlist.
 *
 * **Pit Crew M4 Reviewer M6 + Adversary userinfo concern**: previous
 * regex-based check accepted `https://attacker.com@trusted-proxy.local`
 * because `[^/]+` matches anything-non-slash, including `attacker.com@`
 * userinfo. The OpenAI SDK then resolves `attacker.com` as the host,
 * leaking secrets. Defense: parse the URL with `new URL(...)` and
 * inspect the components directly. Reject ANY URL with non-empty
 * `username` or `password` (no userinfo allowed in the LiteLLM proxy
 * URL). Reject malformed URLs by catching the `URL` constructor's
 * `TypeError`.
 *
 * Allowlist:
 *   - Any `https:` protocol with NO userinfo
 *   - `http:` protocol if hostname is `localhost`/`127.0.0.1`/`[::1]`
 *
 * Throws `LLMError` (exit 3) on rejection unless
 * `JUMPSTART_ALLOW_INSECURE_LLM_URL=1` env-var override is set.
 */
export function validateLLMEndpoint(url: string): void {
  const override = process.env.JUMPSTART_ALLOW_INSECURE_LLM_URL === '1';
  if (override) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LLMError(
      `LLM endpoint "${url}" is not a parsable URL. Set JUMPSTART_ALLOW_INSECURE_LLM_URL=1 to override.`,
      { url, override: false }
    );
  }

  // Reject userinfo (Pit Crew M4 Adversary M6 confirmed-exploit).
  if (parsed.username !== '' || parsed.password !== '') {
    throw new LLMError(
      `LLM endpoint "${url}" contains userinfo (username/password) which can confuse downstream HTTP clients. Embed credentials via Authorization header instead.`,
      { url, override: false, reason: 'userinfo_in_url' }
    );
  }

  if (parsed.protocol === 'https:') {
    return; // Any HTTPS URL with no userinfo
  }

  if (parsed.protocol === 'http:') {
    // Hostname comparison is case-insensitive per RFC 3986; URL.hostname
    // is already lowercased in modern Node. The `[::1]` form needs
    // special-casing because URL.hostname strips the brackets.
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_LOCALHOST_HOSTS.has(host) || ALLOWED_LOCALHOST_HOSTS.has(`[${host}]`)) {
      return;
    }
  }

  throw new LLMError(
    `LLM endpoint "${url}" is not HTTPS and not a localhost address. This could indicate environment-variable poisoning. Set JUMPSTART_ALLOW_INSECURE_LLM_URL=1 to override (NOT recommended for production use).`,
    { url, override: false }
  );
}

// Implementation

/** List all registered model IDs. */
export function listModels(): string[] {
  return Object.keys(MODEL_REGISTRY);
}

/** Get the configuration for a specific model, or null if unknown. */
export function getModelConfig(modelId: string): ModelConfig | null {
  return MODEL_REGISTRY[modelId] || null;
}

/**
 * Create an LLM provider instance.
 *
 * Live mode routes through LiteLLM proxy (validated per ADR-011).
 * Mock mode returns synthetic responses without network calls.
 */
export function createProvider(options: ProviderOptions = {}): Provider {
  const {
    model = 'openai/gpt-4o',
    mode = 'live',
    mockResponses = null,
    baseURL = process.env.LITELLM_BASE_URL || 'http://localhost:4000',
    apiKey = process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY || '',
  } = options;

  const modelConfig: ModelConfig = MODEL_REGISTRY[model] || {
    provider: 'unknown',
    apiModel: model,
    supportsTools: true,
    maxTokens: 128000,
  };

  // Usage tracking
  let totalCalls = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  // ── Mock provider ────────────────────────────────────────────────────
  if (mode === 'mock') {
    return {
      mode: 'mock',
      model,
      modelConfig,

      async completion(
        messages: ChatMessage[],
        _tools?: ToolDefinition[]
      ): Promise<CompletionResponse> {
        totalCalls++;
        const promptTokens =
          messages.reduce((sum, m) => sum + ((m.content || '').length / 4 || 0), 0) | 0;
        const completionTokens = 50;
        totalPromptTokens += promptTokens;
        totalCompletionTokens += completionTokens;
        totalTokens += promptTokens + completionTokens;

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
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        };
      },

      getUsage(): UsageStats {
        return {
          calls: totalCalls,
          totalTokens,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
        };
      },
    };
  }

  // ── Live provider (LiteLLM via OpenAI SDK) ───────────────────────────
  // ADR-011: validate endpoint at construction time.
  validateLLMEndpoint(baseURL);

  type OpenAIClient = {
    chat: { completions: { create(body: unknown): Promise<CompletionResponse> } };
  };
  let openaiClient: OpenAIClient | null = null;

  function getClient(): OpenAIClient {
    if (!openaiClient) {
      // Lazy-load OpenAI SDK so mock-only consumers don't pay the
      // import cost. Wrapped in try/catch so a missing dependency
      // produces a typed LLMError instead of a generic ImportError.
      try {
        const mod = require('openai') as { OpenAI: new (cfg: object) => OpenAIClient };
        openaiClient = new mod.OpenAI({
          apiKey: apiKey || 'not-set',
          baseURL: baseURL.replace(/\/+$/, ''),
        });
      } catch (err) {
        throw new LLMError(
          `Failed to initialize OpenAI SDK: ${(err as Error).message}. Install the 'openai' package or run in mock mode.`,
          { cause: (err as Error).message }
        );
      }
    }
    return openaiClient;
  }

  return {
    mode: 'live',
    model,
    modelConfig,

    async completion(
      messages: ChatMessage[],
      tools?: ToolDefinition[]
    ): Promise<CompletionResponse> {
      totalCalls++;
      const client = getClient();

      const requestBody: Record<string, unknown> = {
        model: modelConfig.apiModel,
        messages,
      };

      if (tools && tools.length > 0 && modelConfig.supportsTools) {
        requestBody.tools = tools;
        requestBody.tool_choice = 'auto';
      }

      const response = await client.chat.completions.create(requestBody);

      if (response.usage) {
        totalPromptTokens += response.usage.prompt_tokens || 0;
        totalCompletionTokens += response.usage.completion_tokens || 0;
        totalTokens += response.usage.total_tokens || 0;
      }

      return response;
    },

    getUsage(): UsageStats {
      return {
        calls: totalCalls,
        totalTokens,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      };
    },
  };
}
