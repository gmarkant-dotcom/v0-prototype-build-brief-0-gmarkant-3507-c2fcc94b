# Roadmap state: what is built, what is ruled and unbuilt, what is blocked

**Date:** 2026-09-14. **Branch:** `feat/budgeting-spec`.
**Purpose:** open this file cold and know what to do next without reading twenty reports.

**Derived from the repository**: the migrations directory, the docs directory, the routes, and
`git log`. **Not from any summary.** Every row says how it was established, and where confidence
ends it says so rather than rounding up.

**NO SQL WAS RUN.** There are no working database credentials in this environment. Every claim
about the live database is attributed to the document or the person that observed it.

---

## 0. The three things to know first

1. **The largest open gap is that no agency-side control ends a relationship with an active
   vendor**, and even if one existed it would revoke nothing. Section 4.1. It is blocked on a
   ruling that has never been written down, and the document that was to frame that ruling
   (`docs/relationship-end-rulings.md`) **does not exist**.
2. **The six emitter rulings are answered but only half shipped.** Rulings 1, 2 and 4 have
   emitters on an unmerged branch. Ruling 5 has copy but no emitter. Ruling 6 is a live silent
   failure with no migration written. Section 3.
3. **The migration boundary is not verifiable from this repository.** Stop-gate headers state
   authoring-time status and are never updated on apply, so they are not evidence. Section 1.

---

## 1. Migrations: applied versus authored

### How the boundary was established, and where it stops

**The stop-gate headers are NOT evidence of current state.** `grep` over `supabase/migrations/`
shows 083 through 099 carrying "STOP GATE" and 080, 082 and 088 carrying "AUTHORED, NOT APPLIED".
Those sentences were true when each file was written and **no file is edited when it is applied**,
so the header of an applied migration still says it is not applied. 080 is the clearest proof:
its header says "AUTHORED, NOT APPLIED" and `lib/milestone-events.ts` says in its own comment
"080 IS APPLIED", with live behaviour depending on it.

**`LIGAMENT_CONTEXT.md` declares itself incomplete.** Its migration table runs to 078 and then
says, verbatim: "This migration log stops at 078 and is incomplete. 079, 080, 082 and 087 are
applied and have no row here."

**The three independent pieces of evidence that do exist:**

| Evidence | What it establishes | Strength |
| --- | --- | --- |
| A catalog query Greg ran on 2026-09-14, recorded in `docs/budget-actuals-findings.md` open question 10 | 079, 080, 082, 083, 085 and 086 applied. Probes named per migration. Total policies in `public` = 122 | **Strongest.** A live catalog read, run as `postgres` |
| `docs/098-preapply-test.sql:1246` asserts 122 policies as its own pass condition | The live total of 122 is consistent with migrations applied **through 098** | Corroborating, not proof: a count can coincide |
| The session brief of 2026-09-14 (feat/emitter-rulings) states "MIGRATIONS RUN TO 099 AND EVERY FILE 079 THROUGH 099 IS APPLIED TO PRODUCTION" | 079 to 099 applied | Greg's own statement. Authoritative, and not re-derivable here |

**THE BOUNDARY, STATED AS PLAINLY AS THE EVIDENCE ALLOWS:**

> **079 through 099 are applied. 100 and above do not exist.** The highest numbered file is
> `099_rfp_closure.sql`.

**WHERE CONFIDENCE ENDS.** Six of those are confirmed by catalog query; the rest rest on Greg's
statement plus a corroborating policy count. **072 is the one genuine unknown**: it is absent from
the migration log entirely, whose table runs 070 then 073, and nothing in the repository records
its status either way. The query that settles it is open question 8 of
`docs/ligament-00-budgeting-spec.md`.

**A rule worth adopting.** Nothing in this repository is updated when a migration is applied, so
applied status is only ever recoverable from a document somebody remembered to write. That is why
this section cannot do better, and it is a process gap rather than a research failure.

---

## 2. What is built and shipped

Established by reading the routes, components and migrations named, plus the report that records
each piece of work.

| Workstream | State | How established | Where written down |
| --- | --- | --- | --- |
| **Organizations model (M1 foundation)** | **Built and live.** One user is no longer one company; `org_members`, `organizations`, and the 707-reference rename | Migration 079 read in full; `resolveCallerOrgIds` / `resolveCallerWriteOrgId` used across `app/api/` | `docs/079-*.md` (nine files), `docs/m1-foundation-report.md` |
| **M1 multi-user: colleague invitations** | **Built.** Invitation lifecycle, member identity | Migrations 086, 089 read; `app/api/` invitation routes exist | `docs/089-invitation-session-report.md`, `docs/m1-invitation-flow-design.md` |
| **M1 entitlements on the organization** | **Built.** `organizations.is_paid`, `agencyEntitlementId()` | Migration 092 read; `canUseAgencyAi()` in `lib/entitlements.ts` | `docs/092-entitlements-design.md`, `docs/091-entitlements-surface.md` |
| **Acting organization / role switching** | **Built.** `active_role`, `resolveActingOrgId` | Migration 090 read; `lib/acting-org.ts`, `lib/acting-role.ts` | `docs/090-active-org-report.md` |
| **M3 point person (project leads)** | **Built.** `project_leads`, `set_project_lead()`, plus roles and vendor tags | Migrations 097 and 098 read; `docs/098-preapply-test.sql` is a full 14-assertion test | `docs/m3-project-leads-report.md`, `docs/m3-tags-report.md` |
| **M4 colleague filter** | **Built** | `docs/m4-colleague-filter-report.md` read; `docs/m4-phase0-baseline.md` | `docs/m4-colleague-filter-report.md` |
| **RFP closure** | **Built.** Migration 099, close and decline routes, the status-before helper | Migration 099 read in full, including its `partner_rfp_inbox_status_before()` guard | `docs/rfp-closure-report.md`, `docs/closure-routing-report.md` |
| **Notification routing and types** | **Built.** Migrations 094, 095, 096 | Migrations read; `lib/notifications.ts` | `docs/notification-routing-report.md`, `docs/notification-types-report.md`, `docs/095-notification-types-ruling.md` |
| **Milestone events / activity feed** | **Built.** Migration 080 (table, whitelist, three policies), 088 (vendor INSERT policy) | Both migrations read in full; `lib/milestone-events.ts`, `lib/activity-feed.ts`, `app/api/agency/dashboard/route.ts` source 5 | `docs/080-emitter-coverage-report.md`, `docs/recent-activity-merge-report.md` |
| **Sentry observability on dropped breadcrumbs** | **Built.** Every milestone drop reaches Sentry with a `drop_reason` tag | `lib/milestone-events.ts` `reportMilestoneDrop()` read | `docs/silent-failures-report.md` |
| **Vendor removal: honest copy, dead control deleted, removed contacts findable** | **Built and merged to main.** Commits `09cef4e`, `081a4ef`, `4ae2980` | `git log main` read | `docs/vendor-removal-report.md` |
| **RFP bid budget categories** | **Built.** Agency authors categories on an RFP, vendor bids against them | `lib/budget-categories.ts` (547 lines), three components, migration 072 read | `docs/p2-reconciliation.md` section 3 |
| **Onboarding documents regression** | **FIXED.** See below | `components/stage-03-onboarding-workflow.tsx:425-514` read | `docs/079-onboarding-docs-regression.md` |

### 2.1 The onboarding regression is closed, and the brief that sent me looking was out of date

**The task brief asked me to list this "if `docs/079-onboarding-docs-regression.md` is still
unresolved". It is not.**

The diagnosis document is still present and still describes the 2026-08-18 failure: a package row
created, an email sent saying "Your onboarding documents are ready", `success: true` returned, and
**zero document rows written**, because the client built its `documents` array through three
`continue` statements that each discarded an attachment silently.

`components/stage-03-onboarding-workflow.tsx:425` now carries a block headed **"THREE SILENT
DROPS, NOW VISIBLE"**, and the fix is there in the code: a `lost[]` array and a `placeholders[]`
array, with the distinction drawn deliberately. A project row with **neither** label nor url is an
untouched placeholder and is logged and skipped; a row with **exactly one** of the two is a real
attachment that was lost, and **it stops the send**. The comment states that the predicate
deciding what is valid is byte-for-byte unchanged, and only the reporting of a discard is new.

**The diagnosis document has no "resolved" marker on it**, which is why a reader following the
brief would conclude it is open. Adding one is a one-line documentation change and is listed in
section 5.

---

## 3. The six emitter rulings: answered, half shipped

**All six were answered by Greg on 2026-09-14.** The questions and options are in
`docs/emitter-rulings-owed.md`; the answers arrived in a session brief and, for three of them, in
code.

| Ruling | Answer | Built? | Established by |
| --- | --- | --- | --- |
| **1. `vendor.remove`** | Emit, agency feed only, off the whitelist | **Yes**, on unmerged branch `feat/emitter-rulings` (`2c2db0f`) | `git log main..feat/emitter-rulings` |
| **2. `vendor.blacklist`** | Emit, agency feed only, off the whitelist. Nothing from `partnership_notes` in the payload | **Yes**, same commit | same |
| **3. `client.edit`** | **DO NOT EMIT.** Deferred with a definition of "material": a client edit is material when it changes standing business requirements or attached documents, because those flow into every RFP built from that client. Names, notes and contact details are not | **N/A, by ruling.** The deferral is **NOT yet recorded** in `docs/emitter-rulings-owed.md` | Read the file: ruling 3 still carries only the original options |
| **4. `rfp.generate`** | Emit. **One type, not two** - `rfp.regenerate` is not emitted, because nothing persists a generation run and the only discriminator would be a flag from the browser | **Yes**, same commit | same |
| **5. `bid.analyze` / `bid.analyze_retry`** | Emit from the per-bid `decompose` route only, agency feed only, off the whitelist, payload restricted to `scope_item_name`. `compare` emits nothing | **NO. Copy only.** `lib/activity-feed.ts` carries both predicates; **neither route emits** | Read `app/api/agency/bids/[responseId]/decompose/route.ts` and `compare/route.ts`: no `recordMilestone` call in either |
| **6. The vendor with no partnership** | **FIX IT**, pinned through `partner_rfp_inbox` | **NO. No migration written.** Highest migration is 099 | `ls supabase/migrations/` |

### 3.1 Ruling 6 is a LIVE SILENT FAILURE, not merely unbuilt

This is the one to act on first of the six.

**Five emitters are already on `vendor_visible_event_types()` and already failing at gate 1**:
`rfp.view`, `nda.acknowledge`, `bid.submit`, `bid.revise`, `status_update.post`. With no
`partnerships` row the INSERT is refused by 088's `partnership_id IS NOT NULL` clause,
`recordMilestone()` logs and returns void, and **neither side gets a row**.

**It bites earliest in the journey.** `rfp.view` and `nda.acknowledge` fire when a partnership is
least likely to exist, so the agency loses breadcrumbs for exactly the vendors it knows least
about. The agency's feed shows an RFP sent and never shows it opened.

**Established by reading:** `supabase/migrations/088_vendor_milestone_events.sql` (the policy and
its own header calling the `EXISTS` "the clause that matters most"),
`app/api/partner/rfps/[id]/route.ts:118-131` (which carries a "KNOWN RESIDUAL, NOT FIXED HERE"
comment naming ruling 6), and `lib/milestone-events.ts` (which reports the drop to Sentry with
`vendorPartnershipMissing: true`).

**It is observable but not fixed.** The Sentry reporting shipped in `9360f48`; the cost is now
countable rather than invisible, which is not the same as being repaired.

**What is owed:** migration 100, adding an inbox-pinned INSERT branch beside 088's
partnership-pinned one. **The constraint that cannot be skipped:** dropping the null check alone
reopens the feed-injection hole 088 exists to close, because that `EXISTS` is the only thing
pinning `org_id`. Any new pin must replace that proof, not remove it.

---

## 4. Ruled or identified, and unbuilt

### 4.1 NO AGENCY-SIDE CONTROL ENDS A RELATIONSHIP WITH AN ACTIVE VENDOR

**The largest open gap in the product.** Two separate defects that together make one feature.

**Half one: there is no control.** `grep -rn "'suspended'\|'terminated'" app/` was **executed**
this session. Every hit in `app/` is a type union, a badge branch, a comment, or the **vendor**
side. The only writers of `'terminated'` are `app/partner/network/page.tsx:456` (the vendor
declining) and `app/api/partnerships/route.ts:1209` (the decline branch of the same act).
`PATCH /api/partnerships` **accepts** both values from an agency and **no UI ever sends either**.

**Half two: even if a control existed it would revoke nothing.** No policy anywhere filters on
`partnerships.status`. `app/api/partner/projects/route.ts:87-90` reads a vendor's awarded work
with **no status filter at all**.

**The consequence, which is live today.** Every partnership sitting at `status='removed'` right
now is a relationship where the agency believes access was revoked and it was not. Those vendors
can still open every project they were assigned, every document, every onboarding package.

**Blocked on:** a ruling on what happens to work in flight. Awarded projects, unpaid payment
milestones, open RFP requests, onboarding packages, readable documents and messages each need an
answer, and the hardest is unpaid milestones: **a vendor owed money who cannot see the record is a
real problem.**

> **`docs/relationship-end-rulings.md` DOES NOT EXIST.** `ls` was executed. The session that was
> to write it (`feat/emitter-rulings`, Phase 4) did not reach that phase. **The ruling has no
> document to be made in, and that is the first thing to fix about this item.**

Partial framing does exist, in `docs/vendor-removal-report.md` section 5 (three questions) and
`docs/budget-actuals-findings.md` finding 7 question 3.

### 4.2 The budgeting spine

**Ruled extensively, entirely unbuilt, and as of this branch specified.**

- **Specification:** `docs/ligament-00-budgeting-spec.md`, written this session. Eight rulings
  recorded as settled with their reasoning; ten open questions at the foot.
- **Evidence input:** `docs/budget-actuals-findings.md`, the receipt extraction test.
- **Built:** nothing. `components/agency-layout.tsx:48` records the absence deliberately: "00
  BUDGETING IS NOT HERE, NOT AS AN ITEM, NOT AS A STUB, NOT AS 'COMING SOON'".
- **Blocked on:** the four access-model questions in `docs/budget-actuals-findings.md` finding 7,
  restated as section 6 of the spec. **They gate the actuals build entirely**: a ledger built
  without an access model has to be rebuilt to get one.

**Do not confuse it with the shipped RFP bid budget feature.** Spec section 1c says why, and that
warning exists because the naming makes the mistake easy.

### 4.3 Restoring a removed contact

`PATCH /api/partnerships` validates status against `['active','suspended','terminated','removed']`
and **rejects `'pending'`**, so a Discovered contact cannot be put back where it came from without
widening that list by one value. Established by reading `app/api/partnerships/route.ts:1049`.

**Blocked on** semantics rather than code: does a restored never-invited contact go back to
Discovered, and does a restored ex-active vendor go back to `active` **without the vendor agreeing
again**? The second re-activates a relationship unilaterally. Framed in
`docs/vendor-removal-report.md` section 5 ruling 3.

### 4.4 The twelve unrendered milestone event types

`lib/activity-feed.ts` `MILESTONE_PREDICATES` is the gate: **a type absent from that table renders
no line at all.** Twelve whitelisted types still have no wording.

**Blocked on** a wording decision rather than a ruling. `docs/emitter-rulings-owed.md` closes by
saying twelve wordings written unattended would be twelve lines of product voice nobody chose.

---

## 5. Documentation debt that makes this file necessary

Small, cheap, and each one is why some item above took a sweep to establish.

| Item | Fix |
| --- | --- |
| `docs/079-onboarding-docs-regression.md` has no resolution marker, so it reads as open | Add a status line pointing at the fix in `components/stage-03-onboarding-workflow.tsx:425` |
| `docs/emitter-rulings-owed.md` ruling 3 does not record Greg's deferral or his definition of "material" | Record it. It was ruled on 2026-09-14 |
| Migration stop-gate headers are never updated on apply | No per-file fix. The migration log in `LIGAMENT_CONTEXT.md` is the right home and it stops at 078 |
| 072 is absent from the migration log entirely | Add a row once its applied status is known |
| `docs/relationship-end-rulings.md` does not exist | Section 4.1 |

---

## 6. What to do next, in order

Derived from the above. **Ordered by live harm, then by what unblocks the most.**

1. **Write `docs/relationship-end-rulings.md`** and get the ruling. Section 4.1 is live harm:
   agencies believe access was revoked and it was not. Nothing can be built until the ruling
   exists, and the ruling has nowhere to be written.
2. **Migration 100 for emitter ruling 6.** Section 3.1 is a live silent failure affecting the
   earliest acts of every magic-link and email-invited vendor. Observable since `9360f48`, still
   unrepaired.
3. **Answer the four access-model questions** in `docs/budget-actuals-findings.md` finding 7.
   They block the whole actuals half of the budgeting spine, and answering them late means
   migrating the most sensitive data in the product.
4. **Ship emitter ruling 5's emitter.** The copy is already in `lib/activity-feed.ts`; the
   `decompose` route needs the call. Small and self-contained.
5. **Merge or drop `feat/emitter-rulings`.** One commit, unmerged. Rulings 1, 2 and 4 are done and
   sitting on a branch.
6. **The documentation debt in section 5.** Cheap, and it is what made this file take a sweep.
