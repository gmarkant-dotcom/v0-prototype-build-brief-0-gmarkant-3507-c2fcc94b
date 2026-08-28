# M4 - Phase 0 baseline

Recorded before any file in this session was edited, at
`113a829 fix: the vendor active tile counts live projects and says so`,
on branch `feat/m4-colleague-filter`, working tree clean.

Every number below was **EXECUTED** in this session, not read from a document.
Phase 4 re-runs the same six commands and compares against this file and nothing else.

---

## The six gates, as measured

| # | Command | Exit | Measured |
|---|---------|------|----------|
| 1 | `npx tsc --noEmit` | **0** | zero diagnostic lines |
| 2 | `pnpm build` | **0** | compiled in 11.1s, 72/72 static pages, 173 route tree lines |
| 3 | `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)** across 164 files |
| 4 | `pnpm identity-columns:guard` | **0** | 391 files scanned, TOTAL 0 in 0 files, GUARD PASSED |
| 5 | `pnpm org-id-reads:guard` | **0** | OPEN 14 (class A) / 60 (class B), REGRESSIONS 0, IMPROVED 0, GUARD PASSED |
| 6 | `pnpm embed-targets --guard` | **0** | 391 files scanned, REPOINTED 0, PERSON 0, TOTAL 0 |

`pnpm lint` exits 1 at baseline. That is the pre-existing state of this branch, not
anything this session introduced. The number to hold is **182 / 154 / 28**.

Gate 5 is clean in both directions: no `REGRESSIONS` and no `IMPROVED` line waiting to
be cleared. Any movement at Phase 4 is this session's doing.

**Movement against the 097 baseline (branch `feat/m3-project-leads`):** gates 1, 3, 5 are
identical. Gate 2's build time moved 10.9s to 11.1s (wall clock, not a signal) and the
route tree is 173 lines against 174 - M3 shipped no new route, and the earlier count
included one line this grep does not. Gates 4 and 6 scanned 391 files against 387: four
files were added to the tree by M3. Neither guard found anything in them.

**Not run, deliberately:** `pnpm verify-rls` and `pnpm policy-audit:guard`. Neither reads
a `.ts` file, so neither can move on anything this session touches, and both want database
access this session is prohibited from seeking.
