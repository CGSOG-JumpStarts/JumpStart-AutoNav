# Synthetic contract-drift fixture: simulation-tracer-vs-holodeck

This fixture replicates the **pre-fix v1.1.13** state of `bin/lib/simulation-tracer.js` versus `bin/holodeck.js`: a class declares **4 methods**, the caller invokes **12 methods** on instances of that class, so **8 of those calls have no corresponding declaration**.

This is exactly the bug v1.1.14 fixed (commit `92daf04`) and the harness in `scripts/extract-public-surface.mjs` was designed to catch.

## Layout

```
simulation-tracer-vs-holodeck/
├── README.md          ← this file
├── tracer.js          ← declares 4 methods (the "before" state)
└── holodeck.js        ← invokes 12 methods on a tracer instance
```

## Expected harness behavior

```bash
node scripts/extract-public-surface.mjs --root=tests/fixtures/contract-drift/simulation-tracer-vs-holodeck \
  --out=/tmp/drift.json
```

Reports **exactly 8** `missing_method` incidents — one per `tracer.<missingMethod>(...)` call site in `holodeck.js` whose method is not declared on `Tracer`.

The acceptance test in `tests/test-public-surface.test.ts` runs this fixture and asserts the count.

## Why a committed fixture, not a git checkout

Per `specs/implementation-plan.md` T3.2: "committed file-pair, NOT a git-ref checkout." Reasons:

1. `git checkout v1.1.13` then running the harness would couple the fixture's truth to the v1.1.13 tag, which would prevent us ever cleaning the tag.
2. A committed fixture lets new developers reproduce the case offline.
3. It's what the rest of the test suite does (see `tests/fixtures/valid/`, `tests/fixtures/invalid/`).

## See also

- `specs/implementation-plan.md` T3.1, T3.2, T3.3, Checkpoint C3
- `CHANGELOG.md` v1.1.14 — Critical: simulation-tracer missing 8 of 12 methods
- `bin/lib/simulation-tracer.js` (post-fix, current state — fixture is intentionally NOT current)
