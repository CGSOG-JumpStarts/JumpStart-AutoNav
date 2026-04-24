---
id: "adr-010"
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

# ADR-010: Marketplace Installer — ZIP-Slip Prevention

> **Status:** Accepted · **Date:** 2026-04-24 · **Decision Maker:** The Architect

---

## Context

`bin/lib/install.js` downloads skill/agent/prompt/bundle ZIPs from the JumpStart Skills Registry, verifies SHA-256 integrity, and extracts the archive into the user's project directory. v1.1.14 performs SHA-256 verification but does NOT validate archive entry paths before extraction.

**ZIP-slip attack**: a crafted ZIP with entries like `../../../../.ssh/authorized_keys` or absolute paths like `/etc/passwd` would, upon extraction, write files outside the intended target directory — overwriting arbitrary files the user can write to. SHA-256 verification does not prevent this: the attacker controls the ZIP *and* its hash; the hash matches; the archive is trusted; the extraction escapes.

Pit Crew QA Security Audit SEC-002: **HIGH severity**. Architecture's original STRIDE table said "SHA-256 verification on every downloaded ZIP" — true but insufficient.

---

## Decision

**`src/lib/install.ts` extraction path MUST canonicalize every archive entry's destination path and reject any entry that escapes the target directory.**

Implementation:

```typescript
import * as path from "node:path";
import { ValidationError } from "../errors.js";

function assertEntryInsideTarget(entryName: string, targetDir: string): string {
  const resolvedTarget = path.resolve(targetDir) + path.sep;
  const resolvedEntry = path.resolve(targetDir, entryName);

  if (!resolvedEntry.startsWith(resolvedTarget) && resolvedEntry !== path.resolve(targetDir)) {
    throw new ValidationError({
      schemaId: "marketplace-zip-extract",
      issues: [{
        code: "zipslip_attempt",
        message: `Archive entry "${entryName}" resolves outside target directory "${targetDir}". Extraction aborted.`,
      }],
    });
  }

  return resolvedEntry;
}

// Called for every entry before extraction:
for (const entry of zipEntries) {
  const safePath = assertEntryInsideTarget(entry.fileName, targetDir);
  // ...extract to safePath...
}
```

**Rejection is atomic**: if any entry fails the canonicalization check, the entire extraction is aborted (NOT partial extraction followed by cleanup). Partial extraction creates worse-than-no-install failure modes.

**Additional checks beyond zipslip**:
- **Symlink entries**: reject any ZIP entry with type `symbolic link` unless the symlink target also canonicalizes inside the target dir.
- **Absolute paths**: reject any entry whose `fileName` starts with `/` (POSIX) or has a drive letter (Windows).
- **Null bytes**: reject any entry whose `fileName` contains `\x00`.

**Fixture matrix** (Turn 2):
- `tests/fixtures/security/zipslip/` with crafted test ZIPs:
  - `traversal.zip` — entry `../../../etc/passwd`
  - `absolute.zip` — entry `/etc/passwd`
  - `symlink-outside.zip` — symlink entry pointing to `/etc/passwd`
  - `null-byte.zip` — entry with `\x00` in name
  - `legitimate.zip` — control; normal archive with relative entries
- Test asserts that the 4 malicious ZIPs trigger `ValidationError` + exit 2; the legitimate ZIP extracts successfully.

---

## Consequences

### Positive
- Closes a HIGH-severity attack path. The marketplace installer becomes a hardened boundary.
- Defense co-located with the extraction code — no separate "security check" to remember.
- Test fixtures mechanically regression-test the behavior on every PR.

### Negative
- Additional per-entry canonicalization check: O(N) on ZIP entry count. Negligible performance impact for typical skill archives (<1000 files).
- Symlink-entry rejection may inconvenience a legitimate use case if an upstream skill ships symlinks intentionally (rare in practice; documented as a known limitation).
- Atomic abort-on-first-bad-entry means a partially-crafted malicious ZIP gives zero extraction — good security posture but no forensic artifact from the extraction attempt.

### Neutral
- SHA-256 verification (existing) remains in place; this ADR is additive, not a replacement.
- Marketplace registry itself is not addressed here — registry-level spoofing (serving a malicious ZIP + matching hash) is a separate vector tracked in ADR-008 (continuous-window CVE monitoring).

---

## Alternatives Considered

### Use an existing ZIP library with built-in zipslip protection
- **Description:** Adopt `adm-zip` or `yauzl` with `validateFilePaths: true`.
- **Pros:** Library does the work.
- **Cons:** Ecosystem ZIP libraries have historically had their own zipslip CVEs; vetting each library's implementation is comparable effort to authoring the ~20-line assertion above.
- **Reason Rejected:** Hand-rolled canonicalization is short, auditable, and has no library-CVE exposure.

### Extract to a temporary dir, then move validated files
- **Description:** Extract to `/tmp/<random>`; validate every extracted file's resolved path is inside the intended target; move good files, delete the temp dir.
- **Pros:** Decouples extraction from validation.
- **Cons:** Extraction itself has escaped `/tmp/<random>` by the time we validate — attack already completed. Temp dirs do not stop symlink-follow attacks.
- **Reason Rejected:** Doesn't actually mitigate; validation MUST happen before extraction.

### Block the marketplace installer entirely (require manual downloads)
- **Description:** Remove `install.ts` from the framework; users manually download + verify skills.
- **Pros:** Eliminates the attack surface entirely.
- **Cons:** Defeats the marketplace value proposition.
- **Reason Rejected:** Throws out the feature to avoid the bug.

---

## References

- [specs/architecture.md ADR-010 + §Security SEC-002](../architecture.md#specific-high-severity-mitigations-per-pit-crew-qa-security-audit-integrated-turn-1)
- Pit Crew QA Security Audit Part 2 Finding 3 (HIGH severity)
- [specs/implementation-plan.md T4.5.1, T4.5.5](../implementation-plan.md#milestone-7-m6--marketplace--installer-stage-45)
- [Snyk zipslip vulnerability database](https://security.snyk.io/research/zip-slip-vulnerability)
