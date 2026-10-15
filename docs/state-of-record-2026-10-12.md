# CURRENT STATE, 2026-10-12 (read this instead of every banner below)

> **UPDATED 2026-10-15 (feat/rfp-record-c). 120 IS AUTHORED, NOT APPLIED; its pre-apply test has not
> been run.** Step C code and `120_rfp_vendor_copy_scrub.sql` (the vendor copy scrub and its guard; down
> file; pre-apply test, 29 assertions, none INCONCLUSIVE by design; COMMIT at line 540) are on
> `feat/rfp-record-c`, with the read-only `supabase/sql-checks/120-key-inventory.sql`. Order: deploy the
> step C code, run the key inventory, then 120's pre-apply test, dry run, apply. **Next free migration
> number: 120 until it is applied, then 121.** Report: `docs/rfp-record-c-report.md` (findings F1-F8 for
> the owner).

> **UPDATED 2026-10-14 (owner; recorded 2026-10-15 on feat/rfp-record-c). MIGRATIONS 071-119 ARE
> APPLIED AND VERIFIED. NEXT FREE MIGRATION NUMBER: 120.** This supersedes "119 ... NOT applied" and
> "next free 119" in the banner below.
> **119 applied 2026-10-14:** pre-apply test 33/33 PASS; dry run and rollback proven. Post-apply
> verified: 44 `rfp_records` (43 backfilled: wizard 23, Lightning 20; plus smoke-test record
> `21f9d17d`), 112 lines; inbox rows linked 97 of 98; tokens linked 21 of 21 (`attached_inbox_id` set
> on 6); 0 backfilled records missing `broadcast_at` or showing the client; 5 unverified single-copy
> records; 0 rows releasing a client name; `rfp_record_set_client_visibility` SECURITY INVOKER with
> `search_path=public, pg_temp`, anon no, authenticated yes; 161 public policies unchanged.
> **Toggle verified in the browser** on record `21f9d17d` in both directions: ON wrote the record, 1
> inbox row and 1 token; OFF cleared all three; the snapshot keeps the name.
> **The one row 119 refused**, inbox `04391718-bf70-4d63-a0d6-ea773003b6cc` (closed, 2026-08-18), was
> refused because **its token row no longer exists at all**, NOT because the token belongs to another
> organization. It stays unlinked; agency readers use the inbox copy fallback for it.
> **Owner ruling S-A (2026-10-14):** the AI bid summary is no longer generated when a vendor or guest
> submits a bid. The bid saves with its summary pending; the summary is generated through the agency
> route `app/api/agency/bids/[responseId]/generate-summary/route.ts` the first time the agency needs
> it, and the agency bids page starts generating pending summaries in the background on load. Reason:
> the vendor session cannot and must not read `rfp_records` (D1); a vendor-callable function or a
> service-role read on a vendor-triggered path were both rejected.
> **Next:** RFP record step C and migration 120 (the vendor copy scrub), on `feat/rfp-record-c`.

> **UPDATED 2026-10-14 (feat/rfp-record-b). 118 IS APPLIED AND CATALOG-VERIFIED (2026-10-14). F1 IS
> CLOSED IN PRODUCTION.** This supersedes "PENDING APPLY" and "F1 stays OPEN" in the banner below.
> 118 pre-apply test: 96 PASS, 0 FAIL, 1 INCONCLUSIVE by design (C3: no user outside the lead
> agency belongs to two organizations). Catalog after apply: 161 public policies; RLS on
> `rfp_records` and `rfp_record_lines`, 3 policies each (authenticated SELECT, INSERT, UPDATE); four
> guards enabled (`rfp_records_guard`, `rfp_record_lines_guard`, `partner_rfp_inbox_link_columns_guard`
> with the F1 vendor deny-by-default rule, `rfp_magic_tokens_link_columns_guard`); 97 inbox rows, none
> linked. Smoke test 2026-10-14: a Lightning send wrote record `21f9d17d-6b6c-471c-8cfb-931d631b6ca4`
> (source magic_link, client hidden, broadcast_at set), 1 line, its token linked and attached.
> **119 (`119_rfp_records_backfill.sql`: the backfill and `rfp_record_set_client_visibility`) is
> authored on `feat/rfp-record-b`, NOT applied**; its pre-apply test (33 assertions; U1 and X1
> INCONCLUSIVE by design) has not been run. Step B code (agency readers on the record, the toggle
> route and panel) is on the same branch. **Next free migration number: 119 until it is applied;
> then 120.** Order: B / 119, C / 120, then the actuals feeder (121 or later). Report:
> `docs/rfp-record-b-report.md`.

> **UPDATED 2026-10-14 (feat/rfp-record-a2): F1 closed in 118, PENDING APPLY.** F1 (found 2026-10-14):
> the 099 vendor UPDATE policy on `partner_rfp_inbox` let a vendor rewrite every column of its own row
> except `vendor_org_id` and `status` (lead_org_id, master_rfp_json and its rubric, estimated_budget,
> project_id, scope_item_id, ...). The owner found **no sign of exploitation across the 97 inbox rows**.
> Owner rulings O1 (vendor allow-list: status, updated_at, viewed_at, partner_intent, intent_set_at,
> agency_nda_notified_at; deny by default) and O2 (claim only an unclaimed row, for the caller's own
> organization, with claimed_at) are now rule (4) of 118's inbox guard; this also closes the
> 099:783-790 re-claim gap. **F1 stays OPEN in production until 118 is applied.** 118 is still NOT
> applied; `COMMIT;` is now line 924; the pre-apply test now has **97 assertions** (INCONCLUSIVE by
> design: U1, U2, X1, X2, and C3 when no two-organization user exists). Next free migration number:
> still 118 until it is applied; next to author: 119. Report: `docs/rfp-record-a-report.md` section 8g.

> **UPDATED 2026-10-14 (feat/rfp-record-a).** **117 is applied and catalog-verified 2026-10-14**
> (unchanged from the banner below). **R-D3 re-tag APPLIED 2026-10-14** (owner): the data-fix that
> ran is **v2, pinned to project category `e57719fe` and template category `42a8ab0a`**, after **v1
> failed with 42P01**. v2 is not in this repository: `supabase/data-fixes/2026-10-14-retag-categories_*.sql`
> on this branch are the v1 files and were not edited. **118 (`118_rfp_records.sql`, the agency-owned
> RFP record) is authored on `feat/rfp-record-a`, NOT applied**; its pre-apply test
> (`118_preapply_test.sql`, 82 assertions) has not been run. **Next free migration number: 118
> until it is applied; the next one to author after this run is 119.** Owner rulings 2026-10-14:
> RFP record D1-D9 all approved as proposed (`docs/rfp-source-of-truth-design.md` section 6);
> actuals feeder section 7 approved as recommended except the new 2b, entries pending review count
> toward Actual (`docs/budget-actuals-feeder-plan.md` section 7). Order: RFP record A / 118, B / 119,
> C / 120, then the feeder (121 or later). Report: `docs/rfp-record-a-report.md`.

> **UPDATED 2026-10-14 (feat/budget-kind-defaults).** **117 is applied and catalog-verified
> 2026-10-14**: pre-apply test 29/29 PASS; `budget_lines.fee_or_cost` is a nullable text column; CHECK
> allows NULL, 'fee', 'cost'; 0 lines were given a kind; 155 public policies; `budget_lines` has its 4
> policies; 116's trigger is intact. The owner's first run of the pre-apply test failed with 42725
> (`text || "char"` on `pg_trigger.tgenabled`); the repository copy now casts it to text (F4). **No
> migration in this run. Next free number: still 118**; the RFP record claims 118 to 120.
> **Owner rulings 2026-10-14:** R-K1 line-level kind (NULL inherits), R-K2 aggregate percentages only,
> R-K3 category % of total, R-K4 an override equal to the category's kind is stored as NULL (server
> enforced), R-D1 cost is the default for every new category, R-D2 starter re-tag (10 fee to cost,
> `brand_design` keeps fee), R-D3 re-tag the test project `e533075f-...` and its organization's
> template (data-fix scripts in `supabase/data-fixes/`, NOT run). Report:
> `docs/budget-kind-defaults-report.md`.

> **UPDATED 2026-10-14 (feat/budget-line-kind).** **116 is applied and catalog-verified
> 2026-10-14**: pre-apply test 40/40 PASS (after the subject-selection fix in `4d3fa5a`: the vendor
> is found through `partnerships.vendor_org_id`; `partner_id` was renamed in 079). Catalog after
> apply: 4 nullable columns on `budget_lines` (`quantity` numeric(12,3), `unit_rate` numeric(14,2),
> `multiplier` numeric(12,3), `unit_label` text); trigger `budget_lines_compute_estimate` BEFORE
> INSERT OR UPDATE FOR EACH ROW; its function SECURITY INVOKER with search_path pinned; anon and
> authenticated cannot EXECUTE it; 155 public policies, unchanged; `budget_lines` has its 4 policies.
> **117** (`117_budget_line_kind.sql`, per-line fee or cost override) is authored on
> `feat/budget-line-kind` and NOT applied. The next free number is **118**. The agency-owned RFP
> record now claims 118 to 120.

> **CORRECTED 2026-10-14 (feat/budget-line-math).** This record was written before the owner
> applied the budget spine and 115 the same day. **103, 104 and 115 were applied and verified on
> 2026-10-12** (owner catalog check; test figures as recorded in `docs/roadmap-state.md` at commit
> `b63618b`). The rows and items below that said otherwise are corrected in place. **116**
> (`116_budget_line_math.sql`) is authored on `feat/budget-line-math` and NOT applied; the next free
> number is **117**.

Migration status is **owner-verified 2026-10-12 by catalog query** in the Supabase SQL Editor.
Branch facts were checked in the repository on 2026-10-12. Anything not listed here is
**unverified**. Every section below this one is history.

## Migrations

| Migrations | Status |
|---|---|
| 071-072, 074-100, 102, 105-112 | **Applied, catalog-verified 2026-10-12.** 071 and 074-078 were "unverified" until today. 078's "do not run" note means do not run it *again*: 079 PHASE 12 replaced its function. |
| **113** | **Applied and verified 2026-10-12.** Pre-apply test 21/21 PASS. Role columns guarded; `set_active_role()` is the only session writer of `active_role`. |
| **114** | **Applied and verified 2026-10-12.** Pre-apply test 21/21 PASS. TRUNCATE/REFERENCES/TRIGGER revoked from anon and authenticated on every public table; anon EXECUTE revoked on the six `current_user_*` helpers; WITH CHECK tightened on `delivery_reviews`, `delivery_review_scores`, `msa_agreements`, `rfp_magic_tokens`; `partnerships.reliability_*` guarded. |
| **103** | **Applied and verified 2026-10-12.** Pre-apply test 73 PASS, 0 FAIL, 23 INCONCLUSIVE (all NO SUBJECT). The grant defect (anon revoked but not authenticated) had been fixed on `fix/103-104-rulings` before the apply. |
| **104** | **Applied and verified 2026-10-12.** Pre-apply test 91 PASS, 13 INCONCLUSIVE (all NO SUBJECT), 4 FAIL accepted by the owner as test-expectation errors (W1, PE3, AA1, AA3; see `docs/roadmap-state.md`). The migration is unchanged. |
| **115** | **Applied and verified 2026-10-12.** Pre-apply test 16/16 PASS. `115_discoverable_profiles.sql`. |
| **116** | **Applied and catalog-verified 2026-10-14.** Pre-apply test 40/40 PASS. `116_budget_line_math.sql`: 4 nullable columns; trigger `budget_lines_compute_estimate` BEFORE INSERT OR UPDATE FOR EACH ROW; SECURITY INVOKER; search_path pinned; anon and authenticated cannot EXECUTE; 155 policies unchanged; `budget_lines` 4 policies. |
| **117** | **Applied and catalog-verified 2026-10-14.** Pre-apply test 29/29 PASS. `117_budget_line_kind.sql`: nullable text `budget_lines.fee_or_cost` (NULL inherits the category); CHECK NULL/fee/cost; 0 lines given a kind; 155 policies; `budget_lines` 4 policies; 116 trigger intact. |
| **118** | **Authored 2026-10-14 on `feat/rfp-record-a`, NOT applied, pre-apply test NOT run.** `118_rfp_records.sql`: `rfp_records`, `rfp_record_lines` (paid-lead-agency RLS, 6 policies, no DELETE), `current_user_entitled_lead_org_ids()`, D5 snapshot and line guards, five nullable link columns on `partner_rfp_inbox` / `rfp_magic_tokens` with the link-column guard; the inbox guard also carries the vendor allow-list (rulings O1/O2, closes F1, `feat/rfp-record-a2`). COMMIT at line 924 (was 845). Pre-apply test 97 assertions (was 82). Expected after apply: 161 public policies. |
| **119** | **Applied and verified 2026-10-14** (see the top banner; 118 was applied and catalog-verified the same day). `119_rfp_records_backfill.sql`: the backfill and `rfp_record_set_client_visibility()`. Pre-apply 33/33 PASS. One row refused: inbox `04391718`, whose token row no longer exists. |
| **120** | **Authored 2026-10-15 on `feat/rfp-record-c`, NOT applied, pre-apply test NOT run.** `120_rfp_vendor_copy_scrub.sql`: allow-list functions `rfp_vendor_copy_keys()` and `rfp_token_reference_materials_keys()`, LG120 pre-flight, scrub of `partner_rfp_inbox.master_rfp_json` and `rfp_magic_tokens.reference_materials` to the allow-lists (removes `_magic_token`, D8), BEFORE INSERT OR UPDATE guards on both tables for every role (23514). No policy or grant change. Requires the step C code deployed first. |
| 073 | **Never applied. Must never be applied.** Superseded by 111/112. |
| 101 | **Never applied. Must never be applied.** Superseded by 102. |

**Next free migration number: 118** (2026-10-14: 116 and 117 are applied). 118 is authored on
`feat/rfp-record-a` and not applied; the next number to author is **119** (the RFP record backfill).

**Default privileges (finding, 2026-10-12).** `postgres`'s default privileges in `public` no longer
grant TRUNCATE, REFERENCES or TRIGGER to anon or authenticated. `supabase_admin`'s still do, but they do
not apply to tables created by migrations (those are owned by `postgres`). Every new table still
revokes ALL by name and grants only what its policies use.

## The paid lead-agency gate is live on main

`main` at `1a6f53b`: `resolveAgencyGate()` (`lib/entitlements.ts`) and the wrappers in
`lib/api-auth.ts` (`agencyGateRefusal`, `agencyGateResponse`, `requireAgencyEntitlement`;
`requireAgencyRole` aliases it). Agency routes refuse with **402 `agency_entitlement_required`**.
Authorization never reads `role`, `active_role` or `secondary_role`. With 113 applied, a session
cannot write those columns directly.

## What the 2026-10-12 run built (nothing pushed, nothing merged, nothing applied)

**`fix/guest-profiles-records`** (from `main` `1a6f53b`), report `docs/guest-profiles-records-report.md`:
- `1983cea` WS-A: the unauthenticated guest RFP link (`app/api/rfp/guest/[token]`) returns only
  what the guest screen renders. Gone: the whole `rfp_magic_tokens` row, including the rubric,
  `output_template_config`, org/project/response ids, `domain_match_profile_id`, `pool_status` and
  the token. Client name and project budget are no longer sent to guests (owner rulings).
  `check-email` and four account lookups are exact-match (they were wildcard `ilike`), and
  `check-email` answers every outcome uniformly. magic-link POST no longer returns
  `is_existing_partner`; email-scan run no longer sends another person's profile id.
- `ed6fa95` WS-B: discovery reads go through `discoverable_profiles()` (public fields only), with
  today's query as the fallback. **Migration 115** adds that function and drops the whole-row
  policy "Authenticated users can read discoverable profiles". Down file and pre-apply test
  included; the test's inlined body was machine-compared with the migration.
- `4f10dfb` WS-E: `docs/rfp-source-of-truth-design.md` (design only).

**`feat/budget-spine-integrated`** (from `main` `1a6f53b`, plus `git merge --no-ff
feat/budget-spine-server` = `020432a`, no conflicts), report `docs/budget-spine-integrated-report.md`:
- `49030a6` WS-C: all 20 handlers under `app/api/agency/budget/` sit behind the paid gate
  (`lib/server/budget/http.ts:40`). The 103/104 pre-apply test transcriptions were diffed against
  the migrations: no drift. R1-R7 and the grant posture confirmed. COMMIT lines: 103 at 823,
  104 at 882.
- This record (final commit on that branch; identical text in `docs/state-of-record-2026-10-12.md`
  for cherry-picking onto `fix/guest-profiles-records`).

**Applied and verified 2026-10-12 (corrected):** 115, 103, 104. **Applied and verified 2026-10-14:**
116, 117.

## Closed since 2026-10-09

- "A vendor can reach agency routes by switching its own `active_role`": closed by the gate on main
  plus 113.
- "A vendor can insert its own `delivery_reviews` row": closed by 114's WITH CHECK.
- "103/104 grants revoke anon but not authenticated": fixed on `fix/103-104-rulings`, re-verified.

## Open items, in priority order

1. **Merge and deploy `fix/guest-profiles-records`.** The guest link leak is unauthenticated, and
   the code is independent of any migration.
2. ~~**115:** pre-apply test, dry run, catalog proof, apply, verify.~~ **Done 2026-10-12** (corrected
   2026-10-14): applied and verified, pre-apply test 16/16 PASS.
3. **Account-existence oracles still open (owner decisions):** `check-email` remains a yes/no oracle
   by design (proposed: bind it to a magic-link token); `pool/import-spreadsheet` dry run answers
   `already_on_ligament` for up to 2000 emails (proposed: drop that flag and cap the batch);
   magic-link `check_email` means "any account" while the UI says "in your vendor pool" (proposed:
   scope it to the caller's partnerships). See WS-A in the run report.
4. ~~**Merge `feat/budget-spine-integrated`, then 103 and 104.**~~ **Done 2026-10-12** (corrected
   2026-10-14): merged, and 103 and 104 applied and verified.
5. **Agency-owned RFP record:** owner decisions D1-D9 **ruled 2026-10-14** (all as proposed). Code A
   and 118 are authored on `feat/rfp-record-a` (not merged, not applied); then code B, 119, code C,
   120 (renumbered 2026-10-14 from 116-118, then from 117-119; 116 is budget line math, 117 is
   budget line kind). The actuals feeder follows, at 121 or later.
6. **The full profiles split** (`profile_private`, `organization_private`;
   `docs/profiles-exposure-design.md` section 3): live counterparties and same-org colleagues
   still read whole rows, legal and billing included, and `organizations.is_paid` is readable by
   every counterparty.
7. **115 is applied, so notifications to a bidder with no partnership** go unresolved
   (`resolveOrgNotificationRecipients` profiles fallback). Proposed: a resolver keyed on the bid.
8. **Guest new-bid drops `proposal_sections`** (only the edit path writes them).
9. `usage_tracking`: any member can reset its own organization's quota (from the 114 report).
10. The policy audit script reads a frozen 2026-08-13 snapshot and cannot see later tables.

Every cross-agency assertion in every pre-apply test remains **NO SUBJECT = INCONCLUSIVE**, never
PASS: m a r k a n t is the only lead organization with members.
