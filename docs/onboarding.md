# Onboarding Guide

Welcome to **Jump Start** — a spec-driven agentic engineering framework that uses Jump Start design thinking principles. This guide walks you through your first project from installation to working code.

---

## Before You Begin

You need:
- **Node.js** >= 14.0.0
- An AI coding assistant: [GitHub Copilot](https://github.com/features/copilot) (recommended), [Claude Code](https://claude.ai), [Cursor](https://cursor.sh), or [Windsurf](https://windsurf.ai)
- A terminal and a code editor (VS Code recommended)

---

## Step 1: Install the Framework

Open a terminal and run:

```bash
# Interactive setup (recommended for first-timers)
npx jumpstart-mode

# Or specify options directly
npx jumpstart-mode ./my-project --name "My App" --copilot
```

The installer will:
1. Create the `.jumpstart/` directory with all agent definitions, templates, and configuration
2. Set up integration files for your AI assistant (`.github/`, `CLAUDE.md`, `.cursorrules`)
3. Create the `specs/` directory where your artifacts will live
4. Auto-detect whether your project is greenfield (new) or brownfield (existing code)

**Verify installation:**

```bash
ls .jumpstart/config.yaml  # Should exist
```

---

## Step 2: Understand the Phases

Jump Start works through five sequential phases, each owned by a specialized AI agent:

```
Pre-Phase 0 → Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4
Scout      Challenge   Analyze    Plan    Architect   Build
```

Each phase produces a Markdown artifact that feeds into the next. You approve each artifact before the next phase begins.

| Phase | Agent | You Provide | You Get |
|-------|-------|-------------|---------|
| Pre-Phase | Scout (brownfield only) | Access to existing codebase | Codebase analysis report |
| 0 | Challenger | A raw idea or problem | Validated problem statement |
| 1 | Analyst | Approval of problem statement | User personas, journeys, MVP scope |
| 2 | PM | Approval of product brief | PRD with user stories and acceptance criteria |
| 3 | Architect | Approval of PRD | Tech stack, data models, API contracts, implementation plan |
| 4 | Developer | Approval of architecture | Working code and tests |

**Brownfield projects** add a Pre-Phase where the Scout agent analyzes your existing codebase before Phase 0.

---

## Step 3: Configure (Optional)

The framework works out of the box with sensible defaults. If you want to customize:

```bash
# Open the config file in your editor
code .jumpstart/config.yaml
```

### Configuration Reference

The config file is organized into logical sections. Here's a comprehensive guide to all settings:

---

#### Project Settings

**`project.name`** — Your project name (populated during installation)

**`project.description`** — One-line description of what your project does

**`project.created_at`** — ISO date, auto-populated during initialization

**`project.approver`** — Name or team responsible for phase gate approvals

**`project.type`** — `greenfield` | `brownfield` | `null`
- `greenfield`: New project built from scratch
- `brownfield`: Existing codebase with new features/changes
- `null`: Not yet determined (CLI will detect at install time)

**`project.domain`** — `auto` | `healthcare` | `fintech` | `govtech` | `edtech` | `aerospace` | `automotive` | `scientific` | `legaltech` | `insuretech` | `energy`
- Enables domain-adaptive planning rigor
- When set, agents consult `.jumpstart/domain-complexity.csv` for domain-specific concerns
- Use `auto` to let agents infer domain from context

---

#### Roadmap & Architectural Gates

**`roadmap.enabled`** — `true` | `false`
- Enforce roadmap checks at agent activation
- Agents must read `.jumpstart/roadmap.md` before generating content

**`roadmap.path`** — Path to your roadmap file (default: `.jumpstart/roadmap.md`)

**`roadmap.test_drive_mandate`** — `true` | `false`
- When `true`: Strict TDD enforced (Developer must write failing tests first)
- When `false`: Tests recommended but not gated
- Implements Article III of the Roadmap

---

#### Versioning

**`versioning.enabled`** — `true` | `false`
- Enable git-based version tagging for approved artifacts

**`versioning.tag_prefix`** — Default: `"spec"`
- Git tag prefix (e.g., `spec/v1.0.0`)

**`versioning.auto_tag_on_approval`** — `true` | `false`
- Automatically create git tags when artifacts are approved

---

#### Environment Invariants

**`invariants.enabled`** — `true` | `false`
- Enforce environment invariants at phase gates

**`invariants.path`** — Path to invariants file (default: `.jumpstart/invariants.md`)

**`invariants.fail_on_violation`** — `true` | `false`
- Fail phase gate if invariants are not addressed

---

#### Schema Enforcement

**`schema_enforcement.enabled`** — `true` | `false`
- Validate artifact structure against JSON schemas

**`schema_enforcement.schemas_dir`** — Path to schema directory (default: `.jumpstart/schemas`)

**`schema_enforcement.validate_on_write`** — `true` | `false`
- Validate artifacts immediately when they are written

---

#### Content Integrity

**`content_integrity.enabled`** — `true` | `false`
- Track content hashes for artifact integrity (detect tampering)

**`content_integrity.manifest_path`** — Path to content manifest (default: `.jumpstart/manifest.json`)

---

#### Dependency Graph

**`dependency_graph.enabled`** — `true` | `false`
- Maintain spec-to-code dependency mapping

**`dependency_graph.graph_path`** — Path to dependency graph (default: `.jumpstart/spec-graph.json`)

---

#### Template Hot-Reloading

**`template_watching.enabled`** — `true` | `false`
- Watch for template changes and prompt spec updates

**`template_watching.snapshot_path`** — Path to template snapshots (default: `.jumpstart/state/template-snapshot.json`)

---

#### Simplicity Gate

**`simplicity_gate.enabled`** — `true` | `false`
- Enforce maximum top-level directory count

**`simplicity_gate.max_top_level_dirs`** — Default: `3`
- Maximum allowed top-level directories under source root
- Prevents over-abstraction

**`simplicity_gate.require_justification`** — `true` | `false`
- Require written justification for exceeding the directory limit

---

#### Context7 Documentation Freshness

**`context7.enabled`** — `true` | `false`
- Mandate Context7 MCP for live, verified documentation lookups
- Prevents relying on stale training data for API information

**`context7.freshness_threshold`** — Default: `80`
- Minimum freshness score (%) required for Phase 3 approval
- Scores below threshold trigger documentation audit

**`context7.require_audit`** — `true` | `false`
- Require documentation audit before architecture approval

**`context7.citation_marker`** — Default: `"[Context7: {lib}@{version}]"`
- Citation format for documentation sources

---

#### Workflow Settings

**`workflow.require_gate_approval`** — `true` | `false`
- Require explicit human approval between phases
- Recommended: `true` for production work

**`workflow.auto_commit_artifacts`** — `true` | `false`
- Auto-commit spec files to git after generation

**`workflow.allow_phase_skip`** — `true` | `false`
- Allow jumping to a later phase without completing previous phases
- Not recommended unless you know what you're doing

**`workflow.auto_handoff`** — `true` | `false`
- Automatically proceed to next phase after approval

**`workflow.archive_on_restart`** — `true` | `false`
- Archive existing artifacts before regenerating (rename with date suffix)

**`workflow.current_phase`** — `null` | `0` | `1` | `2` | `3` | `4`
- Tracks active phase, managed by framework

**`workflow.qa_log`** — `true` | `false`
- Log every agent question and human response to `specs/qa-log.md`
- Creates an audit trail of all decisions across phases

---

#### Agent Configuration

Each agent has a `persona_file` that defines its behavior. Additional agent-specific settings:

**Scout Agent** (brownfield only):
- `persona_file`: Path to agent definition

**Challenger Agent** (Phase 0):
- `persona_file`: Path to agent definition
- `require_reframe`: Force at least one problem reframe

**Analyst Agent** (Phase 1):
- `persona_file`: Path to agent definition
- Scope modes include: `mvp`, `full`

**PM Agent** (Phase 2):
- `persona_file`: Path to agent definition
- `require_nfrs`: Require non-functional requirements section

**Architect Agent** (Phase 3):
- `persona_file`: Path to agent definition
- Task formats: `checkbox`, `ticket`

**Developer Agent** (Phase 4):
- `persona_file`: Path to agent definition

**Advisory Agents**: ux-designer, qa, scrum-master, security, performance, tech-writer, researcher, refactor, maintenance, quick-dev, retrospective, facilitator
- Each has a `persona_file` defining specialized capabilities
- Invoked on-demand via slash commands

---

#### Adaptive Planning

**`adaptive_planning.enabled`** — `true` | `false`
- Enable adaptive planning depth based on project complexity

**`adaptive_planning.auto_detect`** — `true` | `false`
- Auto-detect complexity from project signals

**`adaptive_planning.thresholds`**:
- `quick`: Score ≤ 30 (quick elicitation depth)
- `standard`: Score 31-65 (standard depth)
- `deep`: Score ≥ 66 (deep elicitation depth)

**`adaptive_planning.scoring_weights`**: Weight different complexity dimensions
- `risk_keywords`: 25
- `stakeholders`: 10
- (and other dimensions)

---

#### State Persistence

**`state.enabled`** — `true` | `false`
- Enable stateful workflow persistence

**`state.state_file`** — Path to workflow state (default: `.jumpstart/state/state.json`)

**`state.todos_file`** — Path to protocol progress tracking (default: `.jumpstart/state/todos.json`)

**`state.adr_index_file`** — Path to ADR search index (default: `.jumpstart/state/adr-index.json`)

**`state.auto_save`** — `true` | `false`
- Auto-save state after each agent action

---

#### Rollback & Archive

**`rollback.enabled`** — `true` | `false`
- Enable artifact rollback workflows

**`rollback.archive_dir`** — Directory for archived artifacts (default: `.jumpstart/archive`)

**`rollback.create_metadata`** — `true` | `false`
- Create `.meta.json` files alongside archives

**`rollback.git_restore`** — `true` | `false`
- Attempt git restore when reverting

---

#### Multi-Model Orchestration

**`models.enabled`** — `true` | `false`
- Enable per-phase model assignment

**`models.default_provider`** — `auto` | `openai` | `anthropic` | `google` | `local`
- Default AI provider

**`models.default_model`** — `auto` | specific model name
- `auto` = use whatever the IDE provides

**`models.phase_assignments`** — Override model per phase
```yaml
phase_assignments:
  "0": { "provider": "anthropic", "model": "claude-4.6-opus" }
  "3": { "provider": "openai", "model": "gpt-5.2" }
```

**`models.advisory_assignments`** — Override model per advisory agent

---

#### Environment Variables (Headless Runner)

The headless runner uses [LiteLLM](https://docs.litellm.ai) as a unified LLM gateway. Configure it via environment variables in a `.env` file at the project root:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `LITELLM_BASE_URL` | URL of your LiteLLM proxy server | `http://localhost:4000` |
| `LITELLM_API_KEY` | API key for the LiteLLM proxy | — |
| `OPENAI_API_KEY` | Fallback API key (used when `LITELLM_API_KEY` is not set) | — |
| `DEBUG` | Enable verbose error stack traces | — |

The `.env` file is loaded automatically via `dotenv` when the headless runner starts. See the [Headless Agent Emulation](https://github.com/otey247/JumpStart/blob/master/README.md#headless-agent-emulation) section in the README for full usage instructions.

---

#### Conflict Detection

**`locks.enabled`** — `true` | `false`
- Enable file locking for multi-agent scenarios

**`locks.lock_dir`** — Directory for lock files (default: `.jumpstart/state/locks`)

**`locks.stale_timeout_ms`** — Lock timeout in milliseconds (default: 300000 = 5 minutes)

**`locks.auto_release_on_phase_change`** — `true` | `false`
- Release all locks when phase changes

---

#### Integration Settings

**`integrations.ai_assistant`** — `copilot` | `claude-code` | `cursor` | `gemini` | `windsurf` | `codex`
- Which AI assistant you're using

**`integrations.git_branch_per_phase`** — `true` | `false`
- Create a separate branch for each phase

**`integrations.branch_naming`** — Branch name template (default: `"jumpstart/phase-{n}-{name}"`)

---

#### Hooks

**`hooks.post_phase`** — Array of shell commands to run after phase completion

Example hooks:
```yaml
hooks:
  post_phase:
    - "echo 'Phase {phase} complete' >> .jumpstart/log.txt"
    - "gh issue create --title 'Review: {phase_name}'"
    - "curl -X POST $SLACK_WEBHOOK -d '{\"text\": \"Phase {phase_name} done\"}'"
```

Available variables: `{phase}`, `{phase_name}`, `{artifact_path}`, `{project_name}`

---

#### Diagram Verification

**`diagram_verification.enabled`** — `true` | `false`
- Enable Mermaid diagram verification

**`diagram_verification.auto_verify_at_gate`** — `true` | `false`
- Automatically run verifier before phase gate approval

**`diagram_verification.scan_dirs`** — Directories to scan (default: `["specs"]`)

**`diagram_verification.strict_c4_semantics`** — `true` | `false`
- Enforce strict C4 level consistency rules

---

#### User Preferences (Items 76, 78)

**`user.skill_level`** — `null` | `beginner` | `intermediate` | `expert`
- `beginner`: Detailed explanations, examples, verbose gates
- `intermediate`: Standard explanations, balanced verbosity
- `expert`: Minimal explanations, quick gates

**`user.explanation_level`** — `detailed` | `standard` | `minimal`
- Derived from skill_level

**`user.show_hints`** — `true` | `false`
- Show contextual hints during phases

---

#### Global Config Overrides

**`config_loader.enabled`** — `true` | `false`
- Enable merging global `~/.jumpstart/config.yaml`

**`config_loader.global_path`** — Path to global config (default: `~/.jumpstart/config.yaml`)

**`config_loader.precedence`** — `project` | `global`
- Which config wins on conflict

---

#### Output Paths

**`paths.specs_dir`** — Default: `"specs"`

**`paths.decisions_dir`** — Default: `"specs/decisions"`

**`paths.research_dir`** — Default: `"specs/research"`

**`paths.insights_dir`** — Default: `"specs/insights"`

**`paths.qa_log`** — Default: `"specs/qa-log.md"`

**`paths.codebase_context`** — Default: `"specs/codebase-context.md"` (Scout output)

**`paths.roadmap`** — Default: `".jumpstart/roadmap.md"`

**`paths.domain_complexity`** — Default: `".jumpstart/domain-complexity.csv"`

**`paths.source_dir`** — Default: `"src"`

**`paths.tests_dir`** — Default: `"tests"`

---

#### VS Code Chat Tools

**`vscode_tools.use_ask_questions`** — `true` | `false`
- Use interactive question carousels for user input
- Only available in GitHub Copilot for VS Code

**`vscode_tools.use_todo_lists`** — `true` | `false`
- Use todo lists to track protocol progress
- Only available in GitHub Copilot for VS Code

---

#### Testing Configuration (5-Layer Quality Gate)

Comprehensive testing settings for automated quality enforcement across five layers:
1. Schema & Formatting
2. Semantic Smells
3. Cross-Spec Consistency
4. Traceability & Coverage
5. Adversarial Review

**`testing.story_coverage_required`** — `true` | `false`
- Require 100% story-to-task mapping

(See `.jumpstart/config.yaml` for full testing configuration details)

---

#### Module System

**`modules.enabled`** — `true` | `false`
- Enable pluggable add-on modules

**`modules.enabled_list`** — Array of module names to load
- Empty = load all modules

---

#### Template Inheritance

**`template_inheritance.enabled`** — `true` | `false`
- Merge organization-wide base templates with project-level overrides

**`template_inheritance.merge_strategy`** — `project-wins` | `base-wins`
- Which template takes precedence on conflict

---

#### Skills

**`skills.enabled`** — `true` | `false`
- Enable skill-based injection for specialized domain knowledge

**`skills.dir`** — Directory containing installed skills (default: `.jumpstart/skills`)

---

#### Design System

**`design_system.enabled`** — `true` | `false`
- Reference enterprise design system for consistent UI/UX

**`design_system.path`** — Path to design system file (default: `.jumpstart/templates/design-system.md`)

---

#### Self-Evolve
**`self_evolve.enabled`** — `true` | `false`
- Enable framework self-improvement proposals based on usage analysis

**`self_evolve.auto_propose`** — `true` | `false`
- Auto-generate improvement proposals at phase gates

---

### Quick Configuration Tips

**For Beginners:**
```yaml
user.skill_level: beginner
user.show_hints: true
workflow.require_gate_approval: true
```

**For Fast Iteration:**
```yaml
workflow.auto_handoff: true
workflow.auto_commit_artifacts: true
```

**For Team Projects:**
```yaml
workflow.qa_log: true
versioning.enabled: true
versioning.auto_tag_on_approval: true
```

**For Strict Quality Control:**
```yaml
roadmap.test_drive_mandate: true
schema_enforcement.validate_on_write: true
testing.story_coverage_required: true
context7.enabled: true
```

**For Brownfield/Legacy Projects:**
```yaml
project.type: brownfield
rollback.enabled: true
rollback.git_restore: true
```

---

## Step 4: Run Your First Phase

### With GitHub Copilot (VS Code)

1. Open your project in VS Code
2. Open Copilot Chat (Ctrl+Shift+I or Cmd+Shift+I)
3. Click the agent dropdown at the top of the chat panel
4. Select **"Jump Start: Challenger"**
5. Describe your idea:

```
I want to build a tool that helps remote teams track meeting action items
and follow up on commitments automatically.
```

The Challenger agent will:
- Ask probing questions about your problem
- Surface hidden assumptions
- Drill to root causes using Five Whys
- Map stakeholders
- Reframe the problem statement
- Present a Challenger Brief for your approval

### With Claude Code

```bash
/jumpstart.challenge I want to build a meeting action tracker for remote teams
```

### With Cursor

Type the same command in Cursor's chat panel. The `.cursorrules` file tells Cursor how to route commands.

---

## Step 5: Approve and Continue

After Phase 0, review the generated `specs/challenger-brief.md`. If it captures your intent:

1. Tell the agent "Approved" (or check the approval boxes in the document)
2. Move to the next phase:
   - **Copilot:** Select **"Jump Start: Analyst"** from the agent dropdown
   - **Claude Code / Cursor:** Type `/jumpstart.analyze`

Repeat for each phase:
- Phase 1 → `/jumpstart.analyze` → produces `specs/product-brief.md`
- Phase 2 → `/jumpstart.plan` → produces `specs/prd.md`
- Phase 3 → `/jumpstart.architect` → produces `specs/architecture.md` + `specs/implementation-plan.md`
- Phase 4 → `/jumpstart.build` → produces working code in `src/` and `tests/`

---

## Step 6: Check Progress

At any point, check where you are:

```
/jumpstart.status
```

Or in VS Code Copilot, use `#prompt:jumpstart-status`.

This shows a dashboard with:
- Which phases are complete
- Artifact approval status
- Quality scores
- Open clarifications

---

## Understanding Agent Orchestration

Jump Start's power comes from its sophisticated multi-agent system. Here's how it works behind the scenes.

### The Agent Architecture

Jump Start uses **22 specialized AI agents** organized into three categories:

#### 1. Core Phase Agents (6 agents)

These agents execute the sequential workflow:

**Scout** (Pre-Phase 0, brownfield only)
- Analyzes existing codebases before any modifications
- Creates C4 diagrams mapping current system architecture
- Produces `specs/codebase-context.md` for downstream agents
- Never proposes changes — only documents what exists

**Challenger** (Phase 0)
- Interrogates your problem statement using Five Whys
- Surfaces hidden assumptions and reframes the problem
- Maps stakeholders and their real pain points
- Produces `specs/challenger-brief.md`
- Never suggests solutions — only validates the problem

**Analyst** (Phase 1)
- Creates user personas grounded in real behavior
- Maps user journeys with emotional touchpoints
- Defines MVP scope and value proposition
- Produces `specs/product-brief.md`
- Never writes requirements — only defines the product concept

**PM** (Phase 2)
- Transforms product concept into formal requirements
- Writes user stories with SMART acceptance criteria
- Documents non-functional requirements (NFRs)
- Produces `specs/prd.md`
- Never makes technical decisions — only defines what to build

**Architect** (Phase 3)
- Selects technology stack using Context7-verified docs
- Designs component architecture and data models
- Specifies API contracts and integration patterns
- Creates ordered implementation plan
- Produces `specs/architecture.md` and `specs/implementation-plan.md`
- Never writes application code — only designs the solution

**Developer** (Phase 4)
- Executes implementation plan task-by-task
- Writes code following Test-Driven Development (when enabled)
- Creates tests, documentation, and deployment-ready artifacts
- Updates `README.md` and per-directory `AGENTS.md` files
- Never changes architecture without flagging deviation

#### 2. Advisory Agents (15 agents)

These specialists provide on-demand expertise at any phase:

| Agent | Expertise | Typical Use Case |
|-------|-----------|------------------|
| **Security** | STRIDE threat modeling, OWASP Top 10 | After Phase 3 to audit architecture |
| **Performance** | NFR quantification, bottleneck analysis | After Phase 2 to set SLAs and budgets |
| **QA** | Test strategy, coverage analysis | During Phase 4 for release readiness |
| **UX Designer** | Emotional mapping, accessibility | After Phase 1 to validate journeys |
| **DevOps** | CI/CD pipelines, deployment strategy | After Phase 3 for production planning |
| **Researcher** | Context7-verified tech evaluation | During Phase 3 for technology decisions |
| **Scrum Master** | Sprint planning, dependency mapping | Before Phase 4 for task ordering |
| **Tech Writer** | Documentation freshness, README audits | After Phase 4 for doc validation |
| **Refactor** | Complexity analysis, code smells | After Phase 4 for code quality |
| **Maintenance** | Dependency drift, spec drift detection | Post-deployment for health monitoring |
| **Adversary** | Spec stress-testing, violation detection | Before phase gates for quality audit |
| **Reviewer** | Peer review scoring across 4 dimensions | Before phase gates for completeness check |
| **Retrospective** | Post-build plan vs. reality analysis | After Phase 4 for lessons learned |
| **Quick Dev** | Abbreviated workflow for small changes | Post-Phase 3 for bug fixes |
| **Facilitator** | Multi-agent roundtable orchestration | Anytime for complex decision discussions |

#### 3. Utility Agent (1 agent)

**Diagram Verifier**
- Validates Mermaid diagram syntax and semantics
- Enforces C4 diagram level consistency
- Runs automatically at phase gates (when enabled)
- Manual invocation: `/jumpstart.verify`

---

### How Agents Stay In Lane

Each agent has **strict boundaries** enforced by the framework:

**The Challenger** NEVER suggests solutions or technologies. If they say "You should build a React app," that's a violation. They only interrogate problems.

**The Analyst** NEVER writes user stories or acceptance criteria. That's the PM's job. They define personas and journeys, not requirements.

**The Architect** NEVER writes application code. They design, specify, and plan — but execution belongs to the Developer.

**The Developer** NEVER changes architecture unilaterally. If the plan is insufficient, they flag it and ask for guidance rather than improvising.

These boundaries prevent the "telephone game" where intent gets distorted across abstraction layers.

---

### Context Flow: How Agents See Upstream Work

Each agent reads **all preceding artifacts** to maintain continuity:

```
Scout (brownfield) → codebase-context.md
                              ↓
Challenger → challenger-brief.md ─────────────┐
                              ↓               |
Analyst → product-brief.md ─────────────┐     |
         (reads challenger-brief.md)    |     |
                              ↓         |     |
PM → prd.md ─────────────────────┐     |     |
    (reads product-brief.md +    |     |     |
     challenger-brief.md)         |     |     |
                              ↓   |     |     |
Architect → architecture.md + implementation-plan.md
           (reads prd.md + product-brief.md + 
            challenger-brief.md + codebase-context.md)
                              ↓
Developer → working code in src/ + tests/
           (reads ALL preceding specs)
```

This **upstream traceability** ensures:
- No agent operates in a vacuum
- Intent flows from problem → solution → implementation
- Decisions are grounded in validated context

---

### The Subagent Protocol: Agents Calling Agents

Phase agents can **invoke advisory agents as subagents** when project signals indicate specialized review would add value. This happens automatically without requiring human intervention.

**How it works:**

1. **Conditional Invocation**: Phase agents check project signals (domain, complexity, config flags) and invoke subagents only when indicators suggest value.

2. **Scoped Queries**: The parent agent provides a focused prompt describing exactly what to review.

3. **Incorporation, Not Delegation**: Subagent findings are incorporated into the parent's artifact. The subagent doesn't write to files directly.

4. **Phase Gates Still Apply**: Human still approves the final artifact. Subagent invocations don't bypass gates.

**Example Flow:**

```
Architect (Phase 3) working on healthcare app
    ↓
    Detects: project.domain = "healthcare"
    ↓
    Invokes: @Jump Start: Security as subagent
    ↓
    Query: "Review this architecture for HIPAA compliance gaps"
    ↓
    Security responds with STRIDE analysis
    ↓
    Architect incorporates findings into architecture.md
    ↓
    Human approves enhanced architecture.md
```

**Available Subagent Relationships:**

| Phase Agent | Commonly Invokes | Trigger Signals |
|-------------|------------------|-----------------|
| Analyst | UX Designer, Researcher | Complex user journeys, new tech evaluation |
| PM | QA, Performance, Security | Testability concerns, NFRs, sensitive data |
| Architect | Security, Performance, Researcher | Authentication, scale, library selection |
| Developer | Refactor, Tech Writer, QA | Complexity spikes, doc drift, test gaps |

**Subagent Chaining**: Advisory agents may invoke other advisory agents (max depth: 2). Example: Security invokes Researcher for version-verified library recommendations.

All subagent invocations are logged in the parent phase's `insights.md` file.

---

### Living Insights: The Agent's Reasoning Log

Every agent maintains a **parallel insights file** alongside their primary artifact:

**Primary Artifacts** (in `specs/`):
- `challenger-brief.md`
- `product-brief.md`
- `prd.md`
- `architecture.md`
- `implementation-plan.md`

**Insights Files** (in `specs/insights/`):
- `challenger-brief-insights.md`
- `product-brief-insights.md`
- `prd-insights.md`
- `architecture-insights.md`
- `implementation-insights.md`

**What goes in insights:**
- Trade-offs evaluated but not chosen
- Alternatives rejected and why
- Assumptions made and their rationale
- Open questions or concerns
- Subagent invocation logs
- Research findings that informed decisions

**Why this matters:**
- **Onboarding**: New team members understand the "why" behind decisions
- **Revisiting**: When requirements change, you recall the original reasoning
- **Auditing**: Compliance and security reviews have a decision trail
- **Learning**: Retrospectives compare plan vs. reality with full context

Insights are append-only and never deleted — they're the institutional memory of your project.

---

### Party Mode: Multi-Agent Collaboration

The **Facilitator** agent orchestrates multi-agent discussions for complex decisions:

**When to use Party Mode:**
- Complex trade-offs with multiple perspectives needed
- Architecture decisions affecting security, performance, and UX
- Technology selection with competing concerns
- Design pattern debates

**How it works:**

1. You invoke: `/jumpstart.party "Should we use GraphQL or REST?"`

2. Facilitator analyzes the question and selects relevant agents:
   - Architect (technology fit)
   - Performance (latency and caching)
   - Security (authentication patterns)
   - Developer (implementation complexity)

3. Each agent responds **in character** with their perspective:
   - Architect weighs schema evolution and tooling
   - Performance compares query efficiency
   - Security analyzes attack surface
   - Developer estimates implementation effort

4. Facilitator synthesizes viewpoints and presents recommendation with pros/cons

5. Decision is logged to `specs/insights/party-insights.md`

**Important**: Party Mode is **advisory only** — it doesn't produce phase artifacts or bypass gates. Use it to inform decisions, then carry findings into the normal phase workflow.

---

### The Q&A Decision Log

When `workflow.qa_log: true` in config, every question-and-response exchange between agents and humans is logged to `specs/qa-log.md`:

```markdown
## Q-001

**Phase**: 2 (PM)
**Asked by**: Jump Start: PM
**Date**: 2026-02-09

**Question**: Should the notification system support SMS or just email initially?

**Response**: Email only for MVP. SMS adds carrier complexity and cost. 
Revisit in Phase 2 if usage indicates need.

**Impact**: Updated US-004 acceptance criteria to remove SMS requirement.
```

**Why log Q&A:**
- **Audit trail**: Every decision has a recorded rationale
- **Prevents re-asking**: Agents check the log before asking duplicate questions
- **Onboarding**: New team members see the decision history
- **Compliance**: Regulatory audits have timestamped documentation

Entries are append-only, sequentially numbered (Q-001, Q-002...), and never modified.

---

### The Never Guess Rule

All agents follow **Item 69: Never Guess**. When anything is ambiguous:

1. Agent tags the ambiguity: `[NEEDS CLARIFICATION: Is "fast" <100ms or <1s?]`
2. Agent asks human for resolution using `ask_questions` tool
3. Human provides answer
4. Agent logs exchange to `specs/qa-log.md` (if enabled)
5. Agent proceeds with clarified information

**Agents NEVER:**
- Infer requirements from vague statements
- Generate fictional user data or personas
- Make technology choices without asking about constraints
- Assume acceptance criteria when not specified

This prevents **compounding errors** where small guesses in Phase 1 become major rework in Phase 4.

---

### Phase Gates: Human Approval Checkpoints

Every phase ends with a **Phase Gate Approval** section in the artifact:

```markdown
## Phase Gate Approval

- [ ] Problem statement validated
- [ ] Stakeholder map complete
- [ ] Root cause analysis documented
- [ ] Reframed problem approved

**Approved by**: [Pending]
**Date**: [Pending]
```

**The artifact is NOT approved until:**
1. All checkboxes are marked `[x]`
2. "Approved by" field contains a name (not "Pending")
3. Date is filled in

**Agents respect gates:** No Phase 2 agent will start until Phase 1 is approved. This is **non-negotiable** in the framework.

**Why gates matter:**
- Prevents cascading rework from unapproved decisions
- Creates clear decision boundaries
- Enables blame-free rollback (revert to last approved state)
- Forces intentional progression rather than momentum-driven drift

You can check approval status anytime with `/jumpstart.status`.

---

### Power Inversion: Specs Trump Code

Jump Start inverts the traditional relationship between specs and code:

**Traditional workflow:**
```
Write code → Update docs if you remember → Docs drift → Specs are fiction
```

**Jump Start workflow:**
```
Write specs → Approve specs → Generate code from specs → Specs are truth
```

**What this means in practice:**

If a developer discovers the architecture doesn't account for a use case:
1. ❌ **DON'T**: Just code around it
2. ✅ **DO**: Update `architecture.md`, get it approved, then update code

If QA finds acceptance criteria are incomplete:
1. ❌ **DON'T**: Test based on assumptions
2. ✅ **DO**: Update `prd.md`, get it approved, then write tests

**Specs are executable documentation** — they're the source code for your project's intent.

---

### Agent Personas: Consistent Personalities

Each agent has a **defined personality** that stays consistent across sessions:

**The Challenger** — Constructively skeptical, asks "Why?" five times
**The Analyst** — Empathetic, user-focused, detail-oriented
**The PM** — Precise, methodical, obsessed with testable criteria
**The Architect** — Pragmatic, opinionated, justifies every choice
**The Developer** — Disciplined, test-driven, follows the plan
**Quinn (QA)** — Meticulous, risk-aware, protects quality
**The Security Architect** — Uncompromising, threat-focused
**The Performance Analyst** — Data-driven, quantitative

These personas create **predictable collaboration patterns** — you know what to expect from each agent and can calibrate your trust accordingly.

---

### Cross-Assistant Compatibility

Jump Start works across multiple AI assistants:

| Assistant | Integration Method | Agent Selection |
|-----------|-------------------|-----------------|
| **GitHub Copilot** | Agent dropdown in Copilot Chat | Select from list |
| **Claude Code** | `CLAUDE.md` instructions | Type `/jumpstart.challenge` |
| **Cursor** | `.cursorrules` file | Type `/jumpstart.challenge` |
| **Windsurf** | `.windsurfrules` file | Type `/jumpstart.challenge` |

The **agent personas are portable** — the Challenger behaves the same way whether you're using Copilot, Claude, or Cursor. The framework abstracts away assistant-specific differences.

See `.jumpstart/compat/assistant-mapping.md` for detailed integration guides.

---

## Key Concepts

### Artifacts = Source of Truth

Everything the agents produce lives in `specs/` as Markdown files. These are:
- **Version-controlled** — diffable in pull requests
- **Human-readable** — no proprietary formats
- **The source of truth** — code is derived from specs, not the other way around

### Human Gates

You must explicitly approve each phase's output before the next phase begins. This prevents the "telephone game" where intent degrades through layers of abstraction.

### Living Insights

As agents work, they write reasoning traces to `specs/insights/`. These capture the **why** behind decisions — trade-offs evaluated, alternatives rejected, open questions. They're invaluable for onboarding and revisiting decisions later.

### Never Guess Rule

If anything is ambiguous, agents tag it with `[NEEDS CLARIFICATION]` and ask you rather than guessing. This prevents compounding errors across phases.

---

## Using Advisory Agents

Beyond the five core phases, Jump Start includes 16 advisory agents you can invoke at any time for specialist analysis:

```
/jumpstart.security      # Security architecture review
/jumpstart.ux-design     # UX analysis and design patterns
/jumpstart.performance   # Performance budget and scale analysis
/jumpstart.deploy        # CI/CD pipeline and deployment planning
/jumpstart.qa            # Test strategy and release readiness
/jumpstart.adversary     # Stress-test specs for gaps
/jumpstart.reviewer      # Peer review scoring
/jumpstart.party         # Multi-agent roundtable discussion
```

Advisory agents inform decisions but don't block phase progression. Use them when you need specialist perspective.

---

## Running Quality Checks

Jump Start includes a CLI with 29 subcommands for automated quality enforcement:

```bash
# Validate spec artifacts against schemas
npx jumpstart-mode validate

# Detect spec smells (vague language, missing constraints)
npx jumpstart-mode smells

# Check cross-spec consistency
npx jumpstart-mode consistency

# Run the full 5-layer test suite
npx jumpstart-mode test

# Check story-to-task traceability
npx jumpstart-mode coverage

# Detect spec drift between specs and code
npx jumpstart-mode spec-drift
```

---

## Common Workflows

### Starting a New Project (Greenfield)

```
1. npx jumpstart-mode ./my-app --copilot
2. /jumpstart.challenge "describe your idea"
3. Review & approve specs/challenger-brief.md
4. /jumpstart.analyze
5. Review & approve specs/product-brief.md
6. /jumpstart.plan
7. Review & approve specs/prd.md
8. /jumpstart.architect
9. Review & approve specs/architecture.md + specs/implementation-plan.md
10. /jumpstart.build
```

### Working with an Existing Codebase (Brownfield)

```
1. npx jumpstart-mode ./existing-app --type brownfield --copilot
2. /jumpstart.scout          # Analyze existing codebase first
3. Review & approve specs/codebase-context.md
4. /jumpstart.challenge "describe the change you want to make"
5. Continue through phases 1-4 as above
```

### Quick Bug Fix (Skip Full Flow)

```
/jumpstart.quick "Fix the login timeout issue on mobile"
```

The Quick Dev agent provides an accelerated path for small, well-defined changes.

### Multi-Agent Discussion

```
/jumpstart.party "Should we use GraphQL or REST for our API?"
```

The Facilitator agent orchestrates a roundtable where multiple specialist agents weigh in.

---

## Project Structure After Phase 4

```
my-app/
├── .jumpstart/              # Framework (config, agents, templates)
├── specs/                   # Your approved specifications
│   ├── challenger-brief.md
│   ├── product-brief.md
│   ├── prd.md
│   ├── architecture.md
│   ├── implementation-plan.md
│   ├── decisions/           # Architecture Decision Records
│   └── insights/            # Agent reasoning traces
├── src/                     # Application code (written by Developer agent)
├── tests/                   # Test code
└── README.md                # Updated by Developer agent
```

---

## Tips for Success

1. **Be specific in Phase 0.** The more context you give the Challenger, the better the problem statement. Include pain points, constraints, and what you've already tried.

2. **Push back on agents.** If an agent's output doesn't match your vision, say so. They'll iterate. You're the gate.

3. **Use insights for context.** When returning to a project after a break, read `specs/insights/` to recall why decisions were made.

4. **Run quality checks early.** Don't wait until Phase 4 to validate. Run `npx jumpstart-mode smells` and `npx jumpstart-mode consistency` after Phase 2 to catch issues early.

5. **Leverage advisory agents.** Invoke `/jumpstart.security` after Phase 3 to catch security gaps before code is written. Use `/jumpstart.ux-design` after Phase 1 for early UX feedback.

6. **Keep specs updated.** If you discover something during Phase 4 that should change the architecture, update the spec first (Power Inversion principle).

---

## Getting Help

```
/jumpstart.help              # Display command reference
/jumpstart.status            # Show current workflow state
```

- **Full command reference:** `.jumpstart/commands/commands.md`
- **Agent details:** `.jumpstart/agents/*.md`
- **Configuration options:** `.jumpstart/config.yaml` (fully commented)
- **Cross-assistant setup:** `.jumpstart/compat/assistant-mapping.md`
- **README:** See the root [README](https://github.com/otey247/JumpStart/blob/master/README.md)

---

## Next Steps

- Read the [README](https://github.com/otey247/JumpStart/blob/master/README.md) for the full feature reference
- Explore `.jumpstart/config.yaml` to see all configuration options
- Browse `.jumpstart/agents/` to understand each agent's persona and protocol
- Check `.jumpstart/skills/` for available skills (and create your own with the skill-creator)
- Try `npx jumpstart-mode --help` for CLI options
