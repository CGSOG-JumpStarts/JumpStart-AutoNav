/**
 * ci-cd-integration.ts — GitHub Actions / Azure DevOps CI/CD integration port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/ci-cd-integration.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `SUPPORTED_PLATFORMS` (constant array)
 *   - `PIPELINE_STAGES` (constant array)
 *   - `BUILT_IN_CHECKS` (constant array)
 *   - `defaultState()` / `loadState()` / `saveState()`
 *   - `generatePipeline(platform, options?)` => GenerateResult
 *   - `validatePipeline(root, options?)` => ValidateResult
 *   - `getStatus(options?)` => StatusResult
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/ci-cd-integration.json`.
 *   - Returns YAML-shaped JSON for both GitHub Actions and Azure DevOps,
 *     emitting only the stages that have at least one matching check.
 *   - JSON parse failures load defaults silently.
 *   - JSON shape validation rejects `__proto__` / `constructor` / `prototype`.
 *
 * @see bin/lib/ci-cd-integration.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Platform = 'github-actions' | 'azure-devops';
export type PipelineStage = 'validate' | 'drift-check' | 'review' | 'approve' | 'promote';

export interface BuiltInCheck {
  id: string;
  name: string;
  stage: PipelineStage;
  command: string;
}

export interface CICDState {
  version: string;
  created_at: string;
  last_updated: string | null;
  platform: string | null;
  pipelines: unknown[];
  run_history: unknown[];
}

export interface GenerateOptions {
  checks?: BuiltInCheck[];
  stages?: PipelineStage[];
}

export interface GenerateResult {
  success: boolean;
  platform?: string;
  format?: string;
  content?: Record<string, unknown>;
  path?: string;
  error?: string;
}

export interface ValidateResult {
  success: boolean;
  pipelines: Array<{
    platform: string;
    path: string;
    exists: boolean;
    up_to_date: boolean;
    expected_checks: number;
  }>;
  all_configured: boolean;
  recommendations: string[];
}

export interface StatusResult {
  success: boolean;
  platform: string | null;
  pipelines: number;
  last_run: unknown;
  total_runs: number;
  available_checks: number;
}

export interface StateOptions {
  stateFile?: string;
}

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'ci-cd-integration.json');

export const SUPPORTED_PLATFORMS: Platform[] = ['github-actions', 'azure-devops'];

export const PIPELINE_STAGES: PipelineStage[] = [
  'validate',
  'drift-check',
  'review',
  'approve',
  'promote',
];

export const BUILT_IN_CHECKS: BuiltInCheck[] = [
  {
    id: 'schema-validation',
    name: 'Schema Validation',
    stage: 'validate',
    command: 'jumpstart-mode validate-all',
  },
  {
    id: 'spec-drift',
    name: 'Spec Drift Detection',
    stage: 'drift-check',
    command: 'jumpstart-mode spec-drift',
  },
  {
    id: 'coverage-check',
    name: 'Story-to-Task Coverage',
    stage: 'validate',
    command: 'jumpstart-mode coverage',
  },
  {
    id: 'secret-scan',
    name: 'Secret Scanning',
    stage: 'validate',
    command: 'jumpstart-mode scan-secrets',
  },
  {
    id: 'freshness-audit',
    name: 'Documentation Freshness',
    stage: 'review',
    command: 'jumpstart-mode freshness-audit',
  },
  {
    id: 'policy-check',
    name: 'Policy Compliance',
    stage: 'review',
    command: 'jumpstart-mode policy check',
  },
  { id: 'quality-gate', name: 'Quality Gate', stage: 'approve', command: 'npm test' },
];

export function defaultState(): CICDState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    platform: null,
    pipelines: [],
    run_history: [],
  };
}

function _safeParseState(content: string): CICDState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
  }
  const base = defaultState();
  return {
    ...base,
    ...obj,
    pipelines: Array.isArray(obj.pipelines) ? obj.pipelines : [],
    run_history: Array.isArray(obj.run_history) ? obj.run_history : [],
  };
}

export function loadState(stateFile?: string): CICDState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = _safeParseState(readFileSync(filePath, 'utf8'));
  return parsed || defaultState();
}

export function saveState(state: CICDState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Generate a CI/CD pipeline configuration.
 */
export function generatePipeline(platform: string, options: GenerateOptions = {}): GenerateResult {
  if (!SUPPORTED_PLATFORMS.includes(platform as Platform)) {
    return {
      success: false,
      error: `Unsupported platform: ${platform}. Use: ${SUPPORTED_PLATFORMS.join(', ')}`,
    };
  }

  const checks = options.checks || BUILT_IN_CHECKS;
  const stages = options.stages || PIPELINE_STAGES;

  if (platform === 'github-actions') {
    const workflow: Record<string, unknown> = {
      name: 'JumpStart Quality Gate',
      on: {
        pull_request: { paths: ['specs/**', '.jumpstart/**', 'src/**', 'tests/**'] },
        push: { branches: ['main'], paths: ['specs/**', '.jumpstart/**'] },
      },
      jobs: {} as Record<string, unknown>,
    };
    const jobs = workflow.jobs as Record<string, unknown>;

    for (const stage of stages) {
      const stageChecks = checks.filter((c) => c.stage === stage);
      if (stageChecks.length === 0) continue;
      jobs[stage] = {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          { uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
          { run: 'npm ci' },
          ...stageChecks.map((c) => ({ name: c.name, run: `npx ${c.command}` })),
        ],
      };
    }

    return {
      success: true,
      platform,
      format: 'yaml',
      content: workflow,
      path: '.github/workflows/jumpstart-quality.yml',
    };
  }

  if (platform === 'azure-devops') {
    const pipeline = {
      trigger: { branches: { include: ['main'] }, paths: { include: ['specs/*', '.jumpstart/*'] } },
      pool: { vmImage: 'ubuntu-latest' },
      stages: stages.map((stage) => ({
        stage,
        displayName: stage.charAt(0).toUpperCase() + stage.slice(1),
        jobs: [
          {
            job: `${stage}_checks`,
            steps: [
              { task: 'NodeTool@0', inputs: { versionSpec: '20.x' } },
              { script: 'npm ci', displayName: 'Install dependencies' },
              ...checks
                .filter((c) => c.stage === stage)
                .map((c) => ({
                  script: `npx ${c.command}`,
                  displayName: c.name,
                })),
            ],
          },
        ],
      })),
    };

    return {
      success: true,
      platform,
      format: 'yaml',
      content: pipeline,
      path: 'azure-pipelines.yml',
    };
  }

  return { success: false, error: 'Unknown platform' };
}

/**
 * Validate that pipeline configuration is up to date.
 */
export function validatePipeline(root: string, options: GenerateOptions = {}): ValidateResult {
  const results: ValidateResult['pipelines'] = [];

  for (const platform of SUPPORTED_PLATFORMS) {
    const generated = generatePipeline(platform, options);
    if (!generated.success || !generated.path) continue;

    const pipelinePath = join(root, generated.path);
    const exists = existsSync(pipelinePath);

    results.push({
      platform,
      path: generated.path,
      exists,
      up_to_date: exists,
      expected_checks: (options.checks || BUILT_IN_CHECKS).length,
    });
  }

  return {
    success: true,
    pipelines: results,
    all_configured: results.some((r) => r.exists),
    recommendations: results
      .filter((r) => !r.exists)
      .map((r) => `Configure ${r.platform} pipeline at ${r.path}`),
  };
}

/**
 * Get integration status summary.
 */
export function getStatus(options: StateOptions = {}): StatusResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    platform: state.platform,
    pipelines: state.pipelines.length,
    last_run: state.run_history.length > 0 ? state.run_history[state.run_history.length - 1] : null,
    total_runs: state.run_history.length,
    available_checks: BUILT_IN_CHECKS.length,
  };
}
