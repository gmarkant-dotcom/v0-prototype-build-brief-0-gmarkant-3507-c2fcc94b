# The read-scope class inventory

**Branch:** `fix/acting-role-read-scope`  **Date:** 2026-08-21
**Status of this document:** Phase 0 deliverable. No code changed in the commit that carries it.

---

## 0. What the class is

> Any table whose policy set contains **both** an agency-arm SELECT and a vendor-arm SELECT
> will return the **union of both arms** to a dual-role caller. Any query reading such a
> table without an explicit acting-role or acting-org filter is defective.

Permissive policies of the same command OR together. Row level security answers *"may this
caller see this row at all"*, never *"is this caller the vendor on it"*. A query that asks
only the first question and renders the answer in a portal that presupposes the second is
showing the caller the wrong half of their own account.

This is the READ counterpart of the Class B write pattern catalogued in
`docs/091b-session-report.md`. The write version wrote to the wrong company. This one reads
from the wrong side.

**Not a data leak.** In every instance below the caller is entitled to every row returned.
The defect is which surface renders them.

---

## 1. Deriving the class from the live policy set

### 1a. Source of truth, and why it is not one file

`docs/schema-snapshot-2026-08-13.md` is the authoritative `pg_policies` dump, but it predates
079's rename: it still records `partner_rfp_inbox` SELECT as `(agency_id = auth.uid())`. The
live predicate is `lead_org_id IN (SELECT current_user_org_ids())`. The class was therefore
derived by layering the applied migrations onto the snapshot:

| Source | Contribution |
|---|---|
| `docs/schema-snapshot-2026-08-13.md` | base set, and the policies 079 never dropped (bucket U) |
| `079_organizations.sql` PHASE 4 (:522-606) | 85 policies dropped |
| `079_organizations.sql` PHASE 10 (:1121-1700) | the org-scoped replacements |
| `080_milestone_events.sql:337-381` | `milestone_events`, three policies |
| `081`/`083` | `project_documents`, `project_messages` INSERT only, not SELECT |
| `082_partner_vouches_containment.sql:507-530` | dropped `Anyone can count vouches`, one arm remains |
| `086`, `089` | `org_members`, `org_invitations` - roster/admin arms, not agency/vendor arms |
| `087:564-567` | `partnerships` INSERT only |
| `088:433-436` | `milestone_events` vendor INSERT only |
| `090`, `091`, `092` | no policy changes |

### 1b. The class members

Derived, not taken from the prompt's candidate list. Every table in `public` was checked for
a SELECT (or `FOR ALL`, which includes SELECT) policy on each side.

| # | Table | Agency-arm SELECT | Vendor-arm SELECT |
|---|---|---|---|
| 1 | `partner_rfp_inbox` | `Agencies select own partner RFP inbox rows` (`lead_org_id`) | `Partners select inbox rows by partner_id` (`vendor_org_id`); `Partners select inbox rows by recipient email` (email) |
| 2 | `partner_rfp_responses` | `Agencies select RFP responses they own` (`lead_org_id`) | `Partners select own RFP responses`; `Partners read response status and feedback` (both `vendor_org_id`) |
| 3 | `partner_rfp_response_versions` | `Agencies read owned response versions` (`lead_org_id`) | `Partners read own response versions` (`vendor_org_id`) |
| 4 | `partnerships` | `Agencies can view their partnerships` (`lead_org_id`) | `Partners can view their partnerships` (`vendor_org_id`) |
| 5 | `projects` | `projects_agency_select` (`org_id`) | `projects_partner_select_assigned` (via assignments) |
| 6 | `project_assignments` | `assignments_agency_all` (FOR ALL, `lead_org_id`) | `assignments_partner_select` (`vendor_org_id`) |
| 7 | `project_documents` | `Agencies can view documents for their projects` | `Partners can view documents for their assignments` |
| 8 | `project_messages` | `Agencies can view messages for their projects` | `Partners can view messages for their assignments` |
| 9 | `payment_milestones` | `Agency can manage payment milestones` (FOR ALL) | three near-identical partner SELECTs |
| 10 | `milestone_events` | `Members read own company milestone events` (`org_id`) | `Counterparty reads whitelisted milestone events` |
| 11 | `onboarding_packages` | `Agency full access ...` (FOR ALL) | `Partner reads onboarding packages for their partnership` |
| 12 | `onboarding_package_documents` | `Agency full access package document rows` (FOR ALL) | `Partner reads documents for their packages` |
| 13 | `onboarding_deployments` | `Agencies manage onboarding deployments ...` (FOR ALL) | `Partners read onboarding deployments for their assignments` |
| 14 | `assignment_agreements` | `Agencies manage agreements ...` (FOR ALL) | `Partners read and update own assignment agreements` |
| 15 | `msa_agreements` | `Agency can manage their MSAs` (FOR ALL) | `Partners can view their MSAs` |
| 16 | `delivery_reviews` | `Agencies manage own delivery reviews` (FOR ALL) | `Partners view own complete delivery reviews` |
| 17 | `partner_status_updates` | `Agencies can view status updates for their projects` | `Partners can view their own status updates` |
| 18 | `agency_partner_invitations` | `Agencies can view their sent invitations` | `Partners can view their received invitations` |
| 19 | `partner_access_requests` | `Agencies can view requests to them` (`lead_org_id`) | `Partners can view their requests` (`vendor_org_id`) |
| 20 | `invitation_requests` | `Agencies can view requests to their email` (bucket U, email-keyed) | `Partners can view own requests` (`vendor_org_id`) |

**Eighteen of the twenty are new to this analysis.** The prompt named eight candidates; all
eight are members, and twelve more were derived.

### 1c. Deliberate exclusions, argued

- **`profiles`** carries the class *shape* but is excluded from the defect. 079 folded its
  three SELECT policies into one - `id = auth.uid() OR id IN (SELECT current_user_visible_profile_ids())`
  (`079_organizations.sql:1563-1568`). Because it is a **single** policy expressing the union
  rather than two arms OR-ing together, there is no per-portal arm to select. More decisively,
  a vendor is *supposed* to read the lead agency's profile and vice versa - that reciprocity is
  the product. Scoping it by acting role would be a product change, not a bug fix.
- **`partner_vouches`** - 082 dropped `Anyone can count vouches`; only
  `Vouchers read their own company vouches` remains. One arm. Not a member.
- **`notifications`**, **`partnership_profile_context`**, **`brief_interpretations`**,
  **`email_connections`** - keyed on `user_id = auth.uid()`. One arm. Not members.
- **`org_members`**, **`org_invitations`** - roster and admin/invitee arms, which is a
  different axis from agency/vendor. Not members.
- **`bid_*`**, **`clients`**, **`client_cash_flow`**, **`usage_tracking`**,
  **`agency_library_documents`**, **`rfp_magic_tokens`**, **`delivery_review_scores`**,
  **`bid_evaluation_scores`** - agency arm only. Not members.

---

## 2. Method

Grep alone cannot answer this: a filter three statements earlier can make an unqualified
select safe, and that is invisible to a pattern match. The reads were enumerated
mechanically and then **every** ambiguous one was read.

1. Every `.from("<class table>")` across `app/`, `lib/`, `components/`, `contexts/`, `hooks/`
   was located: **387 sites, 288 of them reads** (99 are `insert`/`update`/`upsert`/`delete`).
2. For each, the full statement was extracted by balancing parentheses and brackets, with
   backtick template selects and interleaved comment lines handled, so multi-line PostgREST
   embeds are not truncated mid-chain. (The naive line-continuation version of this scan
   produced eleven false UNSCOPED readings; they are not in the table below.)
3. A read carrying `.eq/.in("lead_org_id"|"org_id", ...)` **and not** a vendor filter is
   settled agency-scoped; the mirror settles vendor-scoped. **226 of 288** settle here.
4. The remaining **62** were resolved by tracing each filter key back to its assignment and
   then reading the handler. Those resolutions are section 4.

---

## 3. DEFECTIVE sites

Three. All on `partner_rfp_inbox`, all in the vendor portal, all the same mechanism.

| # | File:line | Table | Portal | Finding |
|---|---|---|---|---|
| D1 | `app/api/partner/rfps/route.ts:166-169` | `partner_rfp_inbox` | VENDOR | **DEFECTIVE** |
| D2 | `app/api/partner/dashboard/route.ts:63-67` | `partner_rfp_inbox` | VENDOR | **DEFECTIVE** |
| D3 | `app/api/projects/[id]/messages/route.ts:92-101` | `project_messages` | SHARED, vendor branch | **DEFECTIVE (latent)** |

### D1 - `app/api/partner/rfps/route.ts:166-169`

```ts
const { data, error } = await supabase
  .from("partner_rfp_inbox")
  .select("*")
  .order("created_at", { ascending: false })
```

No filter of any kind. The comment above it states the defect as if it were the design:

> `:164-165` - *"No application-side org filter is needed because there is no application-side
> filter here at all: the select is unqualified and RLS is the whole scoping."*

RLS *is* the whole scoping, and RLS returns the union. This is the read Greg's live query
measured: 96 rows, `visible_as_lead_agency = 96`, `visible_as_vendor_org = 0`,
`visible_by_recipient_email = 0`. Feeds the list, the tab counts, the agency grouping header,
and (through `inboxIds` at `:224`) the response join at `:227-230`.

### D2 - `app/api/partner/dashboard/route.ts:63-67`

```ts
const [inboxRes, responsesRes, partnershipsRes] = await Promise.all([
  supabase
    .from("partner_rfp_inbox")
    .select("id, lead_org_id, project_id, scope_item_name, status, ..."),
  supabase.from("partner_rfp_responses").select(...).in("vendor_org_id", callerOrgIds),
  supabase.from("partnerships").select(...).in("vendor_org_id", callerOrgIds),
])
```

**Its own two siblings in the same `Promise.all` carry `.in("vendor_org_id", callerOrgIds)`
and the inbox read does not.** `callerOrgIds` is already in scope at `:60`. The client is the
RLS-bound one from `requirePartnerRole()`, not a service client, so RLS is the only scoping
and the union applies. Pollutes `needsResponse`, `agencyIds` (`:101`), `projectIds` (`:147`)
and the vendor activity feed.

### D3 - `app/api/projects/[id]/messages/route.ts:92-101`

Latent, and reported with its limits stated. The handler branches correctly on
`actingRole(profile)` at `:40` and the partner branch proves an assignment at `:67-73`, but
then **discards it**: the message read is `.eq('project_id', projectId)` with no assignment
filter unless the client passed `assignmentId`. For an ordinary vendor the RLS vendor arm
(`pa.id = project_messages.assignment_id`) still scopes it, so nothing is wrong today. For a
caller who is *both* the lead agency of the project and an assigned vendor on it, the agency
arm ORs in and the vendor portal renders every message on the project, including other
vendors'. Requires self-dealing to reach. The assignment id is already in hand.

---

## 4. CANDIDATE sites resolved

Every site that grep could not settle, with the line that decides it.

### 4a. GUARDED by a pre-check on the row itself (the reference pattern)

`lib/partner-inbox-access.ts` `partnerCanAccessPartnerRfpInbox(row, callerOrgIds, email)`
compares `vendor_org_id` against the caller's memberships and `recipient_email` against the
caller's profile email. **This is the reference implementation** - the detail route is the one
that behaved correctly against the row the list had just wrongly rendered.

| File:line | Deciding line |
|---|---|
| `app/api/partner/rfps/[id]/route.ts:22-26` | `:37` `partnerCanAccessPartnerRfpInbox(...)` then `:48` `if (!access.allowed)` |
| `app/api/partner/rfps/[id]/intent/route.ts:28-32` | `:42` `partnerCanAccessPartnerRfpInbox(...)` |
| `app/api/partner/rfps/[id]/response/route.ts:148-152` | `:158` `partnerCanAccessPartnerRfpInbox(...)`; `:191`, `:330`, `:386`, `:489` all re-key `.eq("id", inboxId)` behind it |
| `app/api/partner/rfp-bid/upload/route.ts:76-80` | `:86` `partnerCanAccessPartnerRfpInbox(...)` |
| `app/api/partner/rfps/[id]/nda-notify/route.ts:31-47` | `:52-56` `callerOwnsOrg(callerOrgIds, inbox.vendor_org_id)` OR `isSameEmail(...)`, else 403 |
| `app/api/partner/rfps/claim/route.ts:38-44` | keyed `.eq("invite_token", token)`; `:58` `callerOwnsOrg(...)` for a claimed row, `:65` `emailMatches(...)` for an unclaimed one |
| `app/api/partner/rate-info/route.ts:122-126` | `:131-133` `assertPartnerOwnsPartnership` -> `if (!callerOwnsOrg(callerOrgIds, data.vendor_org_id)) return false` |
| `app/api/partner/onboarding-packages/[id]/route.ts:33,43` | `:48` `if (!ship || !callerOwnsOrg(callerOrgIds, ship.vendor_org_id))` -> 404 |
| `app/api/partner/onboarding/file/route.ts:40,50,58` | `:64` same `callerOwnsOrg` chain -> 404 |
| `app/api/projects/[id]/onboarding-packages/route.ts:41,62,153` | `:55` `if (!project \|\| !callerOwnsOrg(callerOrgIds, project.org_id))` -> 404 |
| `app/api/projects/[id]/onboarding-partners/route.ts:43,55` | `:46` same |
| `app/api/projects/[id]/assignments/route.ts:44,58,121,152,294` | `:49` same |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:29,39,61` | `:69` `actingRole(profile)` branch, each side scoped |
| `app/api/projects/[id]/partner/route.ts:42,52` | `:36` `canActAs(profile,'partner')` + `:42` `.in('vendor_org_id', callerOrgIds)` |
| `app/api/projects/[id]/onboarding/deploy/route.ts:67,78` | `:43` `canActAs(profile,'agency')` + project org check |
| `app/api/agency/pool/[partnerId]/notes/route.ts:66` | `assertActiveAgencyPartnership(supabase, callerOrgIds, partnerId)` |

### 4b. GUARDED by construction - the key came from an already-scoped query

The dominant safe pattern: a vendor-scoped `partnerships` or `partner_rfp_responses` read
produces the id list, and every later read is `.in(...)` over that list. An agency-side row
cannot enter the list, so it cannot enter the result.

| File:line | Key | Scoped at |
|---|---|---|
| `app/api/partner/rfps/bids/route.ts:160,174` | `inboxIds`, `projectIds` | `:146` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/projects/route.ts:140,154,187` | `inboxIds`, `partnershipIds`, `projectIdsNeeded` | `:87`, `:127` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/dashboard/route.ts:112,119,126,162,225,236,293` | `partnershipIds`, `pkgProjectIds` | `:74` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/payments/route.ts:126,161,182` | `partnershipIds` | `:74` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/onboarding-packages/route.ts:39,62,127` | `pids`, `projectIds`, `pkgIds` | `:32` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/blob-download/route.ts:60` | `partnershipIds` | `:51` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/summary/route.ts:68` | `partnershipIds` | `:36`,`:57` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/projects/[projectId]/status-update/route.ts:87,162,177,234` | `partnershipIds` | `:80`,`:140` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts:116,150,238` | `partnershipIds`, `partnershipId` | `:95` `.in("vendor_org_id", callerOrgIds)`; `:116` `.in("partnership_id", partnershipIds)` gates the project read |
| `app/api/partner/rfps/[id]/route.ts:173,200,229` | `projectId`, `responseId` off the access-checked inbox row and the `:185` vendor-scoped response | `:37` access check, `:185` `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/rfps/route.ts:216,228` | `projectIds`, `inboxIds` | **derived from D1** - inherits D1's defect, fixed by fixing D1 |
| `app/partner/projects/page.tsx:178,216,342,363,686` | `project.partnership_id`, `partnershipIds` | props from `/api/partner/projects`, vendor-scoped at its `:87` |
| `app/api/agency/utilization/route.ts:163,235` | `[...projectIds]`, `[...assignmentIdsForStatus]` | `:128` `.in("org_id", callerOrgIds)` |
| `app/api/agency/rfp-responses/route.ts:257,333,365` | `projectIdsFromInbox`, `responseIds` | `:50` `.in("lead_org_id", callerOrgIds)` |
| `app/api/agency/msa/milestones/route.ts:106,476,581,752` | `agencyProjectIds` | `:43`,`:71`,`:561` `.in("org_id", callerOrgIds)` |
| `app/api/agency/dashboard/route.ts:226,232,239` | `projectIds` | `:136` `.in("org_id", callerOrgIds)` |
| `app/api/agency/active-engagements/route.ts:212,361` | `agencyProjectIds`, `a.partnership_id` | `:106` `.in("org_id", callerOrgIds)` |
| `app/api/agency/pool/client-history/route.ts:82` | `projectIds` | `:35`,`:49` `.in("org_id", callerOrgIds)` |
| `app/api/agency/bids/[responseId]/ai-score/route.ts:49,53,83` | `partnershipIds` | `:38` `.in("lead_org_id", orgIds)` |
| `app/api/agency/projects/[projectId]/status-updates/route.ts:53,83,160,199` | `projectId`, `partnershipIds` | `:41`,`:144` `.in("org_id", callerOrgIds)` |
| `app/api/projects/route.ts:267,428` | `agencyProjectIds`, `partnershipIds` | `:186`/`:409`, inside the `actingRole` branch |
| `lib/partnership-award-claim.ts:44` | `ghostIds` | `:36` email-keyed ghost rows, service client |
| `app/api/rfp/guest/[token]/route.ts:234,274,541,702` | `tokenRow.*` | token-keyed, service client, no RLS involved |
| `lib/magic-token-attach.ts:249,301` | `tokenRow.*` | service client |

### 4c. GUARDED because both arms are named deliberately

Marked BOTH-ARMS by the scan. Reading them shows each names one arm as the caller's scope and
the other as a *filter value*, which is stricter than either arm alone, not looser.

| File:line | Shape |
|---|---|
| `app/api/partner/rfps/[id]/route.ts:107-113`, `.../response/route.ts:496`, `.../nda-notify/route.ts:149` | `.eq("lead_org_id", inbox.lead_org_id).in("vendor_org_id", callerOrgIds)` - vendor scope, narrowed to one lead |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts:209` | `.in("vendor_org_id", callerOrgIds).eq("lead_org_id", agencyId)` |
| `app/api/partner/network/[agencyId]/route.ts:113,225` | same shape, `leadOrgId` resolved from the route param then used as a filter |
| `app/api/agency/pool/[partnerId]/route.ts:51,166`, `.../performance/route.ts:52`, `.../notes/route.ts:66` | `.in("lead_org_id", callerOrgIds).eq("vendor_org_id", partnerId)` - agency scope, narrowed to one vendor |
| `app/api/agency/broadcast-rfp/route.ts:200,355`, `email-scan/{run,import}` | same |
| `app/api/agency/blob-download/route.ts:81`, `active-engagements/route.ts:332` | same |
| `app/api/projects/[id]/onboarding-{packages,partners}/route.ts:255,138` | agency-scoped, vendor id read off the already-authorized row |
| `app/api/marketplace/discoverable/route.ts:66` | `.or("lead_org_id.in.(...),vendor_org_id.in.(...)")` - **the union is the feature.** A marketplace badge must say "you have a partnership with this company" from either side. Correct. |
| `lib/partnership-invitations.ts:48`, `lib/award-partnership-resolution.ts:55`, `app/api/rfp/guest/[token]/route.ts:48` | both ids are explicit parameters, service client |

### 4d. Reads settled by an explicit acting-role branch

Ten routes already consume `lib/acting-role.ts`. They are the precedent this work follows:

`app/api/projects/route.ts:149`, `app/api/projects/[id]/route.ts:32,72`,
`app/api/projects/[id]/messages/route.ts:40,156`,
`app/api/projects/[id]/agreements/[agreementId]/route.ts:69`,
`app/api/projects/[id]/partner/route.ts:36`,
`app/api/projects/[id]/onboarding/deploy/route.ts:43`,
`app/api/partnerships/route.ts:60,428`, `app/api/agency/msa/ai-schedule/route.ts:84`,
`app/api/agency/payment-synthesis/route.ts:74`, `app/api/agency/pool/[partnerId]/route.ts:40`,
`app/api/partner/network/[agencyId]/route.ts:52`.

`app/api/projects/route.ts` is the model: `const acting = actingRole(profile)` at `:149`, then
`if (acting === 'agency')` scopes on `.in('org_id', callerOrgIds)` and
`else if (acting === 'partner')` scopes on `.in('vendor_org_id', callerOrgIds)`.
**The vendor RFP list is the same question asked in the same handler shape, and it does not
ask it.**

---

## 5. THE AGENCY-SIDE MIRROR - reported with the same rigour

The mirror was looked for as a first-class possibility, not a footnote. An agency-side read
with this flaw would render rows where the caller is the **vendor** inside the lead agency
portal. For markant it would be invisible: zero rows carry markant as `vendor_org_id`, so the
union and the agency arm return identical sets and the surface looks correct. It would break
for a genuinely dual-role account.

**Finding: the agency side is clean. Zero DEFECTIVE agency-side reads.**

Of 109 agency-portal reads:

- 68 carry `.eq/.in("org_id"|"lead_org_id", callerOrgIds)` directly.
- 27 are keyed off a list produced by such a read (4b).
- 14 name both arms deliberately with `lead_org_id` as the caller's scope (4c).
- 0 are unqualified.

This asymmetry has a cause worth recording rather than treating as luck. The agency side
inherited `agency_id = auth.uid()` from the pre-079 schema, and 079's rename forced **every**
agency-side read to be rewritten to `.in("org_id", callerOrgIds)` - a mechanical sweep that
left an explicit filter on each one as a side effect. The vendor side got the same sweep for
`vendor_org_id`, but a read that had **no** filter to rewrite was never visited. D1 and D2 are
exactly those: the sweep had nothing to change, so it changed nothing, and the comment at
`app/api/partner/rfps/route.ts:164-165` is a reader noticing the absence and rationalising it.

`scripts/check-org-id-reads.mjs` cannot see this class. It looks for a `profiles` row fetched
by an id an organization column may have supplied. An unqualified select supplies no id at
all, so there is nothing for it to match. Both defects sit inside its 382-file scan and
neither is among its 14 + 60 known-open sites.

---

## 6. Counts

| | Sites |
|---|---|
| `.from(<class table>)` total | 387 |
| writes (out of scope) | 99 |
| reads | 288 |
| settled agency-scoped by direct filter | 118 |
| settled vendor-scoped by direct filter | 108 |
| resolved by per-site read (section 4) | 59 |
| **DEFECTIVE** | **3** (D1, D2 live; D3 latent) |
| DEFECTIVE, vendor direction | 3 |
| DEFECTIVE, agency direction | 0 |

Class tables with at least one defective read: `partner_rfp_inbox` (2), `project_messages` (1).
The other eighteen class tables are clean in both directions.

---

## 7. What Phase 1 and Phase 2 will do

- **Phase 1** - D1 and D2. Add an explicit acting-role filter using
  `resolveActingOrgId()` (`lib/acting-org.ts`) and the detail route's own comparison
  (`partnerCanAccessPartnerRfpInbox`). RLS reliance is kept: policy stays the wall, the filter
  adds scope.
- **Phase 2** - D3, in its own commit naming the table and the direction.
- Nothing in sections 4 or 5 requires a change.

## 8. Open questions this inventory does not settle

| Id | Question |
|---|---|
| OPEN-RS-1 | `app/api/agency/rfp-responses/route.ts:333-337` filters `.in("project_id", [...]).in("partnership_id", [...])` as two independent lists rather than as pairs, so it can match a (project, partnership) combination that was never in `awardedLookupKeys`. Both lists are agency-scoped, so this is a correctness smell inside one company's own data, not a scope defect. Not fixed here. |
| OPEN-RS-2 | `agency_partner_invitations` carries a full class-member policy pair and **zero application reads**. `lib/broadcast-partnership-cue.ts:19` calls it "a DECOY - zero rows". Five live policies on a table nothing reads. |
| OPEN-RS-3 | `payment_milestones` carries three functionally identical partner SELECT policies (079 recreated rather than consolidated, deliberately, at `079_organizations.sql:1505-1532`). Harmless - they OR together - but they are three of the 117. |
