# Nav restructure, phase 0: the present, measured

**Date:** 2026-10-08. **Branch:** `feat/nav-restructure`, cut from `main` at `909f76d`.
**Read only.** No code changed in this phase. No SQL was run, read-only or otherwise.

**Merge status of this file is not asserted here.** Check it with
`git merge-base --is-ancestor <sha-of-this-commit> main` (exit 0 means merged).

---

## 0a. Working tree

`git status --porcelain` EXECUTED on `main` before branching: **empty. Clean.**

## 0b. Baseline gates, measured

**Where they ran.** tsc, ESLint and every guard script ran in a throwaway worktree of
`origin/main` (`909f76d`), each as its own unpiped command, output redirected to a log and `$?`
echoed on the next statement. Per the standing worktree rule they were invoked directly, not
through `pnpm`, with the main repo's `node_modules` symlinked in and `.env.local` copied in. The
symlink was removed before the worktree was, and the real `node_modules` was confirmed intact.

**`pnpm build` ran in the main checkout, not the worktree**, because a worktree has no real
install. This is the same tree: `main`, `origin/main` and the new branch were all `909f76d` with a
clean working tree at the moment it ran (EXECUTED: `git rev-parse HEAD origin/main`).

| Gate | Exit | Output tail | Matches the brief's hypothesis? |
| --- | --- | --- | --- |
| `tsc --noEmit` | **0** | (no output) | yes |
| `next build` (`pnpm build`) | **0** | static/dynamic legend printed | yes |
| `eslint .` (`pnpm lint`) | **1** | **182 problems (154 errors, 28 warnings)**, 0 errors and 7 warnings fixable | yes, exactly |
| `check-identity-columns.mjs --guard` | **0** | GUARD PASSED | yes |
| `check-org-id-reads.mjs --guard` | **0** | 14 known-open sites, class did not grow | yes |
| `check-embed-targets.mjs` | **0** | TOTAL 0 in 0 files | yes |
| `audit-policy-snapshot.mjs --guard` | **1** | static snapshot warning | yes, known non-regression |
| `verify-rls.mjs` | **2** | pg_class not exposed | yes, known non-regression |
| `check-identity-columns.mjs` (report mode) | 0 | TOTAL 0 | n/a |
| `check-org-id-reads.mjs` (report mode) | 0 | IMPROVED 0 | n/a |
| `audit-policy-snapshot.mjs` (report mode) | 0 | | n/a |

**The baseline for every later comparison in this run is the table above.** Lint triple:
**182 / 154 / 28.**

## 0c. What has happened since 909f76d

**Nothing.** EXECUTED: `git log --oneline 909f76d..HEAD` prints no lines, and
`git merge-base --is-ancestor 909f76d main` exits 0. `HEAD`, `main` and `origin/main` (after
`git fetch`) are all `909f76d`. **No history was rewritten and no work has landed in the three
weeks the brief worried about.**

That does not make the brief's picture current. The brief was wrong before those three weeks
began, in the ways listed under 0e.

## 0d. docs/roadmap-state.md, read against the brief

The file has two correction banners (2026-09-15) over a body dated 2026-09-14.

**Where it contradicts the brief:**

1. **The nav restructure.** The brief says Greg's 2026-08-21 nav ruling "has never been built".
   The roadmap does not list it as unbuilt anywhere, and the code shows it was built: see 0e.
2. **00 Budgeting.** Roadmap section 4.2 cites `components/agency-layout.tsx:48`, which records
   00 Budgeting as deliberately absent: "NOT AS AN ITEM, NOT AS A STUB, NOT AS 'COMING SOON'".
   `docs/ligament-00-budgeting-spec.md` section 1 and `docs/post-m1-cleanup-report.md` (line 420
   and OPEN-4) record the same thing. **The brief rules the opposite: render it, non-navigable,
   with coming copy.** Reading the post-M1 report, the absence was that session's own call,
   filed as OPEN-4 "owed" and waiting on Greg; it was not a ruling of his. This brief is his
   answer to OPEN-4, so phase 1 builds to the brief and updates the code comment that said
   otherwise.
3. **Clients + Projects.** `docs/post-m1-cleanup-report.md` OPEN-5 says the rename is ruled but
   should not ship until `/agency/clients/[id]` lists that client's projects. The brief rules
   it ships now as a rename only. Same treatment as 2.

**What the brief says that the roadmap does not mention:**

- The Open RFPs tile defect (brief phase 2). It is not in the roadmap; it is in
  `docs/engagements-and-counts-report.md` and in a comment block in the dashboard route itself.
- The `partner-rfp-surface.tsx` name-string grouping (brief phase 3).
- Creative Treatment Analysis moving under 00 Budgeting.
- The vendor HQ grouping (Agency Network moving up beside Summary Dashboard).

**What the roadmap says that the brief does not:** relationship-end Q1, Q3, Q4 still open
(Q2 shipped in `edff222`); migration 100 authored and not applied; twelve milestone event
types with no wording; restoring a removed contact blocked on semantics. None is taken here.

**Migration 100.** EXECUTED: `ls supabase/migrations/` shows `100_milestone_inbox_pin.sql`,
its down file and its preapply test, last touched by `f90972a`. **Whether it is applied cannot
be established from this repository** and no SQL was run. Nothing in the repo records it as
applied. It is not touched by this run.

## 0e. The current nav, item by item

### Lead agency (`components/agency-layout.tsx`, a left sidebar)

**THE BRIEF'S HEADLINE IS ALREADY MOSTLY BUILT.** Commit `29a944f` (2026-08-25, "the agency nav
becomes HQ / Workflow / Resources, and a roster stops being a stage") did it.

| Position | Item | Route | Notes |
| --- | --- | --- | --- |
| Top | New project (button) | dialog | |
| Top | New client profile (button) | dialog | |
| **HQ** | Summary Dashboard | `/agency/dashboard` | |
| HQ | Vendor Pool (no number) | `/agency/pool` | hover dropdown: Vendor Pool, Import Vendors (`/agency/pool?import=email`) |
| **Workflow** | 01 RFP Broadcast | `/agency` | hover dropdown: Creative Treatment Analysis (`/agency/brief`), Lightning RFP Magic Link (`/agency/magic-rfp`) |
| Workflow | 02 Bid Management | `/agency/bids` | |
| Workflow | 03 Onboarding | `/agency/onboarding` | |
| Workflow | 04 Delivery Performance | `/agency/project` | |
| **Resources** | Client Profiles | `/agency/clients` | |
| Resources | Master Documents | `/agency/documents` | |
| Resources | Usage | `/agency/usage` | |
| Resources | FAQ | `/faq` | |

**Remaining against the brief's target:** 00 Budgeting is absent, and "Client Profiles" is not
yet "Clients + Projects". **No badge or count renders on any sidebar nav item.** The
notification bell is outside the nav list.

### Vendor (`components/partner-layout.tsx`, a horizontal top bar)

| Group (divider-separated, no visible labels) | Item | Route |
| --- | --- | --- |
| 1 | Summary Dashboard | `/partner` |
| 2 | Agency Network (no number) | `/partner/network` |
| 2 | 01 Open RFPs | `/partner/rfps` |
| 2 | 02 My Bids | `/partner/bids` |
| 2 | 03 Onboarding | `/partner/onboarding` |
| 2 | 04 Delivery & Projects | `/partner/projects` |
| 3 | Legal & Compliance | `/partner/legal` |
| 3 | Payments | `/partner/payments` |
| 3 | FAQ | `/faq` |

**THE VENDOR SPLIT (brief 1a) IS ALREADY BUILT.** Commit `5958742` (2026-08-21) split "Open RFPs
& Bids" into 01 Open RFPs and 02 My Bids, both routes live. **Remaining:** Agency Network still
sits in the workflow group; `29a944f` deliberately left the vendor HQ grouping owed. The
mobile row renders the same items flat.

### /agency root (brief 1b)

`app/agency/page.tsx` **is** the RFP Broadcast builder (brief upload, scoping, send). It is not
a redirect. 20 references across `app/`, `components/`, `lib/` and `middleware.ts` point at the
bare `/agency`, including the MFA redirect, the admin redirect, the new-project dialog,
`lib/notification-routing.ts` and the landing page's portal link. Phase 1 decides on this.
