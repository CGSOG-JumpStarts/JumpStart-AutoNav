/**
 * test-headless.test.js — Integration tests for headless agent emulation
 * 
 * Tests the core components of the headless runner:
 * - LLM Provider (mock mode)
 * - Tool Bridge
 * - Mock Response Registry
 * - Tool Schemas
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createProvider, listModels, getModelConfig } = require('../bin/lib/llm-provider');
const { createToolBridge } = require('../bin/lib/tool-bridge');
const { createMockRegistry, createPersonaRegistry } = require('../bin/lib/mock-responses');
const { getToolsForPhase, getToolByName, ALL_TOOLS } = require('../bin/lib/tool-schemas');
const { SimulationTracer } = require('../bin/lib/simulation-tracer');

// ─── Test Fixtures ───────────────────────────────────────────────────────────

let tempDir;

beforeEach(() => {
  // Create temp directory for file operation tests
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headless-test-'));
  
  // Create test file
  fs.writeFileSync(path.join(tempDir, 'test.txt'), 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
  fs.mkdirSync(path.join(tempDir, 'subdir'));
  fs.writeFileSync(path.join(tempDir, 'subdir', 'nested.js'), 'console.log("test");');
});

afterEach(() => {
  // Clean up temp directory
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ─── LLM Provider Tests ──────────────────────────────────────────────────────

describe('LLM Provider', () => {
  describe('Model Registry', () => {
    it('lists available models', () => {
      const models = listModels();
      expect(models).toBeInstanceOf(Array);
      expect(models.length).toBeGreaterThan(0);
      expect(models).toContain('openai/gpt-5.2');
      expect(models).toContain('anthropic/claude-opus-4-5');
      expect(models).toContain('gemini/gemini-3-flash-preview');
    });
    
    it('gets model configuration', () => {
      const config = getModelConfig('openai/gpt-5-mini');
      expect(config).toBeDefined();
      expect(config.provider).toBe('openai');
      expect(config.apiModel).toBe('gpt-5-mini');
      expect(config.supportsTools).toBe(true);
    });
    
    it('returns null for unknown model', () => {
      const config = getModelConfig('unknown/model');
      expect(config).toBeNull();
    });
  });
  
  describe('Mock Mode', () => {
    it('creates provider in mock mode', () => {
      const provider = createProvider({
        model: 'openai/gpt-4o',
        mode: 'mock'
      });
      expect(provider).toBeDefined();
      expect(provider.mode).toBe('mock');
    });
    
    it('returns mock completion without API call', async () => {
      const provider = createProvider({
        model: 'openai/gpt-4o',
        mode: 'mock'
      });
      
      const response = await provider.completion([
        { role: 'user', content: 'Hello' }
      ]);
      
      expect(response).toBeDefined();
      expect(response.choices).toBeInstanceOf(Array);
      expect(response.choices[0].message.role).toBe('assistant');
    });
    
    it('tracks usage in mock mode', async () => {
      const provider = createProvider({
        model: 'openai/gpt-4o',
        mode: 'mock'
      });
      
      await provider.completion([{ role: 'user', content: 'Test' }]);
      await provider.completion([{ role: 'user', content: 'Test 2' }]);
      
      const usage = provider.getUsage();
      expect(usage.calls).toBe(2);
      expect(usage.totalTokens).toBeGreaterThan(0);
    });
  });
});

// ─── Tool Bridge Tests ───────────────────────────────────────────────────────

describe('Tool Bridge', () => {
  let bridge;
  
  beforeEach(() => {
    bridge = createToolBridge({
      workspaceDir: tempDir,
      dryRun: false
    });
  });
  
  describe('File Operations', () => {
    it('reads file content', async () => {
      const result = await bridge.execute({
        id: 'call-1',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({
            filePath: path.join(tempDir, 'test.txt'),
            startLine: 1,
            endLine: 3
          })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.error).toBeUndefined();
      expect(content.content).toContain('Line 1');
      expect(content.content).toContain('Line 3');
      expect(content.totalLines).toBe(6); // Including trailing newline
    });
    
    it('creates new file', async () => {
      const newFilePath = path.join(tempDir, 'new-file.txt');
      
      const result = await bridge.execute({
        id: 'call-2',
        function: {
          name: 'create_file',
          arguments: JSON.stringify({
            filePath: newFilePath,
            content: 'New content'
          })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.success).toBe(true);
      expect(fs.existsSync(newFilePath)).toBe(true);
      expect(fs.readFileSync(newFilePath, 'utf8')).toBe('New content');
    });
    
    it('creates nested directories', async () => {
      const nestedPath = path.join(tempDir, 'a', 'b', 'c', 'file.txt');
      
      await bridge.execute({
        id: 'call-3',
        function: {
          name: 'create_file',
          arguments: JSON.stringify({
            filePath: nestedPath,
            content: 'Nested'
          })
        }
      });
      
      expect(fs.existsSync(nestedPath)).toBe(true);
    });
    
    it('lists directory contents', async () => {
      const result = await bridge.execute({
        id: 'call-4',
        function: {
          name: 'list_dir',
          arguments: JSON.stringify({ path: tempDir })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.items).toBeInstanceOf(Array);
      expect(content.items.find(i => i.name === 'test.txt')).toBeDefined();
      expect(content.items.find(i => i.name === 'subdir/')).toBeDefined();
    });
    
    it('replaces string in file', async () => {
      const result = await bridge.execute({
        id: 'call-5',
        function: {
          name: 'replace_string_in_file',
          arguments: JSON.stringify({
            filePath: path.join(tempDir, 'test.txt'),
            oldString: 'Line 2',
            newString: 'Modified Line 2'
          })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.success).toBe(true);
      
      const fileContent = fs.readFileSync(path.join(tempDir, 'test.txt'), 'utf8');
      expect(fileContent).toContain('Modified Line 2');
    });
  });
  
  describe('Search Operations', () => {
    it('searches files by glob pattern', async () => {
      const result = await bridge.execute({
        id: 'call-6',
        function: {
          name: 'file_search',
          arguments: JSON.stringify({ query: '**/*.js' })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.matches).toBeInstanceOf(Array);
      expect(content.matches.some(m => m.includes('nested.js'))).toBe(true);
    });
    
    it('does grep search', async () => {
      const result = await bridge.execute({
        id: 'call-7',
        function: {
          name: 'grep_search',
          arguments: JSON.stringify({
            query: 'console',
            isRegexp: false
          })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.results).toBeInstanceOf(Array);
      expect(content.results.length).toBeGreaterThan(0);
      expect(content.results[0].content).toContain('console');
    });
  });
  
  describe('ask_questions Handler', () => {
    it('returns default answers when no proxy', async () => {
      const result = await bridge.execute({
        id: 'call-8',
        function: {
          name: 'ask_questions',
          arguments: JSON.stringify({
            questions: [{
              header: 'TechChoice',
              question: 'Which tech?',
              options: [
                { label: 'Option A', recommended: true },
                { label: 'Option B' }
              ]
            }]
          })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.answers).toBeDefined();
      expect(content.answers.TechChoice.selected).toContain('Option A'); // Recommended
    });
    
    it('routes to user proxy callback when provided', async () => {
      let proxyCalledWith = null;
      
      const bridgeWithProxy = createToolBridge({
        workspaceDir: tempDir,
        onUserProxyCall: async (args) => {
          proxyCalledWith = args;
          return {
            answers: {
              TestHeader: { selected: ['Custom Answer'], freeText: null, skipped: false }
            }
          };
        }
      });
      
      const result = await bridgeWithProxy.execute({
        id: 'call-9',
        function: {
          name: 'ask_questions',
          arguments: JSON.stringify({
            questions: [{
              header: 'TestHeader',
              question: 'Test question?',
              options: [{ label: 'Custom Answer' }]
            }]
          })
        }
      });
      
      expect(proxyCalledWith).toBeDefined();
      expect(proxyCalledWith.questions[0].header).toBe('TestHeader');
      
      const content = JSON.parse(result.content);
      expect(content.answers.TestHeader.selected).toContain('Custom Answer');
    });
  });
  
  describe('manage_todo_list Handler', () => {
    it('tracks todo state', async () => {
      await bridge.execute({
        id: 'call-10',
        function: {
          name: 'manage_todo_list',
          arguments: JSON.stringify({
            todoList: [
              { id: 1, title: 'Task 1', status: 'completed' },
              { id: 2, title: 'Task 2', status: 'in-progress' }
            ]
          })
        }
      });
      
      const state = bridge.getTodoState();
      expect(state.length).toBe(2);
      expect(state[0].status).toBe('completed');
    });
  });
  
  describe('Dry Run Mode', () => {
    it('does not write files in dry run', async () => {
      const dryBridge = createToolBridge({
        workspaceDir: tempDir,
        dryRun: true
      });
      
      const newFilePath = path.join(tempDir, 'dry-run-file.txt');
      
      const result = await dryBridge.execute({
        id: 'call-11',
        function: {
          name: 'create_file',
          arguments: JSON.stringify({
            filePath: newFilePath,
            content: 'Should not exist'
          })
        }
      });
      
      const content = JSON.parse(result.content);
      expect(content.dryRun).toBe(true);
      expect(fs.existsSync(newFilePath)).toBe(false);
    });
  });
  
  describe('Call History', () => {
    it('tracks call history', async () => {
      await bridge.execute({
        id: 'call-12',
        function: { name: 'list_dir', arguments: JSON.stringify({ path: tempDir }) }
      });
      
      await bridge.execute({
        id: 'call-13',
        function: { 
          name: 'read_file', 
          arguments: JSON.stringify({ 
            filePath: path.join(tempDir, 'test.txt'),
            startLine: 1,
            endLine: 1
          }) 
        }
      });
      
      const history = bridge.getCallHistory();
      expect(history.length).toBe(2);
      expect(history[0].name).toBe('list_dir');
      expect(history[1].name).toBe('read_file');
    });
  });
});

// ─── Mock Response Registry Tests ────────────────────────────────────────────

describe('Mock Response Registry', () => {
  it('provides default ask_questions responses', () => {
    const registry = createMockRegistry();
    
    const response = registry.getAskQuestionsResponse({
      questions: [{
        header: 'TechPrefs',
        question: 'Which stack?',
        options: [{ label: 'Node.js' }, { label: 'Python' }]
      }]
    });
    
    expect(response.answers.TechPrefs.selected).toContain('Node.js with Express');
  });
  
  it('falls back to recommended option', () => {
    const registry = createMockRegistry();
    
    const response = registry.getAskQuestionsResponse({
      questions: [{
        header: 'UnknownQuestion',
        question: 'Unknown?',
        options: [
          { label: 'A' },
          { label: 'B', recommended: true },
          { label: 'C' }
        ]
      }]
    });
    
    expect(response.answers.UnknownQuestion.selected).toContain('B');
  });
  
  it('creates persona-specific registry', () => {
    const registry = createPersonaRegistry('enterprise-user');
    
    const response = registry.getAskQuestionsResponse({
      questions: [{
        header: 'TechPrefs',
        question: 'Which stack?',
        options: [{ label: 'Java' }, { label: 'Node.js' }]
      }]
    });
    
    expect(response.answers.TechPrefs.selected).toContain('Java with Spring Boot');
  });
  
  it('allows custom responses', () => {
    const registry = createMockRegistry();
    registry.setAskQuestionsResponse('CustomKey', {
      selected: ['Custom Value'],
      freeText: null,
      skipped: false
    });
    
    const response = registry.getAskQuestionsResponse({
      questions: [{
        header: 'CustomKey',
        question: 'Custom?',
        options: [{ label: 'Custom Value' }]
      }]
    });
    
    expect(response.answers.CustomKey.selected).toContain('Custom Value');
  });
  
  it('tracks call count', () => {
    const registry = createMockRegistry();
    expect(registry.getCallCount()).toBe(0);
    
    registry.getAskQuestionsResponse({ questions: [{ header: 'A', question: 'Q?' }] });
    registry.getAskQuestionsResponse({ questions: [{ header: 'B', question: 'Q?' }] });
    
    expect(registry.getCallCount()).toBe(2);
  });
});

// ─── Tool Schemas Tests ──────────────────────────────────────────────────────

describe('Tool Schemas', () => {
  it('exports all tools', () => {
    expect(ALL_TOOLS).toBeInstanceOf(Array);
    expect(ALL_TOOLS.length).toBeGreaterThan(5);
  });
  
  it('gets tools for architect phase', () => {
    const tools = getToolsForPhase('architect');
    expect(tools).toBeInstanceOf(Array);
    
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain('ask_questions');
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('create_file');
  });
  
  it('gets tools for developer phase', () => {
    const tools = getToolsForPhase('developer');
    expect(tools).toBeInstanceOf(Array);
    
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain('run_in_terminal');
  });
  
  it('finds tool by name', () => {
    const tool = getToolByName('ask_questions');
    expect(tool).toBeDefined();
    expect(tool.function.name).toBe('ask_questions');
    expect(tool.function.parameters.properties.questions).toBeDefined();
  });
  
  it('returns null for unknown tool', () => {
    const tool = getToolByName('unknown_tool');
    expect(tool).toBeNull();
  });
  
  it('ask_questions schema has correct structure', () => {
    const tool = getToolByName('ask_questions');
    const params = tool.function.parameters;
    
    expect(params.properties.questions).toBeDefined();
    expect(params.properties.questions.type).toBe('array');
    expect(params.properties.questions.items.properties.header).toBeDefined();
    expect(params.properties.questions.items.properties.question).toBeDefined();
    expect(params.properties.questions.items.properties.options).toBeDefined();
  });
});

// ─── Simulation Tracer Tests ─────────────────────────────────────────────────

describe('Simulation Tracer', () => {
  let tracer;
  
  beforeEach(() => {
    tracer = new SimulationTracer(tempDir, 'test-scenario');
  });
  
  it('tracks phases', () => {
    tracer.startPhase('architect');
    tracer.logArtifact('architecture.md');
    tracer.endPhase('architect', 'PASS');
    
    const report = tracer.getReport();
    expect(report.phases.length).toBe(1);
    expect(report.phases[0].name).toBe('architect');
    expect(report.phases[0].status).toBe('PASS');
    expect(report.phases[0].artifacts).toContain('architecture.md');
  });
  
  it('tracks LLM calls', () => {
    tracer.startPhase('test');
    tracer.logLLMCall('openai/gpt-4o', 100, 50, 0.01);
    tracer.logLLMCall('openai/gpt-4o', 200, 100, 0.02);
    tracer.endPhase('test', 'PASS');
    
    const usage = tracer.getLLMUsageSummary();
    expect(usage.totalCalls).toBe(2);
    expect(usage.totalPromptTokens).toBe(300);
    expect(usage.totalCompletionTokens).toBe(150);
    expect(usage.byModel['openai/gpt-4o'].calls).toBe(2);
  });
  
  it('tracks tool interceptions', () => {
    tracer.startPhase('test');
    tracer.logToolInterception('read_file', { path: '/test' }, { content: 'data' });
    tracer.endPhase('test', 'PASS');
    
    const transcript = tracer.getConversationTranscript();
    expect(transcript.length).toBeGreaterThan(0);
    expect(transcript.some(t => t.type === 'tool_call')).toBe(true);
  });
  
  it('tracks user proxy exchanges', () => {
    tracer.startPhase('test');
    tracer.logUserProxyExchange(
      { questions: [{ header: 'Test', question: 'Q?' }] },
      'Approved'
    );
    tracer.endPhase('test', 'PASS');
    
    const transcript = tracer.getConversationTranscript();
    expect(transcript.some(t => t.type === 'user_proxy_question')).toBe(true);
    expect(transcript.some(t => t.type === 'user_proxy_response')).toBe(true);
  });
  
  it('includes headless data in report', () => {
    tracer.startPhase('test');
    tracer.logLLMCall('openai/gpt-4o', 100, 50);
    tracer.logToolInterception('list_dir', {}, {});
    tracer.endPhase('test', 'PASS');
    
    const report = tracer.getReport();
    expect(report.headless).toBeDefined();
    expect(report.headless.llm_usage.totalCalls).toBe(1);
    expect(report.headless.tool_interceptions).toBe(1);
  });
  
  it('generateReport is alias for getReport', () => {
    tracer.startPhase('test');
    tracer.endPhase('test', 'PASS');
    
    const report1 = tracer.getReport();
    const report2 = tracer.generateReport();
    
    expect(report1.scenario).toBe(report2.scenario);
    expect(report1.phases.length).toBe(report2.phases.length);
  });
});
