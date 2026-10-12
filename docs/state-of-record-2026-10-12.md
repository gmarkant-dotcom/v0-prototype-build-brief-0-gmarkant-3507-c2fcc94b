# CURRENT STATE, 2026-10-12 (read this instead of every banner below)

Migration status is **owner-verified 2026-10-12 by catalog query** in the Supabase SQL Editor.
Branch facts were checked in the repository on 2026-10-12. Anything not listed here is
**unverified**. Every section below this one is history.

## Migrations

| Migrations | Status |
|---|---|
| 071-072, 074-100, 102, 105-112 | **Applied, catalog-verified 2026-10-12.** 071 and 074-078 were "unverified" until today. 078's "do not run" note means do not run it *again*: 079 PHASE 12 replaced its function. |
| **113** | **Applied and verified 2026-10-12.** Pre-apply test 21/21 PASS. Role columns guarded; `set_active_role()` is the only session writer of `active_role`. |
| **114** | **Applied and verified 2026-10-12.** Pre-apply test 21/21 PASS. TRUNCATE/REFERENCES/TRIGGER revoked from anon and authenticated on every public table; anon EXECUTE revoked on the six `current_user_*` helpers; WITH CHECK tightened on `delivery_reviews`, `delivery_review_scores`, `msa_agreements`, `rfp_magic_tokens`; `partnerships.reliability_*` guarded. |
| 103, 104 | **NOT applied.** Their grant defect (anon revoked but not authenticated) is **fixed** on `fix/103-104-rulings` and re-verified on `feat/budget-spine-integrated` (2026-10-12): REVOKE ALL by name from PUBLIC, anon, authenticated, then only the ruled grants. |
| **115** | **Authored, NOT applied.** `115_discoverable_profiles.sql`, on `fix/guest-profiles-records`. |
| 073 | **Never applied. Must never be applied.** Superseded by 111/112. |
| 101 | **Never applied. Must never be applied.** Superseded by 102. |

**Next free migration number: 116** (115 is taken by this run).

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

**Not yet applied:** 115, 103, 104.

## Closed since 2026-10-09

- "A vendor can reach agency routes by switching its own `active_role`": closed by the gate on main
  plus 113.
- "A vendor can insert its own `delivery_reviews` row": closed by 114's WITH CHECK.
- "103/104 grants revoke anon but not authenticated": fixed on `fix/103-104-rulings`, re-verified.

## Open items, in priority order

1. **Merge and deploy `fix/guest-profiles-records`.** The guest link leak is unauthenticated, and
   the code is independent of any migration.
2. **115:** pre-apply test ("SAFE TO APPLY 115."), dry run (COMMIT at line 204 -> ROLLBACK), catalog
   proof, apply, verify (V1-V5 in the file header). Only after item 1 is deployed.
3. **Account-existence oracles still open (owner decisions):** `check-email` remains a yes/no oracle
   by design (proposed: bind it to a magic-link token); `pool/import-spreadsheet` dry run answers
   `already_on_ligament` for up to 2000 emails (proposed: drop that flag and cap the batch);
   magic-link `check_email` means "any account" while the UI says "in your vendor pool" (proposed:
   scope it to the caller's partnerships). See WS-A in the run report.
4. **Merge `feat/budget-spine-integrated`, then 103 and 104**, each through pre-apply test, dry run,
   catalog proof, apply and verify.
5. **Agency-owned RFP record:** owner decisions D1-D9 in `docs/rfp-source-of-truth-design.md`,
   then code A, 116, code B, 117, code C, 118.
6. **The full profiles split** (`profile_private`, `organization_private`;
   `docs/profiles-exposure-design.md` section 3): live counterparties and same-org colleagues
   still read whole rows, legal and billing included, and `organizations.is_paid` is readable by
   every counterparty.
7. **After 115, notifications to a bidder with no partnership** go unresolved
   (`resolveOrgNotificationRecipients` profiles fallback). Proposed: a resolver keyed on the bid.
8. **Guest new-bid drops `proposal_sections`** (only the edit path writes them).
9. `usage_tracking`: any member can reset its own organization's quota (from the 114 report).
10. The policy audit script reads a frozen 2026-08-13 snapshot and cannot see later tables.

Every cross-agency assertion in every pre-apply test remains **NO SUBJECT = INCONCLUSIVE**, never
PASS: m a r k a n t is the only lead organization with members.
