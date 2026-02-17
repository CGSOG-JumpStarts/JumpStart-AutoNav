# Jump Start Framework Instructions

This repository uses the Jump Start spec-driven agentic coding framework.

## Context7 MCP Mandate (HIGH PRIORITY)

**CRITICAL RULE:** When referencing any external library, framework, CLI tool, or service — you MUST use Context7 MCP to fetch live, verified documentation. Never rely on training data for:
- API signatures, method parameters, or return types
- Configuration flags, options, or environment variables
- Version compatibility, breaking changes, or migration guides
- Setup instructions, installation steps, or prerequisites
- Feature availability or deprecation status

**How to use Context7:**
1. Resolve the library ID: Use `mcp_context7_resolve-library-id` with `libraryName` and `query` parameters
2. Fetch current docs: Use `mcp_context7_query-docs` with `libraryId` (e.g., `/vercel/next.js`) and `query` parameters
3. Cite your source: Add `[Context7: library@version]` marker in your output

> **Full documentation:** `.jumpstart/guides/context7-usage.md`

**When is this required?**
- Architect Phase 3: Documentation Freshness Audit before approval
- Developer Phase 4: Before writing any external API integration code
- Analyst Phase 1: When evaluating competitive technologies
- Any agent: When making claims about what a technology can or cannot do

## Spec-First Power Inversion (Item 4)

Specs are the source of truth. Code is derived. If there is a mismatch between a spec artifact and the codebase, update the spec first or regenerate the code. Never silently alter code to diverge from specs.

## Slash Command Routing

| Command | Action |
|---------|--------|
| `/jumpstart.scout` | Check `project.type` is `brownfield`. Load `.jumpstart/agents/scout.md`. Follow Reconnaissance Protocol. Output to `specs/codebase-context.md`. |
| `/jumpstart.challenge [idea]` | Load `.jumpstart/agents/challenger.md`. Follow the Elicitation Protocol. Output to `specs/challenger-brief.md`. |
| `/jumpstart.analyze` | Verify Phase 0 approved. Load `.jumpstart/agents/analyst.md`. Output to `specs/product-brief.md`. |
| `/jumpstart.plan` | Verify Phases 0-1 approved. Load `.jumpstart/agents/pm.md`. Output to `specs/prd.md`. |
| `/jumpstart.architect` | Verify Phases 0-2 approved. Load `.jumpstart/agents/architect.md`. Output to `specs/architecture.md`, `specs/implementation-plan.md`, `specs/decisions/*.md`. |
| `/jumpstart.build` | Verify Phases 0-3 approved. Load `.jumpstart/agents/developer.md`. Output code to `src/`, tests to `tests/`. |
| `/jumpstart.party` | Load `.jumpstart/agents/facilitator.md`. Launch multi-agent roundtable discussion. Advisory only — no artifact writes. |
| `/jumpstart.resume` | Read `.jumpstart/state/state.json` + insights. Present session resumption briefing (TLDR, where you left off, what's next, key insights, open questions). No artifact writes. |
| `/jumpstart.status` | Read config and all spec files. Report phase completion status. |
| `/jumpstart.review` | Validate current artifacts against templates. Report gaps. |

## Rules

1. Phases are sequential. Check for Phase Gate Approval (all checkboxes checked, "Approved by" not "Pending").
2. Follow agent personas exactly. Each agent file has a complete step-by-step protocol.
3. Always ask for explicit human approval before phase transitions.
4. Use templates from `.jumpstart/templates/`.
5. Read `.jumpstart/config.yaml` at the start of every command.
6. Read `.jumpstart/roadmap.md` at activation. Roadmap principles are non-negotiable and supersede agent-specific instructions.
7. Read `.jumpstart/roadmap.md` for engineering articles governing code quality and architecture decisions.
8. Use Context7 MCP for ALL external documentation lookups. Never guess API details from training data.
