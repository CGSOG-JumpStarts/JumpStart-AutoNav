---
id: session-briefing
phase: any
agent: System
status: Generated
created: "[DATE]"
updated: "[DATE]"
version: "1.0.0"
approved_by: null
approval_date: null
upstream_refs: []
dependencies: []
risk_level: low
owners: []
sha256: null
---

# Session Resumption Briefing

> **Generated:** [DATE]
> **Command:** `/jumpstart.resume` | Auto-triggered on agent activation

---

## TLDR

[1–3 sentence summary of overall project progress and current status. Synthesised from `resume_context.tldr` in state.json and the most recent phase artifact.]

---

## Where You Left Off

| Field | Value |
|-------|-------|
| **Last Phase** | [Phase N: Name] |
| **Last Agent** | [Agent Name] |
| **Last Step** | [Protocol step description] |
| **Last Action** | [Description of the last completed action] |
| **Timestamp** | [ISO timestamp of last activity] |

### Completed Phases

| Phase | Agent | Artifact | Completed At |
|-------|-------|----------|--------------|
| [from phase_history in state.json] |

---

## What's Next

| Field | Value |
|-------|-------|
| **Next Action** | [Recommended next step — derived from PHASE_MAP / resume_context.next_action] |
| **Next Agent** | [Agent name to activate] |
| **Command** | [Slash command to run, e.g., `/jumpstart.analyze`] |
| **Context Files** | [Files the next agent will need to read] |

### Pending Protocol Steps

[If work was interrupted mid-phase, list the remaining protocol steps from todos.json]

| Step | Status |
|------|--------|
| [from todos.json active todos] |

---

## Key Insights

[Most recent insights from specs/insights/*.md — capped at `session_briefing.max_insights` from config. Prioritise: Open Questions > Trade-Offs > Decisions > Discoveries.]

| # | Type | Summary | Source |
|---|------|---------|--------|
| 1 | [Decision / Open Question / Trade-Off / Discovery] | [Brief summary] | [Source file] |
| 2 | ... | ... | ... |

---

## Open Questions & Clarifications

### Unresolved [NEEDS CLARIFICATION] Tags

| # | Location | Question |
|---|----------|----------|
| [Scan all specs/*.md for [NEEDS CLARIFICATION: ...] tags] |

### Unanswered QA Log Entries

| # | Question | Phase | Status |
|---|----------|-------|--------|
| [from specs/qa-log.md — entries without a recorded response] |

---

## Get Started

[Actionable recommendation for the human. Examples:]

- **If resuming mid-phase:** "You were in the middle of Phase [N]. Activate the **[Agent Name]** agent to continue from step [X]."
- **If between phases:** "Phase [N] is approved. Run `/jumpstart.[command]` to begin Phase [N+1]."
- **If fresh project:** "No prior work detected. Run `/jumpstart.challenge [your idea]` to begin."
- **If all phases complete:** "All phases are complete. The project is fully specified and implemented."

---

*This briefing is generated from `.jumpstart/state/state.json`, `specs/insights/`, and spec artifacts. Run `/jumpstart.status` for a full project dashboard.*
