/**
 * incident-feedback.ts — incident-to-spec feedback loop port (T4.4.2, cluster I).
 *
 * Pure-library port of `bin/lib/incident-feedback.js`. Public surface
 * preserved verbatim:
 *
 *   - `defaultState()`, `loadState(stateFile?)`, `saveState(state, stateFile?)`
 *   - `logIncident(incident, options?)` => LogResult
 *   - `analyzeIncident(incidentId, options?)` => AnalysisResult
 *   - `generateReport(options?)` => IncidentReport
 *   - `INCIDENT_SEVERITIES`, `INCIDENT_CATEGORIES`
 *
 * Behavior parity:
 *   - Default state path: `.jumpstart/state/incidents.json`.
 *   - Severity-based recommendations preserved verbatim.
 *   - M3 hardening: shape-validated JSON; rejects __proto__.
 *
 * @see bin/lib/incident-feedback.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_FILE = join('.jumpstart', 'state', 'incidents.json');

export const INCIDENT_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export const INCIDENT_CATEGORIES = [
  'availability',
  'performance',
  'security',
  'data-loss',
  'functionality',
  'ux',
] as const;

export interface Incident {
  id: string;
  title: string;
  severity: string;
  category: string;
  description: string;
  root_cause: string | null;
  impact: string | null;
  spec_updates_generated: boolean;
  logged_at: string;
}

export interface SpecUpdate {
  incident_id: string;
  recommendations: Recommendation[];
  generated_at: string;
}

export interface IncidentState {
  version: string;
  created_at: string;
  last_updated: string | null;
  incidents: Incident[];
  spec_updates: SpecUpdate[];
}

export interface IncidentInput {
  title?: string;
  severity?: string;
  category?: string;
  description?: string;
  root_cause?: string;
  impact?: string;
}

export interface Recommendation {
  type: string;
  spec: string;
  update: string;
  priority: string;
}

export interface StateOptions {
  stateFile?: string;
}

export interface LogResult {
  success: boolean;
  incident?: Incident;
  error?: string;
}

export interface AnalysisResult {
  success: boolean;
  incident_id?: string;
  recommendations?: Recommendation[];
  total?: number;
  error?: string;
}

export interface IncidentReport {
  success: true;
  total_incidents: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  spec_updates_pending: number;
  total_spec_updates: number;
  incidents: Incident[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParseState(raw: string): IncidentState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }
  const data = parsed as Partial<IncidentState>;
  return {
    version: typeof data.version === 'string' ? data.version : '1.0.0',
    created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString(),
    last_updated: typeof data.last_updated === 'string' ? data.last_updated : null,
    incidents: Array.isArray(data.incidents) ? (data.incidents as Incident[]) : [],
    spec_updates: Array.isArray(data.spec_updates) ? (data.spec_updates as SpecUpdate[]) : [],
  };
}

export function defaultState(): IncidentState {
  return {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    last_updated: null,
    incidents: [],
    spec_updates: [],
  };
}

export function loadState(stateFile?: string): IncidentState {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  if (!existsSync(filePath)) return defaultState();
  const parsed = safeParseState(readFileSync(filePath, 'utf8'));
  return parsed ?? defaultState();
}

export function saveState(state: IncidentState, stateFile?: string): void {
  const filePath = stateFile || DEFAULT_STATE_FILE;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.last_updated = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function logIncident(incident: IncidentInput, options: StateOptions = {}): LogResult {
  if (!incident?.title || !incident.severity) {
    return { success: false, error: 'title and severity are required' };
  }

  if (!(INCIDENT_SEVERITIES as readonly string[]).includes(incident.severity)) {
    return {
      success: false,
      error: `Invalid severity. Must be one of: ${INCIDENT_SEVERITIES.join(', ')}`,
    };
  }

  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const inc: Incident = {
    id: `INC-${(state.incidents.length + 1).toString().padStart(4, '0')}`,
    title: incident.title,
    severity: incident.severity,
    category: incident.category || 'functionality',
    description: incident.description || '',
    root_cause: incident.root_cause || null,
    impact: incident.impact || null,
    spec_updates_generated: false,
    logged_at: new Date().toISOString(),
  };

  state.incidents.push(inc);
  saveState(state, stateFile);

  return { success: true, incident: inc };
}

export function analyzeIncident(incidentId: string, options: StateOptions = {}): AnalysisResult {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) return { success: false, error: `Incident not found: ${incidentId}` };

  const recommendations: Recommendation[] = [];

  if (incident.category === 'availability') {
    recommendations.push({
      type: 'nfr',
      spec: 'architecture.md',
      update: 'Add/update availability SLO',
      priority: 'high',
    });
    recommendations.push({
      type: 'requirement',
      spec: 'prd.md',
      update: 'Add monitoring requirement',
      priority: 'medium',
    });
  }
  if (incident.category === 'performance') {
    recommendations.push({
      type: 'nfr',
      spec: 'architecture.md',
      update: 'Add/update latency SLO',
      priority: 'high',
    });
  }
  if (incident.category === 'security') {
    recommendations.push({
      type: 'requirement',
      spec: 'prd.md',
      update: 'Add security hardening requirement',
      priority: 'critical',
    });
    recommendations.push({
      type: 'architecture',
      spec: 'architecture.md',
      update: 'Review security architecture',
      priority: 'high',
    });
  }
  if (incident.severity === 'sev1') {
    recommendations.push({
      type: 'architecture',
      spec: 'architecture.md',
      update: 'Add circuit breaker or failover',
      priority: 'critical',
    });
  }

  incident.spec_updates_generated = true;
  state.spec_updates.push({
    incident_id: incidentId,
    recommendations,
    generated_at: new Date().toISOString(),
  });
  saveState(state, stateFile);

  return {
    success: true,
    incident_id: incidentId,
    recommendations,
    total: recommendations.length,
  };
}

export function generateReport(options: StateOptions = {}): IncidentReport {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const state = loadState(stateFile);

  return {
    success: true,
    total_incidents: state.incidents.length,
    by_severity: state.incidents.reduce(
      (acc, i) => {
        acc[i.severity] = (acc[i.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    by_category: state.incidents.reduce(
      (acc, i) => {
        acc[i.category] = (acc[i.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    spec_updates_pending: state.incidents.filter((i) => !i.spec_updates_generated).length,
    total_spec_updates: state.spec_updates.length,
    incidents: state.incidents,
  };
}
