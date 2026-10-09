# Leak sweep, 2026-10-09: what a vendor can read, and what a vendor can reach

**Read-only analysis.** No application code, migration or policy was changed. No SQL was run. The
live confirmation is `scripts/sql/sweep-confirm.sql`, which is SELECT-only and has **not been
parsed** (no parser was available). The owner's SQL Editor run is the parse check.

Branch `chore/live-audit-and-sweep`. Live facts used are the owner-verified ones in
`docs/roadmap-state.md` "CURRENT STATE": 072 and 105-112 applied, 079-100 and 102 applied, 103/104
NOT applied, 073 and 101 never applied (their policies are ignored here).

## Read these first

1. **Four CONFIRMED leaks: three readable by the vendor through RLS, one through an
   unauthenticated route.**
   - `partner_rfp_inbox.master_rfp_json.evaluation_criteria`: the agency's rubric, with weights.
   - `payment_milestones.notes`: carries the agency's AI cash-flow rationale ("why this timing
     protects the agency") and is rendered on the vendor's Cash flow tab.
   - `organizations.is_paid` and `profiles.is_paid` / `is_admin` / `demo_access`: the
     counterparty's billing and admin flags, readable by direct PostgREST query.
   - `rfp_magic_tokens`, through the guest GET (service role, token only). The whole token row
     goes back: evaluation criteria, the agency's template and scrub settings, and another
     user's profile id.
2. **Finding (2) is worse than the open-items list says.** A vendor does not need a loophole to
   reach agency routes. Migration 078 gives **every vendor signup `secondary_role = 'agency'`**,
   and `/api/profile/switch-role` admits exactly that. Separately, `role`, `active_role` and
   `secondary_role` are self-writable by direct PostgREST UPDATE. 091 left them out of its guard
   on purpose (091:298-301). The route layer then checks `role === 'agency' || active_role ===
   'agency'` and nothing else. **52 of the 67 route files read admit such a vendor.**
3. **Once in, the vendor stays in its own organization, with named exceptions.** Data reads are
   scoped to the caller's organizations. The exceptions are a cross-tenant write
   (`brief/save`), a private-blob read by URL (`library-documents/file`, which needs no role
   switch at all), account-existence oracles on six routes, and unmetered AI on seven.
4. **Finding (1) is confirmed by policy text and is wider than "its own row".** The WITH CHECK
   tests `org_id` only. The vendor can insert a review naming **any** `project_id` and
   `partnership_id` it knows. A forged row also blocks the agency's later save through
   `UNIQUE(project_id, partnership_id)`.

## Method

- **Policies.** Every `CREATE/DROP/ALTER POLICY` in `supabase/migrations/` was grepped, excluding
  `_down`, `_preapply_test`, 073 and 101. That gave the last definition per table. No migration
  builds policy DDL dynamically (`EXECUTE '... POLICY'` returned no match). Helper function
  bodies (079, 085) and the guard triggers (091, 092, 112) were read in full. Policies older than
  079 that 079 deliberately left alone were taken from `docs/schema-snapshot-2026-08-13.md` and
  `scripts/`.
- **Columns.** From `CREATE TABLE` in `scripts/` (several tables have no DDL in
  `supabase/migrations/`; see `docs/schema-truth.md` section 5) plus every `ADD COLUMN`. **Live
  columns were not read.** The confirm SQL lists them (V2, V5, V7, V12).
- **Vendor reads and agency guards.** Three read-only sweeps over `app/partner`, `app/api/partner`,
  `app/rfp`, `app/api/rfp` and the shared routes, and over every route file under
  `app/api/agency`, `app/api/ai`, `app/api/interpret`, `app/api/projects`, `app/api/admin` and
  `app/api/brief`. I re-read the load-bearing lines myself: `app/partner/rfps/[id]/page.tsx:369-450`,
  `app/api/rfp/guest/[token]/route.ts:200,293,314`, `app/api/agency/payment-synthesis/route.ts:347`,
  `app/agency/msa/page.tsx:839`, `app/api/partner/payments/route.ts:251`,
  `app/api/agency/projects/[projectId]/status-updates/route.ts:330-349`,
  `app/api/profile/switch-role/route.ts`, `app/api/user/active-role/route.ts` and `middleware.ts`.
- **Classification.** **CONFIRMED** means a vendor-admitting policy (or a vendor-reachable route)
  as last defined, plus a column holding agency-private data, plus no column revoke, all with
  file:line. **SUSPECTED** means the chain holds but the data class or the live population is
  unproven. **INTENDED DISCLOSURE** means the vendor UI renders it deliberately, but whether it
  should is a product call. **CLEAN** means no agency-private column is reachable.

Platform facts this rests on (owner-stated): vendor and agency are both `authenticated`. There is
no per-column RLS. The anon key is public, so any column on an admitted row is one PostgREST GET
away regardless of the UI. No migration in the repo revokes SELECT on any swept table or column.
The only REVOKEs are on the new private tables in 103-111.

## Classification

| Table / column | Vendor-admitting policy, as last defined | Class |
|---|---|---|
| `partner_rfp_inbox.master_rfp_json.evaluation_criteria` | "Partners select inbox rows by partner_id" `vendor_org_id IN current_user_org_ids()` 079:1352-1354, plus the email-keyed "Partners select inbox rows by recipient email" scripts/013:50-59 (left live, 079:1108-1117) | **CONFIRMED LEAK** (unless the owner rules the rubric public) |
| `partner_rfp_inbox.master_rfp_json` other keys (client, totalBudget, every scopeItems[] line with estimatedBudget, allocation) | same | **INTENDED DISCLOSURE, needs ruling** (rendered on purpose; includes other vendors' and in-house lines) |
| `payment_milestones.notes` | three SELECT policies 079:1514-1532 | **CONFIRMED LEAK** |
| `payment_milestones` other columns | same | CLEAN (the vendor's own payment terms) |
| `organizations.is_paid` | "Members read counterparty organizations" 079:1793-1795 (any partnership status, 079:738-756) | **CONFIRMED LEAK** (PostgREST only; no app route reads it) |
| `profiles.is_paid`, `is_admin`, `demo_access` (and `role`, `active_role`, `secondary_role`, `linked_agency_id`) | "Users can view profiles of partnership members" 079:1562-1567 via 085:392-403; "Authenticated users can read discoverable profiles" scripts/016:8-12 (live per snapshot:202, untouched per 079:1558-1561) | **CONFIRMED LEAK** (PostgREST only) |
| `profiles.default_terms`, `business_criteria`, `default_nda_url` | same | INTENDED DISCLOSURE, ruled in 085 (commercial tier while the relationship is live) |
| `rfp_magic_tokens` (RLS) | none. The only policy is the org_id ALL policy, 079:1666-1668 | CLEAN at RLS |
| `rfp_magic_tokens` (guest route) | `app/api/rfp/guest/[token]/route.ts` service role `select("*")` :200, returned as `token: tokenRow` :293, :314 | **CONFIRMED LEAK** (unauthenticated, token holder) |
| `partner_status_updates` "[Agency override]" rows, `is_resolved` | vendor SELECT 079:1437-1441 | INTENDED DISCLOSURE, needs ruling (see the note on the missing agency INSERT policy) |
| `project_assignments.bid_notes` | "assignments_partner_select" 079:1579-1583 | **SUSPECTED** (agency invite writes request notes into it; no UI caller sends notes; population unknown, R6) |
| `project_assignments` other columns | same | CLEAN |
| `msa_agreements` | "Partners can view their MSAs" 079:1244-1248 | CLEAN (no agency-private column; no vendor read) |
| `onboarding_packages`, `onboarding_package_documents` | 079:1290-1303, 079:1316-1322 | CLEAN (all content is addressed to the vendor) |
| `assignment_agreements` | 079:1692-1708 | CLEAN |
| `project_documents` | 079:1607-1621, gated on `visibility` | CLEAN (`all_partners` sharing across a project's vendors is by design) |
| `partner_rfp_response_versions` | 079:1371-1377 | CLEAN (vendor-authored) |
| `milestone_events` | 080:350-362, whitelist `vendor_visible_event_types()` 080:161-198; vendor INSERT 100:404 | CLEAN (every whitelisted agency-side payload was read; none carries private data) |
| `delivery_reviews` (read) | 079:1207-1214, `status = 'complete'` | CLEAN after 111/112 (the six private columns are null and guarded) |
| `delivery_reviews` (write) | "Agencies manage own delivery reviews" ALL 079:1202-1205 | **Finding (1), CONFIRMED by policy text** |

## Per-table evidence

### partner_rfp_inbox

- **Policy.** 079:1352-1354 admits the vendor org. The email arm (scripts/013:50-59) also survives;
  079 deliberately left it (079:1108-1117). 099:748 changed only the vendor UPDATE WITH CHECK.
- **Column.** `master_rfp_json jsonb` scripts/013:16. The broadcast route spreads the client's
  `masterRfp` unchanged (`app/api/agency/broadcast-rfp/route.ts:257`, `:402`) and normalizes
  `evaluation_criteria` (`:150-158`). The keys come from `app/agency/page.tsx:396-413`: projectName,
  client, overview, objectives, scopeItems (id, name, description, allocation, estimatedBudget,
  timeline), totalBudget, timeline, business_criteria_required, budget_categories,
  evaluation_criteria (key, name, description, **weight**, origin, sort_order) and referenceMaterials.
  075:28 names this the home of the per-RFP rubric.
- **Route.** `app/api/partner/rfps/route.ts:233` and `app/api/partner/rfps/[id]/route.ts:25` use
  `select("*")`. They return the whole row at `rfps/route.ts:346` (`...row`) and
  `rfps/[id]/route.ts:251`.
- **Rendered.** `MasterRfpSections` (`app/partner/rfps/[id]/page.tsx:369-450`) renders client :391,
  "Program budget (master)" :415-416 and "All scope items (master RFP)" with each line's budget
  :433-442. **`evaluation_criteria` is rendered nowhere vendor-side**, and no comment rules on it.
  The agency copy (`components/evaluation-criteria-editor.tsx:21-31`, `lib/glossary.ts:264-269`)
  describes it only as how you score bids.
- **Verdict.** The rubric and its weights reach every invited vendor's browser and are not shown.
  That is a leak unless the owner rules the rubric public. The scope-line budgets are shown
  deliberately; whether every vendor should see every line's budget, including lines sent to
  competitors or kept in-house, is a ruling.

### payment_milestones

- **Policy.** Three OR-ed SELECT policies, 079:1514-1532.
- **Column.** `notes text` (scripts/029-msa-payments.SKIP:51; schema-truth section 6.1 says that
  DDL is live).
- **Writer.** `app/api/agency/payment-synthesis/route.ts:347` asks the model for "rationale: ...
  why this timing protects the agency" while prioritizing "paying vendors after the agency
  receives client funds" and "a reasonable margin buffer" (:349). `app/agency/msa/page.tsx:839`
  saves `notes: rec.rationale`. Notes are also typed by hand (:918) or come from the
  `ai-schedule` suggestion (:401).
- **Route and render.** `app/api/partner/payments/route.ts:176`, returned at :251. Rendered at
  `app/partner/projects/page.tsx:459`.
- **Verdict.** CONFIRMED. The agency's reasoning about its own cash flow and margin is shown to
  the vendor it is about. V3 counts the live rows.

### organizations.is_paid

- **Policy.** 079:1793-1795 `id IN current_user_counterparty_org_ids()`. That helper has no status
  filter (079:738-756; 085 left it alone on purpose, 085:105-107). 079:1768-1771 lists what the row
  exposed then; 092:487-488 added `is_paid` afterwards. 092 does not address SELECT, and no
  migration revokes the column.
- **App.** No vendor route reads it (`lib/org-contact.ts:90-91` uses fixed lists;
  `lib/entitlements.ts:537` reads the caller's own org).
- **Verdict.** CONFIRMED by PostgREST: `GET /rest/v1/organizations?select=id,name,is_paid` as a
  vendor returns its lead agencies' paid status. It is symmetric: the agency reads its vendors'.

### profiles

- **Policies.** 079:1562-1567 via `current_user_visible_profile_ids()` (085:392-403, which admits
  own-org members plus counterparties not terminated or removed). Also the discoverable policy,
  scripts/016:8-12, which **any** authenticated user passes for a discoverable profile.
- **Columns.** 091:271 names the authority set: `is_paid, is_admin, demo_access, email,
  linked_agency_id`. Also present are `role` / `active_role` / `secondary_role` (047) and
  `default_terms` (070:29). 091 guards **writes** only; reads are untouched.
- **App.** Vendor routes use explicit lists (`app/api/partner/network/[agencyId]/route.ts:132-145`
  and the org-contact embeds). There is no `select("*")` on another user's profile.
- **Verdict.** CONFIRMED for the billing and admin flags, by PostgREST only. The commercial terms
  were ruled disclosable by 085.

### rfp_magic_tokens

- **RLS.** Only "Agency can manage their own tokens", ALL `TO authenticated`, `USING (org_id IN ...)`,
  079:1666-1668. Vendors have no RLS path.
- **Route.** `app/api/rfp/guest/[token]/route.ts:199-202` uses the service role with `select("*")`
  and returns `token: tokenRow` at :293 (submitted) and :314 (active). The row carries
  `evaluation_criteria` (075:45-46) and `reference_materials` (059). That includes
  `output_template_config` with the sensitivity scrub flags and the generated template, written
  at `app/api/agency/rfp/magic-link/route.ts:36-51, :289`; the comment at guest :263-265 says it is
  hidden, but only the separate field is filtered. It also carries `pool_status` and
  `domain_match_profile_id` (061:22-23, **another user's profile id**), plus `org_id` and
  `response_id`. The same response returns `projects.budget_range`, rendered as "Budget" at
  `app/rfp/respond/[token]/page.tsx:977-980` (an intended-disclosure question).
- **Verdict.** CONFIRMED, and unauthenticated: anyone holding the link gets it. The 109-112 work
  narrowed the **response** row on this route, not the token row.

### partner_status_updates

- Vendor INSERT, SELECT and UPDATE policies are at 079:1431-1447. The agency has SELECT and UPDATE
  only (079:1419-1429). **There is no agency INSERT policy**, so the agency "override" insert at
  `app/api/agency/projects/[projectId]/status-updates/route.ts:334-349` (session client) should be
  refused by RLS for a pure agency. That is inferred, not tested; R4 and R5 settle it.
- Where override rows exist, `[Agency override] <note>` is readable (vendor route
  `app/api/partner/projects/[projectId]/status-update/route.ts:88`, `select("*")`) and rendered on
  both vendor project pages. That is an agency statement on the shared status record: INTENDED
  DISCLOSURE, needs ruling.
- **Side note:** the vendor UPDATE policy (079:1443-1447) has no column limit and no WITH CHECK.
  A vendor can flip `is_resolved` on its own updates. That is write integrity, not a read leak.

### project_assignments

- 079:1579-1592 lets the vendor read and update the whole row. `bid_notes` (scripts/010:81, labeled
  "filled by partner") is also written by the agency invite path from a request `notes` field
  (`app/api/projects/[id]/assignments/route.ts:130, :167-168`). No UI caller sending it was found.
  It is returned by the vendor-callable `app/api/projects/[id]/partner/route.ts:129-149`, which
  also returns `projects.budget_range`. SUSPECTED until R6 shows a population.
- **Adjacent, out of the list:** `projects_partner_select_assigned` (079:1657-1663) exposes the
  whole `projects` row to assigned vendors, and `app/api/projects/route.ts:347-354` embeds
  `projects(*)` on the partner branch. `projects` columns were not swept. **Recommend the same
  sweep for `projects` next.**

### CLEAN tables, briefly

- `msa_agreements`: columns are id, org_id, partnership_id, status, document_url, signed_at and
  timestamps (029:17-26). No vendor-side read exists.
- `onboarding_packages`: custom_message, kickoff_* and documents are all addressed to the vendor.
  Whole-row returns at `app/api/partner/onboarding-packages/route.ts:39-40, :127-128, :149` expose
  `library_document_id` and `org_id`, which are ids only.
- `assignment_agreements`, `partner_rfp_response_versions`: as in the table.
- `project_documents`: the vendor policy is gated on `visibility`, and vendors read only through
  `/api/documents/*`, which streams the file.
- `milestone_events`: whitelist-gated. Payloads were read at every whitelisted agency emitter:
  partnerships/route.ts:678, 807, 1058, 1568; broadcast-rfp :582; magic-link :475, :495;
  onboarding-packages :490; status-updates :281; msa/milestones :699; rfp-responses/[id] :830,
  :949, :1116, :1237. None carries private data. `bid.decline` deliberately omits the reason
  (:1218).

## Finding (1): a vendor can insert its own `delivery_reviews` row

**Evidence.**

- The only policies on `delivery_reviews` are 079:1202-1205, "Agencies manage own delivery
  reviews", `FOR ALL ... WITH CHECK (org_id IN (SELECT current_user_org_ids()))`, and the vendor
  SELECT at 079:1207-1214. 111 and 112 add no policy to `delivery_reviews` (111's policies are on
  `delivery_review_private`, 111:315-324). 112 adds only the column guard trigger
  (112:148-182). 073 is never applied.
- So **any authenticated user** can INSERT a row with `org_id` set to its own organization. The
  WITH CHECK says nothing about `partnership_id` or `project_id`, and foreign keys are checked
  without RLS. A vendor can therefore name **any** project and partnership whose ids it knows. It
  always knows its own partnership ids and assigned project ids.
- A forged `status = 'complete'` row with a chosen `composite_score`, `on_time`, `on_budget` and
  `overall_satisfaction` is visible to the vendor through 079:1207-1214. It lands in its own
  dashboard average (`app/api/partner/dashboard/route.ts:482-499`) and Performance cards
  (`app/partner/projects/page.tsx:715-718`). It is invisible to the agency.
- **Denial of service on the agency.** `UNIQUE(project_id, partnership_id)` (066:38). The agency
  save is `upsert(..., { onConflict: "project_id,partnership_id" })`
  (`app/api/agency/delivery-reviews/route.ts:218-224`). The conflicting row fails the agency's
  UPDATE USING, so the upsert raises an RLS error and the route returns 500 ("Failed to save
  delivery review", :225-228). That is inferred from Postgres ON CONFLICT semantics and not tested.
- Follow-on writes also work: `delivery_review_scores` (079:1216-1225 keys on the parent's
  `org_id`) and `delivery_review_private` (111's guard copies `org_id` from the parent). **112's
  guard does stop a forged row from carrying the six private columns.**
- The route path is closed. `POST /api/agency/delivery-reviews` checks the partnership is
  `lead_org_id IN callerOrgIds` (:166-171), which a vendor's own org fails.

**Proposed fix (not implemented).** In migration 113, use ALTER POLICY, never DROP-then-CREATE,
per the rule at 099:732-738:

```sql
ALTER POLICY "Agencies manage own delivery reviews" ON public.delivery_reviews
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND EXISTS (SELECT 1 FROM public.partnerships p
                 WHERE p.id = delivery_reviews.partnership_id
                   AND p.lead_org_id = delivery_reviews.org_id)
    AND EXISTS (SELECT 1 FROM public.projects pr
                 WHERE pr.id = delivery_reviews.project_id
                   AND pr.org_id = delivery_reviews.org_id)
  );
```

- USING is left as is. The subqueries run under the caller's RLS: the agency can read its own
  partnerships and projects; the vendor can read the partnership but fails `lead_org_id = org_id`.
- Pre-apply: F1d and F1e must be 0. If they are not, the forged rows are evidence. Read them
  before deleting anything; the deletion is an owner decision.
- Apply the same review to the sibling ALL policies whose WITH CHECK tests only the org column:
  `msa_agreements` (079:1239-1242), `rfp_magic_tokens` (079:1666-1668, USING only, which also
  serves as the check), `clients`, and `usage_tracking`. Each lets a caller insert a row in its
  own org naming another org's `partnership_id` or `project_id`.
- A pre-apply test should insert as the April vendor (expect 42501) and run the agency save path
  (expect success).

## Finding (2): a vendor can reach agency routes by switching its own `active_role`

**Evidence. Three independent doors.**

1. **The official route admits most vendors.** `app/api/profile/switch-role/route.ts:54-64`
   allows `agency` when `role === 'agency' || secondary_role === 'agency' || is_admin`.
   `handle_new_user` writes `secondary_role` as the **opposite** of the chosen role (078:149-154,
   preserved by 079 phase 12), so every vendor signup since 078 has `secondary_role = 'agency'`.
   078:122-128 says so and defers it as "a billing decision". 056 had already written
   `role = 'agency'` to every earlier account. `app/api/user/active-role/route.ts:35-38` applies
   the same test. **Neither checks `organizations.is_paid`.** F2f counts the affected profiles.
2. **Direct PostgREST.** "Users can update own profile" is table-wide with a NULL WITH CHECK
   (snapshot:207). 091's guard covers five columns (091:409-413) and deliberately omits `role`,
   `active_role` and `secondary_role` (091:298-301). 090's trigger guards only `active_org_id`.
   So `PATCH /rest/v1/profiles?id=eq.<self>` with `{"active_role":"agency"}` (or `"role"`)
   succeeds. F2a-F2e confirm this live.
3. **The page middleware does not stop it.** `middleware.ts:113` takes `active_role` (falling back
   to `role`). `:123` redirects `/agency` only when `activeRole === 'partner'`. The matcher
   excludes `api/` (:153), so API routes get no middleware check at all.

**Guards on the other side.** `requireAgencyRole` (`lib/api-auth.ts:40-64`, test at :54) and
`canActAs` (`lib/acting-role.ts:78-81`) both accept `role === 'agency' || active_role ===
'agency'`, as do the inline copies in 35 route files. `lib/acting-role.ts:75-76` assumes `active_role`
is settable only through switch-role, which is false (door 2). Neither reads entitlement.
Entitlement lives in `hasAgencyEntitlement` (`lib/entitlements.ts:505-589`, reads
`organizations.is_paid` or `profiles.is_admin`) and `canUseAgencyAi` (:613-623), and only 7
handlers call them.

**What the vendor reaches.** In every role-gated route, data access is scoped to
`resolveCallerOrgIds` / `resolveCallerWriteOrgId`, which is the vendor's own org. A vendor is never
`lead_org_id` on anything about itself, so **it does not read another tenant's rows through these
routes**. The open-items line ("each route returns only the caller's own org rows") holds for
reads, now verified per route rather than inferred, **with these exceptions**:

- **Cross-tenant write, no role needed.** `app/api/brief/save/route.ts:45-62`: service-role insert
  with a body `project_id` that is never checked. :66 returns the database error text, a
  project-id existence oracle through 055's foreign key.
- **Private blob read, no role needed.** `app/api/agency/library-documents/file/route.ts` has no
  role check (:17-27). It streams the row's `blob_url` with the app Blob token (:41), and
  `library-documents` POST/PATCH accept any `blob_url` (route.ts:74, :114; [id]/route.ts:24-25),
  checked only for a `vercel-storage.com` hostname (`lib/vercel-blob-url.ts:3-9`). Any private
  blob whose URL is known is readable, including another tenant's bid attachments. This bypasses
  `blob-download`'s path checks (:69-115).
- **Account-existence oracles (service role, unscoped profiles lookup by email):**
  - `agency/rfp/magic-link` GET `?check_email` :553 → :567, and POST :177-181 → :512.
  - `agency/pool/import-spreadsheet` (dryRun, up to 2000 emails per call) and `add-partner`, via
    `lib/server/partner-pool-import.ts:243`.
  - `agency/pool/resend-invitation` :53 → milestone payload :139.
  - `agency/email-scan/import` :62: `ilike` on a body email whose regex (:180) allows `%` and `_`,
    so it is a wildcard search. The matched profile id is stored in the caller's pool notes.
  - `agency/email-scan/run` :60.
- **Unmetered AI:** `interpret/budget`, `campaigns`, `directors`, `timeline` (role OR only);
  `agency/bids/rank` :104 and `evaluation` PUT :359 (no usage limit); `pool/[partnerId]/performance`
  :223.
- **Full unpaid agency product in its own org**, including RFP broadcast and invitation email
  sent as the platform (`agency/broadcast-rfp`; `can()` at `lib/capabilities.ts:325` is always
  true because `orgRoleFor()` :256-259 returns "owner").
- **Trusted body ids** (RLS still applies): `status-updates` POST `partnershipId` :338;
  `scoring/templates` criterion ids :43, :91.

**Proposed fix (not implemented).**

- **(a) Guard the role columns in the database.** Migration 113 or later: add `role`,
  `secondary_role` and `active_role` to an authority guard, or a sibling trigger in 091's shape,
  so a session caller cannot write them. Route the switch through a SECURITY DEFINER RPC,
  `set_active_role(target text)`, that applies the entitlement rule below. 091 left these out
  because they have live session writers (`docs/091-guard-shape.md` section 2). Those writers
  (switch-role, user/active-role, any settings form) must move to the RPC **first**, the same
  code-first order as 105-112.
- **(b) Make "can act as agency" an entitlement, not a role string.** The switch to agency
  requires the acting org to be a lead agency and paid (`organizations.is_lead_agency` and
  `is_paid`) or `is_admin`. Stop treating `secondary_role = 'agency'` as a grant. This is the
  billing decision 078:122-128 deferred: **owner ruling required.**
- **(c) Route layer.** Make `requireAgencyRole` / `canActAs` require
  `hasAgencyEntitlement`-equivalent org status, and replace the 35 inline copies with the helper.
  Add `requireAgencyRole` to `library-documents/file`. Restrict stored `blob_url` to the caller
  org's own path prefix, mirroring `blob-download`. Add a project-ownership check to `brief/save`
  and stop returning raw error text. Add usage gates to the four `interpret/*` routes, `rank` and
  `evaluation` PUT. Escape `%` and `_` (or use `eq` on a normalized email) in `email-scan/import`.
- **(d) Optional defense in depth:** extend the middleware matcher to `/api/agency/:path*` with the
  same role test. That only helps once (a) or (b) makes the role trustworthy.

## Route guard inventory

67 route files were read, every handler. Line numbers are in the per-file tables below. "OR" means
`role === 'agency' || active_role === 'agency'`.

| Guard type | Files | Vendor who self-sets `active_role` reaches it? |
|---|---|---|
| Inline OR copy | 35: active-engagements, bids/[responseId]/{ai-score, decompose, evaluation}, bids/compare, bids/rank, blob-download, broadcast-rfp, broadcast-rfp/resend-invite, client-cash-flow, delivery-reviews, email-connections, email-scan, email-scan/import, email-scan/run, msa, msa/milestones, pool/[partnerId]/notes, pool/[partnerId]/performance, pool/[partnerId] (canActAs), projects/[projectId]/status-updates, rfp-responses, rfp-responses/[id], rfp/magic-link, utilization, interpret/{budget, campaigns, directors, timeline}, projects/[id] (canActAs), projects/[id]/onboarding/deploy (canActAs), projects/[id]/onboarding-packages (POST OR, GET none), and the canActAs-equivalent actingRole branches in projects/[id]/messages, projects/[id]/agreements/[agreementId] and projects (GET) | **YES**, own org (exceptions above) |
| `requireAgencyRole` (OR) | 17: bids/[responseId]/generate-summary, client-projects, clients, clients/[id], dashboard, library-documents, library-documents/[id], pool/add-partner, pool/client-history, pool/colleague-connections, pool/import-spreadsheet, pool/resend-invitation, rfp-closure, scoring/criteria, scoring/criteria/[id], scoring/templates, usage | **YES**, own org |
| Role check plus paid-org entitlement (`hasAgencyEntitlement` / `canUseAgencyAi`) | 6 files plus 1 handler: msa/ai-schedule, payment-synthesis, projects/duplicate, ai/master-brief, ai/rfp-output-template, ai (route.ts); plus projects POST | **NO**, unless the vendor's own org `is_paid` |
| Org membership only, no role check | 2: projects/[id]/assignments, projects/[id]/onboarding-partners | yes, without switching; own org only |
| Auth only, no role and no org check | 2: agency/library-documents/file, brief/save | **YES, without switching**; cross-tenant (see above) |
| `is_admin` (or signed token) | 4: admin/grant-access, admin/grant-agency-access, admin/users, admin/users/[userId]/flags | NO |
| Vendor-side route | 1: projects/[id]/partner | n/a |

**Totals: 46 `app/api/agency/**` files.** 45 accept the OR; 1 (`library-documents/file`) has no
role check; 3 (`msa/ai-schedule`, `payment-synthesis`, `projects/duplicate`) also require a paid
org; 0 check `secondary_role`; 0 check `is_lead_agency`. **No agency route checks paid
entitlement except those 3.** A self-switched vendor reaches **43 of the 46** (42 through the OR,
plus `library-documents/file` without switching). Across all 67 files, it reaches 56 (52 by
switching, 4 without), 10 are closed to it (6 entitlement-gated, 4 admin), and 1 is vendor-side.

Helpers, exactly:

- `requireRole` (`lib/api-auth.ts:40-59`) selects `role, active_role, is_admin` (:46). It refuses
  when `role !== required && active_role !== required` (:54). `is_admin` is selected but unused.
- `canActAs` is `lib/acting-role.ts:78-81`. `actingRole` (:50-54) prefers `active_role`.
- `resolveCallerOrgIds` (`lib/entitlements.ts:187-208`) reads `org_members` and fails closed to
  `[]`.
- `agencyEntitlementId` (:346-351) falls back to the **user id** when no org resolves.

## ASSUMPTIONS

- The live policy set equals the last migration definition for every swept table, given the
  owner-verified apply status. Where 079 left a pre-079 policy untouched, the 2026-08-13 snapshot
  stands for it. That covers the discoverable profiles policy, "Users can update own profile" and
  the inbox email policy. The confirm SQL checks each.
- Columns come from `scripts/` DDL, which `docs/schema-truth.md` says is partly out of band. The
  confirm SQL lists the live columns rather than assuming them.
- **ON CONFLICT DO UPDATE against a row failing the UPDATE USING raises rather than skips.** This
  is standard Postgres RLS behavior. The agency 500 in finding (1) depends on it and was not
  executed.
- The agency override insert in `partner_status_updates` is refused by RLS, inferred from the
  absence of an agency INSERT policy and not tested.
- Treating the evaluation rubric as agency-private follows the brief's own example. The owner can
  rule it public, which moves that row to INTENDED DISCLOSURE.
- The three sweeps' reports were relied on for routes I did not re-read line by line. I re-read
  every line this document's CONFIRMED rows and both findings depend on.

## REFUSED

- No application code, migration, policy or `LIGAMENT_CONTEXT.md` change. Every fix above is a
  proposal.
- No SQL executed and no database access. No `.env*` or credential file opened. No pnpm, tsc,
  lint or node. No network.
- No exploit attempted, not even read-only PostgREST calls with a vendor session. Every "a vendor
  can" here is from policy text and code, to be confirmed by `scripts/sql/sweep-confirm.sql` and
  the owner's own session tests.
- No push, merge, rebase or branch change.
