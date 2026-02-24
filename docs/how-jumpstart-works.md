# How JumpStart Works

## JumpStart Framework Comprehensive Guide

**TL;DR:** JumpStart is a spec-driven, multi-agent software development lifecycle (SDLC) framework that replaces ad-hoc AI coding with a structured, phase-gated pipeline of 7 core agents and 15 advisory agents. Each agent has a constrained persona, specific protocols, defined tool access, and strict "stay-in-lane" rules. Specifications are the source of truth — code is derived from them, never the other way around. The system enforces traceability, automated quality gates, human approval at every phase boundary, and live documentation verification via Context7 MCP. This document covers every agent, their goals, tools, outputs, and why this approach fundamentally outperforms vanilla AI coding.

---

### 1. The Core Philosophy: Why JumpStart Exists

Vanilla AI agents (ChatGPT, Copilot, Claude) suffer from three fatal problems when building software:

| Problem | What Happens | JumpStart's Fix |
|---|---|---|
| **No memory of intent** | The AI guesses what you want, hallucinates requirements, and drifts from the original goal with each prompt | A **sequential phase pipeline** where each phase's output becomes the contractual input for the next. Every requirement traces back to a validated problem statement. |
| **No separation of concerns** | A single agent plays architect, developer, tester, and PM simultaneously, leading to conflicting decisions | **22 specialized agents**, each with a constrained persona and strict "stay-in-lane" rules. The Challenger never suggests solutions. The Developer never changes architecture. |
| **No quality gates** | The AI produces output with no structured review, no schema validation, no traceability, and no human checkpoint | **5-layer automated quality gates** (schema validation, handoff contracts, prose quality checks, adversarial review, regression golden masters) plus mandatory human approval at every phase boundary. |

---

### 2. The Workflow: Sequential Phase Pipeline

```
[Brownfield only: Scout] → Phase 0: Challenger → Phase 1: Analyst → Phase 2: PM → Phase 3: Architect → Phase 4: Developer
                                        ↑ Party Mode (Facilitator) available at any phase ↑
```

Every phase produces an artifact (stored in `specs/`). Every artifact must be explicitly approved by the human before the next phase begins. This is enforced by the **Phase Gate Approval** section at the bottom of every artifact — all checkboxes must be checked and "Approved by" must not be "Pending."

---

### 3. Core Phase Agents (7 Agents)

#### 3.1 The Scout (Pre-Phase 0) — Codebase Archaeologist

- **When:** Only for brownfield projects (existing codebases)
- **Activation:** `/jumpstart.scout`
- **Goal:** Produce a comprehensive, non-judgmental map of the existing codebase so every downstream agent understands what already exists
- **Protocol:** 7 steps — Repository Scan → Dependency Analysis → Architecture Extraction → Code Pattern Analysis → C4 Diagram Generation (Mermaid) → Risk & Debt Assessment → Compile & Present
- **Tools:** `ask_questions` (gather human context about exclusions, architecture, pain points), `manage_todo_list`, Diagram Verifier (Mermaid syntax validation)
- **Output:** `specs/codebase-context.md` with C4 diagrams at Levels 1-4, `specs/insights/codebase-context-insights.md`
- **Key Constraint:** Descriptive, never prescriptive — documents what exists without suggesting improvements. Never accesses secret/credential file contents.

#### 3.2 The Challenger (Phase 0) — Problem Interrogator

- **Activation:** `/jumpstart.challenge [idea]`
- **Goal:** Prevent building a well-engineered solution to the wrong problem. Surface hidden assumptions, drill to root causes via Branching Five Whys, map stakeholders, reframe the problem, define success criteria.
- **Protocol:** 8 steps — Approver Identification → Project Type Confirmation → Capture Raw Statement → Surface Assumptions (5-10 implicit assumptions categorized as Validated/Believed/Untested) → Root Cause Analysis (Branching Five Whys with Hypothesis Registry) → Stakeholder Mapping → Problem Reframing (1-3 alternative framings) → Validation Criteria → Constraints & Boundaries → Compile & Present
- **Tools:** `ask_questions` (assumption categorization, stakeholder validation, reframe selection), `manage_todo_list`
- **Outputs:** `specs/challenger-brief.md`, `specs/challenger-log.md` (branching analysis, hypothesis registry), `specs/insights/challenger-brief-insights.md`
- **Key Constraint:** **Never proposes solutions** — no features, technologies, or implementations. Redirects premature solution-thinking. Must engage the human in at least assumption surfacing and reframing, even if asked to "just fill it in."

#### 3.3 The Analyst (Phase 1) — Product Conceptualist

- **Activation:** `/jumpstart.analyze`
- **Reads:** Approved Challenger Brief, codebase context (if brownfield)
- **Goal:** Transform the validated problem into a human-centered product concept with personas, journeys, value proposition, and scoped capabilities
- **Protocol:** 10 steps — Context Acknowledgement → Requirements Discovery (invokes Requirements Extractor subagent) → Context Elicitation → Requirements Deep Dive (curated question batches, max 15 `ask_questions` invocations) → Ambiguity Scan (7-category structured scan) → Persona Development → Persona Simulation Walkthroughs → User Journey Mapping → Value Proposition → Competitive Analysis (uses Context7 MCP) → Scope Recommendation (MVP/Phased/Full, domain-adaptive rigor) → Open Questions → Compile & Present
- **Tools:** `ask_questions`, `manage_todo_list`, **Requirements Extractor subagent**, Context7 MCP (competitive analysis)
- **Outputs:** `specs/product-brief.md`, `specs/requirements-responses.md`, `specs/persona-simulation.md`, insights file. Optional: competitive analysis, technical spikes in `specs/research/`
- **Key Constraint:** Recommends **capabilities**, not features. Separates problem-thinking from solution-thinking. Every Must Have capability must trace to a Phase 0 validation criterion.

#### 3.4 The PM (Phase 2) — Requirements Engineer

- **Activation:** `/jumpstart.plan`
- **Reads:** Approved Challenger Brief + Product Brief, codebase context (if brownfield)
- **Goal:** Produce a PRD so precise that the Architect and Developer can translate it into code without follow-up questions
- **Protocol:** 10 steps — Context Summary & Alignment (resolve `[NEEDS CLARIFICATION]` markers) → Epic Definition (3-7 epics) → User Story Decomposition (INVEST stories, configurable format: user story or job story) → Acceptance Criteria (Gherkin or checklist, min 2 per story, at least one negative case) → Non-Functional Requirements (measurable thresholds) → Dependencies & Risk Register → Success Metrics → Implementation Milestones → Task Breakdown (Setup → Foundational → User Story stages, with checkpoints and parallel markers) → Compile & Present
- **Tools:** `ask_questions` (epic validation, story splitting, RICE/ICE prioritization), `manage_todo_list`
- **Output:** `specs/prd.md`, `specs/insights/prd-insights.md`
- **Key Constraint:** Defines **what**, never **how**. Every epic traces to Product Brief, every Must Have to a validation criterion. Assumes the developer has zero prior context — each story is self-contained. Includes unhappy paths for every input/external interaction.

#### 3.5 The Architect (Phase 3) — Technical Blueprint Designer

- **Activation:** `/jumpstart.architect`
- **Reads:** All approved upstream artifacts (Challenger Brief, Product Brief, PRD), codebase context (if brownfield)
- **Goal:** Translate the PRD into a technical blueprint and ordered implementation plan so complete that the Developer never needs to make architectural decisions
- **Protocol:** 9 steps — Context Summary & Technical Elicitation → Technology Stack Selection (with stated justification per layer) → System Component Design (C4 diagrams in Mermaid) → Data Model Design (ER diagrams) → API & Contract Design → Architecture Decision Records (one ADR per significant decision → `specs/decisions/NNN-*.md`) → Infrastructure & Deployment → Implementation Plan Generation (milestone-prefixed tasks: `M1-T01`, with `[S]`equential/`[P]`arallel/`[R]`efactoring/`[M]`igration markers) → Compile & Present
- **Tools:** `ask_questions`, `manage_todo_list`, **Context7 MCP** (Documentation Freshness Audit — hard gate, ≥80% score), Diagram Verifier, plus automated quality tools: `simplicity-gate.js`, `anti-abstraction.js`, `contract-checker.js`, `boundary-check.js`, `invariants-check.js`, `spec-drift.js`
- **Outputs:** `specs/architecture.md`, `specs/implementation-plan.md`, `specs/decisions/NNN-*.md` (ADRs), `specs/documentation-audit.md` (freshness audit), insights files
- **14 Architectural Gates checked before approval:** Library-First, Power Inversion, Simplicity (≤3 top-level directories), Anti-Abstraction, Parallel Implementation Branches, Documentation Freshness (≥80%), Environment Invariants, Security Architecture, Design System, CI/CD Deployment, Data Model & Contracts Pre-Implementation (≥70), Contract-Data Model Alignment, Boundary Validation
- **Key Constraint:** Justifies every choice against requirements, not "industry standard." Designs for current requirements, not hypothetical futures. Uses Context7 for ALL external documentation.

#### 3.6 The Developer (Phase 4) — Plan Executor

- **Activation:** `/jumpstart.build`
- **Reads:** Implementation Plan (primary), Architecture, PRD, ADRs, codebase context (if brownfield)
- **Goal:** Execute the implementation plan task by task, producing working, tested, documented code
- **Protocol:** 6 steps — Pre-flight Check → Generate `TODO.md` (mandatory living document with Tech Manifest, Data Layer, Directory Structure, Canonical Code Patterns, Dependency Graph/DAG, Implementation Checklist with verbatim AC, Traceability Matrix, NFR Constraints, Active ADR Constraints, Roadmap Articles) → Project Scaffolding → **Task Execution Loop** (for each task: read → code → test → run → mark complete → commit) → Milestone Verification → Final Documentation (README.md, final report)
- **TDD Mode** (when `test_drive_mandate: true`): Red → human approval of failing tests → Green → Refactor. Produces `specs/red-phase-report-{task-id}.md` and `specs/test-failure-evidence-{task-id}.md`
- **Tools:** `ask_questions` (deviation decisions), `manage_todo_list`, **Context7 MCP** (before writing external integration code), `spec-drift.js` (run before each milestone)
- **Outputs:** `TODO.md`, `src/` (application code), `tests/` (test code), updated `README.md`, updated `specs/implementation-plan.md` with completion status, TDD artifacts (if active), insights file
- **Deviation Handling:** Minor (implement + document), Major (stop, present options, wait for human), Architectural (never — halt and escalate to Architect)
- **Key Constraint:** Executor, not strategist. Follows the plan. Untested code is unfinished. Functions &lt;40-50 lines. No gold-plating. Commits follow `jumpstart(M1-T01): [title]` format.

#### 3.7 The Facilitator (Party Mode — Any Phase)

- **Activation:** `/jumpstart.party [topic]`
- **Goal:** Multi-agent roundtable discussion. Loads 2-3 relevant agent personas into a single session and orchestrates structured, in-character debate.
- **Protocol:** 5 steps — Welcome & Topic Setting (select relevant agents from roster) → Discussion Orchestration (in-character responses: `**The Architect:** [response]`) → Question Handling → Decision Capture → Session Conclusion
- **Tools:** `ask_questions` (topic narrowing, trade-offs), `manage_todo_list` (track discussion topics/decisions)
- **Output:** Multi-agent conversation in chat + `specs/insights/party-insights.md`. **No spec files, source code, or plan changes.**
- **Key Constraint:** Advisory only — does not modify any artifacts. Decisions must flow through normal phase workflow. Neutral — does not have opinions of its own.

---

### 4. Advisory/Subagents (15 Agents)

These agents provide specialized expertise invocable at any phase. They are advisory — they produce reports and recommendations but do NOT gate the workflow (with one exception: QA when `qa_gate_required: true`).

| # | Agent | Command | Speciality | Key Output | Typical Invocation |
|---|-------|---------|------------|------------|-------------------|
| 1 | **Quinn (QA)** | `/jumpstart.qa` | Test strategy, requirement-to-test traceability, release readiness | `specs/test-plan.md`, `specs/test-report.md` | Human after Phase 3-4; subagent by any phase agent |
| 2 | **Security Architect** | `/jumpstart.security` | STRIDE threat modelling, OWASP Top 10 audit, invariant compliance | `specs/security-review.md` (posture: ACCEPTABLE / NEEDS WORK / UNACCEPTABLE) | Human after Phase 3-4; subagent by Architect or Developer |
| 3 | **Performance Analyst** | `/jumpstart.performance` | NFR quantification (p50/p95/p99), load profiles, bottleneck analysis, cost budgets | `specs/nfrs.md` | Human after Phase 2-3; subagent by PM or Architect |
| 4 | **Domain Researcher** | `/jumpstart.research` | Context7-verified technology evaluation, version pinning, library health | `specs/research/{topic}.md` | Human during Phase 1-3; subagent by Architect or Analyst |
| 5 | **Requirements Extractor** | *(subagent only — no command)* | Cross-references upstream data against requirements checklist; curates prioritized question batches | Returns structured report to caller | **Analyst** (full), **PM** (targeted), **Architect** (targeted) |
| 6 | **UX Designer** | `/jumpstart.ux-design` | Emotional mapping, information architecture, accessibility (WCAG 2.1 AA), interaction patterns | `specs/ux-design.md` | Human after Phase 1; subagent by Analyst or PM |
| 7 | **Refactoring Agent** | `/jumpstart.refactor` | Complexity analysis (cyclomatic >10), code smell detection, structural improvements | `specs/refactor-report.md` | Human after Phase 4; subagent by Developer or Retrospective |
| 8 | **Technical Writer** | `/jumpstart.docs` | Documentation freshness audit, README generation, per-directory AGENTS.md | Updated README.md, `specs/doc-update-checklist.md`, AGENTS.md files | Human during/after Phase 4; subagent by Developer |
| 9 | **Scrum Master** | `/jumpstart.sprint` | Sprint planning, dependency mapping (Mermaid gantt), blocker detection, task readiness | `specs/sprint-status.yaml` | Human after Phase 3; subagent by Developer |
| 10 | **DevOps Engineer** | `/jumpstart.deploy` | CI/CD pipeline configs, deployment strategies, environment promotion, monitoring | `specs/deploy.md` | Human after Phase 3; subagent by Architect or Developer |
| 11 | **Adversary** | `/jumpstart.adversary` | Spec stress-testing, violation detection (automated + manual), scoring (PASS/CONDITIONAL/FAIL) | Adversarial review report | Human at any phase; auto when `adversarial_required: true` |
| 12 | **Reviewer** | `/jumpstart.reviewer` | Peer review scoring: Completeness + Consistency + Traceability + Quality (100pts) | Peer review report (APPROVED ≥80 / NEEDS_REVISION / REJECTED) | Human at any phase; auto when `peer_review_required: true` |
| 13 | **Retrospective** | `/jumpstart.retro` | Post-build plan-vs-reality analysis, deviation catalogue, tech debt inventory, process assessment | `specs/retrospective.md` | Human after Phase 4 |
| 14 | **Maintenance Agent** | `/jumpstart.maintenance` | Dependency drift, spec drift, tech debt accumulation, health scoring | `specs/drift-report.md` (HEALTHY / NEEDS ATTENTION / AT RISK / CRITICAL) | Human after Phase 4, in maintenance windows |
| 15 | **Quick Developer** | `/jumpstart.quick [desc]` | Abbreviated 3-step workflow (Analyze → Implement → Review) for bug fixes and tiny features | Code changes + `specs/quickflow-{desc}.md` | Human after Phase 3; scope guard: ≤5 files, ≤200 LOC |

**Subagent Chaining:** Advisory agents can invoke each other (max chain depth: 2). For example, Security can invoke Researcher for version-verified library recommendations.

---

### 5. Quality Assurance Infrastructure

JumpStart enforces a **5-layer automated quality gate** (Roadmap Article VIII):

| Layer | What It Checks | Tool |
|---|---|---|
| **1. Schema & Formatting** | YAML frontmatter, required sections, ID formats | `validator.js` |
| **2. Handoff Contracts** | Phase transitions, no phantom requirements, upstream traceability | `handoff-validator.js` |
| **3. Unit Tests for English** | Ambiguity (&lt;5 vague adjectives), passive voice (&lt;10), metric coverage (≥80%), terminology drift, spec smells (&lt;5.0/100 lines) | `spec-tester.js`, `smell-detector.js` |
| **4. LLM-as-a-Judge** | Adversary stress-tests + Reviewer scoring (opt-in via config) | Adversary agent, Reviewer agent |
| **5. Regression Golden Masters** | Structural diff against verified baselines (≥85% similarity) | Golden master comparison |

---

### 6. System-Level Enforcement Mechanisms

| Mechanism | What It Does | Tool/File |
|---|---|---|
| **Environment Invariants** | 8 non-negotiable rules (encryption at rest/transit, auth required, audit logging, input validation, error handling, dependency pinning, test coverage floor) | `.jumpstart/invariants.md`, `invariants-check.js` |
| **Context7 MCP** | Live documentation verification for all external libraries — never trust training data | `mcp_context7_resolve-library-id`, `mcp_context7_query-docs` |
| **Spec-Drift Detection** | Detects when code diverges from specs | `spec-drift.js` |
| **Simplicity Gate** | Flags >3 top-level directories without justification | `simplicity-gate.js` |
| **Anti-Abstraction Gate** | Flags unnecessary wrapper code | `anti-abstraction.js` |
| **Contract Checker** | Data model / API contract alignment (≥70 score) | `contract-checker.js` |
| **Boundary Check** | No task exceeds Product Brief scope boundaries | `boundary-check.js` |
| **Cross-Reference Validation** | Bidirectional links between specs | `crossref.js` |
| **Traceability Validation** | Every requirement → test, every test → requirement | `traceability.js` |
| **Rollback Safety** | Archives artifacts before overwrite | `.jumpstart/archive/` |
| **Self-Correction Log** | Records rejected proposals and lessons learned | `.jumpstart/correction-log.md` |
| **Glossary** | Canonical terminology definitions | `.jumpstart/glossary.md` |

---

### 7. Why JumpStart vs. Vanilla AI Agents

| Dimension | Vanilla AI Agent | JumpStart |
|---|---|---|
| **Problem validation** | None — starts coding immediately from whatever the user says | Phase 0 Challenger interrogates assumptions, finds root causes, reframes the problem before any solution thinking |
| **Requirements quality** | Hallucinated, incomplete, no traceability | 4-phase requirements pipeline with Requirements Extractor subagent, 7-category ambiguity scans, `[NEEDS CLARIFICATION]` markers, and upstream traceability enforcement |
| **Architecture decisions** | Implicit, undocumented, changes with every prompt | Explicit ADRs, 14 architectural gates, Context7-verified technology choices, Simplicity + Anti-Abstraction gates |
| **Agent specialization** | One agent does everything poorly | 22 agents, each with constrained persona, step-by-step protocol, and "stay-in-lane" rules. The Challenger never suggests solutions. The Developer never changes architecture. |
| **Human oversight** | None — user hopes for the best | Mandatory Phase Gate Approval at every boundary. Human is the sole authority. No agent can approve its own output. |
| **Specification quality** | No specs, or throwaway docs | 5-layer automated quality gates: schema validation, handoff contracts, prose quality checks ("unit tests for English"), LLM-as-a-Judge, regression golden masters |
| **Documentation freshness** | Relies on stale training data | Context7 MCP mandatory for all external library references. Hard gate: ≥80% freshness score at Architecture phase. |
| **Testing** | Optional, afterthought | Configurable TDD mandate (Red-Green-Refactor with human approval of failing tests). Test coverage floor as environment invariant. Every AC maps to a test. |
| **Deviation handling** | Silent drift | Three-tier deviation protocol (Minor: document + continue, Major: stop + present options, Architectural: never — escalate). Spec-drift check before each milestone. |
| **Memory & learning** | Stateless — forgets everything between sessions | Living insights files, self-correction log, glossary, state persistence, bidirectional cross-references, reasoning traces |
| **Reproducibility** | None — different output every time | Templates for every artifact, JSON schemas for validation, golden master regression tests, archived artifact versions |
| **Security** | Bolted on (if at all) | Environment invariants (encryption, auth, audit logging, input validation), STRIDE threat modelling via Security agent, OWASP Top 10 audit, invariant compliance checks |
| **Scope control** | Scope creep with every prompt | Boundary validation gate, scope tiers (Must/Should/Could/Won't), Quick Developer scope guard (≤5 files, ≤200 LOC) for minor changes |

---

### 8. Activation Quick Reference

| Command | Agent | Phase |
|---|---|---|
| `/jumpstart.scout` | Scout | Pre-0 (brownfield) |
| `/jumpstart.challenge [idea]` | Challenger | 0 |
| `/jumpstart.analyze` | Analyst | 1 |
| `/jumpstart.plan` | PM | 2 |
| `/jumpstart.architect` | Architect | 3 |
| `/jumpstart.build` | Developer | 4 |
| `/jumpstart.party [topic]` | Facilitator | Any |
| `/jumpstart.qa` | QA | Any |
| `/jumpstart.security` | Security | Any |
| `/jumpstart.performance` | Performance | Any |
| `/jumpstart.research` | Researcher | Any |
| `/jumpstart.ux-design` | UX Designer | Any |
| `/jumpstart.refactor` | Refactoring | Any |
| `/jumpstart.docs` | Tech Writer | Any |
| `/jumpstart.sprint` | Scrum Master | Any |
| `/jumpstart.deploy` | DevOps | Any |
| `/jumpstart.adversary` | Adversary | Any |
| `/jumpstart.reviewer` | Reviewer | Any |
| `/jumpstart.retro` | Retrospective | Any |
| `/jumpstart.maintenance` | Maintenance | Any |
| `/jumpstart.quick [desc]` | Quick Developer | After Phase 3 |

---

**Verification:** To confirm this document accurately represents the framework, cross-reference against `.jumpstart/agents/` (all 22 agent files), `.jumpstart/roadmap.md` (5 Core Principles + 11 Engineering Articles), `.jumpstart/invariants.md` (8 environment invariants), and `AGENTS.md` (top-level workflow overview).