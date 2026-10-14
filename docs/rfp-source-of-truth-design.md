# Agency-owned RFP record: design only, 2026-10-12

> **UPDATED 2026-10-14 (feat/rfp-record-b).** **118 is applied and catalog-verified (2026-10-14); F1 is
> closed in production.** **Step B and migration 119 are authored on `feat/rfp-record-b`** (119 NOT
> applied): section 8 below records them as built, the provenance rule, one deliberate departure from
> section 4.2 (one Lightning record per token, not per project), and the vendor-side attach paths step C
> must change. Report: `docs/rfp-record-b-report.md`.
>
> **UPDATED 2026-10-14 (feat/rfp-record-a).** **The owner ruled D1-D9 on 2026-10-14, all as proposed**
> (section 6 now records the rulings). **Step A and migration 118 are authored on `feat/rfp-record-a`:**
> `supabase/migrations/118_rfp_records{,_down}.sql`, `118_preapply_test.sql` (82 assertions; NOT
> applied, NOT run), `lib/server/rfp-record.ts`, the two routes and the two pages. Numbering: **118
> (tables, RLS, guards, link columns), 119 (backfill), 120 (scrub)**; the actuals feeder is 121 or
> later. Steps B, 119, C, 120 and D are not started. Section 7 below states the D5 enforcement, the
> write order every writer (119 included) must follow, and the link-column guard as authored. Run
> report: `docs/rfp-record-a-report.md`; test script: `docs/rfp-record-test-script.md`.
>
> **References re-verified 2026-10-14** against `main` (`f47dc61`): all of section 0 and section 5
> hold except `app/api/agency/pool/[partnerId]/route.ts:176`, which is now `:199` (the select) and
> `:239` (the `buildEngagementHistory` call); `app/api/agency/rfp/magic-link/route.ts:283-328` is
> `:286-331` before step A (the inbox row itself is written by the attach call at `:361`); and
> `app/api/agency/rfp-responses/route.ts:301-325` runs to `:326`. Line numbers in the two step A
> routes moved again with step A; the report has the new ones.

Branch `fix/guest-profiles-records`. **Design, not implemented.** No migration, no code change.
Built from the repository at `ed6fa95` (migrations, route code, the WS3 stop in
`docs/agency-gate-and-leaks-report.md` sections WS3 and 4). **Renumbered 2026-10-14:** 115 is
`115_discoverable_profiles.sql` (applied 2026-10-12) and 116 is `116_budget_line_math.sql`
(`feat/budget-line-math`), so this design's three migrations were moved to 117, 118 and 119 (they
were written as 116, 117 and 118). **Renumbered again 2026-10-14:** 116 is applied (2026-10-14) and
117 is `117_budget_line_kind.sql` (`feat/budget-line-kind`, per-line fee or cost), so this design's
three migrations are now **118, 119 and 120**. Check the next free number again at authoring time.

## 0. The problem, from the code

- **The agency has no record of its own RFP.** The wizard's master RFP is React state
  (`app/agency/page.tsx:396-413`, assembled `:895-909`) plus a `localStorage` draft keyed
  `ligament-rfp-draft-${projectId}` (`:685-700`, saved `:1443-1494`, cleared on reset `:1392`).
  No table holds it. There is no `broadcast_id`/`rfp_id` anywhere.
- **Broadcast fans the whole master into every vendor's row.** `app/api/agency/broadcast-rfp/route.ts`
  writes one `partner_rfp_inbox` row per (scope line x recipient) with
  `master_rfp_json: {...masterRfp, nda_link}` (`:258`, `:403`): every scope line and its
  `estimatedBudget`, `totalBudget`, `client`, `evaluation_criteria` (the rubric),
  `budget_categories`, `business_criteria_required`. Each vendor can read its own row whole
  (079:1352-1354, scripts/013:50-59).
- **The magic-link flow** (`app/api/agency/rfp/magic-link/route.ts:283-328`) writes
  `rfp_magic_tokens` (agency-only RLS, 079:1666 + 114) and, for an existing account, an inbox row
  whose minimal `master_rfp_json` carries `_magic_token`, `projectName`, `client` (=
  `projects.client_name`) and `totalBudget` (= `projects.budget_range`)
  (`lib/magic-token-attach.ts:318-324`).
- **The agency then reads the vendors' copies back:**

| Agency reader | Reads from the vendor copy | file:line |
|---|---|---|
| Scoring rubric | `evaluation_criteria` | `lib/rfp-evaluation-criteria-server.ts:76-82` (callers `bids/[responseId]/evaluation:94,172`, `ai-score:194`, `lib/bid-summary-generation.ts:55`) |
| Bid list / compare | `business_criteria_required`, `budget_categories` | `app/api/agency/rfp-responses/route.ts:214`, `:301-325`; `components/bid-compare-view.tsx:606`, `bid-detail-sheet.tsx:130` |
| Award | inbox row, `projectName` | `app/api/agency/rfp-responses/[id]/route.ts:369`, `:740`, `:1050` |
| Decline | `projectName`, scope, partnership | same file `:1151`, `:1182` |
| Guest-bid join | `_magic_token` (the JOIN KEY), `.contains("master_rfp_json", {_magic_token})` | same file `:90-92`, `:413-415`; `lib/magic-token-attach.ts:108` |
| Engagement history | `projectName` | `lib/engagement-history.ts:47-49` via `app/api/agency/pool/[partnerId]/route.ts:176` |
| AI context, rank grouping | scope name/description | `lib/bid-analysis-context.ts:79-97`, `:172-196` |

  Stripping any of those keys from the vendor copies blanks the rubric, breaks compare, or breaks
  award/decline of guest bids. That is why WS3 stopped.

- **What vendors see today that the rulings forbid:** every other scope line's
  `estimatedBudget` and the `totalBudget` ("Program budget (master)",
  `app/partner/rfps/[id]/page.tsx:377`, `:411-443`); the rubric (raw row through `select("*")`,
  `app/api/partner/rfps/route.ts:233`); the client name (master `client`, `[id]/page.tsx:374,391`;
  and `projects.client_name` joined by `app/api/partner/rfps/route.ts:296-307`,
  `[id]/route.ts:176-185`, `rfps/bids/route.ts:172-175`). The guest route was fixed by this run's WS-A.

## 1. Schema sketch (agency-only)

```sql
-- 118. Agency-only. No vendor policy. No DELETE policy (archive, never delete).
CREATE TABLE public.rfp_records (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_org_id               uuid NOT NULL REFERENCES public.organizations(id),
  project_id                uuid REFERENCES public.projects(id) ON DELETE SET NULL,   -- decision D7
  source                    text NOT NULL CHECK (source IN ('wizard', 'magic_link', 'backfill')),
  master_rfp                jsonb NOT NULL,          -- the wizard master as broadcast (projectName, overview, objectives, timeline, ...)
  evaluation_criteria       jsonb,                   -- the rubric (075 shape)
  budget_categories         jsonb,                   -- 072 shape: names and notes, no amounts
  business_criteria_required jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_template_config    jsonb,                   -- agency-only (today inside rfp_magic_tokens.reference_materials)
  total_budget              text,                    -- agency-only
  show_client_to_vendors    boolean NOT NULL DEFAULT false,   -- the per-RFP client toggle (ruling: default hidden)
  client_name_snapshot      text,                    -- what the toggle would reveal, as broadcast
  response_deadline         timestamptz,
  close_bidding_at_deadline boolean NOT NULL DEFAULT false,
  require_terms_disclosure  boolean NOT NULL DEFAULT true,
  nda_link                  text,
  broadcast_at              timestamptz,
  archived_at               timestamptz,
  created_by                uuid REFERENCES auth.users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  backfill_note             text                     -- the backfill (119) only: how the row was reconstructed
);

CREATE TABLE public.rfp_record_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id               uuid NOT NULL REFERENCES public.rfp_records(id) ON DELETE CASCADE,
  lead_org_id          uuid NOT NULL,               -- copied from the parent by the guard trigger, never from the client
  scope_item_key       text NOT NULL,               -- the wizard's scope item id (partner_rfp_inbox.scope_item_id is text)
  scope_item_name      text NOT NULL,
  scope_item_description text,
  estimated_budget     text,                        -- agency's internal figure for this line
  released_budget      text,                        -- what this line's vendors may see (decision D2)
  sort_order           integer NOT NULL DEFAULT 0,
  UNIQUE (rfp_id, scope_item_key)
);

-- Link columns (nullable; a vendor may read its own inbox row's rfp_line_id: an opaque id into a
-- table it cannot read).
ALTER TABLE public.partner_rfp_inbox  ADD COLUMN rfp_line_id uuid REFERENCES public.rfp_record_lines(id);
ALTER TABLE public.partner_rfp_inbox  ADD COLUMN client_name_released text;   -- NULL unless the toggle is on
ALTER TABLE public.rfp_magic_tokens   ADD COLUMN rfp_line_id uuid REFERENCES public.rfp_record_lines(id);
ALTER TABLE public.rfp_magic_tokens   ADD COLUMN attached_inbox_id uuid REFERENCES public.partner_rfp_inbox(id);  -- replaces the _magic_token JSON join
ALTER TABLE public.rfp_magic_tokens   ADD COLUMN client_name_released text;
```

**RLS (both tables), TO authenticated only:**
- SELECT / INSERT / UPDATE: `lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids())`,
  a new SECURITY DEFINER helper returning the caller's organizations with `is_lead_agency AND
  is_paid` (the G1 rule at the database). Decision D1: or plain `current_user_org_ids()` like every
  other agency table, leaving G1 to the routes.
- INSERT/UPDATE WITH CHECK on `rfp_records` adds `project_id IS NULL OR` the project's `org_id =
  lead_org_id` (114's shape for `rfp_magic_tokens`).
- No DELETE policy. No vendor or anon policy.

**Grants, 113/114 posture:** `REVOKE ALL ON public.rfp_records, public.rfp_record_lines FROM PUBLIC,
anon, authenticated;` then `GRANT SELECT, INSERT, UPDATE ... TO authenticated;` (no DELETE,
TRUNCATE, REFERENCES, TRIGGER) and `GRANT ALL ... TO service_role`. Every new function: SECURITY
DEFINER only where needed, `SET search_path = public, pg_temp`, `REVOKE EXECUTE ... FROM PUBLIC,
anon`, `GRANT EXECUTE ... TO authenticated`.

**Guards:** a BEFORE INSERT/UPDATE trigger on `rfp_record_lines` sets `lead_org_id` from the parent
and refuses a change of `rfp_id`; `rfp_records.lead_org_id` immutable after insert (109's pattern).

## 2. Where the client toggle lives

`rfp_records.show_client_to_vendors boolean NOT NULL DEFAULT false`, one per RFP. Set in the wizard
step before broadcast (`app/agency/page.tsx`) and on `/agency/magic-rfp`; editable afterwards from
the RFP's bid page.

Vendors cannot read `rfp_records`, so the decision is **denormalized onto what they can read**:
`partner_rfp_inbox.client_name_released` and `rfp_magic_tokens.client_name_released` hold the client
name when the toggle is on and NULL when off. The agency route that flips the toggle rewrites both
columns for that RFP's lines in the same request (099's agency UPDATE policy on the inbox admits
it). Vendor routes stop joining `projects.client_name` and read `client_name_released`
(`app/api/partner/rfps/route.ts:296-307,343`, `[id]/route.ts:176-185,251`, `rfps/bids/route.ts:172-175,214`,
`app/api/rfp/guest/[token]/route.ts`). The guest route already sends no client name (WS-A).

## 3. Migration sequence, code first

| Step | Kind | What | Works before its migration because |
|---|---|---|---|
| **A** | code | `broadcast-rfp` and `magic-link` write an `rfp_records` row and its lines at broadcast, and set `rfp_line_id` / `attached_inbox_id` on what they write. Wizard gains the client toggle (stored in the request; written once the table exists) | every new write is skipped on 42P01/PGRST205 (table) and retried without the column on 42703/PGRST204, logged once |
| **118** | migration | create both tables, RLS, grants, guards, the five link columns, `current_user_entitled_lead_org_ids()` | - |
| **B** | code | move every agency reader in the section 0 table onto the record: rubric, compare (requirements, categories), award/decline (`projectName`, scope, NDA), guest-bid join via `rfp_magic_tokens.attached_inbox_id`, engagement history, AI context. **Each keeps the inbox read as the fallback when `rfp_line_id` is NULL** (rows from before step A) | fallback |
| **119** | migration | **backfill** (section 4); refuses (LG119) on any group it cannot reconstruct unambiguously and lists it | - |
| **C** | code | broadcast writes **per-vendor copies**: `master_rfp_json` with only the vendor's own line, its `released_budget`, no `totalBudget`, no other line, no rubric, no `_magic_token`; `client` only when the toggle is on. Vendor routes read `client_name_released`. `lib/magic-token-attach.ts` stops writing `_magic_token` into JSON and notification `data` (`:319`, `:421`). Agency readers drop the inbox fallback for any row with `rfp_line_id` | no schema need |
| **120** | migration | **scrub** existing vendor copies: remove `evaluation_criteria`, `totalBudget`, other lines' `scopeItems`, `_magic_token`, and `client` where the toggle is off. Pre-flight fingerprint: refuses unless every inbox row with a non-empty `master_rfp_json` has `rfp_line_id` and its record holds the rubric/categories it would remove (no data loss). Adds a guard trigger refusing those keys on INSERT/UPDATE of `partner_rfp_inbox.master_rfp_json` (110's shape) | - |
| **D** | code, later | remove the inbox fallbacks; optionally restore wizard drafts from `rfp_records` instead of `localStorage` | - |

Each migration ships with a `_down` file and a pre-apply test in the 109/113 format. 118 tests:
vendor cannot SELECT either table (0 rows), agency of another org cannot (NO SUBJECT today: one lead
org with members), unpaid org cannot (if D1 = paid at RLS), agency can insert with its own project
and is refused with another org's project, anon nothing, no TRUNCATE/REFERENCES/TRIGGER for
authenticated, function ACLs.

## 4. Backfill from inbox copies (119)

Inputs: `partner_rfp_inbox` rows with non-null `master_rfp_json`, `rfp_magic_tokens` rows.

1. **Wizard broadcasts.** Group inbox rows by `(lead_org_id, project_id, scope_item_id)` into lines,
   and lines into one record per `(lead_org_id, project_id, created_at truncated to the broadcast
   request)`: broadcast inserts all its rows in one batch (`broadcast-rfp/route.ts:494`), so a
   broadcast's rows share `created_at` to the transaction (the milestone feed already groups on it,
   `:562-566`). Within a group, `master_rfp_json` is identical by construction (`:258`, `:403`);
   119 takes it from the earliest row and **refuses the group** if two rows of one group carry
   different rubric/categories/requirements (reported, not guessed).
   `show_client_to_vendors := false` (decision D3), `client_name_snapshot := master.client`,
   `estimated_budget := inbox.estimated_budget`, `released_budget := inbox.estimated_budget`
   (decision D2), `source := 'backfill'`.
2. **Magic links.** One record per `(org_id, project_id)` with `source := 'backfill'`, lines per
   `scope_item_name`; `evaluation_criteria`, `budget_categories`, `business_criteria_required`,
   `output_template_config` (from `reference_materials`) from the token. `attached_inbox_id` from
   the inbox row whose `master_rfp_json._magic_token = token` or `scope_item_id = 'magic:' || token`
   (`lib/magic-token-attach.ts:62-64`, `:99-131`).
3. Set `rfp_line_id` on every inbox row and token it reconstructed. Report counts: records,
   lines, rows linked, rows refused, rows with no `project_id`.

## 5. Files each phase touches

- **A:** `app/api/agency/broadcast-rfp/route.ts`, `app/api/agency/rfp/magic-link/route.ts`,
  `lib/magic-token-attach.ts`, `app/agency/page.tsx` (toggle, send), `app/agency/magic-rfp/page.tsx`
  (toggle), new `lib/server/rfp-record.ts` (write + read helpers with the 42P01/PGRST205/42703
  fallbacks).
- **118:** `supabase/migrations/118_rfp_records{,_down}.sql`, `118_preapply_test.sql`.
- **B:** `lib/rfp-evaluation-criteria-server.ts`, `app/api/agency/rfp-responses/route.ts`,
  `app/api/agency/rfp-responses/[id]/route.ts` (award, decline, guest resolver `:60-109`),
  `lib/engagement-history.ts`, `app/api/agency/pool/[partnerId]/route.ts`,
  `lib/bid-analysis-context.ts`, `app/api/agency/bids/[responseId]/evaluation/route.ts`,
  `app/api/agency/bids/[responseId]/ai-score/route.ts`, `lib/bid-summary-generation.ts`,
  `app/api/agency/rfp-closure/route.ts` (group by `rfp_line_id` where present), new
  `app/api/agency/rfp-records/[id]/route.ts` (toggle PATCH, writes the denormalized columns).
- **119:** `supabase/migrations/119_rfp_records_backfill{,_down}.sql`, `119_preapply_test.sql`.
- **C:** `app/api/agency/broadcast-rfp/route.ts`, `lib/magic-token-attach.ts`,
  `app/api/partner/rfps/route.ts` (also replace `select("*")` at `:233`),
  `app/api/partner/rfps/[id]/route.ts`, `app/api/partner/rfps/bids/route.ts`,
  `app/partner/rfps/[id]/page.tsx` (program budget and other lines disappear),
  `components/partner-rfp-surface.tsx` (client grouping), `app/api/partner/dashboard/route.ts`.
- **120:** `supabase/migrations/120_rfp_vendor_copy_scrub{,_down}.sql`, `120_preapply_test.sql`.
- **D:** the fallbacks added in B; `app/agency/page.tsx` draft restore.

## 6. Decisions the owner must make

**RULED 2026-10-14, all approved as proposed:**

- **D1** Paid gate at RLS on the new tables, through `current_user_entitled_lead_org_ids()`.
- **D2** A per-line "release budget" choice. For NEW RFPs it defaults to hidden. For RFPs already
  broadcast, the 119 backfill sets `released_budget = estimated_budget`, so bids in progress keep
  their number.
- **D3** Backfilled records get `show_client_to_vendors = false` (client hidden by default, per the
  Oct 9 ruling).
- **D4** One record per broadcast send.
- **D5** The record is a snapshot after broadcast: only `show_client_to_vendors`,
  `response_deadline`, `close_bidding_at_deadline` and `archived_at` may change.
- **D6** Lightning (magic-link) and wizard RFPs are separate records.
- **D7** `project_id ON DELETE SET NULL`.
- **D8** Strip `_magic_token` from notifications and vendor reads in step C (not before).
- **D9** `output_template_config` lives on the record.

The questions as they were put to the owner:

- **D1. Paid gate at the database?** RLS on the new tables admits only members of a paid lead agency
  (`current_user_entitled_lead_org_ids()`), or any member of the lead org like every other agency
  table today (G1 then lives in the routes only). Recommended: paid at RLS for new tables.
- **D2. What is "the budget released for their own scope line"?** Today the vendor sees
  `partner_rfp_inbox.estimated_budget`, which is the agency's estimate for that line. Either that
  figure is the release (backfill `released_budget = estimated_budget`), or the agency gets a
  per-line "release budget" choice defaulting to hidden (then existing vendors stop seeing it).
- **D3. Toggle on existing RFPs.** Ruling: default hidden. Backfilled records get
  `show_client_to_vendors = false`, so vendors who see a client name today stop seeing it after
  step C. Confirm, or backfill `true` for RFPs already broadcast.
- **D4. Backfill grouping** when one project was broadcast more than once: one record per broadcast
  batch (`created_at`), as proposed, or one per project.
- **D5. Is the record editable after broadcast?** Proposed: the master and rubric are a snapshot;
  only the toggle, deadline and archive change. Editing the rubric after bids arrive changes scores.
- **D6. Lightning (magic-link) and wizard RFPs for the same project:** separate records (proposed;
  they are separate sends today) or merged.
- **D7. Project deletion:** `ON DELETE SET NULL` keeps the RFP and its bids' context (proposed), or
  cascade.
- **D8.** `_magic_token` in notification `data` and in the vendor's `select("*")`
  (`lib/magic-token-attach.ts:421`; `app/api/partner/rfps/route.ts:233`) is the vendor org's own
  credential, fanned out to every member of that org: strip in step C (proposed) or keep.
- **D9.** Whether `output_template_config` moves off `rfp_magic_tokens.reference_materials` onto the
  record (proposed) so the token row carries no agency-only setting at all.

## 7. As authored in 118 (2026-10-14): D5, the write order, the link-column guard

**D5 enforcement** (`rfp_records_guard`, BEFORE INSERT OR UPDATE, every caller including the service
role, SQLSTATE `LG118`): `lead_org_id` is immutable from insert. Once `broadcast_at` is set it cannot
be cleared or changed, and the row is compared WHOLE (`to_jsonb(OLD)` against `to_jsonb(NEW)`) minus an
allow-list of `show_client_to_vendors`, `response_deadline`, `close_bidding_at_deadline`, `archived_at`
and `updated_at`, so a column added later is frozen by default. The one exception is the foreign keys'
own `ON DELETE SET NULL` (D7 for `project_id`; also `created_by`): going to NULL is admitted only when
the referenced row no longer exists. `updated_at` is set by the trigger on every update.
`rfp_record_lines_guard` (BEFORE INSERT OR UPDATE, `LG118`) copies `lead_org_id` from the parent,
refuses a change of `rfp_id`, and refuses any insert or update of a line whose parent has
`broadcast_at` set.

**The write order. Step A follows it; 119 MUST follow it:**

1. insert the `rfp_records` row with `broadcast_at` NULL;
2. insert its `rfp_record_lines`;
3. write the vendor rows carrying `rfp_line_id` (`partner_rfp_inbox`, `rfp_magic_tokens`);
4. set `rfp_magic_tokens.attached_inbox_id` where an inbox row is attached;
5. set `broadcast_at` LAST.

A writer that sets `broadcast_at` before step 2 can never add a line. For 119 that means: insert each
reconstructed record with `broadcast_at` NULL, its lines, link the inbox rows and tokens, then set
`broadcast_at` (to the reconstructed send time) as the final statement for that record.

**The link-column guard** (`partner_rfp_inbox_link_columns_guard`, `rfp_magic_tokens_link_columns_guard`,
110's shape: BEFORE INSERT OR UPDATE, plpgsql, SECURITY INVOKER, search_path pinned, EXECUTE revoked):

1. `rfp_line_id`, `client_name_released` (and on tokens `attached_inbox_id`) may be set or changed only
   by a member of the row's lead organization (`partner_rfp_inbox.lead_org_id`,
   `rfp_magic_tokens.org_id`), checked before AND after the write, or by a trusted path with no session
   (`auth.uid() IS NULL AND current_user NOT IN ('anon','authenticated')`: the service role, migrations,
   foreign-key actions). Anyone else, including the vendor that owns the inbox row, gets 42501.
2. `rfp_line_id` must reference a line with the same `lead_org_id` (23514).
3. `attached_inbox_id` must reference an inbox row of the same lead organization (23514).

Rules 2 and 3 run when the column is set or changed, or when the lead organization of a row that
already carries one changes. Every other vendor write passes untouched, so vendors keep every update
they have today (099's policy still decides those).

## 8. As built in step B and 119 (2026-10-14, `feat/rfp-record-b`)

### 8a. Step B: the agency readers

One shared helper, `lib/server/rfp-record.ts:304-543`. Rules, in the file's own words:

1. **The record wins when the row is linked.** An inbox row (or, for a guest bid, its token) that
   carries `rfp_line_id` is answered from `rfp_records` / `rfp_record_lines`. The vendor copy
   (`master_rfp_json`) is read only when `rfp_line_id` is NULL. A linked row whose record cannot be read
   answers with nothing, never with the vendor copy.
2. **"Unknown" is not "linked".** If the link column cannot be read (before 118, or any error, logged
   once), the row is treated as unlinked: exactly the behaviour before step B.
3. **Only the signed-in agency session reads the record.** Callers state a mode, `"session"` (an agency
   route after G1, on its session client) or `"skip"` (the default). Every read also filters
   `lead_org_id` to the caller's own organizations. No reader uses the service role.

For one bid the line is the inbox row's `rfp_line_id`, else the bid's token's (`rfp_magic_tokens` by
`response_id`): a magic-link row attached by the vendor-side path after a step A send carries no line
of its own, but its token does.

| Reader | Now reads from the record | Fallback (row unlinked) | file:line |
|---|---|---|---|
| Rubric | `evaluation_criteria` | `master_rfp_json.evaluation_criteria`, token column | `lib/rfp-evaluation-criteria-server.ts:83-88`; session from `bids/[responseId]/evaluation:94,172`, `ai-score:194`, `generate-summary:30` |
| AI context | scope name, description | inbox / token columns | `lib/bid-analysis-context.ts:84-91`; session from `decompose:154`, `evaluation:342`, `ai-score:232`, `compare:144,149`, `generate-summary` |
| Bid list / compare / detail | `business_criteria_required`, `budget_categories` | `master_rfp_json`, token column | `app/api/agency/rfp-responses/route.ts:236-249`, `:324-350` |
| Award | `projectName`, scope name | `master_rfp_json.projectName`, inbox column | `app/api/agency/rfp-responses/[id]/route.ts:794-810` |
| Decline | `projectName`, scope name | same | same file `:1247-1265` |
| Guest bid context (feedback, milestones, decline) | `projectName`, scope name | synthesized row | same file `:100-161` |
| Guest-bid join | `rfp_magic_tokens.attached_inbox_id` | `.contains("master_rfp_json", {_magic_token})` | same file `:77-98` (used at `:128` and the award at `:467`) |
| Engagement history (agency side) | `projectName` when the project row has no name | `master_rfp_json.projectName` | `app/api/agency/pool/[partnerId]/route.ts:242-264`, `lib/engagement-history.ts:41-89` |

**Left on today's reads, deliberately:**

- The summary generated after a **vendor or guest bid submission** (`app/api/partner/rfps/[id]/response/route.ts:433`,
  `app/api/rfp/guest/[token]/route.ts:660,776`) runs on the service role after a request the agency gate
  never saw, so it may not read the record (`"skip"`, the default). Those routes are unchanged.
- `resolveResponseScope` (ranking group): its hash must equal the browser's `scopeKeyForRow`, which reads
  the row's own `project_id` and `scope_item_name`; neither is a vendor-copy key.
- `scope_item_name` reads on portal bids for the feedback mail and the shortlist / meeting milestones
  (`[id]/route.ts` feedback and `resolveBidMilestoneContext` inbox branch): a row column, not a
  vendor-copy key; step C does not scrub it.
- `app/api/agency/rfp-closure/route.ts` ("group by `rfp_line_id` where present", section 5): a writer, not
  a reader of the copy; changing what "close the whole RFP" covers is a product decision, not taken here.
- `lib/magic-token-attach.ts:108` (the attach's own `_magic_token` lookup): locked until step C.

### 8b. The client toggle on an existing record

`PATCH /api/agency/rfp-records/[id]` (`app/api/agency/rfp-records/[id]/route.ts`): session, G1 (402),
zod (`id` uuid; body exactly `{ show_client_to_vendors: boolean }`), organization scope (the record is
re-read under RLS and `lead_org_id IN` the caller's organizations; another organization's record or an
unknown id is 404), then ONE call to 119's `rfp_record_set_client_visibility(record, show)` on the
session client. Before 119 the function is missing (42883 / PGRST202): 503 "not enabled yet", nothing
written. The bids page lists sent records (browser client, RLS) with the toggle
(`components/rfp-record-client-toggle.tsx`); its copy says vendors see the change in the next release
while `RFP_VENDOR_COPY_SCRUBBED` is false.

### 8c. Migration 119 as built

- **The function** (`119_rfp_records_backfill.sql:263-322`): SECURITY INVOKER, `search_path` pinned,
  EXECUTE revoked from PUBLIC and anon, granted to authenticated. Updates the record's toggle under RLS
  (zero rows raises P0002 before anything is written), then sets `client_name_released` on every inbox
  row and token linked to the record's lines (the snapshot when on, NULL when off). One call, one
  transaction.
- **Wizard sends**: one record per `(lead_org_id, project_id, created_at)` of unlinked, non-Lightning
  inbox rows; lines per `scope_item_id`; master from the first copy by id, `nda_link` split out.
- **Lightning sends: ONE RECORD PER TOKEN**, not per `(org_id, project_id)` as section 4.2 sketched. D4
  (one record per send) and D6 (sourced from the agency-only token) both point there: the magic-link
  route keeps one token per (org, project, vendor) and each is its own send, and tokens of one project
  can carry different rubrics. This matches what step A writes.
- **Lightning inbox rows attached after a step A send** carry no line; 119 links them to their token's
  existing step A line and changes nothing else of step A.
- **The provenance rule.** A wizard group of 2+ copies must agree on `evaluation_criteria`,
  `budget_categories`, `business_criteria_required`, and per line on name, description and estimated
  budget, or it is refused (RAISE WARNING LG119, listed, rows left unlinked). A single-copy group is
  built with `backfill_note` starting `unverified single copy` and listed. The client name is always
  taken from `projects.client_name`; a mismatch with the copy is noted `client name taken from project`.
  A group or token whose project is missing or another organization's is refused.
- **Write order** per record: record without `broadcast_at`, lines, `rfp_line_id` on rows and tokens,
  `attached_inbox_id`, `broadcast_at` last (the original send time).
- Refuses a second run (LG119) and checks 118's trusted path first; ends by proving every inbox row and
  token is linked or listed as refused. Down file: unlinks and deletes `source = 'backfill'` records only.

### 8d. Vendor-side attach paths that do not set `attached_inbox_id` (for step C)

All call `attachMagicTokenToPartnerInbox` (`lib/magic-token-attach.ts:229`), which creates or collapses the
inbox row and sets neither `rfp_line_id` nor `attached_inbox_id`:

| Path | file:line | Sets `attached_inbox_id` |
|---|---|---|
| Agency send-time attach (existing account) | `app/api/agency/rfp/magic-link/route.ts:454`, then `:484-487` | yes (step A), and `rfp_line_id` on the row `:478-482` |
| Guest "attach to my existing account" | `app/api/rfp/guest/[token]/attach-existing-account/route.ts:77` | no |
| Vendor portal sweep, RFP list | `app/api/partner/rfps/route.ts:72` | no |
| Vendor portal sweep, bids list | `app/api/partner/rfps/bids/route.ts:56` | no |
| Portal claim (broadcast invite token) | `app/api/partner/rfps/claim/route.ts:76-84` | n/a: claims a broadcast inbox row, not a magic token |

Until step C changes these, the readers fall back to the `_magic_token` join for such rows, and 119
links whatever exists at apply time.
