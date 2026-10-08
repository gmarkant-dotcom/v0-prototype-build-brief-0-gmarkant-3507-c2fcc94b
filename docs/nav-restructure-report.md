# Nav restructure run report

**Date:** 2026-10-08. **Branch:** `feat/nav-restructure`, cut from `main` at `909f76d`.
**Not pushed.** This report does not state its own merge status. To check it, run
`git merge-base --is-ancestor ca9eaff main` (exit 0 means the last code commit of this run is on
`main`), and the same for each SHA in the table in section 2.

**Nothing in this run was opened in a browser.** Every claim below about what a screen shows
traces to a component that was read. Gates and `git` commands were EXECUTED; everything else
was READ. **No SQL was run**, read-only or otherwise. No migration was authored, edited or
applied. No access predicate was widened, no service role added, no session or role check
touched.

---

## 1. The brief was wrong, and how

**The headline of the brief was already built.** The brief said Greg's 2026-08-21 nav ruling
"has never been built". It mostly had been, six weeks earlier:

- `29a944f` (2026-08-25): agency sidebar became HQ / Workflow / Resources, Vendor Pool moved
  into HQ and lost its number, Bid Requests became Workflow numbered 01 to 04.
- `5958742` (2026-08-21): the vendor's "Open RFPs & Bids" was split into 01 Open RFPs and 02 My
  Bids. Brief 1a was already done, and both routes are live.

**What was left, and was built here:** 00 Budgeting, the Clients + Projects rename, and the
vendor HQ grouping (Agency Network beside Summary Dashboard).

**The two agency pieces had been left out on purpose, by a session, not by Greg.**
`docs/post-m1-cleanup-report.md` OPEN-4 and OPEN-5 recorded them as owed, with that session's
reasoning that a nav item naming an absent feature is dishonest, and `components/agency-layout.tsx`
carried a comment saying 00 Budgeting is "NOT AS 'COMING SOON'". `docs/roadmap-state.md` 4.2 and
`docs/ligament-00-budgeting-spec.md` section 1 both cite that comment. **This brief is Greg's
answer to OPEN-4 and OPEN-5, so this run built to the brief and rewrote the comment.** Those two
documents still cite the old comment and are now out of date on that point; they were not
edited, because both are dated records.

**The three-week gap did not exist.** `git log 909f76d..HEAD` was empty and `HEAD`, `main` and
`origin/main` were all `909f76d`. Nothing landed. The brief's phase 2 hypothesis therefore held
exactly as written.

---

## 2. Commits, and what to revert

Every commit merges alone. None depends on another.

| Commit | Phase | Files | Revert if |
| --- | --- | --- | --- |
| `7bdf4b5` | 0 | `docs/nav-phase0-baseline.md` | never needed; docs only |
| `6a1e8b9` | 1 | `components/agency-layout.tsx`, `components/partner-layout.tsx` | **any agency or vendor page fails to render.** Shared layouts: one mistake breaks every page. Revert, do not debug |
| `c7726c3` | 2 | `app/api/agency/dashboard/route.ts` | the dashboard 500s, or Open RFPs reads lower than an RFP you know is open |
| `ca9eaff` | 3 | `components/partner-rfp-surface.tsx` | the vendor's Open RFPs page shows a wrong grouping by agency |

Plus this report as the final commit.

---

## 3. Phase 0: the present

Full record in `docs/nav-phase0-baseline.md`. Summary:

| Gate | Baseline (phase 0) | Final (phase 4) |
| --- | --- | --- |
| `tsc --noEmit` | 0 | **0** |
| `pnpm build` | 0 | **0** |
| `eslint .` | 1, **182 problems (154 errors, 28 warnings)** | 1, **182 problems (154 errors, 28 warnings)** |
| `identity-columns:guard` | 0 | **0** |
| `org-id-reads:guard` | 0 | **0** |
| `embed-targets` | 0, TOTAL 0 | **0, TOTAL 0** |
| `policy-audit:guard` | 1 (known) | **1** |
| `verify-rls` | 2 (known) | **2** |
| markdown link corruption grep | n/a | no matches |

Baseline ran in a throwaway worktree of `origin/main` with tools invoked directly, not through
`pnpm`; `pnpm build` ran in the main checkout on the identical tree. Final gates ran on the
branch. Each gate ran as its own unpiped command with `$?` echoed next. After each of the four
commits, `tsc` and the three code guards were re-run and none moved.

---

## 4. Phase 1: the nav

### 4a. Lead agency sidebar, before and after

Before is `main` at `909f76d`. After is this branch.

| Section | Before | Route | After | Route |
| --- | --- | --- | --- | --- |
| Top | New project (button) | dialog | New project (button) | dialog |
| Top | New client profile (button) | dialog | New client profile (button) | dialog |
| HQ | Summary Dashboard | `/agency/dashboard` | Summary Dashboard | `/agency/dashboard` |
| HQ | Vendor Pool | `/agency/pool` | Vendor Pool | `/agency/pool` |
| Workflow | | | **00 Budgeting, "Coming soon"** | **none, not a link** |
| Workflow | 01 RFP Broadcast | `/agency` | 01 RFP Broadcast | `/agency` |
| Workflow | 02 Bid Management | `/agency/bids` | 02 Bid Management | `/agency/bids` |
| Workflow | 03 Onboarding | `/agency/onboarding` | 03 Onboarding | `/agency/onboarding` |
| Workflow | 04 Delivery Performance | `/agency/project` | 04 Delivery Performance | `/agency/project` |
| Resources | **Client Profiles** | `/agency/clients` | **Clients + Projects** | `/agency/clients` |
| Resources | Master Documents | `/agency/documents` | Master Documents | `/agency/documents` |
| Resources | Usage | `/agency/usage` | Usage | `/agency/usage` |
| Resources | FAQ | `/faq` | FAQ | `/faq` |

Sub-links, unchanged: RFP Broadcast's dropdown (Creative Treatment Analysis `/agency/brief`,
Lightning RFP Magic Link `/agency/magic-rfp`); Vendor Pool's dropdown (Vendor Pool, Import
Vendors `/agency/pool?import=email`).

### 4b. Vendor top bar, before and after

The vendor nav is a horizontal bar. Sections are shown by vertical dividers, not visible labels.

| Section | Before | After | Route |
| --- | --- | --- | --- |
| HQ | Summary Dashboard | Summary Dashboard | `/partner` |
| **Workflow** (before) / **HQ** (after) | Agency Network | **Agency Network, moved into HQ** | `/partner/network` |
| Workflow | 01 Open RFPs | 01 Open RFPs | `/partner/rfps` |
| Workflow | 02 My Bids | 02 My Bids | `/partner/bids` |
| Workflow | 03 Onboarding | 03 Onboarding | `/partner/onboarding` |
| Workflow | 04 Delivery & Projects | 04 Delivery & Projects | `/partner/projects` |
| Resources | Legal & Compliance | Legal & Compliance | `/partner/legal` |
| Resources | Payments | Payments | `/partner/payments` |
| Resources | FAQ | FAQ | `/faq` |

**What a sighted user sees change:** on desktop, the first divider moves from after Summary
Dashboard to after Agency Network. **The mobile row is unchanged**: it is flat, and Agency Network
was already second. Each section is now a `role="group"` with `aria-label` HQ, Workflow or
Resources, so a screen reader announces the sections the eye infers from the dividers.

### 4c. 1b, the /agency root

`/agency` resolves to `app/agency/page.tsx`, **which is the RFP Broadcast builder itself**, not a
redirect. Under the new shape it should still resolve to RFP Broadcast. **It was not repointed.**
Moving it would mean a new path for RFP Broadcast and a decision on what `/agency` becomes, and
20 references point at the bare `/agency`: the MFA and admin redirects, the new-project dialog
(twice), `app/agency/ai/page.tsx`'s redirect, the brief page's handoff with
`?interpretation_id=`, `lib/notification-routing.ts`, the landing page and the vendor header's
portal switch. That is the blast radius, and nothing in the ruling requires paying it.

### 4d. 1c, 00 Budgeting: the exact copy

- Number: **00**. Title: **Budgeting**. Visible caption under the title: **Coming soon**.
- Hover tooltip: **Build the client budget before any vendor is briefed. Not available yet.**

It is a `div`, not an anchor: no `href`, no `tabIndex`, never focusable, never a click target,
never active. Its text is dimmed below the other items. The caption is visible text rather than
tooltip-only, because a non-focusable element's tooltip cannot be reached from the keyboard. **No
route, page, stub or feature was created.**

### 4e. 1d, Creative Treatment Analysis

**Not moved.** It stays in the RFP Broadcast dropdown. Moving it under a non-navigable 00 would
orphan a live feature. **The move is owed** for when 00 gets a destination; the code comment says
so.

### 4f. 1e, Clients + Projects: what the destination needs

**Nav label only.** The destination is unchanged and does not yet match the name:
`app/agency/clients/[id]/page.tsx` contains no project list, and the index page's heading still
reads "Client Profiles" (`app/agency/clients/page.tsx:38`; left alone because the ruling scoped
this to the nav item). To make the name true, the destination needs: each client's projects,
listed on the client and filterable to active; the link between them is the project's linked
client profile (`lib/client-project-link.ts`, `persistProjectClientLink`). That is a build.

### 4g. 1f, what was preserved

- **Active state.** Every active-state expression is byte-identical. The 00 item has none, by
  construction.
- **Badges and counts.** There are none on any nav item in either portal (read). The
  notification bell sits outside both nav lists and was not touched.
- **Routes.** The unique `href` set of each layout file was diffed against `HEAD` before
  committing: **identical in both** (EXECUTED).
- **Keyboard and screen reader.** No link was removed, reordered in tab order, or changed in
  element type. The vendor sections gained group labels. Neither portal sets `aria-current` on
  the active link; that was true before and is listed under section 7.

---

## 5. Phase 2: the Open RFPs tile

**2a. Still held.** Read at `909f76d`: the inbox select had no `status` and no `closed_at`, and
`openRfpGroups` was `allRfpGroups.filter(g => g.responded < g.invited)`. The closure route
writes `status` and `closed_at` and inserts no response row (read,
`app/api/agency/rfp-closure/route.ts:190`).

**2b. Fixed.** The inbox select now includes `status`. Each RFP group gains a `closed` count: a
recipient with no response whose row is `closed` or `not_selected` (`isRfpClosureStatus`, the same
helper the vendor surface uses).

| | Expression |
| --- | --- |
| **Before** | `openRfpGroups = allRfpGroups.filter((g) => g.responded < g.invited)` |
| **After** | `openRfpGroups = allRfpGroups.filter((g) => g.responded + g.closed < g.invited)` |
| "RFPs closing soon" pending, before | `g.invited - g.responded` |
| "RFPs closing soon" pending, after | `g.invited - g.responded - g.closed` |

**Effects, read rather than observed:** the Open RFPs tile can only go down or stay the same. An
RFP the agency closed whole drops out. An RFP where some vendors were marked not_selected and
the rest bid also drops out; where others are still waiting, it stays open. The attention item
"RFPs closing soon" uses the same groups and drops the same RFPs. `invited` is unchanged.

**Why `status` and not `closed_at`:** the closure route writes both in one UPDATE and a reopen
resets both, so they agree; and `status` predates 099, so the select cannot fail where 099 is
unapplied. A responded row is never also counted as closed, and closure never touches a row with
a bid (`RFP_CLOSABLE_STATUSES = ["new", "viewed"]`).

**2c. The 500-row ceiling: REPORTED, NOT FIXED.** Both defects are as the brief describes:
`hasResponded` reads a response array capped at 500 newest-first, so old answered recipients can
read as waiting; `committedPartnerSpend` sums the same capped array with no time window while
`totalClientBudget` is uncapped. **Not fixed because it is not provable without a database:**

- `inboxRows` has no `.limit()` but **may still be capped by the project's PostgREST max-rows
  setting** (Supabase's default is 1000). That was not checked and nothing in the repo records
  it. If it is capped, an uncapped response fetch does not fix the number, and both selects
  have a ceiling.
- The obvious fixes (paginating, or a separate awarded-only sum) change query cost on the
  dashboard's hot path for a threshold no one has measured.

Queries are in section 9.

---

## 6. Phase 3: ruled, unbuilt, and contained

**Taken: the vendor's group-by-agency keyed on a name string.** Verified still open: the key was
`(r.agency_company_name || "Unknown Agency").trim()`. Now keyed on `lead_org_id`, which every row
carries because `app/api/partner/rfps/route.ts` selects `*`. The label is the name on that
organization's newest row, so a renamed agency shows its current name; a row with no
`lead_org_id` falls back to the name. `GroupSection` is keyed by the group key, so two
same-named organizations no longer share a React key. The "N agencies" count follows the groups.
Client and status grouping are unchanged.

**Not taken, as instructed:** the three emitter rulings (does a bid comparison run emit; does
lifting a blacklist emit; do `rfp.generate` and `rfp.regenerate` get a server-side
discriminator). Not answered. The budget spine and relationship-end revocation were not
started.

---

## 7. Found and not taken

| Item | Why not |
| --- | --- |
| 500-row ceiling on Open RFPs and `committedPartnerSpend` | Needs measuring first; section 5 |
| PostgREST max-rows may also cap the "unbounded" inbox select | New finding; unverifiable without the Supabase dashboard |
| Creative Treatment Analysis moving under 00 | Ruled, but 00 has no destination yet |
| Clients + Projects destination (projects by client) | A build, not a rename |
| `/agency/clients` heading still says "Client Profiles" | The ruling scoped the rename to the nav item. One-line change if wanted |
| Visible HQ / Workflow / Resources labels on the vendor top bar | No room in a horizontal bar; it is a layout decision. Labels are given to screen readers only |
| No `aria-current="page"` on the active link in either portal | Pre-existing; not a regression. Small, separate change |
| Delivery Performance highlights on `/agency/projects/<id>` (OPEN-6) | Pre-existing, unchanged |
| `docs/roadmap-state.md` 4.2 and the budgeting spec cite the old "no coming soon" comment | Dated records; this report supersedes them on that point |
| Migration 100 | Exists, untouched. **Applied status cannot be established from the repo.** Query in section 9 |
| Three emitter rulings | Owed to Greg |
| Budget spine | Not released to build |
| Relationship-end revocation (Q1, Q3, Q4) | Unanswered |
| Twelve unrendered milestone types | Need wording Greg chooses |
| Restoring a removed contact | Blocked on semantics |

---

## 8. What could not be established

1. How anything looks or behaves in a browser, including the 00 item's dimming and tooltip.
2. How far the Open RFPs number drops for any real agency.
3. Whether any agency is over 500 lifetime responses, and whether PostgREST caps the inbox
   select.
4. Whether migration 100 is applied.

---

## 9. Database queries owed, none of them run

```sql
-- 1. Does any agency exceed the 500-row partner_rfp_responses ceiling?
SELECT lead_org_id, COUNT(*) AS responses
FROM partner_rfp_responses
GROUP BY lead_org_id
HAVING COUNT(*) > 500
ORDER BY responses DESC;

-- 2. How large is the biggest agency's inbox? If over the PostgREST max-rows setting
--    (Supabase dashboard, API settings), the inbox select is capped too.
SELECT lead_org_id, COUNT(*) AS inbox_rows
FROM partner_rfp_inbox
GROUP BY lead_org_id
ORDER BY inbox_rows DESC
LIMIT 5;

-- 3. How many closed-out recipients the phase 2 fix now excludes, per agency.
SELECT lead_org_id, status, COUNT(*)
FROM partner_rfp_inbox
WHERE status IN ('closed', 'not_selected')
GROUP BY lead_org_id, status
ORDER BY 3 DESC;

-- 4. Is migration 100 applied? 100 REPLACES 088's policy under the SAME NAME, so the name
--    proves nothing. 100 adds an inbox-pinned branch (Branch B) that references
--    partner_rfp_inbox; 088's WITH CHECK does not. true = 100 applied.
SELECT policyname,
       with_check ILIKE '%partner_rfp_inbox%' AS has_inbox_branch
FROM pg_policies
WHERE tablename = 'milestone_events'
  AND policyname = 'Vendors insert own company milestone events';
```

Query 4's discriminator was read from the two migration files (088's policy has no reference to
`partner_rfp_inbox`; 100's Branch B does), not tested against a database.

---

## 10. Live checklist

Greg has merged about ten sessions without opening a browser. **VERIFIES THIS RUN** means this
run executed the check and saw the result. **CARRIED OVER** means no run has verified it yet.

1. **VERIFIES THIS RUN.** Working tree clean at start; `909f76d` is an ancestor of `main`, and
   nothing landed after it.
2. **VERIFIES THIS RUN.** Baseline gates measured; final gates identical, lint triple 182 / 154 /
   28 both times.
3. **VERIFIES THIS RUN.** `tsc` and the three code guards re-run after every commit, none moved.
4. **VERIFIES THIS RUN.** Both layouts' `href` sets identical before and after phase 1.
5. **VERIFIES THIS RUN.** No em dash in any added line across the whole diff; no migration file
   in the diff.
6. **CARRIED OVER (new this run).** Agency sidebar: Workflow reads 00 Budgeting (dim, "Coming
   soon", not clickable, not reachable by Tab), then 01 to 04. Resources reads Clients + Projects.
   Every page still renders and the active highlight still lands on the right item.
7. **CARRIED OVER (new this run).** Vendor top bar: the first divider now sits after Agency
   Network. Every vendor page renders.
8. **CARRIED OVER (new this run).** Agency dashboard loads; Open RFPs no longer counts an RFP you
   closed. Close one with no bids and check the tile drops.
9. **CARRIED OVER (new this run).** Vendor Open RFPs grouped by agency shows one section per
   agency organization.
10. **CARRIED OVER.** The payments change: a vendor whose relationship ended still sees what
    they are owed on `/partner/payments` (`edff222`, and `670de54` tagging finished groups).
11. **CARRIED OVER.** The pool and dashboard label changes, including "Vendors with active
    engagements".
12. **CARRIED OVER.** The engagement ruling relabels: "Engagements Awarded (This Quarter)" on the
    agency dashboard (`9ef7d8a`) and the vendor project list's "awarded engagements" (`90f25cd`).
13. **CARRIED OVER.** `/agency/project` after `789d879` edited its feeding route.
14. **CARRIED OVER.** The three new emitters (`vendor.remove`, `vendor.blacklist`,
    `rfp.generate`) and the `decompose` route's `bid.analyze`: each writes a feed line.
15. **CARRIED OVER.** Notification routing: each notification opens the right page.
16. **CARRIED OVER.** Migration 100 applied or not (query 4).
17. **CARRIED OVER.** The 500-row ceiling (queries 1 and 2).
