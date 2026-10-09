# Live policy audit query, 2026-10-09

File: `scripts/sql/audit-live.sql`. One read-only `SELECT` (CTEs only) for the Supabase SQL Editor. It
returns one row per finding with columns `section, object, finding, detail, severity`, sorted by section,
then severity (CRITICAL, HIGH, MEDIUM, REVIEW, LOW, INFO, OK), then object.

**Not parse-checked.** No SQL parser or database was available when it was written. The owner's SQL
Editor run is the parse check. It writes nothing, so a failed run costs nothing; the error names the line.

**Supersedes `scripts/audit-policy-snapshot.mjs` for live checks.** That script reads the frozen
2026-08-13 snapshot (`docs/schema-snapshot-2026-08-13.md`) and cannot see anything created after it
(079 onward, including 105-112). It is left unchanged.

## How to run

SQL Editor, New query, paste the whole file, Run. Export the grid as CSV to keep it. Read the `0 meta`
row first: it records the role, server version and whether that role bypasses RLS (the E2 row counts
are only complete if it does or if it owns the tables, which `postgres` does).

## Sections

### 0 meta
One row: `current_user`, `server_version`, `rolsuper`, `rolbypassrls`, whether the `anon` and
`authenticated` roles exist, run timestamp.

### A1 tables
One row per `public` table (relkind `r`/`p`). `finding`: RLS on/off, FORCE RLS, policy count.
`detail`: the privileges `anon` and `authenticated` hold (via `has_table_privilege`, so grants through
PUBLIC count), and the flagged subset TRUNCATE / DELETE / REFERENCES / TRIGGER.

| Severity | Meaning |
|---|---|
| CRITICAL | RLS is OFF and anon or authenticated holds SELECT/INSERT/UPDATE/DELETE: the table is open through PostgREST. |
| HIGH | anon or authenticated holds TRUNCATE. TRUNCATE ignores RLS entirely. PostgREST exposes no TRUNCATE verb, so this is reachable only through a SQL path (an invoker function that runs dynamic SQL, a future RPC), but it is the Supabase default and should be revoked. Expected on most tables per the owner's 2026-10-09 finding. |
| MEDIUM | REFERENCES or TRIGGER held (lets the role build FKs/triggers against the table if it can ever run DDL). |
| LOW | DELETE held with RLS on: governed by DELETE policies; listed so a missing DELETE policy is a conscious choice. |
| INFO | RLS on with zero policies: deny-all to non-owners (e.g. a table only the service role touches). |

### A2 views
Every public view and materialized view. A view without `security_invoker=on` runs as its owner, so RLS
on the underlying tables is evaluated as the owner (postgres bypasses it). A materialized view cannot
have RLS at all. HIGH when anon or authenticated can SELECT such a view.

### B counterparty SELECT policies
Every `SELECT` or `ALL` policy in `public` whose `USING` text matches a counterparty marker, or whose
`USING` is `true` / absent. Markers: `vendor_org_id`, `partner_org_id`, `partner_id`, `vendor_id`,
`partner_user_id`, the word `partner`, `partner_rfp_inbox`, `partnerships`, and the helper functions the
migrations create: `current_user_counterparty_org_ids`, `current_user_visible_profile_ids`,
`current_user_active_counterparty_user_ids` (079), `current_user_commercial_counterparty_org_ids` (085),
`current_user_commercial_counterparty_user_ids` (096), `vendor_visible_event_types` (080),
`current_user_email` (089).

`detail` carries the full `USING` text, whether authenticated/anon hold **table-level** SELECT (if yes,
the policy exposes the whole row; column-level grants would show as "false"), the columns whose names
look agency-private (note, summary, score, feedback, internal, private, margin, blacklist, rating,
variance, would_work_again, `ai_*`), the known nulled legacy columns (106/108/110/112) separately, and
the complete column list.

| Severity | Meaning |
|---|---|
| HIGH | Open `USING` for anon/PUBLIC, or a counterparty policy on a table with agency-private-looking columns and table-level SELECT for authenticated. Read the column list: Postgres has no per-column RLS, so the vendor sees every column. |
| MEDIUM | Open `USING` for authenticated only. |
| REVIEW | Counterparty match, no private-looking columns. The match is textual and over-inclusive (an agency policy that joins `partnerships` also matches). |
| INFO | RESTRICTIVE policy (narrows, never widens). |

### C security definer functions
Every `SECURITY DEFINER` function/procedure in `public`. `finding` lists: search_path NOT pinned
(`proconfig` has no `search_path=`), EXECUTE by anon (`has_function_privilege`), EXECUTE by PUBLIC (an
`aclexplode` entry with grantee 0, using `acldefault` when `proacl` is NULL, which means PUBLIC has
EXECUTE). `detail`: proconfig, EXECUTE for anon/authenticated/PUBLIC, trigger-function flag, owner,
extension membership.

| Severity | Meaning |
|---|---|
| HIGH | search_path not pinned: object resolution can be hijacked by the caller's search_path. |
| MEDIUM | Callable by anon or PUBLIC, not a trigger function. Many helpers (e.g. `current_user_org_ids`) are meant to be callable by authenticated; anon should usually not need them. |
| LOW | Same, but a trigger function (cannot be called directly). |

### D1 migration status / D2 probe detail
D1: one row per migration, object reads `071: applied` / `not applied` / `partially applied`, with
"k of n probes present" and the per-probe list. Applied = every probe present; not applied = none;
partially = mixed (severity HIGH: stop and read the migration). D2: one row per probe with its source
line and, for columns, the observed type and nullability.

Probes (paths under `supabase/migrations/`):

| Mig | Probe | Source |
|---|---|---|
| 071 | column `partner_rfp_responses.business_criteria_acknowledgments` | `071_requirement_tiers.sql:34-35` (the only DDL in the file) |
| 074 | column `rfp_magic_tokens.response_deadline` | `074_magic_token_response_deadline.sql:14-15` (the only DDL) |
| 075 | column `rfp_magic_tokens.evaluation_criteria` | `075_rfp_evaluation_criteria.sql:45-46` |
| 075 | `bid_evaluation_scores.criterion_id` is NULLABLE | `075_rfp_evaluation_criteria.sql:63-64` |
| 075 | column `bid_evaluation_scores.rfp_criterion_key` | `075_rfp_evaluation_criteria.sql:66-67` |
| 075 | column `bid_evaluation_scores.criterion_name_snapshot` | `075_rfp_evaluation_criteria.sql:72-73` |
| 075 | constraint `bid_evaluation_scores_exactly_one_criterion` | `075_rfp_evaluation_criteria.sql:77-89` |
| 075 | index `bid_evaluation_scores_one_per_rfp_criterion` | `075_rfp_evaluation_criteria.sql:94-96` |
| 076 | column `partner_rfp_responses.proposal_sections` | `076_structured_proposal_and_bid_close.sql:37-38` |
| 076 | column `partner_rfp_inbox.close_bidding_at_deadline` | `076_structured_proposal_and_bid_close.sql:56-57` |
| 076 | column `rfp_magic_tokens.close_bidding_at_deadline` | `076_structured_proposal_and_bid_close.sql:59-60` |
| 077 | table `clients` | `077_client_profiles.sql:36-55` |
| 077 | index `clients_agency_id_idx` | `077_client_profiles.sql:57` |
| 077 | index `clients_agency_lower_name_idx` | `077_client_profiles.sql:64` |
| 077 | column `agency_library_documents.client_id` | `077_client_profiles.sql:93-94` |
| 077 | index `agency_library_documents_client_id_idx` | `077_client_profiles.sql:96-98` |
| 077 | column `projects.client_id` | `077_client_profiles.sql:111-112` |
| 077 | index `projects_client_id_idx` | `077_client_profiles.sql:114` |
| 078 | `handle_new_user` has `search_path=` in proconfig | `078_signup_role_trigger.sql:140` |
| 078 | `handle_new_user` body contains `raw_user_meta_data->>'role'` | `078_signup_role_trigger.sql:149-152` |
| 078 | `handle_new_user` body contains `other_role` | `078_signup_role_trigger.sql:154` |
| 078 | `handle_new_user` body lacks `greg@withligament.com` | `078_signup_role_trigger.sql:156-160`; 056 had it at `056_default_dual_role_access.sql:26-27` |

Notes that shape the reading:

- **077**: the policy "Agencies manage own clients" is deliberately not probed, because 079 drops and
  recreates it (`079_organizations.sql:534`, `:1196`); its presence proves nothing about 077. The
  column `clients.agency_id` is not probed either: 079 renames it to `org_id` (`079:652`). Index names
  survive a column rename. Because 079's `DROP POLICY` on `public.clients` has no `IF EXISTS`, 079 being
  applied (per owner) already implies 077 was.
- **078**: superseded, must never be run (079 PHASE 12 `CREATE OR REPLACE`s the same function and adds
  organization creation). Every 078 probe is a behaviour 079 PHASE 12 carries forward
  (`079_organizations.sql:1841-1883`), so "078: applied" means "078's behaviour is live", not "the 078
  file body is live". Two extra D2 context rows say which body is live: `org_members` in `prosrc` means
  the 079 body (expected; CRITICAL otherwise, since post-079 signups would get no organization), and
  whether a trigger on `auth.users` calls `handle_new_user` and is enabled (`tgenabled` O or A).
  A probe for the absence of `is_paid` was considered and dropped: both the 078 and 079 bodies mention
  `is_paid` in a comment, and `prosrc` includes comments.
- **071 / 076** corroboration: `109_preapply_test.sql:319` selects `business_criteria_acknowledgments`
  and `proposal_sections` from `partner_rfp_responses`, and the 109 pre-apply test ran green, so both
  columns very likely exist. The probe settles it.
- **074**: prior evidence (live token rows with real `response_deadline` values, Aug 11) is in
  `LIGAMENT_CONTEXT.md`.

What to do with the result: update the migrations table in `LIGAMENT_CONTEXT.md` and the CURRENT STATE
table in `docs/roadmap-state.md` for each of 071 and 074-078 ("applied, catalog-verified <date>" or
"not applied"). A "partially applied" result (most plausible for 075) needs a read of the migration
before anything is re-run; 075 and 076 are written idempotently (`IF NOT EXISTS`, guarded constraint),
but that has not been executed.

### E1 guards
One row per guard trigger, checking: table exists, trigger exists (non-internal, by name), `tgenabled`
not `D` (disabled) and not `R` (replica-only, which does not fire in normal sessions), BEFORE, FOR EACH
ROW, fires on INSERT and UPDATE (`tgtype` bits 2, 1, 4, 16), the trigger calls the expected function,
the function exists, is NOT `SECURITY DEFINER` (all six were authored as invoker), has `search_path`
pinned, and EXECUTE is not held by anon, authenticated or PUBLIC (each migration revokes all three).

| Mig | Trigger / function | Table | Source |
|---|---|---|---|
| 110 | `partner_rfp_responses_private_columns_guard` | `partner_rfp_responses` | `110_partner_rfp_response_private_null.sql:194-230` |
| 112 | `delivery_reviews_private_columns_guard` | `delivery_reviews` | `112_delivery_review_private_null.sql:148-186` |
| 105 | `partnership_private_notes_guard` (106 depends on it) | `partnership_private_notes` | `105_partnership_private_notes.sql:252-289` |
| 107 | `partnership_private_reliability_guard` (108 depends on it) | `partnership_private_reliability` | `107_partnership_private_reliability.sql:255-292` |
| 109 | `partner_rfp_response_private_guard` (110 depends on it) | `partner_rfp_response_private` | `109_partner_rfp_response_private.sql:276-318` |
| 111 | `delivery_review_private_guard` (112 depends on it) | `delivery_review_private` | `111_delivery_review_private.sql:258-299` |

**106 and 108 created no guard object.** Each is a drift pre-flight, one `UPDATE ... SET NULL` and a
verify block, all inside one transaction (`106_partnership_notes_null.sql:93-132`,
`108_partnership_reliability_null.sql:111-159`). Nothing persists to probe. 110 records the gap
(`110_partner_rfp_response_private_null.sql:79`: "Neither 106 nor 108 added such a guard to
partnerships"). Their coverage is E2.

Severity: CRITICAL = table, trigger or function missing, or trigger disabled. HIGH = replica-only, wrong
timing/events, or calls a different function. MEDIUM = SECURITY DEFINER, unpinned, or EXECUTE granted.
OK = as authored.

### E2 nulled legacy columns
One row per nulled column group: `partnerships.partnership_notes` (106),
`partnerships.reliability_summary, reliability_summary_generated_at` (108),
`partner_rfp_responses.composite_score, ai_summary_short, ai_summary_detailed, ai_summary_generated_at`
(110), `delivery_reviews.on_time_notes, on_budget_notes, client_feedback, ai_delta_summary,
would_work_again, budget_variance_pct` (112). Reports the count of rows still holding a value (run
through `query_to_xml`, a read-only `SELECT count(*)`, skipped if a column no longer exists) and every
**enabled** trigger on the table whose function body names the first column of the group.

| Severity | Meaning |
|---|---|
| CRITICAL | Rows hold a value again: the leak is reopened. Find the writer before anything else. |
| MEDIUM | Zero rows, but no enabled trigger guards the columns (expected for 106 and 108): a later write could repopulate them unnoticed. A 110-style guard on `partnerships` would close it; that is a migration (113+), not done here. |
| OK | Zero rows and a guard is present. |
| INFO | A column in the group no longer exists (dropped): the count is skipped. |

The trigger match is a text search of the function body, so a trigger whose body only mentions the
column (in a comment, say) would be listed too; the name is printed so it can be checked.
