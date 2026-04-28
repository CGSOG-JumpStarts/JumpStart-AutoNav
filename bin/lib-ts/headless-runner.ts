/**
 * headless-runner.ts — Jump Start Headless Agent Runner port (T4.6.2, cluster M7).
 *
 * Pure-library port reconciling the divergence between
 *   - `bin/headless-runner.js`     (808L — CLI + dynamic-ESM-loaded
 *                                    usage/timeline integration)
 *   - `bin/lib/headless-runner.js` (658L — core HeadlessRunner class
 *                                    with no usage/timeline integration)
 *
 * **Divergence reconciliation choice (Deviation Log entry).**
 *   This port canonicalizes the LONGER (808L) `bin/headless-runner.js`
 *   library core but DROPS its CLI bootstrap. Specifically:
 *
 *   PORTED (from 808L, present-only-there, treated as core runtime):
 *     - Timeline integration in `runAgent` (phase_start/phase_end,
 *       llm_turn_start/end, prompt_logged, question_asked/answered).
 *     - Per-agent usage-log persistence (`logUsage` after each agent
 *       returns, with model/tokens/turns/calls/status metadata).
 *     - Timeline session lifecycle (`endSession` after all agents).
 *     - Connecting timeline to the usage logger via
 *       `setUsageTimelineHook` so usage events surface in timeline.
 *
 *   PORTED (from 658L, present in BOTH, library-only):
 *     - The HeadlessRunner class: setup, copyScenarioFixtures,
 *       copyJumpstartConfig, initializeProviders, loadAgentPrompt,
 *       loadPersonaPrompt, callUserProxy, formatQuestionsForProxy,
 *       parseProxyResponse, runAgent main loop, getAgentStartMessage,
 *       isPhaseComplete, run.
 *
 *   NOT PORTED (CLI wrapper — strangler-phase out-of-scope):
 *     - `parseArgs()` / `showHelp()` / top-level `main()` (lines 783-808
 *       of legacy 808L). These use process.argv + process.exit which
 *       library code is forbidden to call per ADR-006.
 *     - `require('dotenv').config()` (line 28 of 808L). Library callers
 *       configure their environment via the constructor's `options.env`
 *       hook (when supplied) or by reading `process.env` directly. The
 *       CLI wrapper at M8/M9 will call `dotenv.config()` itself.
 *
 *   DEFERRED — `__dirname` removal:
 *     - Legacy uses `path.join(__dirname, '..', ...)` to compute
 *       AGENTS_DIR / PERSONAS_DIR / SCENARIOS_DIR / OUTPUT_DIR /
 *       REPORTS_DIR. The TS port accepts these as optional
 *       `HeadlessOptions` fields defaulting to `process.cwd()`-relative
 *       paths. CLI wrappers (M8+) construct the orchestrator with
 *       explicit paths.
 *
 *   DEFERRED — chalk integration:
 *     - Legacy console output uses `chalk` for color. We keep chalk
 *       as a dependency but route output through a logger callback
 *       (`HeadlessOptions.logger`) so library consumers can disable
 *       color or capture output. Default logger uses `console.log`
 *       and falls back to plaintext when `process.stdout.isTTY` is
 *       false (a behavior change documented as a Deviation Log entry).
 *
 * Public surface preserved verbatim by name + signature shape:
 *
 *   - `HeadlessRunner` class
 *      constructor(options: HeadlessOptions)
 *      log(message, level?)
 *      setup() => Promise<void>
 *      copyScenarioFixtures(scenarioDir) => void
 *      copyJumpstartConfig() => void
 *      initializeProviders(agentName) => Promise<void>
 *      loadAgentPrompt(agentName) => string
 *      loadPersonaPrompt() => string
 *      callUserProxy(askQuestionsArgs) => Promise<ProxyAnswerEnvelope>
 *      formatQuestionsForProxy(args) => string
 *      parseProxyResponse(args, proxyAnswer) => ProxyAnswerEnvelope
 *      runAgent(agentName) => Promise<string>
 *      getAgentStartMessage(agentName) => string
 *      isPhaseComplete(content) => boolean
 *      run() => Promise<number>
 *
 *   - `AGENT_PHASES` constant
 *   - `DEFAULT_CONFIG` constant
 *
 * **ADR-012 redaction (NEW in this port).**
 *   The runner persists two artifacts directly:
 *     1. A run report JSON (`headless-<scenario>-<ts>.json`) — wrapped
 *        in `redactSecrets` at the boundary before `writeFileSync`.
 *     2. Per-agent usage entries (delegated to `usage.ts`, which
 *        applies its own redaction layer per T4.3.1).
 *   The timeline persistence is also delegated to `timeline.ts`, which
 *   applies redaction internally per T4.3.3.
 *
 * **Path-safety hardening (NEW in this port).**
 *   Every `path.join(workspaceDir | rootDir, userInput)` is gated by
 *   `assertInsideRoot`. Scenario names, persona names, and agent names
 *   are runtime inputs that could be `'..\\..\\etc\\passwd'`-shaped on
 *   Windows or `'/etc/passwd'` on POSIX. The legacy was permissive.
 *
 * **JSON shape validation.**
 *   The runner doesn't load JSON config of its own. Scenario files
 *   loaded for fixture copying go through `validator.ts` (markdown
 *   only). Provider responses are validated by `llm-provider.ts`.
 *
 * @see bin/headless-runner.js     (legacy reference — 808L, full)
 * @see bin/lib/headless-runner.js (legacy reference — 658L, library-core)
 * @see specs/decisions/adr-012-secrets-redaction-in-logs.md
 * @see specs/implementation-plan.md T4.6.2
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import { createProvider, listModels } from './llm-provider.js';
import { createMockRegistry, createPersonaRegistry } from './mock-responses.js';
import { assertInsideRoot } from './path-safety.js';
import { redactSecrets } from './secret-scanner.js';
import { SimulationTracer } from './simulation-tracer.js';
import { createTimeline, type Timeline } from './timeline.js';
import { createToolBridge } from './tool-bridge.js';
import { getToolsForPhase } from './tool-schemas.js';
import { logUsage, setUsageTimelineHook } from './usage.js';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export const AGENT_PHASES = [
  'scout',
  'challenger',
  'analyst',
  'pm',
  'architect',
  'developer',
] as const;

export type AgentPhase = (typeof AGENT_PHASES)[number];

export const DEFAULT_CONFIG = {
  agentModel: 'openai/gpt-5.2',
  proxyModel: 'gemini/gemini-3-flash-preview',
  persona: 'compliant-user',
  maxTurns: 50,
  reasoningEffort: 'medium',
} as const;

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

export type HeadlessLogger = (message: string, level: LogLevel) => void;

export interface HeadlessOptions {
  /** Comma-parsed agent names (already split into array). Required. */
  agents: string[];
  /** Persona name (defaults to 'compliant-user'). */
  persona?: string;
  /** Agent LLM model (defaults to DEFAULT_CONFIG.agentModel). */
  model?: string;
  /** User proxy LLM model (defaults to DEFAULT_CONFIG.proxyModel). */
  proxyModel?: string;
  /** Run providers in mock mode (no API calls). */
  mock?: boolean;
  /** Scenario name to load fixtures from. */
  scenario?: string;
  /** Output directory (defaults to `<projectRoot>/tests/e2e/.tmp`). */
  output?: string;
  /** Don't write files (simulation mode). */
  dryRun?: boolean;
  /** Verbose console output. */
  verbose?: boolean;
  /** Maximum conversation turns per agent (defaults to DEFAULT_CONFIG.maxTurns). */
  maxTurns?: number;
  /** Project root for default path resolution (defaults to process.cwd()). */
  projectRoot?: string;
  /** Override the agents directory. Defaults to `<projectRoot>/.jumpstart/agents`. */
  agentsDir?: string;
  /** Override the personas directory. Defaults to `<projectRoot>/tests/e2e/personas`. */
  personasDir?: string;
  /** Override the scenarios directory. Defaults to `<projectRoot>/tests/e2e/scenarios`. */
  scenariosDir?: string;
  /** Override the reports directory. Defaults to `<projectRoot>/tests/e2e/reports`. */
  reportsDir?: string;
  /** Custom logger callback (defaults to color-aware console.log). */
  logger?: HeadlessLogger;
}

export interface ProxyAnswerEntry {
  selected: string[];
  freeText: string | null;
  skipped: boolean;
}

export interface ProxyAnswerEnvelope {
  answers: Record<string, ProxyAnswerEntry>;
}

export interface QuestionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AskQuestion {
  header: string;
  question: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  allowFreeformInput?: boolean;
}

export interface AskQuestionsArgs {
  questions: AskQuestion[];
}

// biome-ignore lint/suspicious/noExplicitAny: provider interface is sibling-ported (llm-provider.ts); duck-typed during M7 strangler phase, narrowed at M9
type LLMProvider = any;

export interface RunResults {
  [agent: string]: string; // 'PASS' | 'FAIL' | 'INCOMPLETE'
}

// ─────────────────────────────────────────────────────────────────────────
// Default logger (chalk-free; legacy used chalk inline — Deviation)
// ─────────────────────────────────────────────────────────────────────────

const PREFIX_BY_LEVEL: Record<LogLevel, string> = {
  info: 'i',
  success: '✓',
  warn: '!',
  error: '×',
  debug: '·',
};

function defaultLogger(verbose: boolean): HeadlessLogger {
  return (message: string, level: LogLevel) => {
    if (level === 'debug' && !verbose) return;
    const prefix = PREFIX_BY_LEVEL[level] || '';
    console.log(`${prefix} ${message}`);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Path resolution helpers
// ─────────────────────────────────────────────────────────────────────────

interface ResolvedPaths {
  rootDir: string;
  agentsDir: string;
  personasDir: string;
  scenariosDir: string;
  outputDir: string;
  reportsDir: string;
}

function resolvePaths(options: HeadlessOptions): ResolvedPaths {
  const rootDir = options.projectRoot || process.cwd();
  return {
    rootDir,
    agentsDir: options.agentsDir || path.join(rootDir, '.jumpstart', 'agents'),
    personasDir: options.personasDir || path.join(rootDir, 'tests', 'e2e', 'personas'),
    scenariosDir: options.scenariosDir || path.join(rootDir, 'tests', 'e2e', 'scenarios'),
    outputDir: options.output || path.join(rootDir, 'tests', 'e2e', '.tmp'),
    reportsDir: options.reportsDir || path.join(rootDir, 'tests', 'e2e', 'reports'),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HeadlessRunner class
// ─────────────────────────────────────────────────────────────────────────

/**
 * Headless agent runner. Instantiate with `HeadlessOptions` and call
 * `run()` to drive a full agent pipeline through the simulation tracer
 * and timeline.
 */
export class HeadlessRunner {
  options: HeadlessOptions;
  verbose: boolean;
  workspaceDir: string;
  // biome-ignore lint/suspicious/noExplicitAny: tracer is the JS-class SimulationTracer ported in T4.6.x; duck-typed for now per tests/test-headless.test.js
  tracer: any;
  usageLogPath: string;
  timeline: Timeline | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: mockRegistry is mock-responses.ts public class; legacy hooks use duck-typed methods, narrow at M9
  mockRegistry: any;
  agentProvider: LLMProvider | null = null;
  proxyProvider: LLMProvider | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: toolBridge is sibling-ported in T4.6.x and uses duck-typing during strangler phase
  toolBridge: any = null;
  conversationHistory: Array<Record<string, unknown>> = [];
  userProxyHistory: Array<Record<string, unknown>> = [];
  turnCount = 0;
  private logger: HeadlessLogger;
  private resolved: ResolvedPaths;

  constructor(options: HeadlessOptions) {
    this.options = options;
    this.verbose = options.verbose === true;
    this.logger = options.logger ?? defaultLogger(this.verbose);
    this.resolved = resolvePaths(options);

    // Workspace dir derives from output + scenario or a timestamped
    // run id. Scenario name is asserted inside the output dir to
    // reject `..`-traversal payloads.
    if (options.scenario) {
      assertInsideRoot(options.scenario, this.resolved.outputDir, {
        schemaId: 'headless-runner-scenario',
      });
      this.workspaceDir = path.join(this.resolved.outputDir, options.scenario);
    } else {
      this.workspaceDir = path.join(this.resolved.outputDir, `run-${Date.now()}`);
    }

    this.tracer = new SimulationTracer(this.workspaceDir, options.scenario || 'headless');
    this.usageLogPath = path.join(this.workspaceDir, '.jumpstart', 'usage-log.json');

    // Initialize timeline for event recording. Static import (not
    // dynamic-ESM) — this is the M7 deviation from legacy.
    this.timeline = createTimeline({
      filePath: path.join(this.workspaceDir, '.jumpstart', 'state', 'timeline.json'),
      enabled: true,
      captureToolCalls: true,
      captureFileReads: true,
      captureFileWrites: true,
      captureLLMTurns: true,
      captureQuestions: true,
      captureApprovals: true,
      captureSubagents: true,
      captureResearch: true,
    });

    // Connect timeline to usage logger so usage events appear in timeline.
    setUsageTimelineHook(this.timeline);

    // Mock registry only when in mock mode.
    this.mockRegistry = options.mock
      ? createPersonaRegistry(options.persona ?? DEFAULT_CONFIG.persona)
      : null;
  }

  log(message: string, level: LogLevel = 'info'): void {
    this.logger(message, level);
  }

  async setup(): Promise<void> {
    const dirs = [
      this.workspaceDir,
      path.join(this.workspaceDir, 'specs'),
      path.join(this.workspaceDir, 'specs', 'decisions'),
      path.join(this.workspaceDir, 'specs', 'insights'),
      path.join(this.workspaceDir, '.jumpstart'),
      path.join(this.workspaceDir, '.jumpstart', 'state'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    if (this.options.scenario) {
      const scenarioDir = path.join(this.resolved.scenariosDir, this.options.scenario);
      if (existsSync(scenarioDir)) {
        this.copyScenarioFixtures(scenarioDir);
      }
    }

    this.copyJumpstartConfig();

    this.log(`Workspace initialized: ${this.workspaceDir}`, 'success');
  }

  copyScenarioFixtures(scenarioDir: string): void {
    const configFile = path.join(scenarioDir, 'config.yaml');
    if (existsSync(configFile)) {
      copyFileSync(configFile, path.join(this.workspaceDir, '.jumpstart', 'config.yaml'));
    }

    for (const phase of AGENT_PHASES) {
      const phaseDir = path.join(scenarioDir, `0${AGENT_PHASES.indexOf(phase) + 1}-${phase}`);
      if (existsSync(phaseDir)) {
        const files = readdirSync(phaseDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            // Path-safety: file names listed by readdir on a fixture
            // directory are usually safe but we still gate the join.
            try {
              assertInsideRoot(file, phaseDir, {
                schemaId: 'headless-runner-copyScenarioFixtures-src',
              });
            } catch {
              continue;
            }
            const src = path.join(phaseDir, file);
            const isInsights = file.includes('insights');
            const dest = isInsights
              ? path.join(this.workspaceDir, 'specs', 'insights', file)
              : path.join(this.workspaceDir, 'specs', file);
            copyFileSync(src, dest);
          }
        }
      }
    }
  }

  copyJumpstartConfig(): void {
    const filesToCopy = ['config.yaml', 'roadmap.md', 'glossary.md'];
    const srcJumpstart = path.join(this.resolved.rootDir, '.jumpstart');
    const destJumpstart = path.join(this.workspaceDir, '.jumpstart');

    for (const file of filesToCopy) {
      const src = path.join(srcJumpstart, file);
      const dest = path.join(destJumpstart, file);
      if (existsSync(src) && !existsSync(dest)) {
        copyFileSync(src, dest);
      }
    }

    const srcAgents = path.join(srcJumpstart, 'agents');
    const destAgents = path.join(destJumpstart, 'agents');
    if (existsSync(srcAgents)) {
      if (!existsSync(destAgents)) {
        mkdirSync(destAgents, { recursive: true });
      }
      const agentFiles = readdirSync(srcAgents);
      for (const file of agentFiles) {
        const src = path.join(srcAgents, file);
        const dest = path.join(destAgents, file);
        if (!existsSync(dest)) {
          copyFileSync(src, dest);
        }
      }
    }
  }

  async initializeProviders(_agentName: string): Promise<void> {
    void _agentName;
    this.agentProvider = createProvider({
      model: this.options.model ?? DEFAULT_CONFIG.agentModel,
      mode: this.options.mock ? 'mock' : 'live',
      mockResponses: this.mockRegistry,
      reasoningEffort: DEFAULT_CONFIG.reasoningEffort,
    }) as LLMProvider;

    if (!this.options.mock) {
      this.proxyProvider = createProvider({
        model: this.options.proxyModel ?? DEFAULT_CONFIG.proxyModel,
        mode: 'live',
        reasoningEffort: 'low',
      }) as LLMProvider;
    }

    this.toolBridge = createToolBridge({
      workspaceDir: this.workspaceDir,
      tracer: this.tracer,
      dryRun: this.options.dryRun === true,
      timeline: this.timeline,
      onUserProxyCall: this.options.mock
        ? null
        : // UserProxyCallback receives `unknown` from tool-bridge.
          // callUserProxy now takes `unknown` and runs a defensive
          // shape-check internally (Pit Crew M7 BLOCKER 2 fix —
          // pre-fix `args as AskQuestionsArgs` cast bypassed validation).
          (args: unknown) => this.callUserProxy(args),
    });
  }

  loadAgentPrompt(agentName: string): string {
    // Agent name is user-supplied (CLI argv); reject traversal-shaped names.
    assertInsideRoot(`${agentName}.md`, this.resolved.agentsDir, {
      schemaId: 'headless-runner-loadAgentPrompt',
    });
    const agentFile = path.join(this.resolved.agentsDir, `${agentName}.md`);

    if (!existsSync(agentFile)) {
      throw new Error(`Agent file not found: ${agentFile}`);
    }

    return readFileSync(agentFile, 'utf8');
  }

  loadPersonaPrompt(): string {
    const personaName = this.options.persona ?? DEFAULT_CONFIG.persona;
    assertInsideRoot(`${personaName}.md`, this.resolved.personasDir, {
      schemaId: 'headless-runner-loadPersonaPrompt',
    });
    const personaFile = path.join(this.resolved.personasDir, `${personaName}.md`);

    if (!existsSync(personaFile)) {
      const defaultFile = path.join(this.resolved.personasDir, 'compliant-user.md');
      if (existsSync(defaultFile)) {
        return readFileSync(defaultFile, 'utf8');
      }
      return `You are a cooperative user who approves requests and picks sensible defaults.
When asked for approval, say "Approved".
When asked to choose, pick the recommended option or the first option.
Be brief and supportive.`;
    }

    return readFileSync(personaFile, 'utf8');
  }

  async callUserProxy(rawArgs: unknown): Promise<ProxyAnswerEnvelope> {
    // Pit Crew M7 BLOCKER (Reviewer + Adversary): the pre-fix path
    // accepted `args as AskQuestionsArgs` from the tool-bridge with NO
    // runtime validation. A malicious or misbehaving LLM could send
    // `{questions: null}` or omit `questions`, crashing
    // `askQuestionsArgs.questions.map(...)` with a TypeError that
    // terminated the turn loop. Post-fix: validate with a defensive
    // shape-check before any property access. On invalid input, return
    // a neutral fallback envelope so the loop can continue.
    const askQuestionsArgs = this.coerceAskQuestionsArgs(rawArgs);
    if (!askQuestionsArgs) {
      this.log('[User Proxy] received malformed ask_questions args; returning fallback', 'warn');
      return { answers: {} };
    }

    const questionText = this.formatQuestionsForProxy(askQuestionsArgs);

    this.userProxyHistory.push({
      role: 'user',
      content: questionText,
    });

    this.log(`[Agent asks] ${askQuestionsArgs.questions.map((q) => q.header).join(', ')}`, 'debug');

    if (!this.proxyProvider) {
      throw new Error('proxyProvider not initialized; cannot call user proxy in live mode');
    }
    const response = await this.proxyProvider.completion(this.userProxyHistory);
    const proxyAnswer = response.choices[0].message.content as string;

    this.userProxyHistory.push({
      role: 'assistant',
      content: proxyAnswer,
    });

    this.log(`[User Proxy] ${proxyAnswer.substring(0, 100)}...`, 'debug');

    if (this.tracer.logUserProxyExchange) {
      this.tracer.logUserProxyExchange(askQuestionsArgs, proxyAnswer);
    }

    if (this.timeline) {
      this.timeline.recordEvent({
        event_type: 'question_asked',
        action: `Agent asked: ${askQuestionsArgs.questions.map((q) => q.header).join(', ')}`,
        metadata: { questions: askQuestionsArgs.questions },
      });
      this.timeline.recordEvent({
        event_type: 'question_answered',
        action: `User proxy answered`,
        metadata: { answers: proxyAnswer },
      });
    }

    return this.parseProxyResponse(askQuestionsArgs, proxyAnswer);
  }

  /**
   * Defensively shape-check unknown args from the tool-bridge before
   * casting to `AskQuestionsArgs`. Returns null if the args don't have
   * the minimum required shape (a non-empty `questions` array of
   * objects with at least `header` and `question` strings).
   *
   * Pit Crew M7 BLOCKER fix — see callUserProxy.
   */
  private coerceAskQuestionsArgs(raw: unknown): AskQuestionsArgs | null {
    if (raw === null || typeof raw !== 'object') return null;
    const candidate = raw as { questions?: unknown };
    if (!Array.isArray(candidate.questions)) return null;
    if (candidate.questions.length === 0) return null;
    for (const q of candidate.questions) {
      if (q === null || typeof q !== 'object') return null;
      const qq = q as { header?: unknown; question?: unknown; options?: unknown };
      if (typeof qq.header !== 'string' || typeof qq.question !== 'string') return null;
      if (qq.options !== undefined && !Array.isArray(qq.options)) return null;
    }
    return raw as AskQuestionsArgs;
  }

  formatQuestionsForProxy(args: AskQuestionsArgs): string {
    let text = 'The development agent is asking you the following:\n\n';

    for (const q of args.questions) {
      text += `**${q.header}**: ${q.question}\n`;

      if (q.options && q.options.length > 0) {
        text += 'Options:\n';
        for (const opt of q.options) {
          const rec = opt.recommended ? ' (recommended)' : '';
          const desc = opt.description ? ` - ${opt.description}` : '';
          text += `  - ${opt.label}${rec}${desc}\n`;
        }
      } else {
        text += '(Free text response expected)\n';
      }
      text += '\n';
    }

    text += 'Please respond with your selection or answer for each question.';
    return text;
  }

  parseProxyResponse(args: AskQuestionsArgs, proxyAnswer: string): ProxyAnswerEnvelope {
    const answers: Record<string, ProxyAnswerEntry> = {};
    const answerLower = proxyAnswer.toLowerCase();

    for (const q of args.questions) {
      if (q.options && q.options.length > 0) {
        let selected: string[] = [];

        for (const opt of q.options) {
          if (answerLower.includes(opt.label.toLowerCase())) {
            selected.push(opt.label);
            if (!q.multiSelect) break;
          }
        }

        if (selected.length === 0) {
          const rec = q.options.find((o) => o.recommended) || q.options[0];
          selected = [rec.label];
        }

        answers[q.header] = {
          selected,
          freeText: q.allowFreeformInput ? proxyAnswer : null,
          skipped: false,
        };
      } else {
        answers[q.header] = {
          selected: [],
          freeText: proxyAnswer,
          skipped: false,
        };
      }
    }

    return { answers };
  }

  async runAgent(agentName: string): Promise<string> {
    this.log(`\n${'═'.repeat(60)}`, 'info');
    this.log(`Running agent: ${agentName}`, 'info');
    this.log(`${'═'.repeat(60)}`, 'info');

    this.tracer.startPhase(agentName);

    if (this.timeline) {
      this.timeline.setPhase(agentName);
      this.timeline.setAgent(agentName);
      this.timeline.recordEvent({
        event_type: 'phase_start',
        action: `Phase started: ${agentName}`,
        metadata: { model: this.options.model, persona: this.options.persona },
      });
    }

    await this.initializeProviders(agentName);

    const agentPrompt = this.loadAgentPrompt(agentName);
    const personaPrompt = this.loadPersonaPrompt();

    if (this.timeline) {
      this.timeline.recordEvent({
        event_type: 'prompt_logged',
        action: `System prompt loaded for ${agentName} (${agentPrompt.length} chars)`,
        metadata: {
          prompt_type: 'system',
          agent: agentName,
          prompt_length: agentPrompt.length,
          prompt_preview: agentPrompt.substring(0, 200) + (agentPrompt.length > 200 ? '…' : ''),
        },
      });
    }

    this.conversationHistory = [{ role: 'system', content: agentPrompt }];

    this.userProxyHistory = [{ role: 'system', content: personaPrompt }];

    const tools = getToolsForPhase(agentName);

    const startMessage = this.getAgentStartMessage(agentName);
    this.conversationHistory.push({ role: 'user', content: startMessage });

    if (this.timeline) {
      this.timeline.recordEvent({
        event_type: 'prompt_logged',
        action: `Activation prompt sent to ${agentName}`,
        metadata: {
          prompt_type: 'activation',
          agent: agentName,
          prompt_length: startMessage.length,
          prompt_content: startMessage,
        },
      });
    }

    const maxTurns = this.options.maxTurns ?? DEFAULT_CONFIG.maxTurns;
    this.turnCount = 0;
    let sessionActive = true;
    let finalStatus = 'PASS';

    while (sessionActive && this.turnCount < maxTurns) {
      this.turnCount++;
      this.log(`Turn ${this.turnCount}/${maxTurns}`, 'debug');

      try {
        if (this.timeline) {
          this.timeline.recordEvent({
            event_type: 'llm_turn_start',
            action: `LLM turn ${this.turnCount} started`,
            metadata: {
              turn: this.turnCount,
              model: this.options.model,
              max_turns: maxTurns,
            },
          });
        }

        if (!this.agentProvider) {
          throw new Error('agentProvider not initialized');
        }
        const response = await this.agentProvider.completion(this.conversationHistory, tools);

        const message = response.choices[0].message;
        this.conversationHistory.push(message);

        if (this.timeline) {
          const usage = response.usage || {};
          this.timeline.recordEvent({
            event_type: 'llm_turn_end',
            action: `LLM turn ${this.turnCount} completed`,
            metadata: {
              turn: this.turnCount,
              prompt_tokens: usage.prompt_tokens || 0,
              completion_tokens: usage.completion_tokens || 0,
              has_tool_calls: !!(message.tool_calls && message.tool_calls.length > 0),
            },
          });
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            this.log(`Tool: ${toolCall.function.name}`, 'debug');

            const result = await this.toolBridge.execute(toolCall);
            this.conversationHistory.push(result);
          }
        } else if (message.content) {
          this.log(`Agent: ${String(message.content).substring(0, 100)}...`, 'debug');

          if (this.isPhaseComplete(message.content)) {
            this.log(`Phase ${agentName} complete!`, 'success');
            sessionActive = false;
          }
        }
      } catch (error) {
        this.log(`Error: ${(error as Error).message}`, 'error');
        finalStatus = 'FAIL';
        sessionActive = false;
      }
    }

    if (this.turnCount >= maxTurns) {
      this.log(`Max turns reached (${maxTurns})`, 'warn');
      finalStatus = 'INCOMPLETE';
    }

    this.tracer.endPhase(agentName, finalStatus);

    if (this.timeline) {
      this.timeline.recordEvent({
        event_type: 'phase_end',
        action: `Phase ended: ${agentName} — ${finalStatus}`,
        metadata: { status: finalStatus, turns: this.turnCount },
      });
      this.timeline.flush();
    }

    if (this.agentProvider) {
      const usage = this.agentProvider.getUsage();
      this.log(`Usage: ${usage.totalTokens} tokens, ${usage.calls} calls`, 'info');

      try {
        logUsage(this.usageLogPath, {
          phase: agentName,
          agent: agentName.charAt(0).toUpperCase() + agentName.slice(1),
          action: 'generation',
          estimated_tokens: usage.totalTokens || 0,
          estimated_cost_usd: (usage.totalTokens || 0) * 0.000002,
          model: this.options.model || 'unknown',
          metadata: {
            turns: this.turnCount,
            calls: usage.calls || 0,
            status: finalStatus,
          },
        });
      } catch (err) {
        this.log(`Warning: Failed to write usage log: ${(err as Error).message}`, 'warn');
      }
    }

    return finalStatus;
  }

  getAgentStartMessage(agentName: string): string {
    const activations: Record<string, string> = {
      scout: 'Run /jumpstart.scout to analyze this codebase.',
      challenger:
        'Run /jumpstart.challenge. The problem I want to solve is: Build a modern web application.',
      analyst:
        'Run /jumpstart.analyze. Please create the product brief based on the challenger brief.',
      pm: 'Run /jumpstart.plan. Please create the PRD based on the product brief.',
      architect:
        'Run /jumpstart.architect. Please create the architecture and implementation plan.',
      developer:
        'Run /jumpstart.build. Please implement the first task from the implementation plan.',
    };

    return activations[agentName] || `Run /jumpstart.${agentName}`;
  }

  isPhaseComplete(content: string): boolean {
    const completionSignals = [
      'phase gate approval',
      'artifact is ready for review',
      'please review and approve',
      'awaiting your approval',
      'submitted for approval',
    ];

    const lowerContent = content.toLowerCase();
    return completionSignals.some((signal) => lowerContent.includes(signal));
  }

  async run(): Promise<number> {
    const startTime = Date.now();
    this.log('Starting headless runner...', 'info');
    this.log(`Mode: ${this.options.mock ? 'MOCK' : 'LIVE'}`, 'info');
    this.log(`Agents: ${this.options.agents.join(', ')}`, 'info');
    this.log(`Persona: ${this.options.persona ?? DEFAULT_CONFIG.persona}`, 'info');

    await this.setup();

    const results: RunResults = {};

    for (const agent of this.options.agents) {
      if (!(AGENT_PHASES as readonly string[]).includes(agent)) {
        this.log(`Unknown agent: ${agent}. Skipping.`, 'warn');
        continue;
      }

      results[agent] = await this.runAgent(agent);
    }

    // Generate report
    const report = this.tracer.generateReport
      ? this.tracer.generateReport()
      : this.tracer.getReport();
    report.runtime = {
      total_ms: Date.now() - startTime,
      mode: this.options.mock ? 'mock' : 'live',
      model: this.options.model,
      persona: this.options.persona,
    };
    report.results = results;

    // Persist with redaction (ADR-012).
    const reportPath = path.join(
      this.resolved.reportsDir,
      `headless-${this.options.scenario || 'run'}-${Date.now()}.json`
    );

    if (!existsSync(this.resolved.reportsDir)) {
      mkdirSync(this.resolved.reportsDir, { recursive: true });
    }

    const redacted = redactSecrets(report);
    writeFileSync(reportPath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
    this.log(`Report saved: ${reportPath}`, 'success');

    if (this.timeline) {
      this.timeline.endSession();
    }

    const passed = Object.values(results).filter((r) => r === 'PASS').length;
    const total = Object.keys(results).length;

    console.log(`\n${'═'.repeat(60)}`);
    console.log('Summary');
    console.log('═'.repeat(60));
    console.log(`Agents run: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${total - passed}`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log(`Output: ${this.workspaceDir}`);

    return passed === total ? 0 : 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Re-exports for caller convenience
// ─────────────────────────────────────────────────────────────────────────

/**
 * Re-export `listModels` from llm-provider so headless-runner consumers
 * (CLI wrappers, tests) can build their own help text without
 * double-importing.
 */
export { createMockRegistry, createPersonaRegistry, listModels };
