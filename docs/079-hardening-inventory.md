# 079 hardening: discovery and classification

Branch `feat/079-hardening`. Written before a single line of application code was
changed, and committed on its own, so that the classification stands even if
nothing after it does.

Migration 079 is APPLIED to production and the code is DEPLOYED. Nothing in this
document proposes changing 079. It measures and classifies the defect 079 left
behind in application code.

---

## The defect, restated so this file stands alone

079 backfilled one organization per profile with `organizations.id = profiles.id`,
and one `org_members` row per profile with `role = 'owner'`. Verified against the
migration source, PHASE 2: both INSERTs select `p.id` from `public.profiles`.

So for all 16 accounts alive today, **the organization id equals the founding
user's id, and every user belongs to exactly one organization**. Any code
comparing an organization column to a user id is therefore accidentally correct.

The PHASE 12 signup trigger mints `gen_random_uuid()`. For every account created
from now on the two ids differ, and every such comparison returns nothing at HTTP
200 or raises 23503 against `organizations(id)`.

---

## PHASE 0a. The helpers that already exist

Read in full before any code was written. Signatures transcribed from source.

### TypeScript, application side

| Helper | File | Signature | Returns | Set kind | Client |
|---|---|---|---|---|---|
| `resolveCallerOrgIds` | `lib/entitlements.ts:113` | `(userId: string, client: OrgLookupClient) => Promise<string[]>` | MANY org ids, `[]` on failure | **AUTHORITY** (the caller's own memberships) | either; reads `org_members` explicitly rather than via `auth.uid()`, so it works under the service role |
| `agencyEntitlementId` | `lib/entitlements.ts:145` | `(userId: string, client: OrgLookupClient) => Promise<string>` | ONE org id, ranked owner > admin > member | AUTHORITY, but see below | either |
| `loadOrgRole` | `lib/capabilities.ts:281` | `(userId, orgId, client) => Promise<OrgRole \| null>` | the caller's role inside one org | AUTHORITY | either. Written and deliberately unused |
| `orgRoleFor` | `lib/capabilities.ts:249` | `(profile) => OrgRole \| null` | hard-coded `"owner"` | AUTHORITY (constant) | none |
| `resolveOrgMemberUserIds` | `lib/notifications.ts:41` | `(supabase, orgId) => Promise<string[]>` | USER ids of an org's members | fan-out, not authority | either |
| `resolveOrgNotificationRecipients` | `lib/email.ts:325` | `(orgId, client) => Promise<OrgRecipient[]>` | recipients of an org | fan-out, not authority | either |

### SQL, the five no-parameter SECURITY DEFINER helpers created by 079

| Function | Created at | Returns | Set kind |
|---|---|---|---|
| `current_user_org_ids()` | 079:451 | orgs the caller belongs to | **AUTHORITY** |
| `current_user_admin_org_ids()` | 079:466 | orgs the caller owns or administers | **AUTHORITY** |
| `current_user_counterparty_org_ids()` | 079:738 | orgs partnered with the caller, ANY status | **VISIBILITY** |
| `current_user_visible_profile_ids()` | 079:766 | colleagues plus every counterparty's people | **VISIBILITY** |
| `current_user_active_counterparty_user_ids()` | 079:779 | people at ACTIVE counterparties only | **VISIBILITY** |

Only the first two may scope a write. The other three are visibility sets: scoping
a write by one of them would let a vendor write into an agency's organization
merely by being partnered with it.

### Does an existing helper fit every need? No. One gap, and one proposed helper.

`resolveCallerOrgIds()` fits every READ. It is the authority set, it returns many,
and `.in(col, callerOrgIds)` is the direct replacement for `.eq(col, user.id)`.
`app/api/partner/projects/route.ts:70-79` already uses exactly this shape and is
the house pattern the Tier A rewrites follow.

Nothing fits a WRITE. A write needs exactly ONE org id and must fail rather than
guess:

- `resolveCallerOrgIds()` returns an array. Taking `[0]` is an unordered pick.
- `agencyEntitlementId()` returns one id with a deterministic ranking, which is the
  right shape, but **on failure it returns `userId` unchanged**. Its own header
  documents that as deliberate and correct for the 16 backfilled organizations. On
  a write path it is not harmless: `userId` is precisely the value that raises
  23503 against `organizations(id)` for any account created after 079. Its failure
  direction is right for quota accounting and wrong for a foreign key.

**PROPOSED, ONE HELPER: `resolveCallerWriteOrgId(userId, client): Promise<string | null>`**
in `lib/entitlements.ts`. Same owner > admin > member ranking as
`agencyEntitlementId()`, sharing its query, but returns `null` instead of falling
back to the user id. Callers must treat `null` as "fail the request", never as a
value to write. This is the only new helper this run introduces.

---

## PHASE 0b. Reproducing the measurement

**I do not reproduce 188. I measure 230 across 73 files, and the difference is not
a disagreement about arithmetic.**

| Scan | Sites | Files |
|---|---|---|
| Stated yesterday | 188 defects (+1 correct = 189 raw) | 59 |
| Literal re-run of the stated definition: org column on a line with `user.id`, `session.user.id` or `auth.uid()`, comments excluded | 182 | 60 |
| Same, plus org columns compared to or assigned from a **profile row id** (`partner.id`, `matchedProfile.id`, `existingProfile.id`, `selectedAgency.id`) | 197 | 65 |
| Same, plus org columns compared to or assigned from a **`userId`-family local variable** | **230** | **73** |

Reconciliation, stated precisely:

1. The literal form of the stated definition returns 182, not 188. Adding the
   profile-row-id form brings `app/api/partnerships/route.ts` to exactly 15 and
   `app/api/projects/route.ts` and `app/api/agency/msa/milestones/route.ts` to
   exactly 10, which are three of the four per-file figures quoted yesterday. I
   therefore conclude yesterday's scan did include the profile-row-id form, and
   that 188 and my 197 are the same measurement differing by a handful of
   map-building false positives I include and it did not.
2. `app/api/agency/rfp-responses/[id]/route.ts` reaches 11 in my scan against the
   13 quoted. I could not reconstruct the missing 2 and am not going to invent
   them. Every line of that file carrying an org column has been read and
   classified regardless, so the gap is in the counting, not the coverage.
3. **The 33 additional sites are real and were not in the 188.** The stated
   definition matches the literal tokens `user.id`, `session.user.id` and
   `auth.uid()`. It does not match a local variable named `userId`, and seven
   files hold the identical defect spelled that way, including three whole route
   files that never appeared in yesterday's list at all:
   `app/api/agency/scoring/criteria/route.ts` (8 sites),
   `app/api/agency/delivery-reviews/route.ts` (8),
   `app/api/agency/pool/[partnerId]/performance/route.ts` (4).
   `lib/partner-inbox-access.ts:22` is in this set and is an access-control
   function.

### A second class the 188 cannot see at all: indirection through lib/

Twenty-one exported helpers in `lib/` filter or write an organization column using
a value passed in as a parameter. Whether a call is a defect depends on what the
CALLER passes, one stack frame away from any line-based grep.

**19 call sites in 17 files pass a user id into one of them.** These appear in
neither the 188 nor my 230. Examples:

| Call site | Helper | Parameter used as |
|---|---|---|
| `app/api/agency/bids/[responseId]/ai-score/route.ts:184` | `resolveRfpRubricForResponse(supabase, responseId, user.id)` | `.eq("lead_org_id", agencyId)` |
| `app/api/agency/bids/[responseId]/ai-score/route.ts:222` | `loadBidAnalysisContext(supabase, responseId, user.id)` | `.eq("lead_org_id"/"org_id", agencyId)` at 6 sites |
| `app/api/agency/library-documents/route.ts:32` | `fetchScopedLibraryDocuments(supabase, user.id, scope)` | `.eq("org_id", agencyId)` at 4 sites |
| `app/api/agency/pool/resend-invitation/route.ts:81` | `markPartnershipInvited(supabase, { agencyId: user.id, ... })` | `.eq("lead_org_id", agencyId)` and an insert |
| `app/api/projects/route.ts:587` | `reconcileProjectClientFields(supabase, user.id, ...)` | `.eq("org_id", agencyId)` |
| `app/partner/profile/page.tsx:211` | `fetchVouchCount(supabase, user.id)` | `.eq("vendor_org_id", partnerId)` |

The full list is in the report. This is the same finding the brief records about
`scripts/check-org-id-reads.mjs` skipping every non-`profiles` `.from()`, one level
up: **no line-based scan bounds this class, and the 188 never claimed to.**

---

## PHASE 0c. Classification

| Tier | Count | Files |
|---|---|---|
| **A** mechanical, safe to fix | **208** | 68 |
| **B** judgment, do not fix | **10** | 8 |
| **C** correct as written | **12** | 11 |
| Total | 230 | 73 |
| Unclassified | 0 | |

Tier A by shape:

| Shape | Count | Pattern | Replacement |
|---|---|---|---|
| A1 | 147 | `.eq("<org col>", <user id>)` | `.in("<org col>", callerOrgIds)` |
| A3 | 27 | `<row>.<org col> === / !== <user id>` | `callerOrgIds.includes(...)` |
| A4 | 27 | `{ <org col>: <user id> }` on insert/update/upsert | `{ <org col>: writeOrgId }` |
| A2 | 6 | `.eq("partnerships.<org col>", <user id>)` embedded filter | `.in("partnerships.<org col>", callerOrgIds)` |
| A5 | 1 | `.or("lead_org_id.eq.${user.id},...")` | `.or("lead_org_id.in.(...),...")` |

### Why every Tier A rewrite is equal-or-narrower, not wider

Every account today belongs to exactly one organization whose id is its own user
id (079 PHASE 2, verified in source). So `resolveCallerOrgIds(user.id)` returns
exactly `[user.id]` for all 16 live accounts, and `.in(col, callerOrgIds)` is
byte-equivalent to `.eq(col, user.id)` today. **No Tier A rewrite changes a single
observable result on the current database.** That is the test the brief sets, and
any site that failed it was moved to Tier B.

Going forward it is the authority set and nothing else: the caller's own
memberships, never a counterparty visibility set. A read scoped to
`callerOrgIds` returns exactly what the caller's own organizations hold. A write
is scoped to `resolveCallerWriteOrgId()`, a single organization the caller is a
member of, so no caller can write into an organization they do not belong to.

Two Tier A replacements below are shown in their regex-generated form and will be
**hand-written** during Phase 3 because the generated form is not valid
TypeScript: `app/api/partnerships/route.ts:1101` and
`app/api/marketplace/discoverable/route.ts:62`.

---

## TIER B. Judgment required. NOT FIXED. Recommendation for each.

| File | Line | Current expression | Why |
|---|---|---|---|
| `app/agency/pool/[partnerId]/page.tsx` | 255 | `.eq("lead_org_id", user.id).eq("vendor_org_id", partnerId)` | vendor_org_id compared to the partnerId route param, a profiles id throughout /agency/pool/[partnerId]. |
|  | 259 | `await supabase.from("partner_vouches").insert({ lead_org_id: user.id, vendor_or…` | WRITE. partner_vouches.vendor_org_id = partnerId, a profiles id. The lead_org_id half of the same insert is the caller and would be Tier A alone. |
| `app/partner/network/page.tsx` | 510 | `lead_org_id: selectedAgency.id,` | WRITE. partner_access_requests.lead_org_id = selectedAgency.id, a counterparty profiles id from /api/marketplace/discoverable. |
|  | 646 | `const request = myRequests.find((req) => req.lead_org_id === agency.id)` | compares stored lead_org_id to agency.id, a profiles id. Correctness follows whatever :510 is resolved to. |
| `app/api/agency/rfp-responses/[id]/route.ts` | 354 | `.update({ vendor_org_id: matchedProfile.id })` | WRITE. partner_rfp_responses.vendor_org_id = matchedProfile.id persists a counterparty USER id into an org column. |
| `app/api/agency/broadcast-rfp/route.ts` | 315 | `.eq("lead_org_id", user.id)` | filters partnerships.vendor_org_id by existingProfile.id, a counterparty profiles id. |
|  | 332 | `lead_org_id: user.id,` | WRITE. partner_rfp_inbox.vendor_org_id = existingProfile.id persists a counterparty USER id into an org column. |
| `app/api/partnerships/route.ts` | 488 | `existingQuery = existingQuery.eq('vendor_org_id', partner.id)` | filters partnerships.vendor_org_id by partner.id, a counterparty profiles id. Needs a counterparty user -> org resolver, not the caller's identity. |
|  | 620 | `insertData.vendor_org_id = partner.id` | WRITE. insertData.vendor_org_id = partner.id persists a counterparty USER id into an org column. |
| `lib/entitlements.ts` | 162 | `return best?.org_id ?? userId` | agencyEntitlementId() falls back to returning the USER id when membership does not resolve. Documented as deliberate, but it is exactly the value that raises 23503 against organizations(id) on any write path. |

### Recommendations, one per Tier B site

**B-1 through B-5: the counterparty user-to-organization writes.**
`app/api/partnerships/route.ts:488` and `:620`,
`app/api/agency/broadcast-rfp/route.ts:315` and `:332`,
`app/api/agency/rfp-responses/[id]/route.ts:354`.

Each takes a *counterparty's* `profiles.id` and puts it in, or matches it against,
an organization column. Three of the five are writes and will raise 23503 the
first time the counterparty is an account created after 079.

Why this is not mechanical: the caller's identity is not the value being resolved.
Answering it needs a "given this user, which organization is theirs" lookup, and
that has a real product question inside it. A dual-role person will eventually
belong to a lead-agency organization AND a vendor organization; `organizations`
already carries `is_lead_agency` and `is_vendor` to tell them apart. Picking the
wrong one puts a vendor's bid under their agency.

Recommendation: add `resolveOrgIdForUser(userId, { capability: 'vendor' | 'lead' })`
resolving through `org_members` joined to `organizations`, filtered on the
capability flag, and returning `null` on ambiguity rather than picking. Then fix
these five in one reviewable change. This is a phase-two item, not a rename.

**B-6: `lib/entitlements.ts:162`** - `agencyEntitlementId()` returns `userId` when
membership does not resolve. Correct for quota accounting, wrong as a value that
could reach a write. Recommendation: leave `agencyEntitlementId()` exactly as it
is, and add `resolveCallerWriteOrgId()` beside it for writes, as proposed in 0a.
Do not change the fallback: `app/api/partner/projects/route.ts:60` and
`app/api/partner/rfps/route.ts:133` both feed it into
`claimAwardedGhostPartnershipsByEmail`, and changing it under them is a behaviour
change, not a hardening.

**B-7 and B-8: `app/partner/network/page.tsx:510` and `:646`.** The agency picker
is fed by `/api/marketplace/discoverable`, which returns `profiles` rows, so
`selectedAgency.id` is a profile id being written into `partner_access_requests.lead_org_id`
and later compared against it. Recommendation: change the discoverable route to
return the organization id alongside the profile id and have the page write that.
That is an API contract change, which is why it is not mechanical. Note the
`vendor_org_id` half of the same insert (`:509`) IS Tier A and is fixed.

**B-9 and B-10: `app/agency/pool/[partnerId]/page.tsx:255` and `:259`.** The
`[partnerId]` route parameter is a profile id everywhere in this page, and it is
written into `partner_vouches.vendor_org_id`. Recommendation: the same
`resolveOrgIdForUser` from B-1.

> **CORRECTION, added after Phase 3.** This paragraph originally said the
> `lead_org_id` half of the vouch insert was held back "because a half-fixed insert
> is harder to review than an unfixed one". That is not what happened. The caller
> half of this insert, and of the two access-request inserts in
> `/partner/network` and `/partner/marketplace`, WAS fixed in Phase 3, because the
> caller half is unambiguously Tier A and leaving a known-broken write in place to
> keep a diff tidy is the wrong trade. Those three sites are now half fixed, and
> the remaining half is marked in code at each one. The report records this the
> same way.

---

## TIER C. Correct as written. Scan false positives.

| File | Line | Current expression | Why |
|---|---|---|---|
| `app/partner/network/page.tsx` | 497 | `setMyRequests((prev) => [...prev, { id: `demo-req-${Date.now()}`, lead_org_id: …` | demo-only branch guarded by isDemo; writes React state, never the database. |
| `app/api/agency/msa/route.ts` | 77 | `shipById.set(s.id as string, { vendor_org_id: (s.vendor_org_id as string \| null…` | map value copy, vendor_org_id -> vendor_org_id. No user id on this line. |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 233 | `const trackRecord = await loadVendorTrackRecord(supabase, user.id, (response.ve…` | the vendor argument is response.vendor_org_id, already an org id. The agency argument on the same line is indirect defect I-03, tracked separately. |
| `app/api/partner/projects/route.ts` | 91 | `agencyByPartnership.set(s.id as string, s.lead_org_id != null ? String(s.lead_o…` | map value copy, lead_org_id is the value. No comparison. |
| `app/api/partner/dashboard/route.ts` | 227 | `const partnershipAgencyById = new Map(partnerships.map((p) => [p.id as string, …` | map keyed on partnership id; lead_org_id is the value. No comparison. |
| `app/api/partner/rfps/[id]/response/route.ts` | 360 | `void generateAndSaveBidSummary(supabase, saved.id, inbox.lead_org_id).catch((er…` | passes inbox.lead_org_id (an org id) where an org id is wanted. |
|  | 419 | `await notifyBidSubmitted(supabase, inbox.lead_org_id, partner_display_name, sco…` | passes inbox.lead_org_id (an org id) to notifyBidSubmitted, which wants an org id. |
| `app/api/rfp/guest/[token]/route.ts` | 636 | `void generateAndSaveBidSummary(supabase, saved.id as string, tokenRow.org_id as…` | passes tokenRow.org_id (an org id) where an org id is wanted. |
|  | 766 | `await notifyBidSubmitted(supabase, tokenRow.org_id as string, submissionVendorN…` | passes tokenRow.org_id (an org id) to notifyBidSubmitted, which wants an org id. |
| `app/api/partnerships/route.ts` | 653 | `await notifyPartnershipInvitation(supabase, partnership.vendor_org_id, agencyNa…` | passes partnership.vendor_org_id (an org id) to notifyPartnershipInvitation, which takes an org id since the 079 embed pass. |
| `lib/entitlements.ts` | 116 | `const { data, error } = await client.from("org_members").select("org_id").eq("u…` | resolveCallerOrgIds itself: selects org_id FILTERED BY user_id. The correct resolution, not a comparison. The one known-correct hit. |
| `components/bid-detail-sheet.tsx` | 900 | `{canMutate && <BidEvaluationTab ref={evaluationTabRef} responseId={row.id} part…` | forwards row.vendor_org_id as a prop. No user id on this line. |

Each of the twelve was read at source. Ten pass an organization id into a
parameter that wants an organization id, or copy one into a map value, with no
user id on the line at all. One (`app/partner/network/page.tsx:497`) is inside an
`isDemo` branch that writes React state and never reaches the database. One
(`lib/entitlements.ts:116`) is `resolveCallerOrgIds` itself, which selects
`org_id` filtered BY `user_id`: that is the resolution, not the confusion.

---

## TIER A. 208 sites, 68 files. The full table.

Replacements are shown per line. `callerOrgIds` is
`await resolveCallerOrgIds(user.id, supabase)` resolved once per request handler,
with an early `403` when it is empty. `writeOrgId` is
`await resolveCallerWriteOrgId(user.id, supabase)`, with an early `403` when it is
null.

| File | Line | Current expression | Shape | Replacement |
|---|---|---|---|---|
| `app/auth/callback/route.ts` | 91 | `.update({ vendor_org_id: user.id, profile_status: "active", updated_at: new Date().toISOS…` | A4 | `.update({ vendor_org_id: writeOrgId, profile_status: "active", updated_at: new Date().toI…` |
| `app/agency/pool/[partnerId]/page.tsx` | 236 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/agency/pool/page.tsx` | 674 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
| `app/partner/marketplace/page.tsx` | 86 | `supabase.from("partner_access_requests").select("lead_org_id, status").eq("vendor_org_id"…` | A1 | `supabase.from("partner_access_requests").select("lead_org_id, status").in("vendor_org_id"…` |
|  | 128 | `vendor_org_id: userId,` | A4 | `vendor_org_id: writeOrgId,` |
| `app/partner/network/page.tsx` | 453 | `.eq("vendor_org_id", userId)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
|  | 509 | `vendor_org_id: userId,` | A4 | `vendor_org_id: writeOrgId,` |
| `app/partner/profile/page.tsx` | 266 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
| `app/api/projects/route.ts` | 183 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
|  | 196 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
|  | 224 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 229 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 340 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 345 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 369 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
|  | 408 | `.eq('vendor_org_id', user.id)` | A1 | `.in('vendor_org_id', callerOrgIds)` |
|  | 563 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 576 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/projects/[id]/onboarding-packages/route.ts` | 50 | `if (!project \|\| project.org_id !== user.id) {` | A3 | `if (!project \|\| !callerOrgIds.includes(project.org_id)) {` |
|  | 147 | `if (!project \|\| project.org_id !== user.id) {` | A3 | `if (!project \|\| !callerOrgIds.includes(project.org_id)) {` |
|  | 181 | `if (!partnership \|\| partnership.lead_org_id !== user.id) {` | A3 | `if (!partnership \|\| !callerOrgIds.includes(partnership.lead_org_id)) {` |
|  | 216 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 244 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 311 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/projects/[id]/onboarding-partners/route.ts` | 43 | `if (!project \|\| project.org_id !== user.id) {` | A3 | `if (!project \|\| !callerOrgIds.includes(project.org_id)) {` |
|  | 120 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 136 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/api/projects/[id]/messages/route.ts` | 47 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
|  | 68 | `.eq('partnerships.vendor_org_id', user.id)` | A2 | `.in('partnerships.vendor_org_id', callerOrgIds)` |
|  | 79 | `.eq('partnerships.vendor_org_id', user.id)` | A2 | `.in('partnerships.vendor_org_id', callerOrgIds)` |
|  | 167 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
|  | 199 | `.eq('partnerships.vendor_org_id', user.id)` | A2 | `.in('partnerships.vendor_org_id', callerOrgIds)` |
|  | 211 | `.eq('partnerships.vendor_org_id', user.id)` | A2 | `.in('partnerships.vendor_org_id', callerOrgIds)` |
| `app/api/projects/[id]/assignments/route.ts` | 45 | `if (!project \|\| project.org_id !== user.id) {` | A3 | `if (!project \|\| !callerOrgIds.includes(project.org_id)) {` |
|  | 119 | `if (!project \|\| project.org_id !== user.id) {` | A3 | `if (!project \|\| !callerOrgIds.includes(project.org_id)) {` |
|  | 133 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 298 | `const isAgency = assignment.project.org_id === user.id` | A3 | `const isAgency = callerOrgIds.includes(assignment.project.org_id)` |
|  | 299 | `const isPartner = assignment.partnership.vendor_org_id === user.id` | A3 | `const isPartner = callerOrgIds.includes(assignment.partnership.vendor_org_id)` |
|  | 406 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts` | 69 | `const isPartner = acting === 'partner' && partnership?.vendor_org_id === user.id` | A3 | `const isPartner = acting === 'partner' && callerOrgIds.includes(partnership?.vendor_org_i…` |
|  | 70 | `const isAgency = acting === 'agency' && projectRow?.org_id === user.id` | A3 | `const isAgency = acting === 'agency' && callerOrgIds.includes(projectRow?.org_id)` |
| `app/api/projects/[id]/partner/route.ts` | 40 | `.eq('vendor_org_id', user.id)` | A1 | `.in('vendor_org_id', callerOrgIds)` |
| `app/api/projects/[id]/route.ts` | 36 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
|  | 99 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
| `app/api/projects/[id]/onboarding/deploy/route.ts` | 62 | `if (!project \|\| project.org_id !== user.id) {` | A3 | `if (!project \|\| !callerOrgIds.includes(project.org_id)) {` |
|  | 122 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/agency/clients/route.ts` | 34 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 73 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 91 | `const insertRow: Record<string, unknown> = { org_id: user.id, name }` | A4 | `const insertRow: Record<string, unknown> = { org_id: writeOrgId, name }` |
| `app/api/agency/clients/[id]/route.ts` | 24 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 85 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/client-cash-flow/route.ts` | 46 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 110 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
|  | 151 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 181 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/msa/ai-schedule/route.ts` | 102 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 128 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/api/agency/msa/route.ts` | 45 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 65 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 160 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 169 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
|  | 208 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 237 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/msa/milestones/route.ts` | 56 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 130 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 158 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 224 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 271 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 296 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 447 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 468 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 522 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 611 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/delivery-reviews/route.ts` | 59 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 74 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 153 | `supabase.from("projects").select("id").eq("id", projectId).eq("org_id", userId).maybeSing…` | A1 | `supabase.from("projects").select("id").eq("id", projectId).in("org_id", callerOrgIds).may…` |
|  | 154 | `supabase.from("partnerships").select("id").eq("id", partnershipId).eq("lead_org_id", user…` | A1 | `supabase.from("partnerships").select("id").eq("id", partnershipId).in("lead_org_id", call…` |
|  | 172 | `.eq("lead_org_id", userId)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 180 | `org_id: userId,` | A4 | `org_id: writeOrgId,` |
|  | 219 | `supabase.from("bid_scoring_criteria").select("id, default_weight").eq("org_id", userId).i…` | A1 | `supabase.from("bid_scoring_criteria").select("id, default_weight").in("org_id", callerOrg…` |
|  | 287 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/blob-download/route.ts` | 72 | `if (inboxErr \|\| !inbox \|\| inbox.lead_org_id !== user.id) {` | A3 | `if (inboxErr \|\| !inbox \|\| !callerOrgIds.includes(inbox.lead_org_id)) {` |
|  | 79 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 96 | `if (projectErr \|\| !project \|\| project.org_id !== user.id) {` | A3 | `if (projectErr \|\| !project \|\| !callerOrgIds.includes(project.org_id)) {` |
|  | 108 | `if (tokenErr \|\| !tokenRow \|\| tokenRow.org_id !== user.id) {` | A3 | `if (tokenErr \|\| !tokenRow \|\| !callerOrgIds.includes(tokenRow.org_id)) {` |
| `app/api/agency/bids/compare/route.ts` | 56 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 72 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 91 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 143 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 163 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 174 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 204 | `{ response_id: responseId, org_id: user.id, status: "in_progress", updated_at: new Date()…` | A4 | `{ response_id: responseId, org_id: writeOrgId, status: "in_progress", updated_at: new Dat…` |
|  | 230 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/bids/[responseId]/evaluation/route.ts` | 83 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 136 | `.eq("lead_org_id", userId)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 147 | `{ response_id: responseId, org_id: userId, status, updated_at: new Date().toISOString() },` | A4 | `{ response_id: responseId, org_id: writeOrgId, status, updated_at: new Date().toISOString…` |
| `app/api/agency/bids/[responseId]/decompose/route.ts` | 74 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 122 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 168 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/agency/bids/rank/route.ts` | 48 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 117 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/active-engagements/route.ts` | 104 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 341 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/api/agency/projects/[projectId]/status-updates/route.ts` | 39 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 139 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 258 | `.from("projects").select("id, org_id").eq("id", projectId).eq("org_id", user.id).maybeSin…` | A1 | `.from("projects").select("id, org_id").eq("id", projectId).in("org_id", callerOrgIds).may…` |
| `app/api/agency/projects/duplicate/route.ts` | 52 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 67 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 77 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/agency/library-documents/file/route.ts` | 23 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/library-documents/route.ts` | 99 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/agency/library-documents/[id]/route.ts` | 31 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 55 | `const { error } = await supabase.from("agency_library_documents").delete().eq("id", id).e…` | A1 | `const { error } = await supabase.from("agency_library_documents").delete().eq("id", id).i…` |
| `app/api/agency/utilization/route.ts` | 98 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 126 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/rfp-responses/route.ts` | 46 | `supabase.from("partner_rfp_inbox").select("id").eq("lead_org_id", user.id).eq("project_id…` | A1 | `supabase.from("partner_rfp_inbox").select("id").in("lead_org_id", callerOrgIds).eq("proje…` |
|  | 50 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 86 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 118 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 205 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/api/agency/rfp-responses/[id]/route.ts` | 53 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 185 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 228 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 247 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 356 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 410 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 428 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 460 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 589 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 603 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/scoring/templates/route.ts` | 46 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 65 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 79 | `org_id: user.id,` | A4 | `org_id: writeOrgId,` |
| `app/api/agency/scoring/criteria/route.ts` | 19 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 30 | `org_id: userId,` | A4 | `org_id: writeOrgId,` |
|  | 45 | `org_id: userId,` | A4 | `org_id: writeOrgId,` |
|  | 61 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 67 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 117 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 131 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 136 | `org_id: userId,` | A4 | `org_id: writeOrgId,` |
| `app/api/agency/scoring/criteria/[id]/route.ts` | 20 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/payment-synthesis/route.ts` | 90 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 99 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 131 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 144 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 187 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 217 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/api/agency/pool/client-history/route.ts` | 33 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 47 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 62 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/pool/[partnerId]/notes/route.ts` | 173 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/api/agency/pool/[partnerId]/route.ts` | 49 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 164 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 190 | `.eq("org_id", user.id)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/pool/[partnerId]/performance/route.ts` | 50 | `.eq("lead_org_id", userId)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 73 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
|  | 86 | `const { data: projRows } = await supabase.from("projects").select("id, name").eq("org_id"…` | A1 | `const { data: projRows } = await supabase.from("projects").select("id, name").in("org_id"…` |
|  | 96 | `.eq("org_id", userId)` | A1 | `.in("org_id", callerOrgIds)` |
| `app/api/agency/broadcast-rfp/route.ts` | 188 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 213 | `lead_org_id: user.id,` | A4 | `lead_org_id: writeOrgId,` |
| `app/api/agency/broadcast-rfp/resend-invite/route.ts` | 31 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
|  | 78 | `.eq("lead_org_id", user.id)` | A1 | `.in("lead_org_id", callerOrgIds)` |
| `app/api/marketplace/discoverable/route.ts` | 56 | `.or(`lead_org_id.eq.${user.id},vendor_org_id.eq.${user.id}`)` | A5 | `.or(`lead_org_id.in.(${callerOrgIds.join(",")}),vendor_org_id.in.(${callerOrgIds.join(","…` |
|  | 62 | `const otherId = (p.lead_org_id === user.id ? p.vendor_org_id : p.lead_org_id) as string \|…` | A3 | `const otherId = callerOrgIds.includes((p.lead_org_id) ? p.vendor_org_id : p.lead_org_id) …` |
| `app/api/partner/payments/route.ts` | 71 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/onboarding-packages/route.ts` | 28 | `const { data: partnerships } = await supabase.from("partnerships").select("id").eq("vendo…` | A1 | `const { data: partnerships } = await supabase.from("partnerships").select("id").in("vendo…` |
| `app/api/partner/onboarding-packages/[id]/route.ts` | 44 | `if (!ship \|\| ship.vendor_org_id !== user.id) {` | A3 | `if (!ship \|\| !callerOrgIds.includes(ship.vendor_org_id)) {` |
| `app/api/partner/blob-download/route.ts` | 49 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/rate-info/route.ts` | 127 | `if (data.vendor_org_id !== userId) return false` | A3 | `if !callerOrgIds.includes((data.vendor_org_id)) return false` |
| `app/api/partner/projects/[projectId]/status-update/route.ts` | 75 | `const { data: partnerships } = await supabase.from("partnerships").select("id").eq("vendo…` | A1 | `const { data: partnerships } = await supabase.from("partnerships").select("id").in("vendo…` |
|  | 126 | `const { data: partnerships } = await supabase.from("partnerships").select("id").eq("vendo…` | A1 | `const { data: partnerships } = await supabase.from("partnerships").select("id").in("vendo…` |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts` | 92 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
|  | 198 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/network/[agencyId]/route.ts` | 63 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
|  | 168 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/rfps/[id]/response/route.ts` | 270 | `vendor_org_id: user.id,` | A4 | `vendor_org_id: writeOrgId,` |
|  | 279 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
|  | 334 | `vendor_org_id: user.id,` | A4 | `vendor_org_id: writeOrgId,` |
| `app/api/partner/rfps/[id]/intent/route.ts` | 61 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/rfps/[id]/route.ts` | 68 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
|  | 112 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
| `app/api/partner/rfps/[id]/nda-notify/route.ts` | 47 | `const ownsByPartnerId = inbox.vendor_org_id === user.id` | A3 | `const ownsByPartnerId = callerOrgIds.includes(inbox.vendor_org_id)` |
| `app/api/partner/rfps/claim/route.ts` | 49 | `if (inbox.vendor_org_id === userId) {` | A3 | `if callerOrgIds.includes((inbox.vendor_org_id)) {` |
|  | 64 | `vendor_org_id: userId,` | A4 | `vendor_org_id: writeOrgId,` |
| `app/api/partner/onboarding/file/route.ts` | 59 | `if (!ship \|\| ship.vendor_org_id !== user.id) {` | A3 | `if (!ship \|\| !callerOrgIds.includes(ship.vendor_org_id)) {` |
| `app/api/partner/summary/route.ts` | 34 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
|  | 45 | `.eq("vendor_org_id", user.id)` | A1 | `.in("vendor_org_id", callerOrgIds)` |
|  | 53 | `const { data: pships, error: idsErr } = await supabase.from("partnerships").select("id").…` | A1 | `const { data: pships, error: idsErr } = await supabase.from("partnerships").select("id").…` |
| `app/api/partnerships/route.ts` | 90 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 124 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 144 | `.eq('org_id', user.id)` | A1 | `.in('org_id', callerOrgIds)` |
|  | 225 | `.eq('vendor_org_id', user.id)` | A1 | `.in('vendor_org_id', callerOrgIds)` |
|  | 255 | `.update({ vendor_org_id: user.id })` | A4 | `.update({ vendor_org_id: writeOrgId })` |
|  | 485 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 612 | `lead_org_id: user.id,` | A4 | `lead_org_id: writeOrgId,` |
|  | 767 | `const isAgency = partnership.lead_org_id === user.id` | A3 | `const isAgency = callerOrgIds.includes(partnership.lead_org_id)` |
|  | 768 | `const isPartner = partnership.vendor_org_id === user.id` | A3 | `const isPartner = callerOrgIds.includes(partnership.vendor_org_id)` |
|  | 787 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 858 | `.eq('lead_org_id', user.id)` | A1 | `.in('lead_org_id', callerOrgIds)` |
|  | 1101 | `if (partnership.lead_org_id !== user.id) {` | A3 | `if !callerOrgIds.includes((partnership.lead_org_id)) {` |
| `app/api/documents/[id]/route.ts` | 22 | `if (p.vendor_org_id === userId) return true` | A3 | `if callerOrgIds.includes((p.vendor_org_id)) return true` |
|  | 59 | `const isAgency = document.projects.org_id === user.id` | A3 | `const isAgency = callerOrgIds.includes(document.projects.org_id)` |
| `app/api/documents/upload/route.ts` | 41 | `const isAgency = project.org_id === user.id` | A3 | `const isAgency = callerOrgIds.includes(project.org_id)` |
|  | 60 | `.eq('partnerships.vendor_org_id', user.id)` | A2 | `.in('partnerships.vendor_org_id', callerOrgIds)` |
|  | 74 | `.eq('partnerships.vendor_org_id', user.id)` | A2 | `.in('partnerships.vendor_org_id', callerOrgIds)` |
| `lib/partner-inbox-access.ts` | 22 | `const linkedById = inbox.vendor_org_id === userId` | A3 | `const linkedById = callerOrgIds.includes(inbox.vendor_org_id)` |
| `components/request-invitation-modal.tsx` | 43 | `vendor_org_id: user.id,` | A4 | `vendor_org_id: writeOrgId,` |
