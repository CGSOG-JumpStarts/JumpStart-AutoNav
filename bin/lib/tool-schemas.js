/**
 * tool-schemas.js — OpenAI Function Calling Tool Schemas
 *
 * Defines the tool schemas (function definitions) that agents can call
 * during headless execution. Maps tools to phases for scoping.
 */

'use strict';

// ─── Tool Definitions ────────────────────────────────────────────────────────

const ALL_TOOLS = [
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
          endLine: { type: 'number', description: 'End line (1-based, inclusive).' }
        },
        required: ['filePath', 'startLine', 'endLine']
      }
    }
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
          content: { type: 'string', description: 'Content to write.' }
        },
        required: ['filePath', 'content']
      }
    }
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
          newString: { type: 'string', description: 'Replacement text.' }
        },
        required: ['filePath', 'oldString', 'newString']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List directory contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the directory.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_search',
      description: 'Search for files by glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Glob pattern to match files.' }
        },
        required: ['query']
      }
    }
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
          isRegexp: { type: 'boolean', description: 'Whether query is a regex.' }
        },
        required: ['query', 'isRegexp']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Run a natural language search for relevant code.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query.' }
        },
        required: ['query']
      }
    }
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
                      recommended: { type: 'boolean', description: 'Mark as recommended.' }
                    },
                    required: ['label']
                  }
                },
                multiSelect: { type: 'boolean', description: 'Allow multiple selections.' },
                allowFreeformInput: { type: 'boolean', description: 'Allow free text input.' }
              },
              required: ['header', 'question']
            }
          }
        },
        required: ['questions']
      }
    }
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
                status: { type: 'string', enum: ['not-started', 'in-progress', 'completed'] }
              },
              required: ['id', 'title', 'status']
            }
          }
        },
        required: ['todoList']
      }
    }
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
          timeout: { type: 'number', description: 'Timeout in milliseconds.' }
        },
        required: ['command', 'explanation', 'goal', 'isBackground']
      }
    }
  }
];

// ─── Phase-to-Tool Mapping ───────────────────────────────────────────────────

/** Base tools available to all phases */
const BASE_TOOLS = [
  'read_file', 'create_file', 'replace_string_in_file', 'list_dir',
  'file_search', 'grep_search', 'semantic_search',
  'ask_questions', 'manage_todo_list'
];

/** Additional tools unlocked per phase */
const PHASE_TOOL_ADDITIONS = {
  scout:      [],
  challenger: [],
  analyst:    [],
  pm:         [],
  architect:  [],
  developer:  ['run_in_terminal']
};

/**
 * Get the list of tools available for a given phase.
 * @param {string} phaseName — e.g. 'architect', 'developer'
 * @returns {Array} Array of OpenAI-compatible tool definitions
 */
function getToolsForPhase(phaseName) {
  const additions = PHASE_TOOL_ADDITIONS[phaseName] || [];
  const allowedNames = new Set([...BASE_TOOLS, ...additions]);
  return ALL_TOOLS.filter(t => allowedNames.has(t.function.name));
}

/**
 * Get a single tool definition by name.
 * @param {string} name — Tool function name
 * @returns {object|null}
 */
function getToolByName(name) {
  return ALL_TOOLS.find(t => t.function.name === name) || null;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { ALL_TOOLS, getToolsForPhase, getToolByName };
