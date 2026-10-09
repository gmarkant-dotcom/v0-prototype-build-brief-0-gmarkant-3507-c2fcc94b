# 105 / 106: the lead agency's private notes move to a table no vendor can read

> **CORRECTION 2026-10-09:** merged into main (verified by `git branch --merged`). Applied status is recorded in `docs/roadmap-state.md`, not here.

**Merge status:** NOT MERGED, NOT PUSHED, NOT APPLIED. Checked 2026-10-08 with `git merge-base --is-ancestor HEAD origin/main`, exit 1 (the branch `fix/105-notes-column-revoke` is not an ancestor of origin/main). Re-run that check before trusting this line; it is never updated by hand.

**THE LEAK WINDOW, IN ONE SENTENCE: a vendor with a claimed partnership can still read the lead agency's private notes, the blacklist flag included, from the moment the code deploys until 106 is applied; 105 alone does not close it, and only 106 does.**

## Read these three first

1. **The brief's fix was a no-op and Greg's catalog query proved it** (`attacl` NULL, `relacl` has `authenticated=arwdDxtm`). A column revoke would have been accepted and changed nothing, and a table-level revoke would have broken the agency and the vendor equally (they are one role). The split table is the only mechanism that works. This report builds it.
2. **Two migrations, code first.** Order is: deploy the code, apply 105, watch the notes feature on production, apply 106. Code shipped first is harmless: it falls back to the old column while the table does not exist. 106 nulls the column, it does not drop it.
3. **Nothing here was executed against Postgres.** There is no local Postgres and no credentials. The SQL was read, not parsed; the code was type-checked (`tsc` 0). The pre-apply tests will probably need a typo fixed on their first run, and a typo ends in a plain error, never in "SAFE TO APPLY".

## What changed

### Migrations (all authored, none applied)

| File | BEGIN | COMMIT / ROLLBACK |
|---|---|---|
| `105_partnership_private_notes.sql` | 201 | COMMIT 351 |
| `105_partnership_private_notes_down.sql` | 30 | COMMIT 69 |
| `106_partnership_notes_null.sql` | 93 | COMMIT 132 |
| `106_partnership_notes_null_down.sql` | 21 | COMMIT 52 |
| `105_preapply_test.sql` | 71 | ROLLBACK 923 |
| `106_preapply_test.sql` | 68 | ROLLBACK 742 |

Each migration has its own explicit BEGIN and COMMIT, a stop-gate header, pre-flight queries with expected values, an in-transaction fail-closed pre-flight (LG105 / LG106), and a verification block with exact expected values.

**105** creates `public.partnership_private_notes (partnership_id PK -> partnerships ON DELETE CASCADE, lead_org_id -> organizations, notes jsonb, timestamps)`:

- three policies (SELECT, INSERT, UPDATE), all `authenticated`, all `lead_org_id IN (SELECT current_user_org_ids())`. **No vendor policy. No DELETE policy.**
- `REVOKE ALL` from PUBLIC, `anon` and `authenticated` by name, then `GRANT SELECT, INSERT, UPDATE` to `authenticated` only. `anon` is revoked explicitly, not left to the absence of a policy.
- a guard trigger that forces `lead_org_id` to equal the partnership's and makes both key columns immutable, for every caller including the service role.
- a backfill copy of `partnerships.partnership_notes`, checked for exactness inside the transaction (raises LG105, nothing commits, if the copy is not identical), then `NOTIFY pgrst, 'reload schema'`.
- the legacy column is NOT touched.
- `ON DELETE CASCADE` is a deliberate break from 104's no-cascade convention: `DELETE /api/partnerships` must keep working for a partnership that has notes.

**106** is one `UPDATE partnerships SET partnership_notes = NULL`, behind a pre-flight that refuses (LG106) if any legacy value differs from its table row, so it cannot destroy a note that was never copied.

**Down files.** 105 down copies the table back into the legacy column, verifies it, then drops the table (no note is lost; the vendor leak returns, which is what a rollback means). 106 down copies the table back into the column and refuses to run if the table is gone.

### Equal-or-narrower

105 creates an object and copies data; it changes no policy, grant or trigger on any existing table (the test fingerprints the `partnerships` policies and its `relacl` before and after). Nobody loses a read they have today, the vendor gains nothing (no vendor policy), and the agency gains a place to keep notes that no vendor can read. 106 narrows exactly one thing: the legacy column becomes empty. The agency does not rely on that column once the code reads the table (see below).

### Code (ships first)

New `lib/server/partnership-private-notes.ts`: `readPrivateNotes` (requires the caller's lead org ids and always filters on them; no unscoped read exists), `resolveNotes`, `attachPrivateNotes`, `writePrivateNotes` (upsert, legacy-column fallback only when the table is absent), `withoutPrivateNotes`.

| Census row (docs/105-phase0-baseline.md) | Session | Now |
|---|---|---|
| 1, 2 `agency/pool/[partnerId]/notes` GET and POST | agency | gate read resolves notes from the table (scoped by `callerOrgIds`); POST writes the table; `partnerships.updated_at` still stamped best-effort |
| 3, 4 `GET /api/partnerships` agency branch | agency | `attachPrivateNotes` after the `*` read, before the ghost-row loop; wire key `partnership_notes` unchanged so the Vendor Pool page is untouched |
| 5 `GET /api/partnerships` vendor branch | vendor | unchanged (`select('*')` and the strip at the end both still work, that is the point) |
| 6, 8 POST / PATCH agency `*` reads | agency | unchanged: they return the legacy column, nothing reads notes off them |
| 7 PATCH vendor accept / decline | vendor | responses now go through `withoutPrivateNotes` so this API never hands a vendor the legacy column |
| 9 broadcast cue insert | agency session | no longer writes `partnership_notes` in the insert; `.select("id").single()` then `writePrivateNotes` |
| 10 email-scan import | service role | reads the table (scoped to the agency org) before merging; writes the table; insert returns the id first |
| 11 pool import (add-partner, import-spreadsheet) | service role | same; batch insert now `.select("id, partner_email")`; a row whose notes fail to save is reported as an error, not "added" |
| 12-14 derived readers | | follow rows 3/4. Row 14 (vendor "cued by broadcast" badge) is the pre-existing dead read described in the baseline, left alone |

## Order: code first

Code first is safe: before 105 exists, reads fall back to the column and writes go to the column. Migration first is not: old code would write the column and those writes would be missing from the table (106 refuses to run over such drift). **Order: code, 105, watch, 106.**

## Apply sequence

1. Deploy the branch code (`git push`; nothing else). Notes still work, against the column.
2. Read `105_preapply_test.sql`'s header, paste it whole into a SQL Editor tab, run it once. **It ends in an error; the error is the result.** First line must read `SAFE TO APPLY 105.` Read the per-scenario report. Expect V3 to show the vendor reading the sentinel in phase 1 and in phase 2 (the measured defect and the leak window) and NULL in phase 3.
3. Dry run: swap the final `COMMIT;` (line 351) for `ROLLBACK;`, run, then run 105's P2 query. Zero rows proves it rolled back. Swap back.
4. Real apply. Run V1 to V7.
5. Exercise the notes feature on production: open a vendor's notes, save one, reload; check the blacklist flag on a flagged vendor.
6. Run `106_preapply_test.sql` (requires 105 live; it says so and stops if not). First line `SAFE TO APPLY 106.`
7. Dry run 106 the same way (COMMIT line 132), verify with its P2, then real apply, then V1 to V4. **The leak closes here.**

## What the tests assert (and what was not run)

22 scenarios times 3 phases (105 test) or 2 phases (106 test), each with BEFORE and AFTER columns, plus structural assertions. Mandatory ones, by id:

- agency member reads and writes the new table: A3, A4, A5
- an agency cannot read or write another agency's notes: B1, B2 (and A6, A7 for creating notes on a partnership it does not lead)
- **a vendor session cannot read the new table at all:** V4, V5 (all rows, only for a vendor-only subject), V6 insert, V7 update, V8 delete
- after 106 a vendor reading `partnerships` gets no notes content: V3 phase 3
- **`select('*')` on `partnerships` still works for both parties after both migrations:** V1 (vendor), A1 (agency), plus V2 for the named columns a vendor needs
- the service role reads and writes it: Z1, Z2; `anon` is refused: Z3
- no policy on `partnerships` changed (fingerprint), no grant changed (`relacl`)
- 106 refuses over drifted data (S1 of its test)

NO SUBJECT is reported, never passed, for the vendor-only, agency, and other-agency actors.

**Gates, EXECUTED unpiped against the Phase 0 baseline, identical:** `tsc` 0; `pnpm build` 0; `eslint .` 1 with 182 problems (154 errors, 28 warnings); `policy-audit:guard` 1; `verify-rls` 2; embed-targets 0; identity-columns 0; org-id-reads 0.

**READ, not executed:** every line of SQL; the route behaviour end to end; the PostgREST error codes the fallback keys on (`42P01`, `PGRST205`, recalled, plus a message match); the `upsert(..., { onConflict })` call.

## Owed

- **The drop of `partnerships.partnership_notes`** is deliberately not here. It is justified by, together: 106 applied and the column verified empty; the code read from the table in production for a while with no notes complaint and no drift (rerun 106's P1, expect 0); and the fallback code below removed. Then a migration drops the column; the last select of it in the notes route (`select("id, partnership_notes, lead_org_id")`) and the legacy fallback must be deleted in the same change, or they fail.
- **Remove the legacy fallback** in `lib/server/partnership-private-notes.ts` and its `partnership_notes` selects, after 105 and 106 are applied and verified.
- **A local Postgres parse-check of 105, 106 and both tests.** Not available here.
- **`reliability_summary`** (073 S4) has the same defect class: agency-only AI prose in a column the vendor's whole-row policy admits. The same table pattern fits; separate pass.
- **Vendor "cued by broadcast" badge** (`app/partner/network/page.tsx:885`) reads a field the API strips; product question, untouched.
- **Agency `PATCH` and `POST` responses** still return the legacy column. Harmless for the vendor; stale after 106 for the agency, and nothing reads notes off them today.
- **Revoking `anon` on `partnerships` itself** (it holds table-wide privilege by Supabase default, blocked only by the absence of a policy) is a wider decision, not scoped here.

## Brief questioned

The brief's mechanism was wrong (Phase 0 and the catalog query settled it), and its Phase 2 text asked for "an agency member can still read and write `partnership_notes`", which under the split becomes "the notes table". Both are reflected above.
