#!/usr/bin/env node

/**
 * headless-runner.js — Jump Start Headless Agent Emulation
 * 
 * Runs Jump Start agents headlessly with LLM-powered User Proxy.
 * Replaces the VS Code Chat window for automated testing.
 * 
 * Usage:
 *   node bin/headless-runner.js --agent architect --persona compliant-user
 *   node bin/headless-runner.js --agent architect --mock
 *   node bin/headless-runner.js --agent challenger,analyst,pm,architect --scenario ecommerce
 * 
 * Options:
 *   --agent <names>       Comma-separated agent names to run
 *   --persona <name>      User proxy persona (default: compliant-user)
 *   --model <id>          LLM model for agent (default: openai/gpt-4o)
 *   --proxy-model <id>    LLM model for user proxy (default: gemini/gemini-2.5-flash)
 *   --mock                Use mock responses (no API calls)
 *   --scenario <name>     Load scenario from tests/e2e/scenarios/
 *   --output <dir>        Output directory (default: tests/e2e/.tmp/)
 *   --dry-run             Don't write files, just simulate
 *   --verbose             Enable verbose logging
 *   --max-turns <n>       Maximum conversation turns (default: 50)
 *   --help                Show help
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const { createProvider, listModels } = require('./lib/llm-provider');
const { createToolBridge } = require('./lib/tool-bridge');
const { getToolsForPhase } = require('./lib/tool-schemas');
const { createMockRegistry, createPersonaRegistry } = require('./lib/mock-responses');
const { SimulationTracer } = require('./lib/simulation-tracer');

// ─── Configuration ───────────────────────────────────────────────────────────

const ROOT_DIR = path.join(__dirname, '..');
const AGENTS_DIR = path.join(ROOT_DIR, '.jumpstart', 'agents');
const PERSONAS_DIR = path.join(ROOT_DIR, 'tests', 'e2e', 'personas');
const SCENARIOS_DIR = path.join(ROOT_DIR, 'tests', 'e2e', 'scenarios');
const OUTPUT_DIR = path.join(ROOT_DIR, 'tests', 'e2e', '.tmp');
const REPORTS_DIR = path.join(ROOT_DIR, 'tests', 'e2e', 'reports');

const AGENT_PHASES = ['scout', 'challenger', 'analyst', 'pm', 'architect', 'developer'];

const DEFAULT_CONFIG = {
  agentModel: 'openai/gpt-5.2',
  proxyModel: 'gemini/gemini-3-flash-preview',
  persona: 'compliant-user',
  maxTurns: 50,
  reasoningEffort: 'medium'
};

// ─── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    agents: [],
    persona: DEFAULT_CONFIG.persona,
    model: DEFAULT_CONFIG.agentModel,
    proxyModel: DEFAULT_CONFIG.proxyModel,
    mock: false,
    scenario: null,
    output: OUTPUT_DIR,
    dryRun: false,
    verbose: false,
    maxTurns: DEFAULT_CONFIG.maxTurns,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--agent':
      case '-a':
        options.agents = args[++i].split(',').map(a => a.trim().toLowerCase());
        break;
      case '--persona':
      case '-p':
        options.persona = args[++i];
        break;
      case '--model':
      case '-m':
        options.model = args[++i];
        break;
      case '--proxy-model':
        options.proxyModel = args[++i];
        break;
      case '--mock':
        options.mock = true;
        break;
      case '--scenario':
      case '-s':
        options.scenario = args[++i];
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--max-turns':
        options.maxTurns = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
${chalk.bold('Jump Start Headless Agent Runner')}

Runs Jump Start agents headlessly with LLM-powered User Proxy.

${chalk.bold('Usage:')}
  node bin/headless-runner.js --agent <names> [options]

${chalk.bold('Options:')}
  --agent, -a <names>     Comma-separated agent names (challenger,analyst,pm,architect,developer)
  --persona, -p <name>    User proxy persona (default: compliant-user)
  --model, -m <id>        LLM model for agent (default: ${DEFAULT_CONFIG.agentModel})
  --proxy-model <id>      LLM model for user proxy (default: ${DEFAULT_CONFIG.proxyModel})
  --mock                  Use mock responses (no API calls)
  --scenario, -s <name>   Load scenario from tests/e2e/scenarios/
  --output, -o <dir>      Output directory (default: tests/e2e/.tmp/)
  --dry-run               Simulate without writing files
  --verbose, -v           Enable verbose logging
  --max-turns <n>         Maximum conversation turns (default: 50)
  --help, -h              Show this help

${chalk.bold('Examples:')}
  # Run architect with compliant user (mock mode, no API)
  node bin/headless-runner.js --agent architect --mock

  # Run architect with real LLM
  node bin/headless-runner.js --agent architect --persona compliant-user

  # Run full pipeline with specific model
  node bin/headless-runner.js --agent challenger,analyst,pm,architect --model openai/gpt-5-mini

  # Run with scenario fixtures
  node bin/headless-runner.js --agent architect --scenario ecommerce

${chalk.bold('Available Models:')}
  ${listModels().join('\n  ')}

${chalk.bold('Available Personas:')}
  compliant-user    Approves quickly, picks sensible defaults
  strict-user       Asks follow-ups, may reject first proposals  
  enterprise-user   Enterprise preferences, security-focused
`);
}

// ─── Core Runner ─────────────────────────────────────────────────────────────

class HeadlessRunner {
  constructor(options) {
    this.options = options;
    this.verbose = options.verbose;
    
    // Set up output directory
    this.workspaceDir = options.scenario 
      ? path.join(options.output, options.scenario)
      : path.join(options.output, `run-${Date.now()}`);
    
    // Initialize tracer
    this.tracer = new SimulationTracer(this.workspaceDir, options.scenario || 'headless');
    
    // Initialize mock registry if in mock mode
    this.mockRegistry = options.mock 
      ? createPersonaRegistry(options.persona)
      : null;
    
    // Will be initialized per agent
    this.agentProvider = null;
    this.proxyProvider = null;
    this.toolBridge = null;
    
    // Conversation state
    this.conversationHistory = [];
    this.userProxyHistory = [];
    this.turnCount = 0;
  }
  
  log(message, level = 'info') {
    const prefix = {
      info: chalk.blue('ℹ'),
      success: chalk.green('✓'),
      warn: chalk.yellow('⚠'),
      error: chalk.red('✗'),
      debug: chalk.gray('·')
    }[level] || '';
    
    if (level === 'debug' && !this.verbose) return;
    console.log(`${prefix} ${message}`);
  }
  
  async setup() {
    // Create workspace directory structure
    const dirs = [
      this.workspaceDir,
      path.join(this.workspaceDir, 'specs'),
      path.join(this.workspaceDir, 'specs', 'decisions'),
      path.join(this.workspaceDir, 'specs', 'insights'),
      path.join(this.workspaceDir, '.jumpstart'),
      path.join(this.workspaceDir, '.jumpstart', 'state')
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    // Copy scenario fixtures if available
    if (this.options.scenario) {
      const scenarioDir = path.join(SCENARIOS_DIR, this.options.scenario);
      if (fs.existsSync(scenarioDir)) {
        this.copyScenarioFixtures(scenarioDir);
      }
    }
    
    // Copy base .jumpstart config
    this.copyJumpstartConfig();
    
    this.log(`Workspace initialized: ${this.workspaceDir}`, 'success');
  }
  
  copyScenarioFixtures(scenarioDir) {
    // Copy scenario config
    const configFile = path.join(scenarioDir, 'config.yaml');
    if (fs.existsSync(configFile)) {
      fs.copyFileSync(configFile, path.join(this.workspaceDir, '.jumpstart', 'config.yaml'));
    }
    
    // Copy any pre-existing artifacts (for testing later phases)
    for (const phase of AGENT_PHASES) {
      const phaseDir = path.join(scenarioDir, `0${AGENT_PHASES.indexOf(phase) + 1}-${phase}`);
      if (fs.existsSync(phaseDir)) {
        const files = fs.readdirSync(phaseDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const src = path.join(phaseDir, file);
            const isInsights = file.includes('insights');
            const dest = isInsights
              ? path.join(this.workspaceDir, 'specs', 'insights', file)
              : path.join(this.workspaceDir, 'specs', file);
            fs.copyFileSync(src, dest);
          }
        }
      }
    }
  }
  
  copyJumpstartConfig() {
    // Copy essential .jumpstart files
    const filesToCopy = ['config.yaml', 'roadmap.md', 'glossary.md'];
    const srcJumpstart = path.join(ROOT_DIR, '.jumpstart');
    const destJumpstart = path.join(this.workspaceDir, '.jumpstart');
    
    for (const file of filesToCopy) {
      const src = path.join(srcJumpstart, file);
      const dest = path.join(destJumpstart, file);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
      }
    }
    
    // Copy agents directory
    const srcAgents = path.join(srcJumpstart, 'agents');
    const destAgents = path.join(destJumpstart, 'agents');
    if (fs.existsSync(srcAgents)) {
      if (!fs.existsSync(destAgents)) {
        fs.mkdirSync(destAgents, { recursive: true });
      }
      const agentFiles = fs.readdirSync(srcAgents);
      for (const file of agentFiles) {
        const src = path.join(srcAgents, file);
        const dest = path.join(destAgents, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
    }
  }
  
  async initializeProviders(agentName) {
    // Initialize agent provider
    this.agentProvider = createProvider({
      model: this.options.model,
      mode: this.options.mock ? 'mock' : 'live',
      mockResponses: this.mockRegistry,
      reasoningEffort: DEFAULT_CONFIG.reasoningEffort
    });
    
    // Initialize user proxy provider (only needed for live mode)
    if (!this.options.mock) {
      this.proxyProvider = createProvider({
        model: this.options.proxyModel,
        mode: 'live',
        reasoningEffort: 'low'
      });
    }
    
    // Initialize tool bridge with user proxy callback
    this.toolBridge = createToolBridge({
      workspaceDir: this.workspaceDir,
      tracer: this.tracer,
      dryRun: this.options.dryRun,
      onUserProxyCall: this.options.mock 
        ? null  // Use default mock behavior
        : (args) => this.callUserProxy(args)
    });
  }
  
  loadAgentPrompt(agentName) {
    const agentFile = path.join(AGENTS_DIR, `${agentName}.md`);
    
    if (!fs.existsSync(agentFile)) {
      throw new Error(`Agent file not found: ${agentFile}`);
    }
    
    return fs.readFileSync(agentFile, 'utf8');
  }
  
  loadPersonaPrompt() {
    const personaFile = path.join(PERSONAS_DIR, `${this.options.persona}.md`);
    
    if (!fs.existsSync(personaFile)) {
      // Use default compliant user
      const defaultFile = path.join(PERSONAS_DIR, 'compliant-user.md');
      if (fs.existsSync(defaultFile)) {
        return fs.readFileSync(defaultFile, 'utf8');
      }
      // Inline fallback
      return `You are a cooperative user who approves requests and picks sensible defaults.
When asked for approval, say "Approved".
When asked to choose, pick the recommended option or the first option.
Be brief and supportive.`;
    }
    
    return fs.readFileSync(personaFile, 'utf8');
  }
  
  async callUserProxy(askQuestionsArgs) {
    // In mock mode, this isn't called (tool bridge handles it)
    // In live mode, we call the User Proxy LLM
    
    const questionText = this.formatQuestionsForProxy(askQuestionsArgs);
    
    this.userProxyHistory.push({
      role: 'user',
      content: questionText
    });
    
    this.log(`[Agent asks] ${askQuestionsArgs.questions.map(q => q.header).join(', ')}`, 'debug');
    
    const response = await this.proxyProvider.completion(this.userProxyHistory);
    const proxyAnswer = response.choices[0].message.content;
    
    this.userProxyHistory.push({
      role: 'assistant',
      content: proxyAnswer
    });
    
    this.log(`[User Proxy] ${proxyAnswer.substring(0, 100)}...`, 'debug');
    
    // Log to tracer
    if (this.tracer.logUserProxyExchange) {
      this.tracer.logUserProxyExchange(askQuestionsArgs, proxyAnswer);
    }
    
    // Parse proxy answer into structured format
    return this.parseProxyResponse(askQuestionsArgs, proxyAnswer);
  }
  
  formatQuestionsForProxy(args) {
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
  
  parseProxyResponse(args, proxyAnswer) {
    const answers = {};
    const answerLower = proxyAnswer.toLowerCase();
    
    for (const q of args.questions) {
      if (q.options && q.options.length > 0) {
        // Find which option was selected
        let selected = [];
        
        for (const opt of q.options) {
          if (answerLower.includes(opt.label.toLowerCase())) {
            selected.push(opt.label);
            if (!q.multiSelect) break;
          }
        }
        
        // If no match, take recommended or first
        if (selected.length === 0) {
          const rec = q.options.find(o => o.recommended) || q.options[0];
          selected = [rec.label];
        }
        
        answers[q.header] = {
          selected: selected,
          freeText: q.allowFreeformInput ? proxyAnswer : null,
          skipped: false
        };
      } else {
        // Free text
        answers[q.header] = {
          selected: [],
          freeText: proxyAnswer,
          skipped: false
        };
      }
    }
    
    return { answers };
  }
  
  async runAgent(agentName) {
    this.log(`\n${'═'.repeat(60)}`, 'info');
    this.log(`Running agent: ${chalk.bold(agentName)}`, 'info');
    this.log(`${'═'.repeat(60)}`, 'info');
    
    this.tracer.startPhase(agentName);
    
    // Initialize providers for this agent
    await this.initializeProviders(agentName);
    
    // Load prompts
    const agentPrompt = this.loadAgentPrompt(agentName);
    const personaPrompt = this.loadPersonaPrompt();
    
    // Initialize conversation histories
    this.conversationHistory = [
      { role: 'system', content: agentPrompt }
    ];
    
    this.userProxyHistory = [
      { role: 'system', content: personaPrompt }
    ];
    
    // Get tools for this phase
    const tools = getToolsForPhase(agentName);
    
    // Add initial user message to start the agent
    const startMessage = this.getAgentStartMessage(agentName);
    this.conversationHistory.push({ role: 'user', content: startMessage });
    
    // Main conversation loop
    this.turnCount = 0;
    let sessionActive = true;
    let finalStatus = 'PASS';
    
    while (sessionActive && this.turnCount < this.options.maxTurns) {
      this.turnCount++;
      this.log(`Turn ${this.turnCount}/${this.options.maxTurns}`, 'debug');
      
      try {
        // Call agent LLM
        const response = await this.agentProvider.completion(
          this.conversationHistory,
          tools
        );
        
        const message = response.choices[0].message;
        this.conversationHistory.push(message);
        
        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            this.log(`Tool: ${toolCall.function.name}`, 'debug');
            
            const result = await this.toolBridge.execute(toolCall);
            this.conversationHistory.push(result);
          }
        } else if (message.content) {
          // Text response
          this.log(`Agent: ${message.content.substring(0, 100)}...`, 'debug');
          
          // Check for phase completion
          if (this.isPhaseComplete(message.content)) {
            this.log(`Phase ${agentName} complete!`, 'success');
            sessionActive = false;
          }
        }
        
      } catch (error) {
        this.log(`Error: ${error.message}`, 'error');
        finalStatus = 'FAIL';
        sessionActive = false;
      }
    }
    
    if (this.turnCount >= this.options.maxTurns) {
      this.log(`Max turns reached (${this.options.maxTurns})`, 'warn');
      finalStatus = 'INCOMPLETE';
    }
    
    this.tracer.endPhase(agentName, finalStatus);
    
    // Log usage
    const usage = this.agentProvider.getUsage();
    this.log(`Usage: ${usage.totalTokens} tokens, ${usage.calls} calls`, 'info');
    
    return finalStatus;
  }
  
  getAgentStartMessage(agentName) {
    const activations = {
      scout: 'Run /jumpstart.scout to analyze this codebase.',
      challenger: 'Run /jumpstart.challenge. The problem I want to solve is: Build a modern web application.',
      analyst: 'Run /jumpstart.analyze. Please create the product brief based on the challenger brief.',
      pm: 'Run /jumpstart.plan. Please create the PRD based on the product brief.',
      architect: 'Run /jumpstart.architect. Please create the architecture and implementation plan.',
      developer: 'Run /jumpstart.build. Please implement the first task from the implementation plan.'
    };
    
    return activations[agentName] || `Run /jumpstart.${agentName}`;
  }
  
  isPhaseComplete(content) {
    const completionSignals = [
      'phase gate approval',
      'artifact is ready for review',
      'please review and approve',
      'awaiting your approval',
      'submitted for approval'
    ];
    
    const lowerContent = content.toLowerCase();
    return completionSignals.some(signal => lowerContent.includes(signal));
  }
  
  async run() {
    const startTime = Date.now();
    this.log('Starting headless runner...', 'info');
    this.log(`Mode: ${this.options.mock ? 'MOCK' : 'LIVE'}`, 'info');
    this.log(`Agents: ${this.options.agents.join(', ')}`, 'info');
    this.log(`Persona: ${this.options.persona}`, 'info');
    
    await this.setup();
    
    const results = {};
    
    for (const agent of this.options.agents) {
      if (!AGENT_PHASES.includes(agent)) {
        this.log(`Unknown agent: ${agent}. Skipping.`, 'warn');
        continue;
      }
      
      results[agent] = await this.runAgent(agent);
    }
    
    // Generate report
    const report = this.tracer.generateReport();
    report.runtime = {
      total_ms: Date.now() - startTime,
      mode: this.options.mock ? 'mock' : 'live',
      model: this.options.model,
      persona: this.options.persona
    };
    report.results = results;
    
    // Save report
    const reportPath = path.join(
      REPORTS_DIR, 
      `headless-${this.options.scenario || 'run'}-${Date.now()}.json`
    );
    
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    this.log(`Report saved: ${reportPath}`, 'success');
    
    // Summary
    const passed = Object.values(results).filter(r => r === 'PASS').length;
    const total = Object.keys(results).length;
    
    console.log('\n' + '═'.repeat(60));
    console.log(chalk.bold('Summary'));
    console.log('═'.repeat(60));
    console.log(`Agents run: ${total}`);
    console.log(`Passed: ${chalk.green(passed)}`);
    console.log(`Failed: ${chalk.red(total - passed)}`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log(`Output: ${this.workspaceDir}`);
    
    return passed === total ? 0 : 1;
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    process.exit(0);
  }
  
  if (options.agents.length === 0) {
    console.error(chalk.red('Error: No agents specified. Use --agent <names>'));
    showHelp();
    process.exit(1);
  }
  
  const runner = new HeadlessRunner(options);
  const exitCode = await runner.run();
  process.exit(exitCode);
}

main().catch(error => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
