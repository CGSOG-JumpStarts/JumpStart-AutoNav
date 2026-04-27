/**
 * contract-first.ts — Contract-First Implementation Assistant port (T4.4.3, cluster L).
 *
 * Pure-library port of `bin/lib/contract-first.js`. Public surface
 * preserved verbatim by name + signature:
 *
 *   - `CONTRACT_TYPES` (constant array)
 *   - `extractContracts(root, options?)` => ExtractResult
 *   - `verifyCompliance(root, options?)` => VerifyResult
 *
 * Behavior parity:
 *   - Reads `<root>/specs/architecture.md` for contract definitions and
 *     `<root>/src/**` for implementation scan.
 *   - Uses `String.matchAll` to enumerate endpoint and event matches.
 *   - Default targets: REST, GraphQL, Event, gRPC, Message Queue.
 *
 * @see bin/lib/contract-first.js (legacy reference)
 * @see specs/implementation-plan.md T4.4.3
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ContractType = 'rest-api' | 'graphql' | 'event' | 'grpc' | 'message-queue';

export interface Contract {
  type: string;
  method?: string;
  path?: string;
  name?: string;
  line: number;
}

export interface ExtractOptions {
  [key: string]: unknown;
}

export interface ExtractResult {
  success: boolean;
  total_contracts?: number;
  contracts?: Contract[];
  by_type?: Record<string, number>;
  error?: string;
}

export interface VerifyResult {
  success: boolean;
  total_contracts?: number;
  implemented?: number;
  violations?: number;
  compliance?: number;
  findings?: Array<Contract & { issue: string }>;
  error?: string;
}

const ENDPOINT_REGEX = /(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w/{}:-]+/g;
const EVENT_REGEX = /(?:event|topic|queue)[\s:]+["']?([a-zA-Z0-9._-]+)/gi;

export const CONTRACT_TYPES: ContractType[] = [
  'rest-api',
  'graphql',
  'event',
  'grpc',
  'message-queue',
];

/**
 * Extract API contracts from architecture spec.
 */
export function extractContracts(root: string, _options: ExtractOptions = {}): ExtractResult {
  const archFile = join(root, 'specs', 'architecture.md');
  if (!existsSync(archFile)) {
    return { success: false, error: 'Architecture spec not found at specs/architecture.md' };
  }

  const content = readFileSync(archFile, 'utf8');
  const contracts: Contract[] = [];

  for (const m of content.matchAll(ENDPOINT_REGEX)) {
    const [method, ...pathParts] = m[0].split(/\s+/);
    contracts.push({
      type: 'rest-api',
      method,
      path: pathParts.join(' '),
      line: content.substring(0, m.index ?? 0).split('\n').length,
    });
  }

  for (const m of content.matchAll(EVENT_REGEX)) {
    contracts.push({
      type: 'event',
      name: m[1],
      line: content.substring(0, m.index ?? 0).split('\n').length,
    });
  }

  return {
    success: true,
    total_contracts: contracts.length,
    contracts,
    by_type: contracts.reduce<Record<string, number>>((acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1;
      return acc;
    }, {}),
  };
}

function _readSrcContent(srcDir: string): string {
  let srcContent = '';
  if (!existsSync(srcDir)) return srcContent;

  function readDir(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        readDir(join(dir, entry.name));
      } else if (entry.isFile() && /\.(js|ts|py)$/.test(entry.name)) {
        try {
          srcContent += `${readFileSync(join(dir, entry.name), 'utf8')}\n`;
        } catch {
          /* skip */
        }
      }
    }
  }
  readDir(srcDir);
  return srcContent;
}

/**
 * Verify that implementation matches contracts.
 */
export function verifyCompliance(root: string, options: ExtractOptions = {}): VerifyResult {
  const contractResult = extractContracts(root, options);
  if (!contractResult.success) return contractResult as VerifyResult;

  const srcContent = _readSrcContent(join(root, 'src'));

  const violations: Array<Contract & { issue: string }> = [];
  const implemented: Contract[] = [];

  for (const contract of contractResult.contracts || []) {
    if (contract.type === 'rest-api' && contract.path) {
      const pathPattern = contract.path.replace(/\{[^}]+\}/g, '[^/]+');
      const found = new RegExp(pathPattern).test(srcContent) || srcContent.includes(contract.path);
      if (found) implemented.push(contract);
      else violations.push({ ...contract, issue: 'Endpoint not found in source' });
    } else if (contract.type === 'event' && contract.name) {
      const found = srcContent.includes(contract.name);
      if (found) implemented.push(contract);
      else violations.push({ ...contract, issue: 'Event handler not found in source' });
    }
  }

  const total = contractResult.total_contracts || 0;
  return {
    success: true,
    total_contracts: total,
    implemented: implemented.length,
    violations: violations.length,
    compliance: total > 0 ? Math.round((implemented.length / total) * 100) : 100,
    findings: violations,
  };
}
