---
name: quality-gates
description: Automated testing strategies for the Jump Start framework — secret scanning, type checking, smoke testing, and UAT coverage alignment. Use this skill when the Developer agent needs to validate code quality beyond unit tests, when security scanning is needed before commit, when type safety must be enforced, or when acceptance criteria coverage needs verification.
license: MIT
---

# Quality Gates Skill

This skill provides four automated testing strategies that extend the Jump Start framework's quality assurance capabilities. Each strategy addresses a specific gap in the framework's current testing layers.

## Tools

### 1. Secret Scanner (`bin/lib/secret-scanner.js`)

**Layer:** Pre-commit / Layer 1 (Schema & Formatting)
**Trigger:** After agent writes any file to `src/`, config files, or `.env` files
**Purpose:** Prevents accidental commitment of API keys, tokens, passwords, and private keys

```bash
echo '{"files":["src/config.js"],"root":"."}' | node bin/lib/secret-scanner.js
```

**When to use:**
- Before every commit during Phase 4 implementation
- After generating configuration files
- When processing user-provided credentials or API keys
- As part of CI pipeline quality gates

**Input:** JSON with `files` (array of paths), `root` (project root), `config` (optional: `custom_patterns`, `allowlist`)

**Output:** JSON with `pass` (boolean), `findings` (array of detected secrets with redacted values), `critical`/`high` counts

**Built-in detection patterns:** AWS keys, GitHub tokens, private key headers, API key assignments, password assignments, database connection strings, Slack tokens, Bearer tokens

### 2. Type Checker (`bin/lib/type-checker.js`)

**Layer:** Layer 1 extension (Schema & Formatting)
**Trigger:** After agent writes TypeScript or Python files to `src/`
**Purpose:** Catches interface mismatches and type errors before runtime

```bash
echo '{"files":["src/index.ts"],"root":"."}' | node bin/lib/type-checker.js
```

**When to use:**
- After writing or modifying TypeScript files
- After writing or modifying typed Python files (mypy/pyright)
- Before marking a task as complete in TODO.md
- As part of milestone verification

**Auto-detection:** Finds `tsconfig.json`, `jsconfig.json`, `pyrightconfig.json`, `mypy.ini`, or `[tool.mypy]`/`[tool.pyright]` in `pyproject.toml`

**Output:** JSON with `pass` (boolean), `findings` (array of type errors with file, line, code, severity), `checker` name

### 3. Smoke Tester (`bin/lib/smoke-tester.js`)

**Layer:** Integration / Vitality check
**Trigger:** After project scaffolding, after milestone completion
**Purpose:** Verifies the application builds and starts successfully

```bash
echo '{"root":".","config":{"skip_health_check":true}}' | node bin/lib/smoke-tester.js
```

**When to use:**
- After initial project scaffolding (Milestone 1)
- After each milestone completion
- Before final documentation (last milestone)
- When debugging "it builds but doesn't run" issues

**Capabilities:**
1. **Build verification** — Detects and runs the project's build command
2. **Health check** — Starts the application and verifies it responds (HTTP 200)
3. **Project detection** — Auto-detects Node.js, Python, Go, and Makefile projects

**Output:** JSON with `pass` (boolean), `build` (command, duration, exit code), `health` (url, status, error), `project_type`

### 4. UAT Coverage (`bin/lib/uat-coverage.js`)

**Layer:** Layer 5 extension (Acceptance criteria alignment)
**Trigger:** After test suite is written, at milestone boundaries
**Purpose:** Validates that PRD acceptance criteria are covered by actual tests

```bash
node bin/lib/uat-coverage.js specs/prd.md tests/
```

**When to use:**
- After completing test files for a milestone
- During milestone verification
- Before marking Phase 4 as complete
- When QA subagent reviews test coverage

**Capabilities:**
1. **Story coverage** — Maps `E##-S##` story IDs to test files that reference them
2. **Criteria coverage** — Matches individual acceptance criteria (Gherkin or bullet) to test content
3. **Keyword matching** — Semantic coverage detection via keyword overlap (50% threshold)

**Output:** 
- **CLI (human-facing):** Markdown coverage report printed to stdout when invoked as shown above.
- **Programmatic / tool-bridge (agent-facing):** JSON object with `pass` (boolean, 80% threshold), story/criteria coverage percentages, and detailed mapping of each criterion to test files, returned by the internal `computeUATCoverage` API / tool-bridge interface.

Agents and automation should consume the structured JSON via the tool-bridge interface rather than scraping the CLI markdown output.

## Workflow Integration

### During Phase 4 Task Execution

After each task in TODO.md:

1. **Secret scan** — Run on all modified files
2. **Type check** — Run if TypeScript or typed Python files were modified
3. **Build verify** — Run smoke tester with `skip_health_check: true` at milestone boundaries

### At Milestone Boundaries

1. Run full smoke test (build + health check if applicable)
2. Run UAT coverage check against PRD
3. Log results in `specs/insights/implementation-plan-insights.md`

### Before Phase 4 Completion

1. Final secret scan on all `src/` files
2. Full type check
3. Full smoke test
4. UAT coverage report ≥ 80%
