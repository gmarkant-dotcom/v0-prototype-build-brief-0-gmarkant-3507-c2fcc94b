# Agency-owned RFP record: design only, 2026-10-12

Branch `fix/guest-profiles-records`. **Design, not implemented.** No migration, no code change.
Built from the repository at `ed6fa95` (migrations, route code, the WS3 stop in
`docs/agency-gate-and-leaks-report.md` sections WS3 and 4). Migration numbers below assume 115 is
taken by this run (`115_discoverable_profiles.sql`); the next free number is **116**.

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
-- 116. Agency-only. No vendor policy. No DELETE policy (archive, never delete).
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
  backfill_note             text                     -- 118 only: how the row was reconstructed
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
| **116** | migration | create both tables, RLS, grants, guards, the five link columns, `current_user_entitled_lead_org_ids()` | - |
| **B** | code | move every agency reader in the section 0 table onto the record: rubric, compare (requirements, categories), award/decline (`projectName`, scope, NDA), guest-bid join via `rfp_magic_tokens.attached_inbox_id`, engagement history, AI context. **Each keeps the inbox read as the fallback when `rfp_line_id` is NULL** (rows from before step A) | fallback |
| **117** | migration | **backfill** (section 4); refuses (LG117) on any group it cannot reconstruct unambiguously and lists it | - |
| **C** | code | broadcast writes **per-vendor copies**: `master_rfp_json` with only the vendor's own line, its `released_budget`, no `totalBudget`, no other line, no rubric, no `_magic_token`; `client` only when the toggle is on. Vendor routes read `client_name_released`. `lib/magic-token-attach.ts` stops writing `_magic_token` into JSON and notification `data` (`:319`, `:421`). Agency readers drop the inbox fallback for any row with `rfp_line_id` | no schema need |
| **118** | migration | **scrub** existing vendor copies: remove `evaluation_criteria`, `totalBudget`, other lines' `scopeItems`, `_magic_token`, and `client` where the toggle is off. Pre-flight fingerprint: refuses unless every inbox row with a non-empty `master_rfp_json` has `rfp_line_id` and its record holds the rubric/categories it would remove (no data loss). Adds a guard trigger refusing those keys on INSERT/UPDATE of `partner_rfp_inbox.master_rfp_json` (110's shape) | - |
| **D** | code, later | remove the inbox fallbacks; optionally restore wizard drafts from `rfp_records` instead of `localStorage` | - |

Each migration ships with a `_down` file and a pre-apply test in the 109/113 format. 116 tests:
vendor cannot SELECT either table (0 rows), agency of another org cannot (NO SUBJECT today: one lead
org with members), unpaid org cannot (if D1 = paid at RLS), agency can insert with its own project
and is refused with another org's project, anon nothing, no TRUNCATE/REFERENCES/TRIGGER for
authenticated, function ACLs.

## 4. Backfill from inbox copies (117)

Inputs: `partner_rfp_inbox` rows with non-null `master_rfp_json`, `rfp_magic_tokens` rows.

1. **Wizard broadcasts.** Group inbox rows by `(lead_org_id, project_id, scope_item_id)` into lines,
   and lines into one record per `(lead_org_id, project_id, created_at truncated to the broadcast
   request)`: broadcast inserts all its rows in one batch (`broadcast-rfp/route.ts:494`), so a
   broadcast's rows share `created_at` to the transaction (the milestone feed already groups on it,
   `:562-566`). Within a group, `master_rfp_json` is identical by construction (`:258`, `:403`);
   117 takes it from the earliest row and **refuses the group** if two rows of one group carry
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
- **116:** `supabase/migrations/116_rfp_records{,_down}.sql`, `116_preapply_test.sql`.
- **B:** `lib/rfp-evaluation-criteria-server.ts`, `app/api/agency/rfp-responses/route.ts`,
  `app/api/agency/rfp-responses/[id]/route.ts` (award, decline, guest resolver `:60-109`),
  `lib/engagement-history.ts`, `app/api/agency/pool/[partnerId]/route.ts`,
  `lib/bid-analysis-context.ts`, `app/api/agency/bids/[responseId]/evaluation/route.ts`,
  `app/api/agency/bids/[responseId]/ai-score/route.ts`, `lib/bid-summary-generation.ts`,
  `app/api/agency/rfp-closure/route.ts` (group by `rfp_line_id` where present), new
  `app/api/agency/rfp-records/[id]/route.ts` (toggle PATCH, writes the denormalized columns).
- **117:** `supabase/migrations/117_rfp_records_backfill{,_down}.sql`, `117_preapply_test.sql`.
- **C:** `app/api/agency/broadcast-rfp/route.ts`, `lib/magic-token-attach.ts`,
  `app/api/partner/rfps/route.ts` (also replace `select("*")` at `:233`),
  `app/api/partner/rfps/[id]/route.ts`, `app/api/partner/rfps/bids/route.ts`,
  `app/partner/rfps/[id]/page.tsx` (program budget and other lines disappear),
  `components/partner-rfp-surface.tsx` (client grouping), `app/api/partner/dashboard/route.ts`.
- **118:** `supabase/migrations/118_rfp_vendor_copy_scrub{,_down}.sql`, `118_preapply_test.sql`.
- **D:** the fallbacks added in B; `app/agency/page.tsx` draft restore.

## 6. Decisions the owner must make

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
