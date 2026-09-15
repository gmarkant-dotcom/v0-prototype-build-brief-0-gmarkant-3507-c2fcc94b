# Engagements and counts: run report

**Branch:** `feat/engagements-one-source`, cut from `main` at `edff222`. **Four commits** -
three of work plus this report.
**NOT PUSHED. NOT MERGED.**

> That sentence is the subject of this run's largest finding, so it gets a note the moment it
> is written. It is true today. **If you merge this branch, it stops being true and nothing in
> this file will notice.** Phase 1 found eight run reports saying exactly this, all eight
> merged. Checklist step 1 is to come back and mark it.

**NO SQL WAS RUN, read-only or otherwise. NO MIGRATION WAS AUTHORED, EDITED OR APPLIED.
NO ACCESS PREDICATE WAS WIDENED. NO NUMBER ON ANY CUSTOMER-VISIBLE TILE WAS CHANGED.**
Migration 100 remains **AUTHORED AND NOT APPLIED**.

**Date:** 2026-09-15. **Nothing in this run was opened in a browser.** Every claim about what
a screen shows is traceable to a component read at `HEAD`, and where it is not, it says so.

---

## THE THREE THINGS TO READ FIRST

### 1. Eight run reports declare themselves unmerged. All eight are merged. This is the trap, and it is systemic

Not eight separate stalenesses - one habit, eight times. Every run report opens with "NOT
PUSHED. NOT MERGED." because that is the truthful thing to write while the branch is open, and
nothing revisits the sentence when the branch lands. A session reading one concludes shipped
work is still on a branch, and either redoes it or leaves a fixed defect marked open.

**Verified with `git merge-base --is-ancestor <sha> main` EXECUTED for 22 commits. All
returned 0.** Each report now carries a banner. Phase 1.

**The most expensive instance:** `docs/pool-counts-and-payments-report.md` says its payments
diff is "PREPARED, NOT APPLIED". It was applied the very next commit, `edff222`. **Its live
checklist steps 7 and 8 now tell you to verify a screen that no longer exists** - step 7
expects the ended agency to be GONE from the selector when it now stays and is tagged, and
step 8 expects a panel `edff222` deleted. Following them produces a "this is broken" result
from a change that is fine. Corrected steps are carried into section 7 below.

### 2. "Open RFPs" on the agency dashboard cannot see a closed RFP, and the count only ever grows

Migration 099 shipped RFP closure. `app/api/agency/rfp-closure/route.ts:190` writes
`partner_rfp_inbox.status` and `closed_at` and creates **no** `partner_rfp_responses` row. The
dashboard's inbox select fetches **neither column**, and its open test is only
`g.responded < g.invited`, with no status, deadline or closure filter.

**So an RFP you closed with nobody bidding sits in that tile forever.** A feature shipped and
its consumer was never updated. There is a second, independent defect on the same number: it
inherits a 500-row ceiling from `partner_rfp_responses`, a table it does not bound.

**REPORTED, NOT FIXED** - it is a customer-visible tile and it gets its own change and its own
walk. Neither defect bites an agency under 500 lifetime responses, and **I did not measure
whether any agency is over it.** Section 3, with the settling queries.

### 3. The "Active Engagements" diagnosis went stale 102 minutes after it was written, and the ruling it asks for may already have been made

`docs/active-engagements-one-source.md` was committed at **15:51 on 2026-08-27**. `113a829`,
which fixes its surface 2 and performs the `lib/` lift it names as a blocker, landed at
**17:33 the same day.** Every session since, including the brief for this one, has read it as
current. **There are not four surfaces. There are eleven**, and the one the document calls
"where the phrase enters the vocabulary" is dead output that no screen reads.

**And the unit may already be ruled.** Two code comments and one report cite "Greg's ruling"
that an engagement is one awarded scope commitment, and `670de54` shipped two vendor surfaces
on it. `git log -S` finds no earlier instance of the phrase than **line 109 of the diagnosis
itself, under the heading "What Greg should standardise on"** - a recommendation written by an
assistant session the previous day. Either you ruled in a brief that is not in this
repository, or a recommendation was read as a ruling and hardened through repetition. **That
is the first question in section 2, and I did not answer it.**

---

## 0. PHASE 0: THE BASELINE, BY MEASUREMENT

`git status --porcelain` returned **empty**. `git rev-parse` showed `HEAD`, `main` and
`origin/main` all at `edff222`, so the working directory **is** `origin/main` byte for byte.

**The gates were therefore measured in the main checkout rather than a worktree, deliberately.**
It is `origin/main`, it has a real `node_modules`, and that avoids both harness failures on
record: the worktree Turbopack symlink error, and pnpm's dependency-status check firing in a
`node_modules`-less worktree and reporting **its own** exit codes as the gates'. A worktree
baseline would have been strictly less accurate here, not more.

**Every gate was run as its own unpiped command with `$?` read on the next statement.** No
exit code in this run was read through a pipe.

| Gate | Phase 0 | Phase 4 | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | **0** | unchanged |
| `pnpm build` | **0** | **0** | unchanged |
| `pnpm lint` | **1**, `182 problems (154 errors, 28 warnings)` | **1**, `182 problems (154 errors, 28 warnings)` | unchanged, full triple identical |
| `pnpm identity-columns:guard` | **0** | **0** | unchanged |
| `pnpm org-id-reads:guard` | **0**, Class B 60 known-open | **0**, Class B 60 known-open | unchanged |
| `pnpm embed-targets` | **0** | **0** | unchanged |
| `pnpm policy-audit:guard` | **1** | **1** | unchanged, known-failing |
| `pnpm verify-rls` | **2** | **2** | unchanged, known-failing |

The three known-failing gates returned exactly the brief's predicted **1 / 1 / 2**, which is
the cross-check that catches a lying harness. `tsc` and every guard were re-run after each
commit and none moved.

---

## 1. PHASE 1: THE DOCUMENTATION TRAP SWEEP

### 1a. THE SYSTEMIC FINDING

| Report | Its own header | Commits, all confirmed on `main` |
|---|---|---|
| `vendor-removal-report.md` | "NOT PUSHED. NOT MERGED." | `09cef4e`, `081a4ef`, `4ae2980` |
| `silent-failures-report.md` | "NOT PUSHED. NOT MERGED." | `626d27b`, `9360f48`, `f94eaa3` |
| `overnight-session-report.md` | "NOT PUSHED. NOT MERGED." | `5e3a216`, `8eadec0` |
| `notification-routing-report.md` | "not pushed, not merged" | `8590fd6`, `a5d20d3` |
| `closure-routing-report.md` | "not pushed, not merged" | `6ac5509` |
| `rfp-closure-report.md` | "nothing pushed, nothing merged" | `014e783`, `f177a2f`, `d782dd1`, `0f13335`, `900f235`, `c6612c4` |
| `emitter-rulings-report.md` | "not pushed and not merged" | `bc4a600`, `891a05e`, `f90972a`, `d6074a8` |
| `pool-counts-and-payments-report.md` | "NOT PUSHED. NOT MERGED." | `3ed33a6`, `472d67f`, `b320081`, `446f85a`, `3a2e0b4` |

**Method:** `git merge-base --is-ancestor <sha> main` per commit, executed, exit code read
directly. Not `git log --grep`, not a document's word.

`rfp-closure-report.md`'s phase table also calls migration 099 "Authored, not applied". 099 is
inside the applied 079-099 band, but **that rests on your own statement in the run brief and
is not re-derivable here**, so the banner says so rather than asserting it.

### 1b. THE THREE OUTCOMES, APPLIED

**RESOLVED** - the defect was real and is fixed. Marked, with how it was verified.

| Document | Evidence |
|---|---|
| `095-notification-types-ruling.md` - "AWAITING RULING. No migration numbered 095 exists" | It exists. `supabase/migrations/095_notification_types.sql:314-330` widens `notifications_type_check` to the eleven values its own section 5 specified, `'bid_submitted'` among them. Applied status rests on your statement, and the banner separates the two claims |
| `080-repair-report.md` - "repaired, NOT applied" | `lib/milestone-events.ts:28` states "080 IS APPLIED" and `:42` writes its error handling around that fact; `:146` depends on 080's INSERT policy in live code; and `roadmap-state.md` records a catalog query you ran on 2026-09-14 listing 080 as applied |
| `company-name-write-path.md` - "code written, gates re-run, **not committed**" | Committed in `d610c16` on 2026-08-20. `lib/company-identity.ts` is live and is the **only** writer of `organizations.name` - established by executing `grep -rn 'from("organizations")'` across `app/ lib/ components/` (24 sites) and reading every hit. `saveCompanyIdentity` is imported by both settings forms |
| `vendor-attention-queue.md` sections 2(b) and 3(c) | `d5aba30`. `VENDOR_QUEUE_CEILING = 500` at `app/api/partner/dashboard/route.ts:84`, and `.order("created_at", { ascending: false })` at `:168` where the read previously had no `ORDER BY` at all |
| `emitter-rulings-report.md` section 4b | `edff222`. The payments route's `partnerships` select carries no status predicate |
| `079-onboarding-docs-regression.md`, `087-award-break-diagnosis.md` | Already marked by the previous run. **Re-verified independently rather than inherited**: `lost[]` at `stage-03-onboarding-workflow.tsx:443`, returning at `:534` **before** `setSending(true)` at `:541`; `recipient_email` selected at `rfp-responses/[id]/route.ts:366` and `:410`; the guard at `award-partnership-resolution.ts:153` |

**DISPROVEN** - the finding was never true. Marked **differently**, because a reader of
"resolved" goes looking for a fix that was never made.

| Claim | The truth |
|---|---|
| `roadmap-state.md` section 4.1: *"No policy anywhere filters on `partnerships.status`"* | Two `SECURITY DEFINER` helpers do, and both gate live policies. `current_user_active_counterparty_user_ids()` filters `p.status = 'active'` at `supabase/migrations/079_organizations.sql:794` and `:799`, gating the `notifications` INSERT policy. `current_user_commercial_counterparty_org_ids()` excludes `terminated` and `removed` in 085, gating `profiles` and therefore `default_terms`, `business_criteria` and `default_nda_url`. **085 is an argued precedent for the exact mechanism the relationship-end ruling needs** - "a company NAME survives the end of a relationship; its commercial terms do not" - and section 4.1 tells a session it does not exist. The accurate version, still serious: no **delivery artifact** table filters on status, and `app/api/partner/projects/route.ts:87-90` was re-read and still has no status filter |

**STILL LIVE** - and this one is the trap inside the trap.

| Document | Why a reader will get it wrong |
|---|---|
| `093-phase6-observations.md` (a) | `components/partner-rfp-surface.tsx:692-693` still keys the agency grouping on the denormalized `agency_company_name` **string**, not on `lead_org_id`, so two spellings of one organization are still two groups. **But the "2 agencys" pluralization in the same sentence IS fixed**, by a `GROUP_NOUN` table with a comment explaining why it is a table. A session that checks the word concludes the finding is closed. **The number is still wrong; only the word beside it was repaired.** Marked with that distinction spelled out |

### 1c. `docs/roadmap-state.md`

It now carries a **second** correction banner above the first. Both are kept and the body is
still untouched, because a body edited to agree with its corrections stops being evidence of
what was believed. The new banner says so plainly, and warns that section 0's "three things to
know first" is now the most out-of-date part of a file whose entire purpose is being read cold.

It corrects: the DISPROVEN policy claim above; that relationship-end **Q2 is ruled and
shipped** while Q1, Q3 and Q4 are still open; that the `client.edit` deferral **is** recorded;
that ruling 5's emitter **is** shipped; that `feat/emitter-rulings` **is** merged and was four
commits not one; and that section 5's documentation-debt list is missing three entries plus
the general case. It re-confirms the first banner's five rows rather than inheriting them, and
it restates that **migration 100 is AUTHORED AND NOT APPLIED**.

### 1d. TWO STALE COMMENTS IN CODE, SAME CLASS, FIXED

Not in `docs/`, but the same defect and a future session's wrong brief all the same. Both said
the payments active-only filters were still present and deliberately left in place. **Both
filters are gone** (`edff222`). The comments now say the absence is the feature and name the
ruling behind it, so nothing re-adds a status predicate while tidying. No behaviour change.

### 1e. WHAT I COULD NOT VERIFY FROM A TERMINAL. THIS LIST IS ITSELF AN ANSWER

**Needs a database:**

1. `093-phase6-observations.md` (a) - how many `partner_rfp_inbox` rows carry a stale
   `agency_company_name`, and the repair. The defect is confirmed in code; the blast radius is not.
2. `company-name-write-path.md` section 5 - the repair SQL for the one drifted row was never
   run. The preventive fix shipped; the repair did not.
3. `vendor-attention-queue.md` (a) - why every deadline is empty. Its own answer is "optional
   at capture and nobody sets one", which only a row count settles.
4. Every "applied" claim about a migration. Nothing in this repository is updated when a
   migration is applied, so applied status is only recoverable from a document somebody
   remembered to write. 095 and 099 both rest on your statement in the brief.
5. Whether any partnership currently sits at `suspended` or `terminated`.

**Needs a browser:** every claim about what a screen renders. Section 7 exists because of this.

**NOT SWEPT, and I am saying so rather than implying coverage.** `docs/` holds 84 documents
carrying an open-state marker. I verified the 2026-09-14 and 2026-09-15 set in full (17
documents), plus the seven the previous run flagged as candidates. **I did not verify the
August tail** - roughly 60 documents from 2026-08-05 to 2026-08-28. The brief said to start
with the most recent because five branches have merged since, and that is where every finding
above came from; but "the August tail is stale" is untested, and `company-name-write-path.md`
(2026-08-20) and `080-repair-report.md` (2026-08-19) both turned out to be stale, which is
weak evidence that more of it is.

---

## 2. PHASE 2: "ACTIVE ENGAGEMENTS"

### 2a. THE DIAGNOSIS VERIFIED. ALL FOUR ROWS MOVED

| # | Document says | Truth at `HEAD` |
|---|---|---|
| 1 | `app/api/projects/route.ts:105`, a stage label, "not a count at all" | Line **:125** now (it was :95 before this run's own comment shifted it). Still a stage label. **But it is DEAD OUTPUT** - emitted as `dashboard_workflow_stage` / `_label` at `:322-323`, and `grep -rn 'dashboard_workflow_'` over the whole tree finds no reader. The document calls this the surface that defines the term; nothing a customer sees comes from it |
| 2 | `app/partner/page.tsx:707` tile, distinct projects, no liveness | **FIXED, `113a829`, 2026-08-27 at 17:33** - 102 minutes after this document was committed. The tile reads **"Active Projects"** (`:882`) and counts `liveProjects.length` (`:880`), which is `fetchedActiveProjects.filter(p => p.isActive)`. Both halves the document prescribed shipped together |
| 3 | `app/agency/project/page.tsx:566`, (assignment x awarded bid) | **CONFIRMED.** Same expression, now at `:578` after this run's comment. Still the finest grain, still no liveness filter |
| 4 | `app/api/agency/utilization/route.ts:352`, tile at `pool/page.tsx:1359` | Lines **:342** and **:1499**. Unit and liveness rule unchanged. The "change nothing" verdict still holds |

**The document's own stated blocker is gone too.** It says `projectActiveByEndDate` "currently
lives inside a route file rather than in `lib/`". It lives in **`lib/project-liveness.ts`** and
all three callers import it.

**Seven more surfaces the document does not name**, found by grepping the phrase across `app/`,
`lib/` and `components/` and reading every hit. The three that matter:

- **`app/api/agency/dashboard/route.ts:63,74` is a SECOND stage classifier, and it is the LIVE
  one.** It renders the stage pill at `app/agency/dashboard/page.tsx:742`. The document's
  surface 1 is the dead copy of it.
- **`app/api/agency/active-engagements/route.ts:550-561` is a THIRD, with DIFFERENT RULES.** It
  keys on `projects.status` text, adds `onboarding` and `completed`, and maps `on_hold` to
  `active_engagements` - a project neither of the others calls active. It is built on the exact
  column `lib/project-liveness.ts` exists to avoid. Also dead.
- **Two more units on dead outputs:** `total_active_engagements` (`app/api/projects/route.ts:392-441`,
  awarded response rows on live projects) and `active_engagements`
  (`app/api/partner/summary/route.ts:100`, awarded assignments with **no liveness at all**, on a
  route nothing fetches).

"Dead" here means grep over this tree finds no reader. It does not prove no external client
consumes them. What it does mean is that wiring any of them up is not a small change.

### 2b. THE RULING. WRITTEN, NOT ANSWERED

Written into `docs/active-engagements-one-source.md` as **section 6**, in the
`docs/emitter-rulings-owed.md` shape: the question, three options, and for each what a producer
sees for one worked case. **Section 6a puts the "is it already ruled?" question first**, with
both possibilities and the `git log -S` evidence, and picks neither.

Correcting the mechanics mattered. `/agency/project` is scoped to **one** project and groups by
**client** by default, so **under Option A the header reads 1 in both groupings and would have
to be deleted rather than recounted** - which is disqualifying on that surface and is not what
the options looked like before I read the grouping.

**Option B changes no number**, which makes it cheapest to ship and most tempting, and is
exactly the route by which 6a's second possibility would have happened. Section 6d says so.

### 2c. WHAT NEEDED NO RULING, AND WHAT I DID

Comments at six sites. **No label, no query, no arithmetic and no number touched.** Each names
its own unit and cross-references the others, and each dead output is marked dead with the grep
that established it. The three classifiers now point at each other, so a session reading any one
learns there are three and which is live.

**I did not rename the stage label.** The diagnosis suggests "Awarded". It is customer-visible
copy on the pill a lead agency reads daily, and it is exactly what Option B's rename question is
about - so it waits for the ruling rather than pre-empting it.

### 2d. REPORTED, NOT FIXED, AND THIS IS THE THIRD SESSION TO SAY SO

`app/partner/projects/page.tsx:738` reads **"Your active project engagements and delivery
performance"** over `allProjects` - the full awarded set, no liveness test - with an empty state
at `:767` reading **"No active projects"**. `670de54`'s own commit message reports it as the
third instance it did not fix.

It is a copy fix, needs no ruling, no query change and no arithmetic, and has a shipped
precedent: the two sibling vendor surfaces became **"Awarded engagements"** in `670de54`.
**I did not take it**, because it is a vendor-facing change on a page outside this run's stated
scope, and the standing instruction on this project is to surface the scope question rather than
pick a reading. It is a one-line change whenever you want it.

---

## 3. PHASE 3: EVERY COUNT ON THE POOL PAGE AND THE AGENCY DASHBOARD

Scope was those two surfaces only. Not bid management, not onboarding, not delivery performance.

### 3a. THE FULL INVENTORY

**`/agency/pool`.** Production path, `isDemo === false`. `GET /api/partnerships` excludes
`status='removed'`, so `partnerships` never holds a removed row.

| # | Surface | File:line | Counts | Class |
|---|---|---|---|---|
| P1 | Tile "Active vendors" | `pool/page.tsx:1488` | `partnerships.filter(p => p.status === "active").length` | **AMBIGUOUS, owed ruling R1** |
| P2 | Tile "Vendors with active engagements" | `:1497` <- `utilization/route.ts:342` | distinct partnerships with an awarded response on a project passing `projectActiveByEndDate` | **CORRECT AND CLEARLY LABELLED.** The only one of the eleven engagement surfaces that applies a liveness rule, and its label says "Vendors", which is what it counts |
| P3 | Tile "Blacklisted (whole pool)" | `:1506` value, `:1514` label | blacklist note flag across Active vendors + Invited + Discovered | **WAS AMBIGUOUS. FIXED this run** - "(whole pool)" added, expression untouched |
| P4 | "Active vendors N of N" | `:1771` | `filteredNetworkRows.length` of `allNetworkRows.length` | **CORRECT AND CLEARLY LABELLED** (`3ed33a6`) |
| P5 | "Invited N of N" | `:1772` | `filteredInvitedRows` of `invitedRows` | **CORRECT AND CLEARLY LABELLED** |
| P6 | "Discovered N of N" | `:1773` | `filteredDiscoveredRows` of `discoveredRows` | **CORRECT AND CLEARLY LABELLED** |
| P7 | "Filters narrow Active vendors. Search narrows all three columns." | `:1800` | scope statement, not a count | **CORRECT** |
| P8 | Column header "Active vendors N" | `:1814` | `filteredNetworkRows.length`, i.e. `partnershipPoolColumn() === "network"` = `active` + `suspended` + `terminated` | **AMBIGUOUS, owed ruling R1** |
| P9 | Column header "Invited N" | `:2144` | `pending` with `invitation_sent_at`, search-narrowed only | **CORRECT AND CLEARLY LABELLED** |
| P10 | Column header "Discovered N" | `:2236` | `pending` without `invitation_sent_at`, search-narrowed only | **CORRECT AND CLEARLY LABELLED** |

**R1, unchanged and not decided here:** P1 counts `status='active'`; P8 counts the network pool
column, which also holds `suspended` and `terminated`. They agree today only because nothing in
`app/` writes those statuses from the agency side. `3ed33a6`'s denominator makes the divergence
visible the day it happens.

**`/agency/dashboard`.**

| # | Surface | File:line | Counts | Class |
|---|---|---|---|---|
| D1 | Tile "Active Vendors" | `dashboard/page.tsx:493` <- `route.ts:434` | partnerships with `status === 'active'` | **CORRECT AND CLEARLY LABELLED.** Same unit as P1, so the two portals' tiles agree by construction |
| D2 | Tile "Open RFPs" | `:494` <- `route.ts:464` | distinct PROJECTS with >=1 open scope item | **WRONG.** Two defects, section 3c |
| D3 | Tile "Bids Received (This Month)" | `:495` <- `route.ts:467` | `partner_rfp_responses` with `submitted_at` in the calendar month to date, UTC | **WAS AMBIGUOUS. FIXED** - "(This Month)". One caveat in 3c |
| D4 | Tile "Awarded (This Quarter)" | `:496` <- `route.ts:470` | `project_assignments` awarded in the calendar quarter to date, UTC. **Unit is an ASSIGNMENT** | **AMBIGUOUS, and BLOCKED.** Naming the unit is the engagement ruling: an assignment is what Option B calls an engagement. Window clarified; unit deliberately not |
| D5 | "Committed vendor spend X of Y client budget" | `:521-522` <- `route.ts:474-482` | sum of awarded `budget_proposal` over `responses`, of sum of `budget_range` over all projects | **WRONG.** The numerator is capped at 500 responses and the denominator is uncapped. Section 3c |
| D6 | "Needs your attention (N)" | `:263` | `rows.length` - one row per (project x category); each row carries its own item count | **CORRECT AND CLEARLY LABELLED.** It counts the lines it heads, which is this page's convention |
| D7 | "Getting started (N of M)" | `:400` | completed checklist steps of total | **CORRECT AND CLEARLY LABELLED** |
| D8 | "Recent activity (N)" | `:657` | `items.length` after `slice(0, RECENT_ACTIVITY_LIMIT)` = 15 | **AMBIGUOUS, and already an owed product decision** in its own comment and `silent-failures-report.md` phase 2d. It saturates at 15 and separately undercounts dropped milestones. Not touched |
| D9 | "N bids awaiting review on X" | `:210` <- `route.ts:495` | submitted responses per project | **CORRECT AND CLEARLY LABELLED** |
| D10 | "{pending} of {invited} vendors haven't responded" | `:222` <- `route.ts:524` | `invited - responded` of `invited`, per scope item | **CORRECT**, but inherits D2's defect 2 above 500 responses |
| D11 | "N delivery evaluations pending on X" | `:233` <- `route.ts:543` | completed assignments with no complete delivery review | **CORRECT AND CLEARLY LABELLED** |
| D12 | "N vendor updates need attention on X" | `:243` <- `route.ts:560` | unresolved `partner_status_updates` outside the excluded statuses | **CORRECT AND CLEARLY LABELLED** |
| D13 | Usage card "N / M" AI analyses, Projects | `:561`, `:573` | from `useAgencyUsage()` | **UNVERIFIED.** A separate route this run did not trace. Section 3d |
| D14 | Stage pill "Active Engagements" | `:742` | a project, bucket name, not a count | Phase 2 |

### 3b. THE COUNT IN EACH CLASS

| Class | Count | Which |
|---|---|---|
| CORRECT AND CLEARLY LABELLED | **13** | P2, P4, P5, P6, P7, P9, P10, D1, D6, D7, D9, D11, D12 |
| CORRECT BUT AMBIGUOUS | **6** | P1, P3, P8, D3, D4, D8 |
| WRONG | **2** | D2, D5 |
| UNVERIFIED | **1** | D13 |

**Fixed this run: 2 of the 6 ambiguous** - P3 and D3. The other four are each blocked, and each
says by what: P1 and P8 on owed ruling R1, D4 on the engagement ruling, D8 on an owed product
decision that predates this run.

### 3c. THE WRONG CLASS, WITH EVIDENCE. NOT FIXED

**D2, "Open RFPs". Two independent defects.**

*Defect 1 - RFP closure is invisible to it.* `openRfpGroups = allRfpGroups.filter(g =>
g.responded < g.invited)` (`route.ts:431`). No status filter, no deadline filter, no closure
filter. Migration 099 added `partner_rfp_inbox.closed_at` and the `'closed'` / `'not_selected'`
statuses; `app/api/agency/rfp-closure/route.ts:190` writes `{ status: nextStatus, closed_at: now }`
and **inserts no `partner_rfp_responses` row**. The inbox select at `route.ts:154-157` fetches
`id, project_id, scope_item_id, scope_item_name, response_deadline, vendor_org_id,
recipient_email, viewed_at, created_at` - **neither `status` nor `closed_at`**. A closed RFP
that nobody bid on therefore stays open in this count permanently, and the count only climbs.

*Defect 2 - it inherits a ceiling from a table it does not bound.* `inboxRows` is unbounded.
`partner_rfp_responses` is `.limit(500)` newest-first (`route.ts:162`). `hasResponded`
(`route.ts:410`) is decided from `responsesByInboxId`, built from that capped array. Past 500
lifetime responses, an old recipient whose response fell outside the window reads as
invited-and-not-responded - reopening an RFP that was answered. This also inflates D10.

**D5, "Committed vendor spend".** Same 500-row ceiling, and worse here because the sum has **no
time window at all**: every awarded response older than the newest 500 drops out of the
numerator, while `totalClientBudget` sums every project with no cap. The ratio and its progress
bar understate for exactly the agencies with the most history.

**Not fixed, deliberately.** All three change a number on a customer-visible tile. The fixes are
not one-liners either: defect 1 needs two columns added to a select and a predicate whose
semantics ("is a declined-but-not-closed row open?") is a product question; defect 2 needs the
ceiling moved or the response read scoped per inbox row.

**Neither bites an agency under 500 lifetime responses, and I did not measure whether any is
over it.** Checklist steps 12 and 13 are the settling queries.

**The D3 caveat, small but real:** `responses` is ordered by `created_at` and filtered on
`submitted_at`. They are different columns. The newest-first ordering protects the month count
in practice, but a response created long ago and submitted this month could fall outside the
window. Not observed, not measured; recorded so it is not rediscovered as a mystery.

### 3d. THE UNVERIFIED ONE

**D13, the usage card.** `{usage.analyses.count} / {usage.analyses.limit}` and the same for
Projects, from `useAgencyUsage()` in `hooks/use-agency-usage.ts`. I did not trace its route to
the expression that produces either number, so I cannot say what the count counts or whether the
limit matches the entitlement the plan actually grants. **I did not guess.**

The query that would settle it, once the route is traced:

```sql
-- Does the AI-analysis counter agree with the rows it claims to count, for one org?
-- Replace <ORG_ID>. Compare against what /agency/usage renders for the same org.
SELECT count(*) FROM public.<the table the usage route counts>
WHERE org_id = '<ORG_ID>'
  AND created_at >= date_trunc('month', now() at time zone 'utc');
```

The table name is deliberately left as a blank rather than guessed at.

---

## 4. WHAT I COULD NOT ESTABLISH

**No database was queried at any point. No credentials were sought.**

1. **Whether any agency exceeds 500 lifetime `partner_rfp_responses`.** This decides whether
   D2's defect 2 and D5 are live today or latent. Steps 12 and 13.
2. **How many closed RFPs are currently inflating D2.** Step 11. Unlike (1) this is live for
   **any** agency that has used closure, at any scale.
3. **Whether the engagement unit was ever actually ruled.** Section 6a of the diagnosis. Not a
   database question - it is a question only you can answer.
4. **Every "applied" claim about a migration**, 095 and 099 included. Nothing in this repository
   is updated on apply.
5. **The live values of any count in section 3.** I verified the expressions. I did not observe
   one number.
6. **The August tail of `docs/`** - roughly 60 documents. Section 1e.
7. **Nothing was run in a browser.** No screen in this report was viewed. Section 7 exists
   because of that, and it is why every UI claim above names the component it was read from.

---

## 5. MERGEABILITY AND REVERT

**All three commits are independently mergeable.** No commit depends on an earlier one. Phase 1
and Phase 3 both touch `app/agency/pool/page.tsx`, in different regions.

| Commit | Phase | Files | Revert if wrong |
|---|---|---|---|
| `594f06e` | 1 | 14 docs, 2 code comments | `git revert 594f06e`. Restores eight false "not merged" headers and two code comments that describe deleted filters as present. **No behaviour in either direction** |
| `a7ca59a` | 2 | 1 doc, 6 code comments | `git revert a7ca59a`. Comments only. **No behaviour** |
| `e84ae3f` | 3 | 3 files | `git revert e84ae3f`. Reverts two label strings - "Blacklisted (whole pool)" back to "Blacklisted", "(This Month)"/"(This Quarter)" back to "(Month)"/"(Quarter)" - and the comments recording the two WRONG findings. **No expression, query or number changes in either direction** |

**Nothing in this branch changes a number, a query, a predicate or a migration.** The only
user-visible changes in the whole run are three label strings, all on the agency side. The
riskiest commit is `e84ae3f` purely because it is the only one a user can see at all.

---

## 6. OWED RULINGS AND OPEN QUESTIONS

1. **Was the engagement unit ever ruled?** Diagnosis section 6a. Blocks everything else about
   the phrase. **Answer this before section 6b.**
2. **What is one engagement?** Diagnosis section 6b, three options costed.
3. **R1, the pool tile versus the pool column** - unchanged from `3ed33a6`, and it belongs with
   whoever builds the agency-side end-relationship control, because that control is what makes
   it live.
4. **Q1, Q3 and Q4 of `docs/relationship-end-rulings.md`** are still open. **Q2 is ruled and
   shipped**, and its rationale is recorded in a route comment and a commit message rather than
   in the document written to hold it. One thing Q2 raised and the ruling does not address:
   Option A's stated cost, that the agency cannot make a disputed record disappear.
5. **Is a declined-but-not-closed RFP recipient "open"?** D2 defect 1 cannot be fixed without
   an answer.
6. **Should `/partner/projects`' subtitle change?** Section 2d. One line, shipped precedent.

---

## 7. THE LIVE CHECKLIST

Sign in as **gmarkant@gmail.com**, the **markant** lead agency. **Every step is marked VERIFIES
THIS RUN or CARRIED OVER.** The carried-over steps are the real risk: eight sessions have merged
without a browser, so those changes have never been seen by anyone.

**Steps 1 to 6 verify this run. Steps 7 to 11 are carried over and are the backlog. Steps 12
and 13 are queries.**

1. **VERIFIES THIS RUN - and it is the one that closes the loop this run is about.** After
   merging, edit the header of `docs/engagements-and-counts-report.md` to say so, and strike its
   warning block. If you skip this step, this report becomes the ninth instance of its own
   largest finding.

2. **VERIFIES THIS RUN.** Open `/agency/pool`. The third tile now reads **"Blacklisted (whole
   pool)"**. Confirm the number is unchanged from what it read before this branch.

3. **VERIFIES THIS RUN.** On the same page, click **Status: Blacklisted**. Active vendors
   narrows; **Invited and Discovered must not change.** If the tile reads non-zero while the
   Active vendors column empties, that is the tile and the chip having different scopes, which
   is exactly what step 2's new label now says out loud. **That is correct behaviour, not a bug.**

4. **VERIFIES THIS RUN.** Open `/agency/dashboard`. The third and fourth tiles read **"Bids
   Received (This Month)"** and **"Awarded (This Quarter)"**. Confirm both **numbers** are
   unchanged. Only the words in brackets changed.

5. **VERIFIES THIS RUN.** Confirm the first two tiles are untouched: **"Active Vendors"** and
   **"Open RFPs"**, exactly as before. Open RFPs was deliberately left alone because it is wrong
   - see step 11.

6. **VERIFIES THIS RUN.** Cross-check the two portals' vendor counts, which this run confirmed
   share a unit: `/agency/dashboard`'s "Active Vendors" tile and `/agency/pool`'s "Active
   vendors" tile must show **the same number**. If they differ, one of the two reads is scoped
   differently from what `isActivePartnership()` implies, and that is new.

7. **CARRIED OVER - the payments change, and the previous report's own checklist is wrong about
   it.** `edff222` removed both active-only filters. **Ignore steps 7 and 8 of
   `docs/pool-counts-and-payments-report.md`; they describe the pre-`edff222` screen.** The
   corrected test, as agency, from a browser console:

   ```js
   await fetch('/api/partnerships', {
     method: 'PATCH',
     credentials: 'same-origin',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ partnershipId: '<id>', status: 'terminated' }),
   }).then(r => r.json())
   ```

   Reload `/partner/payments` as that vendor. **Expected NOW:** the agency is **still in the
   selector**, carrying an **Ended** tag, and **its payment milestones are still readable**. The
   old sentence "No active partnerships yet. Accept an invitation..." must not appear. PATCH back
   to `'active'` and confirm the tag and banner disappear.

8. **CARRIED OVER - the pool label changes** (`3ed33a6`). Confirm the line above the three
   columns reads `Active vendors N of N - Invited N of N - Discovered N of N`, that "Showing"
   and "results" are gone, and that the second line reads "Filters narrow Active vendors. Search
   narrows all three columns." Then **count the rows in each column by hand** and check each
   against its own header and its pair in the summary line.

9. **CARRIED OVER - the three new emitters** (`bc4a600`, `891a05e`). Remove a vendor, blacklist a
   vendor, generate a master brief, and analyse one bid from the per-bid **decompose** route.
   Each should produce one line in the agency's Recent activity and **nothing on the vendor
   side** - all four are deliberately off `vendor_visible_event_types()`. The **compare** route
   must emit nothing, which is ruling 5.

10. **CARRIED OVER - notification routing** (`a5d20d3`, `6ac5509`). Confirm a closure
    notification opens the request it names rather than a list, on both sides.

11. **CARRIED OVER, AND IT IS THE BACKLOG ITEM, NOT A TEST.** Close an RFP on a project where
    nobody bid (`/agency/bids`), then reload `/agency/dashboard`. **Expected today: the "Open
    RFPs" tile does not go down.** That is section 3c defect 1 reproducing, and seeing it once
    is worth more than the query. It needs its own change.

12. **QUERY, NOT RUN.** Does any agency exceed the 500-row response ceiling? This decides whether
    D2 defect 2 and D5 are live or latent.

    ```sql
    SELECT lead_org_id, count(*) AS responses
    FROM public.partner_rfp_responses
    GROUP BY lead_org_id
    HAVING count(*) > 500
    ORDER BY responses DESC;
    ```

13. **QUERY, NOT RUN.** How much is "Open RFPs" currently overstating, from closure alone?

    ```sql
    -- Inbox rows that are closed or not_selected and have no response row.
    -- Each distinct project_id here is a phantom "open RFP" on that agency's dashboard.
    SELECT i.lead_org_id, count(DISTINCT i.project_id) AS phantom_open_projects
    FROM public.partner_rfp_inbox i
    LEFT JOIN public.partner_rfp_responses r ON r.inbox_item_id = i.id
    WHERE i.status IN ('closed', 'not_selected')
      AND r.id IS NULL
    GROUP BY i.lead_org_id
    ORDER BY phantom_open_projects DESC;
    ```

14. **QUERY, NOT RUN.** How many `partner_rfp_inbox` rows carry a stale agency name, which is
    `093-phase6-observations.md` (a), confirmed still live in phase 1.

    ```sql
    SELECT i.lead_org_id, o.name AS current_name,
           i.agency_company_name AS snapshot_name, count(*) AS rows
    FROM public.partner_rfp_inbox i
    JOIN public.organizations o ON o.id = i.lead_org_id
    WHERE i.agency_company_name IS DISTINCT FROM o.name
    GROUP BY i.lead_org_id, o.name, i.agency_company_name
    ORDER BY rows DESC;
    ```

15. **CONFIRM NOTHING WAS APPLIED.** `git log --oneline main..feat/engagements-one-source` shows
    **four** commits: three of work plus this report. `git status` is clean. `supabase/migrations/` still ends
    at `100_*`, unapplied, and `git diff main..HEAD -- supabase/` is **empty** - which was
    executed and was empty at the time of writing.
