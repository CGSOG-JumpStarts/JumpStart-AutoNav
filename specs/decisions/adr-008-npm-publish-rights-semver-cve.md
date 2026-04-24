---
id: "adr-008"
phase: 3
agent: Architect
status: Accepted
created: "2026-04-24"
updated: "2026-04-24"
version: "1.0.0"
approved_by: "Samuel Combey"
approval_date: "2026-04-24"
upstream_refs:
  - specs/architecture.md
dependencies:
  - architecture
risk_level: high
owners:
  - Samuel Combey
sha256: null
---

# ADR-008: npm Publish Rights + Semver Discipline + CVE-to-Patch SLA

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

Three decisions that are individually too small for their own ADR but collectively shape the release/distribution posture:

1. **npm publish rights (KU-03)**: `package.json` author field is `Jo Otey <jootey@outlook.com>`. Samuel Combey's `npm whoami` status against the `jumpstart-mode` package is unconfirmed. Resolution required before Phase 8 (2.0 cutover).
2. **Semver discipline within 1.x (KU-Q-01)**: does each ported module ship as its own patch (1.1.14 → 1.1.15 → …) or does each milestone-batch ship as a minor (1.2.0 → 1.3.0 → …)?
3. **CVE-discovery-to-patch SLA (SEC-003)**: Pit Crew QA flagged that `npm audit` PR-time gate + weekly cron leaves a continuous-window gap where a new high-severity CVE in a transitive dep is live for up to a week.

---

## Decision

**npm publish rights**: implementation-plan T6.2 runs `npm owner ls jumpstart-mode` during M11 (can run day 1, parallel with M0). Three resolution paths documented:

- **(a)** Samuel is listed as an owner → no action; 2.0 ships normally.
- **(b)** Samuel is not an owner but Jo Otey is reachable → coordinate ownership transfer or co-ownership addition before Phase 8.
- **(c)** Jo Otey unreachable AND Samuel not an owner → fallback to publishing under `@scombey/jumpstart-mode` scope. Document as breaking change in upgrade guide (NFR-D01 CHANGELOG + T6.4 upgrade doc).

**Decision gate**: T6.2 resolves before T5.4 (`npm publish --tag next`) begins.

**Semver discipline**: **Minor-per-milestone-batch**. Each milestone (M2 through M8) ships as its own 1.x.0 minor (1.2.0 for M2, 1.3.0 for M3, etc.). Patches within a milestone reserved for hotfixes only. Rationale:

- Users see 7 minor releases during strangler (1.2 → 1.8), each with a clear "what was ported" changelog entry.
- Each minor has a git tag; bisecting regressions is module-cluster-resolution, not per-module-file-resolution.
- Patch releases remain available for legitimate bug-fixes that don't fit a milestone narrative (e.g., a critical CVE bump).

**CVE-to-patch SLA**:
- **Target: ≤ 48 hours** from npm audit high-severity advisory publish to patched `jumpstart-mode` release on npm.
- **Mechanism**: Dependabot configured with `"security-updates"` enabled (separate from version-updates); CI `audit.yml` auto-merges Dependabot security PRs on green test suite. For Direct dependency high-severity advisories not auto-resolvable by a transitive bump, Samuel receives GitHub security advisory notification and resolves manually.
- **Rollback path**: `npm deprecate jumpstart-mode@<vulnerable-version> "security: upgrade to <patched-version>"` + dist-tag flip if the vulnerable version is on `latest`.
- **Outside-SLA escalation paths with triage criteria** (per Pit Crew Adversary finding — undifferentiated paths defeated the SLA's value):
  - **(a) Remove the affected feature temporarily**: chosen when the vulnerable code path is an isolated feature (e.g., a marketplace install command) AND the feature is not on a Must-Have-MVP critical path AND removal is < 1 day of work AND removal preserves the dual-mode IPC contract for non-affected modules. Time-bound: feature stays removed for ≤ 14 days while upstream/fork resolves; if > 14 days, escalate to (b) or (c).
  - **(b) Document and accept the window**: chosen ONLY when (a) and (c) are infeasible AND the vulnerability requires a non-trivial attacker-controlled prerequisite (e.g., a poisoned env var that an attacker would already need to set). Mandatory: `docs/known-vulnerabilities.md` entry with CVE-ID, exposure scope, prerequisites, expected resolution date, and an alert to all GitHub watchers via security advisory. Time-bound: max 30 days at (b) before forced escalation to (c) or feature removal.
  - **(c) Fork-and-patch the dependency**: chosen when (a) is infeasible (no isolated removable feature) AND upstream has acknowledged but not yet patched the issue AND fork-and-patch effort is < 3 days. Result: temporary scoped fork (`@scombey/<dep-name>-patched`) used until upstream releases. Tracked in `docs/known-vulnerabilities.md` with retire-fork criterion.
  - **Decision tree at outside-SLA escalation moment**: feature isolated-and-removable in <1 day → (a); else, attacker prerequisite exists + (a) infeasible → (b) up to 30 days; else (c) fork-and-patch.
  - **Single accountable owner**: Samuel Combey makes the (a)/(b)/(c) call; AI-agent assistance permitted for analysis but not for the decision itself.

---

## Consequences

### Positive
- npm publish rights path forecloses the surprise at Phase 8 — the decision is made well before ship time.
- Minor-per-batch semver gives downstream consumers clear release cadence markers.
- Dependabot auto-merge closes the continuous-window CVE gap for transitive issues.
- 48-hour SLA is aspirational but documented — sets expectations for solo-maintainer response time.

### Negative
- Minor-per-batch means more npm releases (7 in 9–12 months vs potentially fewer with patch-per-module). Minor release overhead: changelog entry, tag, publish command, dist-tag check.
- Auto-merge of Dependabot PRs requires CI to be fully trustworthy — a failing test on a security update PR blocks merge and requires manual intervention anyway.
- Fallback scope (`@scombey/jumpstart-mode`) is a breaking change for consumers of `jumpstart-mode`; documented but still a rollout burden if used.

### Neutral
- CHANGELOG.md maintenance (NFR-D01) naturally aligns with minor-per-batch cadence: each release gets a section.

---

## Alternatives Considered

### Patch-per-module semver
- **Description:** 1.1.14 → 1.1.15 → 1.1.16 → … one patch release per ported module.
- **Pros:** Finer-grained changelog; easier bisection.
- **Cons:** 159+ patch releases over 9–12 months is release-management overhead; consumers cannot tell "this release adds the LLM cluster" from "this release adds one more leaf util."
- **Reason Rejected:** Minor-per-batch has better narrative value for consumers.

### Major-per-batch (flip to 2.x during strangler)
- **Description:** Each port ships as a major (2.0, 3.0, 4.0, …).
- **Pros:** Strong signal per release.
- **Cons:** Violates semver — strangler ports are supposed to be zero-behavior-change, which is a patch-level event.
- **Reason Rejected:** Semver misuse.

### Weekly Dependabot cron (no auto-merge)
- **Description:** Dependabot opens PRs weekly; Samuel reviews + merges manually.
- **Pros:** Human oversight on every dep bump.
- **Cons:** Solo-maintainer review latency = continuous-window gap remains wide; defeats the 48-hour SLA.
- **Reason Rejected:** Auto-merge on green CI IS the mitigation; manual review is the fallback when CI fails.

### 24-hour SLA
- **Description:** Aggressive SLA for faster CVE response.
- **Pros:** Shorter window.
- **Cons:** Solo-maintainer + AI agents; 24 hours is unrealistic for weekends or multi-dep coordinated patches.
- **Reason Rejected:** Over-promise; 48 hours is the honest floor.

---

## References

- [specs/architecture.md ADR-008 + §Security Architecture SEC-003](../architecture.md#architecture-decision-records)
- [specs/challenger-brief.md KU-03, KU-Q-01](../challenger-brief.md)
- Pit Crew QA Finding on continuous-window CVE gap
- [specs/implementation-plan.md T6.2, T6.3](../implementation-plan.md#milestone-12-m11--housekeeping-parallel-with-m0m10)
