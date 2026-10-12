# 103 and 104 amended to the owner's rulings of 2026-10-09

**Written:** 2026-10-09, branch `fix/103-104-rulings` (from `main` at `40a7286`). Unattended session.
**Applied:** no. Nothing here touched a database. **Merge status: not stated here**; check with
`git merge-base --is-ancestor <sha> main`.

**No SQL parser was available, and none was installed.** The owner's run of each pre-apply test in the
Supabase SQL Editor is the parse check for the test and for the migration it embeds.

**The pre-apply tests were transcribed by hand, not generated.** The generator interpreter (python3, node)
was refused by the permission system. Every `EXECUTE $t103_NN$` and `$t104_NN$` body was copied from the
migration statement by statement. **Before the first run, diff each body against the migration.** A
difference is a test fault, not a migration fault. Array lengths were checked by counting elements with
grep: 82 scenarios per array in the 103 test and 93 in the 104 test.

## Dry-run line numbers (replace this `COMMIT;` with `ROLLBACK;` for the dry run)

| File | BEGIN | COMMIT |
|---|---|---|
| `supabase/migrations/103_budget_core.sql` | 369 | **823** |
| `supabase/migrations/104_budget_ledger.sql` | 368 | **882** |
| `supabase/migrations/103_budget_core_down.sql` | 36 | 77 |
| `supabase/migrations/104_budget_ledger_down.sql` | 35 | 62 |

Each migration header states these numbers (103:367, 104:366). They were checked with grep after the
final edit.

## Each ruling and where it lives

### R1 Delete vs archive
- `archived_at timestamptz NULL` added to:
  - `budget_template_categories` (`103_budget_core.sql:415`)
  - `budget_project_categories` (`:455`)
  - `budget_lines` (`:498`)
- The line rule is in the DELETE policy's USING clause: `(estimate IS NULL OR estimate = 0)` at
  `103_budget_core.sql:797-803`.
- "Nothing references it" is still the NO ACTION foreign keys, unchanged. 104's composite FK
  `ledger_entries_budget_line_fkey` (`104_budget_ledger.sql:531-533`) refuses to delete a line that has
  any entry, voided or not.
- Category deletion relies on the existing foreign keys, unchanged.
- `estimate` stays NOT NULL (F6 still asserts this). The USING clause names NULL anyway, so relaxing NOT
  NULL later cannot widen the rule by accident.
- **A DELETE refused by USING deletes 0 rows and raises nothing.** Callers must check the affected count.

### R2 Duplicates
- Columns `voided_at`, `void_reason` and `duplicate_of` at `104_budget_ledger.sql:514-516`.
- `UNIQUE (project_id, id)` at `:519`, plus the composite self-FK `ledger_entries_duplicate_of_fkey` at
  `:535-537`. This follows the table's existing composite pattern.
- CHECKs `ledger_entries_duplicate_requires_void` (`:538`) and `ledger_entries_duplicate_not_self` (`:540`).
- No DELETE policy and no DELETE grant (`:795`).
- The SELECT policies do not read `voided_at`, so voided entries stay readable.
- The header states that Actual excludes voided entries (`:70-73`); so does the table comment.

### R3 Archive
- `source_documents.archived_at` is kept.
- `budget_archive_project_documents(uuid)` (`104_budget_ledger.sql:710`) and
  `budget_unarchive_project_documents(uuid)` (`:738`):
  - SECURITY INVOKER with `SET search_path = public, pg_temp`.
  - Return `ROW_COUNT`.
  - Update only `archived_at` and never touch storage.
  - Raise 42501 unless the caller is a member of the organization that owns the project.
- EXECUTE is revoked from PUBLIC and anon and granted to authenticated (`:776-781`).
- The vendor policy (`:838-853`) does not mention `archived_at`. S4 asserts this.

### R4 Vendor document access
- The status domain comes from `partnerships_status_check` (`063_invitation_sent_at.sql:33-34`):
  `pending, active, suspended, terminated, removed`.
- 102 defines pending -> active as accept and pending -> terminated as decline.
- **The allow-list is `('active', 'suspended')`.** It is listed in the 104 header at `:83-103`.
- The vendor SELECT policy's toggle branch uses `ps.status IN ('active', 'suspended')` (`:850`). This
  replaces `NOT IN ('terminated', 'removed')`, which admitted `pending`.
- **There is no vendor INSERT or UPDATE policy on either table**, so there was no other deny-list to
  replace.
- To make "pending CANNOT upload" hold on the only path that can file a vendor document (trusted server
  code), `source_documents_guard()` now refuses any `uploader_side = 'vendor'` INSERT unless the
  partnership is active or suspended. It raises 42501 (`:617`, `:626-631`).
- The authorship branch (`uploader_side = 'vendor'`) is unchanged and ignores status.

### R5 Four states
- Header text only: 103 at `:59-62` and 104 at `:104-107`.
- No column was added. `budget_lines` still stores only `estimate` (S5 asserts its column list).

### R6 Copy-on-create
- `budget_copy_template_to_project(uuid) RETURNS integer` at `103_budget_core.sql:628-668`:
  - SECURITY INVOKER with a pinned search_path.
  - 42501 if the project's `org_id` is not one of the caller's own organizations. A vendor who can read
    the project row through `projects_partner_select_assigned` is still refused.
  - An advisory lock per project, then 23505 if the project has any category.
  - Copies `name` and `fee_or_cost` of the agency's non-archived template rows and returns `ROW_COUNT`.
- REVOKE from PUBLIC and anon, GRANT to authenticated (`:673-675`).
- 103 references no 104 object; checked with grep.

### R7 Grants
- 103: per-table `REVOKE ALL FROM PUBLIC, anon, authenticated` at `:685-696`; the ruled grants at
  `:698-701`; service_role ALL at `:703-706`.
- 104: the same at `:788-799`.

**Grep proof (2026-10-09):**
- Every `CREATE TABLE` in 103 (4) and 104 (2) has a matching `REVOKE ALL ... FROM authenticated;` line:
  103:687, 690, 693, 696 and 104:790, 793.
- `CREATE FUNCTION` counts are 2 in 103 and 4 in 104. `SET search_path = public, pg_temp` counts are the
  same, 2 and 4.
- No non-comment `SECURITY DEFINER` appears in either file.

### Unchanged, and verified
- **Copy, not pointer:** S8 asserts the project chart has only the FK to `projects`. CP1-CP4 still apply.
- **Merge history:** `original_category_id` is frozen. G16 and G17 are unchanged, and
  `budget_category_merges` is append-only (MG5 and MG6, now via no grant).
- **Every colleague reads every receipt:** G2 and G4.
- **Vendors read no 103 table and no `ledger_entries`:** V1-V11, L1, L2, VD7. S3 confirms exactly one
  vendor-facing policy.
- **The per-document toggle:** TG1 and TG2.
- **Nothing keys on project status:** checked by grep; no policy or function reads `projects.status`.

### Also changed
- Both migrations end with `NOTIFY pgrst, 'reload schema';`, as 109 does, so PostgREST and the
  workstream B helpers see the tables at commit.
- Both down files drop the new functions. 103's down also refuses while 104's archive functions exist.

## Assertions added or changed

### `103_preapply_test.sql`

96 assertions: 81 counted scenarios plus 15 structural. VI1 is informational.

| ID | Status | Ruling | Assertion |
|---|---|---|---|
| A10 | **INVERTED** | R1 | Member CANNOT delete a line at estimate 100. N:0, with an owner twin. |
| X10 | changed | R1 | Setup sets the other agency's line to estimate 0, so the org predicate (not R1) is what refuses. |
| V10 | changed | R1 | Setup sets the line to estimate 0, so the vendor refusal is the org predicate's. |
| MG5, MG6 | changed | R7 | N:0 becomes E:42501 (no UPDATE or DELETE grant on merges). |
| D1 | new | R1 | A line at estimate 0 deletes (N:1). |
| D2 | new | R1 | A line at estimate -5 does not (N:0, with a twin). |
| AR1-AR3 | new | R1 | `archived_at` works on lines, project categories and template categories. |
| AR4 | new | R1 | Un-archive. |
| AR5 | new | R1 | An archived line stays readable. |
| AR6 | new | R1 | A vendor cannot archive (N:0, with a twin). |
| CC1 | new | R6 | Copy returns 2, the non-archived template count. The seed adds T2 (live) and T3 (archived). |
| CC2 | new | R6 | Names and fee-or-cost are copied. |
| CC3 | new | R6 | The archived T3 is not copied. |
| CC4 | new | R6 | A second call returns 23505. |
| CC5 | new | R6 | A project that already has a chart returns 23505. |
| CC6 | new | R6 | A vendor that can read the project gets 42501. |
| CC7 | new | R6 | Another agency gets 42501. |
| CC8 | new | R6 | An empty template copies 0. |
| S4 | changed | R7 | anon holds none of the 7 privileges on the 4 tables. |
| S5 | changed | R1/R5 | `budget_lines` columns include `archived_at`, and `archived_at` is on all three tables. |
| S11 | new | R7 | authenticated holds exactly the ruled grants: no TRUNCATE, REFERENCES or TRIGGER, and no UPDATE or DELETE on merges. |
| S12 | new | R7 | service_role holds all 28 privileges and bypasses RLS. |
| S13 | new | R1 | The DELETE policy text carries the estimate rule. |
| S14 | new | R6 | The copy function is INVOKER, pinned, returns integer, with no anon or PUBLIC EXECUTE and with authenticated EXECUTE. |
| S15 | new | R7 | No SECURITY DEFINER, and every 103 function is pinned. |

### `104_preapply_test.sql`

108 assertions: 93 scenarios plus 15 structural.

| ID | Status | Ruling | Assertion |
|---|---|---|---|
| SU3 | **INVERTED** | R4 | Pending: the vendor CANNOT read the toggle-on document (N:0, with a twin). |
| W3, G13 | changed | R7 | N:0 becomes E:42501 (no DELETE grant on `source_documents`). |
| W7, G14 | changed | R2/R7 | N:0 becomes E:42501. DELETE on `ledger_entries` is refused for vendor and agency. |
| seed | changed | R4 | ps2 is set 'active' before its vendor document is seeded (the guard requires it). |
| PE1 | new | R4 | Pending reads 0 of 3 agency documents (with a twin). |
| PE2 | new | R4 | Pending still reads its own document. |
| PE3 | new | R4 | A pending vendor session cannot upload. |
| PE4 | new | R4 | The trusted path cannot file a vendor document while pending. |
| AC1 | new | R4 | Control: the trusted path files a vendor document while active. |
| SU4 | new | R4 | The trusted path files one while suspended. |
| TE1, RM1 | new | R4 | The trusted path cannot file one while terminated or removed. |
| RM2 | new | R4 | Removed reads 1 of 4 documents (its own). |
| AA1-AA4 | new | R3 | Archive returns 5; all 5 then carry `archived_at`; unarchive returns 5; after the round trip none are archived. |
| AA5 | new | R3 | Archiving changes no vendor read (still 2). |
| AA6, AA7 | new | R3 | Vendor archive and unarchive return 42501. |
| AA8 | new | R3 | Archive touches no other column. |
| AA9 | new | R3 | Another agency gets 42501. |
| VD1, VD2 | new | R2 | Void; void as a duplicate. |
| VD3 | new | R2 | `duplicate_of` without `voided_at` returns 23514. |
| VD4 | new | R2 | Self-reference returns 23514. |
| VD5 | new | R2 | `duplicate_of` in another project returns 23503. |
| VD6 | new | R2 | A colleague reads a voided entry. |
| VD7 | new | R2 | A vendor cannot read it (with a twin). |
| VD8 | new | R2 | Actual on the line is 25: entry 19 (25.00) counts and the voided entry 20 (-10.00) does not. |
| D3 | new | R1 | A line at estimate 0 with a ledger entry: delete returns 23503. |
| D4 | new | R1 | Control: without an entry it deletes. |
| D5 | new | R1 | A voided entry still blocks the delete (23503). |
| S4 | changed | R4/R3 | The policy contains `active` and `suspended`, and does not contain `pending`, `terminated`, `removed` or `archived_at`. |
| S6 | changed | R7 | anon holds none of the 14 privileges. |
| S7 | changed | R2 | `ledger_entries` columns include `duplicate_of`, `void_reason` and `voided_at`. |
| S8 | changed | R2 | 8 foreign keys (was 7), all NO ACTION. |
| S10 | changed | R2 | The R2 constraints exist. |
| S12 | new | R7 | authenticated holds SELECT, INSERT and UPDATE only. |
| S13 | new | R7 | service_role holds all 14 and bypasses RLS. |
| S14 | new | R3 | The archive functions are INVOKER, pinned, with authenticated only. |
| S15 | new | R7 | No SECURITY DEFINER, and all 4 functions are pinned. |

Every other scenario was kept as it was.

**Test harness change, both files:** `sc_sql` and `sc_chk` now accept several statements separated by
`~|~`. They run in order as the actor, and the last value is the one judged. CC4, AA3 and AA4 need this.

### Expected INCONCLUSIVE rows

Live fact: only one lead organization has members. So every scenario needing the other agency reports
NO SUBJECT, which is INCONCLUSIVE and never a pass:
- 103: K1-K3, X1-X16, V11, MG2, MG9, CC7.
- 104: G22, G23, X1-X8, VD5, AA9.

**Neither test can print "SAFE TO APPLY" until a second agency with a member exists, or until the owner
rules that these rows may be accepted as INCONCLUSIVE.**

## Not implemented, and why
- **Committed and Paid:** deferred by R5.
- **Undoing a void, or `duplicate_of` pointing at a voided entry:** not ruled. Nothing refuses either.
- **Whether an archived category may receive new lines:** not ruled. Nothing refuses it.
- **"Pending cannot upload" through a vendor route:** no such route exists. The database refuses it on
  both possible paths (no vendor INSERT policy; the guard on the trusted path).
- **An actual `SET ROLE service_role` read in the tests:** not done, because whether the SQL Editor role
  can assume `service_role` is unverified. S12 and S13 assert the privileges and `rolbypassrls` instead.
- **Applying anything:** out of scope.

## Assumptions
1. "Accepted-relationship statuses" means `active` and `suspended`. `pending` is the only not-yet-accepted
   value; `terminated` also covers a declined invitation (102).
2. The allow-list applies to the trusted vendor-upload path through the guard trigger. Applying it there
   is how "cannot upload" is made true. Without it, nothing in the database would distinguish pending.
3. The R3 functions raise 42501 for a caller who is not the agency, rather than returning 0, to match R6.
   Either way a vendor call has no effect.
4. "Project visible" in R6 means visible as its agency (`org_id` in `current_user_org_ids()`), because the
   ruling requires a vendor who CAN read the project to get 42501.
