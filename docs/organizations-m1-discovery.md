# Organizations Epic - M1 Discovery

**Date:** Aug 13, 2026
**Repo head at time of writing:** `dcf748f`, tree clean apart from `next-env.d.ts`
**Status:** DISCOVERY ONLY. No application code written, no migration authored, no schema changed, no write query executed.
**Decision owner:** Greg. Seven judgment calls are surfaced below; the build session follows his ruling.

---

## 0. How to read the evidence markers

Catalog access was unavailable this run. `POSTGRES_PASSWORD`, `POSTGRES_URL` and
`POSTGRES_URL_NON_POOLING` are absent from `.env.local` and present-but-unreadable in
`.env.production.local`; there is no `psql` and no Postgres driver in the project. Nothing in this
document was confirmed by querying `pg_policies`, `pg_class`, `information_schema` or any live row.

Every claim is therefore tagged:

| Marker | Meaning |
|--------|---------|
| **CONFIRMED** | Supplied as ground truth in the run brief. Six policies total (`clients`, `agency_library_documents`, five on `projects`). Not re-derived, not questioned. |
| **READ** | Read directly out of a file in this repo. The file exists and says this. Whether it was ever applied to the live database is a separate question. |
| **INFERRED** | Reconstructed by reading a chain of migrations and reasoning about which later statement supersedes which earlier one. Load-bearing but not proven. |
| **UNCONFIRMED** | Needs a catalog query before anything is built on it. Every one of these has a query in the appendix. |

The instruction to work this way came from a real failure: a prior run in this codebase shipped a
feature on an inferred CHECK constraint that did not exist. Nothing below repeats that.

---

## 1. FINDING ZERO: the migration history on disk cannot reproduce the live database

This is not part of the requested scope but it changes how every other section should be read, so
it goes first.

**The numbered migration directory does not contain the schema.** `supabase/migrations/` starts at
`040`. Migrations `001-038` live in a completely different directory, `scripts/`, under a different
and inconsistent naming convention (`001_create_profiles.sql`, `010-closed-ecosystem-schema.sql`).
`LIGAMENT_CONTEXT.md` describes them only as "Core schema (see legacy handoff docs)". **READ.**

Concretely, the following gaps exist between what the repo can reproduce and what production runs:

| Gap | Evidence | Consequence for M1 |
|-----|----------|--------------------|
| **`rfp_magic_tokens` has no `CREATE TABLE` anywhere on disk.** Migrations 057, 059, 060, 061, 074 all `ALTER` it. 29 code sites query it. | Grepped every `CREATE TABLE` in `scripts/` and `supabase/migrations/`; the table is absent from the resulting list. **READ.** | Its full column list, FK targets and RLS posture are unknown. This is a **primary** identity table (`agency_id`, `partnership_id`, `domain_match_profile_id`). |
| **`msa_agreements` and `payment_milestones` exist live but their DDL file is `scripts/029-msa-payments.SKIP`** - a file deliberately named so it would not run. | Policies in `030-` and `031-` reference `payment_milestones`; 12 code sites query it. **READ.** | Whatever actually created these tables is not in version control. Their real column set may differ from the `.SKIP` file. |
| **`partnership_profile_context` has no DDL on disk.** Queried from `app/partner/profile/page.tsx:301,685`. | **READ.** | Vendor-side identity table of unknown shape. |
| **`notifications` has no DDL on disk** but `scripts/026-security-fixes.sql` rewrites its INSERT policy. No application code reads or writes it. | **READ.** | Either a dead table with a live policy, or an out-of-band feature. Either way it carries `user_id`. |
| **`rfps` has no DDL on disk.** `054` does `ALTER TABLE rfps ADD COLUMN interpretation_id`. No code queries it by that name. | **READ.** | Unknown. |
| **`profiles.linked_agency_id` has no DDL on disk.** Selected in `contexts/paid-user-context.tsx:107`, exposed as `linkedAgencyId` on the context. | **READ.** | A column that already means "which company does this user belong to". M1 must decide whether it is the seed of the answer or a vestige to be removed. It is read but, as far as this grep found, never written by application code. |
| **Migration 073 does not exist.** The sequence runs 071, 072, 074. | **READ.** | Numbering gap, no evidence of loss. |
| **Migration 048 is documented as applied but has no file.** Already flagged in `LIGAMENT_CONTEXT.md` line 46. | **READ.** | Precedent: this project has applied SQL in the Supabase editor without committing it. |
| **`LIGAMENT_CONTEXT.md`'s migrations table stops at 074** and omits 071, 072, 075, 076, 077 entirely, while its header claims "001-066". | **READ.** | The migration log is itself out of date. |

**Direct disagreement with the CONFIRMED data.** The brief confirms `projects` carries five
policies: `projects_agency_select`, `projects_agency_insert`, `projects_agency_update`,
`projects_agency_delete`, `projects_partner_select_assigned`.

None of those five names appears anywhere in this repository. Grepped across `*.sql`, `*.ts`,
`*.md` - zero hits. What the repo *does* contain is
`scripts/010-closed-ecosystem-schema.sql:193-206`, which creates `"Agencies can manage their
projects"` (FOR ALL, `USING (agency_id = auth.uid())`, **no WITH CHECK**) and `"Partners can view
assigned projects"` (SELECT, `id IN (SELECT pa.project_id FROM project_assignments pa JOIN
partnerships p ON pa.partnership_id = p.id WHERE p.partner_id = auth.uid())`). **READ.**

So the live `projects` policies were replaced out of band by SQL that was never committed. The
replacement is a genuine improvement - it split FOR ALL into four explicit commands and added the
missing `WITH CHECK` on insert and update, closing a real hole where an agency could have written a
row owned by someone else. But the improvement is invisible to this repository. **That is the
finding.** Any M1 migration that says `DROP POLICY "Agencies can manage their projects"` will
silently no-op and leave the real policies untouched.

Similarly, `clients` is created by `supabase/migrations/077_client_profiles.sql`, whose own header
comment reads **"Authored Aug 13, 2026. NOT APPLIED."** The brief confirms the table's policy is
live. So 077 was applied and neither its header nor `LIGAMENT_CONTEXT.md` was updated. **READ vs
CONFIRMED, in conflict.**

**Recommendation, unprompted but cheap:** before the M1 build session, dump `pg_policies` and
`information_schema.columns` for the public schema and commit the output as
`docs/schema-snapshot-<date>.md`. Query A0 in the appendix does this. Without it, every M1 migration
is authored against a fiction.

---

## 2. Phase 0.1 - The identity inventory (blast radius)

"Company identity column" means: a column whose value is today a `auth.users.id` and which the
application treats as answering "which company owns this row".

Row counts could not be obtained (no DB access). Query A1 in the appendix returns all of them in one
result set.

### 2.1 Agency-side company identity

| Table | Column(s) | References | FK exists? | DDL source | Row count |
|-------|-----------|------------|-----------|------------|-----------|
| `profiles` | `id` **is** the identity | `auth.users(id)` | Yes | `scripts/001_create_profiles.sql` **READ** | UNCONFIRMED |
| `profiles` | `linked_agency_id` | unknown | UNCONFIRMED | **no DDL on disk** | UNCONFIRMED |
| `projects` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/010` **READ** | UNCONFIRMED |
| `partnerships` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/010` **READ** | UNCONFIRMED |
| `partner_rfp_inbox` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/013` **READ** | UNCONFIRMED |
| `partner_rfp_responses` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/014` **READ** | UNCONFIRMED |
| `partner_rfp_response_versions` | `agency_id` | **nothing** - bare `UUID NOT NULL` | No | `scripts/021` **READ** | UNCONFIRMED |
| `onboarding_deployments` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/012` **READ** | UNCONFIRMED |
| `agency_library_documents` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/024` **READ** | UNCONFIRMED |
| `onboarding_packages` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/024` **READ** | UNCONFIRMED |
| `client_cash_flow` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/037` **READ** | UNCONFIRMED |
| `agency_partner_invitations` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/003` **READ** | UNCONFIRMED |
| `partner_access_requests` | `agency_id` | `profiles(id)` NOT NULL | Yes | `scripts/008` **READ** | UNCONFIRMED |
| `partner_vouches` | `voucher_agency_id` | `auth.users(id)` NOT NULL | Yes | `053` **READ** | UNCONFIRMED |
| `bid_decompositions` | `agency_id` | **nothing** - bare `uuid NOT NULL` | **No** | `064` **READ** | UNCONFIRMED |
| `bid_comparisons` | `agency_id` | **nothing** | **No** | `064` **READ** | UNCONFIRMED |
| `bid_scoring_criteria` | `agency_id` | **nothing** | **No** | `065` **READ** | UNCONFIRMED |
| `bid_scoring_templates` | `agency_id` | **nothing** | **No** | `065` **READ** | UNCONFIRMED |
| `bid_evaluations` | `agency_id` | **nothing** | **No** | `065` **READ** | UNCONFIRMED |
| `delivery_reviews` | `agency_id` | **nothing** | **No** | `066` **READ** | UNCONFIRMED |
| `usage_tracking` | `agency_id` | `auth.users(id)` NOT NULL | Yes | `067` **READ** | UNCONFIRMED |
| `clients` | `agency_id` | **nothing** | **No** | `077` **READ** | UNCONFIRMED |
| `rfp_magic_tokens` | `agency_id` | UNCONFIRMED | UNCONFIRMED | **no DDL on disk** | UNCONFIRMED |
| `msa_agreements` | `agency_id` | `profiles(id)` per `.SKIP` file | UNCONFIRMED | **`.SKIP` only** | UNCONFIRMED |
| `payment_milestones` | `agency_id` | `profiles(id)` per `.SKIP` file | UNCONFIRMED | **`.SKIP` only** | UNCONFIRMED |

**Sub-finding: six of the newest tables (064, 065, 066, 077) declare `agency_id uuid NOT NULL` with
no foreign key at all.** `bid_decompositions`, `bid_comparisons`, `bid_scoring_criteria`,
`bid_scoring_templates`, `bid_evaluations`, `delivery_reviews`, `clients`. Nothing at the database
level stops an arbitrary uuid landing there. Today RLS masks this, because `WITH CHECK (agency_id =
auth.uid())` forces the value. Under M1, if the policy becomes a membership lookup, the absence of an
FK means a bug that writes the wrong `organization_id` will not be caught by the database. **This is
the one place where M1 should probably add constraints it does not strictly need**, because the
migration is already touching these tables.

### 2.2 Vendor-side (partner) company identity

| Table | Column(s) | References | FK exists? | DDL source | Note |
|-------|-----------|------------|-----------|------------|------|
| `partnerships` | `partner_id` | `profiles(id)`, declared NOT NULL in `scripts/010` | Yes | **READ** | **Now nullable.** Migration `045`'s policy predicate is `partner_id IS NULL`, and `061` introduced ghost/unclaimed rows. The NOT NULL was dropped out of band. **INFERRED.** |
| `partnerships` | `partner_email` | - | n/a | pre-dates the migration log per `061`'s comment | The real identity for an unclaimed vendor is an **email string**, not a uuid. |
| `partner_rfp_inbox` | `partner_id` | `profiles(id)`, nullable | Yes | `scripts/013` **READ** | Plus `recipient_email` as the pre-claim identity. |
| `partner_rfp_responses` | `partner_id` | `profiles(id)`, NOT NULL dropped by `057` | Yes | **READ** | Guest bids carry null. |
| `partner_rfp_response_versions` | `partner_id` | **nothing** - bare `UUID NOT NULL` | No | `scripts/021` **READ** | |
| `partner_vouches` | `vouched_partner_id` | `auth.users(id)` | Yes | `053` **READ** | |
| `partner_access_requests` | `partner_id` | `profiles(id)` NOT NULL | Yes | `scripts/008` **READ** | |
| `agency_partner_invitations` | `partner_id` | `profiles(id)` nullable | Yes | `scripts/003` **READ** | |
| `rfp_magic_tokens` | `domain_match_profile_id`, `vendor_email` | `profiles(id)` per `061` | UNCONFIRMED | **READ (061 only)** | |
| `partnership_profile_context` | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | **no DDL on disk** | |

### 2.3 Per-user identity that is *not* company identity (in scope only because M1 must not break it)

| Table | Column | Meaning |
|-------|--------|---------|
| `brief_interpretations` | `user_id` → `auth.users` | Genuinely per-person AI artifact. **READ**, `054`. |
| `email_connections` | `user_id` → `auth.users`, `UNIQUE(user_id, provider)` | Genuinely per-person OAuth grant. **READ**, `062`. |
| `shared_documents` | `uploaded_by` → `profiles` | Actor, not owner. **READ**, `scripts/010`. |
| `assignment_messages` | `sender_id` → `profiles` | Actor. **READ**, `scripts/010`. |
| `assignment_agreements` | `signed_by` → `profiles` | Actor. **READ**, `scripts/012`. |
| `notifications` | `user_id` | Per-person. **READ** (policy only). |

These four `uploaded_by` / `sender_id` / `signed_by` / `msa_confirmed_by` columns are the **only
existing actor-attribution columns in the schema**. They are the precedent M2 should follow, and M1
must not repurpose them as company identity.

### 2.4 Tables with no identity column, scoped transitively

`project_assignments` (via `project_id` → `projects.agency_id` and `partnership_id` →
`partnerships.partner_id`), `bid_evaluation_scores` (via `evaluation_id`), `delivery_review_scores`
(via `review_id`), `onboarding_package_documents` (via package), `partner_status_updates` (via
`project_assignment_id` / `project_id` / `partnership_id`), `shared_documents` and
`assignment_messages` (via `assignment_id`). **READ.**

**These are the cheapest part of the epic.** They inherit the answer from their parent. If the parent
policy becomes org-aware, they become org-aware for free, with zero column changes. Roughly a third
of the schema falls in this bucket.

---

## 3. Phase 0.2 - Reconstructed RLS policy inventory

Reconstructed from every `CREATE POLICY` / `DROP POLICY` in `scripts/*.sql` and
`supabase/migrations/*.sql`, applied in numeric order. **Because of Finding Zero, this reconstruction
is known to be wrong for at least `projects`** - and there is no way to know from inside the repo
where else it is wrong. Query A0 settles all of it at once.

Legend: `uid` = `auth.uid()`.

### 3.1 The six CONFIRMED policies

| Table | Policy | Cmd | Roles | Predicate |
|-------|--------|-----|-------|-----------|
| `clients` | Agencies manage own clients | ALL | authenticated | `agency_id = uid` (qual + with_check) |
| `agency_library_documents` | Agency manages own library documents | ALL | authenticated | `agency_id = uid` (qual + with_check) |
| `projects` | projects_agency_select | SELECT | authenticated | `agency_id = uid` |
| `projects` | projects_agency_insert | INSERT | authenticated | `agency_id = uid` (with_check) |
| `projects` | projects_agency_update | UPDATE | authenticated | `agency_id = uid` (qual + with_check) |
| `projects` | projects_agency_delete | DELETE | authenticated | `agency_id = uid` |
| `projects` | projects_partner_select_assigned | SELECT | authenticated | `EXISTS (SELECT 1 FROM project_assignments pa JOIN partnerships p ON p.id = pa.partnership_id WHERE pa.project_id = projects.id AND p.partner_id = uid)` |

`projects_partner_select_assigned` is **the in-schema precedent M1 needs**: a policy on table X whose
predicate is an `EXISTS` subquery over two *other* tables, one of which resolves `auth.uid()` to a
membership. Agency-side M1 is the same shape with `org_members` in place of `partnerships`. The one
structural difference - and it is the whole of Judgment Call 2 - is that `projects` querying
`partnerships` is a query across tables, whereas `org_members` querying `org_members` is not.

### 3.2 Reconstruction of everything else - all UNCONFIRMED

| Table | Policy (reconstructed) | Cmd | Predicate | Notes |
|-------|------------------------|-----|-----------|-------|
| `profiles` | profiles_select_own | SELECT | `uid = id` | `scripts/001` |
| `profiles` | profiles_insert_own | INSERT | `uid = id` | `scripts/001` |
| `profiles` | profiles_update_own | UPDATE | `uid = id` | `scripts/001` |
| `profiles` | profiles_delete_own | DELETE | `uid = id` | `scripts/001`. **A user can delete their own profile row, which cascades.** Under M1 this deletes an org member; whether it should delete the org is undecided. |
| `profiles` | Users can view own profile | SELECT | `uid = id` | `scripts/009` - duplicate of `profiles_select_own`, both presumably still present |
| `profiles` | Users can update own profile | UPDATE | `uid = id` | `scripts/009` - duplicate |
| `profiles` | Admins can view all profiles | SELECT | `EXISTS(... profiles p2 WHERE p2.id = uid AND p2.is_admin)` | `scripts/009`. **A self-referential policy on `profiles` that subqueries `profiles`.** If this is live and has not recursed, that is direct evidence about how Postgres handles the recursion question in Judgment Call 2 - see §7.2. |
| `profiles` | Admins can update all profiles | UPDATE | same | `scripts/009` |
| `profiles` | Authenticated users can read discoverable profiles | SELECT | discoverability flag | `scripts/016` |
| `profiles` | Agencies read partner profiles for their partnerships | SELECT | `EXISTS(partnerships p WHERE p.agency_id = uid AND p.partner_id = profiles.id)` | `scripts/032`. Also duplicated in `scripts/029-*.SKIP` under a different name. |
| `profiles` | Partners read lead agency profiles for their partnerships | SELECT | mirror of above | `scripts/030` |
| `partnerships` | Agencies can view their partnerships | SELECT | `agency_id = uid` | `scripts/010` |
| `partnerships` | Partners can view their partnerships | SELECT | `partner_id = uid` | `scripts/010` |
| `partnerships` | Agencies can create partnerships (invite) | INSERT | `agency_id = uid` | `scripts/010` |
| `partnerships` | Agencies can update their partnerships | UPDATE | `agency_id = uid` | `scripts/010`. **USING only, no WITH CHECK** - an agency could in principle update a row's `agency_id` to someone else's. Pre-existing, not introduced by M1, but M1 is the moment to fix it. |
| `partnerships` | Partners can accept partnerships | UPDATE | `partner_id = uid AND status = 'pending'` | `scripts/010` |
| `partnerships` | Partners can claim partnership by email | UPDATE | `partner_id IS NULL AND partner_email ILIKE (SELECT email FROM profiles WHERE id = uid)`, WITH CHECK `partner_id = uid` | `045` |
| `project_assignments` | Agencies can manage assignments for their projects | ALL | `project_id IN (SELECT id FROM projects WHERE agency_id = uid)` | `scripts/010`. Inherits org-awareness free. |
| `project_assignments` | Partners can view their assignments | SELECT | `partnership_id IN (SELECT id FROM partnerships WHERE partner_id = uid)` | `scripts/010` |
| `project_assignments` | Partners can update their assignments (submit bids) | UPDATE | same | `scripts/010` |
| `shared_documents` | Users can view documents in their assignments | SELECT | join to `partnerships` on either side | `scripts/010` |
| `shared_documents` | Users can upload documents to their assignments | INSERT | `uploaded_by = uid AND` join | `scripts/010` |
| `assignment_messages` | Users can view messages in their assignments | SELECT | join | `scripts/010` |
| `assignment_messages` | Users can send messages in their assignments | INSERT | `sender_id = uid AND` join | `scripts/010` |
| `partner_rfp_inbox` | Agencies insert / Agencies select own | INSERT/SELECT | `agency_id = uid` | `scripts/013` |
| `partner_rfp_inbox` | Partners select by partner_id | SELECT | `partner_id = uid` | `scripts/013` |
| `partner_rfp_inbox` | Partners select by recipient email | SELECT | email match via `profiles` | `scripts/013` |
| `partner_rfp_inbox` | Partners update own inbox rows | UPDATE | `partner_id = uid` | `scripts/013` |
| `partner_rfp_responses` | Partners select / insert / update own | S/I/U | `partner_id = uid` | `scripts/014` |
| `partner_rfp_responses` | Agencies select RFP responses they own | SELECT | `agency_id = uid` | `scripts/014` |
| `partner_rfp_responses` | Agencies update response status and feedback | UPDATE | `agency_id = uid` | `scripts/018` |
| `partner_rfp_responses` | Partners read response status and feedback | SELECT | `partner_id = uid` | `scripts/018` |
| `partner_rfp_response_versions` | Partners read / insert own; Agencies read owned | S/I/S | `partner_id = uid` / `agency_id = uid` | `scripts/021`, re-issued by `scripts/023` |
| `onboarding_deployments` | Agencies manage for own projects | ALL | project join to `agency_id = uid` | `scripts/012` |
| `onboarding_deployments` | Partners read for their assignments | SELECT | assignment join | `scripts/012` |
| `assignment_agreements` | Agencies manage for their project assignments | ALL | join | `scripts/012` |
| `assignment_agreements` | Partners read and update own | S/U | join | `scripts/012` |
| `assignment_agreements` | Partners update agreement signature fields | UPDATE | join | `scripts/012` |
| `agency_library_documents` | (see CONFIRMED) | ALL | `agency_id = uid` | `scripts/024` created it; brief CONFIRMS it live |
| `onboarding_packages` | Agency full access for own projects | ALL | join | `scripts/024` |
| `onboarding_packages` | Partner reads for their partnership | SELECT | join | `scripts/024` |
| `onboarding_packages` | Partner updates review fields | UPDATE | join | `scripts/024` |
| `onboarding_package_documents` | Agency full access; Partner reads | ALL/SELECT | join | `scripts/024` |
| `partner_status_updates` | Partners read own; insert for own assignment | S/I | join | `scripts/028` |
| `partner_status_updates` | Agency read for own projects; update resolve flag | S/U | join | `scripts/028` |
| `payment_milestones` | Partners read for their partnerships | SELECT | join | `scripts/030` |
| `payment_milestones` | Partners read for awarded assignment projects | SELECT | join | `scripts/031` |
| `payment_milestones` | **agency-side policy** | ? | ? | **Only in `scripts/029-*.SKIP`.** UNCONFIRMED whether an agency-side policy exists at all. |
| `msa_agreements` | Agencies manage own MSA agreements | ALL | `agency_id = uid` | **`.SKIP` only.** UNCONFIRMED. |
| `projects` | Partners read projects with their payment milestones | SELECT | milestone join | `scripts/030`. **Note: the CONFIRMED list for `projects` has five policies and this is not among them.** Either it was dropped out of band or the CONFIRMED list is a filtered view. Worth resolving - see appendix A2. |
| `client_cash_flow` | Agencies manage own client cash flow | ALL | `agency_id = uid` | `scripts/037` |
| `contact_submissions` | Anyone can insert | INSERT | `true` | `scripts/026` |
| `contact_submissions` | Admins can read | SELECT | `is_admin` | `scripts/026` |
| `notifications` | Scoped insert notifications | INSERT | `user_id = uid OR EXISTS(partnerships ... status='active')` | `scripts/026`. **No SELECT policy anywhere on disk.** |
| `partner_access_requests` | Partners view/create own; Agencies view/update requests to them | S/I/S/U | `partner_id = uid` / `agency_id = uid` | `scripts/008` |
| `invitation_requests` | Partners view/create own; Agencies view/update by email match | S/I/S/U | uid / email match | `scripts/009` |
| `agency_partner_invitations` | Agencies view/create/update theirs; Partners view/update theirs | 5 policies | `agency_id = uid` / partner email or id | `scripts/003` |
| `partner_vouches` | Anyone can count vouches | SELECT | `true` | `053` |
| `partner_vouches` | Agencies can vouch / can remove their vouch | I/D | `uid = voucher_agency_id` | `053` |
| `brief_interpretations` | Users can manage their own interpretations | ALL | `uid = user_id` | `054` |
| `email_connections` | Users manage their own email connections | ALL | `uid = user_id` | `062` |
| `bid_decompositions` | Agencies manage own bid decompositions | ALL | `agency_id = uid` | `064` |
| `bid_comparisons` | Agencies manage own bid comparisons | ALL | `agency_id = uid` | `064` |
| `bid_scoring_criteria` | Agencies manage own scoring criteria | ALL | `agency_id = uid` | `065` |
| `bid_scoring_templates` | Agencies manage own scoring templates | ALL | `agency_id = uid` | `065` |
| `bid_evaluations` | Agencies manage own bid evaluations | ALL | `agency_id = uid` | `065` |
| `bid_evaluation_scores` | Agencies manage own bid evaluation scores | ALL | `EXISTS(bid_evaluations e WHERE e.id = evaluation_id AND e.agency_id = uid)` | `065`. Second in-schema precedent for the EXISTS shape. |
| `delivery_reviews` | Agencies manage own delivery reviews | ALL | `agency_id = uid` | `066` |
| `delivery_reviews` | Partners view own complete delivery reviews | SELECT | `status='complete' AND EXISTS(partnerships p WHERE p.id = partnership_id AND p.partner_id = uid)` | `066`. Third precedent. |
| `delivery_review_scores` | Agencies manage own delivery review scores | ALL | `EXISTS(delivery_reviews r ...)` | `066` |
| `usage_tracking` | Agencies manage own usage tracking | ALL | `agency_id = uid` | `067` |

### 3.3 Tables with no policy found on disk - all UNCONFIRMED and all security findings if true

| Table | Concern |
|-------|---------|
| `rfp_magic_tokens` | No `ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY` anywhere on disk. **This table holds the guest-access secret for every Lightning RFP.** Every code path that touches it uses the service role, which is consistent with RLS-enabled-but-no-policy (total lockout for normal clients) *and* consistent with RLS-disabled (total exposure). Those two states are opposites. **This is the single highest-value UNCONFIRMED item in this document** - query A3. |
| `partnership_profile_context` | No DDL, no policy on disk. Queried from the browser client in `app/partner/profile/page.tsx`, meaning it is reachable with an anon key. If RLS is off, any authenticated user can read every vendor's partnership context. Query A3. |
| `notifications` | INSERT policy exists; no SELECT/UPDATE/DELETE policy on disk. If RLS is enabled with only an INSERT policy, reads are locked out entirely - which matches the observation that no code reads it. |
| `rfps` | No DDL, no policy. Unknown. |
| `payment_milestones`, `msa_agreements` | RLS enable statements exist only in the `.SKIP` file. Query A3. |
| `contact_submissions` | Has `INSERT WITH CHECK (true)` for what is presumably `anon`. Correct for a public form, but worth confirming the role list is not `public`. |

`scripts/verify-rls.mjs` exists and was written to catch exactly the "RLS enabled, zero policies"
case. It requires `SUPABASE_SERVICE_ROLE_KEY` and, per its own comments, assumes PostgREST exposes
`pg_class` and `pg_policy` to the service role. **That assumption is wrong** - PostgREST exposes only
the schemas in its exposed-schema list, which does not include `pg_catalog`. The script cannot have
worked as written. It was not run this session (it would require the service role key and would
produce no useful output). Query A3 replaces it.

---

## 4. Phase 0.3 - Service role inventory (SECURITY)

**22 API route files construct a client with `SUPABASE_SERVICE_ROLE_KEY`.** Each one bypasses RLS
completely; the only thing standing between a request and the whole table is the hand-written check
in that file. Today, "the agency" and "the user" being the same uuid means a route that filters by
`agency_id = <session uid>` is *accidentally* correct. Under M1 that identity breaks and each of
these becomes a route that must explicitly resolve "which organization is this caller in" - and, for
writes, "is this caller allowed to act for that organization".

Ranked by risk under M1. Risk = (breadth of data reachable) × (weakness of the manual check).

### RANK 1 - CRITICAL: `app/api/admin/users/route.ts`

```
const OWNER_EMAIL = "greg@withligament.com"
if (user.email !== OWNER_EMAIL) return 403
serviceClient.from("profiles").select("*").limit(500)
```

Authorization is a hardcoded email string compared against `user.email`, not a database flag - it
does not consult `profiles.is_admin` at all. It then selects **every column of every profile**,
including `business_criteria`, `default_terms`, `default_nda_url` and every LinkedIn/contact field,
for 500 users across all companies.

Under M1: unchanged in mechanism, but the blast radius grows with every seat added, and a hardcoded
personal email is not an authorization model for a product that is about to have organizations with
admins. **Should be `profiles.is_admin` plus an explicit column list, and it should be fixed
independently of M1.**

### RANK 2 - CRITICAL: `app/api/admin/grant-access/route.ts`

Takes `user_id` from the query string and updates that profile. Guarded by `GRANT_ACCESS_SECRET`
(present in `.env.production.local`). There is **no session check at all** - the secret is the whole
authorization. `LIGAMENT_CONTEXT.md` P16 records that a sibling route (`/api/admin/notify-new-user`)
previously had no auth whatsoever and "would mint a real grant-access token for any POSTed
`{record:{id,email}}`", fixed by adding `WEBHOOK_SECRET`.

Under M1: a bearer-secret route that can flip access flags on an arbitrary user id becomes a route
that can flip access flags on an arbitrary *organization member*. The secret must never appear in a
URL (query strings land in logs, Referer headers, and Vercel's request log). **Move to a header, and
add a session-plus-`is_admin` check as defence in depth.**

### RANK 3 - HIGH: `app/api/rfp/guest/[token]/route.ts` (803 lines)

The largest service-role surface in the codebase. Authorization is **possession of a magic token
only** - no session exists by design. Beyond reading the token row, it *writes*: it inserts and
updates `partnerships` rows scoped to `agency_id` taken **from the token row**, and reads `profiles`
by email to domain-match vendors.

Under M1 this is the most consequential route in the inventory, because a token minted by one member
of an organization confers writes into that organization's partner pool with no member context at
all. Once M2 adds attribution, every row this route creates has no honest actor to record. **M1 must
decide what `created_by` means for a guest-originated write** - most likely the token's issuer,
carried on `rfp_magic_tokens` as a new column, which is why this route is called out now rather than
deferred to M2.

Companions, same trust model, smaller surface: `.../attach-existing-account/route.ts`,
`app/api/rfp/guest/file/route.ts`, `app/api/rfp/guest/upload/route.ts`. The file/upload pair validate
that the blob path's embedded token matches the supplied token before serving - a genuinely good
check, worth preserving verbatim.

### RANK 4 - HIGH: `app/api/agency/rfp/magic-link/route.ts` (410 lines)

Does the right thing structurally: anon-client `auth.getUser()` and a `profiles` role check first,
then every service-role query re-scoped with `.eq("agency_id", auth.userId)` (4 sites) and
`.eq("id", projectId).eq("agency_id", auth.userId)` for project ownership. It is the **best example
in the codebase** of a service-role route that scopes deliberately rather than accidentally.

Under M1 it is also the route with the most `agency_id = auth.userId` bindings to rewrite. Every one
of those four becomes `agency_id IN (<caller's orgs>)` or, better, `= <caller's resolved org>`. It
should be the template the other 21 are refactored toward.

### RANK 5 - HIGH: `app/api/agency/email-scan/run/route.ts` (374 lines) and `import/route.ts`

Service role reads `profiles` by email across **all companies** (`.in("email", contactEmails)`) to
match scanned Gmail contacts to existing accounts, then inserts `partnerships` rows. The
cross-company `profiles` read is inherent to the feature (that is what matching means) but it is a
service-role read of other companies' user records driven by attacker-influenceable input (whatever
is in the caller's mailbox).

Under M1: `email_connections` is correctly per-user (`UNIQUE(user_id, provider)`), but the
partnerships it creates are company-level. **A colleague's mailbox scan writes into the shared pool.**
That is probably the desired behaviour and is worth stating explicitly rather than discovering.

### RANK 6 - MEDIUM: `app/api/partner/rfps/route.ts`, `bids/route.ts`, `projects/route.ts`

All three hold a session and check the role, then use the service client for cross-table joins
(`profiles` by id list, `projects`, `partner_rfp_inbox`). `partner/rfps/route.ts:134` carries the
comment *"RLS applies: partner sees rows where partner_id = auth.uid() OR recipient_email matches"* -
but the query is issued on the **service** client on the line above, so RLS does **not** apply. The
comment describes an intent the code does not implement. The actual scoping comes from
`.eq("partner_id", user.id)` filters, which are present and correct, so the behaviour is right today
and the comment is wrong.

Under M1 (vendor companies are also multi-user) each of these `.eq("partner_id", user.id)` filters is
exactly the vendor-side conflation and must become a membership lookup. **The stale comments should
be corrected in the same pass**, because the next person to touch these files will trust them.

### RANK 7 - MEDIUM: `app/api/agency/pool/add-partner/route.ts`, `pool/import-spreadsheet/route.ts`

Both call `importPartnerRows(service, auth.user.id, ...)` - the session uid is passed *as the agency
identity* into a shared helper that does the writes. Under M1 this parameter's meaning changes from
"the user" to "the organization", and the helper is the single choke point where that substitution
happens. **Good news: one function to change, not two routes.**

### RANK 8 - MEDIUM: `app/api/partner/partnerships/claim/route.ts`

Service role updates `partnerships SET partner_id = userId WHERE partner_id IS NULL AND <email
match>`. The claim is by email. Under M1, when a vendor *company* has several people, the second
colleague to sign up with a matching domain has no ghost row left to claim - the first one took it.
**A vendor-side claim collision that does not exist today and will exist the day M1 ships.**

### RANK 9 - MEDIUM: `app/api/brief/save/route.ts`

Notable pattern: falls back to verifying a bearer token via `serviceVerifier.auth.getUser(token)`
when the cookie session is missing - a workaround for the middleware constraint. The resulting
`userId` is written as `brief_interpretations.user_id`, which is genuinely per-user, so M1 does not
change it. Listed for completeness because the token-verification pattern may be the right general
answer to the middleware problem and is worth knowing exists.

### RANK 10 - LOW: `app/api/agency/email-connections/route.ts`, `email-scan/route.ts`, `auth/google-email/callback`, `auth/microsoft-email/callback`

All scope to `user_id = <session uid>` on a table that is legitimately per-user. The OAuth callbacks
take `state.userId` from the OAuth state parameter - **worth confirming the state is signed or
otherwise unforgeable**, since a forged state would attach an attacker's mailbox tokens to a victim's
account. Not read in detail this pass; flagged, not verified.

### RANK 11 - LOW: `app/api/auth/check-email/route.ts`

Service role, no session by design (pre-signup email existence check). Returns only `id` presence.
This is a **user-enumeration oracle** - anyone can determine whether an email has a Ligament account.
Standard tradeoff for a signup flow, unchanged by M1, noted for the record.

### RANK 12 - LOW: `app/api/contact/route.ts`

Service role insert into `contact_submissions` from the public marketing form. Correctly narrow.

### Summary of the security position

Service-role usage in this codebase is **broader than it should be**, and the reason is
architectural, not careless: `LIGAMENT_CONTEXT.md` constraint 1 documents that the middleware matcher
excludes `api/`, so server clients in API routes cannot read session cookies. Routes reach for the
service role to get *any* data access, then re-implement scoping by hand. The two admin routes
(ranks 1 and 2) are weak on their own merits and should be fixed regardless of M1. The remaining
twenty are correctly scoped **today only because `agency_id = auth.uid()` happens to be true**. M1
invalidates that premise in all twenty simultaneously.

---

## 5. Phase 0.4 - Where `auth.uid()` stands in for the company, in application code

**40 files** bind a session uid directly to a company-identity column. Census by pattern, across
`app/`, `lib/`, `components/`, `contexts/`:

| Pattern | Occurrences |
|---------|-------------|
| `.eq("agency_id", user.id)` | 90 |
| `.eq("agency_id", userId)` | 18 |
| `.eq("agency_id", auth.userId)` | 4 |
| `agency_id: user.id` (insert payload) | 17 |
| `agency_id: userId` (insert payload) | 5 |
| `agency_id: auth.userId` | 1 |
| **Direct total** | **135** |
| `.eq("agency_id", agencyId)` - indirect, where `agencyId` is a parameter | 44 |
| `agency_id: agencyId` - indirect | 13 |
| `.eq("partner_id", user.id)` - vendor side | 19 |
| `.eq("partner_id", partnerId)` - vendor side, indirect | 11 |

Complete file list, direct bindings (40 files):

```
app/agency/pool/[partnerId]/page.tsx
app/api/agency/active-engagements/route.ts
app/api/agency/bids/[responseId]/ai-score/route.ts
app/api/agency/bids/[responseId]/decompose/route.ts
app/api/agency/bids/[responseId]/evaluation/route.ts
app/api/agency/bids/compare/route.ts
app/api/agency/bids/rank/route.ts
app/api/agency/blob-download/route.ts
app/api/agency/broadcast-rfp/resend-invite/route.ts
app/api/agency/broadcast-rfp/route.ts
app/api/agency/client-cash-flow/route.ts
app/api/agency/clients/[id]/route.ts
app/api/agency/clients/route.ts
app/api/agency/delivery-reviews/route.ts
app/api/agency/library-documents/[id]/route.ts
app/api/agency/library-documents/file/route.ts
app/api/agency/library-documents/route.ts
app/api/agency/msa/ai-schedule/route.ts
app/api/agency/msa/milestones/route.ts
app/api/agency/msa/route.ts
app/api/agency/payment-synthesis/route.ts
app/api/agency/pool/[partnerId]/notes/route.ts
app/api/agency/pool/[partnerId]/performance/route.ts
app/api/agency/pool/[partnerId]/route.ts
app/api/agency/pool/client-history/route.ts
app/api/agency/projects/[projectId]/status-updates/route.ts
app/api/agency/projects/duplicate/route.ts
app/api/agency/rfp-responses/[id]/route.ts
app/api/agency/rfp-responses/route.ts
app/api/agency/rfp/magic-link/route.ts
app/api/agency/scoring/criteria/[id]/route.ts
app/api/agency/scoring/criteria/route.ts
app/api/agency/scoring/templates/route.ts
app/api/agency/utilization/route.ts
app/api/invitations/send/route.ts
app/api/partnerships/route.ts
app/api/projects/[id]/onboarding-packages/route.ts
app/api/projects/[id]/onboarding-partners/route.ts
app/api/projects/[id]/onboarding/deploy/route.ts
app/api/projects/route.ts
```

**The seven `lib/` choke points.** These take an `agencyId` parameter and never see a session, so
they change in one place regardless of how many routes call them. They are the highest-leverage
targets in the whole epic:

| File | Role |
|------|------|
| `lib/usage-tracking.ts` | All billing/limit logic. `agencyId` param, 3 `.eq` sites. |
| `lib/library-documents.ts` | Document CRUD. 4 `.eq` sites. |
| `lib/bid-analysis-context.ts` | 7 `.eq` sites - the densest. |
| `lib/rfp-evaluation-criteria-server.ts` | 3 sites. |
| `lib/award-partnership-resolution.ts` | 3 sites. |
| `lib/partnership-invitations.ts` | 2 sites. |
| `lib/magic-token-attach.ts` | 2 sites, but scoped from `tokenRow.agency_id` rather than a session - already indirection-safe. |

**Client-side is nearly clean, and that is load-bearing good news.** Only 14 `user.id` references
exist in all of `app/agency/**/*.tsx`, and only two of them scope a company query
(`app/agency/pool/page.tsx:646,652`). Everything else on the agency client either fetches through an
API route or relies on RLS with no explicit filter - for example `app/agency/magic-rfp/page.tsx:298`
selects from `projects` with no `agency_id` predicate at all, trusting the policy. **Those call sites
become organization-aware for free the moment the policy changes.** The remaining client-side
identity uses are legitimately per-person: profile settings (`.eq("id", user.id)`),
`partner_vouches.voucher_agency_id` (`app/agency/pool/[partnerId]/page.tsx:212,231,235` - company
identity, needs changing), and `brief_interpretations.user_id`.

One notable UI-level binding: `app/agency/page.tsx:243` does `setAgencyId(user.id)` - the RFP
broadcast wizard holds the company identity in React state, sourced from the session user. Under M1
this becomes "the org this user is acting for", which is also the natural place for a future org
switcher to live.

**`contexts/` - full sweep as instructed.** Four context files.
`contexts/paid-user-context.tsx` is the only one carrying company identity: it selects
`is_paid, is_admin, role, active_role, linked_agency_id, demo_access` from `profiles` and exposes
`linkedAgencyId`. `contexts/selected-project-context.tsx` holds no identity - it selects a project
from whatever the API returned, so it inherits org scope for free.
`contexts/lead-agency-filter-context.tsx:83` reads `p.agency?.id || p.agency_id` off already-fetched
rows. `contexts/usage-limit-modal-context.tsx` handles 402 responses and holds no identity.

---

## 6. Phase 0.5 and 0.6 - Vendor side and cross-cutting systems

### 6.1 The vendor side (0.5)

| Surface | Conflation status |
|---------|-------------------|
| `partnerships.partner_id` | **Conflated.** `partner_id = auth.uid()` in 5+ policies and 19 code sites. A vendor company is one user. |
| `partnerships.partner_email` / `profile_status` / `contact_name` / `company_name` (068) | **Already company-shaped, by accident.** A ghost partnership carries a company name and a contact name with no user at all. This is the closest thing to a vendor organization that already exists. |
| `project_assignments` | **Already relationship-scoped.** Keyed by `partnership_id`, never by a user id. Inherits for free. |
| `partner_rfp_inbox` | **Dual-conflated.** `partner_id = uid` *and* `recipient_email` matched against the caller's `profiles.email`. The email path means an invitation is addressed to a *person*, not a company. Under M1, should a colleague at the vendor see an RFP addressed to their coworker's inbox? Shared visibility says yes; the current predicate says no. |
| `partner_rfp_responses` | **Conflated** on `partner_id`, nullable since `057` for guest bids. |
| `rfp_magic_tokens` (magic link / Lightning) | **Company-blind on both ends.** Keyed by `(agency_id, project_id, vendor_email)`. The vendor side is an email string; the agency side is a uid. Guest paths carry no member identity at all. |
| `lib/magic-token-attach.ts` | Scopes from `tokenRow.agency_id`, not from a session. Structurally immune to the M1 change. |
| `partner_vouches` | **Conflated on both columns** (`voucher_agency_id`, `vouched_partner_id`). Also `UNIQUE(voucher_agency_id, vouched_partner_id)` - under M1 that must become one vouch per *organization pair*, or three colleagues can triple-vouch the same vendor and the "Triple-Vouched" badge becomes meaningless. **This is a product-integrity bug M1 creates if unaddressed.** |
| `partnership_profile_context` | Unknown shape, browser-client-reachable, vendor-side. |
| `partner_access_requests`, `invitation_requests`, `agency_partner_invitations` | All conflated on both sides. |

**The vendor side is the harder half and the brief scopes M1 to cover both.** Agency-side identity is
a uuid in a column; vendor-side identity is *sometimes* a uuid and *sometimes* an email string, with
a claim flow that converts one to the other. An organization model that handles only the uuid case
leaves every ghost/guest path unmodelled.

### 6.2 Cross-cutting systems (0.6)

| System | Per-company or per-member today | What it should be | Gap |
|--------|-------------------------------|-------------------|-----|
| **Usage tracking / 402** (`lib/usage-tracking.ts`, `usage_tracking` table, 8 gated routes) | Per **user**, called as `checkUsageLimit(user.id, ...)`. `UNIQUE(agency_id, month_start)`. | Per organization, almost certainly. | Change `agencyId` param to the org id. **One-line semantics change, 8 call sites, zero schema change** if the org id is what lands in the column. See Judgment Call 6. |
| **Plan tier** | `usage_tracking.plan_tier`. The file's own comment: *"There is no persisted plan-tier field anywhere yet - `usage_tracking.plan_tier` is it."* | Org-level. | Tier lives on a monthly usage row, which is a strange home for it. M1 does not have to fix this but should not entrench it. |
| **`profiles.is_paid`** (49 references) | Per **user** boolean. | Org-level entitlement. | A colleague invited under M1 gets whatever `handle_new_user` gives them (`is_paid = true`, per `056`), **not** the org's real entitlement. They would get paid access by accident. |
| **`contexts/paid-user-context.tsx`** | Reads the caller's own `profiles` row. | Should read org entitlement. | Straightforward once the org exists. |
| **Notifications / email recipients** | Every agency-facing email resolves the recipient as `profiles.email WHERE id = agency_id`. ~19 triggers in the `LIGAMENT_CONTEXT.md` map. | Undecided: the org owner, all members, or a per-member preference. | **Under M1, every notification silently goes to exactly one person - whoever's uid the org id happens to equal.** With option C in Judgment Call 1 that person is the founding user; with a fresh org id, `profiles.email WHERE id = <org uuid>` returns **nothing** and all agency-facing email silently stops. This is the most likely user-visible M1 regression and it will not throw. |
| **`profiles.notification_preferences`** (`scripts/017`) | Per user, jsonb. | Fine as-is - the per-member half of the answer already exists. | |
| **Role switching** (`app/api/profile/switch-role/route.ts`) | Reads/writes `profiles.role`, `secondary_role`, `active_role` for `user.id`. | Role-in-portal is per person; membership is per org. Orthogonal. | No conflation. **The one cross-cutting system M1 does not have to touch.** |
| **`handle_new_user` trigger** (`056`) | Unconditionally `role='agency', active_role='agency', secondary_role='partner', is_paid=true`. | An invited colleague must inherit the *inviter's* org and role. | Every colleague who signs up becomes their own lead agency with paid access. Judgment Call 4. |
| **`agency_partner_invitations`** (`scripts/003`) + `app/api/invitations/send/route.ts` | Vendor-facing. Writes `agency_id: user.id`. Duplicate check is `(agency_id, partner_email)`. | n/a | Judgment Call 4. |
| **`partnerships` invite flow** (`app/api/partnerships/route.ts`, `lib/partnership-invitations.ts`, `invitation_sent_at` from `063`) | Vendor-facing, the *actually used* path per the notification map. | n/a | Judgment Call 4. |
| **`rfp_magic_tokens`** | Third invitation-ish mechanism: tokenised guest access. | n/a | Judgment Call 4. |
| **`partner_access_requests` / `invitation_requests`** | Two more request tables, `scripts/008` and `scripts/009`, overlapping in purpose. Only `partner_access_requests` is queried by code (4 sites). | n/a | `invitation_requests` looks dead. Confirm before M1 adds a sixth mechanism to this pile. |

**Bonus security note, found while reading `056`.** The original `handle_new_user` in
`scripts/001_create_profiles.sql` declares `SECURITY DEFINER` **with** `SET search_path = public`.
The replacement in `056` declares `SECURITY DEFINER` **without** it. A `SECURITY DEFINER` function
with a mutable `search_path` is a standard privilege-escalation vector. `056` also changed
`ON CONFLICT (id) DO NOTHING` to `DO UPDATE SET email = EXCLUDED.email, ...`, which means the trigger
now overwrites an existing profile's email on re-fire. Neither is caused by M1; both sit in the exact
function M1 must modify, so fix them in the same migration.

---

## 7. The seven judgment calls

Greg rules. Each states a recommendation, the options, their costs, and what each forecloses.

### 7.1 THE MODEL - what does `agency_id` point at?

**Recommendation: Option C, with the trick made loud rather than quiet.**

| Option | Migration cost | Code diff | Forecloses |
|--------|---------------|-----------|-----------|
| **A. Repoint `agency_id` at an `organizations` row** | Large: create orgs, backfill one org per existing agency user, then `UPDATE` ~25 tables to swap uid for org id, in FK order, with FKs to `profiles(id)` dropped first and re-added to `organizations(id)`. Every `UPDATE` is a full table rewrite. | Small: the column name does not change, so most of the 135 bindings just need their *source* changed. | Nothing structurally. Highest risk of a partial backfill leaving orphans. |
| **B. Add `org_id` alongside `agency_id` everywhere** | Medium: ~25 `ADD COLUMN` + backfill, all additive and reversible. | Large: every read, write, policy and index must learn a second column, and there is a long window where two columns disagree. | Nothing, but it institutionalises ambiguity. Two sources of truth is exactly the failure mode `LIGAMENT_CONTEXT.md` P9 already records for `profiles.credentials`. |
| **C. `organizations` table whose `id` for every existing agency IS that user's uid** | **Smallest possible: one `CREATE TABLE`, one `INSERT ... SELECT id, company_name, ... FROM profiles WHERE role = 'agency'`. Zero `UPDATE`s to any referencing row. Every existing `agency_id` value is already valid.** | Small: `agency_id` keeps its name and its values; only the *policy* and the *resolution helper* change. | See the trap analysis below. |

**Is C a clean trick or a trap?** It is a trick that becomes a trap **only if it is left implicit**.
The trap is a future reader who sees `projects.agency_id = '9f3c...'` and `profiles.id = '9f3c...'`,
concludes the two are the same kind of thing, and writes `JOIN profiles ON profiles.id =
projects.agency_id` - which will *work* for every legacy org and silently return nothing for every
org created after M1. That is a latent bug with a delayed and confusing failure.

Four things defuse it, and C should only be chosen if all four ship with it:

1. **Rename the column.** `agency_id` → `organization_id` in the same migration, via `ALTER TABLE ...
   RENAME COLUMN`, which is a catalog-only operation with no table rewrite. A reader who sees
   `organization_id` does not assume it is a user. This is the single most important defusal and it
   is nearly free. It does mean touching all 135 code bindings, but as a mechanical rename that the
   TypeScript compiler verifies exhaustively - `npx tsc --noEmit` catches every miss.
2. **Add the FK.** `organization_id REFERENCES organizations(id)` on all ~25 tables, including the
   seven newest tables that have no FK today. After this, a uid that is not an org id fails at
   insert time rather than silently.
3. **New orgs get `gen_random_uuid()`, not a user's uid.** The coincidence must be historical only.
4. **A comment on the `organizations` table** stating in plain language that ids for organizations
   created before <date> equal the founding user's `auth.users.id` and that this is historical
   coincidence, never to be relied upon.

With those four, C's uid-equals-org-id property is a *migration* detail that no reader ever needs to
know. Without them, it is a trap. **C is recommended because option A's full-table `UPDATE` across 25
tables on live production data, with no staging environment evident in this repo and no verified
schema snapshot, is the higher risk of the two - and A needs defusals 1, 2 and 4 anyway.**

Foreclosure check against M2-M4: C forecloses nothing. `created_by uuid REFERENCES profiles(id)`
(M2), point-person columns (M3) and colleague filters (M4) are all additive and all reference
`profiles`, not `organizations`, so they are unaffected by which uuid an org carries.

### 7.2 MEMBERSHIP POLICY SHAPE - and the recursion problem

**Recommendation: a `SECURITY DEFINER` helper function. Do not put a subquery over `org_members`
inside a policy on `org_members`.**

The mechanics, stated precisely because this is where M1 most likely breaks in production:

Postgres applies RLS policies to any query issued by a non-superuser, **including queries inside
another policy's predicate**. So a policy on `org_members` reading `org_members` re-enters policy
evaluation and recurses until Postgres aborts with `42P17: infinite recursion detected in policy for
relation "org_members"`. It fails at query time, not at `CREATE POLICY` time, so it passes every
migration check and breaks the first time a real user loads a page.

Note that `scripts/009-comprehensive-auth-setup.sql` already contains a policy of exactly this shape:
`"Admins can view all profiles"` on `profiles`, predicate `EXISTS (SELECT 1 FROM profiles p2 WHERE
p2.id = auth.uid() AND p2.is_admin)`. Whether that policy is live and functioning is **UNCONFIRMED**
and directly informative - query A4. If it is live and the admin view works, something in the live
schema is preventing recursion (most likely a `SECURITY DEFINER` wrapper added out of band, or the
policy having been dropped). If it is live and admin views are silently broken, that is a bug nobody
has noticed. Either answer tells us something real before M1 writes a line.

Three ways out:

| Approach | How it avoids recursion | Cost | Recommendation |
|----------|------------------------|------|----------------|
| **A. `SECURITY DEFINER` function** `current_user_org_ids()` returning `setof uuid`, marked `STABLE`, with `SET search_path = public, pg_temp`. Policies call it: `USING (organization_id IN (SELECT current_user_org_ids()))`. | The function body runs as its owner, for whom RLS is not enforced, so it reads `org_members` without re-entering policy evaluation. | One function. Must be written carefully - a `SECURITY DEFINER` function without a pinned `search_path` is a privilege-escalation vector, which this codebase has already regressed on once (see §6.2). `STABLE` lets Postgres cache it per statement rather than per row. | **Recommended.** Standard Supabase pattern, one definition, every policy in the epic reduces to a one-line predicate. |
| **B. Self-row-only policy on `org_members`** - `USING (user_id = auth.uid())` - so the member table's own policy never subqueries itself; other tables' policies then subquery `org_members` freely, which is a *different* relation and does not recurse. | The recursion only ever arises from `org_members` referencing itself. | Free. | **Ship this too, alongside A.** It is not an alternative - it is the correct policy for `org_members` regardless, and it means a member can see their own membership but not the roster. Roster reads then go through the helper or a view. |
| **C. Denormalised claim in the JWT** (org ids in `app_metadata`) | The policy reads `auth.jwt()` and never touches a table. | Fastest at query time. But the claim is stale until the user's token refreshes, so a revoked member keeps access for up to the token lifetime, and adding a member requires a token refresh to take effect. Requires an auth hook. | **Not for M1.** A security boundary that lags reality by an hour is the wrong tradeoff for a first cut. Revisit if the helper shows up in query plans. |

**Concretely, ship A + B:**
- `org_members` gets exactly one policy: `USING (user_id = auth.uid())`. No subquery. Cannot recurse.
- `organizations` gets `USING (id IN (SELECT current_user_org_ids()))`.
- Every one of the ~25 owned tables gets `USING (organization_id IN (SELECT current_user_org_ids()))`.
- Write policies get the same predicate in `WITH CHECK` - and note that **five existing policies have
  `USING` with no `WITH CHECK`** (§3.2), so M1 is the moment to close those.

Performance note: `current_user_org_ids()` marked `STABLE` is evaluated once per statement, not per
row. An index on `org_members(user_id, organization_id)` and the existing
`idx_projects_agency_id` (migration `046`) carry the rest.

### 7.3 ROLES WITHIN A COMPANY

**Recommendation: ship the `role` column, ship exactly one distinction (`owner` vs `member`), and
enforce it in application code only, not in RLS.**

| Option | Cost now | Cost later |
|--------|----------|-----------|
| **Flat membership, no column** | Zero. | Adding a column later is `ADD COLUMN role text NOT NULL DEFAULT 'member'` plus a backfill that must *guess* who the owner is. With one member per org today the guess is trivial; with three colleagues who joined in an unknown order, it is not. **The cost is not the column, it is the lost information.** |
| **`role` column, single distinction, app-enforced** | One column, one `CHECK`, one backfill (`'owner'` for the founding member - knowable today, unknowable later). | `owner`/`admin`/`member` later is a `CHECK` widening, which is free. |
| **Full owner/admin/member with RLS enforcement in M1** | Every policy grows a role clause; every write path needs a permission matrix; the surface for getting a policy subtly wrong triples. | - |

The smallest honest version: `org_members(organization_id, user_id, role, invited_by, joined_at,
UNIQUE(organization_id, user_id))` with `role CHECK (role IN ('owner','member'))`. RLS asks only
"are you a member". The application asks "are you the owner" for the three or four actions that
warrant it - remove a member, delete the org, change billing. **`role` is cheap to add and expensive
to backfill; membership visibility is the opposite. Take the cheap insurance.**

Foreclosure: none. M3's point-person designations are per-project rows, orthogonal to org role.

### 7.4 INVITING A COLLEAGUE

**Recommendation: build a new, separate `org_invitations` table. Do not reuse either vendor
mechanism.**

There are at minimum **five** invitation-ish mechanisms today, not two:

1. `agency_partner_invitations` (`scripts/003`) + `app/api/invitations/send/route.ts` - agency
   invites vendor by email.
2. `partnerships` + `invitation_sent_at` (`063`) + `lib/partnership-invitations.ts` - the path the
   notification map actually documents.
3. `rfp_magic_tokens` - tokenised guest access to one RFP.
4. `partner_access_requests` (`scripts/008`) - vendor requests access to an agency.
5. `invitation_requests` (`scripts/009`) - overlaps (4); no code queries it. Probably dead.

All five answer "an outside company should be able to reach my workspace at arm's length". A
colleague invitation answers something categorically different: **"this person becomes me, for
authorization purposes."** A vendor invitation that leaks creates an unwanted relationship; a
colleague invitation that leaks hands over the entire workspace. They deserve different token
lifetimes, different single-use semantics, different revocation, and different UI.

Reuse `partnerships` and you get a `partner_id` column that means "colleague", a `status` enum with
vendor-shaped values, and RLS written for a cross-company relationship guarding an intra-company one.

**What to reuse instead - build-nothing-first applies at the layer below the table:**

| Reuse | Path |
|-------|------|
| Email sending, branding, base URL | `lib/email.ts` - `buildBrandedEmailHtml()`, `buildBrandedEmailText()`, `sendTransactionalEmail()`, `siteBaseUrl()` |
| Invite-token-in-URL, expiry, claim-after-signup | The `partner_rfp_inbox` `invite_token` / `invite_token_expires_at` / `claimed_at` design from `044`, and `app/api/partner/rfps/claim/route.ts` as the claim-route shape |
| Query-param preservation through auth | `middleware.ts` already preserves `invite`, `email`, `nda`, `scope`, `agency`, `next`; `app/auth/callback/route.ts` preserves them through OAuth |
| Duplicate-invite handling | `app/api/invitations/send/route.ts`'s existing-invite check, and `063`'s Invited-vs-Discovered distinction |
| Pre-signup email existence check | `app/api/auth/check-email/route.ts` |

**The `056` collision is real and is the hard part.** The trigger fires on `auth.users` insert and
unconditionally writes `role='agency', active_role='agency', secondary_role='partner',
is_paid=true` - it cannot see an invite token, because the token lives in the application's URL, not
in the auth event. Three ways out:

- **(a)** Pass the invite token through `raw_user_meta_data` at signup so the trigger can read
  `NEW.raw_user_meta_data->>'org_invite_token'`, look up the invitation, and insert the membership.
  Correct-by-construction but puts a table lookup and a branch inside a `SECURITY DEFINER` trigger -
  the same function that already lost its `search_path` pin.
- **(b)** Leave the trigger alone; have the claim route fix up the profile immediately after signup.
  Simpler, but there is a window where the new colleague is their own paid lead agency. With
  `is_paid=true` as the default, that window is a free-access hole, however brief.
- **(c)** Make the trigger's defaults conditional on the *absence* of an invite and have the claim
  route own the invited case.

**Recommend (a)**, and fix the missing `SET search_path = public, pg_temp` in the same migration
since the function is being rewritten anyway.

### 7.5 VISIBILITY DEFAULT

**Recommendation: everything, no per-row scoping in M1.**

Shared visibility is the stated M1 goal and the schema already agrees with it: RLS is uniformly
`agency_id = auth.uid()` with no per-row owner concept anywhere on the agency side. A narrower
default would require inventing per-row assignment *and* the UI to manage it, which is M3.

What would make someone want narrower: a large agency where junior staff should not see every
client's budget or every vendor's rates. `clients.notes` is explicitly internal ("NEVER reaches a
vendor" per `077`), and `client_cash_flow` is financial. Those are real. But they are **M3's
point-person work**, not M1's - the honest M1 statement is *"joining an organization means seeing
what the organization sees"*, and the honest caveat to Greg is that this is not appropriate for an
agency above roughly 15 people. It is exactly right for 2-5, which is the stated shape of the
customer.

Foreclosure: none, **provided the policy predicate is a function call rather than an inlined
subquery**. `organization_id IN (SELECT current_user_org_ids())` becomes
`... AND (SELECT can_see_row(...))` by editing one policy per table. An inlined predicate means
editing ~25 hand-written subqueries.

### 7.6 BILLING AND USAGE UNIT

**Recommendation: the organization, not the seat - and it needs no schema change under Option C.**

The pricing page (`app/pricing/page.tsx`, and the tiers table in `LIGAMENT_CONTEXT.md`) already
advertises **"Seats: Unlimited"** on all three tiers. That is a public pricing commitment and it
answers the question: the unit is the organization. Per-seat pricing would contradict the live
marketing page.

`usage_tracking` is `UNIQUE(agency_id, month_start)`, and under Option C the org id *is* the value
already in `agency_id`, so **the table needs no migration at all** - only the eight call sites change
from `checkUsageLimit(user.id, ...)` to `checkUsageLimit(orgId, ...)`. Per-seat would mean a new
unique key, a backfill, and a new aggregation for the dashboard.

Two consequences to state plainly:

1. The existing race is amplified. `lib/usage-tracking.ts` documents that its check-then-increment is
   not atomic and "the true count can overshoot the limit by the number of concurrent requests in
   flight". With one user that is a double-click. With five colleagues it is five people running AI
   analyses simultaneously. **The accepted-for-now decision was made under single-user assumptions
   and should be re-taken.** The fix the file itself names - `UPDATE ... WHERE count < limit
   RETURNING` - is small and could ride along with M1.
2. `profiles.is_paid` stays per-user while entitlement becomes per-org. Either move entitlement to
   `organizations` (recommended, one column) or make `is_paid` derived. Leaving 49 reference sites
   pointing at a per-user boolean under an org billing model is how a colleague gets free paid access
   - see the `056` default of `is_paid = true`.

### 7.7 MIGRATION SAFETY

**Recommendation: a sequence of three migrations, never one - and Option C is what makes a
zero-downtime sequence possible at all.**

The window to avoid: `DROP POLICY` and `CREATE POLICY` are transactional in Postgres, so *within one
transaction* there is no visible gap. The real risk is not a gap between two statements - it is
**shipping a policy that is wrong and leaving live data unreadable until someone notices**. Under
Option C the new predicate is a strict superset of the old one for every existing row (the founding
user is a member of the org whose id equals their uid), which means the switch is genuinely safe. The
sequence exists to prove that superset property with data before relying on it.

**Migration 078 - additive only. Nothing existing changes.**
```
CREATE TABLE organizations (...);
CREATE TABLE org_members (...);
CREATE TABLE org_invitations (...);
INSERT INTO organizations (id, name, ...) SELECT id, company_name, ... FROM profiles WHERE role = 'agency' OR secondary_role = 'agency';
INSERT INTO org_members (organization_id, user_id, role) SELECT id, id, 'owner' FROM organizations;
CREATE FUNCTION current_user_org_ids() ... SECURITY DEFINER STABLE SET search_path = public, pg_temp;
-- RLS on the three new tables only. No existing policy touched.
```
Verify before proceeding (these are gates, not observations):
- `SELECT count(*) FROM organizations;` must equal the agency-profile count.
- `SELECT count(*) FROM org_members;` must equal the same number.
- `SELECT count(*) FROM projects p WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p.agency_id);` **must be 0.** This is the whole bet. Run it for every table in §2.1. A non-zero result on any table means Option C's premise is false for that table and the epic stops there.
- `SELECT current_user_org_ids();` as the real test user must return exactly one row equal to their uid.

**Migration 079 - swap the policies, one transaction, per table.**
Because the reconstruction in §3 is UNCONFIRMED, **079 must be authored from the output of query A0,
not from this document.** Use `DROP POLICY IF EXISTS` on the exact live names, then create the
replacements with `organization_id IN (SELECT current_user_org_ids())`.
Verify after each table: as the real test user, `SELECT count(*)` must be **identical** to the
pre-migration count. Write those counts down first. Any decrease is a lockout; any increase is a
leak. Both are stop-and-roll-back.

**Migration 080 - rename and constrain. Only after 079 has been live and quiet.**
`ALTER TABLE ... RENAME COLUMN agency_id TO organization_id` (catalog-only, no rewrite) plus
`ADD CONSTRAINT ... FOREIGN KEY (organization_id) REFERENCES organizations(id)` on the seven tables
that have no FK. Both are breaking for deployed code, so 080 and its matching code deploy are a
coordinated release - and this is exactly why it is separate from 079, which is not.

**Could it be one migration?** Technically yes; every statement is transactional. It should not be,
because the verification gate between 078 and 079 is the only place the Option C premise gets tested
against real rows, and because 080 breaks running code while 079 does not. Different rollback
profiles belong in different migrations.

---

## 8. Proposed M1 scope boundary

Written so a line can be moved rather than the whole thing accepted or rejected.

### Ships in M1

| # | Item | Why here |
|---|------|----------|
| 1 | `organizations`, `org_members`, `org_invitations` tables | The epic |
| 2 | Backfill: one org per existing agency profile, founding user as `owner` | Meaningless without it |
| 3 | `current_user_org_ids()` SECURITY DEFINER STABLE helper | The recursion answer (7.2) |
| 4 | Policy swap on all ~25 agency-side tables | The point of M1 |
| 5 | `org_members.role` column, `owner`/`member`, app-enforced only | Cheap now, expensive to backfill later (7.3) |
| 6 | Colleague invitation: send, accept, claim-after-signup | The user-facing feature |
| 7 | `handle_new_user` fix: invited signups inherit org and do **not** self-provision as a paid lead agency | `056` collision (7.4) |
| 8 | `SET search_path` restored on `handle_new_user` | Security regression in the function being edited anyway (§6.2) |
| 9 | Usage/402 unit moves to the org; entitlement moves off per-user `is_paid` | Otherwise every colleague is a free paid seat (7.6) |
| 10 | Agency-facing email recipient resolution stops being `profiles.email WHERE id = agency_id` | **Otherwise agency email silently stops or goes to one person** (§6.2) |
| 11 | `partner_vouches` unique constraint becomes org-pair, not user-pair | Otherwise Triple-Vouched is trivially gamed by colleagues (§6.1) |
| 12 | The 22 service-role routes re-scoped to resolve org membership explicitly | They are correct today only by coincidence (§4) |
| 13 | Vendor-side membership, same three tables, `partnerships.partner_id` → org | The brief scopes M1 to both sides |
| 14 | Schema snapshot committed **before** any of the above | Finding Zero |

### Waits for M2-M4

| Item | Phase | Why it can wait |
|------|-------|-----------------|
| `created_by` / `updated_by` on every table | M2 | Additive; nothing in M1 forecloses it |
| Activity actor / audit log | M2 | Needs M2's columns |
| Point-person on projects, engagements, vendor relationships | M3 | Needs stable membership first |
| Pool filter by colleague point person | M4 | Needs M3 |
| Per-row visibility narrowing | M3 | 7.5 |
| Owner/admin/member three-tier with RLS enforcement | post-M1 | `CHECK` widening is free later |
| Org switcher UI for a user in multiple orgs | post-M1 | The data model supports it from day one; the UI need not |
| Consolidating the five invitation mechanisms | separate | Cleanup, not M1 |

### Lines Greg is most likely to want to move

- **Item 13 (vendor side).** The single biggest lever. Agency-side-only is maybe 60% of the work and
  ships shared visibility for the paying customer. The cost is that `partnerships.partner_id` stays
  a uid while `projects.organization_id` is an org id - two identity models in one schema, which is
  precisely the confusion Option C's defusals exist to prevent. If moved out, say so loudly in the
  column comments.
- **Item 12 (service-role re-scoping).** Cannot be moved out. These routes bypass RLS, so the policy
  swap does not protect them. Leaving them is a correctness *and* security hole.
- **Item 5 (`role` column).** Movable, but the backfill information is lost the day the second
  colleague joins.
- **Item 10 (email recipients).** Cannot be moved out. It is a silent failure, not a degraded one.

---

## 9. Reuse versus build - build-nothing-first

### Reuse as-is, no changes

| Need | Existing |
|------|----------|
| Invitation email send + branding | `lib/email.ts` - `sendTransactionalEmail`, `buildBrandedEmailHtml`, `buildBrandedEmailText`, `siteBaseUrl` |
| Invite param preservation through auth | `middleware.ts` `publicPaths` + param list; `app/auth/callback/route.ts` |
| Data fetching for any new member-list UI | `components/swr-provider.tsx`, the `useFetch` pattern |
| Pre-signup email check | `app/api/auth/check-email/route.ts` |
| 402 modal plumbing | `contexts/usage-limit-modal-context.tsx` |
| Agency modal styling | `bg-card border border-border rounded-xl` (CLAUDE.md) |
| Date display | `formatDate` / `formatDateTime` in `lib/utils.ts` |
| Dedup in any member list | The IIFE `useMemo` pattern (CLAUDE.md) |
| Avatar with logo fallback | `components/agency-layout.tsx` / `partner-layout.tsx` |

### Reuse the *shape*, write new code

| Need | Model it on |
|------|-------------|
| Membership-lookup RLS predicate | `projects_partner_select_assigned` (CONFIRMED), `bid_evaluation_scores` (`065`), `delivery_reviews` partner policy (`066`) |
| Invite token lifecycle | `044`'s `invite_token` / `expires_at` / `claimed_at` on `partner_rfp_inbox` |
| Claim-after-signup route | `app/api/partner/rfps/claim/route.ts`, `app/api/partner/partnerships/claim/route.ts` |
| Service-role route that scopes correctly | `app/api/agency/rfp/magic-link/route.ts` - the best example in the repo |
| Migration with a verification block | `077_client_profiles.sql`'s trailing verification comments |
| Idempotent policy creation | `077`'s `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_policies ...)` guard |

### Must be built

`organizations`, `org_members`, `org_invitations`; `current_user_org_ids()`; the org-resolution
helper that the 22 service-role routes call; the ~25 replacement policies; the `handle_new_user`
rewrite; the member-list and invite UI; the email-recipient resolution change.

### Do not build

A second invitation mechanism for vendors (three already exist). An org-switcher UI (data model
supports it; ship it when someone has two orgs). A permissions matrix (7.3). A per-row visibility
system (M3).

---

## 10. What I could not determine without Greg

**Blocked on catalog access - every one has a query in the appendix:**

1. Whether `rfp_magic_tokens` has RLS enabled, and whether it has any policy. Opposite security postures, and the table gates every Lightning RFP. (A3)
2. The true, live policy set for all ~40 tables. The §3 reconstruction is known wrong for `projects` and may be wrong elsewhere. (A0)
3. Whether `partnership_profile_context` and `payment_milestones` are RLS-protected. Both are queried by code; neither has DDL on disk. (A3)
4. Whether `"Admins can view all profiles"` - a self-referential `profiles` policy - is live and functioning. Directly informative about the recursion question. (A4)
5. Row counts for every identity table. Determines whether migrations are seconds or minutes. (A1)
6. `partnerships.partner_id` nullability, and whether `profiles.linked_agency_id` exists, and what type. (A5, A6)
7. Whether `"Partners read projects with their payment milestones"` (`scripts/030`) is still on `projects`. The CONFIRMED list has five policies and does not include it. (A2)
8. Which of 062, 063, 071, 072, 075, 076 are actually applied. Headers and `LIGAMENT_CONTEXT.md` disagree with each other and with the CONFIRMED evidence that 077 is live. (A7)

**Blocked on Greg's product judgment - not answerable from code:**

9. Whether one person can belong to more than one organization. A `UNIQUE(user_id)` on `org_members` versus `UNIQUE(organization_id, user_id)` is the whole difference and it is a one-word decision now, a migration later. **Recommend the composite key**, since dual-role users already exist and an agency principal who also vendors is plausible.
10. Who receives agency-facing notification email under M1 - the owner, all members, or per-member preferences.
11. Whether a colleague at a vendor company should see RFPs addressed to a coworker's email (§6.1, `partner_rfp_inbox.recipient_email`).
12. What happens to an organization when its last member deletes their profile. `profiles_delete_own` allows it and it cascades.
13. Whether "unlimited seats" is a permanent commitment or a launch position (7.6).
14. Whether `invitation_requests` is dead and can be dropped.
15. Whether a staging environment exists. Nothing in the repo indicates one, and the 079 policy swap really wants a rehearsal.

**Explicitly not investigated, per the brief:** the onboarding page redesign; anything requiring
database credentials; M2-M4 implementation detail beyond confirming the model does not foreclose them.

---

## APPENDIX: QUERIES FOR GREG

Read-only. Run in the Supabase SQL Editor. Ordered most decision-critical first.

---

### A0. The whole policy inventory - settles §3 entirely

*Decides: what migration 079 must actually `DROP`. Without this, every policy-replacing statement in
M1 risks silently no-opping. This is the one query that must be run before any other work.*

```sql
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Save the output to `docs/schema-snapshot-<date>.md` and commit it.

---

### A3. RLS posture, including tables with RLS on and zero policies

*Decides: whether `rfp_magic_tokens`, `partnership_profile_context`, `payment_milestones`,
`msa_agreements` and `notifications` are protected, exposed, or locked out. Three different bugs, and
they are indistinguishable from inside the repo. Ranked second only because A0 is broader.*

```sql
SELECT c.relname          AS table_name,
       c.relrowsecurity   AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       count(p.polname)   AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relrowsecurity ASC, policy_count ASC, c.relname;
```

Read the top of the result first: `rls_enabled = false` is exposed; `rls_enabled = true` with
`policy_count = 0` is locked out.

---

### A1. Every company-identity column, its type, nullability, FK target, and row count

*Decides: the blast-radius table in §2, whether the migrations are seconds or minutes, and which of
the seven no-FK tables need constraints.*

```sql
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
       tc.constraint_name AS fk_name,
       ccu.table_name || '.' || ccu.column_name AS fk_target
FROM information_schema.columns c
LEFT JOIN information_schema.key_column_usage kcu
       ON kcu.table_schema = c.table_schema
      AND kcu.table_name   = c.table_name
      AND kcu.column_name  = c.column_name
LEFT JOIN information_schema.table_constraints tc
       ON tc.constraint_name = kcu.constraint_name
      AND tc.constraint_type = 'FOREIGN KEY'
LEFT JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
WHERE c.table_schema = 'public'
  AND c.column_name IN ('agency_id','partner_id','user_id','voucher_agency_id',
                        'vouched_partner_id','linked_agency_id','domain_match_profile_id',
                        'uploaded_by','sender_id','signed_by','msa_confirmed_by')
ORDER BY c.table_name, c.column_name;
```

Then, for row counts:

```sql
SELECT relname AS table_name, n_live_tup AS approx_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
```

---

### A5. Option C's premise, tested against real data

*Decides: whether Option C works at all. If any of these returns a non-zero count, some `agency_id`
value is not a real user id and the "org id equals uid" backfill would leave orphans. This is
migration 078's gate.*

```sql
SELECT 'projects' AS t, count(*) AS orphans FROM projects p
  WHERE p.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = p.agency_id)
UNION ALL SELECT 'partnerships', count(*) FROM partnerships x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'clients', count(*) FROM clients x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_scoring_criteria', count(*) FROM bid_scoring_criteria x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_evaluations', count(*) FROM bid_evaluations x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_decompositions', count(*) FROM bid_decompositions x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_comparisons', count(*) FROM bid_comparisons x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'delivery_reviews', count(*) FROM delivery_reviews x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'usage_tracking', count(*) FROM usage_tracking x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'agency_library_documents', count(*) FROM agency_library_documents x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'rfp_magic_tokens', count(*) FROM rfp_magic_tokens x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'partner_rfp_inbox', count(*) FROM partner_rfp_inbox x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'partner_rfp_responses', count(*) FROM partner_rfp_responses x
  WHERE NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
ORDER BY orphans DESC;
```

**Every row must read 0.** Extend the list to every table in §2.1 once A1 confirms the full set.

---

### A4. The self-referential `profiles` policy - live evidence on the recursion question

*Decides: whether Postgres in this instance is already tolerating a policy that subqueries its own
table, which directly informs Judgment Call 2. Also reveals how many duplicate `profiles` policies
accumulated across `001`, `009`, `016`, `030`, `032` and the `.SKIP` file.*

```sql
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd, policyname;
```

Then, to see whether it functions rather than merely exists, run as an admin user:
`SELECT count(*) FROM profiles;` - a `42P17` error or a lower-than-expected count is the answer.

---

### A2. Does `projects` still carry the payment-milestones partner policy?

*Decides: whether the CONFIRMED five-policy list for `projects` is complete or filtered. Answered
incidentally by A0; kept separate because it is a specific known discrepancy worth eyeballing.*

```sql
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'projects'
ORDER BY policyname;
```

Expect exactly five. A sixth named "Partners read projects with their payment milestones" means
`scripts/030` is live and the CONFIRMED list was filtered.

---

### A6. Does `profiles.linked_agency_id` exist, and is anything in it?

*Decides: whether M1 inherits a half-built org concept or a vestige to drop. It is read by
`contexts/paid-user-context.tsx` and, per grep, never written.*

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('linked_agency_id','is_paid','role','active_role','secondary_role','is_admin');

SELECT count(*) AS total,
       count(linked_agency_id) AS with_linked_agency
FROM profiles;
```

---

### A7. Which migrations are actually applied?

*Decides: which of 062, 063, 071, 072, 075, 076 are live. Their file headers, `LIGAMENT_CONTEXT.md`
and the CONFIRMED evidence about 077 all disagree. Presence of the column is the only honest test.*

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND (
     (table_name = 'email_connections')                                              -- 062
  OR (table_name = 'partnerships'          AND column_name = 'invitation_sent_at')   -- 063
  OR (table_name = 'partnerships'          AND column_name IN ('contact_name','company_name','phone','website')) -- 068
  OR (table_name = 'partner_rfp_responses' AND column_name IN ('shortlisted_at','declined_at','meeting_requested_at')) -- 069
  OR (table_name = 'partner_rfp_responses' AND column_name = 'terms_disclosure')     -- 070
  OR (table_name = 'rfp_magic_tokens'      AND column_name = 'response_deadline')    -- 074
  OR (table_name = 'clients')                                                        -- 077
  OR (table_name = 'projects'              AND column_name = 'client_id')            -- 077
  OR (table_name = 'agency_library_documents' AND column_name = 'client_id')         -- 077
)
ORDER BY table_name, column_name;
```

For 071, 072, 075 and 076, add their specific columns once their files are re-read - they were not
enumerated this pass because none carries an identity column and none affects M1's model.

---

### A8. The `handle_new_user` trigger as it actually exists

*Decides: whether `056` is live, whether `SET search_path` is really missing, and what migration 078
is editing. Judgment Call 4 depends on the current body, not on the file.*

```sql
SELECT p.proname,
       p.prosecdef       AS security_definer,
       p.proconfig       AS config_settings,   -- null here means no search_path pin
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
```

`config_settings` of `null` with `security_definer = true` confirms the regression in §6.2.

---

### A9. Are there already multi-user companies hiding in the data?

*Decides: whether M1 has a migration problem it does not know about - two profiles sharing a company
name today would each become their own organization under the backfill, which is probably not what
either of them wants.*

```sql
SELECT lower(trim(company_name)) AS company,
       count(*)                  AS profile_count,
       array_agg(email ORDER BY created_at) AS emails
FROM profiles
WHERE company_name IS NOT NULL AND trim(company_name) <> ''
GROUP BY 1
HAVING count(*) > 1
ORDER BY profile_count DESC;
```

Any row here is a company that already has multiple users and does not know it. Whether to merge
those into one organization during the backfill, or leave them separate and let them merge
themselves, is a decision this query forces.
