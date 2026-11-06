# 121 vendor write guards: report

Branch `feat/121-vendor-write-guards`. Authored 2026-11-06, two unattended runs.

**STATUS (run 2, 2026-11-06): 121 AUTHORED, NOT APPLIED, ITS PRE-APPLY TEST NOT RUN.** The owner ruled
S1 = B + C, M1 = (i) and Reviews = (b) on 2026-11-06. Step 0 round 2 (section 10) found no stop
condition. Built: migration 121, its down file and pre-apply test (sections 12-14), and the S1 code in
the vendor page, vendor route, guest route and agency delivery-review route (section 15). Nothing was
pushed, merged, applied or run against a database. A header line that says "NOT MERGED" or "NOT
APPLIED" is not updated when that changes: check `git merge-base` and the catalog.

Sections 1-9 are run 1 (from `main` at `6e66fca`, stopped at step 0). They are kept as written.
Section 3's "S1" and the `under_review` row there are corrected by section 10.

## 1. Outcome

The build stopped at step 0. Stop condition **S1** applies (`partner_rfp_responses.status` cannot be
classified from code). Two premise mismatches also need a ruling before code is written. Under the
standing rule "surface scope questions before writing code", I am reporting them rather than choosing
a reading myself.

- **M1 (V1, the summary design).** The brief says the agency's `ai_summary`, `ai_summary_generated_at`
  and `composite_score` live on `partner_rfp_responses`, and that a vendor revision clears them there.
  The code says otherwise:
  - Since 109/110 (applied 2026-10-09) those values live in `partner_rfp_response_private`, which has
    no vendor policy (109:330-345).
  - The four legacy columns on the bid row must stay NULL **for every caller**, service role included.
    110's guard enforces this: 110:194-226, trigger at 110:223.
  - There is no `ai_summary` column. The columns are `ai_summary_short`, `ai_summary_detailed`,
    `ai_summary_generated_at` (064:8-10) and `composite_score` (065:70).
  - The vendor route writes none of them. A revision marks the summary pending through the **service
    role** on the private table (`app/api/partner/rfps/[id]/response/route.ts:428-438`, calling
    `lib/bid-summary-generation.ts:171-181`).

  So the required design cannot be built as written. A BEFORE UPDATE trigger that clears the bid row's
  summary columns would do nothing. One that clears the private row from a vendor session needs
  SECURITY DEFINER, and the brief requires SECURITY INVOKER.
- **M2 (V2).** No vendor INSERT policy exists on `delivery_reviews`. The org-only check the brief
  describes was the WITH CHECK of the agency's FOR ALL policy before 114. 114:148-157 tightened it
  (applied 2026-10-12), and `docs/roadmap-state.md:149` records it as closed. What remains are
  tightenings of the agency's own policy. One of them, the "real engagement" requirement, would block
  a write the agency route makes on purpose (**S3**, section 7).

V1 is still real, just in a different shape from the brief's. A vendor's whole-row UPDATE policy
(079:1414-1416) lets it:
- repoint `lead_org_id` or `inbox_item_id`, which injects the bid into another agency's bids list;
- set `status = 'awarded'`;
- rewrite `agency_feedback`;
- set the agency's action timestamps.

Section 7 lists the options. None of this is built.

## 2. STEP 0 (a): policies, triggers, grants, as live after 120

### partner_rfp_responses

| Policy | Cmd | Live definition | Predicate |
|---|---|---|---|
| Agencies select RFP responses they own | SELECT | 079:1380-1382 | `lead_org_id IN current_user_org_ids()` |
| Agencies update response status and feedback | UPDATE | 079:1384-1387 | USING and WITH CHECK `lead_org_id IN current_user_org_ids()`; no column limit |
| Partners insert RFP responses for their inbox | INSERT | 079:1389-1404 | `vendor_org_id` mine AND an inbox row with that id and the same `lead_org_id` that is mine (by `vendor_org_id`, or by `recipient_email` = my profile email) |
| Partners read response status and feedback | SELECT | 079:1406-1408 | `vendor_org_id` mine |
| Partners select own RFP responses | SELECT | 079:1410-1412 | `vendor_org_id` mine |
| Partners update own RFP responses | UPDATE | 079:1414-1416 | USING `vendor_org_id` mine; **no WITH CHECK** (USING is reused, so the new row only has to keep `vendor_org_id` among the caller's organizations); **no column limit** |

- **DELETE: no policy for anyone.** 079 creates none, and no later migration adds one. Vendors cannot
  delete a response today, and neither can agencies. A vendor DELETE would therefore be new, and (a)
  does not show it is legitimate.
- **Triggers:** `partner_rfp_responses_private_columns_guard`, BEFORE INSERT OR UPDATE (110:223-226,
  function 110:194-218, EXECUTE revoked 110:228-230). It refuses (LG110) any non-NULL
  `composite_score`, `ai_summary_short`, `ai_summary_detailed` or `ai_summary_generated_at`, from every
  caller. No other trigger on this table is created by a migration on disk.
- **Grants:** no migration grants on this table by name. 114:193-195 revoked TRUNCATE, REFERENCES and
  TRIGGER from anon and authenticated on every public table. The remaining DML grants are Supabase
  defaults; anon has no policy, so it gets nothing. Section 6 of the 121 query records the live grants.

### delivery_reviews

| Policy | Cmd | Live definition | Predicate |
|---|---|---|---|
| Agencies manage own delivery reviews | ALL | 079:1202-1205; WITH CHECK replaced 114:148-157 | USING `org_id IN current_user_org_ids()`. WITH CHECK: same, AND the partnership's `lead_org_id = org_id`, AND the project's `org_id = org_id` |
| Partners view own complete delivery reviews | SELECT | 079:1207-1213 | `status = 'complete'` AND the partnership's `vendor_org_id` is mine |

- **No vendor INSERT, UPDATE or DELETE policy.**
  - A vendor-only member fails 114's WITH CHECK: its organization is never the partnership's
    `lead_org_id`.
  - A member of both sides can write only as the lead agency of that partnership. That is the agency
    direction.
  - 073, which would have added vendor sharing, was never applied and must not be.
- **Triggers:** `delivery_reviews_private_columns_guard`, BEFORE INSERT OR UPDATE (112:179-181). It
  keeps the six private columns NULL.
- **Grants:** as above (114:193-195 only).

## 3. STEP 0 (b): partner_rfp_responses columns, classified, with every writer

Writers found in code (all `.from("partner_rfp_responses")` insert/update/upsert calls):

- **VS:** vendor session, `app/api/partner/rfps/[id]/response/route.ts`. Update at :348, insert at
  :363. Session client at :132. Row at :311-331.
- **GS:** guest path on the **service role**, `app/api/rfp/guest/[token]/route.ts`. Update at :651,
  insert at :763. Service client at :153 and :529. This is the trusted path under 118's test.
- **AS:** agency session, `app/api/agency/rfp-responses/[id]/route.ts`. Patch at :809, built at
  :350-369. Link backfills at :479 (`inbox_item_id`) and :710 (`vendor_org_id`). Session client at
  :225.
- **TP:** trusted path, `lib/magic-token-attach.ts`. Repoint at :137 (`inbox_item_id`) and backfill at
  :217 (`vendor_org_id`, `inbox_item_id`). "Every caller passes the service role", :181.
- **Dead:** `lib/server/rfp-response-private.ts:179-184`, the legacy fallback, which runs only while
  109's table is missing.

| Column | Origin | Class | Writers |
|---|---|---|---|
| id | scripts/014:4 | system | default |
| inbox_item_id | 014:5, nullable 057:8 | link (agency/trusted) | VS insert only (policy-checked); GS insert NULL; AS :479; TP :137, :217 |
| vendor_org_id (was partner_id) | 014:6, 079:671 | link | VS insert (policy-checked); GS insert; AS :710; TP :217 |
| lead_org_id (was agency_id) | 014:7, 079:670 | link | VS insert (policy-checked against the inbox); GS insert |
| proposal_text, budget_proposal, timeline_proposal | 014:8-10 | **vendor bid content** | VS, GS |
| attachments | 015:6 | **vendor bid content** | VS, GS |
| partner_display_name | 014:14 | vendor (denormalized identity) | VS (from the caller's profile, :305-309), GS |
| status | 014:15, CHECK 019:6-8 | **SHARED: cannot be classified (S1)** | VS `draft`/`submitted`, unconditionally (:225, :319); GS `submitted`; AS `shortlisted`/`meeting_requested`/`awarded`/`declined`/`submitted` (:351) |
| created_at | 014:16 | system | default; TP never; nobody writes it |
| updated_at | 014:17 | both | VS, GS, AS |
| agency_feedback, feedback_updated_at | 018:4-5 | **agency-owned** | AS (:352, :355-356) |
| payment_terms | scripts/038:2 | vendor (legacy, superseded by terms_disclosure, 070) | GS only, if at all; read by vendor and agency |
| submitted_at | 058:6 | submission stamp (trusted) | GS (:643 on the bid; :662 and :775 are the token row); VS never writes it |
| business_criteria_responses | 060:19 | **vendor bid content** | VS, GS |
| ai_summary_short, ai_summary_detailed, ai_summary_generated_at | 064:8-10 | agency-owned, **must stay NULL** (110) | nobody; real home is `partner_rfp_response_private` |
| composite_score | 065:70 | agency-owned, **must stay NULL** (110) | nobody; real home is the private table |
| shortlisted_at, declined_at, meeting_requested_at | 069:8-10 | **agency-owned** | AS (:361-369) |
| terms_disclosure | 070:24 | **vendor bid content** | VS, GS |
| business_criteria_acknowledgments | 071:35 | **vendor bid content** | VS, GS |
| budget_lines | 072:67 | **vendor bid content** | VS, GS |
| proposal_sections | 076:38 | **vendor bid content** | VS (:254, :323); GS (being fixed in parallel to store it) |

**Where the summary is cleared on revision.** Every place writes the private table, never the bid row:

- `app/api/partner/rfps/[id]/response/route.ts:428-438`: vendor revision, service role, only when
  `wasUpdate` and `status === "submitted"`. A draft autosave does not clear it.
- `app/api/rfp/guest/[token]/route.ts:669-672`: guest edit, service role.
- `lib/bid-summary-generation.ts:171-181` (`markBidSummaryPending`), through
  `lib/server/rfp-response-private.ts:164-185`.

The agency writes summaries at `lib/bid-summary-generation.ts:111`, from
`app/api/agency/bids/[responseId]/generate-summary/route.ts`, under the agency session. It writes
scores at `app/api/agency/bids/[responseId]/evaluation/route.ts:381` and
`app/api/agency/bids/[responseId]/ai-score/route.ts:377`.

**Why `status` cannot be classified (S1).** The vendor route writes `draft` or `submitted` over whatever
the agency set. It refuses only the inbox closure statuses `closed` and `not_selected` (route.ts:190;
`lib/rfp-closure.ts:22`). The vendor UI invites revision while a bid is `shortlisted` or
`meeting_requested` (`app/partner/rfps/[id]/page.tsx:1322-1325`, copy at :1900). Its autosave posts
`status: "draft"` (page.tsx:1169).

So today:
- a vendor editing a shortlisted bid demotes it to `draft` within two seconds;
- a resubmission resets it to `submitted`.

The code cannot tell whether that is intended. Every possible guard rule either keeps it, refuses it
(breaking an advertised feature) or silently changes it. Rows R7 and R8 of the 121 query measure how
often it has happened.

## 4. STEP 0 (c): delivery_reviews

- **The one legitimate writer** is `app/api/agency/delivery-reviews/route.ts` (POST at :137; upsert at
  :218-224; update at :351-352), under the agency session after `requireAgency()` (:140). Before
  writing, it checks:
  - the project is in the caller's organizations (:167);
  - the partnership's `lead_org_id` is in the caller's organizations (:168);
  - any `response_id` it is given is a bid the caller's organizations lead (:181-189).

  It writes `project_id, partnership_id, org_id, assignment_id, status, on_time, on_budget,
  overall_satisfaction, updated_at`, and `response_id` when one is sent (:191-216). The private six go
  to `delivery_review_private` (:204-210, :230; `lib/server/delivery-review-private.ts:162`).
  **`assignment_id` may be NULL**: the route looks up `project_assignments` (:173-178) and writes
  `assignment?.id ?? null` (:195). A review with no assignment is allowed on purpose.
- **Vendors never write.** Their only access is reading complete reviews: `app/partner/projects/page.tsx:715`
  and `app/api/partner/dashboard/route.ts:483`.
- **What the live policy allows today.** INSERT or UPDATE by a member of the review's `org_id`, where
  that organization is the partnership's lead agency and owns the project (114:148-157). Direction is
  enforced: only the lead agency reviews its vendor.
- **What it does not check:**
  - that `response_id` is a bid of the same lead organization and of the partnership's vendor. The
    foreign key check bypasses row level security, so any existing response id is accepted;
  - that `assignment_id` is on the same project and partnership;
  - that there is any engagement (a `project_assignments` row, or an awarded bid).

  The first two are safe tightenings: they match what the route already does. The third is **S3**,
  because the route deliberately writes reviews without one.

## 5. STEP 0 (d): the read-only query

`supabase/sql-checks/121-vendor-write-inventory.sql` (commit `37194ca`) is one query with one result
set. It has no TEMP table, and it casts `tgenabled::text`. It returns:

- **Section 1:** L1 legacy score or summary values still on the bid row (expected 0), L2 private-table
  row counts, L3 bids with the summary pending.
- **Section 2, agency-owned values that look vendor-written:**
  - R1, R2: repointed `lead_org_id`, for portal and guest bids;
  - R3: `vendor_org_id` drift;
  - R4: `awarded` with no `project_assignments` row;
  - R5: feedback with no stamp;
  - R6: an agency status without its timestamp;
  - R7, R8: shortlists demoted or reset by a vendor save (S1);
  - R9: `under_review`, which no route writes;
  - RS: counts per status.
- **Section 3:** D1-D7, the `delivery_reviews` shape checks (direction, project, response and
  assignment consistency, reviews with no engagement).
- **Sections 4-6:** every policy on both tables (and on the private table), with USING and WITH CHECK,
  plus P0 the public total (expected 161); triggers; grants for anon, authenticated and service_role.

## 6. STEP 0 (e): other vendor write policies without column limits (inventory only)

These come from 079 and later, excluding 073 and 101, and were spot-checked at 079:1146, :1585 and
:1699. Each is a vendor INSERT or UPDATE policy with no guard trigger limiting columns:

1. `agency_partner_invitations`: "Partners can update received invitations", UPDATE, 079:1146. No
   WITH CHECK, so `lead_org_id` and `status` are rewritable.
2. `assignment_agreements`: "Partners update agreement signature fields", UPDATE, 079:1699. "Signature
   fields" is only the name; there is no column limit.
3. `onboarding_packages`: "Partner updates review fields on own packages", UPDATE, 079:1296. Same: no
   column limit.
4. `project_assignments`: `assignments_partner_update`, UPDATE, 079:1585. The vendor can rewrite its
   own assignment row, including award fields.
5. `partner_status_updates`: INSERT at 079:1431 (nothing ties `project_id`) and UPDATE at 079:1443 (no
   WITH CHECK).
6. `partner_rfp_response_versions`: "Partners insert own response versions", INSERT, 079:1371. Nothing
   ties `lead_org_id` or the parent response.
7. `invitation_requests`: "Partners can create requests", INSERT, 079:1230.
8. `partner_access_requests`: "Partners can create requests", INSERT, 079:1325.
9. `milestone_events`: INSERT, 100:404. Identity, type and pin columns are pinned by the policy; the
   other columns are free. It is insert-only.
10. `project_documents` and `project_messages`: the self-row UPDATE policies "Uploaders can update
    their documents" and "Senders can update their messages" (`docs/schema-snapshot-2026-08-13.md`
    :237 and :246). 079 never dropped them; they have no WITH CHECK and no trigger. A vendor can
    repoint its own row to any `project_id`, which undoes 083's insert scoping (083:213, :265).

These are column-limited and need nothing: `partnerships` (087/093 identity guard at 093:666-684, 102:359,
114:280) and `partner_rfp_inbox` (118:756 allow-list, trigger 118:835; 120:450).

These are self-row policies held by any authenticated user. They are recorded, not vendor-specific:

| Table | Policy and command | Source | Guard |
|---|---|---|---|
| profiles | UPDATE own row | snapshot :207 | 090, 091 and 113 guard the authority columns |
| notifications | INSERT, scoped | 096:378 | whole row |
| notifications | UPDATE own row | snapshot :94 | none |
| brief_interpretations | ALL | 054:18 | none |
| email_connections | ALL | 062:35 | none |
| partnership_profile_context | INSERT, UPDATE | snapshot :174, :176 | none |

## 7. Decisions needed, with options

### S1: `partner_rfp_responses.status` (blocks V1)

- **A. Refuse.** A vendor may set `status` only to `draft` or `submitted`, and only while the stored
  status is NULL, `draft` or `submitted`. Anything else is 42501. This is the closest to 118, but it
  breaks revising a shortlisted or meeting-requested bid, which `page.tsx:1900` advertises. The vendor
  page would have to stop offering it, and that page is not on the do-not-edit list.
- **B. Preserve (recommended).** A vendor may set only `draft` or `submitted`. If the stored status is
  an agency status (`under_review`, `shortlisted`, `meeting_requested`), the trigger keeps the stored
  status and still accepts the content change. Revisions keep working, the autosave demotion stops,
  and the agency's decision survives. It is a silent rewrite of one column, which 118 never does, so it
  needs an explicit ruling.
- **C. Lock.** As in B, and the trigger also refuses every vendor write once the status is `awarded` or
  `declined`. The vendor UI already disables editing in those states (`page.tsx:1322-1325`).

B and C can be combined. Every option refuses a vendor setting `awarded`, `declined`, `shortlisted`,
`meeting_requested` or `under_review` itself.

### M1: where the "revision clears the summary" rule lives

- **i. Keep the app path (recommended).**
  - The vendor and guest routes keep calling `markBidSummaryPending` on the service role.
  - 121's guard simply refuses the agency-owned columns.
  - 110 already keeps the four legacy columns NULL.
  - All functions stay SECURITY INVOKER.
  - Weakness: if `SUPABASE_SERVICE_ROLE_KEY` is missing, the old summary stays. route.ts:430-434 logs
    it.
- **ii. Move it into the database.** An AFTER UPDATE trigger on `partner_rfp_responses`, SECURITY
  DEFINER, search_path pinned, EXECUTE revoked from PUBLIC, anon and authenticated. It nulls the three
  summary fields of the private row whenever a caller who is not a lead-organization member changes
  vendor-owned content. Both callers fire it: a vendor session, and the trusted guest path.
  - The vendor route then drops :428-438.
  - The guest route's :669-672 becomes redundant, but that file is on the do-not-edit list, so I would
    report it as a finding rather than edit it.
  - This needs the owner to allow one SECURITY DEFINER function.
  - It is also a behaviour choice: with the 2-second draft autosave, should a **draft** save clear the
    summary? Today only a submitted revision does.

### M2 and S3: delivery_reviews

- **a. Leave the policy as 114 made it.** No vendor policy exists. Record V2 as closed on 2026-10-12.
- **b. Tighten the agency WITH CHECK (recommended).** Add to it: `response_id` NULL, or a bid whose
  `lead_org_id = org_id` and whose `vendor_org_id` is the partnership's vendor; and `assignment_id`
  NULL, or an assignment on the same project and partnership. The route already guarantees both, so
  no legitimate write is blocked. Run D4-D6 first; they must be 0.
- **c. Also require an engagement**: a `project_assignments` row for (project, partnership), or an
  awarded bid. This blocks the route's deliberate no-assignment path (route.ts:173-195). It needs a
  ruling on who may be reviewed, and D7 shows how many existing reviews would fail.

### The allow-list I would build once S1 is ruled (for approval, not built)

The guard would be deny-by-default for a caller who is neither on 118's trusted path
(`auth.uid() IS NULL AND current_user NOT IN ('anon','authenticated')`) nor a member of the row's lead
organization before and after the write.

- **UPDATE.** Compare `to_jsonb(OLD)` and `to_jsonb(NEW)` minus the allow-list; any other difference is
  42501. Allowed:
  - `proposal_text`, `budget_proposal`, `timeline_proposal`;
  - `attachments`, `payment_terms`, `terms_disclosure`;
  - `business_criteria_responses`, `business_criteria_acknowledgments`;
  - `budget_lines`, `proposal_sections`;
  - `partner_display_name`, `updated_at`;
  - `status`, under the S1 rule.
- **INSERT.** The same columns, plus `inbox_item_id`, `vendor_org_id` and `lead_org_id`, which the
  INSERT policy already ties to the caller's inbox row. Everything else must equal its default (NULL,
  or the column default):
  - `agency_feedback`, `feedback_updated_at`;
  - `shortlisted_at`, `declined_at`, `meeting_requested_at`;
  - `submitted_at`, `created_at`;
  - the four 110 columns.
- **Never changeable by a vendor:** `lead_org_id`, `inbox_item_id`, `vendor_org_id`, `submitted_at`,
  `created_at`.
- **Effect on existing writers.**
  - Unaffected: VS today (it writes only allow-listed columns), GS and TP (trusted path), and AS
    (lead-organization member).
  - **Assumption:** `submitted_at` is not vendor-writable. The vendor route never sets it, so it stays
    whatever it was, which is today's behaviour.

## 8. Security review list (file:line)

1. `supabase/migrations/079_organizations.sql:1414-1416`: vendor whole-row UPDATE on
   `partner_rfp_responses`, with no WITH CHECK beyond `vendor_org_id`. A vendor can repoint
   `lead_org_id` or `inbox_item_id`, set `status`, `agency_feedback` and the 069 timestamps. **Open in
   production.**
2. `supabase/migrations/079_organizations.sql:1389-1404`: vendor INSERT. It ties the link columns, but
   any `status` (including `awarded`), feedback or timestamp can be inserted.
3. `app/partner/rfps/[id]/page.tsx:1169` with `app/api/partner/rfps/[id]/response/route.ts:225,319`:
   the autosave demotes an agency-advanced bid to `draft`. This is a functional defect independent of
   the guard (S1).
4. `app/api/partner/rfps/[id]/response/route.ts:428-438`: the summary is cleared only on a submitted
   revision, and only if the service-role key is configured.
5. `supabase/migrations/114_hardening.sql:148-157`: the `delivery_reviews` WITH CHECK does not tie
   `response_id` or `assignment_id`. A foreign key check bypasses row level security.
6. `app/api/rfp/guest/[token]/route.ts:642`: a guest edit also writes `status: "submitted"` over an
   agency status. It runs on the trusted path, so no vendor-session guard touches it. Under S1 option
   B or C the same rule should apply to guests. The guest route is on the do-not-edit list, so this is
   reported as a finding. Minor: :646-647 spreads `proposal_sections` twice, which is harmless.
7. `lib/server/rfp-response-private.ts:179-184`: the dead legacy fallback still writes the bid row. It
   is owed for removal (`docs/109-112-split-report.md`).
8. Section 6, items 1-10: the other whole-row vendor write policies.

## 9. Refused, assumptions, stopped on

- **Stopped on:**
  - **S1:** `partner_rfp_responses.status`.
  - **S3:** whether a delivery review requires an engagement.
  - **Premise mismatches M1 and M2,** surfaced under the scope-question rule.
- **Not done**, because the stop means a report only:
  - migration 121, its down file and pre-apply test;
  - the code change to the vendor route;
  - docs part P;
  - the state-of-record, roadmap and LIGAMENT_CONTEXT updates;
  - renumbering the feeder.

  The next free migration number is still **121**, and `docs/budget-actuals-feeder-plan.md` still
  says "121 or later". Both stay correct until 121 is authored.
- **Assumptions:**
  - The live policies are the ones the migrations on disk create. The query's section 4 confirms this.
  - The column list is complete from the repository. A column added out of band would be refused for
    vendors by a deny-by-default guard anyway.
- **Refused:** none.

---

# Run 2 (2026-11-06): owner rulings, step 0 round 2, build

**Owner rulings, 2026-11-06.**
- **S1 = B + C.** A vendor's edit never changes a status the agency set. From draft or submitted, the
  vendor moves only between those two. From an agency-set changes-requested status, a resubmission moves
  the bid to submitted. From shortlisted, meeting_requested or another agency-set in-progress status,
  the content edit is accepted and the status is kept. Once a bid is final, vendor updates are refused.
  A vendor never sets an agency-set or final status.
- **M1 = (i).** The service-role summary-pending path stays in both routes; no SECURITY DEFINER.
- **Reviews = (b).** Section 7's (b); no engagement requirement.

**What the code was read at.** The branch head `84fa064` is behind `main` (`49b38a6`: F7, F8 and CV1). I
attempted `git merge main` into the feature branch, and the session's permissions refused it, so the
branch was not synced (assumption A1, section 17). Files `main` did not change were read on the branch.
`app/api/rfp/guest/[token]/route.ts` and `lib/guest-bid-row.ts` were read on `main` with `git show` and
`git grep`. Lines marked "(main)" are `49b38a6`; unmarked lines are the branch before this run's edits.

## 10. Step 0 round 2 (read only)

### (a) The status vocabulary, every writer, every transition

**Vocabulary: seven values.** `partner_rfp_responses_status_check` is `submitted, under_review,
shortlisted, meeting_requested, awarded, declined, draft` (`scripts/019-bid-status-meeting-requested.sql:6-8`).
The column is `NOT NULL DEFAULT 'draft'` (`scripts/014-partner-rfp-responses.sql:15`). No migration from
071 to 120 touches the constraint (grep for `partner_rfp_responses_status_check` and `ALTER TABLE ...
partner_rfp_responses`).

`lib/bid-status.ts:1-17` lists more values, but they are not response values:
- `new`, `viewed`, `bid_submitted`, `feedback_received` and `revision_submitted` belong to
  `partner_rfp_inbox` (`scripts/019:16-26`);
- `closed` and `not_selected` are inbox-only (`lib/bid-status.ts:14-17`, 099).

**`under_review` is the agency's "Changes Requested".** The vendor's label is "Changes Requested"
(`lib/bid-status.ts:48-49`, `lib/bid-shared.ts:108` and `:126`, `components/partner-rfp-surface.tsx:77`
and `:91`). The agency's label is "Under Review" (`lib/bid-status.ts:75-76`). **This corrects run 1:** R9's
note "no route writes under_review" (`supabase/sql-checks/121-vendor-write-inventory.sql:30`, `:136`) is
wrong. The agency PATCH accepts it, and the agency UI sends it (below).

| Writer | Where | Status it writes |
|---|---|---|
| Vendor page | `app/partner/rfps/[id]/page.tsx:934` `save(status)`; payload `:1055` `status`; autosave `:1169` `save("draft")`; buttons `:2498`, `:2619` draft and `:2516`, `:2631` submitted; local state after a submit `:1133-1134` sets `submitted` | `draft` (autosave and Save draft), `submitted` |
| Vendor route | `app/api/partner/rfps/[id]/response/route.ts:225` (absent or anything else becomes `draft`); row `:319`; update `:348`, insert `:363`; refuses only inbox closure statuses `:190`; on a submit, inbox `bid_submitted` `:380-384` | `draft` or `submitted`, over whatever is stored |
| Guest route (service role) | edit `app/api/rfp/guest/[token]/route.ts:650` (main), through `lib/guest-bid-row.ts:49` (main) `status: "submitted"`; first submit `:756` (main). Branch copy: `:642`, `:757` | `submitted`, over whatever is stored |
| Agency route | `app/api/agency/rfp-responses/[id]/route.ts:218` `ALLOWED_STATUS` (submitted, under_review, shortlisted, meeting_requested, awarded, declined); `:276-283` feedback on a submitted bid moves it to `under_review`; `:287-289` awarded cannot move; patch `:350-356`; 069 stamps `:361-369`; write `:809` | any of the six; never out of awarded |
| Agency UI | `components/bid-detail-sheet.tsx:331` meeting_requested to and from under_review; `:359` shortlisted to and from under_review; `:391` declined; `:402` "Undo decline" to submitted; `:812` under_review when feedback is sent on a submitted bid; `:934` awarded. `components/bid-compare-view.tsx:382` shortlisted to and from under_review; `:392` declined; `:789` awarded | through the agency route |
| Trusted path | `lib/magic-token-attach.ts:137`, `:217`; agency backfills `app/api/agency/rfp-responses/[id]/route.ts:479`, `:710` | none (link columns only) |

**Transitions.**
- The vendor goes draft to submitted, and submitted to draft (an explicit Save draft, or the autosave).
- The guest always goes to submitted.
- The agency moves among submitted, under_review, shortlisted, meeting_requested, awarded and declined.
  Awarded is terminal (`:287`). Declined is reopened by "Undo decline" (`bid-detail-sheet.tsx:402`).
- Un-shortlisting, and un-requesting a meeting, both land on under_review (`:359`, `:331`, `bid-compare-view.tsx:382`).

**Placement in the S1 groups.** Every value is placed, so stop condition **S1' does not apply**.

| S1 group | Statuses |
|---|---|
| Vendor cycle | draft, submitted |
| Agency asked for changes | under_review |
| Agency in progress | shortlisted, meeting_requested |
| Final | awarded, declined |

Declined is final for the vendor. The agency's "Undo decline" returns it to submitted, in the vendor's
cycle. A status outside the seven cannot be stored, and 121's pre-flight refuses to run if the
constraint ever names another.

### (b) The vendor-owned allow-list against the current code

- **Vendor route row** (`route.ts:311-324`): `proposal_text, budget_proposal, timeline_proposal,
  terms_disclosure, attachments, business_criteria_responses, partner_display_name, status, updated_at`,
  plus `business_criteria_acknowledgments`, `budget_lines` and `proposal_sections` when sent.
  - Its insert adds `inbox_item_id`, `vendor_org_id` and `lead_org_id` (`:326-331`), which 079's INSERT
    policy ties to the caller's inbox row (079:1389-1404).
- **Guest route on main**: `lib/guest-bid-row.ts:41-55` (main) builds the same content keys plus `status`
  and `updated_at`. The F8 fix (`7426b47`) adds `proposal_sections` to the first submit.
  - The edit adds `submitted_at` (`route.ts:651`, main).
  - The insert adds `lead_org_id`, `vendor_org_id`, `inbox_item_id: null` and `partner_display_name`
    (`:749-756`, main).
  - It writes on the service role, the trusted path. `lib/guest-bid-row.ts:15-21` (main) names
    agency-owned columns the builder never writes.
- **`payment_terms`**: no writer in the code today; it is read only (`lib/bid-analysis-context.ts:55`,
  `app/api/agency/payment-synthesis/route.ts:117`, guest GET `:276`). It stays on the list as the
  vendor's own legacy content (assumption A4).

**Result: section 3's list holds unchanged.** It is in section 13.

### (c) Every place a vendor or guest path sends status, and what S1 says it should send

| Place | Today | Under S1 (built, section 15) |
|---|---|---|
| Vendor page autosave, `page.tsx:1169` | `status: "draft"`: a shortlisted bid is demoted within 2 s | **no status**: content only, status kept |
| Vendor page Save draft, `:2498`, `:2619` | `draft` | `draft`. The route keeps an agency status; a submitted bid may go back to draft (the vendor's own cycle) |
| Vendor page Submit, `:2516`, `:2631` | `submitted` | `submitted`. The route moves draft, submitted and under_review to submitted, keeps shortlisted and meeting_requested, and refuses awarded and declined |
| Vendor page local state, `:1133-1134` | assumes `submitted` | shows the status the server saved |
| Vendor route, `route.ts:225`, `:319` | writes the request over the stored status | decides against the stored status (`lib/vendor-bid-status.ts`) |
| Vendor route inbox update, `:380-384` | `bid_submitted` on every submit | only when the bid is now submitted; otherwise the inbox keeps the agency's status |
| Guest edit, `route.ts:650` (main) | `submitted` | `submitted` from draft, submitted or under_review; the agency's status kept from shortlisted or meeting_requested; 409 from awarded or declined |
| Guest first submit, `:756` (main) | `submitted` | `submitted` (a new row; allowed) |

**Stop conditions: none.** S1' does not apply: every status is placed. S2 does not apply: no legitimate
writer is blocked. The only blockable writers are the vendor and guest routes, which are not on the
do-not-edit list and were changed.

## 11. The status rule as built, per transition

The vendor-session guard (migration 121) and `lib/vendor-bid-status.ts` (vendor and guest routes)
apply the same rule. "Request" is the status the vendor sends; "none" is a save with no status.

| Stored | Request none | Request draft | Request submitted | Request any other status |
|---|---|---|---|---|
| (no row, insert) | draft | draft | submitted | **refused** (42501 in the database) |
| draft | draft | draft | submitted | **refused** |
| submitted | submitted | draft | submitted | **refused** |
| under_review | under_review (kept) | under_review (kept) | **submitted** | **refused** |
| shortlisted | shortlisted (kept) | shortlisted (kept) | shortlisted (kept) | **refused** |
| meeting_requested | meeting_requested (kept) | meeting_requested (kept) | meeting_requested (kept) | **refused** |
| awarded, declined, anything else | **refused** | **refused** | **refused** | **refused** |

Where the rule keeps the status, the database guard writes `OLD.status` back and does not raise. In the
app this is "a request the vendor cannot make". A refusal in the app is 409 `{"error": "This bid has been
awarded, so it can no longer be edited.", "code": "bid_final"}` (or "declined"). In the database it is
42501 "This bid is awarded, so it can no longer be edited.". Agency, service-role and trusted-path
writes are not touched.

## 12. Migration 121

| File | Lines |
|---|---|
| `supabase/migrations/121_vendor_write_guards.sql` | `BEGIN;` line 150; `-- >>> 121 BODY START` line 151; `-- <<< 121 BODY END` line 502; **`COMMIT;` line 503**, the only `COMMIT;` line |
| `supabase/migrations/121_preapply_test.sql` | `-- >>> 121 BODY START` line 568; `-- <<< 121 BODY END` line 919 |
| `supabase/migrations/121_vendor_write_guards_down.sql` | `BEGIN;` line 26; `COMMIT;` line 68 |

The two marked bodies are byte-identical. `cmp` from the START markers reports the first difference at
byte 21290 (line 353), one byte past the END marker's newline. No TEMP table.

- **Pre-flight LG121**, fail-closed inside the transaction. It requires:
  - the trusted path;
  - 120 applied (`rfp_vendor_copy_keys()` and both vendor-copy guards, enabled);
  - `current_user_org_ids()`;
  - 161 public policies;
  - exactly 079's six policies on `partner_rfp_responses`, with the vendor UPDATE policy still having no
    WITH CHECK, and exactly two on `delivery_reviews`, carrying 114's check;
  - no trigger on `partner_rfp_responses` other than 110's (and 121's own, on a re-run);
  - exactly the 28 classified columns;
  - the status constraint naming exactly the seven values;
  - the review-check columns present;
  - no existing review that already breaks the new check (inventory D4-D6, listed if any).

  Any unexpected policy, trigger or column aborts the run.
- **Function** `public.partner_rfp_responses_vendor_write_guard()`: SECURITY INVOKER, `SET search_path =
  public, pg_temp`, EXECUTE revoked from PUBLIC, anon and authenticated. Its trigger is BEFORE INSERT OR
  UPDATE FOR EACH ROW (tgtype 23).
- **Review policy:** one `ALTER POLICY ... WITH CHECK` on "Agencies manage own delivery reviews". USING is
  untouched.
- **Policy count: 161 before, 161 after.** No policy is created or dropped; the post-check aborts if the
  count moves. No grant changes, apart from the new function's own REVOKEs.
- **Idempotent:** a re-run says "121 already applied".
- **Down:** drops the trigger and the function, and restores 114:148-157's WITH CHECK verbatim.

## 13. The final allow-list (vendor sessions)

- **May change** (UPDATE) or set (INSERT):
  - `proposal_text`, `budget_proposal`, `timeline_proposal`;
  - `attachments`, `payment_terms`, `terms_disclosure`;
  - `business_criteria_responses`, `business_criteria_acknowledgments`;
  - `budget_lines`, `proposal_sections`;
  - `partner_display_name`, `updated_at`;
  - `status` (section 11).
- **Set on INSERT only, never changed by a vendor:** `id`, `inbox_item_id`, `vendor_org_id`,
  `lead_org_id`. The 079 INSERT policy ties the last three to the caller's inbox row.
- **Fixed once inserted, and NULL or default on a vendor insert:** `submitted_at` (NULL), `created_at`
  (must equal the default, `now()`).
- **Agency-owned, NULL on a vendor insert, never changed by a vendor:** `agency_feedback`,
  `feedback_updated_at`, `shortlisted_at`, `declined_at`, `meeting_requested_at`.
- **NULL for everyone (110):** `ai_summary_short`, `ai_summary_detailed`, `ai_summary_generated_at`,
  `composite_score`.
- **Any column added later** is refused for vendors: deny by default.

## 14. The review rule (ruling b) and the pre-apply test

**WITH CHECK of "Agencies manage own delivery reviews"** (INSERT and UPDATE). It keeps 114 and adds two
conditions:
1. (114) `org_id` is one of the caller's organizations.
2. (114) The partnership's `lead_org_id = org_id`.
3. (114) The project's `org_id = org_id`.
4. (new) `response_id` is NULL, or a bid with `lead_org_id = org_id` and `vendor_org_id` equal to the
   partnership's `vendor_org_id`. A guest bid that has no vendor yet does not qualify.
5. (new) `assignment_id` is NULL, or a `project_assignments` row with the same `project_id` and
   `partnership_id`.

There is no engagement requirement.
- The agency route already sends only the awarded bid of that vendor (`awardedResponseId` comes from
  `responsesForAssignment`, `app/api/agency/active-engagements/route.ts:63-78`, which requires
  `vendor_org_id === partnerId`).
- It also sends only the (project, partnership) assignment (`app/api/agency/delivery-reviews/route.ts:173-178`).

So no legitimate write is blocked. The route now also drops a mismatched bid to NULL (section 15).

**Pre-apply test** (`121_preapply_test.sql`, not run).
- **Shape:** phases BEFORE and AFTER, with an isolation fingerprint (every bid and review row; the
  inbox, assignment and project ids) after each scenario.
- **Subjects** are chosen through `partnerships.vendor_org_id`, and `tgenabled` is cast to text.
- **Expected count: 68 assertions** = 60 scenarios + 7 self-checks + M.
- **INCONCLUSIVE by design: none.** A missing subject reads NO SUBJECT and "DO NOT APPLY 121 YET."
- **NOT DISCRIMINATING by design** (25 rows, same expectation in both phases): B1-B4, B6, B9, I1, I2, I9,
  A1-A6, G1, G2, N1-N4, R1, R2, R9, R10.

**Discriminating scenarios** (35). Each is accepted before 121 and has a different answer after:
| Group | Scenarios | After 121 |
|---|---|---|
| Kept status | B5, B7, B8 (shortlisted, meeting_requested), B10 (under_review) | the status is kept, not demoted |
| Status sets | T1-T6 | refused |
| Link columns and stamps | L1-L5 | refused |
| Agency-owned columns | F1-F5 | refused |
| Final bids | Z1-Z3 | refused |
| Inserts | I3-I8 | refused |
| Reviews | R3-R8 | refused |

**Self-checks** (S1-S7):
- S1: the public policy count is 161 before and after.
- S2: no other policy changed.
- S3: the review policy keeps ALL, its roles and its USING, and its check names the new conditions.
- S4: no grant changed outside the new function.
- S5: the function is invoker and pinned, and anon, authenticated and PUBLIC cannot execute it.
- S6: the trigger is enabled with tgtype 23, and every other trigger on both tables is unchanged.
- S7: the migration writes no bid or review row.

## 15. Code changes (file:line, after this run)

- `lib/vendor-bid-status.ts` (new): `resolveVendorBidStatus(current, requested)` is the S1 table above;
  `finalBidMessage()` gives the copy. `lib/vendor-bid-status.test.ts` (new) has **34 assertions,
  passing** (`npx tsx lib/vendor-bid-status.test.ts`).
- `app/api/partner/rfps/[id]/response/route.ts`:
  - `:230-232` the request: absent means "content only";
  - `:332-352` reads the stored status, refuses a final bid with 409 `bid_final` (`:349`), and writes
    the S1 status (`:351-352`, `:358`, `:371`);
  - `:404` the inbox goes to `bid_submitted` only when the bid is now submitted;
  - `:643` logs `savedStatus`.
  - A resubmission still writes the version row, marks the summary pending through the service role
    (M1 (i), unchanged) and notifies the agency, whatever status is kept.
- `app/partner/rfps/[id]/page.tsx`:
  - `:934-937` `save()` takes `keepStatus`;
  - `:1060` the payload omits `status` when it is set;
  - `:1177` the autosave sets it;
  - `:1140-1142` after a submit the page shows the saved status, and updates the inbox to
    `bid_submitted` only when the bid is submitted.
- `app/api/rfp/guest/[token]/route.ts`:
  - `:3` the import;
  - `:568-589` reads the bid's status on an edit and refuses awarded or declined with 409 `bid_final`;
  - `:676` writes the S1 status (`{ ...editRow, status: guestEditStatus }`).
  - These edits sit outside the lines `main`'s F8 changed (the import block at `:17`, and the edit row
    at `:633-649`), so a merge is expected to be clean. **Not verified:** `git merge-tree` was refused by
    the session's permissions.
- `app/api/agency/delivery-reviews/route.ts`:
  - `:168` the partnership read takes `vendor_org_id`;
  - `:180-195` a `response_id` is kept only when it is the partnership vendor's bid, as an unowned bid
    always was.

**Gates.**
- `npx tsc --noEmit`: exit 0.
- `pnpm lint` (JSON, filtered to touched files): 0 new findings. Pre-existing, on lines this run did not
  change: page.tsx 3 errors at `:646`, `:774`, `:812` (`react-hooks/set-state-in-effect`), and a warning
  at response route `:361` (the unused `eslint-disable` above `let saved: any`).
- No migration numbered 120 or below, no `supabase/data-fixes` file and no do-not-edit file was edited.

## 16. Security review list (file:line)

1. `supabase/migrations/121_vendor_write_guards.sql:324-431`, the guard.
   - The vendor-session test (`:342`, `:347-350`) is 118's.
   - The INSERT checks are at `:353-374`.
   - The final-status refusal is at `:377-381`, the status-set refusal at `:384-388`, and the
     deny-by-default diff at `:391-401`.
   - The S1 keep is at `:404-410`.
   - Review: a member of both the vendor and the lead organization is treated as the agency (118's rule).
2. `121_vendor_write_guards.sql:439-459`, the review WITH CHECK. It runs under the caller's RLS, so the
   agency must be able to read the bid, partnership and assignment, which it can (114's note).
3. `121_vendor_write_guards.sql:155-318`, the pre-flight. It is fail-closed on the policy count, the
   exact policies, triggers, columns and status vocabulary, and existing reviews.
4. `app/api/rfp/guest/[token]/route.ts:568-589`, `:676`. The guest path is the service role, so S1 is
   enforced **only in code** there. A future service-role writer of `partner_rfp_responses.status` must
   use `lib/vendor-bid-status.ts`.
5. `app/api/partner/rfps/[id]/response/route.ts:332-352`. The read-then-write is not atomic; the guard
   is the backstop (it re-applies S1 on the stored row at write time).
6. `app/api/partner/rfps/[id]/response/route.ts:404`. The inbox status is no longer reset on a
   resubmission of a shortlisted or meeting-requested bid.
7. `app/partner/rfps/[id]/page.tsx:1060`, `:1177`. The autosave sends no status.
8. `app/api/agency/delivery-reviews/route.ts:180-195`, the bid-vendor match (ruling b in code).
9. Still open (section 6, items 1-10): the other whole-row vendor write policies. 121 does not touch them.

## 17. Refused, assumptions, stopped on, findings

- **Stopped on:** nothing.
- **Refused:** none by me. The session's permissions refused `git merge main` and `git merge-tree`
  (A1), and pipes into `sed` or `md5` (so the byte check used `grep -b` and `cmp`).
- **Assumptions.**
  - **A1.** The branch was not synced with `main` 49b38a6. My edits to the guest route avoid the lines
    F8 changed, and `{ ...editRow, status: guestEditStatus }` overrides `buildGuestBidContent`'s
    `status: "submitted"` after a merge. Merge `main` into this branch, then re-run `tsc`, before review.
  - **A2.** Live policies, triggers and columns are as on disk. The pre-flight refuses otherwise.
  - **A3.** `created_at`'s default is `now()` (`scripts/014:16`). A vendor insert that sends any other
    value is refused.
  - **A4.** `payment_terms` stays vendor content (no writer today).
  - **A5.** `status_at_submission` on the version row still records the vendor's act ("submitted"),
    not the kept status.
- **Findings for the owner.**
  - **G1.** Un-shortlisting (`bid-detail-sheet.tsx:359`, `bid-compare-view.tsx:382`) and un-requesting
    a meeting (`:331`) move a bid to `under_review`, which the vendor reads as "Changes Requested"
    (`lib/bid-status.ts:49`). Under S1, the vendor's next resubmission of such a bid moves it to
    submitted. That is the ruling as written, but the label may not be what the agency meant.
  - **G2.** The agency's "Undo decline" (`bid-detail-sheet.tsx:402`) re-opens a declined bid for vendor
    edits.
  - **G3.** The inventory query's R9 note "no route writes under_review" is wrong (section 10 a). The
    query is read-only and not re-issued.
  - **G4.** The guest page shows the 409 message as its submit error (`app/rfp/respond/[token]/page.tsx:661`).
    The vendor page already hides the editor for awarded and declined bids (`page.tsx:1330-1334`).

## 18. What to run (owner)

1. Merge `main` into this branch (A1), then run `npx tsc --noEmit`.
2. Deploy the code (it works before and after 121).
3. Run `supabase/sql-checks/121-vendor-write-inventory.sql`; D4-D6 must be 0.
4. Run 121's P1 to P3, then the pre-apply test: its first line must read "SAFE TO APPLY 121.", with 68
   assertions.
5. Do the dry run, then the real run, then V1 to V4.
6. Then run `docs/rfp-record-test-script.md` part P.
