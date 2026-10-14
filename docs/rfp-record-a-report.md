# RFP record step A and migration 118: run report, 2026-10-14

Branch `feat/rfp-record-a`, a fresh worktree off `main` (`f47dc61`). Unattended run. **Nothing pushed,
nothing merged, no SQL applied, no SQL run.** Scope: step A and migration 118 of
`docs/rfp-source-of-truth-design.md` only. Steps B, 119, C, 120 and D are untouched: no agency reader
from the design's section 0 table changed, no vendor route changed, no inbox scrub, and
`lib/magic-token-attach.ts` is unchanged (it still writes `_magic_token`).

## 1. Commits

| sha | subject |
|---|---|
| `97be368` | feat: migration 118 - rfp_records and rfp_record_lines (paid lead agency RLS, D5 snapshot, line guard), five link columns with the link-column guard, current_user_entitled_lead_org_ids(); down file and pre-apply test (82 assertions). Authored, not applied |
| `0d7faac` | feat: RFP record step A server - broadcast and magic-link write rfp_records and lines first (fail closed), link inbox rows and tokens to their line, attached_inbox_id, broadcast_at last; 42P01/PGRST205 skip and 42703/PGRST204 column fallback logged once; zod for the new request fields; broadcast verifies the project belongs to the writing org |
| `1008e82` | feat: wizard and Lightning RFP - Show client name to vendors (default off) and per-line Release budget (default hidden), stored on the RFP record; copy says vendors see the change next release, driven by RFP_VENDOR_COPY_SCRUBBED = false |
| `91b1ab2` | docs: RFP record rulings D1-D9 and section 7 (D5 enforcement, write order for 119, link-column guard); feeder section 7 rulings with the 2b exception, 121 or later; state of record, LIGAMENT_CONTEXT, roadmap order (R-D3 applied with v2 after v1 42P01, 118 authored, next to author 119); new rfp-record-test-script |
| (this file) | docs: run report |

Gates: `pnpm exec tsc --noEmit` clean (no output) after every code commit. `pnpm lint`: 0 errors and 0
warnings on `lib/server/rfp-record.ts`, `lib/rfp-record-copy.ts`, both routes. `app/agency/page.tsx`
(9 errors, 2 warnings) and `app/agency/magic-rfp/page.tsx` (4 errors, 1 warning) carry pre-existing
react-hooks findings; every change to those two files is a pure addition (`git diff -U0` hunks are all
`-N,0 +M,K`) and no finding falls on an added line. The full `pnpm lint` exits 1 on pre-existing files.

## 2. STEP 0 answers

### a. The design's section 0 and section 5 references, re-verified on `main` (`f47dc61`)

All hold, with three exceptions (recorded in the design's 2026-10-14 banner):

- `app/api/agency/pool/[partnerId]/route.ts:176` **moved**: `:176` is UI text. The engagement read is
  `:196-204` (select at `:199`) and `buildEngagementHistory(...)` at `:239`.
- `app/api/agency/rfp/magic-link/route.ts:283-328` is `:286-331` (payload `:286`, retry loop to `:331`);
  the inbox row itself is written by the attach call at `:361`, outside that range.
- `app/api/agency/rfp-responses/route.ts:301-325` runs to `:326` (`budget_categories` at `:326`).
- Minor: `lib/rfp-evaluation-criteria-server.ts:76-82` is `:75-83`; `[id]/route.ts:90-92` is `:89-92`;
  `:413-415` is `:412-415`; `:1151` starts at `:1149`. `broadcast-rfp/route.ts:562-566` is a comment.
- Section 5: every listed file exists except the two new ones (`lib/server/rfp-record.ts`, created this
  run; `app/api/agency/rfp-records/[id]/route.ts`, step B, not created). 117 was the highest migration.

### b. How the two routes derive the lead organization and project, and that G1 runs first (pre-step-A `main` lines)

**`app/api/agency/broadcast-rfp/route.ts`:** session client `createClient()` `:67`, `getUser()` `:68-74`
(401). **G1 first:** `agencyGateResponse(user.id, supabase)` `:77-78` (402 `agency_entitlement_required`,
500 on a lookup fault), before any read of the body. Then `resolveCallerOrgIds` `:81` (read scope) and
`resolveCallerWriteOrgId` `:83` (the ACTING organization; 403 if null `:84-86`); capability `can()`
`:99`. **Lead organization** of every inbox row = `writeOrgId` (`:246`, `:391`). **Project** = 
`body.projectId` as sent (`:104-105`), **not verified** on `main`: it was written into every row, and
the inbox INSERT policy checks only `lead_org_id`. Step A now verifies it (section 4).

**`app/api/agency/rfp/magic-link/route.ts`:** `requireAgency()` `:57-72`: session client, `getUser()`
(401), then **G1 first** `agencyGateRefusal(user.id, supabase)` `:64` (402 / 500), before the body is
read. Then the SERVICE client `:80`; `resolveCallerOrgIds(auth.userId, service)` `:91` (403 if empty).
**Project** is verified `:166-178`: `.eq("id", projectId).in("org_id", callerOrgIds)` (404). **Lead
organization** = `resolveCallerWriteOrgId` `:228` (403 if null `:229-232`), written as the token's
`org_id` `:287`.

### c. The live G1 rule (`lib/entitlements.ts`), mirrored by the SQL helper

`resolveAgencyGate()` `lib/entitlements.ts:556-629`:
1. Demo bypass `isDemoDeployment()` `:557` (`NEXT_PUBLIC_IS_DEMO`). **Not mirrorable in SQL.**
2. The acting organization, `resolveActingOrgId()` `lib/acting-org.ts:226-272`: memberships from
   `org_members` by user id (`:161-178`); none -> refuse (`:235-238`); exactly one -> it (`:243-245`);
   several -> `profiles.active_org_id`, used only if it is one of them (`:247-271`), else refuse.
   `org_members` has no status column (079:250-261), so "active membership" is this acting organization.
3. `organizations.is_lead_agency` and `is_paid` read for that one org (`:576-580`); `is_lead_agency !==
   true` refuses (`:613`); `is_paid === true` admits (`:619`); anything else refuses.

`current_user_entitled_lead_org_ids()` (118 lines 350-377) is exactly steps 2 and 3: sole membership,
or `active_org_id` among several, then `is_lead_agency IS TRUE AND is_paid IS TRUE`. Zero or one row.

### d. `partner_rfp_inbox` and `rfp_magic_tokens`

**`partner_rfp_inbox`** (scripts/013:4-25 plus): `id uuid` PK; `lead_org_id uuid NOT NULL` (renamed from
`agency_id` 079:666, NOT NULL 079:987; **the row's lead organization**); `vendor_org_id uuid` (079:667);
`recipient_email text`; `partnership_id uuid`; `project_id uuid`; `scope_item_id text NOT NULL`;
`scope_item_name text NOT NULL`; `scope_item_description text`; `estimated_budget text`; `timeline
text`; `master_rfp_json jsonb NOT NULL DEFAULT '{}'`; `agency_company_name text NOT NULL DEFAULT ''`;
`status text NOT NULL DEFAULT 'new'` (CHECK, 11 values, 099:525-547); `created_at`, `updated_at`;
`response_deadline timestamptz` (041:2); `partner_intent text` CHECK + `intent_set_at` (042); `viewed_at`
(043:2); `invite_token text unique`, `invite_token_expires_at`, `claimed_at`, `nda_gate_enforced boolean`,
`nda_confirmed_at`, `agency_nda_notified_at` (044); `require_terms_disclosure boolean NOT NULL DEFAULT
true` (070:13); `close_bidding_at_deadline boolean NOT NULL DEFAULT false` (076:57); `closed_at` (099:615).

**Policies on `partner_rfp_inbox`** (no DELETE policy):
- "Agencies insert partner RFP inbox rows" INSERT TO authenticated, WITH CHECK `lead_org_id IN
  current_user_org_ids()` (079:1342-1344).
- "Agencies select own partner RFP inbox rows" SELECT, same predicate (079:1346-1348).
- "Partners select inbox rows by partner_id" SELECT `vendor_org_id IN current_user_org_ids()` (079:1352-1354).
- "Partners select inbox rows by recipient email" SELECT, profile email = `recipient_email`
  (scripts/013:50-59; survives 079, see 079:1113).
- **"Agencies update own partner RFP inbox rows" (099)** UPDATE USING and WITH CHECK `lead_org_id IN
  current_user_org_ids()` (099:641-644).
- **"Partners update own inbox rows" (the VENDOR UPDATE policy)** USING `vendor_org_id IN orgs OR
  recipient_email = own profile email` (079:1356-1364); WITH CHECK (099:748-839): (A) the same ownership
  arms, (B) `vendor_org_id` NULL or one of the caller's own orgs, (C) `status` unchanged, or
  `'bid_submitted'` from a row not `closed` / `not_selected`.

**What a vendor can change today:** every column of its own row (the policy has no column list),
subject only to (A)-(C). That includes `viewed_at`, `partner_intent`, `intent_set_at`, `nda_confirmed_at`,
`agency_nda_notified_at`, `claimed_at`, `vendor_org_id` (to its own org), the `bid_submitted` status,
**and also `lead_org_id`, `master_rfp_json`, `estimated_budget`, `scope_item_*`, `response_deadline`**,
which nothing constrains. 118 does not change that, except that the link columns are now refused and a
`lead_org_id` change on a row that already carries a link fails rule 2 (section 6, finding F1).

**`rfp_magic_tokens`** (no CREATE TABLE in the repository; LIGAMENT_CONTEXT): `org_id uuid NOT NULL`
(renamed from `agency_id` 079:658, NOT NULL 079:982; **the token's lead organization**), `project_id`,
`vendor_email`, `vendor_name`, `scope_item_id uuid` nullable, `token`, `expires_at`, `status`,
`submitted_at`, `response_id`, `created_at` (from code); `scope_item_name`, `scope_item_description text`
(057:11-12); unique `(org_id, project_id, vendor_email)` (057:17); `reference_materials jsonb DEFAULT
'[]'` (059:3); `business_criteria_required jsonb DEFAULT '{}'` (060:16); `pool_status text`,
`domain_match_profile_id uuid` (061:22-23); `require_terms_disclosure boolean NOT NULL DEFAULT true`
(070:16); `budget_categories jsonb` (072:64); `response_deadline timestamptz` (074:15);
`evaluation_criteria jsonb` (075:46); `close_bidding_at_deadline boolean NOT NULL DEFAULT false`
(076:60). **Policy:** "Agency can manage their own tokens" FOR ALL TO authenticated USING `org_id IN
current_user_org_ids()` (079:1666-1668), WITH CHECK adds the project's `org_id = org_id` (114:178-185).
No vendor policy.

**Type mismatches against the design sketch:** none. Two ON DELETE adjustments were made and are named
in 118's header: `rfp_magic_tokens.attached_inbox_id ON DELETE SET NULL` (the attach collapse deletes
duplicate inbox rows, `lib/magic-token-attach.ts:195`; NO ACTION would make that delete fail forever),
and `rfp_records.created_by ON DELETE SET NULL` (NO ACTION would block deleting the sender's account).

## 3. Migration 118

`supabase/migrations/118_rfp_records.sql`, one `BEGIN;` (line 280) and **`COMMIT;` alone on line 845**.
It adds:
- `current_user_entitled_lead_org_ids()` (lines 350-388): SECURITY DEFINER, STABLE, `SET search_path =
  public, pg_temp`; REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated.
- `rfp_records` (394-417) and `rfp_record_lines` (438-449) exactly as the design's section 1, plus
  indexes and comments.
- `rfp_records_guard` (471-542): lead_org_id immutable; D5 snapshot (whole-row compare minus the
  allow-list); broadcast_at fixed once set; D7 SET NULL admitted only when the project (or user) is gone;
  `updated_at := clock_timestamp()`. SECURITY DEFINER only for the existence checks.
- `rfp_record_lines_guard` (551-602): lead_org_id from the parent, rfp_id pinned, no line insert or update
  once the parent is sent. SECURITY INVOKER.
- Grants (609-618): REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT, UPDATE TO
  authenticated; GRANT ALL TO service_role.
- RLS (627-666): 3 policies per table, TO authenticated, all through the helper; rfp_records INSERT and
  UPDATE WITH CHECK also require `project_id IS NULL OR` the project's `org_id = lead_org_id`. No DELETE,
  vendor or anon policy.
- The five link columns (672-683), nullable, no default, no backfill, with indexes.
- The link-column guards (704-840), with the header's rules (1)-(3). Header states the write order every
  writer must follow (record, lines, vendor rows, attached_inbox_id, broadcast_at LAST).
- `NOTIFY pgrst, 'reload schema'`.

**Down file** `118_rfp_records_down.sql` (BEGIN 37, COMMIT 89): refuses (LG118) while any record exists
or any link column holds a value, unless `SET LOCAL ligament.allow_drop_rfp_records = 'on'`. The header
says plainly that forcing it loses every record and every link.

**Pre-apply test** `118_preapply_test.sql`, 116/117 format (phase 1 before, phase 2 after, policy/ACL/row/
trigger fingerprints, isolation check, NOT DISCRIMINATING flags, one RAISE carrying the result).
**Expected assertion count: 82** (72 scenarios + 9 self-checks + M). **INCONCLUSIVE by design: U1, U2**
(unpaid lead agency) **and X1, X2** (second paid lead agency): NO SUBJECT today; the headline still reads
"SAFE TO APPLY 118." when they are the only INCONCLUSIVE rows. NOT DISCRIMINATING by design: K3, K4 (the
vendor's existing updates, accepted in both phases). The 2026-10-14 lessons are applied: subjects through
`partnerships.vendor_org_id`; `"char"` columns cast to text; no temp table or `pg_temp` function; the
RAISE is the result. **Not run** (no database here). **The inlined migration body was copied by hand**
(shell redirection and hashing were denied): 562 lines in both, byte identity NOT machine-verified.

## 4. Step A

New `lib/server/rfp-record.ts`: `createRfpRecordDraft` (:180), `markRfpRecordBroadcast` (:277),
`setLinkColumn` (:305), `withColumnFallback` (:81), the zod schemas (:118, :126).
**Fallbacks:** 42P01 / PGRST205 -> `status: "skipped"` (:209-211, :248-252), logged once per process
(`logRecordTableMissingOnce` :60); 42703 / PGRST204 -> drop the named column and retry, logged once per
column (`missingColumnName` :50, `logColumnMissingOnce` :69). Anything else -> `status: "failed"`.
Lead org and project are passed in by the routes, server-derived; lines never send `lead_org_id`.

**Broadcast (`app/api/agency/broadcast-rfp/route.ts`):** G1 `:87` -> zod `:116` (400) -> project verified
against `writeOrgId` `:183-201` (404 / 500) -> validation loop builds rows and record lines -> **(1)+(2)**
`createRfpRecordDraft` on the session client `:547` -> **FAIL CLOSED** `:571` (500, nothing sent) ->
**(3)** every row gets its `rfp_line_id` `:581` -> inbox insert `:587` (rfp_line_id fallback `:588-595`,
then the existing close_bidding 42703 retry `:600-607`) -> on insert failure the existing 500 and
broadcast_at stays unset -> **(5)** `markRfpRecordBroadcast` `:625` -> cue, milestones, emails as before.
No step (4) on this route.

**Magic link (`app/api/agency/rfp/magic-link/route.ts`):** G1 inside `requireAgency()` `:74` -> zod `:112`
(400) -> project verified `:187-199` -> `writeOrgId` `:249` -> **(1)+(2)** `createRfpRecordDraft` on the
SESSION client `:263` -> **FAIL CLOSED** `:302` (500 before the token is written or any mail leaves) ->
**(3)** token upsert carrying `rfp_line_id` `:386` (fallback `:402-411`) -> attach (unchanged helper)
`:454` -> **(3)** inbox row `rfp_line_id` `:480` and **(4)** token `attached_inbox_id` `:485` (service
client) -> email -> **(5)** `markRfpRecordBroadcast` `:537` only when the token was written, the vendor
was reached (email sent or portal attach), and the link writes succeeded.

`output_template_config` is written onto the magic-link record (D9); the token keeps its copy.
The wizard route writes `null` (the wizard does not send one; see assumptions).

**UI.** `lib/rfp-record-copy.ts`: `RFP_VENDOR_COPY_SCRUBBED = false` and the four strings derived from it.
Wizard `app/agency/page.tsx`: state `:640-641`; sent `:1285`, `:1306`, `:1336-1338` (the wizard's own
magic-link sends carry the same choices); per-line "Release budget to this line's vendors" `:2904-2918`
(shown only for a line with an estimated budget); "Show client name to vendors" `:2970-2981`; reset in
`resetFlow`. `/agency/magic-rfp`: state `:173-174`, sent `:613-615`, controls `:1048-1072`. Both default
off. `client_name_released` is not written anywhere.

## 5. Vendor-facing paths

The three vendor reads that select WHOLE `partner_rfp_inbox` rows and pass them to the browser, so they
now also return `rfp_line_id` and `client_name_released` (both NULL until step B/119):

| path | read | returned |
|---|---|---|
| `GET /api/partner/rfps` | `app/api/partner/rfps/route.ts:231-234` `.select("*")` (session) | rows spread into `mergedRows` `:333-344`, returned `:346` (feeds `components/partner-rfp-surface.tsx`) |
| `GET /api/partner/rfps/[id]` | `app/api/partner/rfps/[id]/route.ts:23-27` `.select("*")` (session) | `inbox: { ...inboxWithViewed }` `:251` |
| `GET /api/partner/rfps/[id]` (first view) | same file `:71-78` `.update({ viewed_at }).select("*")` | same `:251` |

Also, as a property of RLS rather than a code path: any vendor calling PostgREST directly with
`select=*` on its own inbox rows sees the two columns. No vendor or guest path selects whole
`rfp_magic_tokens` rows (the guest route uses fixed lists, `app/api/rfp/guest/[token]/route.ts:172-191`).

**Nothing else vendor-facing changed.** Files changed by this run: `supabase/migrations/118_*` (3),
`lib/server/rfp-record.ts`, `lib/rfp-record-copy.ts`, `app/api/agency/broadcast-rfp/route.ts`,
`app/api/agency/rfp/magic-link/route.ts`, `app/agency/page.tsx`, `app/agency/magic-rfp/page.tsx`, and docs.
No file under `app/api/partner/`, `app/api/rfp/`, `app/partner/`, `app/rfp/`, or `lib/magic-token-attach.ts`
changed. Vendor emails, notifications and the guest page are unchanged (the agency-side route writes
change only what the agency's own tables hold, plus the two link columns no vendor screen reads).

## 6. SECURITY REVIEW LIST

| # | What | Where | Scope / why it is safe |
|---|---|---|---|
| S1 | New function `current_user_entitled_lead_org_ids()` | 118:350-388 | SECURITY DEFINER, STABLE, pinned search_path, no parameters, reads `auth.uid()` only; returns the caller's acting org iff paid lead agency. EXECUTE: authenticated only (PUBLIC, anon revoked). Pre-apply S5, H1, H2, N4. |
| S2 | New table `rfp_records` | 118:394-417 | Agency-only. RLS SELECT/INSERT/UPDATE TO authenticated via S1; INSERT/UPDATE WITH CHECK project belongs to lead org. No DELETE, vendor or anon policy. R1-R7, V1-V7, N1-N3, D1, U1-X2. |
| S3 | New table `rfp_record_lines` | 118:438-449 | Same RLS via S1 on `lead_org_id`, which the guard copies from the parent (never the caller). R3, R4, V2, V4, V6, D2, G1-G3. |
| S4 | Grants on S2/S3 | 118:609-618 | REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT, UPDATE TO authenticated; ALL TO service_role. No DELETE/TRUNCATE/REFERENCES/TRIGGER for authenticated. S3 check. |
| S5 | 6 policies | 118:627-666 | All TO authenticated, all on S1. S4 check. Public policy count 155 -> 161. |
| S6 | Trigger `rfp_records_guard` | 118:471-542 | Every caller. lead_org_id immutable; D5 freeze by whole-row compare minus allow-list; broadcast_at fixed; D7 exception only when the referenced row is gone. SECURITY DEFINER for existence checks only; EXECUTE revoked from PUBLIC, anon, authenticated. F1-F15, W1-W5, B1-B2, D7. |
| S7 | Trigger `rfp_record_lines_guard` | 118:551-602 | Every caller. Parent read under caller RLS; lead_org_id forced; rfp_id pinned; lines frozen after send. INVOKER; EXECUTE revoked. L1-L2, G1-G3, V4. |
| S8 | Columns `partner_rfp_inbox.rfp_line_id`, `client_name_released` | 118:672-674 | Nullable, no default, no backfill. Covered by the table's existing grants and policies: vendors READ them (accepted, section 5) and cannot WRITE them (S10). |
| S9 | Columns `rfp_magic_tokens.rfp_line_id`, `attached_inbox_id` (SET NULL), `client_name_released` | 118:676-679 | Nullable. Agency-only table (no vendor policy). S11. |
| S10 | Trigger `partner_rfp_inbox_link_columns_guard` | 118:704-763 | Link columns writable only by a member of the row's lead org (before and after) or a trusted path; rfp_line_id must be a line of the same lead org. Vendor writes that leave the link columns alone pass untouched. K1-K10, K14-K15. |
| S11 | Trigger `rfp_magic_tokens_link_columns_guard` | 118:765-840 | Same rules on `org_id`; plus attached_inbox_id must be an inbox row of the same org. K11-K13, K16. |
| S12 | Down file | `118_rfp_records_down.sql` | Refuses while records or links exist; forcing loses them (stated). |
| S13 | `lib/server/rfp-record.ts` | whole file | Writes only; no body reads; lead org and project passed in server-derived; record and lines on the caller's SESSION client (RLS applies); fallbacks only for 42P01/PGRST205/42703/PGRST204. |
| S14 | Broadcast route | `broadcast-rfp/route.ts:116`, `:183-201`, `:547-625` | G1 unchanged and first. New: zod for 2 fields; project verified against `writeOrgId` (a NARROWING: a foreign `projectId` is now 404, it used to be written into inbox rows); fail closed on record failure. |
| S15 | Magic-link route | `rfp/magic-link/route.ts:112`, `:263-302`, `:386-411`, `:476-488`, `:537` | G1 unchanged and first. Record on the session client (RLS) although the route otherwise uses the service role; link writes on the service client scoped by the token/inbox ids the route itself just wrote. Fail closed on record failure. |
| S16 | Wizard and Lightning pages | `app/agency/page.tsx`, `app/agency/magic-rfp/page.tsx` | Client sends booleans and one short text; the server validates (zod) and decides. No new data read. |

**Findings (not fixed; outside the brief):**
- **F1** The vendor UPDATE policy does not constrain `lead_org_id`, `master_rfp_json`,
  `estimated_budget` or `scope_item_*` (099's WITH CHECK constrains ownership, `vendor_org_id` and
  `status` only). A vendor can rewrite those on its own inbox row today. 118 refuses the link columns
  and, by rule 2, a `lead_org_id` change on a row that already carries `rfp_line_id`; the rest is
  unchanged. Step C / 120's guard is the natural place.
- **F2** On a demo deployment (`NEXT_PUBLIC_IS_DEMO`), G1 admits everyone but the record's RLS does not,
  so after 118 a demo caller who is not a paid lead agency gets the fail-closed 500 on broadcast and
  magic-link sends. Production is unaffected.

## 7. REFUSED, ASSUMPTIONS, STOPPED ON

**Refused / not done (out of scope or not possible):**
- No push, merge, SQL apply or SQL run. The pre-apply test is unrun; expect a typo on its first run.
- No change to any agency reader, vendor route, `lib/magic-token-attach.ts`, inbox scrub, or
  `supabase/data-fixes/`. No new route. `client_name_released` is not written.
- The machine comparison of the test's inlined migration body was denied (redirects, `shasum`).
- The R-D3 v2 data-fix the owner ran is not in the repository; only v1 is (`supabase/data-fixes/`).

**Assumptions (each reversible; none changes vendor behaviour):**
1. **"A send succeeded"** for broadcast_at: broadcast = the inbox insert (one statement, all rows or
   none); emails are not "sends" for this purpose (they were already best-effort). Magic link = the token
   written, the vendor reached (email sent or portal attach), and the link writes succeeded. An email
   failure on the magic-link route therefore leaves the record an unsent draft while the token exists.
2. **broadcast_at is set right after the inbox insert** on the broadcast route (before cue, milestones
   and email), so a crash during email does not leave a sent RFP looking like a draft.
3. **The broadcast route now verifies `projectId`** belongs to `writeOrgId` (404 otherwise), before
   anything is written, on either side of 118. Needed for "server-derived project" and for 118's WITH
   CHECK; it only refuses a project of another organization.
4. **Each magic-link POST is its own record (D4, D6)**, including the ones the wizard sends for
   "Send as Magic Link" recipients, and a resend. On a resend the token and its attached inbox row move to
   the newest record's line (the token's content is the newest send's); the old record keeps its line.
5. **Magic-link line:** key = the request's `scope_item_id` or `"magic"`; `estimated_budget` = the new
   optional request field (the wizard sends the scope line's estimate; `/agency/magic-rfp` sends the
   brief's budget range) or else `projects.budget_range`; `released_budget` = that figure only when
   `release_budget` is true. `total_budget` = `projects.budget_range`; `client_name_snapshot` =
   `projects.client_name`.
6. **Wizard record:** `master_rfp` = the normalized master as sent; `total_budget` = its `totalBudget`;
   `client_name_snapshot` = the verified project's `client_name`, else the master's `client`;
   `output_template_config` = null (the wizard sends none to this route).
7. **`require_terms_disclosure` on a magic-link resend that omits it** is recorded as `true` (the column
   default); the token keeps its original value, as before.
8. **The two UI choices are not saved in the wizard's localStorage draft**: a reload resets them to off,
   which is the safe direction.
9. **The release control is shown only for wizard lines with an estimated budget** (nothing to release).
10. **The link-column guard's trusted path** is `auth.uid() IS NULL AND current_user NOT IN ('anon',
    'authenticated')`: 091's test plus a role term that is meaningful in an INVOKER function.
11. **The pre-apply test's headline** reads "SAFE TO APPLY 118." when the only INCONCLUSIVE rows are the
    four by-design NO SUBJECT rows, and names them.

**Stopped on:** nothing. No scope question was left open that changes vendor behaviour; the readings
above are recorded for the owner to overrule.

## 8. Addendum 2026-10-14 (branch `feat/rfp-record-a2`): closing F1 in 118 - STOPPED AT STEP 0

**Result: STOP CONDITION HIT. Migration 118 and its down file and pre-apply test are UNCHANGED. F1 is
still OPEN.** 118 is still unapplied, `COMMIT;` is still on line 845, the expected assertion count is
still 82, and no `-- >>> 118 BODY START` / `-- <<< 118 BODY END` markers were added. This section is
the only change on the branch.

F1 background: found 2026-10-14 (section 6). The owner checked the 97 inbox rows on 2026-10-14 and
found no sign of exploitation.

### 8a. Every vendor-session write to `partner_rfp_inbox`

All five use `createClient()` from `lib/supabase/server` (the vendor's session, RLS applies). None is
an INSERT. No browser-side Supabase call in `app/partner/**` or `components/**` writes this table (every
match there is a type or a comment); no SQL function in `supabase/migrations/` or `scripts/` writes it.

| # | Site | Verb | Columns written | Fits the brief's allow-set? |
|---|---|---|---|---|
| V1 | `app/api/partner/rfps/[id]/route.ts:71-78` (first view) | UPDATE | `viewed_at` | yes, viewing-state timestamp |
| V2 | `app/api/partner/rfps/[id]/intent/route.ts:92-99` | UPDATE | `partner_intent`, `intent_set_at` | yes, arguably (response-state value and its timestamp) |
| V3 | `app/api/partner/rfps/[id]/nda-notify/route.ts:115-118` | UPDATE | `agency_nda_notified_at`, `updated_at` | yes, arguably (records the vendor's own NDA notification) |
| V4 | `app/api/partner/rfps/[id]/response/route.ts:380-383` (on submit) | UPDATE | `status` (`'bid_submitted'`), `updated_at` | yes |
| **V5** | **`app/api/partner/rfps/claim/route.ts:76-84`** (`claimByToken`, from POST `:140` and GET `:178`) | UPDATE | **`vendor_org_id`** (= `resolveCallerWriteOrgId`, `:37`), `claimed_at`, `updated_at` | **NO: `vendor_org_id` is an ownership column, not a viewing/response timestamp or flag** |

`nda_confirmed_at`, which 099's comment (099:799-803) lists among vendor writes, has no vendor writer
in the current code; the only writer is the agency broadcast INSERT (`app/api/agency/broadcast-rfp/route.ts:460`).

### 8b. Service-role writers (exempt, bypass RLS)

| Site | Verb | Runs on behalf of | Column values from |
|---|---|---|---|
| `lib/magic-token-attach.ts:167` merge, `:195` delete, `:356` insert, `:395` heal | UPDATE / DELETE / INSERT | callers below | the agency-written `rfp_magic_tokens` row, plus `partnerId` |
| caller `app/api/partner/rfps/route.ts:72` (sweep, from `:190`) | | vendor (login sweep) | `partnerId` = `resolveCallerWriteOrgId` (server-derived); tokens matched by the caller's own email |
| caller `app/api/partner/rfps/bids/route.ts:56` (from `:122`) | | vendor | same |
| caller `app/api/rfp/guest/[token]/attach-existing-account/route.ts:77` | | vendor | `partnerId` = `resolveCallerWriteOrgId` `:71`; token's `vendor_email` must equal the account email `:61-64` |
| caller `app/api/agency/rfp/magic-link/route.ts:454` | | agency | agency request, server-validated |
| `lib/server/rfp-record.ts:305` `setLinkColumn`, from `app/api/agency/rfp/magic-link/route.ts:480` | UPDATE | agency | `rfp_line_id` the route itself just wrote |

Three of these run on behalf of a vendor, but **no column value is vendor-chosen**: every value is
either copied from the agency's token row or is the server-resolved acting organization. No request
body field reaches an inbox column. The agency session writers (`broadcast-rfp/route.ts:587-606`
INSERT, `broadcast-rfp/resend-invite/route.ts:76`, `rfp-closure/route.ts:189-190`,
`rfp-responses/[id]/route.ts:766-767`) are not vendor paths.

### 8c. The 099 vendor UPDATE policy as live after 099

USING, from `supabase/migrations/079_organizations.sql:1356-1364` (099 does not name it):

```sql
CREATE POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    vendor_org_id IN (SELECT public.current_user_org_ids())
    OR (recipient_email IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = auth.uid()
            AND lower(btrim(pr.email)) = lower(btrim(partner_rfp_inbox.recipient_email))))
  );
```

WITH CHECK, from `supabase/migrations/099_rfp_closure.sql:748-839` (comments removed):

```sql
ALTER POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox
  WITH CHECK (
    (
      vendor_org_id IN (SELECT public.current_user_org_ids())
      OR (recipient_email IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid()
              AND lower(btrim(pr.email)) = lower(btrim(partner_rfp_inbox.recipient_email))))
    )
    AND (
      vendor_org_id IS NULL
      OR vendor_org_id IN (SELECT public.current_user_org_ids())
    )
    AND (
      status = public.partner_rfp_inbox_status_before(id)
      OR (
        status = 'bid_submitted'
        AND public.partner_rfp_inbox_status_before(id) <> 'closed'
        AND public.partner_rfp_inbox_status_before(id) <> 'not_selected'
      )
    )
  );
```

### 8d. Why the run stopped

The brief's stop condition: any vendor-session UPDATE of a column outside {`status`, `updated_at`, and
timestamp or flag columns whose only purpose is recording the vendor's own viewing/response state}.
V5, the invitation claim, writes `vendor_org_id` on the vendor's session. That is an identity column
(099's clause B exists to constrain it), not a viewing/response marker. The brief says not to widen the
allow-list beyond that set on my own judgement, so 118 was not changed. A deny-by-default guard built
on that set alone would refuse every invitation claim on the platform with 42501.

### 8e. Owner decision needed (pick one; nothing below is implemented)

1. **Admit `vendor_org_id` and `claimed_at` on the claim transition only:** the guard allows them to
   change only when `OLD.claimed_at IS NULL AND OLD.vendor_org_id IS NULL` and
   `NEW.vendor_org_id IN current_user_org_ids()` (099 clause B still applies). This also closes the
   gap 099:783-790 names (moving a claimed row between two of the caller's orgs). Smallest change;
   keeps the claim on the session client.
2. **Move the claim to the service role** after the route's own email and token checks, and keep the
   vendor allow-list to V1-V4. Application change, outside this run's limits.
3. Admit `vendor_org_id` unconditionally (weakest; not recommended).

Also for the owner: whether `partner_intent` (V2) and `agency_nda_notified_at` (V3) count as
"viewing/response state". I read them as yes; they would be on the allow-list with `viewed_at`,
`intent_set_at`, `status` and `updated_at` once V5 is ruled on.

### 8f. Not done

No change to 118, its down file or its test; no markers; no assertion count or COMMIT line change;
`docs/rfp-record-test-script.md`, the state of record and `LIGAMENT_CONTEXT.md` were not updated
because they would describe F1 as closed, and it is not. No application code changed.
