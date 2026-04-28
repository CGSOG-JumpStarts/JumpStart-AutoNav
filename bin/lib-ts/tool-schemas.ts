/**
 * tool-schemas.ts — OpenAI Function Calling Tool Schemas port (T4.6.3, M7).
 *
 * Pure-library port of `bin/lib/tool-schemas.js`. Public surface preserved
 * verbatim by name + signature shape:
 *
 *   - `ALL_TOOLS`              (constant array of OpenAI-style tool defs)
 *   - `getToolsForPhase(name)` => Tool[]
 *   - `getToolByName(name)`    => Tool | null
 *
 * Behavior parity:
 *   - 23 tool definitions — every legacy tool is preserved verbatim,
 *     including parameter shapes, required-field arrays, enums, and
 *     descriptions. This is the contract the headless-runner and
 *     holodeck rely on for OpenAI function-calling.
 *   - Phase-to-tool mapping (BASE_TOOLS + PHASE_TOOL_ADDITIONS) is
 *     identical to legacy: scout/challenger/analyst/pm get the base
 *     set; architect adds marketplace_install + 6 item-tagged
 *     features; developer adds run_in_terminal + 4 quality-gate
 *     tools on top of architect's set.
 *
 * **Type-safety hardening (NEW in this port).**
 *   The legacy file is untyped — every tool entry is a bare object
 *   literal with `parameters` shape ad-hoc. The TS port introduces:
 *     - `ToolFunction` (function name + description + parameters)
 *     - `Tool` (the OpenAI envelope: `{type: 'function', function: ...}`)
 *     - `ToolParameters` (JSON Schema-ish parameter shape)
 *   These names match the OpenAI SDK shape so downstream consumers
 *   (headless-runner during M7) can type their tool-call dispatcher.
 *
 * **No Zod schemas in this port.**
 *   Per the assignment note about "Special attention for tool-schemas":
 *   the legacy is OpenAI Function Calling JSON Schema (vendored format
 *   for the LLM), NOT runtime input validation. Converting these to
 *   Zod would break the OpenAI SDK contract — the SDK expects exactly
 *   this JSON shape on the wire. Runtime validation of tool-CALL
 *   ARGUMENTS at dispatch time is the responsibility of `tool-bridge.ts`
 *   (which validates per-call args against the same JSON schema). The
 *   structural integrity of `ALL_TOOLS` itself is asserted via the
 *   `Tool` interface — an OpenAI tool def with a typo here would fail
 *   typecheck at the constant-literal site.
 *
 * @see bin/lib/tool-schemas.js (legacy reference)
 * @see specs/implementation-plan.md T4.6.3
 */

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

/**
 * JSON-Schema-shaped parameter spec, in the form OpenAI's function
 * calling API expects on the wire. This intentionally mirrors the
 * OpenAI SDK's `FunctionParameters` rather than introducing a Zod
 * schema — the LLM endpoint receives this exact JSON.
 */
export interface ToolParameters {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  // Allow forward-compat fields without surfacing `any`.
  [key: string]: unknown;
}

export interface ToolFunction {
  name: string;
  description: string;
  parameters?: ToolParameters;
}

export interface Tool {
  type: 'function';
  function: ToolFunction;
}

// ─────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────

export const ALL_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path of the file to read.' },
          startLine: { type: 'number', description: 'Start line (1-based).' },
          endLine: { type: 'number', description: 'End line (1-based, inclusive).' },
        },
        required: ['filePath', 'startLine', 'endLine'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new file with specified content.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path of the file to create.' },
          content: { type: 'string', description: 'Content to write.' },
        },
        required: ['filePath', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_string_in_file',
      description: 'Replace a string in an existing file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path of the file to edit.' },
          oldString: { type: 'string', description: 'Exact text to find and replace.' },
          newString: { type: 'string', description: 'Replacement text.' },
        },
        required: ['filePath', 'oldString', 'newString'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List directory contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the directory.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_search',
      description: 'Search for files by glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Glob pattern to match files.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for text patterns in files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search pattern.' },
          isRegexp: { type: 'boolean', description: 'Whether query is a regex.' },
        },
        required: ['query', 'isRegexp'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Run a natural language search for relevant code.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_questions',
      description: 'Ask the user questions to clarify intent or choose between options.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'Array of questions to ask the user.',
            items: {
              type: 'object',
              properties: {
                header: { type: 'string', description: 'Short label for the question.' },
                question: { type: 'string', description: 'The question text.' },
                options: {
                  type: 'array',
                  description: 'Options for the user to choose from.',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'Option label.' },
                      description: { type: 'string', description: 'Option description.' },
                      recommended: { type: 'boolean', description: 'Mark as recommended.' },
                    },
                    required: ['label'],
                  },
                },
                multiSelect: { type: 'boolean', description: 'Allow multiple selections.' },
                allowFreeformInput: { type: 'boolean', description: 'Allow free text input.' },
              },
              required: ['header', 'question'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_todo_list',
      description: 'Manage a structured todo list to track progress.',
      parameters: {
        type: 'object',
        properties: {
          todoList: {
            type: 'array',
            description: 'Complete array of all todo items.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Unique identifier.' },
                title: { type: 'string', description: 'Todo label.' },
                status: {
                  type: 'string',
                  enum: ['not-started', 'in-progress', 'completed'],
                },
              },
              required: ['id', 'title', 'status'],
            },
          },
        },
        required: ['todoList'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_in_terminal',
      description: 'Execute a command in a terminal.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to run.' },
          explanation: { type: 'string', description: 'What the command does.' },
          goal: { type: 'string', description: 'Purpose of the command.' },
          isBackground: { type: 'boolean', description: 'Run as background process.' },
          timeout: { type: 'number', description: 'Timeout in milliseconds.' },
        },
        required: ['command', 'explanation', 'goal', 'isBackground'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'marketplace_install',
      description:
        'Install a skill, agent, prompt, or bundle from the JumpStart Skills marketplace. Fetches the registry, resolves dependencies, downloads, verifies checksums, extracts files, and remaps agents/prompts to IDE-canonical directories.',
      parameters: {
        type: 'object',
        properties: {
          itemId: {
            type: 'string',
            description:
              'Item ID (e.g. "skill.ignition") or bare name (e.g. "ignition"). Also supports type prefix separately via the type parameter.',
          },
          type: {
            type: 'string',
            enum: ['skill', 'agent', 'prompt', 'bundle'],
            description:
              'Optional item type. When provided with a bare itemId, forms "type.itemId" (e.g. type="skill", itemId="ignition" → "skill.ignition").',
          },
          force: {
            type: 'boolean',
            description:
              'Re-install even if the item is already present at the same or newer version.',
          },
          search: {
            type: 'string',
            description:
              'Instead of installing, search the registry for items matching this query and return the results.',
          },
        },
        required: ['itemId'],
      },
    },
  },
  // ─── Timeline Event Recording ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'record_timeline_event',
      description:
        'Record an event to the Jump Start interaction timeline. Use this to log significant actions such as reading a template, writing an artifact, invoking a subagent, performing research, or any other notable step during your workflow.',
      parameters: {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            enum: [
              'phase_start',
              'phase_end',
              'tool_call',
              'tool_result',
              'file_read',
              'file_write',
              'template_read',
              'artifact_write',
              'artifact_read',
              'question_asked',
              'question_answered',
              'approval',
              'rejection',
              'subagent_invoked',
              'subagent_completed',
              'llm_turn_start',
              'llm_turn_end',
              'prompt_logged',
              'research_query',
              'checkpoint_created',
              'rewind',
              'handoff',
              'usage_logged',
              'custom',
            ],
            description: 'The type of event being recorded.',
          },
          action: {
            type: 'string',
            description:
              'A short, human-readable description of the action (e.g. "Read challenger-brief.md template", "Invoked Security subagent").',
          },
          metadata: {
            type: 'object',
            description:
              'Arbitrary key-value metadata for the event (e.g. { "file": "specs/architecture.md", "subagent": "Security", "query": "OWASP top 10" }).',
          },
          phase: {
            type: 'string',
            description: 'Override the current phase context (usually auto-detected).',
          },
          agent: {
            type: 'string',
            description: 'Override the current agent context (usually auto-detected).',
          },
          parent_agent: {
            type: 'string',
            description: 'When recording a subagent event, the parent agent that invoked it.',
          },
          duration_ms: {
            type: 'number',
            description: 'Duration of the action in milliseconds, if known.',
          },
        },
        required: ['event_type', 'action'],
      },
    },
  },
  // ─── Usage Logging ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'log_usage',
      description:
        'Log token usage and estimated cost for the current agent session to the usage log (.jumpstart/usage-log.json). Call this at the end of each phase or significant agent interaction to maintain an audit trail of LLM consumption.',
      parameters: {
        type: 'object',
        properties: {
          phase: {
            type: 'string',
            description: 'Phase identifier (e.g., "phase-0", "scout", "phase-3").',
          },
          agent: {
            type: 'string',
            description: 'Agent name (e.g., "Challenger", "Architect", "Developer").',
          },
          action: {
            type: 'string',
            description: 'Action description (e.g., "generation", "review", "consultation").',
          },
          estimated_tokens: {
            type: 'number',
            description: 'Estimated total token count for this interaction.',
          },
          estimated_cost_usd: {
            type: 'number',
            description: 'Estimated cost in USD (optional — computed from tokens if omitted).',
          },
          model: {
            type: 'string',
            description: 'Model name/ID used for this interaction.',
          },
          metadata: {
            type: 'object',
            description: 'Additional metadata (e.g., { "turns": 12, "artifact": "specs/prd.md" }).',
          },
        },
        required: ['phase', 'agent', 'action', 'estimated_tokens'],
      },
    },
  },
  // ─── Item-Tagged Feature Tools ─────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'run_revert',
      description:
        'Archive a rejected artifact draft and restore the last approved version from git. (Item 40)',
      parameters: {
        type: 'object',
        properties: {
          artifact: { type: 'string', description: 'Path to the artifact file to revert.' },
          reason: { type: 'string', description: 'Reason for reverting.' },
          archive_dir: {
            type: 'string',
            description: 'Archive directory (default: .jumpstart/archive).',
          },
        },
        required: ['artifact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_adr_index',
      description: 'Build or search an index of Architecture Decision Records. (Item 51)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['build', 'search'],
            description: 'Action to perform.',
          },
          root: { type: 'string', description: 'Project root directory.' },
          query: { type: 'string', description: 'Search query (for search action).' },
          tag: { type: 'string', description: 'Filter by tag (for search action).' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_complexity',
      description:
        'Calculate adaptive planning depth (quick/standard/deep) from project signals. (Item 33)',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Free-text problem statement.' },
          root: { type: 'string', description: 'Project root directory.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_crossref',
      description:
        'Validate cross-reference links in spec artifacts and detect broken links and orphan sections. (Item 47)',
      parameters: {
        type: 'object',
        properties: {
          specs_dir: {
            type: 'string',
            description: 'Path to specs directory (default: specs).',
          },
          root: { type: 'string', description: 'Project root directory.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_init',
      description:
        'Generate initialization configuration based on skill level and project type. (Item 76)',
      parameters: {
        type: 'object',
        properties: {
          skill_level: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'expert'],
            description: 'User skill level.',
          },
          project_type: {
            type: 'string',
            enum: ['greenfield', 'brownfield'],
            description: 'Project type.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_lock',
      description: 'Manage artifact file locks for concurrent agent access. (Item 45)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['acquire', 'release', 'status', 'list'],
            description: 'Lock action.',
          },
          file: {
            type: 'string',
            description: 'File path to lock/unlock (required for acquire/release/status).',
          },
          agent: {
            type: 'string',
            description: 'Agent name acquiring/releasing the lock.',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_timestamp',
      description: 'Generate, validate, or audit UTC timestamps in ISO 8601 format. (Item 60)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['now', 'validate', 'audit'],
            description: 'Timestamp action.',
          },
          value: {
            type: 'string',
            description: 'Timestamp string to validate (for validate action).',
          },
          file: {
            type: 'string',
            description: 'File path to audit timestamps in (for audit action).',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_scan',
      description:
        'Scan project directory to detect tech stack, dependencies, patterns, and risks. (Item 49)',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'Project root directory.' },
          ignore: {
            type: 'array',
            items: { type: 'string' },
            description: 'Directories to ignore.',
          },
        },
      },
    },
  },
  // ─── Quality Gate Tools ────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'run_secret_scan',
      description:
        'Scan files for accidentally committed secrets (API keys, tokens, passwords, private keys). Returns structured findings with severity levels.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of file paths to scan.',
          },
          root: { type: 'string', description: 'Project root directory.' },
          config: {
            type: 'object',
            description: 'Optional configuration.',
            properties: {
              custom_patterns: {
                type: 'array',
                description: 'Additional secret patterns to check.',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    pattern: { type: 'string' },
                    severity: { type: 'string', enum: ['critical', 'high'] },
                  },
                  required: ['name', 'pattern'],
                },
              },
              allowlist: {
                type: 'array',
                items: { type: 'string' },
                description: 'File paths to skip during scanning.',
              },
            },
          },
        },
        required: ['files'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_type_check',
      description:
        'Run automated type checking (TypeScript tsc, Python mypy/pyright). Auto-detects the type checker from project configuration.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Specific files to filter results for (optional — type checker runs project-wide).',
          },
          root: { type: 'string', description: 'Project root directory.' },
          config: {
            type: 'object',
            description: 'Optional configuration.',
            properties: {
              type_command: {
                type: 'string',
                description: 'Override the auto-detected type check command.',
              },
              strict: { type: 'boolean', description: 'Enable strict mode (TypeScript).' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_smoke_test',
      description:
        'Perform a smoke test: build the project and optionally check if the application starts and responds to HTTP requests.',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'Project root directory.' },
          config: {
            type: 'object',
            description: 'Optional configuration.',
            properties: {
              build_command: {
                type: 'string',
                description: 'Override the auto-detected build command.',
              },
              start_command: {
                type: 'string',
                description: 'Override the auto-detected start command.',
              },
              health_url: {
                type: 'string',
                description: 'URL to check for health (default: http://localhost:3000/health).',
              },
              health_timeout: {
                type: 'number',
                description: 'Timeout in ms for health check (default: 10000).',
              },
              skip_health_check: {
                type: 'boolean',
                description: 'Skip the health check and only verify the build.',
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_uat_coverage',
      description:
        'Check UAT alignment: verify that PRD acceptance criteria (Gherkin or bullet-point) are covered by actual test files. Returns coverage percentages and detailed mapping.',
      parameters: {
        type: 'object',
        properties: {
          prd_path: { type: 'string', description: 'Path to the PRD markdown file.' },
          test_dir: { type: 'string', description: 'Path to the test directory.' },
        },
        required: ['prd_path', 'test_dir'],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Phase-to-Tool Mapping (preserved verbatim from legacy)
// ─────────────────────────────────────────────────────────────────────────

/** Base tools available to all phases. */
const BASE_TOOLS: readonly string[] = [
  'read_file',
  'create_file',
  'replace_string_in_file',
  'list_dir',
  'file_search',
  'grep_search',
  'semantic_search',
  'ask_questions',
  'manage_todo_list',
  'record_timeline_event',
  'log_usage',
];

/** Additional tools unlocked per phase. */
const PHASE_TOOL_ADDITIONS: Record<string, readonly string[]> = {
  scout: [],
  challenger: [],
  analyst: [],
  pm: [],
  architect: [
    'marketplace_install',
    'run_adr_index',
    'run_complexity',
    'run_crossref',
    'run_lock',
    'run_scan',
    'run_init',
  ],
  developer: [
    'run_in_terminal',
    'marketplace_install',
    'run_secret_scan',
    'run_type_check',
    'run_smoke_test',
    'run_uat_coverage',
    'run_revert',
    'run_adr_index',
    'run_complexity',
    'run_crossref',
    'run_lock',
    'run_timestamp',
    'run_scan',
    'run_init',
  ],
};

/**
 * Get the list of tools available for a given phase. Unknown phase
 * names yield the BASE_TOOLS set only (matching legacy semantics).
 */
export function getToolsForPhase(phaseName: string): Tool[] {
  const additions = PHASE_TOOL_ADDITIONS[phaseName] || [];
  const allowedNames = new Set<string>([...BASE_TOOLS, ...additions]);
  return ALL_TOOLS.filter((t) => allowedNames.has(t.function.name));
}

/**
 * Get a single tool definition by name; null if not found.
 */
export function getToolByName(name: string): Tool | null {
  return ALL_TOOLS.find((t) => t.function.name === name) || null;
}
