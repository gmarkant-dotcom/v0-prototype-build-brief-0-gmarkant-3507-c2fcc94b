# Policy rewrite surface for migration 079

**All 104 live row level security policies, classified by how much work the Organizations
migration has to do to each one.**

Written 2026-08-17, M1 pre-work. Document only. No policy was changed in this run.

Source: `docs/schema-snapshot-2026-08-13.md`, which is the authoritative `pg_policies` dump.
Nothing here was read from a migration file, and nothing here was inferred from PostgREST or
from OpenAPI. `docs/schema-truth.md` records why that distinction is not pedantry: the
on-disk migration history cannot reproduce the live database, and 43 of the 104 live policy
names do not appear on disk under any spelling.

**Method note.** The snapshot's CSV block contains 108 rows, not 104. Supabase truncated the
original export at 100 rows silently, so the file was assembled from two exports split at
`tablename = 'projects'`, and the seam repeats the CSV header line plus the three `projects`
policies that fall on both sides of it. Deduplicating by `(tablename, policyname)` yields
exactly 104, which agrees with the count `docs/schema-truth.md` states independently. That
agreement is the check that the parse is right.

---

## Buckets

| Bucket | Definition | Count | Tables | What 079 does |
|---|---|---:|---:|---|
| **(a)** | Keyed directly on `agency_id` or `partner_id` equalling `auth.uid()`, on the policy's own table | **49** | 22 | Rewrite the predicate to a membership lookup |
| **(b)** | Relationship-scoped: reaches `auth.uid()` through a subquery against `partnerships`, `projects`, `project_assignments` or a similar parent | **34** | 16 | Only the join column changes |
| **(c)** | User-scoped on `user_id = auth.uid()` (or `sender_id` / `uploaded_by` / `profiles.id`) | **15** | 8 | Unchanged by the org model |
| **(d)** | Identity-independent: public, anon, or a bare `true` | **3** | 3 | Unchanged |
| **(U)** | **Bucket could not be determined with certainty** | **3** | 2 | Needs a ruling before it can be rewritten |
| | **Total** | **104** | **39** | |

Table counts sum to more than 39 because several tables carry policies in more than one
bucket. 39 rather than 38 is the `tablename` header artefact of the split export counted as
a table name by the raw parse; the real table count is **38**, as
`docs/schema-snapshot-2026-08-13.md` states.

### On bucket (d)

The brief defines (d) as "public or anon, unchanged". Two of the three are literally that.
The third, `profiles / Authenticated users can read discoverable profiles`, is granted to
`{authenticated}` rather than `{anon}` but carries no identity term at all - its whole
predicate is `is_discoverable = true`. It belongs in (d) by the property the bucket exists to
capture, which is that 079 does no work on it. The label is "identity-independent", not
"anon".

---

## The three policies whose bucket is undetermined

These are flagged rather than guessed. All three key on **an email address matched against
the caller's own profile email**, which is neither an id comparison nor a relationship join,
and which the organization model has no obvious translation for. An organization does not
have one email address.

| Table | Policy | Cmd | Predicate | The question 079 must answer |
|---|---|---|---|---|
| `invitation_requests` | Agencies can view requests to their email | SELECT | `agency_email = (SELECT profiles.email FROM profiles WHERE profiles.id = auth.uid())` | A vendor requests access by typing a lead agency's email address. Once that agency is an organization with several members, whose mailbox counts? Any member's? A designated one? |
| `invitation_requests` | Agencies can update requests to their email | UPDATE | same predicate | Same question, and this one grants write |
| `partner_rfp_inbox` | Partners select inbox rows by recipient email | SELECT | `recipient_email IS NOT NULL AND EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = auth.uid() AND lower(trim(pr.email)) = lower(trim(recipient_email)))` | The ghost/unclaimed vendor path: an RFP addressed to an email, read by whoever owns that mailbox. May a colleague at the vendor read a row addressed to another member? That is a product ruling, not a mechanical rewrite |

Three further policies carry an **email disjunct beside** an id predicate and are classified
by the id half, with the email half noted in the per-policy table:
`agency_partner_invitations` (both partner policies) and `partner_rfp_inbox / Partners update
own inbox rows`. They will inherit whatever ruling the three above receive.

---

## The 15 policies that exist only in production

All 15 were located in the classification and are marked **Prod-only** in the per-policy
table below. This is the list `docs/schema-truth.md` section 4 records, reproduced here
against its bucket, because **a migration authored from the repository would silently fail to
drop any of them**: `DROP POLICY IF EXISTS` aimed at a name that is not on disk matches
nothing, reports success, and leaves the live policy in place beside whatever 079 creates.

| Bucket | Table | Policy | Cmd |
|---|---|---|---|
| (a) | `rfp_magic_tokens` | Agency can manage their own tokens | ALL |
| (b) | `msa_agreements` | Partners can view their MSAs | SELECT |
| (b) | `partner_status_updates` | Partners can update their own status updates | UPDATE |
| (b) | `payment_milestones` | Partners can view their payment milestones | SELECT |
| (b) | `payment_milestones` | Partners read their payment milestones | SELECT |
| (b) | `profiles` | Users can view profiles of partnership members | SELECT |
| (c) | `brief_interpretations` | Users can manage their own interpretations | ALL |
| (c) | `notifications` | Users can view own notifications | SELECT |
| (c) | `notifications` | Users can update own notifications | UPDATE |
| (c) | `partnership_profile_context` | Users can insert their own context | INSERT |
| (c) | `partnership_profile_context` | Users can read their own context | SELECT |
| (c) | `partnership_profile_context` | Users can update their own context | UPDATE |
| (c) | `project_documents` | Uploaders can delete their documents | DELETE |
| (c) | `project_documents` | Uploaders can update their documents | UPDATE |
| (c) | `project_messages` | Senders can update their messages | UPDATE |

**Distribution: 9 in (c), 5 in (b), 1 in (a).** That is better news than it looks. Nine of
the fifteen are user-scoped and unchanged by the org model, so 079 does not need to touch
them at all and cannot break them by failing to drop them. The five in (b) and the one in (a)
are the dangerous ones, and `profiles / Users can view profiles of partnership members` is
the most dangerous single policy in the set: `docs/schema-truth.md` calls it the most
load-bearing SELECT policy in the product, and it is in no file.

**Working rule for 079:** every `DROP POLICY` statement it contains must be copied from
`docs/schema-snapshot-2026-08-13.md`, never from a migration file, and the snapshot must be
re-taken and re-committed immediately afterwards.

---

## Two policies that need attention independent of 079

Found while classifying. Neither is an organizations problem; both are live now.

**`project_documents / Users can upload documents` (INSERT) has no project scoping.**

```
INSERT, {authenticated}, with_check: (uploaded_by = auth.uid())
```

The only condition is that the row names the caller as its uploader. Nothing ties
`project_id` to a project the caller has any relationship with. Any authenticated user can
insert a document row against any project id in the system.

**`project_messages / Users can send messages` (INSERT) has the same shape.**

```
INSERT, {authenticated}, with_check: (sender_id = auth.uid())
```

Any authenticated user can insert a message into any project.

Both are mitigated in practice by the application never offering the action outside a project
the caller can see, and both SELECT sides are correctly scoped, so nobody can read back what
they inserted unless they belong there. That mitigation is the interface, not the permission,
which is the distinction `docs/capabilities.md` section 0 is about. Worth fixing on its own
schedule, and worth not bundling into 079.

A third, `partner_vouches / Anyone can count vouches` (SELECT, `{public}`, `qual: true`),
is written up in `docs/milestone-attribution-map.md` section 4.

---

## Per-policy classification

`Prod-only` marks a policy with no on-disk ancestor under any name. Predicates are the live
text from the snapshot, truncated at 190 characters where a subquery runs long; the snapshot
is authoritative for the full text.


#### Bucket (a)

| Table | Policy | Cmd | Roles | Live predicate | Prod-only | Note |
|---|---|---|---|---|---|---|
| `agency_library_documents` | Agency manages own library documents | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `agency_partner_invitations` | Agencies can create invitations | INSERT | {public} | `CHECK: (agency_id = auth.uid())` |  |  |
| `agency_partner_invitations` | Agencies can update their invitations | UPDATE | {public} | `USING: (agency_id = auth.uid())` |  |  |
| `agency_partner_invitations` | Agencies can view their sent invitations | SELECT | {public} | `USING: (agency_id = auth.uid())` |  |  |
| `agency_partner_invitations` | Partners can update received invitations | UPDATE | {public} | `USING: ((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email FROM profiles WHERE (profiles.id = auth.uid()))))` |  | mixed: outer agency_id/partner_id predicate plus a relationship subquery |
| `agency_partner_invitations` | Partners can view their received invitations | SELECT | {public} | `USING: ((partner_id = auth.uid()) OR (partner_email = ( SELECT profiles.email FROM profiles WHERE (profiles.id = auth.uid()))))` |  | mixed: outer agency_id/partner_id predicate plus a relationship subquery |
| `bid_comparisons` | Agencies manage own bid comparisons | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `bid_decompositions` | Agencies manage own bid decompositions | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `bid_evaluations` | Agencies manage own bid evaluations | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `bid_scoring_criteria` | Agencies manage own scoring criteria | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `bid_scoring_templates` | Agencies manage own scoring templates | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `client_cash_flow` | Agencies manage own client cash flow | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `clients` | Agencies manage own clients | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `delivery_reviews` | Agencies manage own delivery reviews | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `invitation_requests` | Partners can create requests | INSERT | {authenticated} | `CHECK: (partner_id = auth.uid())` |  |  |
| `invitation_requests` | Partners can view own requests | SELECT | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `msa_agreements` | Agency can manage their MSAs | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `onboarding_packages` | Agency full access onboarding packages for own projects | ALL | {authenticated} | `USING: (project_id IN ( SELECT projects.id FROM projects WHERE (projects.agency_id = auth.uid()))) / CHECK: ((project_id IN ( SELECT projects.id FROM projects WHERE (projects.agency_id = ...` |  | mixed: outer agency_id/partner_id predicate plus a relationship subquery |
| `partner_access_requests` | Agencies can update requests to them | UPDATE | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `partner_access_requests` | Agencies can view requests to them | SELECT | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `partner_access_requests` | Partners can create requests | INSERT | {authenticated} | `CHECK: (partner_id = auth.uid())` |  |  |
| `partner_access_requests` | Partners can view their requests | SELECT | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `partner_rfp_inbox` | Agencies insert partner RFP inbox rows | INSERT | {authenticated} | `CHECK: (agency_id = auth.uid())` |  |  |
| `partner_rfp_inbox` | Agencies select own partner RFP inbox rows | SELECT | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `partner_rfp_inbox` | Partners select inbox rows by partner_id | SELECT | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `partner_rfp_inbox` | Partners update own inbox rows | UPDATE | {authenticated} | `USING: ((partner_id = auth.uid()) OR ((recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1 FROM profiles pr WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(B...` |  | mixed: outer agency_id/partner_id predicate plus a relationship subquery |
| `partner_rfp_response_versions` | Agencies read owned response versions | SELECT | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `partner_rfp_response_versions` | Partners insert own response versions | INSERT | {authenticated} | `CHECK: (partner_id = auth.uid())` |  |  |
| `partner_rfp_response_versions` | Partners read own response versions | SELECT | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `partner_rfp_responses` | Agencies select RFP responses they own | SELECT | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `partner_rfp_responses` | Agencies update response status and feedback | UPDATE | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `partner_rfp_responses` | Partners insert RFP responses for their inbox | INSERT | {authenticated} | `CHECK: ((partner_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM partner_rfp_inbox i WHERE ((i.id = partner_rfp_responses.inbox_item_id) AND (i.agency_id = partner_rfp_responses.agency_id) A...` |  | mixed: outer agency_id/partner_id predicate plus a relationship subquery |
| `partner_rfp_responses` | Partners read response status and feedback | SELECT | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `partner_rfp_responses` | Partners select own RFP responses | SELECT | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `partner_rfp_responses` | Partners update own RFP responses | UPDATE | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `partner_vouches` | Agencies can remove their vouch | DELETE | {public} | `USING: (auth.uid() = voucher_agency_id)` |  |  |
| `partner_vouches` | Agencies can vouch | INSERT | {public} | `CHECK: (auth.uid() = voucher_agency_id)` |  |  |
| `partnerships` | Agencies can create partnerships | INSERT | {authenticated} | `CHECK: (agency_id = auth.uid())` |  |  |
| `partnerships` | Agencies can update their partnerships | UPDATE | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `partnerships` | Agencies can view their partnerships | SELECT | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `partnerships` | Partners can claim partnership by email | UPDATE | {public} | `USING: ((partner_id IS NULL) AND (partner_email ~~* ( SELECT profiles.email FROM profiles WHERE (profiles.id = auth.uid())))) / CHECK: (partner_id = auth.uid())` |  | mixed: outer agency_id/partner_id predicate plus a relationship subquery |
| `partnerships` | Partners can update partnership status | UPDATE | {authenticated} | `USING = CHECK: (partner_id = auth.uid())` |  |  |
| `partnerships` | Partners can view their partnerships | SELECT | {authenticated} | `USING: (partner_id = auth.uid())` |  |  |
| `projects` | projects_agency_delete | DELETE | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `projects` | projects_agency_insert | INSERT | {authenticated} | `CHECK: (agency_id = auth.uid())` |  |  |
| `projects` | projects_agency_select | SELECT | {authenticated} | `USING: (agency_id = auth.uid())` |  |  |
| `projects` | projects_agency_update | UPDATE | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |
| `rfp_magic_tokens` | Agency can manage their own tokens | ALL | {public} | `USING: (agency_id = auth.uid())` | **yes** |  |
| `usage_tracking` | Agencies manage own usage tracking | ALL | {authenticated} | `USING = CHECK: (agency_id = auth.uid())` |  |  |


#### Bucket (b)

| Table | Policy | Cmd | Roles | Live predicate | Prod-only | Note |
|---|---|---|---|---|---|---|
| `assignment_agreements` | Agencies manage agreements for their project assignments | ALL | {authenticated} | `USING = CHECK: (assignment_id IN ( SELECT pa.id FROM (project_assignments pa JOIN projects pr ON ((pa.project_id = pr.id))) WHERE (pr.agency_id = auth.uid())))` |  |  |
| `assignment_agreements` | Partners read and update own assignment agreements | SELECT | {authenticated} | `USING: (assignment_id IN ( SELECT pa.id FROM (project_assignments pa JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE (p.partner_id = auth.uid())))` |  |  |
| `assignment_agreements` | Partners update agreement signature fields | UPDATE | {authenticated} | `USING = CHECK: (assignment_id IN ( SELECT pa.id FROM (project_assignments pa JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE (p.partner_id = auth.uid())))` |  |  |
| `bid_evaluation_scores` | Agencies manage own bid evaluation scores | ALL | {authenticated} | `USING = CHECK: (EXISTS ( SELECT 1 FROM bid_evaluations e WHERE ((e.id = bid_evaluation_scores.evaluation_id) AND (e.agency_id = auth.uid()))))` |  |  |
| `delivery_review_scores` | Agencies manage own delivery review scores | ALL | {authenticated} | `USING = CHECK: (EXISTS ( SELECT 1 FROM delivery_reviews r WHERE ((r.id = delivery_review_scores.review_id) AND (r.agency_id = auth.uid()))))` |  |  |
| `delivery_reviews` | Partners view own complete delivery reviews | SELECT | {authenticated} | `USING: ((status = 'complete'::text) AND (EXISTS ( SELECT 1 FROM partnerships p WHERE ((p.id = delivery_reviews.partnership_id) AND (p.partner_id = auth.uid())))))` |  |  |
| `msa_agreements` | Partners can view their MSAs | SELECT | {authenticated} | `USING: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` | **yes** |  |
| `notifications` | Scoped insert notifications | INSERT | {authenticated} | `CHECK: ((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM partnerships p WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = notifications.user_id) AND (p.status = 'active'::text)))) OR...` |  | Mixed: one `user_id = auth.uid()` disjunct (unchanged) ORed with two partnership subqueries. All the 079 work is in the joins. |
| `onboarding_deployments` | Agencies manage onboarding deployments for own projects | ALL | {authenticated} | `USING = CHECK: (project_id IN ( SELECT projects.id FROM projects WHERE (projects.agency_id = auth.uid())))` |  |  |
| `onboarding_deployments` | Partners read onboarding deployments for their assignments | SELECT | {authenticated} | `USING: (assignment_id IN ( SELECT pa.id FROM (project_assignments pa JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE (p.partner_id = auth.uid())))` |  |  |
| `onboarding_package_documents` | Agency full access package document rows | ALL | {authenticated} | `USING = CHECK: (package_id IN ( SELECT op.id FROM (onboarding_packages op JOIN projects p ON ((p.id = op.project_id))) WHERE (p.agency_id = auth.uid())))` |  |  |
| `onboarding_package_documents` | Partner reads documents for their packages | SELECT | {authenticated} | `USING: (package_id IN ( SELECT onboarding_packages.id FROM onboarding_packages WHERE (onboarding_packages.partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships....` |  |  |
| `onboarding_packages` | Partner reads onboarding packages for their partnership | SELECT | {authenticated} | `USING: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` |  |  |
| `onboarding_packages` | Partner updates review fields on own packages | UPDATE | {authenticated} | `USING = CHECK: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` |  |  |
| `partner_status_updates` | Agencies can resolve status updates | UPDATE | {authenticated} | `USING: (project_id IN ( SELECT projects.id FROM projects WHERE (projects.agency_id = auth.uid())))` |  |  |
| `partner_status_updates` | Agencies can view status updates for their projects | SELECT | {authenticated} | `USING: (project_id IN ( SELECT projects.id FROM projects WHERE (projects.agency_id = auth.uid())))` |  |  |
| `partner_status_updates` | Partners can insert their own status updates | INSERT | {authenticated} | `CHECK: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` |  |  |
| `partner_status_updates` | Partners can update their own status updates | UPDATE | {authenticated} | `USING: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` | **yes** |  |
| `partner_status_updates` | Partners can view their own status updates | SELECT | {authenticated} | `USING: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` |  |  |
| `payment_milestones` | Agency can manage payment milestones | ALL | {authenticated} | `USING = CHECK: (project_id IN ( SELECT projects.id FROM projects WHERE (projects.agency_id = auth.uid())))` |  |  |
| `payment_milestones` | Partners can view their payment milestones | SELECT | {authenticated} | `USING: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` | **yes** |  |
| `payment_milestones` | Partners read payment milestones for their partnerships | SELECT | {authenticated} | `USING: ((partnership_id IS NOT NULL) AND (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid()))))` |  |  |
| `payment_milestones` | Partners read their payment milestones | SELECT | {authenticated} | `USING: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` | **yes** |  |
| `profiles` | Agencies read profiles of their partners | SELECT | {authenticated} | `USING: (EXISTS ( SELECT 1 FROM partnerships p WHERE ((p.agency_id = auth.uid()) AND (p.partner_id = profiles.id))))` |  |  |
| `profiles` | Partners read lead agency profiles for their partnerships | SELECT | {authenticated} | `USING: (EXISTS ( SELECT 1 FROM partnerships p WHERE ((p.partner_id = auth.uid()) AND (p.agency_id = profiles.id))))` |  |  |
| `profiles` | Users can view profiles of partnership members | SELECT | {authenticated} | `USING: ((id = auth.uid()) OR (EXISTS ( SELECT 1 FROM partnerships WHERE ((partnerships.partner_id = auth.uid()) AND (partnerships.agency_id = profiles.id)))) OR (EXISTS ( SELECT 1 FROM pa...` | **yes** | Mixed: one `id = auth.uid()` disjunct (unchanged) ORed with two partnership subqueries. All the 079 work is in the joins. |
| `project_assignments` | assignments_agency_all | ALL | {authenticated} | `USING = CHECK: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.agency_id = auth.uid())))` |  |  |
| `project_assignments` | assignments_partner_select | SELECT | {authenticated} | `USING: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` |  |  |
| `project_assignments` | assignments_partner_update | UPDATE | {authenticated} | `USING = CHECK: (partnership_id IN ( SELECT partnerships.id FROM partnerships WHERE (partnerships.partner_id = auth.uid())))` |  |  |
| `project_documents` | Agencies can view documents for their projects | SELECT | {authenticated} | `USING: (EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_documents.project_id) AND (p.agency_id = auth.uid()))))` |  |  |
| `project_documents` | Partners can view documents for their assignments | SELECT | {authenticated} | `USING: (((visibility = 'all_partners'::text) AND (EXISTS ( SELECT 1 FROM (project_assignments pa JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE ((pa.project_id = project_docum...` |  |  |
| `project_messages` | Agencies can view messages for their projects | SELECT | {authenticated} | `USING: (EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_messages.project_id) AND (p.agency_id = auth.uid()))))` |  |  |
| `project_messages` | Partners can view messages for their assignments | SELECT | {authenticated} | `USING: (EXISTS ( SELECT 1 FROM (project_assignments pa JOIN partnerships p ON ((pa.partnership_id = p.id))) WHERE ((pa.id = project_messages.assignment_id) AND (p.partner_id = auth.uid()))))` |  |  |
| `projects` | projects_partner_select_assigned | SELECT | {authenticated} | `USING: (EXISTS ( SELECT 1 FROM (project_assignments pa JOIN partnerships p ON ((p.id = pa.partnership_id))) WHERE ((pa.project_id = projects.id) AND (p.partner_id = auth.uid()))))` |  |  |


#### Bucket (c)

| Table | Policy | Cmd | Roles | Live predicate | Prod-only | Note |
|---|---|---|---|---|---|---|
| `brief_interpretations` | Users can manage their own interpretations | ALL | {public} | `USING = CHECK: (auth.uid() = user_id)` | **yes** |  |
| `contact_submissions` | Admins can read contact submissions | SELECT | {authenticated} | `USING: (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))))` |  | Reaches through `profiles` for `is_admin`, not through a partnership. It is a self-lookup of the caller's own row, so the org model does not touch it. |
| `email_connections` | Users manage their own email connections | ALL | {public} | `USING = CHECK: (auth.uid() = user_id)` |  |  |
| `notifications` | Users can update own notifications | UPDATE | {authenticated} | `USING: (user_id = auth.uid())` | **yes** |  |
| `notifications` | Users can view own notifications | SELECT | {authenticated} | `USING: (user_id = auth.uid())` | **yes** |  |
| `partnership_profile_context` | Users can insert their own context | INSERT | {public} | `CHECK: (user_id = auth.uid())` | **yes** |  |
| `partnership_profile_context` | Users can read their own context | SELECT | {public} | `USING: (user_id = auth.uid())` | **yes** |  |
| `partnership_profile_context` | Users can update their own context | UPDATE | {public} | `USING: (user_id = auth.uid())` | **yes** |  |
| `profiles` | Enable insert for authenticated users only | INSERT | {public} | `CHECK: (auth.uid() = id)` |  | profiles.id = auth.uid(), the user's own row |
| `profiles` | Users can update own profile | UPDATE | {public} | `USING: (auth.uid() = id)` |  | profiles.id = auth.uid(), the user's own row |
| `project_documents` | Uploaders can delete their documents | DELETE | {authenticated} | `USING: (uploaded_by = auth.uid())` | **yes** | user-scoped on sender_id/uploaded_by rather than user_id |
| `project_documents` | Uploaders can update their documents | UPDATE | {authenticated} | `USING: (uploaded_by = auth.uid())` | **yes** | user-scoped on sender_id/uploaded_by rather than user_id |
| `project_documents` | Users can upload documents | INSERT | {authenticated} | `CHECK: (uploaded_by = auth.uid())` |  | user-scoped on sender_id/uploaded_by rather than user_id |
| `project_messages` | Senders can update their messages | UPDATE | {authenticated} | `USING: (sender_id = auth.uid())` | **yes** | user-scoped on sender_id/uploaded_by rather than user_id |
| `project_messages` | Users can send messages | INSERT | {authenticated} | `CHECK: (sender_id = auth.uid())` |  | user-scoped on sender_id/uploaded_by rather than user_id |


#### Bucket (d)

| Table | Policy | Cmd | Roles | Live predicate | Prod-only | Note |
|---|---|---|---|---|---|---|
| `contact_submissions` | Anyone can insert contact submissions | INSERT | {anon,authenticated} | `CHECK: true` |  |  |
| `partner_vouches` | Anyone can count vouches | SELECT | {public} | `USING: true` |  |  |
| `profiles` | Authenticated users can read discoverable profiles | SELECT | {authenticated} | `USING: (is_discoverable = true)` |  | `is_discoverable = true`, no identity term at all. Role is `{authenticated}`, not `{anon}` - see the bucket note. |


#### Bucket U

| Table | Policy | Cmd | Roles | Live predicate | Prod-only | Note |
|---|---|---|---|---|---|---|
| `invitation_requests` | Agencies can update requests to their email | UPDATE | {authenticated} | `USING: (agency_email = ( SELECT profiles.email FROM profiles WHERE (profiles.id = auth.uid())))` |  | Same predicate as the SELECT above, same open question. |
| `invitation_requests` | Agencies can view requests to their email | SELECT | {authenticated} | `USING: (agency_email = ( SELECT profiles.email FROM profiles WHERE (profiles.id = auth.uid())))` |  | Matches `agency_email` against the caller's OWN profile email. Not agency_id, not a partnership, not user_id. An organization has no single email, so 079 has to rule what this becomes. |
| `partner_rfp_inbox` | Partners select inbox rows by recipient email | SELECT | {authenticated} | `USING: ((recipient_email IS NOT NULL) AND (EXISTS ( SELECT 1 FROM profiles pr WHERE ((pr.id = auth.uid()) AND (lower(TRIM(BOTH FROM pr.email)) = lower(TRIM(BOTH FROM partner_rfp_inbox.rec...` |  | Matches `recipient_email` against the caller's OWN profile email - the ghost/unclaimed vendor path. Whether a colleague may read a row addressed to another member's mailbox is a product ruling, not a mechanical rewrite. |
