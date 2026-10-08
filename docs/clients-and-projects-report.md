# Clients + Projects run report

**Date:** 2026-10-08. **Branch:** `feat/clients-and-projects`, cut from `main` at `c718048`.
**Not pushed.** This report does not state its own merge status. To check it, run
`git merge-base --is-ancestor <sha> main` (exit 0 means on `main`) for each SHA in section 2.

**Nothing in this run was opened in a browser.** Gates and `git` commands were EXECUTED;
everything else was READ. **No SQL was run**, read-only or otherwise. No migration was authored,
edited or applied. No access predicate was widened, no service role added, no session or role
check touched, no existing route path moved.

One caveat on "no SQL": the baseline ran `scripts/verify-rls.mjs` in a worktree with a copy of
`.env.local`. It exited 2, the known value, and I did not inspect what it contacted. Treat that
as the only place this run could have touched the network.

---

## READ THESE THREE FIRST

1. **1c, not 1b. Not every project has a client, and that is by design, so the page shows an
   unfiled section instead of dropping them.** A typed client name writes `client_name` with
   `client_id` null, by standing ruling (`lib/client-project-link.ts`). Creating a project with no
   client at all is also allowed. I did not change that: making `client_id` mandatory overrules
   the typed-name ruling, which is yours to make. Run backfill query B1 below to see how many
   rows are affected and how many a name match could file.
2. **A dashboard money figure moved: "committed partner spend" now sums EVERY awarded
   response.** It can only go up or stay the same. For an agency under 500 lifetime
   responses nothing changes. Section 4 has before and after. The other half of the ceiling,
   `hasResponded` (an old answered recipient can read as waiting), is NOT fixed.
3. **Nothing could be seen.** Every statement about what the new page shows traces to the component
   I read. The section 7 checklist says what to open.

---

## 1. The brief was right about the headline and wrong in two places

- **Right:** the nav promised a destination that did not exist. `app/agency/clients/page.tsx` had
  no projects, the detail page has none still.
- **Wrong, 0a/state:** the brief says migration 100 is applied. `docs/roadmap-state.md` and
  `docs/nav-restructure-report.md` say authored and not applied. I took the brief as authority
  (it is yours) but nothing in the repo can confirm it. Flagged in the roadmap banner.
- **Wrong, the `client_id` question:** the brief frames "which paths set it". There are only TWO
  project insert sites in the code (READ, `grep` for inserts on `projects`):
  `POST /api/projects` and `POST /api/agency/projects/duplicate`. Both go through
  `lib/clients-server.ts`; neither is missing the column. The gap is not an omitting path, it is
  that a typed name or no name legitimately leaves it null. Rows made before 2026-08-13 are null
  as well.

### 0c. Resources items in the agency sidebar (READ, `components/agency-layout.tsx:92-97`)

| Label | Route |
| --- | --- |
| Clients + Projects | `/agency/clients` |
| Master Documents | `/agency/documents` |
| Usage | `/agency/usage` |
| FAQ | `/faq` |

---

## 2. Commits, and what to revert

| Commit | Phase | Files | Revert if |
| --- | --- | --- | --- |
| `cd0137f` | 1 | `app/agency/clients/page.tsx`, new `app/api/agency/client-projects/route.ts` | `/agency/clients` fails to render or the list is wrong. Revert; the nav link keeps working, as it did this morning |
| `6c88b1b` | 2 | `app/api/agency/dashboard/route.ts` | the dashboard 500s, or committed spend reads LOWER than before. It should not |
| `3fe3713` | 3 | docs, plus a comment in `components/agency-layout.tsx` | never needed |

Plus this report. Each commit merges alone. After each, `tsc` and the three code guards were
re-run (EXECUTED) and none moved.

---

## 3. Phase 1: the repository

### What was built

- **Extended the existing page**, not a parallel one. `/agency/clients` already is the nav
  destination and already lists clients; a second surface would have made the label point at one
  page and the data live on another. Heading is now "Clients + Projects". Each client row keeps
  its link to the profile and gains its project list underneath; the client link still goes to
  `/agency/clients/[id]`.
- **A new read route**, `GET /api/agency/client-projects`. The page's other route,
  `/api/agency/clients`, is unchanged.
- **Built from existing parts only:** `AgencyLayout`, `GlassCard`, `Link`, the row styling the
  page already used, `cn`. No new table, layout primitive or design token. The two filter buttons
  are plain buttons in the page's existing mono-label style.

### Where the organization check lives (for every new query)

| Query | Scope |
| --- | --- |
| `clients` select | `.in("org_id", callerOrgIds)` |
| `projects` select | `.in("org_id", callerOrgIds)` |

`callerOrgIds` is `resolveCallerOrgIds(user.id, supabase)` on the session user, after
`requireAgencyRole()`. **The route takes no client id or project id from the URL or body**, so
there is no identifier to trust. A project's `client_id` is additionally believed only if it names
a client in the caller's own client set; otherwise it is returned unlinked. Neither
`current_user_counterparty_org_ids` nor `current_user_visible_profile_ids` is used.
`org-id-reads:guard` passed on the new route (EXECUTED).

### How it behaves (READ)

- A project appears under exactly one client: `client_id` is one column, the route dedupes by id,
  and the page spends each id once.
- **Projects with no client profile are shown** in a section titled "No client profile", with the
  typed client name where one exists. Nothing is dropped.
- **Not silently capped.** PostgREST truncates an unranged select at its max-rows setting with no
  error. The route pages `.range()` in blocks of 1000, up to 20 pages, and sends
  `truncated: true` if it hits the ceiling; the page then says some projects are not shown.
- **A failed projects read is not an empty list.** The page says projects could not be loaded and
  leaves the client list alone.
- Hydration: the page shows its loading state only until both fetches finish, and never an empty
  state before then.
- **Liveness (1d):** `projectActiveByEndDate` from `lib/project-liveness.ts`, called in the route,
  nothing else. It returns true for a null or unparseable `end_date`, so a project with no end
  date reads "Active". That is the one definition; I did not carve a "no claim" case out of it.
  The page filter defaults to "Active projects" with an "All projects" toggle.
- **Engagements (1e):** the page counts and labels PROJECTS only. It does not use the word
  engagement or count one.
- **Empty states (1f):** a client with no projects reads "No projects for this client yet. Name
  this client when you start a project and it will be filed here."; a client whose projects are
  all ended says so and points at the toggle; an agency with no clients still sees its projects
  under "No client profile" beneath the existing "No client profiles yet" card.

### What I could not establish

- How many rows have a null `client_id` (queries B1, B2).
- The page's actual appearance, spacing, or the filter buttons' look.
- Whether the `/agency/projects/[id]` link target is right for every project. It is the path the
  dashboard already uses (`app/agency/dashboard/page.tsx:749`).

### Not taken

- **Making `client_id` mandatory at creation, or auto-creating a profile from a typed name.**
  Both overrule the standing typed-name ruling.
- **A name-match backfill.** Data change; query only.
- **Dates on project rows.** `lib/utils.ts` has `formatDateTime` but no `formatDate`, and
  `end_date` is date-only; I did not add a helper or print a bogus time.

---

## 4. Phase 2: the 500-row ceiling

### 2a. Both hold (READ, `app/api/agency/dashboard/route.ts` at `c718048`)

- `partner_rfp_responses` is `.order("created_at", desc).limit(500)` at line 172.
- `inboxRows` has no `.limit()`. **Whether PostgREST's max-rows setting caps it was not checked
  and cannot be from here.** If the setting is the Supabase default of 1000, an agency over 1000
  inbox rows silently loses the rest.
- `hasResponded` is built from the capped array. `committedPartnerSpend` summed the awarded rows
  of the same capped array with no time window, while `totalClientBudget` sums every project.

### 2b. What was fixed, and why only this

`committedPartnerSpend` and the per-project `committedSpend` column now read every awarded
response through their own paged query (`id, inbox_item_id, budget_proposal`, `status = awarded`,
`lead_org_id in callerOrgIds`, ordered by `id`, `.range()` in blocks of 1000). It is correct
without a database: the set is selected by the predicate alone, so no row can fall outside a
window. A database-side `SUM` would be better, but `budget_proposal` is a JSON blob parsed in
JavaScript by `parsePartnerBudgetProposal`, so it needs a migration or RPC. Not available.
**If any page errors, the code falls back to the old capped awarded subset and logs it**, so the
dashboard cannot 500 over this figure. The scope is the same organization predicate as every
other read in that route.

**`hasResponded` is NOT fixed.** A correct fix needs every `inbox_item_id` that has a response,
which is an unbounded narrow read on the dashboard's hot path, AND a paged inbox read, because an
inbox capped by PostgREST would defeat it. The size of both is unmeasured. Queries B3 and B4.

**Not done, per 2c:** the limit was not raised.

### 2d. The money figure, before and after

| | Expression |
| --- | --- |
| **Before** | `sum(parse(r.budget_proposal))` over `responses.filter(status === "awarded")`, where `responses` is the newest 500 |
| **After** | `sum(parse(r.budget_proposal))` over every row with `status = 'awarded'` for the caller's organizations |
| Per-project `committedSpend` | same change, same array |

**Direction:** up or unchanged, never down. It is unchanged for any agency whose awarded
responses were all within its newest 500. For an agency with more than 500 lifetime responses it
rises by the sum of its older awarded responses, and the ratio "committed of client budget" rises
with it. It is displayed on `app/agency/dashboard/page.tsx:542`, with a progress bar at `:520`
capped at 100 percent.

---

## 5. Phase 3

- **3a. Creative Treatment Analysis is still reachable.** `components/agency-layout.tsx:151` and
  `:174` link `/agency/brief` from the RFP Broadcast item (READ). Not moved.
- **3b. Nothing was orphaned by `c718048`.** The unique `href` set of `agency-layout.tsx` and
  `partner-layout.tsx` is identical at `909f76d` and `HEAD` (EXECUTED, `grep -o`). Routes with
  no inbound link found in `app/`, `components/` or `lib/` (a crude `grep`; exact-string matches
  only, so a link built from a variable would be missed):
  `/agency/cashflow` and `/agency/msa` have none at all. `/agency/payments` and
  `/agency/utilization` are named only in `lib/demo-data.ts`. All four are the pre-existing parked
  set. `/partner/marketplace` is linked from the vendor menu. Nothing was fixed because nothing
  was plainly broken by the restructure.
- **3c. Documentation sweep, narrow.** I did not read all of `docs/`. I checked the reports whose
  headers declare themselves unmerged: three were merged. `docs/engagement-ruling-report.md`
  (`789d879` is an ancestor of `main`), `docs/m1-foundation-report.md` and
  `docs/079-rename-execution-report.md` (the commit that added each file is an ancestor; I did
  not check each branch commit). Each now carries a status-check block naming the command. I
  added a third banner to `docs/roadmap-state.md` with rows marked RESOLVED, STILL TRUE or
  CONTRADICTED separately. **Nothing is marked DISPROVEN this run.** The `agency-layout.tsx`
  comment that said "rename only, no project list" is updated.

---

## 6. Queries written and not run, ready to paste

```sql
-- B1. How many projects have no client profile, and how many of those carry a typed name?
SELECT COUNT(*)                                                         AS total,
       COUNT(*) FILTER (WHERE client_id IS NULL)                        AS no_profile,
       COUNT(*) FILTER (WHERE client_id IS NULL
                          AND btrim(coalesce(client_name, '')) <> '')   AS no_profile_typed_name,
       COUNT(*) FILTER (WHERE client_id IS NULL
                          AND btrim(coalesce(client_name, '')) = '')    AS no_client_at_all
FROM projects;

-- B2. Backfill CANDIDATES: a typed name matching exactly ONE client profile in the same
--     organization, case and surrounding whitespace ignored. READ ONLY. Review before any write.
WITH matches AS (
  SELECT p.id AS project_id, p.name AS project, p.client_name, p.org_id,
         c.id AS client_id, c.name AS client,
         COUNT(*) OVER (PARTITION BY p.id) AS n_matches
  FROM projects p
  JOIN clients c
    ON c.org_id = p.org_id
   AND lower(btrim(c.name)) = lower(btrim(p.client_name))
  WHERE p.client_id IS NULL
)
SELECT * FROM matches WHERE n_matches = 1 ORDER BY org_id, client;

-- B2a. The backfill itself, only if Greg approves it. Names the projects B2 returned and nothing else.
-- UPDATE projects p SET client_id = c.id
-- FROM clients c
-- WHERE p.client_id IS NULL AND c.org_id = p.org_id
--   AND lower(btrim(c.name)) = lower(btrim(p.client_name))
--   AND (SELECT COUNT(*) FROM clients c3 WHERE c3.org_id = p.org_id
--          AND lower(btrim(c3.name)) = lower(btrim(p.client_name))) = 1;

-- B3. Does any agency exceed the 500-row responses ceiling? And how much awarded value sits
--     OUTSIDE its newest 500 (the amount the dashboard figure just gained)?
SELECT lead_org_id, COUNT(*) AS responses,
       COUNT(*) FILTER (WHERE status = 'awarded') AS awarded
FROM partner_rfp_responses
GROUP BY lead_org_id
HAVING COUNT(*) > 500
ORDER BY responses DESC;

-- B4. Inbox size per agency, against the PostgREST max-rows setting (dashboard API settings).
SELECT lead_org_id, COUNT(*) AS inbox_rows
FROM partner_rfp_inbox
GROUP BY lead_org_id
ORDER BY inbox_rows DESC
LIMIT 5;

-- B5. Projects per agency, against the 20,000-row ceiling of the new route (20 pages x 1000).
SELECT org_id, COUNT(*) FROM projects GROUP BY org_id ORDER BY 2 DESC LIMIT 5;
```

None of these were run or tested against a database. Treat them as drafts.

---

## 7. Found and not taken

| Item | Why not |
| --- | --- |
| `client_id` mandatory, or a profile auto-created from a typed name | Overrules a standing ruling |
| Name-match backfill | Data change |
| `hasResponded` under the 500 cap | Hot-path query cost unmeasured; needs paged inbox too |
| PostgREST max-rows possibly capping `inboxRows` | Cannot be checked here |
| Two near-identical project-by-client groupings (`pool/client-history` groups by a normalized name) | Different job; merging them is a design call |
| Open-RFPs tile and other dashboard figures still read the capped `responses` | Only the money figure was in scope |
| Three emitter rulings, relationship-end, budget spine, 00 Budgeting destination | Out of scope per brief |
| `docs/roadmap-state.md` sections 1 to 6 body | Left as written; banners correct it |

---

## 8. Gates

Baseline = throwaway worktree of `origin/main` (`c718048`), tools invoked directly, not through
`pnpm`; `pnpm build` ran in the main checkout on the identical tree. Final = this branch. Each
gate ran as its own unpiped command with `$?` read next.

| Gate | Baseline | Final |
| --- | --- | --- |
| `tsc --noEmit` | 0 | **0** |
| `pnpm build` | 0 | **0** (new route listed) |
| `eslint .` | 1, **182 problems (154 errors, 28 warnings)** | 1, **182 (154 / 28)** |
| `identity-columns:guard` | 0 | **0** |
| `org-id-reads:guard` | 0 | **0** |
| `embed-targets` | 0, TOTAL 0 | **0** |
| `policy-audit:guard` | 1 (known) | **1** |
| `verify-rls` | 2 (known) | **2** |
| markdown link corruption grep | n/a | no matches |
| em dash in any added line | n/a | 0 |
| migration files in the diff | n/a | 0 |

The baseline worktree was removed after its `node_modules` symlink was; the real `node_modules`
was re-checked and survived.

---

## 9. Live checklist

**VERIFIES THIS RUN** = this run executed the check and saw the result. **CARRIED OVER** = no run
has verified it, and you need to open a browser.

1. **VERIFIES THIS RUN.** Tree clean at start; `c718048` was `HEAD`, `main` and `origin/main`.
2. **VERIFIES THIS RUN.** Baseline gates measured; final identical; lint triple 182 / 154 / 28.
3. **VERIFIES THIS RUN.** `tsc` and the three code guards re-run after every commit.
4. **VERIFIES THIS RUN.** No migration, no em dash, no route path moved in the diff.
5. **VERIFIES THIS RUN.** Both layouts' `href` sets are unchanged from before the nav merge.
6. **CARRIED OVER (new).** `/agency/clients`: heading reads Clients + Projects; each client shows
   its projects; Active/All toggle works; a project with a typed client name only appears under
   "No client profile" with that name; a client with none reads as deliberate.
7. **CARRIED OVER (new).** Open a client's project link and confirm it lands on that project.
8. **CARRIED OVER (new).** Agency dashboard: "committed partner spend" is unchanged for a small
   agency; the per-project spend column still renders; the dashboard loads.
9. **CARRIED OVER.** The nav restructure: 00 Budgeting dim and non-clickable, vendor top bar
   divider after Agency Network, every page renders.
10. **CARRIED OVER.** The Open RFPs fix: close an RFP with no bids; the tile drops.
11. **CARRIED OVER.** The vendor Open RFPs page groups by agency organization.
12. **CARRIED OVER.** The payments change: a vendor with an ended relationship still sees what
    they are owed on `/partner/payments` (`edff222`, `670de54`).
13. **CARRIED OVER.** The engagement relabels (`9ef7d8a`, `90f25cd`) and `/agency/project`
    after `789d879`.
14. **CARRIED OVER.** The emitters (`vendor.remove`, `vendor.blacklist`, `rfp.generate`,
    `bid.analyze`) each write a feed line.
15. **CARRIED OVER.** Notification routing opens the right page.
16. **CARRIED OVER.** Migration 100: the brief says applied; `docs/nav-restructure-report.md`
    query 4 would confirm it.
17. **CARRIED OVER.** The 500-row ceiling's other half, queries B3 and B4.
