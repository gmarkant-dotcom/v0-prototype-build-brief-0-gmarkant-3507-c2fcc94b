# 121 vendor write guards: STEP 0 report. STOPPED BEFORE BUILD.

Branch `feat/121-vendor-write-guards`, from `main` at `6e66fca`. Authored 2026-11-06, unattended run.
**No migration 121 was written. Nothing was pushed, merged, applied or run against a database.**
The only other file this run adds is the read-only query
`supabase/sql-checks/121-vendor-write-inventory.sql` (step 0 d).

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
