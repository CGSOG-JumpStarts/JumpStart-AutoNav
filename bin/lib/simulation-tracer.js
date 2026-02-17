/**
 * simulation-tracer.js — Headless Agent Simulation Tracer
 *
 * Records phases, LLM calls, tool interceptions, and user proxy exchanges
 * during headless agent runs. Produces structured reports for analysis.
 */

'use strict';

class SimulationTracer {
  /**
   * @param {string} workspaceDir — Workspace root for this simulation
   * @param {string} scenario — Scenario or run name
   */
  constructor(workspaceDir, scenario) {
    this.workspaceDir = workspaceDir;
    this.scenario = scenario;
    this.phases = [];
    this.currentPhase = null;
    this.transcript = [];
    this.llmCalls = [];
    this.toolInterceptionCount = 0;
  }

  /**
   * Mark the start of a phase.
   * @param {string} name — Phase/agent name
   */
  startPhase(name) {
    this.currentPhase = {
      name,
      status: 'RUNNING',
      startTime: Date.now(),
      endTime: null,
      artifacts: [],
      toolCalls: 0,
      llmCalls: 0
    };
    this.phases.push(this.currentPhase);
  }

  /**
   * Mark the end of a phase.
   * @param {string} name — Phase/agent name
   * @param {string} status — 'PASS', 'FAIL', or 'INCOMPLETE'
   */
  endPhase(name, status) {
    if (this.currentPhase && this.currentPhase.name === name) {
      this.currentPhase.status = status;
      this.currentPhase.endTime = Date.now();
    }
  }

  /**
   * Log an artifact created during the current phase.
   * @param {string} artifactName
   */
  logArtifact(artifactName) {
    if (this.currentPhase) {
      this.currentPhase.artifacts.push(artifactName);
    }
  }

  /**
   * Log an LLM API call.
   * @param {string} model — Model ID
   * @param {number} promptTokens
   * @param {number} completionTokens
   * @param {number} [cost] — Estimated cost in USD
   */
  logLLMCall(model, promptTokens, completionTokens, cost) {
    const entry = {
      model,
      promptTokens,
      completionTokens,
      cost: cost || 0,
      timestamp: Date.now()
    };
    this.llmCalls.push(entry);

    if (this.currentPhase) {
      this.currentPhase.llmCalls++;
    }
  }

  /**
   * Log a tool call interception.
   * @param {string} toolName
   * @param {object} args
   * @param {object} result
   */
  logToolInterception(toolName, args, result) {
    this.toolInterceptionCount++;
    this.transcript.push({
      type: 'tool_call',
      tool: toolName,
      args,
      result,
      timestamp: Date.now()
    });

    if (this.currentPhase) {
      this.currentPhase.toolCalls++;
    }
  }

  /**
   * Log a user proxy question-answer exchange.
   * @param {object} questionArgs — ask_questions arguments
   * @param {string} answer — User proxy response
   */
  logUserProxyExchange(questionArgs, answer) {
    this.transcript.push({
      type: 'user_proxy_question',
      data: questionArgs,
      timestamp: Date.now()
    });
    this.transcript.push({
      type: 'user_proxy_response',
      data: answer,
      timestamp: Date.now()
    });
  }

  /**
   * Get LLM usage summary across all calls.
   * @returns {object}
   */
  getLLMUsageSummary() {
    const byModel = {};
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCost = 0;

    for (const call of this.llmCalls) {
      totalPromptTokens += call.promptTokens;
      totalCompletionTokens += call.completionTokens;
      totalCost += call.cost;

      if (!byModel[call.model]) {
        byModel[call.model] = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
      }
      byModel[call.model].calls++;
      byModel[call.model].promptTokens += call.promptTokens;
      byModel[call.model].completionTokens += call.completionTokens;
      byModel[call.model].cost += call.cost;
    }

    return {
      totalCalls: this.llmCalls.length,
      totalPromptTokens,
      totalCompletionTokens,
      totalCost,
      byModel
    };
  }

  /**
   * Get the full conversation transcript.
   * @returns {Array}
   */
  getConversationTranscript() {
    return this.transcript;
  }

  /**
   * Generate a structured report of the simulation.
   * @returns {object}
   */
  getReport() {
    return {
      scenario: this.scenario,
      timestamp: new Date().toISOString(),
      phases: this.phases.map(p => ({
        name: p.name,
        status: p.status,
        artifacts: p.artifacts,
        duration_ms: p.endTime ? p.endTime - p.startTime : null,
        toolCalls: p.toolCalls,
        llmCalls: p.llmCalls
      })),
      headless: {
        llm_usage: this.getLLMUsageSummary(),
        tool_interceptions: this.toolInterceptionCount,
        transcript_length: this.transcript.length
      }
    };
  }

  /**
   * Alias for getReport() — used by HeadlessRunner.
   * @returns {object}
   */
  generateReport() {
    return this.getReport();
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { SimulationTracer };
