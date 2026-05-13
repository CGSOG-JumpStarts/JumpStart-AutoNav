---
name: requirements
description: Structured techniques for eliciting, analyzing, and documenting software requirements from stakeholders, reducing ambiguity and missed scope.
---

# Requirements Elicitation & Analysis

This skill provides structured workflows for gathering, analyzing, and documenting software requirements. Use it when scoping a project, conducting stakeholder interviews, or validating completeness of a PRD.

## Elicitation Techniques

### Stakeholder Interview Script

Use this 5-step structure for requirement-gathering sessions:

1. **Context Setting** (2 min): "We're exploring [domain]. I'll ask questions to understand your needs. There are no wrong answers."
2. **Current State** (10 min): "Walk me through how you do [task] today, step by step."
3. **Pain Points** (10 min): "What frustrates you most? Where do you lose time? What workarounds have you built?"
4. **Ideal State** (10 min): "If you had a magic wand, what would change? What does success look like?"
5. **Constraints** (5 min): "What must not change? What are the hard limits (budget, timeline, compliance)?"

Record: Raw notes → distill into user stories within 24h.

### Requirement Categories Checklist

For every feature, verify coverage across:

| Category | Key Questions |
|----------|--------------|
| Functional | What does the system DO? |
| Data | What does it STORE and RETRIEVE? |
| Interface | How do users/systems INTERACT with it? |
| Performance | How FAST must it respond? At what SCALE? |
| Security | Who can ACCESS what? What's SENSITIVE? |
| Compliance | What REGULATIONS apply? |
| Operational | How is it DEPLOYED, MONITORED, BACKED UP? |
| Usability | Who uses it? What's their SKILL LEVEL? |

## Analysis Techniques

### Ambiguity Detection

Flag requirements containing these words — they need clarification:

- **"should"** → Is it required or optional?
- **"etc."** → What exactly is included?
- **"appropriate"** → What criteria define appropriateness?
- **"user-friendly"** → What specific UX standards?
- **"fast"** → What latency threshold (P50, P95, P99)?
- **"scalable"** → What load targets (users, requests/sec, data volume)?
- **"secure"** → What threat model? What compliance standard?

### MoSCoW Prioritization

For each requirement, assign:

| Priority | Meaning | Rule |
|----------|---------|------|
| **Must** | Non-negotiable for launch | Blocks release if missing |
| **Should** | Important but workaround exists | Include if time permits |
| **Could** | Desirable enhancement | Only after all Shoulds done |
| **Won't** | Explicitly out of scope (this release) | Documented to prevent scope creep |

### User Story Quality Gate (INVEST)

Every user story must pass:

- **I**ndependent — Can be built and delivered alone
- **N**egotiable — Details can flex during implementation
- **V**aluable — Delivers user or business value
- **E**stimable — Team can estimate effort
- **S**mall — Completable in one sprint/iteration
- **T**estable — Has clear acceptance criteria

## Documentation Template

### Requirement Entry Format

```
**REQ-[ID]:** [One-sentence description]
- **Priority:** Must / Should / Could / Won't
- **Source:** [Stakeholder name/role, date]
- **Acceptance Criteria:**
  - Given [context], when [action], then [outcome]
  - Given [context], when [action], then [outcome]
- **Dependencies:** [REQ-IDs or "None"]
- **Open Questions:** [Any unresolved ambiguities]
```

### Traceability Matrix

Maintain a requirements → specs → code traceability:

| REQ ID | Description | Spec Section | Implementation | Test Case | Status |
|--------|-------------|--------------|----------------|-----------|--------|
| REQ-001 | User login | PRD §3.1 | `src/auth/` | `test/auth.test.js` | Done |
