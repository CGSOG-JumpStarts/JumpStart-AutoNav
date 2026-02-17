# Jump Start -- Slash Command Definitions

This file defines the slash commands that drive the Jump Start workflow. Each command activates a specific agent or system function. These definitions are consumed by the AI assistant integration layer to route commands to the correct agent persona and instructions.

---

## /jumpstart.scout

**Phase:** Pre-0
**Agent:** The Scout
**Agent File:** `.jumpstart/agents/scout.md`
**Template:** `.jumpstart/templates/codebase-context.md`
**Output:** `specs/codebase-context.md`

**Description:** Analyze an existing codebase to produce a comprehensive context document including C4 architecture diagrams, dependency analysis, code pattern documentation, and structural observations. This command is used only for **brownfield** projects and must be run before Phase 0 (Challenge).

**VS Code Chat Features:**
- If `vscode_tools.use_todo_lists` is enabled in config, create a todo list with all 7 protocol steps at the start
- If `use_ask_questions` is enabled, use interactive carousels for gathering human context about the codebase
- Update the todo list as each step is completed

**Usage:**
```
/jumpstart.scout
```

**Pre-conditions:**
- `project.type` must be `brownfield` in `.jumpstart/config.yaml` (if not set, ask the user to confirm the project type)
- The repository should contain existing source code to analyze

**Behavior:**
1. Load the Scout agent persona from `.jumpstart/agents/scout.md`.
2. Verify `project.type` is `brownfield`. If not set, ask the human to confirm project type and update config.
3. Scan the repository structure, dependencies, architecture, and code patterns.
4. Generate C4 diagrams at the levels configured in `agents.scout.c4_levels`.
5. Populate `specs/codebase-context.md` using the template.
6. Create and maintain `specs/insights/codebase-context-insights.md` documenting discoveries and observations.
7. Present the context document for human approval.
8. On approval, fill in Phase Gate (checkboxes, approver name, date).
9. Automatically hand off to Phase 0 (Challenger).

---

## /jumpstart.challenge

**Phase:** 0
**Agent:** The Challenger
**Agent File:** `.jumpstart/agents/challenger.md`
**Template:** `.jumpstart/templates/challenger-brief.md`
**Output:** `specs/challenger-brief.md`

**Description:** Begin the problem discovery process. The Challenger agent engages the human in a structured elicitation to interrogate assumptions, identify root causes, map stakeholders, and reframe the problem statement.

**VS Code Chat Features:**
- If `vscode_tools.use_todo_lists` is enabled in config, create a todo list with all 8 protocol steps at the start
- If `use_ask_questions` is enabled, use interactive carousels for assumption categorization and reframe selection
- Update the todo list as each step is completed

**Usage:**
```
/jumpstart.challenge [optional: initial idea or problem statement]
```

**Pre-conditions:** None for greenfield projects. For brownfield projects, `specs/codebase-context.md` must exist and be approved (run `/jumpstart.scout` first).

**Behavior:**
1. Load the Challenger agent persona from `.jumpstart/agents/challenger.md`.
2. If `project.approver` is empty in config, ask the human for their name and save it.
3. **Project type confirmation:** If `project.type` is null, ask the human whether this is a greenfield or brownfield project, and update config. If brownfield, verify `specs/codebase-context.md` is approved; if not, direct the human to run `/jumpstart.scout` first.
4. If the human provided an initial statement, use it as Step 1 input.
5. If no statement was provided, prompt the human to describe their idea or problem.
6. Follow the Challenger's Elicitation Protocol (Steps 1-8).
6. Populate `specs/challenger-brief.md` using the template.
7. Create and maintain `specs/insights/challenger-brief-insights.md` documenting key reasoning and alternatives considered.
8. Present the brief for human approval.
9. On approval, fill in Phase Gate (checkboxes, approver name, date), update `config.yaml` to set `current_phase: 0`.
10. Automatically hand off to Phase 1.

---

## /jumpstart.analyze

**Phase:** 1
**Agent:** The Analyst
**Agent File:** `.jumpstart/agents/analyst.md`
**Template:** `.jumpstart/templates/product-brief.md`
**Output:** `specs/product-brief.md`

**Description:** Generate the Product Brief from the approved Challenger Brief. The Analyst agent creates personas, maps user journeys, articulates the value proposition, surveys the competitive landscape, and recommends MVP scope.

**VS Code Chat Features:**
- If `vscode_tools.use_todo_lists` is enabled, track progress through the 10-step Analysis Protocol (includes Ambiguity Scan at Step 3)
- If `use_ask_questions` is enabled, use interactive prompts for ambiguity resolution, persona validation, and scope discussions

**Usage:**
```
/jumpstart.analyze
```

**Pre-conditions:**
- `specs/challenger-brief.md` must exist and be approved.
- If the pre-condition is not met, display: "Phase 0 must be completed first. Run `/jumpstart.challenge` to begin."

**Behavior:**
1. Verify pre-conditions.
2. Load the Analyst agent persona from `.jumpstart/agents/analyst.md`.
3. Read `specs/challenger-brief.md` and `.jumpstart/config.yaml`.
4. Follow the Analyst's Analysis Protocol (Steps 1-10, including Ambiguity Scan at Step 3).
5. Populate `specs/product-brief.md` using the template.
6. Create and maintain `specs/insights/product-brief-insights.md` documenting key reasoning and alternatives considered.
7. Present the brief for human approval.
8. On approval, fill in Phase Gate (checkboxes, approver name, date), update `config.yaml` to set `current_phase: 1`.
9. Automatically hand off to Phase 2.

---

## /jumpstart.plan

**Phase:** 2
**Agent:** The Product Manager
**Agent File:** `.jumpstart/agents/pm.md`
**Template:** `.jumpstart/templates/prd.md`
**Output:** `specs/prd.md`

**Description:** Generate the Product Requirements Document from the approved Product Brief. The PM agent defines epics, writes user stories with acceptance criteria, specifies non-functional requirements, and structures implementation milestones.

**VS Code Chat Features:**
- If `vscode_tools.use_todo_lists` is enabled, track progress through the 10-step Planning Protocol
- Particularly useful when decomposing many epics into stories—shows which epics are complete
- If `use_ask_questions` is enabled, use for epic validation and prioritization discussions

**Usage:**
```
/jumpstart.plan
```

**Pre-conditions:**
- `specs/challenger-brief.md` must exist and be approved.
- `specs/product-brief.md` must exist and be approved.
- If pre-conditions are not met, display which phases are incomplete.

**Behavior:**
1. Verify pre-conditions.
2. Load the PM agent persona from `.jumpstart/agents/pm.md`.
3. Read `specs/challenger-brief.md`, `specs/product-brief.md`, and `.jumpstart/config.yaml`.
4. Follow the PM's Planning Protocol (Steps 1-10).
5. Populate `specs/prd.md` using the template.
6. Create and maintain `specs/insights/prd-insights.md` documenting key reasoning and alternatives considered.
7. Present the PRD for human approval.
8. On approval, fill in Phase Gate (checkboxes, approver name, date), update `config.yaml` to set `current_phase: 2`.
9. Automatically hand off to Phase 3.

---

## /jumpstart.architect

**Phase:** 3
**Agent:** The Architect
**Agent File:** `.jumpstart/agents/architect.md`
**Templates:**
- `.jumpstart/templates/architecture.md`
- `.jumpstart/templates/implementation-plan.md`
- `.jumpstart/templates/adr.md`
**Outputs:**
- `specs/architecture.md`
- `specs/implementation-plan.md`
- `specs/decisions/*.md` (one per ADR)

**Description:** Generate the Architecture Document and Implementation Plan from the approved PRD. The Architect agent selects technologies, designs components and data models, specifies API contracts, records decisions as ADRs, and produces an ordered task breakdown.

**VS Code Chat Features:**
- If `vscode_tools.use_todo_lists` is enabled, track the 9-step protocol and ADR generation progress
- If `use_ask_questions` is enabled, use for technology choices with multiple valid options

**Usage:**
```
/jumpstart.architect
```

**Pre-conditions:**
- `specs/challenger-brief.md` must exist and be approved.
- `specs/product-brief.md` must exist and be approved.
- `specs/prd.md` must exist and be approved.
- If pre-conditions are not met, display which phases are incomplete.

**Behavior:**
1. Verify pre-conditions.
2. Load the Architect agent persona from `.jumpstart/agents/architect.md`.
3. Read all preceding spec files and `.jumpstart/config.yaml`.
4. Follow the Architect's Solutioning Protocol (Steps 1-9).
5. Populate `specs/architecture.md` and `specs/implementation-plan.md` using templates.
6. Create ADR files in `specs/decisions/` using the ADR template.
7. Create and maintain `specs/insights/architecture-insights.md` documenting key reasoning and alternatives considered.
8. Present both documents for human approval.
9. On approval, fill in Phase Gate (checkboxes, approver name, date), update `config.yaml` to set `current_phase: 3`.
10. Automatically hand off to Phase 4.

---

## /jumpstart.build

**Phase:** 4
**Agent:** The Developer
**Agent File:** `.jumpstart/agents/developer.md`
**Output:** Application code (`src/`), tests (`tests/`), updated `README.md`, updated `specs/implementation-plan.md`

**Description:** Execute the implementation plan task by task. The Developer agent writes code, writes tests, runs the test suite, and tracks completion status.

**VS Code Chat Features:**
- If `vscode_tools.use_todo_lists` is enabled, create a milestone and task tracking list
- Update after each task completion to show real-time progress
- If `use_ask_questions` is enabled, use for minor deviation decisions and edge case handling

**Usage:**
```
/jumpstart.build
```

**Pre-conditions:**
- All preceding specs must exist and be approved:
  - `specs/challenger-brief.md`
  - `specs/product-brief.md`
  - `specs/prd.md`
  - `specs/architecture.md`
  - `specs/implementation-plan.md`
- If pre-conditions are not met, display which phases are incomplete.

**Behavior:**
1. Verify pre-conditions.
2. Load the Developer agent persona from `.jumpstart/agents/developer.md`.
3. Read all spec files and `.jumpstart/config.yaml`.
4. Follow the Developer's Implementation Protocol (Steps 1-5).
5. Update `specs/implementation-plan.md` with task completion status as work progresses.
6. Create and maintain `specs/insights/implementation-plan-insights.md` documenting implementation decisions and problem-solving approaches.
7. On completion of all milestones, present the final summary to the human.
8. On approval, fill in Phase Gate (checkboxes, approver name, date), update `config.yaml` to set `current_phase: 4`.

---

## /jumpstart.verify

**Phase:** Any (utility)
**Agent:** The Diagram Verifier
**Agent File:** `.jumpstart/agents/diagram-verifier.md`
**Output:** Verification report (displayed, not written to file)

**Description:** Validate all Mermaid diagrams in specification artifacts for structural syntax correctness and semantic accuracy. Runs both the automated CLI syntax checker and AI-powered semantic validation. Can be invoked manually at any time or is triggered automatically at phase gates for Scout and Architect when `diagram_verification.auto_verify_at_gate` is `true`.

**Usage:**
```
/jumpstart.verify
/jumpstart.verify specs/architecture.md
```

**CLI equivalent:**
```
npx jumpstart-mode verify
npx jumpstart-mode verify --file specs/architecture.md --strict
```

**Pre-conditions:**
- `diagram_verification.enabled` must be `true` in `.jumpstart/config.yaml` (default: `true`).
- At least one Markdown file with Mermaid code blocks must exist in the scan directories.

**Behavior:**
1. Load the Diagram Verifier agent persona from `.jumpstart/agents/diagram-verifier.md`.
2. Read `diagram_verification` settings from `.jumpstart/config.yaml`.
3. Run `npx jumpstart-mode verify` against configured `scan_dirs` (or a specific file if provided).
4. Perform semantic validation on each diagram (level consistency, alias uniqueness, relationship completeness).
5. Present a structured report of findings — errors, warnings, and passes.
6. For each error or warning, suggest a specific fix with corrected Mermaid code.

**Guardrails:**
- The verifier does not modify any files. It reports findings only.
- The responsible agent (Scout or Architect) or the human applies fixes.
- When `strict_c4_semantics` is `true`, C4 level consistency violations are treated as errors.

---

## /jumpstart.party

**Phase:** Any (cross-phase collaboration)
**Agent:** The Facilitator
**Agent File:** `.jumpstart/agents/facilitator.md`
**Output:** None (advisory only — no artifacts are written)

**Description:** Launch Party Mode — a multi-agent roundtable discussion. The Facilitator agent discovers all available agent personas by scanning `.jumpstart/agents/`, selects the most relevant 2-3 agents for the current topic, and orchestrates an in-character discussion. Party Mode is advisory: it surfaces insights and perspectives but does not write or modify any spec artifacts.

**Usage:**
```
/jumpstart.party [optional: topic or question]
```

**Pre-conditions:** None. Party Mode can be invoked at any point in the workflow.

**Behavior:**
1. Load the Facilitator agent persona from `.jumpstart/agents/facilitator.md`.
2. Scan `.jumpstart/agents/*.md` to discover available agent personas.
3. If a topic is provided, select the 2-3 most relevant agents for that topic.
4. If no topic is provided, ask the human what they would like to discuss.
5. Orchestrate a roundtable discussion with agents responding in-character.
6. The Facilitator moderates: keeps discussion on-topic, resolves conflicts, and summarises key points.
7. At session end, present a summary of insights, agreements, and open questions.
8. The human decides what (if anything) to incorporate into formal artifacts.

**Guardrails:**
- No agent may write to any file in `specs/` during Party Mode.
- All agents must respect the Roadmap (`.jumpstart/roadmap.md`).
- The Facilitator stays neutral and does not advocate for any position.

---

## /jumpstart.status

**Phase:** Any
**Agent:** System (no persona)

**Description:** Display the current state of the Jump Start workflow.

**Usage:**
```
/jumpstart.status
```

**Behavior:**
1. Read `.jumpstart/config.yaml` for `current_phase`.
2. Check which spec files exist and their approval status.
3. If Phase 4 is in progress, read `specs/implementation-plan.md` for task completion counts.
4. Display a summary:

```
Jump Start Status: [Project Name]
==================================

Phase 0 (Challenge):    [Complete / In Progress / Not Started]
  Artifact: specs/challenger-brief.md [Exists / Missing] [Approved / Draft]

Phase 1 (Analysis):     [Complete / In Progress / Not Started]
  Artifact: specs/product-brief.md [Exists / Missing] [Approved / Draft]

Phase 2 (Planning):     [Complete / In Progress / Not Started]
  Artifact: specs/prd.md [Exists / Missing] [Approved / Draft]

Phase 3 (Solutioning):  [Complete / In Progress / Not Started]
  Artifacts: specs/architecture.md [Exists / Missing] [Approved / Draft]
             specs/implementation-plan.md [Exists / Missing] [Approved / Draft]
             specs/decisions/ [N ADRs]

Phase 4 (Implementing): [Complete / In Progress / Not Started]
  Progress: [N/M] tasks complete across [X] milestones
  Tests: [N] passing, [N] failing

Next action: Run [/jumpstart.command] to continue.
```

---

## /jumpstart.review

**Phase:** Any
**Agent:** System (no persona)

**Description:** Validate the current phase's artifacts against their templates and gate criteria. Identifies missing sections, incomplete fields, or unmet gate requirements.

**Usage:**
```
/jumpstart.review
```

**Behavior:**
1. Determine the current phase from `config.yaml`.
2. Read the relevant artifact(s) for that phase.
3. Compare against the template to identify:
   - Missing sections
   - Empty or placeholder fields
   - Unmet gate criteria (unchecked items in the Phase Gate Approval section)
4. Report findings with specific remediation guidance.

---

## /jumpstart.insights

**Phase:** Any (utility command)

**Description:** Display living insights captured across all phases. View insights files from any or all phases to see agent reasoning, decisions, and explorations. Insights provide traceability between agent thinking and formal artifacts.

**Usage:**
```
/jumpstart.insights
/jumpstart.insights challenger
/jumpstart.insights analyst
/jumpstart.insights pm
/jumpstart.insights architect
/jumpstart.insights developer
```

**Behavior:**
1. Read files from `specs/insights/` directory.
2. If a phase filter is provided (challenger, analyst, pm, architect, developer), show only insights for that phase.
3. Otherwise, show all insights files in chronological order with phase categories.
4. Highlight connections between phases when insights reference each other.
5. Display insights with timestamps, categories, and summaries.

**When to use:**
- Understanding why decisions were made
- Seeing what alternatives were considered
- Tracking how agent thinking evolved
- Debugging specification issues
- Onboarding new team members to project context

---

## /jumpstart.help

**Phase:** Any
**Agent:** System (no persona)

**Description:** Display available commands and workflow guidance.

**Usage:**
```
/jumpstart.help
```

**Behavior:**
Display the command reference with current availability based on workflow state. Commands whose pre-conditions are not met should be shown as unavailable with a note on what must be completed first.

---

## CLI Subcommands (bin/cli.js)

The following subcommands are available via `node bin/cli.js <subcommand>` or `npx jumpstart <subcommand>`. They implement the architectural foundation tools (Items 1-15, 101).

### validate

**Description:** Validate a spec artifact against its JSON schema and check YAML frontmatter.

**Usage:**
```bash
jumpstart validate <artifact-path>
```

**Behavior:**
1. Extract YAML frontmatter from the artifact.
2. Validate against `.jumpstart/schemas/spec-metadata.schema.json`.
3. If artifact type is detected (prd, adr, architecture, tasks), validate against the type-specific schema as well.
4. Report validation errors or confirm clean.

---

### spec-drift

**Description:** Detect drift between spec artifacts and code. Checks that story IDs, task IDs, and component names in specs are traceable in the codebase.

**Usage:**
```bash
jumpstart spec-drift
```

**Behavior:**
1. Read PRD, architecture, and implementation plan from `specs/`.
2. Extract story IDs, task IDs, and component references.
3. Check code traceability in `src/`.
4. Report orphaned specs (no code) and rogue code (no spec).

---

### hash

**Description:** Register or verify content-addressable hashes for spec artifacts.

**Usage:**
```bash
jumpstart hash register <artifact-path>
jumpstart hash verify
```

**Behavior:**
- `register`: Compute SHA-256 hash of the artifact and store in `.jumpstart/manifest.json`.
- `verify`: Check all registered artifacts against their stored hashes. Report any tampering or drift.

---

### graph

**Description:** Build or query the spec dependency graph.

**Usage:**
```bash
jumpstart graph build
jumpstart graph coverage
```

**Behavior:**
- `build`: Parse all specs and construct the dependency graph in `.jumpstart/spec-graph.json`.
- `coverage`: Report which specs have upstream/downstream links and which are orphaned.

---

### simplicity

**Description:** Run the Simplicity Gate check against the architecture spec. Enforces the maximum top-level directory limit.

**Usage:**
```bash
jumpstart simplicity
```

**Behavior:**
1. Read `simplicity_gate.max_dirs` from config (default: 7).
2. Extract planned directories from `specs/architecture.md`.
3. Count top-level directories and fail if over the limit.

---

### scan-wrappers

**Description:** Scan code for trivial wrapper functions that violate the Anti-Abstraction Gate (Article VII).

**Usage:**
```bash
jumpstart scan-wrappers [directory]
```

**Behavior:**
1. Recursively scan `.js`, `.ts`, `.py` files in the given directory (default: `src/`).
2. Detect single-delegation wrappers, re-export barrels, and passthrough functions.
3. Report violations with file paths and line numbers.

---

### invariants

**Description:** Check architecture and implementation plan against environment invariants.

**Usage:**
```bash
jumpstart invariants
```

**Behavior:**
1. Load invariants from `.jumpstart/invariants.md`.
2. Check `specs/architecture.md` for invariant coverage.
3. Check `specs/implementation-plan.md` for invariant coverage.
4. Generate a compliance report showing which invariants are addressed and which are missing.

---

### version-tag

**Description:** Generate and apply a semantic version tag to the current spec artifacts.

**Usage:**
```bash
jumpstart version-tag [major|minor|patch]
```

**Behavior:**
1. Read existing version tags from git.
2. Compute the next version based on bump type (default: patch).
3. Create a git tag with the computed version.

---

### template-check

**Description:** Detect if templates have changed since specs were last generated. Alerts when specs may be stale.

**Usage:**
```bash
jumpstart template-check
```

**Behavior:**
1. Build a snapshot of all templates in `.jumpstart/templates/`.
2. Compare against the last known snapshot.
3. For changed templates, identify which specs were derived from them.
4. Report which specs may need regeneration.

---

### freshness-audit

**Description:** Run the Context7 Documentation Freshness Audit on spec artifacts. Scans for technology references lacking `[Context7: ...]` citations.

**Usage:**
```bash
jumpstart freshness-audit
```

**Behavior:**
1. Scan all files in `specs/` for technology keywords.
2. Check each reference for a corresponding Context7 citation marker.
3. Compute a freshness score (cited / total references).
4. Fail if score is below the configured threshold (default: 80%).

---

### shard

**Description:** Analyze a PRD for sharding. If the PRD exceeds the configured epic threshold, generate atomic shard files and an index.

**Usage:**
```bash
jumpstart shard [prd-path]
```

**Behavior:**
1. Read the PRD from the given path (default: `specs/prd.md`).
2. Extract epics and count them.
3. If epic count exceeds `sharding.epic_threshold` (default: 5), generate one shard file per epic in `specs/shards/`.
4. Generate a shard index at `specs/prd-index.md` using the template.
5. Each shard is a self-contained atom with its own frontmatter metadata and cross-references.

---

### test

**Description:** Run the 5-layer quality test suites. Supports layer-specific flags.

**Usage:**
```bash
jumpstart test                    # Run all tests
jumpstart test --unit             # Layer 1 + Layer 3 (schema + prose)
jumpstart test --integration      # Layer 2 (handoff contracts)
jumpstart test --regression       # Layer 5 (golden masters)
jumpstart test --adversarial      # Layer 4 (prompts LLM review)
```

**Behavior:**
1. Delegate to Vitest with the appropriate test file filter.
2. For `--adversarial`, inform the user to use `/jumpstart.adversary` in chat (requires LLM).
3. Exit with code 1 on test failure.

---

### checklist

**Description:** Run the spec quality checklist on an artifact. Evaluates ambiguity, passive voice, metric coverage, terminology drift, and smell density.

**Usage:**
```bash
jumpstart checklist <spec-file>
```

**Behavior:**
1. Read the spec file.
2. Run all checks from `spec-tester.runAllChecks()`.
3. Generate and print a markdown quality report with scores and issue counts.

---

### smells

**Description:** Detect spec smells in an artifact — vague quantifiers, hedge words, dangling references, unbounded lists, missing owners, and wishful thinking.

**Usage:**
```bash
jumpstart smells <spec-file>
```

**Behavior:**
1. Read the spec file.
2. Run `smell-detector.detectSmells()` and `scoreSmellDensity()`.
3. Generate and print a grouped markdown smell report with severity ratings.

---

### handoff-check

**Description:** Validate a handoff contract by extracting a structured payload from an artifact and validating it against the appropriate handoff schema.

**Usage:**
```bash
jumpstart handoff-check <artifact-path> [target-phase]
```

**Arguments:**
- `artifact-path`: Path to the source spec artifact
- `target-phase`: `architect` | `dev` | `qa` (default: `architect`)

**Behavior:**
1. Extract a structured handoff payload from the artifact.
2. Validate against the handoff schema for the target phase.
3. Report success or list contract violations.

---

### coverage

**Description:** Check that 100% of PRD user stories are mapped to at least one implementation task in the plan.

**Usage:**
```bash
jumpstart coverage <prd-path> <plan-path>
```

**Behavior:**
1. Extract story IDs (E##-S##) from the PRD.
2. Extract task mappings (M##-T##) from the implementation plan.
3. Report covered vs uncovered stories and coverage percentage.

---

## /jumpstart.adversary

**Phase:** Any (opt-in)
**Agent:** The Adversary
**Agent File:** `.jumpstart/agents/adversary.md`
**Template:** `.jumpstart/templates/adversarial-review.md`
**Output:** (report only — does not modify artifacts)

**Description:** Activate the Adversary agent to stress-test a specification artifact. The Adversary runs automated quality checks (ambiguity, passive voice, smells, handoff validation) and performs manual inspection for untestable requirements, scope creep, and contradictions.

**Usage:**
```
/jumpstart.adversary <artifact-path>
```

**Pre-conditions:**
- The target artifact must exist.
- `testing.adversarial_required` in config controls whether this is mandatory or opt-in.

**Behavior:**
1. Load the Adversary persona from `.jumpstart/agents/adversary.md`.
2. Run automated checks (spec-tester, smell-detector, handoff-validator).
3. Perform manual inspection for untestable requirements and scope creep.
4. Generate a scored adversarial review report.
5. Present findings — the human decides whether to block the phase gate.

---

## /jumpstart.reviewer

**Phase:** Any (opt-in)
**Agent:** The Reviewer
**Agent File:** `.jumpstart/agents/reviewer.md`
**Template:** `.jumpstart/templates/peer-review.md`
**Output:** (report only — does not modify artifacts)

**Description:** Activate the Reviewer agent for structured peer review. Scores the artifact across four dimensions: Completeness, Consistency, Upstream Traceability, and Quality of Expression.

**Usage:**
```
/jumpstart.reviewer <artifact-path>
```

**Pre-conditions:**
- The target artifact must exist.
- Upstream artifacts should be available for traceability evaluation.

**Behavior:**
1. Load the Reviewer persona from `.jumpstart/agents/reviewer.md`.
2. Run automated analysis (spec-tester, smell-detector).
3. Score across four dimensions (25 points each, total 100).
4. Generate a peer review report with assessment (APPROVED / NEEDS_REVISION / REJECTED).
5. Present findings — the human decides on the phase gate.

---

## /jumpstart.ux-design

**Phase:** Advisory (after Phase 1)
**Agent:** The UX Designer
**Agent File:** `.jumpstart/agents/ux-designer.md`
**Template:** `.jumpstart/templates/ux-design.md`
**Output:** `specs/ux-design.md`, `specs/insights/ux-design-insights.md`

**Description:** Activate the UX Designer agent for emotional response mapping, information architecture, interaction pattern guidelines, and accessibility review.

**Usage:**
```
/jumpstart.ux-design
```

**Pre-conditions:**
- `specs/product-brief.md` must exist and be approved.

**Behavior:**
1. Load the UX Designer persona from `.jumpstart/agents/ux-designer.md`.
2. Map emotional response curves for each persona.
3. Define information architecture and navigation.
4. Specify interaction patterns and component guidelines.
5. Conduct accessibility review (WCAG 2.1 AA).
6. Compile UX Design document for human review.

---

## /jumpstart.qa

**Phase:** Advisory (during or after Phase 4)
**Agent:** Quinn (QA Agent)
**Agent File:** `.jumpstart/agents/qa.md`
**Templates:** `.jumpstart/templates/test-plan.md`, `.jumpstart/templates/test-report.md`
**Output:** `specs/test-plan.md`, `specs/test-report.md`, `specs/insights/qa-insights.md`

**Description:** Activate the QA agent for test strategy definition, requirement-to-test traceability, coverage analysis, and release readiness assessment.

**Usage:**
```
/jumpstart.qa
```

**Pre-conditions:**
- `specs/prd.md` and `specs/architecture.md` must exist and be approved.
- `specs/implementation-plan.md` must exist.

**Behavior:**
1. Load the QA persona from `.jumpstart/agents/qa.md`.
2. Define test strategy mapped to risk profile.
3. Create requirement-to-test traceability matrix.
4. Specify test cases for critical paths.
5. Define regression suite and performance tests.
6. Produce release readiness report with recommendation.

---

## /jumpstart.sprint

**Phase:** Advisory (after Phase 3)
**Agent:** The Scrum Master
**Agent File:** `.jumpstart/agents/scrum-master.md`
**Template:** `.jumpstart/templates/sprint-status.yaml`
**Output:** `specs/sprint-status.yaml`, `specs/insights/sprint-insights.md`

**Description:** Activate the Scrum Master agent for sprint planning, dependency mapping, blocker detection, and velocity tracking.

**Usage:**
```
/jumpstart.sprint
```

**Pre-conditions:**
- `specs/implementation-plan.md` must exist and be approved.
- `specs/prd.md` must exist and be approved.

**Behavior:**
1. Load the Scrum Master persona from `.jumpstart/agents/scrum-master.md`.
2. Assess task readiness for each implementation task.
3. Organise tasks into sprints by milestone and dependency.
4. Map dependencies and identify critical path.
5. Detect risks and blockers.
6. Generate sprint status report.

---

## /jumpstart.security

**Phase:** Advisory (after Phase 3 or Phase 4)
**Agent:** The Security Architect
**Agent File:** `.jumpstart/agents/security.md`
**Template:** `.jumpstart/templates/security-review.md`
**Output:** `specs/security-review.md`, `specs/insights/security-insights.md`

**Description:** Activate the Security Architect agent for STRIDE threat modelling, OWASP Top 10 audit, and invariant compliance verification.

**Usage:**
```
/jumpstart.security
```

**Pre-conditions:**
- `specs/architecture.md` must exist (preferred), or `specs/prd.md` must exist.

**Behavior:**
1. Load the Security Architect persona from `.jumpstart/agents/security.md`.
2. Identify and classify data, system, and access assets.
3. Conduct STRIDE threat modelling at each trust boundary.
4. Audit against OWASP Top 10 (2021) risks.
5. Verify invariant compliance from `.jumpstart/invariants.md`.
6. Produce security review with severity-rated findings and posture assessment.

---

## /jumpstart.performance

**Phase:** Advisory (after Phase 2 or Phase 3)
**Agent:** The Performance Analyst
**Agent File:** `.jumpstart/agents/performance.md`
**Template:** `.jumpstart/templates/nfrs.md`
**Output:** `specs/nfrs.md`, `specs/insights/performance-insights.md`

**Description:** Activate the Performance Analyst agent to quantify NFRs, define load profiles, estimate costs, and analyse architecture bottlenecks.

**Usage:**
```
/jumpstart.performance
```

**Pre-conditions:**
- `specs/prd.md` must exist (for NFRs to quantify).

**Behavior:**
1. Load the Performance Analyst persona from `.jumpstart/agents/performance.md`.
2. Quantify all performance NFRs with measurable SLAs.
3. Define load profiles (normal, peak, growth).
4. Analyse architecture bottlenecks and critical path.
5. Estimate cost budgets per scenario.
6. Recommend performance test strategy.

---

## /jumpstart.docs

**Phase:** Advisory (during or after Phase 4)
**Agent:** The Technical Writer
**Agent File:** `.jumpstart/agents/tech-writer.md`
**Template:** `.jumpstart/templates/doc-update-checklist.md`
**Output:** `specs/doc-update-checklist.md`, updated `README.md`, updated `AGENTS.md` files

**Description:** Activate the Technical Writer sidecar for documentation freshness audits, README updates, and AGENTS.md file maintenance.

**Usage:**
```
/jumpstart.docs
```

**Pre-conditions:**
- `specs/architecture.md` should exist.
- Source code should exist in `src/`.

**Behavior:**
1. Load the Technical Writer persona from `.jumpstart/agents/tech-writer.md`.
2. Audit documentation inventory and freshness.
3. Generate or update README with current project state.
4. Audit API documentation accuracy.
5. Create/update AGENTS.md files per source directory.
6. Compile documentation update checklist.

---

## /jumpstart.research

**Phase:** Advisory (any phase)
**Agent:** The Domain Researcher
**Agent File:** `.jumpstart/agents/researcher.md`
**Template:** `.jumpstart/templates/research.md`
**Output:** `specs/research/{topic}.md`, `specs/insights/research-insights.md`

**Description:** Activate the Domain Researcher for Context7-verified technology evaluation, library health assessment, version pinning, and competitive analysis.

**Usage:**
```
/jumpstart.research [topic]
```

**Pre-conditions:**
- Context7 MCP should be available for documentation verification.

**Behavior:**
1. Load the Researcher persona from `.jumpstart/agents/researcher.md`.
2. Identify technology claims in the target document.
3. Verify each claim via Context7 MCP with citation markers.
4. Assess library health (releases, CVEs, license, community).
5. Produce version-pinned dependency recommendations.
6. Compile research report with sources.

---

## /jumpstart.refactor

**Phase:** Advisory (after Phase 4)
**Agent:** The Refactoring Agent
**Agent File:** `.jumpstart/agents/refactor.md`
**Template:** `.jumpstart/templates/refactor-report.md`
**Output:** `specs/refactor-report.md`, `specs/insights/refactor-insights.md`

**Description:** Activate the Refactoring Agent for complexity analysis, code smell detection, and structural improvement recommendations.

**Usage:**
```
/jumpstart.refactor
```

**Pre-conditions:**
- Source code must exist in `src/` with passing tests.
- `specs/architecture.md` should exist for pattern alignment.

**Behavior:**
1. Load the Refactoring Agent persona from `.jumpstart/agents/refactor.md`.
2. Scan for complexity (cyclomatic, nesting, file length).
3. Detect code smells (duplication, dead code, god objects).
4. Check pattern alignment against architecture.
5. Review naming consistency.
6. Produce prioritised refactoring report with effort estimates.

---

## /jumpstart.maintenance

**Phase:** Advisory (post-build, ongoing)
**Agent:** The Maintenance Agent
**Agent File:** `.jumpstart/agents/maintenance.md`
**Template:** `.jumpstart/templates/drift-report.md`
**Output:** `specs/drift-report.md`, `specs/insights/maintenance-insights.md`

**Description:** Activate the Maintenance Agent for dependency drift detection, specification drift analysis, and technical debt inventory.

**Usage:**
```
/jumpstart.maintenance
```

**Pre-conditions:**
- Source code must exist in `src/`.
- Specification artifacts must exist in `specs/`.
- A package manifest must exist.

**Behavior:**
1. Load the Maintenance Agent persona from `.jumpstart/agents/maintenance.md`.
2. Scan dependencies for outdated, deprecated, or vulnerable packages.
3. Compare implementation against spec artifacts for drift.
4. Inventory technical debt markers (TODO, FIXME, HACK).
5. Assess test suite health.
6. Produce drift report with prioritised remediation plan.

---

## /jumpstart.quick

**Phase:** Any (bypass for minor changes)
**Agent:** The Quick Developer
**Agent File:** `.jumpstart/agents/quick-dev.md`
**Template:** `.jumpstart/templates/quickflow.md`
**Output:** `specs/quickflow-{description}.md`

**Description:** Activate the Quick Flow abbreviated 3-step workflow for bug fixes, copy edits, and tiny features that don't warrant the full 5-phase process.

**Usage:**
```
/jumpstart.quick
```

**Pre-conditions:**
- Change must qualify under the Quick Flow scope guard (≤5 files, ≤200 LOC, no new dependencies, no schema changes).
- If the change doesn't qualify, the agent will redirect to the full workflow.

**Behavior:**
1. Load the Quick Developer persona from `.jumpstart/agents/quick-dev.md`.
2. Qualify the change against scope guard criteria.
3. If qualified: Analyze → Implement → Review (3 steps).
4. If not qualified: Redirect to `/jumpstart.challenge` for full workflow.
5. Produce abbreviated change report with verification checklist.

---

## /jumpstart.retro

**Phase:** Post-build (after Phase 4)
**Agent:** The Retrospective Agent
**Agent File:** `.jumpstart/agents/retrospective.md`
**Template:** `.jumpstart/templates/retrospective.md`
**Output:** `specs/retrospective.md`, `specs/insights/retrospective-insights.md`

**Description:** Activate the Retrospective Agent to generate an "Implementation Learnings" report after build completion, capturing plan vs reality, tech debt, and process improvements.

**Usage:**
```
/jumpstart.retro
```

**Pre-conditions:**
- Phase 4 must be complete (implementation finished).
- Implementation plan, architecture, and source code must exist.

**Behavior:**
1. Load the Retrospective Agent persona from `.jumpstart/agents/retrospective.md`.
2. Compare implementation plan estimates vs actual results.
3. Catalogue deviations, tech debt, and gotchas.
4. Assess process effectiveness and framework issues.
5. Compile learnings and recommendations.
6. Produce retrospective report with actionable improvements.

---

## /jumpstart.revert

**Phase:** Any
**Agent:** System (no agent persona)
**Template:** N/A
**Output:** Reverted artifact + archived copy in `.jumpstart/archive/`

**Description:** Revert a spec artifact to its previous state using git history. Creates a timestamped archive of the current version before reverting.

**Usage:**
```
/jumpstart.revert {artifact-path}
```

**Pre-conditions:**
- The artifact file must exist.
- Git must be initialised in the project.

**Behavior:**
1. Archive the current version with timestamp to `.jumpstart/archive/`.
2. Create metadata JSON alongside the archived file.
3. Restore the previous version from git HEAD.
4. Report what was reverted and where the archive is stored.

---

## /jumpstart.scan

**Phase:** Any (project context discovery)
**Agent:** System (no agent persona)
**Template:** `.jumpstart/templates/project-context.md`
**Output:** `specs/project-context.md`

**Description:** Scan the project directory to detect tech stack, dependencies, patterns, and risks. Generates or updates the project context document.

**Usage:**
```
/jumpstart.scan
```

**Pre-conditions:**
- Project directory must contain source code.

**Behavior:**
1. Scan project directories (excluding node_modules, .git, etc.).
2. Detect language, runtime, framework, and package manager.
3. Identify code patterns and conventions.
4. Count technical debt markers (TODO, FIXME, HACK).
5. Identify risks (no tests, no lock file, .env exposure).
6. Generate project-context.md from the scan results.

---

## /jumpstart.sprint-plan

**Phase:** Post-PRD (after Phase 2 approval)
**Agent:** The Scrum Master
**Agent File:** `.jumpstart/agents/scrum-master.md`
**Template:** `.jumpstart/templates/sprint-planning.md`, `.jumpstart/templates/sprint.yaml`
**Output:** `specs/sprint-planning.md`, `specs/sprint-status.yaml`

**Description:** Initialize sprint tracking after PRD approval. Generate sprint board, assignments, velocity targets, and definition of done.

**Usage:**
```
/jumpstart.sprint-plan
```

**Pre-conditions:**
- PRD must be approved (`specs/prd.md` exists with Phase Gate approved).
- Implementation plan should exist for accurate task estimation.

**Behavior:**
1. Load the Scrum Master persona from `.jumpstart/agents/scrum-master.md`.
2. Parse implementation plan for tasks and dependencies.
3. Estimate velocity and assign tasks to sprints.
4. Generate sprint board YAML with states and ceremonies.
5. Create sprint planning document with backlog and capacity.
6. Define ceremonies timeline and definition of done.

---

## /jumpstart.crossref

**Phase:** Any (validation)
**Agent:** System (no agent persona)
**Template:** N/A
**Output:** Cross-reference validation report (stdout)

**Description:** Validate bidirectional cross-references between spec artifacts. Checks that links point to existing files and sections, and that paired documents link back to each other.

**Usage:**
```
/jumpstart.crossref
```

**Pre-conditions:**
- Spec artifacts must exist in `specs/`.

**Behavior:**
1. Scan all markdown files in `specs/`.
2. Extract and validate all internal links.
3. Check anchor references against heading slugs.
4. Verify bidirectional link requirements.
5. Report broken links, orphan sections, and missing backlinks.

---

## /jumpstart.adr-search

**Phase:** Any (search)
**Agent:** System (no agent persona)
**Template:** N/A
**Output:** Search results (stdout)

**Description:** Search Architecture Decision Records by tag, component, date, or free text. Builds and maintains an ADR index for fast searching.

**Usage:**
```
/jumpstart.adr-search {query}
```

**Pre-conditions:**
- ADR files must exist in `specs/decisions/`.

**Behavior:**
1. Build or refresh the ADR index from `specs/decisions/*.md`.
2. Search by query term, tag, component, or status.
3. Return matching ADRs with titles, dates, and summaries.

---

## /jumpstart.checklist

**Phase:** Any (Post Phase 2+)
**Agent:** None (utility command)
**Added by:** Item 61

**Description:** Run the spec quality checklist against approved artifacts. Uses `bin/lib/spec-tester.js` to evaluate ambiguity, passive voice, metric coverage, and other quality dimensions. Outputs a scored checklist using `.jumpstart/templates/spec-checklist.md`.

**Usage:**
```
/jumpstart.checklist
/jumpstart.checklist specs/prd.md
```

**Pre-conditions:**
- At least one spec artifact must exist in `specs/`.

**Behavior:**
1. If a specific file is provided, run spec-tester against that file.
2. If no file, run against all artifacts in `specs/`.
3. Output quality scores and checklist results.
4. Flag any items below configured thresholds.

---

## /jumpstart.consistency

**Phase:** Any (Post Phase 2+)
**Agent:** None (utility command)
**Added by:** Item 64

**Description:** Run consistency analysis across spec artifacts to detect contradictions, missing coverage, terminology drift, and NFR gaps. Uses `bin/lib/analyzer.js`. Outputs report using `.jumpstart/templates/consistency-report.md`.

**Usage:**
```
/jumpstart.consistency
/jumpstart.consistency specs/
```

**Pre-conditions:**
- PRD and/or architecture artifacts must exist in `specs/`.

**Behavior:**
1. Load all spec artifacts from the specs directory.
2. Cross-reference story IDs, task IDs, NFR IDs, entity names, and terminology.
3. Report contradictions, missing coverage, and terminology drift.
4. Output a consistency score (pass ≥ 70).

---

## /jumpstart.smell

**Phase:** Any (Post Phase 2+)
**Agent:** None (utility command)
**Added by:** Item 72

**Description:** Detect spec smells in artifacts — vague language, scope creep signals, missing constraints, and other anti-patterns. Uses `bin/lib/smell-detector.js`.

**Usage:**
```
/jumpstart.smell
/jumpstart.smell specs/prd.md
```

**Pre-conditions:**
- At least one spec artifact must exist in `specs/`.

**Behavior:**
1. Scan the specified artifact (or all artifacts) for smell patterns.
2. Report each smell with location, type, and severity.
3. Output smell density (smells per 100 prose lines).
4. Compare against `testing.spec_quality.smell_density_max` threshold.

---

## /jumpstart.status

**Phase:** Any
**Agent:** Status Reporter (prompt-based)
**Added by:** Item 80

**Description:** Generate a comprehensive project status dashboard showing phase progress, artifact inventory, quality metrics, open clarifications, and ADR summary. Uses `.github/prompts/status.md` prompt and `.jumpstart/templates/status.md` template.

**Usage:**
```
/jumpstart.status
```

**Pre-conditions:**
- Project must be initialized (`.jumpstart/config.yaml` exists).

**Behavior:**
1. Scan `specs/` for all phase artifacts and their approval status.
2. Check quality scores from recent tool runs.
3. Count `[NEEDS CLARIFICATION]` tags across artifacts.
4. Summarize ADRs from `specs/decisions/`.
5. Generate a visual dashboard with ASCII progress bars.

---

## /jumpstart.resume

**Phase:** Any
**Agent:** System (no persona)
**Added by:** Item 101
**Template:** `.jumpstart/templates/session-briefing.md`

**Description:** Present a concise session resumption briefing showing where you left off, what's next, key insights, open questions, and how to get started. Designed for starting a new session after an interruption. Also auto-triggered on agent activation when `session_briefing.auto_trigger` is `true` in config.

**Usage:**
```
/jumpstart.resume
```

**Pre-conditions:**
- Project must be initialized (`.jumpstart/config.yaml` exists).
- `session_briefing.enabled` must be `true` in config (default).

**Behavior:**
1. Read `.jumpstart/config.yaml` for `session_briefing` settings.
2. Read `.jumpstart/state/state.json` for `resume_context`, `current_phase`, `current_agent`, `phase_history`, `approved_artifacts`.
3. Read `.jumpstart/state/todos.json` for `active_phase`, `todos[]`, `completed[]`.
4. Scan `specs/insights/*.md` for the most recent insight entries (by timestamp), up to `session_briefing.max_insights`.
5. Scan `specs/*.md` for `[NEEDS CLARIFICATION]` tags.
6. Check `specs/qa-log.md` for unanswered questions.
7. Determine the next recommended action:
   - If `resume_context.next_action` is populated, use it.
   - Otherwise, derive from `current_phase` using the phase transition map in `bin/lib/handoff.js`.
   - If no phase has started, recommend `/jumpstart.challenge`.
8. Render the briefing using `.jumpstart/templates/session-briefing.md` format.
9. The briefing includes: TLDR, Where You Left Off, What's Next, Key Insights, Open Questions, and Get Started.

**Output:**
Ephemeral — displayed to the user but not written to a file. No artifact is created.

**Auto-Trigger:**
When `session_briefing.auto_trigger` is `true`, every phase agent (Scout, Challenger, Analyst, PM, Architect, Developer) presents this briefing before starting its protocol, provided `resume_context` in state.json contains prior work data. If `resume_context` is empty/null (fresh project), the briefing is skipped.

---

## /jumpstart.deploy

**Phase:** Any (Post Phase 3+)
**Agent:** DevOps Engineer (advisory)
**Added by:** Item 98

**Description:** Activate the DevOps Engineer agent to generate CI/CD pipeline configurations, deployment plans, environment strategies, and monitoring recommendations. Uses `.jumpstart/agents/devops.md` persona and `.jumpstart/templates/deploy.md` + `.jumpstart/templates/ci-cd.yml` templates.

**Usage:**
```
/jumpstart.deploy
```

**Pre-conditions:**
- `specs/architecture.md` must exist and be approved.
- `specs/implementation-plan.md` must exist.

**Behavior:**
1. Read architecture and implementation plan for tech stack and infrastructure decisions.
2. Define environment promotion strategy (dev → staging → production).
3. Generate CI/CD pipeline configuration from `.jumpstart/templates/ci-cd.yml`.
4. Create deployment plan with rollback procedures and monitoring.
5. Output `specs/deploy.md` and `specs/insights/deploy-insights.md`.
6. Present to human for review (advisory, non-gating).

---

## /jumpstart.next

**Phase:** Any
**Agent:** System (no persona)
**Added by:** UX Feature 1

**Description:** Auto-pilot phase progression. Reads workflow state, checks artifact approval status, and recommends the next action. Eliminates manual slash command memorization by providing intelligent "what's next" guidance with the exact command to run.

**Usage:**
```
/jumpstart.next
```

**Pre-conditions:**
- Project must be initialized (`.jumpstart/config.yaml` exists), OR the command will recommend initialization.

**Behavior:**
1. Read `.jumpstart/state/state.json` for `current_phase`, `approved_artifacts`.
2. Read `.jumpstart/config.yaml` for `project.type` (greenfield vs brownfield) and `workflow.require_gate_approval`.
3. Determine the current state:
   - **Fresh project (no phase started):**
     - Brownfield without Scout artifact → recommend `/jumpstart.scout`
     - Brownfield with unapproved Scout artifact → recommend approval
     - Greenfield → recommend `/jumpstart.challenge`
   - **Mid-workflow (phase in progress):**
     - Current artifact missing → recommend continuing current phase
     - Current artifact exists but unapproved → recommend `/jumpstart.review`
     - Current artifact approved → use `PHASE_MAP` from `bin/lib/handoff.js` to determine next phase → recommend the activation command
   - **Final phase (Phase 4):**
     - Recommend `/jumpstart.status` or `/jumpstart.deploy`
4. Return: action type, current phase, next phase, next agent, activation command, human-readable message, and context files needed.
5. Does NOT auto-activate the next agent — preserves human-in-the-loop per Article X.

**CLI equivalent:**
```bash
jumpstart-mode next
```

**Output:**
Ephemeral — displayed conversationally. The AI presents the recommendation and the user decides whether to proceed.

---

## /jumpstart.ceremony

**Phase:** Any
**Agent:** System (no persona)
**Added by:** UX Feature 3

**Description:** View or change the ceremony profile that controls the framework's overall rigor level. Profiles expand into concrete config overrides as a base layer — explicit user settings always take precedence.

**Usage:**
```
/jumpstart.ceremony
/jumpstart.ceremony light
/jumpstart.ceremony standard
/jumpstart.ceremony rigorous
```

**Pre-conditions:**
- Project must be initialized (`.jumpstart/config.yaml` exists).

**Profile Definitions:**

| Profile | Description | Use Case |
|---------|-------------|----------|
| `light` | Quick elicitation, fewer gates, relaxed quality thresholds | Prototypes, small features, rapid iteration |
| `standard` | Balanced workflow with all core gates (default) | Most projects |
| `rigorous` | Deep elicitation, mandatory adversarial + security review, strict TDD | Enterprise, regulated, high-risk projects |

**Key Settings by Profile:**

| Setting | Light | Standard | Rigorous |
|---------|-------|----------|----------|
| Elicitation depth | quick | standard | deep |
| NFRs required | no | yes | yes |
| ADRs required | no | yes | yes |
| API contracts | no | yes | yes |
| Adversarial review | no | no | yes |
| Peer review | no | no | yes |
| TDD mandate | no | no | yes |
| Quality score minimum | 50 | 70 | 85 |
| Metric coverage minimum | 60% | 80% | 95% |

**Behavior:**
1. If no argument: display the current profile and a summary of all profiles.
2. If a profile name is given: update `ceremony.profile` in `.jumpstart/config.yaml`.
3. Display which settings will change and their new values.
4. Profile values are defaults — any explicit overrides in config.yaml still take precedence.

**CLI equivalent:**
```bash
jumpstart-mode ceremony              # Show current profile
jumpstart-mode ceremony set light    # Set to light profile
jumpstart-mode ceremony compare light rigorous  # Compare two profiles
```

---

## /jumpstart.summarize

**Phase:** Any (most useful before Phases 2–4)
**Agent:** System (no persona)
**Added by:** UX Feature 9

**Description:** Generate a compressed context packet for a target phase, containing only the upstream information that phase agent needs. Reduces token usage by extracting structured data (user stories, NFRs, tech stack, components, tasks) and summarizing prose sections, while preserving acceptance criteria, `[NEEDS CLARIFICATION]` tags, and NFR metrics verbatim.

**Usage:**
```
/jumpstart.summarize
/jumpstart.summarize 4
/jumpstart.summarize 3
```

**Pre-conditions:**
- At least one upstream artifact must exist in `specs/`.

**Behavior:**
1. Determine the target phase (from argument, or auto-detect from `.jumpstart/state/state.json`).
2. Look up the context files the target phase needs (from `PHASE_CONTEXT` map).
3. For each file:
   - Extract YAML frontmatter metadata.
   - Parse section headings and content.
   - Extract structured data: user stories (E##-S##), NFRs (NFR-##), tech stack tables, component definitions, tasks (M##-T##).
   - Preserve verbatim: acceptance criteria, `[NEEDS CLARIFICATION]` tags, NFR metric values.
   - Summarize prose sections (first paragraph + bullet points, truncated to ~500 chars).
4. Aggregate all structured data into a single context packet.
5. Present as a formatted summary with:
   - Requirements overview table (stories + acceptance criteria)
   - NFR table with metrics
   - Tech stack table
   - Architecture components list
   - Implementation tasks by milestone
   - Open items (all `[NEEDS CLARIFICATION]` tags)
   - Full artifact links for drill-down
6. Report compression ratio (typically 40–70% reduction in characters).

**CLI equivalent:**
```bash
jumpstart-mode summarize 4             # JSON output for Phase 4
jumpstart-mode summarize 4 --markdown  # Markdown output for Phase 4
```

**Output:**
Ephemeral by default — displayed to the user. Can be saved to a file if needed:
```bash
jumpstart-mode summarize 4 --markdown > .jumpstart/context-packet-phase4.md
```
