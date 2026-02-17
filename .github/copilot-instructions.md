# Jump Start Framework

This project uses the **Jump Start** spec-driven agentic coding framework. Development follows five sequential phases, each owned by a specialized AI agent.

## Context7 MCP Mandate (HIGH PRIORITY)

**CRITICAL RULE:** When referencing any external library, framework, CLI tool, or service — you MUST use Context7 MCP to fetch live, verified documentation. Never rely on training data for API signatures, configuration flags, version compatibility, or setup instructions.

**How to use Context7:**
1. Resolve the library ID: Use `mcp_context7_resolve-library-id` with `libraryName` and `query` parameters
2. Fetch current docs: Use `mcp_context7_query-docs` with `libraryId` (e.g., `/vercel/next.js`) and `query` parameters
3. Add `[Context7: library@version]` citation marker in output

> **Full documentation:** `.jumpstart/guides/context7-usage.md`

**When required:** Architect Phase 3 (Documentation Freshness Audit — hard gate, ≥80% score), Developer Phase 4 (before writing external API integration code), Analyst Phase 1 (technology evaluation), any agent making technology claims.

## Spec-First Power Inversion

Specs are the source of truth. Code is derived. If there is a mismatch between a spec artifact and the codebase, update the spec first or regenerate the code. Never silently alter code to diverge from specs.

## Workflow

```
[Brownfield only] Pre-Phase (Scout) -> Phase 0 (Challenger) -> Phase 1 (Analyst) -> Phase 2 (PM) -> Phase 3 (Architect) -> Phase 4 (Developer)
```

Party Mode (`/jumpstart.party`) can be invoked at any phase for multi-agent advisory discussions via the Facilitator agent.

Phases are strictly sequential. Each must be completed and approved by the human before the next begins. For brownfield projects (`project.type: brownfield` in config), the Scout agent runs before Phase 0 to analyze the existing codebase.

## Key Directories

- `.jumpstart/agents/` -- Detailed agent personas with step-by-step protocols (includes scout.md for brownfield)
- `.jumpstart/templates/` -- Artifact templates that structure each phase's output (includes codebase-context.md, agents-md.md)
- `.jumpstart/schemas/` -- JSON Schema (draft-07) definitions for artifact validation
- `.jumpstart/config.yaml` -- Framework settings (agent parameters, workflow rules, project type)
- `.jumpstart/roadmap.md` -- Project Roadmap: non-negotiable principles that govern all agents
- `.jumpstart/roadmap.md` -- Engineering articles governing code quality and architecture decisions
- `.jumpstart/invariants.md` -- Environment invariants that must hold true in every deployment
- `.jumpstart/domain-complexity.csv` -- Domain complexity data for adaptive planning rigor
- `.jumpstart/glossary.md` -- Terminology dictionary: canonical term definitions for consistent naming
- `.jumpstart/correction-log.md` -- Self-correction log: rejected proposals and lessons learned
- `.jumpstart/state/` -- Workflow state persistence (state.json, todos.json, adr-index.json, locks/)
- `.jumpstart/archive/` -- Timestamped archives of overwritten artifacts
- `specs/` -- Generated specification artifacts (the source of truth for this project)
- `specs/codebase-context.md` -- Scout output for brownfield projects (existing codebase analysis with C4 diagrams)
- `specs/decisions/` -- Architecture Decision Records
- `specs/insights/` -- Living insight logs (1:1 with each artifact)
- `specs/qa-log.md` -- Q&A decision log: audit trail of every agent question and human response
- `specs/research/` -- Optional research artifacts (competitive analysis, technical spikes)

## Rules

1. Never skip phases. Each artifact must exist and be approved before the next phase starts.
2. When operating as an agent, read and follow the corresponding `.jumpstart/agents/*.md` file.
3. Always populate artifacts using templates from `.jumpstart/templates/`.
4. Read `.jumpstart/config.yaml` at the start of every phase for settings.
5. Present completed artifacts for explicit human approval before proceeding.
6. Agents stay in lane: the Challenger does not suggest solutions, the Developer does not change architecture.
7. Read `.jumpstart/roadmap.md` at activation. Roadmap principles are non-negotiable and supersede agent-specific instructions.
8. When `workflow.qa_log` is `true`, log every question-and-response exchange to `specs/qa-log.md` (append-only, sequential numbering).
9. Read `.jumpstart/roadmap.md` for engineering articles governing code quality and architecture decisions.
14. **Session Resumption Briefing (Item 39+):** When `session_briefing.auto_trigger` is `true` in config and `resume_context` in `.jumpstart/state/state.json` is non-null, phase agents present a briefing before starting their protocol. Use `/jumpstart.resume` for a standalone briefing at any time. Agents must update `resume_context` before yielding control.
10. Use Context7 MCP for ALL external documentation lookups. Never guess API details from training data.
11. **Never Guess (Item 69):** If any requirement, detail, or context is ambiguous, do NOT guess or infer. Tag it with `[NEEDS CLARIFICATION: description]` and ask the human. See `.jumpstart/templates/needs-clarification.md` for format rules.
12. **Cross-Assistant Portability (Item 95):** This framework works across multiple AI assistants (Copilot, Cursor, Claude Code, Windsurf). See `.jumpstart/compat/assistant-mapping.md` for tool-specific configuration mapping.
13. **Subagent Invocation (Subagent Protocol):** Phase agents may invoke advisory agents as subagents using the `agent` tool when project signals indicate specialised review is needed. Subagent findings are incorporated into the parent phase's artifact — they do not bypass phase gates or produce standalone artifacts. All invocations must be logged in the parent's insights file. See the Subagent Protocol in `AGENTS.md` for the full roster of available advisory agents and invocation rules.

## Checking Approval

An artifact is approved when its "Phase Gate Approval" section has all checkboxes checked and "Approved by" is not "Pending".
