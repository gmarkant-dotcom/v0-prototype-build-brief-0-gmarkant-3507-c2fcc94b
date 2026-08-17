# Schema truth

**What is authoritative, what is reconstructible, and what a future migration author
must do about the difference.**

Companion to `docs/schema-baseline-2026-08-13.sql`. Read both before authoring migration
079 or anything after it.

---

## The one-paragraph version

The live database holds **104 row level security policies across 38 tables**. The
repository can reproduce **61** of them by name. **28** exist live under a name the repo
has never used, but with a recognisable ancestor on disk. **15 exist in production and
nowhere in this repository at all, under any name.** Five tables carry live policies with
no `CREATE TABLE` anywhere in the repo. Two tables that the repo believes it created do
not exist live. The migration sequence is split across two directories with two naming
conventions and a gap of four numbers between them. **078 is the signup role trigger fix,
authored and not yet applied; 079 is reserved for the Organizations M1 migration** (see
section 2 - an earlier revision of this document reserved 078 for M1 and was superseded on
2026-08-17).

---

## 1. What is authoritative

| Artifact | Status | Use it for |
|---|---|---|
| `docs/schema-snapshot-2026-08-13.md` | **AUTHORITATIVE.** A `pg_policies` dump taken directly from the live database. | Every question about what a policy is |
| `docs/schema-baseline-2026-08-13.sql` | Derived from the snapshot, mechanically. Reference artifact, **not a migration**. | Reading the live policy set as SQL, and seeing what is missing from disk |
| `supabase/migrations/*.sql` + `scripts/*.sql` | **NOT authoritative.** Cannot reproduce the live database. | History, intent, and nothing else |
| `LIGAMENT_CONTEXT.md` migration table | **NOT authoritative.** Disagrees with the files and with production in both directions. | Narrative context |

The snapshot wins every disagreement. Where this document records a disagreement, that is
itself a finding, listed in section 6.

### Why `schema-baseline-2026-08-13.sql` is not in `supabase/migrations/`

A file placed in `supabase/migrations/` will eventually be run by someone working the
sequence in order. Running the baseline against the live database would attempt to create
104 policies that already exist: every statement fails with `42710 duplicate_object`, and
if someone prefixes each with `DROP POLICY IF EXISTS` to "fix" that, the run briefly drops
and recreates every access rule in the system. It is a reference artifact. It lives in
`docs/`. Its own header says so twice.

---

## 2. Migration numbering: 078 is the signup role trigger, 079 is Organizations M1

**Superseded reservation, corrected 2026-08-17.** An earlier revision of this section
reserved **078** for the Organizations M1 migration and that is no longer true. The M1
pre-work run claimed 078 for the signup role trigger fix:

| Number | File | Status |
|---|---|---|
| **078** | `supabase/migrations/078_signup_role_trigger.sql` | **AUTHORED, NOT APPLIED.** Rewrites `handle_new_user()` to record the role chosen at signup and to `SET search_path = public, pg_temp`. |
| **079** | not yet authored | **RESERVED for Organizations M1.** |

Anything that still says "078 is reserved for Organizations M1" - including
`docs/schema-truth-and-m1-prep-report.md` and `docs/organizations-m1-discovery.md`, both
dated before this change - is reading the old reservation. This table wins.

`docs/proposed-migration-role-trigger.sql` was the deliberately unnumbered draft of 078.
It has been deleted now that the numbered file exists, so there is one copy of that SQL
and not two. Its content lives on in `supabase/migrations/078_signup_role_trigger.sql`
and its history is in git.

Current state of the sequence:

- `supabase/migrations/` holds **037 files, numbered 040 to 078**.
- Gaps inside that range: **048** and **073**.
  - **048** is claimed applied in `LIGAMENT_CONTEXT.md` (it added `profiles.company_logo_url`)
    and has no file. The column exists live. The change was applied in the SQL Editor and
    never committed.
  - **073** does not exist and is not referenced anywhere. It is a skipped number, not a
    lost file.
- **039** is documented as "PENDING, not yet applied", with no file, while migration 047
  and 056 both did the dual-role work 039 was supposed to do. It is dead.
- `scripts/` holds **034 numbered files, numbered 001 to 038**, gaps at **002, 004, 005, 006**.
- Four files in `supabase/migrations/` still carry a "NOT APPLIED" or "NOT YET APPLIED"
  header while being live or partly live: **074, 075, 076, 077**. `LIGAMENT_CONTEXT.md`
  already corrects 074. The headers were never updated.

### The ordering problem, stated plainly

The real sequence is `scripts/001` ... `scripts/038`, then `supabase/migrations/040` ...
`supabase/migrations/077`. Nothing in the repository says this. A tool or a person that
globs `supabase/migrations/*.sql` and runs it in order will:

1. Start at 040, which assumes `profiles`, `partnerships`, `projects`,
   `project_assignments`, `partner_rfp_inbox` and eleven other tables already exist.
2. Fail immediately, because `scripts/` was never run.

The two directories also disagree about naming. `scripts/` uses `NNN-description.sql`
(hyphen) for 32 of its 34 files and `NNN_description.sql` (underscore) for two,
`001_create_profiles.sql` and `003_agency_partner_invitations.sql`. `supabase/migrations/`
uses underscore for all 36. One file, `scripts/029-msa-payments.SKIP`, has no `.sql`
extension at all and is nonetheless **partly live** (see section 6).

**What a future migration author must do:**

1. **Never infer a policy or a column from a file.** Read
   `docs/schema-snapshot-2026-08-13.md` for policies. For columns, query
   `information_schema.columns` against the live database. There is no reliable on-disk
   answer for either.
2. **Never write `DROP POLICY`, `DROP POLICY IF EXISTS`, or `CREATE OR REPLACE` against a
   policy name taken from a file.** 43 of the 104 live names do not appear on disk. A drop
   aimed at an on-disk name silently matches nothing, the migration reports success, and
   the policy it meant to replace is still live alongside the new one. This is the specific
   failure mode that produced the three overlapping `payment_milestones` partner SELECT
   policies now in production.
3. **Number new work from 079 upward** in `supabase/migrations/`, underscore convention
   (078 is taken - see section 2).
   Do not backfill 039, 048 or 073. Renumbering history is a bigger decision than any one
   migration; see section 7 for the recommendation.
4. **Do not run the baseline SQL.** It is a reference artifact.
5. **After applying anything that touches policies, re-take the snapshot** and replace
   `docs/schema-snapshot-2026-08-13.md` with a newly dated file. The snapshot is only
   authoritative while it is current. Split the export by key range or include a row count:
   Supabase truncated the original at 100 rows silently, in both the clipboard and the CSV
   download, which is how this whole problem stayed invisible.

---

## 3. The headline counts

| | Count | Meaning |
|---|---|---|
| Live policies | **104** | Across 38 tables. Every table has RLS on and at least one policy. None is exposed, none is locked out |
| Reproducible from disk by name | **61** | A `CREATE POLICY` of the same name on the same table exists in the repo |
| Live under a new name, ancestor on disk | **28** | The rule survives; the name in production is not the name in the repo |
| **Exist only in production** | **15** | No policy of this name, and no recognisable ancestor, anywhere in the repo |
| On-disk policies that are **not** live | **32** | Superseded, renamed away, or never applied |

Two honest ways to say the same thing: **43 of 104 live policy names appear nowhere on
disk**, and of those, **15 have no on-disk ancestor under any name either**.

Where a name *does* match, the predicate matches too. All 104 live predicates were
normalized and compared against their on-disk statements; the 19 apparent differences were
every one of them cosmetic (`public.` schema prefixes that `pg_policies` strips, column
qualification Postgres adds, `ILIKE` rendered as `~~*`, SQL comments inside the predicate
body). **There is no semantic drift between a live policy and its same-named file.** The
problem is absence, not divergence.

---

## 4. The 15 policies that exist only in production

These are the ones a rebuild-from-source would silently lose. Each is a real access rule
protecting real data.

| Table | Live policy | Cmd |
|---|---|---|
| `brief_interpretations` | Users can manage their own interpretations | ALL |
| `msa_agreements` | Partners can view their MSAs | SELECT |
| `notifications` | Users can view own notifications | SELECT |
| `notifications` | Users can update own notifications | UPDATE |
| `partner_status_updates` | Partners can update their own status updates | UPDATE |
| `partnership_profile_context` | Users can insert their own context | INSERT |
| `partnership_profile_context` | Users can read their own context | SELECT |
| `partnership_profile_context` | Users can update their own context | UPDATE |
| `payment_milestones` | Partners can view their payment milestones | SELECT |
| `payment_milestones` | Partners read their payment milestones | SELECT |
| `profiles` | Users can view profiles of partnership members | SELECT |
| `project_documents` | Uploaders can delete their documents | DELETE |
| `project_documents` | Uploaders can update their documents | UPDATE |
| `project_messages` | Senders can update their messages | UPDATE |
| `rfp_magic_tokens` | Agency can manage their own tokens | ALL |

Worth naming three of them specifically:

- **`profiles` / "Users can view profiles of partnership members"** is the policy that lets
  either side of a partnership read the other's profile row. It is the single most
  load-bearing SELECT policy in the product, and it is in no file.
- **`rfp_magic_tokens` / "Agency can manage their own tokens"** is the *only* policy on
  that table, and the table has no `CREATE TABLE` on disk either. The entire Lightning RFP
  and guest-bid flow rests on an object the repository has no record of.
- **`payment_milestones`** carries **three** partner SELECT policies live
  (`Partners can view their payment milestones`, `Partners read their payment milestones`,
  and `Partners read payment milestones for their partnerships`). Only the third is on
  disk. The other two are near-identical duplicates applied out of band. Because RLS
  policies of the same command OR together, they are harmless today, but they are three
  places to edit when the partner predicate has to change for Organizations, and a `DROP`
  aimed at the on-disk name removes exactly one of the three.

---

## 4a. The full reconciliation table

Every live policy, in table order, against its on-disk equivalent. Generated from
`docs/schema-baseline-2026-08-13.sql` so the two cannot drift apart.

| Table | Live policy | Cmd | On-disk equivalent |
|---|---|---|---|
| `agency_library_documents` | Agency manages own library documents | ALL | `scripts/024-onboarding-documents.sql:67` |
| `agency_partner_invitations` | Agencies can create invitations | INSERT | `scripts/003_agency_partner_invitations.sql:34` |
| `agency_partner_invitations` | Agencies can view their sent invitations | SELECT | `scripts/003_agency_partner_invitations.sql:27` |
| `agency_partner_invitations` | Partners can view their received invitations | SELECT | renamed - `scripts/003_agency_partner_invitations.sql:48` as "Partners can view invitations to them" |
| `agency_partner_invitations` | Agencies can update their invitations | UPDATE | `scripts/003_agency_partner_invitations.sql:41` |
| `agency_partner_invitations` | Partners can update received invitations | UPDATE | renamed - `scripts/003_agency_partner_invitations.sql:58` as "Partners can update invitations to them" |
| `assignment_agreements` | Agencies manage agreements for their project assignments | ALL | `scripts/012-onboarding-nda-sow.sql:58` |
| `assignment_agreements` | Partners read and update own assignment agreements | SELECT | `scripts/012-onboarding-nda-sow.sql:75` |
| `assignment_agreements` | Partners update agreement signature fields | UPDATE | `scripts/012-onboarding-nda-sow.sql:85` |
| `bid_comparisons` | Agencies manage own bid comparisons | ALL | `supabase/migrations/064_bid_analysis_schema.sql:49` |
| `bid_decompositions` | Agencies manage own bid decompositions | ALL | `supabase/migrations/064_bid_analysis_schema.sql:40` |
| `bid_evaluation_scores` | Agencies manage own bid evaluation scores | ALL | `supabase/migrations/065_bid_scoring_schema.sql:101` |
| `bid_evaluations` | Agencies manage own bid evaluations | ALL | `supabase/migrations/065_bid_scoring_schema.sql:92` |
| `bid_scoring_criteria` | Agencies manage own scoring criteria | ALL | `supabase/migrations/065_bid_scoring_schema.sql:74` |
| `bid_scoring_templates` | Agencies manage own scoring templates | ALL | `supabase/migrations/065_bid_scoring_schema.sql:83` |
| `brief_interpretations` | Users can manage their own interpretations | ALL | **NONE - exists only in production** |
| `client_cash_flow` | Agencies manage own client cash flow | ALL | `scripts/037-client-cash-flow.sql:21` |
| `clients` | Agencies manage own clients | ALL | `supabase/migrations/077_client_profiles.sql:73` |
| `contact_submissions` | Anyone can insert contact submissions | INSERT | `scripts/026-security-fixes.sql:9` |
| `contact_submissions` | Admins can read contact submissions | SELECT | `scripts/026-security-fixes.sql:16` |
| `delivery_review_scores` | Agencies manage own delivery review scores | ALL | `supabase/migrations/066_delivery_review_schema.sql:86` |
| `delivery_reviews` | Agencies manage own delivery reviews | ALL | `supabase/migrations/066_delivery_review_schema.sql:64` |
| `delivery_reviews` | Partners view own complete delivery reviews | SELECT | `supabase/migrations/066_delivery_review_schema.sql:71` |
| `email_connections` | Users manage their own email connections | ALL | `supabase/migrations/062_email_connections.sql:35` |
| `invitation_requests` | Partners can create requests | INSERT | `scripts/009-comprehensive-auth-setup.sql:114` |
| `invitation_requests` | Agencies can view requests to their email | SELECT | renamed - `scripts/009-comprehensive-auth-setup.sql:120` as "Agencies can view requests sent to their email" |
| `invitation_requests` | Partners can view own requests | SELECT | renamed - `scripts/009-comprehensive-auth-setup.sql:108` as "Partners can view their own requests" |
| `invitation_requests` | Agencies can update requests to their email | UPDATE | renamed - `scripts/009-comprehensive-auth-setup.sql:130` as "Agencies can update requests sent to them" |
| `msa_agreements` | Agency can manage their MSAs | ALL | renamed - scripts/029-msa- payments.SKIP:33 as "Agencies manage own MSA agreements" (file is marked .SKIP, i.e. never to be run) |
| `msa_agreements` | Partners can view their MSAs | SELECT | **NONE - exists only in production** |
| `notifications` | Scoped insert notifications | INSERT | `scripts/026-security-fixes.sql:45` |
| `notifications` | Users can view own notifications | SELECT | **NONE - exists only in production** |
| `notifications` | Users can update own notifications | UPDATE | **NONE - exists only in production** |
| `onboarding_deployments` | Agencies manage onboarding deployments for own projects | ALL | `scripts/012-onboarding-nda-sow.sql:37` |
| `onboarding_deployments` | Partners read onboarding deployments for their assignments | SELECT | `scripts/012-onboarding-nda-sow.sql:47` |
| `onboarding_package_documents` | Agency full access package document rows | ALL | `scripts/024-onboarding-documents.sql:105` |
| `onboarding_package_documents` | Partner reads documents for their packages | SELECT | `scripts/024-onboarding-documents.sql:124` |
| `onboarding_packages` | Agency full access onboarding packages for own projects | ALL | `scripts/024-onboarding-documents.sql:74` |
| `onboarding_packages` | Partner reads onboarding packages for their partnership | SELECT | `scripts/024-onboarding-documents.sql:86` |
| `onboarding_packages` | Partner updates review fields on own packages | UPDATE | `scripts/024-onboarding-documents.sql:94` |
| `partner_access_requests` | Partners can create requests | INSERT | `scripts/008-partner-access-requests.sql:32` |
| `partner_access_requests` | Agencies can view requests to them | SELECT | `scripts/008-partner-access-requests.sql:39` |
| `partner_access_requests` | Partners can view their requests | SELECT | `scripts/008-partner-access-requests.sql:25` |
| `partner_access_requests` | Agencies can update requests to them | UPDATE | `scripts/008-partner-access-requests.sql:46` |
| `partner_rfp_inbox` | Agencies insert partner RFP inbox rows | INSERT | `scripts/013-partner-rfp-inbox.sql:35` |
| `partner_rfp_inbox` | Agencies select own partner RFP inbox rows | SELECT | `scripts/013-partner-rfp-inbox.sql:40` |
| `partner_rfp_inbox` | Partners select inbox rows by partner_id | SELECT | `scripts/013-partner-rfp-inbox.sql:45` |
| `partner_rfp_inbox` | Partners select inbox rows by recipient email | SELECT | `scripts/013-partner-rfp-inbox.sql:50` |
| `partner_rfp_inbox` | Partners update own inbox rows | UPDATE | `scripts/013-partner-rfp-inbox.sql:62` |
| `partner_rfp_response_versions` | Partners insert own response versions | INSERT | `scripts/021-bid-response-versions.sql:24, scripts/023-version-history-rls-fix.sql:12` |
| `partner_rfp_response_versions` | Agencies read owned response versions | SELECT | `scripts/021-bid-response-versions.sql:38, scripts/023-version-history-rls-fix.sql:19` |
| `partner_rfp_response_versions` | Partners read own response versions | SELECT | `scripts/021-bid-response-versions.sql:31, scripts/023-version-history-rls-fix.sql:5` |
| `partner_rfp_responses` | Partners insert RFP responses for their inbox | INSERT | `scripts/014-partner-rfp-responses.sql:37` |
| `partner_rfp_responses` | Agencies select RFP responses they own | SELECT | `scripts/014-partner-rfp-responses.sql:65` |
| `partner_rfp_responses` | Partners read response status and feedback | SELECT | `scripts/018-bid-status-and-feedback.sql:34` |
| `partner_rfp_responses` | Partners select own RFP responses | SELECT | `scripts/014-partner-rfp-responses.sql:32` |
| `partner_rfp_responses` | Agencies update response status and feedback | UPDATE | `scripts/018-bid-status-and-feedback.sql:25` |
| `partner_rfp_responses` | Partners update own RFP responses | UPDATE | `scripts/014-partner-rfp-responses.sql:60` |
| `partner_status_updates` | Partners can insert their own status updates | INSERT | renamed - scripts/028-partner- status-updates.sql:29 as "Partners insert status updates for own assignment" |
| `partner_status_updates` | Agencies can view status updates for their projects | SELECT | renamed - scripts/028-partner- status-updates.sql:41 as "Agency read status updates for own projects" |
| `partner_status_updates` | Partners can view their own status updates | SELECT | renamed - scripts/028-partner- status-updates.sql:23 as "Partners read own status updates" |
| `partner_status_updates` | Agencies can resolve status updates | UPDATE | renamed - scripts/028-partner- status-updates.sql:47 as "Agency update resolve flag on status updates" |
| `partner_status_updates` | Partners can update their own status updates | UPDATE | **NONE - exists only in production** |
| `partner_vouches` | Agencies can remove their vouch | DELETE | `supabase/migrations/053_create_partner_vouches.sql:19` |
| `partner_vouches` | Agencies can vouch | INSERT | `supabase/migrations/053_create_partner_vouches.sql:16` |
| `partner_vouches` | Anyone can count vouches | SELECT | `supabase/migrations/053_create_partner_vouches.sql:13` |
| `partnership_profile_context` | Users can insert their own context | INSERT | **NONE - exists only in production** |
| `partnership_profile_context` | Users can read their own context | SELECT | **NONE - exists only in production** |
| `partnership_profile_context` | Users can update their own context | UPDATE | **NONE - exists only in production** |
| `partnerships` | Agencies can create partnerships | INSERT | renamed - scripts/010-closed- ecosystem-schema.sql:180 as "Agencies can create partnerships (invite)" |
| `partnerships` | Agencies can view their partnerships | SELECT | `scripts/010-closed-ecosystem-schema.sql:172` |
| `partnerships` | Partners can view their partnerships | SELECT | `scripts/010-closed-ecosystem-schema.sql:176` |
| `partnerships` | Agencies can update their partnerships | UPDATE | `scripts/010-closed-ecosystem-schema.sql:184` |
| `partnerships` | Partners can claim partnership by email | UPDATE | `supabase/migrations/045_partnerships_claim_by_email_policy.sql:1` |
| `partnerships` | Partners can update partnership status | UPDATE | renamed - scripts/010-closed- ecosystem-schema.sql:188 as "Partners can accept partnerships" |
| `payment_milestones` | Agency can manage payment milestones | ALL | renamed - scripts/029-msa- payments.SKIP:63 as "Agencies manage own payment milestones" (file is marked .SKIP) |
| `payment_milestones` | Partners can view their payment milestones | SELECT | **NONE - exists only in production** |
| `payment_milestones` | Partners read payment milestones for their partnerships | SELECT | `scripts/030-partner-payments-rls.sql:9` |
| `payment_milestones` | Partners read their payment milestones | SELECT | **NONE - exists only in production** |
| `profiles` | Enable insert for authenticated users only | INSERT | renamed - `scripts/001_create_profiles.sql:22` as "profiles_insert_own" |
| `profiles` | Agencies read profiles of their partners | SELECT | `scripts/029-msa-payments.SKIP:6` |
| `profiles` | Authenticated users can read discoverable profiles | SELECT | `scripts/016-marketplace-discoverability.sql:8` |
| `profiles` | Partners read lead agency profiles for their partnerships | SELECT | `scripts/030-partner-payments-rls.sql:20` |
| `profiles` | Users can view profiles of partnership members | SELECT | **NONE - exists only in production** |
| `profiles` | Users can update own profile | UPDATE | `scripts/009-comprehensive-auth-setup.sql:147` |
| `project_assignments` | assignments_agency_all | ALL | renamed - scripts/010-closed- ecosystem-schema.sql:208 as "Agencies can manage assignments for their projects" |
| `project_assignments` | assignments_partner_select | SELECT | renamed - scripts/010-closed- ecosystem-schema.sql:214 as "Partners can view their assignments" |
| `project_assignments` | assignments_partner_update | UPDATE | renamed - scripts/010-closed- ecosystem-schema.sql:220 as "Partners can update their assignments (submit bids)" |
| `project_documents` | Uploaders can delete their documents | DELETE | **NONE - exists only in production** |
| `project_documents` | Users can upload documents | INSERT | renamed - scripts/010-closed- ecosystem-schema.sql:238 on the differently-named table shared_documents ("Users can upload documents to their assignments"); shared_documents does not exist live |
| `project_documents` | Agencies can view documents for their projects | SELECT | renamed - scripts/010-closed- ecosystem-schema.sql:227 on the differently-named table shared_documents ("Users can view documents in their assignments"); shared_documents does not exist live |
| `project_documents` | Partners can view documents for their assignments | SELECT | renamed - scripts/010-closed- ecosystem-schema.sql:227 on the differently-named table shared_documents; shared_documents does not exist live |
| `project_documents` | Uploaders can update their documents | UPDATE | **NONE - exists only in production** |
| `project_messages` | Users can send messages | INSERT | renamed - scripts/010-closed- ecosystem-schema.sql:261 on the differently-named table assignment_messages ("Users can send messages in their assignments"); assignment_messages does not exist live |
| `project_messages` | Agencies can view messages for their projects | SELECT | renamed - scripts/010-closed- ecosystem-schema.sql:251 on the differently-named table assignment_messages; assignment_messages does not exist live |
| `project_messages` | Partners can view messages for their assignments | SELECT | renamed - scripts/010-closed- ecosystem-schema.sql:251 on the differently-named table assignment_messages; assignment_messages does not exist live |
| `project_messages` | Senders can update their messages | UPDATE | **NONE - exists only in production** |
| `projects` | projects_agency_delete | DELETE | renamed - scripts/010-closed- ecosystem-schema.sql:193 as "Agencies can manage their projects" (one FOR ALL policy; live has it split into four) |
| `projects` | projects_agency_insert | INSERT | renamed - scripts/010-closed- ecosystem-schema.sql:193 as "Agencies can manage their projects" (one FOR ALL policy; live has it split into four) |
| `projects` | projects_agency_select | SELECT | renamed - scripts/010-closed- ecosystem-schema.sql:193 as "Agencies can manage their projects" (one FOR ALL policy; live has it split into four) |
| `projects` | projects_partner_select_assigned | SELECT | renamed - scripts/010-closed- ecosystem-schema.sql:197 as "Partners can view assigned projects" |
| `projects` | projects_agency_update | UPDATE | renamed - scripts/010-closed- ecosystem-schema.sql:193 as "Agencies can manage their projects" (one FOR ALL policy; live has it split into four) |
| `rfp_magic_tokens` | Agency can manage their own tokens | ALL | **NONE - exists only in production** |
| `usage_tracking` | Agencies manage own usage tracking | ALL | `supabase/migrations/067_usage_tracking.sql:21` |


---

## 5. Tables with no DDL anywhere in the repo

Five tables have live policies and **no `CREATE TABLE` statement in `supabase/migrations/`
or `scripts/`**:

| Table | Live policies | Note |
|---|---|---|
| `notifications` | 3 | `scripts/026-security-fixes.sql` *replaces* its INSERT policy, so the repo knows the table exists but never created it |
| `partnership_profile_context` | 3 | No DDL, no policies on disk. Wholly out of band |
| `project_documents` | 5 | The repo instead creates `shared_documents` (`scripts/010:227`), a table that **does not exist live**. Renamed out of band |
| `project_messages` | 4 | The repo instead creates `assignment_messages` (`scripts/010:251`), also **not live**. Renamed out of band |
| `rfp_magic_tokens` | 1 | No DDL, no policy. The magic-link flow's core table |

`LIGAMENT_CONTEXT.md` lists `msa_agreements` and `payment_milestones` in this category.
**That is wrong and this document corrects it.** Both have `CREATE TABLE` statements, in
`scripts/029-msa-payments.SKIP` at lines 17 and 40. The confusion is understandable: the
file is named `.SKIP`, meaning do not run it, and it is partly live anyway. See below.

Beyond these five, the repo has no record of **columns** for any table. Nothing in this
run reconstructs column-level truth, and `information_schema.columns` against the live
database is the only honest source for it.

---

## 6. Where the snapshot and the repo disagree

The snapshot wins each of these. Each disagreement is a finding.

1. **`scripts/029-msa-payments.SKIP` is partly live.** The filename says never run this.
   Three of its policies were run: `profiles` / "Agencies read profiles of their partners"
   is live verbatim, and `msa_agreements` / "Agencies manage own MSA agreements" and
   `payment_milestones` / "Agencies manage own payment milestones" are live under renamed
   forms ("Agency can manage their MSAs", "Agency can manage payment milestones"). Both of
   its `CREATE TABLE` statements are live. Do not trust the `.SKIP` extension as evidence
   of anything.
2. **`shared_documents` and `assignment_messages` do not exist.** `scripts/010` creates
   both with policies. Live has `project_documents` and `project_messages` instead, with
   more policies each. The rename happened out of band and no file records it.
3. **`LIGAMENT_CONTEXT.md` is wrong about `msa_agreements` and `payment_milestones`**
   having no DDL, as above.
4. **`profiles` has no DELETE policy live.** `scripts/001` creates `profiles_delete_own`.
   None of the four `profiles_*_own` names from 001 is live. A profile row cannot be
   deleted by its owner today.
5. **`profiles` has no admin UPDATE policy live.** Already recorded in
   `LIGAMENT_CONTEXT.md`; confirmed here. `scripts/009` creates "Admins can update all
   profiles" and "Admins can view all profiles". Neither is live. This is why the admin
   panel must write through a service-role route.
6. **`projects` was split.** `scripts/010` has one `FOR ALL` policy, "Agencies can manage
   their projects". Live has four separate ones, `projects_agency_select` / `_insert` /
   `_update` / `_delete`, plus `projects_partner_select_assigned`. The five live names
   appear in no file. `scripts/030:33` adds a sixth, "Partners read projects with their
   payment milestones", which is **not** live - answering appendix query A2 from
   `docs/organizations-m1-discovery.md` in the negative.
7. **`project_assignments` was renamed wholesale.** Three live snake_case names
   (`assignments_agency_all`, `assignments_partner_select`, `assignments_partner_update`),
   three different sentence-case names on disk.
8. **Four migration files still claim "NOT APPLIED"** while live: 074, 075, 076, 077.
9. **The `rfps` table does not exist** in the public schema, despite appearing in the
   migration log (054 adds `interpretation_id` to it) and in code comments.

---

## 7. Recommendation on the historical files

**Do not rewrite, renumber, or reorganise `scripts/` and `supabase/migrations/` now.** That
is a larger decision than this run, and doing it badly is worse than leaving it. The
recommendation, for whenever it is scheduled:

**Do not attempt to make the migration history replayable.** It cannot be made replayable
honestly - too much was applied out of band, and reconstructing intent for 15 orphan
policies and five undocumented tables means guessing. A "corrected" history that looks
authoritative but is partly invented is more dangerous than an obviously broken one,
because the next person will trust it.

Instead, **draw a line**:

1. Add `scripts/README.md` and `supabase/migrations/README.md` saying, in two sentences,
   that these directories are history rather than a replayable sequence, that the real
   order is `scripts/001-038` then `supabase/migrations/040+`, and that
   `docs/schema-snapshot-*.md` is the only authoritative record.
2. Keep every existing file exactly as it is, including `029-msa-payments.SKIP`.
3. Treat the dated snapshot plus this document as the baseline. Everything from **078**
   onward is a real, ordered, replayable migration applied on top of that baseline. 078
   itself is authored but not yet applied.
4. Re-take and re-commit the snapshot after every policy-touching migration.

If a from-scratch rebuild is ever genuinely needed, the honest path is `pg_dump --schema-only`
against production, committed as a new dated baseline - not a repaired file history.

---

## 8. What this document does not cover

- **Columns, types, nullability, defaults, indexes, constraints, triggers, functions and
  grants.** None of it is captured. `handle_new_user()` in particular is reconstructed only
  from migration 056's text and has never been verified against the live trigger; appendix
  query A8 in `docs/organizations-m1-discovery.md` settles it.
- **Storage bucket policies.** The `avatars` bucket has RLS policies in `storage.objects`.
  The snapshot covers `schemaname = 'public'` only.
- **Whether the 104 policies are correct.** This run reconciles what exists against what is
  recorded. It does not audit whether the rules are right.
