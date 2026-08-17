# The 079 rename plan

**Document only. Nothing in this run renamed anything.** `main` builds and deploys against
today's database at every commit, and it must keep doing so until the rename and migration
079 ship together.

Written 2026-08-17. Companion to `supabase/migrations/079_organizations.sql`, which is
authored and not applied.

---

## The one thing to read before anything else

**The TypeScript compiler will not catch this rename.** The Supabase clients in this
codebase are constructed without generated `Database` types:

```ts
// lib/supabase/client.ts
return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)
// lib/supabase/server.ts
return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)
```

No `createClient<Database>`, no generated types file anywhere in the repository. So
`.eq("agency_id", user.id)` is a plain string argument, `row.agency_id` is a property on
`Record<string, unknown>` or on a hand-written local type, and `npx tsc --noEmit` exits 0
whether the column exists or not.

`docs/organizations-m1-discovery.md` section 7.1 says the rename is "a mechanical rename
that the TypeScript compiler verifies exhaustively - `npx tsc --noEmit` catches every miss."
**That is not true in this codebase.** It would be true with generated types. It is not true
today, and planning the rename on that assumption is how a missed call site reaches
production.

Everything else in this document follows from that. The safety net has to be built, not
assumed. Section 8 specifies it.

---

## Headline numbers

Measured 2026-08-17 by a script that walks `app/`, `lib/`, `components/`, `contexts/`,
`hooks/` and `middleware.ts`, matches `agency_id`, `partner_id`, `voucher_agency_id` and
`vouched_partner_id`, and resolves each hit to a table by, in order: an explicit
`table.column` qualification, a PostgREST embedded selector such as
`partnerships!inner(partner_id)`, or the nearest preceding `.from("...")` in the same file.

| | Count |
|---|---:|
| Source references to a renamed column | **707** |
| Files containing at least one | **103** |
| Resolve to `org_id` | 168 |
| Resolve to `lead_org_id` | 158 |
| Resolve to `vendor_org_id` | 207 |
| **Need a human read** | **174** |
| Database columns actually renamed | 30, across 23 tables |
| Service-role routes that bypass RLS entirely | 24 routes plus one `lib/` helper |
| Email-resolution sites that break under an org model | 11, ten of them silently |

The 174 that need a human read are not a failure of the census; they are the shape of the
problem. They break down as 46 comments, 46 with no `.from()` context at all (local type
declarations and destructured locals), and 82 whose nearest `.from()` resolves to a table
that carries neither column - which means the value came from a join or an embedded select
and the property name still has to change, because PostgREST returns the renamed key.

**None of the 174 is optional.** A comment that still says `partner_id` is how the next
person reintroduces the bug; a local type whose field is `partner_id` silently reads
`undefined` off a row that now carries `vendor_org_id`.

---

## The naming rule, and the table map

| Shape | Rule |
|---|---|
| Table carries exactly ONE company column | `agency_id` becomes `org_id` |
| Table carries TWO | `agency_id` becomes `lead_org_id`, `partner_id` becomes `vendor_org_id` |

Measured against the live database: `agency_id` exists on 21 tables, `partner_id` on 7, and
six tables carry both. `partner_vouches` carries `voucher_agency_id` and
`vouched_partner_id`, which is the same two-column shape under different names.

**`org_id` (15 tables)**
`agency_library_documents`, `bid_comparisons`, `bid_decompositions`, `bid_evaluations`,
`bid_scoring_criteria`, `bid_scoring_templates`, `client_cash_flow`, `clients`,
`delivery_reviews`, `msa_agreements`, `onboarding_deployments`, `onboarding_packages`,
`projects`, `rfp_magic_tokens`, `usage_tracking`

**`lead_org_id` + `vendor_org_id` (7 tables)**
`agency_partner_invitations`, `partner_access_requests`, `partner_rfp_inbox`,
`partner_rfp_response_versions`, `partner_rfp_responses`, `partnerships`, `partner_vouches`

**`vendor_org_id` only (1 table)**
`invitation_requests`. It carries `partner_id` and `agency_email`, so it has one company id
column and no `agency_id`. `org_id` there would not say which side, so it gets
`vendor_org_id`. Zero rows, one caller (`components/request-invitation-modal.tsx:41`).

**Tables that carry NEITHER and are therefore untouched by the rename**
`profiles`, `project_assignments`, `payment_milestones`, `partner_status_updates`,
`project_documents`, `project_messages`, `assignment_agreements`, `bid_evaluation_scores`,
`delivery_review_scores`, `onboarding_package_documents`, `notifications`,
`brief_interpretations`, `email_connections`, `contact_submissions`,
`partnership_profile_context`. They are scoped transitively through a parent and inherit the
organization model for free. That is roughly a third of the schema and it is the cheapest
part of the epic.

---

## The census

Grouped by the column each reference becomes. "Resolved via" records how the census
attributed the line to a table: `embed` is a PostgREST embedded selector such as
`partnerships!inner(partner_id)`, `qualified` is an explicit `table.column` string, and
`nearest .from()` is the last `.from("...")` seen above the line in the same file. The
third is a heuristic and it is wrong wherever a query joins across tables, which is why the
fourth group exists.

Section numbering: this is section 5. Sections 1 to 4 are the four blocks above.


### org_id  (168 references in 59 files)

| File | Lines | Old column | Resolved via |
|---|---|---|---|
| `app/api/agency/active-engagements/route.ts` | 98 | `agency_id` | nearest .from() |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 174, 204, 230 | `agency_id` | nearest .from() |
| `app/api/agency/bids/[responseId]/decompose/route.ts` | 74, 122, 168 | `agency_id` | nearest .from() |
| `app/api/agency/bids/[responseId]/evaluation/route.ts` | 83, 147 | `agency_id` | nearest .from() |
| `app/api/agency/bids/compare/route.ts` | 72, 91, 143, 150 | `agency_id` | nearest .from() |
| `app/api/agency/bids/rank/route.ts` | 117 | `agency_id` | nearest .from() |
| `app/api/agency/blob-download/route.ts` | 92, 96, 104, 108 | `agency_id` | nearest .from() |
| `app/api/agency/client-cash-flow/route.ts` | 23, 45, 46, 110, 118, 151, 181, 182 | `agency_id` | nearest .from() |
| `app/api/agency/clients/[id]/route.ts` | 24, 85 | `agency_id` | nearest .from() |
| `app/api/agency/clients/route.ts` | 34, 73, 91 | `agency_id` | nearest .from() |
| `app/api/agency/dashboard/route.ts` | 81, 96, 101 | `agency_id` | nearest .from() |
| `app/api/agency/delivery-reviews/route.ts` | 59, 74, 153, 219, 287 | `agency_id` | nearest .from() |
| `app/api/agency/library-documents/[id]/route.ts` | 31, 55 | `agency_id` | nearest .from() |
| `app/api/agency/library-documents/file/route.ts` | 21, 23 | `agency_id` | nearest .from() |
| `app/api/agency/library-documents/route.ts` | 99 | `agency_id` | nearest .from() |
| `app/api/agency/msa/ai-schedule/route.ts` | 102 | `agency_id` | nearest .from() |
| `app/api/agency/msa/milestones/route.ts` | 34, 56, 68, 296, 522, 611 | `agency_id` | nearest .from() |
| `app/api/agency/msa/milestones/route.ts` | 52 | `agency_id` | qualified |
| `app/api/agency/msa/route.ts` | 45, 169, 208, 237 | `agency_id` | nearest .from() |
| `app/api/agency/payment-synthesis/route.ts` | 88, 90, 99 | `agency_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/performance/route.ts` | 73, 86, 96 | `agency_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/route.ts` | 190, 216, 257 | `agency_id` | nearest .from() |
| `app/api/agency/pool/client-history/route.ts` | 33, 47, 62 | `agency_id` | nearest .from() |
| `app/api/agency/projects/[projectId]/status-updates/route.ts` | 30, 32, 120, 122, 232 | `agency_id` | nearest .from() |
| `app/api/agency/projects/duplicate/route.ts` | 52, 67, 77 | `agency_id` | nearest .from() |
| `app/api/agency/rfp-responses/[id]/route.ts` | 546, 560 | `agency_id` | nearest .from() |
| `app/api/agency/rfp-responses/route.ts` | 50 | `agency_id` | nearest .from() |
| `app/api/agency/rfp/magic-link/route.ts` | 138, 163, 189, 220, 230, 355, 377 | `agency_id` | nearest .from() |
| `app/api/agency/scoring/criteria/[id]/route.ts` | 20 | `agency_id` | nearest .from() |
| `app/api/agency/scoring/criteria/route.ts` | 19, 30, 45, 61, 67, 117, 131, 136 | `agency_id` | nearest .from() |
| `app/api/agency/scoring/templates/route.ts` | 46, 65, 79 | `agency_id` | nearest .from() |
| `app/api/agency/utilization/route.ts` | 126 | `agency_id` | nearest .from() |
| `app/api/documents/[id]/route.ts` | 45 | `agency_id` | embed |
| `app/api/documents/[id]/route.ts` | 59 | `agency_id` | qualified |
| `app/api/documents/upload/route.ts` | 32, 41 | `agency_id` | nearest .from() |
| `app/api/partner/dashboard/route.ts` | 191, 218, 308 | `agency_id` | nearest .from() |
| `app/api/partner/network/[agencyId]/route.ts` | 195 | `agency_id` | nearest .from() |
| `app/api/partner/onboarding-packages/route.ts` | 44 | `agency_id` | nearest .from() |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts` | 146, 169 | `agency_id` | nearest .from() |
| `app/api/partner/projects/[projectId]/status-update/route.ts` | 214, 217 | `agency_id` | nearest .from() |
| `app/api/partner/projects/route.ts` | 175, 210, 239 | `agency_id` | nearest .from() |
| `app/api/partner/rfps/bids/route.ts` | 149 | `agency_id` | nearest .from() |
| `app/api/partnerships/route.ts` | 113 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts` | 61, 70 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/assignments/route.ts` | 216 | `agency_id` | embed |
| `app/api/projects/[id]/assignments/route.ts` | 32, 36, 82, 86, 334 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/messages/route.ts` | 47, 156, 167 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/onboarding-packages/route.ts` | 29, 42, 109, 115, 279 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/onboarding-partners/route.ts` | 31, 34 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/onboarding/deploy/route.ts` | 51, 55, 99 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/route.ts` | 36, 99 | `agency_id` | nearest .from() |
| `app/api/projects/route.ts` | 142, 155, 328, 503, 516 | `agency_id` | nearest .from() |
| `app/api/rfp/guest/[token]/route.ts` | 525, 632, 648, 676 | `agency_id` | nearest .from() |
| `app/partner/projects/page.tsx` | 724 | `agency_id` | nearest .from() |
| `lib/bid-analysis-context.ts` | 84, 181 | `agency_id` | nearest .from() |
| `lib/clients-server.ts` | 74 | `agency_id` | nearest .from() |
| `lib/delivery-review.ts` | 39 | `agency_id` | nearest .from() |
| `lib/entitlements.ts` | 36 | `agency_id` | qualified |
| `lib/library-documents.ts` | 122, 136, 141, 181 | `agency_id` | nearest .from() |
| `lib/magic-token-attach.ts` | 315 | `agency_id` | nearest .from() |
| `lib/rfp-evaluation-criteria-server.ts` | 81 | `agency_id` | nearest .from() |
| `lib/usage-tracking.ts` | 67, 68, 80, 91, 97, 99, 153 | `agency_id` | nearest .from() |


### lead_org_id  (158 references in 51 files)

| File | Lines | Old column | Resolved via |
|---|---|---|---|
| `app/agency/pool/[partnerId]/page.tsx` | 237, 256, 260 | `voucher_agency_id` | nearest .from() |
| `app/agency/pool/page.tsx` | 648 | `agency_id` | nearest .from() |
| `app/api/agency/active-engagements/route.ts` | 332 | `agency_id` | nearest .from() |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 59 | `agency_id` | embed |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 35, 163 | `agency_id` | nearest .from() |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 60 | `agency_id` | qualified |
| `app/api/agency/bids/[responseId]/evaluation/route.ts` | 136 | `agency_id` | nearest .from() |
| `app/api/agency/bids/compare/route.ts` | 56 | `agency_id` | nearest .from() |
| `app/api/agency/bids/rank/route.ts` | 48 | `agency_id` | nearest .from() |
| `app/api/agency/blob-download/route.ts` | 68, 72, 79 | `agency_id` | nearest .from() |
| `app/api/agency/broadcast-rfp/resend-invite/route.ts` | 28, 31, 34, 78 | `agency_id` | nearest .from() |
| `app/api/agency/broadcast-rfp/route.ts` | 180, 205, 304, 321 | `agency_id` | nearest .from() |
| `app/api/agency/dashboard/route.ts` | 82, 86, 90 | `agency_id` | nearest .from() |
| `app/api/agency/delivery-reviews/route.ts` | 154, 172, 180 | `agency_id` | nearest .from() |
| `app/api/agency/email-scan/import/route.ts` | 67, 80, 109 | `agency_id` | nearest .from() |
| `app/api/agency/email-scan/run/route.ts` | 72, 83 | `agency_id` | nearest .from() |
| `app/api/agency/msa/ai-schedule/route.ts` | 128 | `agency_id` | nearest .from() |
| `app/api/agency/msa/milestones/route.ts` | 130, 158, 224, 271, 447, 468 | `agency_id` | nearest .from() |
| `app/api/agency/msa/route.ts` | 65, 160 | `agency_id` | nearest .from() |
| `app/api/agency/payment-synthesis/route.ts` | 131, 144, 187, 217 | `agency_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/notes/route.ts` | 51, 173 | `agency_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/performance/route.ts` | 50 | `agency_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/route.ts` | 49, 164 | `agency_id` | nearest .from() |
| `app/api/agency/rfp-responses/[id]/route.ts` | 49, 51, 156, 199, 218, 329, 383, 401, 432 | `agency_id` | nearest .from() |
| `app/api/agency/rfp-responses/route.ts` | 46, 86, 118, 205 | `agency_id` | nearest .from() |
| `app/api/agency/utilization/route.ts` | 98 | `agency_id` | nearest .from() |
| `app/api/marketplace/discoverable/route.ts` | 54, 55, 61 | `agency_id` | nearest .from() |
| `app/api/partner/dashboard/route.ts` | 59, 67, 95, 96 | `agency_id` | nearest .from() |
| `app/api/partner/network/[agencyId]/route.ts` | 64, 169, 187 | `agency_id` | nearest .from() |
| `app/api/partner/payments/route.ts` | 70, 85 | `agency_id` | nearest .from() |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts` | 200 | `agency_id` | nearest .from() |
| `app/api/partner/projects/route.ts` | 62, 75 | `agency_id` | nearest .from() |
| `app/api/partner/rfps/[id]/nda-notify/route.ts` | 29, 34 | `agency_id` | nearest .from() |
| `app/api/partner/rfps/[id]/response/route.ts` | 140, 271, 335, 360, 405, 409 | `agency_id` | nearest .from() |
| `app/api/partner/rfps/[id]/route.ts` | 84 | `agency_id` | nearest .from() |
| `app/api/partner/rfps/bids/route.ts` | 116 | `agency_id` | nearest .from() |
| `app/api/partner/rfps/route.ts` | 149, 203 | `agency_id` | nearest .from() |
| `app/api/partnerships/route.ts` | 74, 93, 242, 425, 526, 532, 637, 658, 678, 749, 951, 969 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/assignments/route.ts` | 215 | `agency_id` | embed |
| `app/api/projects/[id]/assignments/route.ts` | 98, 100 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/onboarding-packages/route.ts` | 145, 149, 184, 212 | `agency_id` | nearest .from() |
| `app/api/projects/[id]/onboarding-partners/route.ts` | 106, 122 | `agency_id` | nearest .from() |
| `app/api/projects/route.ts` | 183, 188, 299, 304 | `agency_id` | nearest .from() |
| `app/api/rfp/guest/[token]/route.ts` | 53, 64, 70, 80, 89, 131, 138 | `agency_id` | nearest .from() |
| `app/partner/marketplace/page.tsx` | 86, 112, 116, 129, 133 | `agency_id` | nearest .from() |
| `app/partner/network/page.tsx` | 448, 460, 493, 506, 522, 639 | `agency_id` | nearest .from() |
| `app/partner/profile/page.tsx` | 267, 273 | `agency_id` | nearest .from() |
| `lib/award-partnership-resolution.ts` | 47, 68, 110, 138, 171 | `agency_id` | nearest .from() |
| `lib/bid-analysis-context.ts` | 44, 56, 75, 159, 168 | `agency_id` | nearest .from() |
| `lib/bid-summary-generation.ts` | 85 | `agency_id` | nearest .from() |
| `lib/magic-token-attach.ts` | 105, 116 | `agency_id` | nearest .from() |
| `lib/partnership-invitations.ts` | 24, 34, 50 | `agency_id` | nearest .from() |
| `lib/rfp-evaluation-criteria-server.ts` | 63, 72 | `agency_id` | nearest .from() |
| `lib/server/partner-pool-import.ts` | 198, 284 | `agency_id` | nearest .from() |


### vendor_org_id  (207 references in 62 files)

| File | Lines | Old column | Resolved via |
|---|---|---|---|
| `app/agency/pool/[partnerId]/page.tsx` | 230, 238, 256, 260 | `vouched_partner_id` | nearest .from() |
| `app/agency/pool/page.tsx` | 646, 661 | `partner_id` | nearest .from() |
| `app/api/agency/active-engagements/route.ts` | 327, 334 | `partner_id` | nearest .from() |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 59 | `partner_id` | embed |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 36, 161 | `partner_id` | nearest .from() |
| `app/api/agency/bids/[responseId]/ai-score/route.ts` | 61 | `partner_id` | qualified |
| `app/api/agency/blob-download/route.ts` | 81 | `partner_id` | nearest .from() |
| `app/api/agency/broadcast-rfp/resend-invite/route.ts` | 28, 35, 95 | `partner_id` | nearest .from() |
| `app/api/agency/broadcast-rfp/route.ts` | 181, 206, 305, 322 | `partner_id` | nearest .from() |
| `app/api/agency/dashboard/route.ts` | 82, 85, 89 | `partner_id` | nearest .from() |
| `app/api/agency/email-scan/import/route.ts` | 66, 68, 73, 79, 97, 110 | `partner_id` | nearest .from() |
| `app/api/agency/email-scan/run/route.ts` | 71, 75, 82, 84, 86 | `partner_id` | nearest .from() |
| `app/api/agency/msa/ai-schedule/route.ts` | 113 | `partner_id` | nearest .from() |
| `app/api/agency/msa/milestones/route.ts` | 223, 230 | `partner_id` | nearest .from() |
| `app/api/agency/msa/route.ts` | 64, 77, 84 | `partner_id` | nearest .from() |
| `app/api/agency/payment-synthesis/route.ts` | 186, 189 | `partner_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/notes/route.ts` | 52 | `partner_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/performance/route.ts` | 51 | `partner_id` | nearest .from() |
| `app/api/agency/pool/[partnerId]/route.ts` | 50, 165 | `partner_id` | nearest .from() |
| `app/api/agency/projects/[projectId]/status-updates/route.ts` | 171, 175 | `partner_id` | nearest .from() |
| `app/api/agency/rfp-responses/[id]/route.ts` | 49, 144, 154, 198, 250, 277, 327, 330, 332, 441, 654 | `partner_id` | nearest .from() |
| `app/api/agency/rfp-responses/route.ts` | 84, 203, 221 | `partner_id` | nearest .from() |
| `app/api/documents/[id]/route.ts` | 48 | `partner_id` | embed |
| `app/api/documents/upload/route.ts` | 57, 72 | `partner_id` | embed |
| `app/api/documents/upload/route.ts` | 60, 74 | `partner_id` | qualified |
| `app/api/marketplace/discoverable/route.ts` | 54, 55, 61 | `partner_id` | nearest .from() |
| `app/api/marketplace/discoverable/route.ts` | 82, 83, 85 | `vouched_partner_id` | nearest .from() |
| `app/api/partner/blob-download/route.ts` | 49 | `partner_id` | nearest .from() |
| `app/api/partner/dashboard/route.ts` | 64, 67 | `partner_id` | nearest .from() |
| `app/api/partner/network/[agencyId]/route.ts` | 63, 168 | `partner_id` | nearest .from() |
| `app/api/partner/onboarding-packages/[id]/route.ts` | 40, 44 | `partner_id` | nearest .from() |
| `app/api/partner/onboarding-packages/route.ts` | 20 | `partner_id` | nearest .from() |
| `app/api/partner/onboarding/file/route.ts` | 55, 59 | `partner_id` | nearest .from() |
| `app/api/partner/partnerships/claim/route.ts` | 41, 42 | `partner_id` | nearest .from() |
| `app/api/partner/payments/route.ts` | 71 | `partner_id` | nearest .from() |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts` | 119 | `partner_id` | embed |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts` | 92, 193, 198 | `partner_id` | nearest .from() |
| `app/api/partner/projects/[projectId]/status-update/route.ts` | 75, 126 | `partner_id` | nearest .from() |
| `app/api/partner/projects/route.ts` | 63, 97 | `partner_id` | nearest .from() |
| `app/api/partner/projects/route.ts` | 48 | `partner_id` | qualified |
| `app/api/partner/rate-info/route.ts` | 123, 127 | `partner_id` | nearest .from() |
| `app/api/partner/rfp-bid/upload/route.ts` | 65, 75 | `partner_id` | nearest .from() |
| `app/api/partner/rfps/[id]/intent/route.ts` | 26, 40, 61 | `partner_id` | nearest .from() |
| `app/api/partner/rfps/[id]/nda-notify/route.ts` | 29, 35, 47 | `partner_id` | nearest .from() |
| `app/api/partner/rfps/[id]/response/route.ts` | 140, 150, 270, 279, 334 | `partner_id` | nearest .from() |
| `app/api/partner/rfps/[id]/route.ts` | 33, 68, 112 | `partner_id` | nearest .from() |
| `app/api/partner/rfps/bids/route.ts` | 117 | `partner_id` | nearest .from() |
| `app/api/partner/rfps/bids/route.ts` | 19 | `partner_id` | qualified |
| `app/api/partner/rfps/claim/route.ts` | 32, 49, 64 | `partner_id` | nearest .from() |
| `app/api/partner/summary/route.ts` | 34, 45, 53 | `partner_id` | nearest .from() |
| `app/api/partnerships/route.ts` | 100, 106, 194, 206, 220, 224, 424, 428, 524, 527, 538, 540, 637, 659, 701, 755, 951 | `partner_id` | nearest .from() |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts` | 42 | `partner_id` | embed |
| `app/api/projects/[id]/assignments/route.ts` | 215 | `partner_id` | embed |
| `app/api/projects/[id]/assignments/route.ts` | 98, 107 | `partner_id` | nearest .from() |
| `app/api/projects/[id]/messages/route.ts` | 66, 76, 176, 187, 197, 208 | `partner_id` | embed |
| `app/api/projects/[id]/messages/route.ts` | 68, 79, 199, 211 | `partner_id` | qualified |
| `app/api/projects/[id]/onboarding-packages/route.ts` | 145, 152, 180, 207, 213 | `partner_id` | nearest .from() |
| `app/api/projects/[id]/onboarding-partners/route.ts` | 102, 117, 123 | `partner_id` | nearest .from() |
| `app/api/projects/[id]/partner/route.ts` | 40 | `partner_id` | nearest .from() |
| `app/api/projects/route.ts` | 367 | `partner_id` | nearest .from() |
| `app/api/rfp/guest/[token]/route.ts` | 52, 54, 59, 62, 63, 69, 75, 81, 87, 92, 139 | `partner_id` | nearest .from() |
| `app/auth/callback/route.ts` | 91, 92 | `partner_id` | nearest .from() |
| `app/partner/marketplace/page.tsx` | 86, 128 | `partner_id` | nearest .from() |
| `app/partner/network/page.tsx` | 449, 505 | `partner_id` | nearest .from() |
| `app/partner/profile/page.tsx` | 268 | `partner_id` | nearest .from() |
| `app/partner/profile/page.tsx` | 212 | `vouched_partner_id` | nearest .from() |
| `components/request-invitation-modal.tsx` | 43 | `partner_id` | nearest .from() |
| `lib/award-partnership-resolution.ts` | 48, 57, 61, 63, 67, 81, 83, 109, 121, 139, 161, 166, 172 | `partner_id` | nearest .from() |
| `lib/magic-token-attach.ts` | 248, 257, 381 | `partner_id` | nearest .from() |
| `lib/magic-token-attach.ts` | 29 | `partner_id` | qualified |
| `lib/partnership-award-claim.ts` | 30, 46, 48 | `partner_id` | nearest .from() |
| `lib/partnership-invitations.ts` | 25, 51 | `partner_id` | nearest .from() |
| `lib/server/partner-pool-import.ts` | 197, 208, 285 | `partner_id` | nearest .from() |


### Needs a human read  (174 references in 56 files)


**comment** - 46

| File:line | Column | Nearest table | Source line |
|---|---|---|---|
| `app/agency/bids/page.tsx:582` | `partner_id` | - | `// Group by partner_id when present, not partner_display_name: a guest/magic-link bid` |
| `app/agency/bids/page.tsx:585` | `partner_id` | - | `// separate group. partner_id is the stable identity; display_name is cosmetic only.` |
| `app/api/agency/blob-download/route.ts:22` | `agency_id` | - | `* Auth: agency user must own the related partner_rfp_inbox row (agency_id = auth.uid()).` |
| `app/api/agency/dashboard/route.ts:166` | `partner_id` | `onboarding_packages` | `// Partner display names - resolved once for every partner_id referenced anywhere` |
| `app/api/agency/dashboard/route.ts:361` | `agency_id` | `profiles` | `// carries agency_id directly regardless of whether the bid came through the portal or` |
| `app/api/agency/email-scan/import/route.ts:33` | `partner_id` | `profiles` | `* Adds one contact to the agency's pool as a Discovered row - check by partner_id then` |
| `app/api/agency/email-scan/run/route.ts:42` | `partner_id` | - | `*  the partner_id-then-partner_email lookup pattern in classifyGuestVendorForPool` |
| `app/api/agency/rfp-responses/[id]/route.ts:310` | `partner_id` | `rfp_magic_tokens` | `// H3: partner_id was captured once at guest-submission time from an email->profile` |
| `app/api/agency/rfp-responses/[id]/route.ts:313` | `partner_id` | `rfp_magic_tokens` | `// as a "pure guest" here otherwise, producing a partner_id-null partnership that` |
| `app/api/agency/rfp-responses/route.ts:38` | `agency_id` | `profiles` | `// RLS: policy "Agencies select RFP responses they own" ... USING (agency_id = auth.uid())` (quote elided: the source line carries an em dash) |
| `app/api/marketplace/discoverable/route.ts:51` | `partner_id` | `profiles` | `// partner_id/agency_id/status, never expose full list to either party.` |
| `app/api/marketplace/discoverable/route.ts:51` | `agency_id` | `profiles` | `// partner_id/agency_id/status, never expose full list to either party.` |
| `app/api/partner/network/[agencyId]/route.ts:53` | `partner_id` | `profiles` | `// lib/partnership-state.ts. Keyed to partner_id = the caller, so this can only ever be the` |
| `app/api/partner/network/[agencyId]/route.ts:56` | `partner_id` | `profiles` | `// An unclaimed row (partner_id IS NULL, matched only by partner_email) deliberately does` |
| `app/api/partner/network/[agencyId]/route.ts:58` | `partner_id` | `profiles` | `// partnerships" requires p.partner_id = auth.uid(), so an unclaimed row grants no read` |
| `app/api/partner/network/[agencyId]/route.ts:161` | `partner_id` | `profiles` | `// Shared work, half one: awarded bids. Keyed to partner_id = the caller AND` |
| `app/api/partner/network/[agencyId]/route.ts:162` | `agency_id` | `profiles` | `// agency_id = this agency, so no other vendor's bid and no other agency's award can` |
| `app/api/partner/network/[agencyId]/route.ts:226` | `partner_id` | `projects` | `// partner_id = the caller. This is the compliance state of THIS relationship. NDA and` |
| `app/api/partner/projects/route.ts:49` | `partner_id` | `profiles` | `// - an awarded-but-still-partner_id-null ghost partnership (H2's pure-guest branch,` |
| `app/api/partner/rfps/bids/route.ts:20` | `partner_id` | - | `*  response whose partner_id is still null - independent of GET /api/partner/rfps's own` |
| `app/api/partner/rfps/bids/route.ts:113` | `partner_id` | `profiles` | `// RLS: "Partners select own RFP responses" - USING (partner_id = auth.uid())` |
| `app/api/partner/rfps/route.ts:126` | `partner_id` | `profiles` | `// guest branch) leaves its partnerships row partner_id-null forever otherwise - nothing` |
| `app/api/partner/rfps/route.ts:134` | `partner_id` | `profiles` | `// RLS applies: partner sees rows where partner_id = auth.uid() OR recipient_email matches profile email` |
| `app/api/partnerships/route.ts:63` | `agency_id` | `profiles` | `// Agency sees rows where they are agency_id (not partner_id). 'removed' rows are` |
| `app/api/partnerships/route.ts:63` | `partner_id` | `profiles` | `// Agency sees rows where they are agency_id (not partner_id). 'removed' rows are` |
| `app/api/partnerships/route.ts:173` | `partner_id` | `profiles` | `// Partner sees agencies that invited them (by partner_id OR by email)` |
| `app/api/partnerships/route.ts:190` | `partner_id` | `profiles` | `// Get partnerships by partner_id` |
| `app/api/partnerships/route.ts:421` | `partner_id` | `profiles` | `// Check if partnership already exists (by partner_id or partner_email)` |
| `app/api/partnerships/route.ts:472` | `partner_id` | `profiles` | `// Check if partner has an account (existing.partner_id is set from previous invitation)` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:109` | `agency_id` | `profiles` | `// counterpartUserId was picked from projectRow.agency_id or partnership.partner_id` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:109` | `partner_id` | `profiles` | `// counterpartUserId was picked from projectRow.agency_id or partnership.partner_id` |
| `app/api/rfp/guest/[token]/route.ts:483` | `partner_id` | `profiles` | `// same group as every other bid tied to partner_id - not a separate group keyed off` |
| `components/new-client-dialog.tsx:35` | `agency_id` | - | `* index on (agency_id, lower(name)) is deliberately not UNIQUE for the same reason.` |
| `lib/award-partnership-resolution.ts:10` | `partner_id` | - | `*   b. An active partnership already matching the bid's partner_id.` |
| `lib/award-partnership-resolution.ts:11` | `partner_id` | - | `*   c. Any other partnership row matching partner_id OR the vendor's email (a ghost/` |
| `lib/award-partnership-resolution.ts:18` | `partner_id` | - | `*      partner_id-null row as "Active" regardless of status - a pure guest's row stays` |
| `lib/award-partnership-resolution.ts:42` | `partner_id` | - | `// b. Active partnership matching partner_id.` |
| `lib/magic-token-attach.ts:24` | `agency_id` | - | `*  (agency_id, project_id, vendor_email) without touching created_at. */` |
| `lib/partner-inbox-access.ts:8` | `partner_id` | - | `* 1) linked by partner_id, OR` |
| `lib/partnership-award-claim.ts:5` | `partner_id` | - | `* that is still partner_id-null AND already has a real project_assignments row against it -` |
| `lib/partnership-award-claim.ts:16` | `partner_id` | - | `* created with partner_id null.` |
| `lib/partnership-state.ts:5` | `partner_id` | - | `*  - the pool's Active column filtered on `partner_id` being populated` |
| `lib/partnership-state.ts:10` | `partner_id` | - | `* `status` is the relationship fact and the only source of truth for it. `partner_id` is an` |
| `lib/partnership-state.ts:54` | `partner_id` | - | `* The relationship is live. This is the ONLY test for "active" - never `partner_id`, and` |
| `lib/server/partner-pool-import.ts:254` | `partner_id` | `profiles` | `// (and partner_id) never change here. Activation only happens via invite -> accept.` |
| `lib/usage-tracking.ts:10` | `agency_id` | - | `* seat - `usage_tracking` is keyed on `agency_id`, one row per agency per month, and` |

**no_context** - 46

| File:line | Column | Nearest table | Source line |
|---|---|---|---|
| `app/agency/bids/page.tsx:209` | `partner_id` | - | `{!row.partner_id && row.response_exists && (` |
| `app/agency/bids/page.tsx:586` | `partner_id` | - | `const key = groupBy === "client" ? r.client_name!.trim() : r.partner_id \|\| r.partner_display_name \|\| "Unkn` |
| `app/agency/page.tsx:91` | `partner_id` | - | `partner_id: string \| null` |
| `app/agency/pool/page.tsx:448` | `partner_id` | - | `partnerId: (p.partner as { id?: string } \| undefined)?.id \|\| (p.partner_id as string \| undefined) \|\| und` |
| `app/api/agency/active-engagements/route.ts:24` | `partner_id` | - | `partner_id: string` |
| `app/api/agency/active-engagements/route.ts:62` | `partner_id` | - | `if (r.partner_id !== partnerId) return false` |
| `app/api/documents/[id]/route.ts:9` | `partner_id` | - | `type PartnershipRef = { partner_id?: string \| null }` |
| `app/api/documents/[id]/route.ts:22` | `partner_id` | - | `if (p.partner_id === userId) return true` |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts:24` | `partner_id` | - | `partner_id: string` |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts:57` | `partner_id` | - | `if (r.partner_id !== partnerId) return false` |
| `app/api/partner/rfps/claim/route.ts:6` | `partner_id` | - | `partner_id: string \| null` |
| `app/partner/marketplace/page.tsx:31` | `agency_id` | - | `agency_id: string` |
| `app/partner/marketplace/page.tsx:68` | `agency_id` | - | `setRequests([{ agency_id: "demo-agency-2", status: "pending" }])` |
| `app/partner/network/page.tsx:32` | `agency_id` | - | `agency_id: string` |
| `app/partner/network/page.tsx:33` | `partner_id` | - | `partner_id: string \| null` |
| `app/partner/network/page.tsx:78` | `agency_id` | - | `agency_id: string` |
| `app/partner/network/page.tsx:129` | `agency_id` | - | `agency_id: "demo-agency-1",` |
| `app/partner/network/page.tsx:130` | `partner_id` | - | `partner_id: "demo-partner-1",` |
| `app/partner/network/page.tsx:144` | `agency_id` | - | `agency_id: "demo-agency-2",` |
| `app/partner/network/page.tsx:145` | `partner_id` | - | `partner_id: "demo-partner-1",` |
| `app/partner/payments/page.tsx:47` | `agency_id` | - | `agency_id: string \| null` |
| `app/partner/payments/page.tsx:63` | `agency_id` | - | `agency_id: string` |
| `app/partner/payments/page.tsx:95` | `agency_id` | - | `agency_id: "demo-agency-1",` |
| `app/partner/payments/page.tsx:106` | `agency_id` | - | `agency_id: "demo-agency-1",` |
| `app/partner/payments/page.tsx:181` | `agency_id` | - | `{ id: "demo-p1", agency_id: "demo-agency-1", status: "active", agency: { company_name: "Tandem Social" } },` |
| `app/partner/payments/page.tsx:182` | `agency_id` | - | `{ id: "demo-p2", agency_id: "demo-agency-2", status: "active", agency: { company_name: "North Star Media" } },` |
| `app/partner/payments/page.tsx:372` | `agency_id` | - | `agency_id: p.agency_id != null ? String(p.agency_id) : null,` |
| `app/partner/projects/page.tsx:30` | `agency_id` | - | `agency_id: string \| null` |
| `app/partner/rfps/[id]/page.tsx:122` | `agency_id` | - | `agency_id: string` |
| `app/partner/rfps/[id]/page.tsx:486` | `agency_id` | - | `agency_id: "demo",` |
| `app/partner/rfps/[id]/page.tsx:697` | `agency_id` | - | `agency_id: "",` |
| `components/bid-detail-sheet.tsx:151` | `partner_id` | - | `const isGuest = !row.partner_id && row.response_exists` |
| `components/bid-detail-sheet.tsx:900` | `partner_id` | - | `{canMutate && <BidEvaluationTab ref={evaluationTabRef} responseId={row.id} partnerId={row.partner_id ?? null} ` |
| `components/marketplace-content.tsx:118` | `partner_id` | - | `((partnershipsPayload?.partnerships \|\| []) as Array<{ partner_id?: string; partner?: { id?: string } }>)` |
| `components/marketplace-content.tsx:119` | `partner_id` | - | `.map((p) => p.partner_id \|\| p.partner?.id)` |
| `contexts/lead-agency-filter-context.tsx:84` | `agency_id` | - | `agencyId: p.agency?.id \|\| p.agency_id,` |
| `lib/bid-shared.ts:20` | `partner_id` | - | `partner_id?: string \| null` |
| `lib/magic-token-attach.ts:10` | `agency_id` | - | `agency_id: string` |
| `lib/magic-token-attach.ts:39` | `agency_id` | - | `"token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_` |
| `lib/magic-token-attach.ts:41` | `agency_id` | - | `"token, agency_id, project_id, vendor_email, scope_item_id, scope_item_name, scope_item_description, business_` |
| `lib/magic-token-attach.ts:64` | `partner_id` | - | `type ExistingResponse = { id: string; partner_id: string \| null; inbox_item_id: string \| null; status: strin` |
| `lib/magic-token-attach.ts:70` | `partner_id` | - | `"partner_id",` |
| `lib/partner-inbox-access.ts:14` | `partner_id` | - | `partner_id: string \| null` |
| `lib/partner-inbox-access.ts:22` | `partner_id` | - | `const linkedById = inbox.partner_id === userId` |
| `lib/server/partner-pool-import.ts:66` | `partner_id` | - | `partner_id: string \| null` |
| `lib/usage-tracking.ts:47` | `agency_id` | - | `agency_id: string` |

**wrong_table** - 82

| File:line | Column | Nearest table | Source line |
|---|---|---|---|
| `app/api/agency/active-engagements/route.ts:163` | `partner_id` | `project_assignments` | `partner_id,` |
| `app/api/agency/active-engagements/route.ts:306` | `partner_id` | `partner_status_updates` | `\| { partner_id?: string }` |
| `app/api/agency/active-engagements/route.ts:307` | `partner_id` | `partner_status_updates` | `\| { partner_id?: string }[]` |
| `app/api/agency/active-engagements/route.ts:310` | `partner_id` | `partner_status_updates` | `return pship?.partner_id` |
| `app/api/agency/active-engagements/route.ts:435` | `partner_id` | `onboarding_packages` | `partner_id: string` |
| `app/api/agency/active-engagements/route.ts:444` | `partner_id` | `onboarding_packages` | `const partnerId = pship?.partner_id` |
| `app/api/agency/bids/[responseId]/ai-score/route.ts:233` | `partner_id` | `bid_decompositions` | `const trackRecord = await loadVendorTrackRecord(supabase, user.id, (response.partner_id as string) \|\| null, ` |
| `app/api/agency/dashboard/route.ts:170` | `partner_id` | `onboarding_packages` | `for (const row of partnerships) if (row.partner_id) partnerIds.add(row.partner_id as string)` |
| `app/api/agency/dashboard/route.ts:171` | `partner_id` | `onboarding_packages` | `for (const row of inboxRows) if (row.partner_id) partnerIds.add(row.partner_id as string)` |
| `app/api/agency/dashboard/route.ts:185` | `partner_id` | `profiles` | `const byId = partnership.partner_id ? partnerNameById.get(partnership.partner_id as string) : null` |
| `app/api/agency/dashboard/route.ts:219` | `partner_id` | `profiles` | `const hasRecipient = Boolean(row.partner_id \|\| row.recipient_email)` |
| `app/api/agency/dashboard/route.ts:396` | `partner_id` | `profiles` | `const partnerName = row.partner_id ? partnerNameById.get(row.partner_id as string) : null` |
| `app/api/agency/msa/ai-schedule/route.ts:148` | `agency_id` | `payment_milestones` | `.eq("agency_id", user.id)` |
| `app/api/agency/msa/ai-schedule/route.ts:154` | `partner_id` | `profiles` | `.eq("id", resp.partner_id as string)` |
| `app/api/agency/msa/milestones/route.ts:254` | `partner_id` | `profiles` | `const partnerId = row.partner_id != null ? String(row.partner_id) : null` |
| `app/api/agency/msa/route.ts:60` | `partner_id` | `msa_agreements` | `const shipById = new Map<string, { partner_id: string \| null }>()` |
| `app/api/agency/msa/route.ts:119` | `partner_id` | `profiles` | `ship?.partner_id != null && ship.partner_id !== "" ? profById.get(ship.partner_id) : undefined` |
| `app/api/agency/payment-synthesis/route.ts:205` | `partner_id` | `profiles` | `const partnerId = (row.partner_id as string \| null) \|\| null` |
| `app/api/agency/projects/[projectId]/status-updates/route.ts:182` | `agency_id` | `profiles` | `.eq("id", project.agency_id)` |
| `app/api/agency/rfp-responses/[id]/route.ts:425` | `partner_id` | `profiles` | `.eq("id", existing.partner_id)` |
| `app/api/agency/rfp-responses/[id]/route.ts:574` | `partner_id` | `profiles` | `.eq("id", existing.partner_id)` |
| `app/api/agency/rfp-responses/[id]/route.ts:580` | `partner_id` | `profiles` | `partnerId: existing.partner_id,` |
| `app/api/agency/rfp-responses/[id]/route.ts:622` | `partner_id` | `profiles` | `if (existing.partner_id) {` |
| `app/api/agency/rfp-responses/[id]/route.ts:624` | `partner_id` | `profiles` | `await notifyProjectAwarded(supabase, existing.partner_id, projectName, leadAgencyName, awardContext.projectId)` |
| `app/api/agency/rfp-responses/[id]/route.ts:639` | `partner_id` | `profiles` | `supabase.from("profiles").select("email, full_name, company_name").eq("id", existing.partner_id).maybeSingle()` |
| `app/api/agency/rfp-responses/route.ts:277` | `partner_id` | `projects` | `const pid = inboxRow ? (inboxRow as Record<string,unknown>).partner_id as string \| null : null` |
| `app/api/agency/rfp-responses/route.ts:279` | `partner_id` | `projects` | `const displayName = pr?.company_name \|\| pr?.full_name \|\| pr?.email \|\| (r.partner_id ? profileById[r.part` |
| `app/api/agency/rfp-responses/route.ts:441` | `partner_id` | `bid_evaluations` | `const pid = (i.partner_id as string \| null) \|\| null` |
| `app/api/partner/onboarding-packages/route.ts:100` | `agency_id` | `onboarding_package_documents` | `agency: agencyMap[p.agency_id as string] \|\| null,` |
| `app/api/partner/payments/route.ts:229` | `agency_id` | `payment_milestones` | `const aid = row.agency_id as string` |
| `app/api/partner/payments/route.ts:233` | `agency_id` | `payment_milestones` | `agency_id: aid,` |
| `app/api/partner/projects/[projectId]/status-update/route.ts:221` | `agency_id` | `profiles` | `.eq("id", project.agency_id)` |
| `app/api/partner/rfps/[id]/nda-notify/route.ts:68` | `agency_id` | `profiles` | `supabase.from("profiles").select("email, company_name, full_name").eq("id", inbox.agency_id).maybeSingle(),` |
| `app/api/partner/rfps/[id]/response/route.ts:372` | `agency_id` | `profiles` | `supabase.from("profiles").select("email, company_name, full_name").eq("id", inbox.agency_id).maybeSingle(),` |
| `app/api/partner/rfps/[id]/route.ts:88` | `agency_id` | `profiles` | `.eq("id", inboxWithViewed.agency_id)` |
| `app/api/partner/rfps/bids/route.ts:163` | `agency_id` | `profiles` | `const agency = agencyById[r.agency_id as string]` |
| `app/api/partnerships/route.ts:277` | `agency_id` | `profiles` | `agency: agencyProfiles[p.agency_id as string] \|\| null,` |
| `app/api/partnerships/route.ts:473` | `partner_id` | `profiles` | `const existingPartnerId = existing.partner_id` |
| `app/api/partnerships/route.ts:705` | `partner_id` | `profiles` | `.eq('id', partnership.partner_id)` |
| `app/api/partnerships/route.ts:759` | `partner_id` | `profiles` | `.eq('id', partnership.partner_id)` |
| `app/api/partnerships/route.ts:819` | `agency_id` | `profiles` | `await notifyPartnershipAccepted(supabase, partnership.agency_id, partnerName, partnershipId)` |
| `app/api/partnerships/route.ts:824` | `agency_id` | `profiles` | `.eq('id', partnership.agency_id)` |
| `app/api/partnerships/route.ts:868` | `agency_id` | `profiles` | `await notifyPartnershipDeclined(supabase, partnership.agency_id, partnerName, partnershipId)` |
| `app/api/partnerships/route.ts:875` | `agency_id` | `profiles` | `.eq('id', partnership.agency_id)` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:51` | `partner_id` | `project_assignments` | `const partnership = pa.partnership as unknown as { partner_id: string \| null } \| null` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:69` | `partner_id` | `projects` | `const isPartner = acting === 'partner' && partnership?.partner_id === user.id` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:95` | `agency_id` | `assignment_agreements` | `const counterpartUserId = isPartner ? projectRow?.agency_id \|\| null : partnership?.partner_id \|\| null` |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:95` | `partner_id` | `assignment_agreements` | `const counterpartUserId = isPartner ? projectRow?.agency_id \|\| null : partnership?.partner_id \|\| null` |
| `app/api/projects/[id]/assignments/route.ts:164` | `partner_id` | `profiles` | `partnership.partner_id,` |
| `app/api/projects/[id]/assignments/route.ts:226` | `agency_id` | `project_assignments` | `const isAgency = assignment.project.agency_id === user.id` |
| `app/api/projects/[id]/assignments/route.ts:227` | `partner_id` | `project_assignments` | `const isPartner = assignment.partnership.partner_id === user.id` |
| `app/api/projects/[id]/assignments/route.ts:261` | `agency_id` | `profiles` | `assignment.partnership.agency_id,` |
| `app/api/projects/[id]/assignments/route.ts:271` | `agency_id` | `profiles` | `.eq('id', assignment.partnership.agency_id)` |
| `app/api/projects/[id]/assignments/route.ts:345` | `partner_id` | `projects` | `if (status === 'awarded' && assignment.partnership.partner_id) {` |
| `app/api/projects/[id]/assignments/route.ts:357` | `partner_id` | `profiles` | `assignment.partnership.partner_id,` |
| `app/api/projects/[id]/assignments/route.ts:366` | `partner_id` | `profiles` | `.eq('id', assignment.partnership.partner_id)` |
| `app/api/projects/[id]/messages/route.ts:153` | `agency_id` | `profiles` | `let projectMeta: { title: string \| null; agency_id: string \| null } \| null = null` |
| `app/api/projects/[id]/messages/route.ts:183` | `partner_id` | `project_assignments` | `counterpartUserId = (assignOnProject.partnerships as { partner_id?: string } \| null)?.partner_id \|\| null` |
| `app/api/projects/[id]/messages/route.ts:192` | `partner_id` | `project_assignments` | `counterpartUserId = (anyAssign?.partnerships as { partner_id?: string } \| null)?.partner_id \|\| null` |
| `app/api/projects/[id]/messages/route.ts:217` | `agency_id` | `project_assignments` | `counterpartUserId = projectMeta?.agency_id \|\| null` |
| `app/api/projects/[id]/onboarding-packages/route.ts:317` | `partner_id` | `profiles` | `.eq("id", partnership.partner_id)` |
| `app/api/projects/[id]/onboarding-packages/route.ts:324` | `partner_id` | `profiles` | `partnerId: partnership.partner_id,` |
| `app/api/projects/[id]/onboarding-packages/route.ts:369` | `partner_id` | `profiles` | `userId: partnership.partner_id,` |
| `app/api/projects/[id]/onboarding/deploy/route.ts:65` | `partner_id` | `project_assignments` | `partner_id,` |
| `app/api/projects/[id]/onboarding/deploy/route.ts:78` | `partner_id` | `project_assignments` | `\| { partner_id: string \| null; partner: { id: string; email: string \| null; full_name: string \| null; comp` |
| `app/api/projects/[id]/onboarding/deploy/route.ts:82` | `partner_id` | `project_assignments` | `const partnerId = partnership?.partner_id \|\| partner?.id` |
| `app/api/projects/[id]/partner/route.ts:64` | `agency_id` | `project_assignments` | `agency_id` |
| `app/api/projects/[id]/partner/route.ts:79` | `agency_id` | `project_assignments` | `agency_id: string` |
| `app/api/projects/[id]/partner/route.ts:92` | `agency_id` | `profiles` | `.eq('id', project.agency_id)` |
| `app/api/rfp/guest/[token]/route.ts:222` | `agency_id` | `profiles` | `.eq("id", tokenRow.agency_id)` |
| `app/api/rfp/guest/[token]/route.ts:246` | `agency_id` | `profiles` | `.eq("id", tokenRow.agency_id)` |
| `app/api/rfp/guest/[token]/route.ts:541` | `agency_id` | `profiles` | `.eq("id", tokenRow.agency_id)` |
| `app/api/rfp/guest/[token]/route.ts:573` | `agency_id` | `profiles` | `agencyId: tokenRow.agency_id,` |
| `app/api/rfp/guest/[token]/route.ts:579` | `agency_id` | `profiles` | `tokenRow.agency_id as string,` |
| `app/api/rfp/guest/[token]/route.ts:597` | `agency_id` | `profiles` | `agency_id: tokenRow.agency_id,` |
| `app/api/rfp/guest/[token]/route.ts:598` | `partner_id` | `profiles` | `partner_id: is_existing_partner ? matchedProfile!.id : null,` |
| `app/api/rfp/guest/[token]/route.ts:703` | `agency_id` | `profiles` | `.eq("id", tokenRow.agency_id)` |
| `app/api/rfp/guest/[token]/route.ts:753` | `agency_id` | `profiles` | `agencyId: tokenRow.agency_id,` |
| `app/api/rfp/guest/[token]/route.ts:758` | `agency_id` | `profiles` | `await notifyBidSubmitted(supabase, tokenRow.agency_id as string, submissionVendorName, submissionScopeItemName` |
| `app/partner/profile/page.tsx:293` | `agency_id` | `profiles` | `agency_name: agencyNameById[String(row.agency_id \|\| "")] \|\| "Lead Agency",` |
| `lib/magic-token-attach.ts:286` | `agency_id` | `profiles` | `.eq("id", tokenRow.agency_id)` |
| `lib/magic-token-attach.ts:316` | `partner_id` | `projects` | `partner_id: partnerId,` |

---

## 6. The 24 service-role routes, and what each needs

These routes construct a client with `SUPABASE_SERVICE_ROLE_KEY`. That client bypasses row
level security completely, so **the policy rewrite in 079 does not protect any of them**.
The only thing between a request and the whole table is the hand-written check in the file.

Every one of them is correct today by an accident 079 removes: `agency_id = <session uid>`
is simultaneously the ownership check and, coincidentally, the membership check, because one
user is one company. The moment a company has two members, `= <session uid>` stops meaning
"my company's rows" and starts meaning "the founder's rows", and a colleague sees nothing.
Where the route WRITES, the same expression stops being an authorization check at all.

The membership check each one needs is the same shape everywhere: resolve the caller to a
set of organization ids, then scope with `.in("org_id", callerOrgIds)` for reads and assert
membership before writes. That resolution belongs in one place. **Add
`resolveCallerOrgIds()` to `lib/entitlements.ts` next to `agencyEntitlementId()`, which was
put there in the pre-work run for exactly this seam.**

| # | Route | Trust model today | What it needs after 079 |
|---|---|---|---|
| 1 | `app/api/admin/users/route.ts` | `requireAdminRole()`, then selects an allow-listed column set for 500 profiles | **Unchanged.** Platform admin, not organization scope. Blast radius grows with every seat, which is a reason to keep the column allow-list tight, not a reason to add membership |
| 2 | `app/api/admin/users/[userId]/flags/route.ts` | `requireAdminRole()`, service-role write of three allow-listed booleans | **Unchanged in mechanism**, but this is where entitlement stops being per-user. Once `organizations` carries entitlement, this route writes the wrong row. See item 4b of this run |
| 3 | `app/api/admin/grant-access/route.ts` | Signed token verified before the session; `requireAdminRole()` after | **Unchanged.** Same entitlement caveat as 2 |
| 4 | `app/api/admin/notify-new-user/route.ts` | `WEBHOOK_SECRET`; recipients derived from `profiles.is_admin` | **Unchanged.** Platform-level |
| 5 | `app/api/agency/rfp/magic-link/route.ts` | Anon `auth.getUser()` + role check, then every service query re-scoped `.eq("agency_id", auth.userId)` at 4 sites | The **template for all the others**. Each `.eq("agency_id", auth.userId)` becomes `.in("org_id", callerOrgIds)`, and the project ownership check `.eq("id", projectId).eq("agency_id", auth.userId)` becomes `.eq("id", projectId).in("org_id", callerOrgIds)` |
| 6 | `app/api/agency/email-scan/run/route.ts` | Session + role, then service-role reads of `profiles` by email across all companies | Scope the partnership reads and writes to `callerOrgIds`. **State the consequence explicitly: a colleague's mailbox scan writes into the shared pool.** That is almost certainly wanted; it should be a decision, not a discovery |
| 7 | `app/api/agency/email-scan/import/route.ts` | Same | Same. The duplicate check `(agency_id, partner_email)` becomes `(lead_org_id, partner_email)`, which is what makes two colleagues importing the same contact idempotent |
| 8 | `app/api/agency/email-scan/route.ts` | Session + role; scopes `email_connections` by `user_id` | **Unchanged.** `email_connections` is legitimately per-person (`UNIQUE(user_id, provider)`) and must stay that way |
| 9 | `app/api/agency/email-connections/route.ts` | Same | **Unchanged**, same reason |
| 10 | `app/api/agency/pool/add-partner/route.ts` | `requireAgencyRole()`, then `importPartnerRows(service, auth.user.id, ...)` | The session uid is passed **as the company identity** into a shared helper. Change the argument's meaning in `lib/server/partner-pool-import.ts` and both routes follow. **One function, not two routes** |
| 11 | `app/api/agency/pool/import-spreadsheet/route.ts` | Same helper | Covered by 10 |
| 12 | `app/api/rfp/guest/[token]/route.ts` (808 lines) | **Possession of a magic token only.** No session by design. Writes `partnerships` scoped to `agency_id` taken from the token row | The largest surface in the inventory. `tokenRow.agency_id` becomes `tokenRow.org_id` and remains the authority - which is correct, because the token IS the delegation. But a token minted by one member now confers writes into the whole organization's pool with no member context. **079 should decide what a guest-originated write attributes to**, most likely the token's issuer carried on `rfp_magic_tokens` as a new column. That is M2's `created_by` work and it is cheapest to add the column now |
| 13 | `app/api/rfp/guest/[token]/attach-existing-account/route.ts` | Token + session | Same token-as-authority model. Rename only |
| 14 | `app/api/rfp/guest/file/route.ts` | Token, plus a check that the blob path's embedded token matches the supplied one | Rename only. **Keep that path check verbatim** - it is a genuinely good defence and nothing about organizations changes it |
| 15 | `app/api/rfp/guest/upload/route.ts` | Same | Same |
| 16 | `app/api/partner/rfps/route.ts` | Session + role, then service reads. Carries a comment at line 134 claiming "RLS applies" - **it does not**, the query is on the service client | Every `.eq("partner_id", user.id)` becomes `.in("vendor_org_id", callerOrgIds)`. **Fix the stale comment in the same pass**; the next person will trust it |
| 17 | `app/api/partner/rfps/bids/route.ts` | Same | Same |
| 18 | `app/api/partner/projects/route.ts` | Same, `.eq("partner_id", user.id)` at 2 sites | Same |
| 19 | `app/api/partner/partnerships/claim/route.ts` | `requireAuth()`, then `UPDATE partnerships SET partner_id = userId WHERE partner_id IS NULL AND <email match>` | **The one route with a genuinely new failure mode.** It becomes `SET vendor_org_id = <caller's org>`. When a vendor company has several people, the second colleague to sign up with a matching domain finds no ghost row left to claim - the first one took it. That collision does not exist today and exists the day 079 ships. It needs a product answer before the code is written |
| 20 | `app/api/brief/save/route.ts` | Cookie session, falling back to verifying a bearer token via `serviceVerifier.auth.getUser(token)` | **Unchanged.** It writes `brief_interpretations.user_id`, which is genuinely per-person. Listed because the bearer-token fallback is the cleanest answer in the repo to the middleware constraint and is worth knowing exists |
| 21 | `app/api/auth/google-email/callback/route.ts` | `state.userId` from the OAuth state parameter | **Unchanged by 079.** Separately: confirm the state is signed. A forged state attaches an attacker's mailbox tokens to a victim's account, and under 079 that mailbox then writes into the victim's whole organization. Not verified in this run |
| 22 | `app/api/auth/microsoft-email/callback/route.ts` | Same | Same |
| 23 | `app/api/auth/check-email/route.ts` | No session by design, pre-signup existence check | **Unchanged.** A user-enumeration oracle, standard for a signup flow |
| 24 | `app/api/contact/route.ts` | No session, public marketing form | **Unchanged.** Correctly narrow |
| - | `lib/server/account-existence.ts` | Service-role helper behind 23 | **Unchanged** |

**The seven `lib/` choke points** take an `agencyId` parameter and never see a session, so
they change in one place regardless of how many routes call them. Highest leverage in the
epic:

`lib/usage-tracking.ts` (7 org references), `lib/library-documents.ts` (4),
`lib/bid-analysis-context.ts` (7), `lib/rfp-evaluation-criteria-server.ts` (3),
`lib/award-partnership-resolution.ts` (18), `lib/partnership-invitations.ts` (5),
`lib/magic-token-attach.ts` (6, and already indirection-safe: it scopes from
`tokenRow.agency_id` rather than from a session).

---

## 7. The eleven email-resolution sites

Every agency-facing and vendor-facing notification resolves its recipient as
`profiles.email WHERE id = <a company id>`. Under the organization model that lookup is
wrong, and the way it is wrong is the worst available: **it keeps working for every
organization backfilled by 079, because their id equals the founding user's id, and returns
nothing for every organization created afterwards.** It fails late, for new customers only,
and it does not throw.

Ten of the eleven use `.maybeSingle()` behind an `if (recipientEmail)` guard, so the send is
simply skipped with no log line. One uses `.single()` and writes a `console.error`.

| # | Site | Recipient | Silent? |
|---|---|---|---|
| 1 | `app/api/projects/[id]/onboarding-packages/route.ts:317` | vendor, from `partnership.partner_id` | **No** - `.single()` plus `console.error` on failure |
| 2 | `app/api/agency/projects/[projectId]/status-updates/route.ts:178` | vendor, from `partnership.partner_id` | Yes |
| 3 | `app/api/agency/rfp-responses/[id]/route.ts:291` | vendor, from `partnerIdForResolution` | Yes |
| 4 | `app/api/agency/rfp-responses/[id]/route.ts:425` | vendor, from `existing.partner_id` | Yes |
| 5 | `app/api/agency/rfp-responses/[id]/route.ts:574` | vendor, from `existing.partner_id` | Yes |
| 6 | `app/api/agency/rfp-responses/[id]/route.ts:639` | vendor, from `existing.partner_id` | Yes |
| 7 | `app/api/partner/projects/[projectId]/status-update/route.ts:221` | **lead agency**, from `project.agency_id` | Yes |
| 8 | `app/api/partner/rfps/[id]/response/route.ts:372` | **lead agency**, from `inbox.agency_id` | Yes |
| 9 | `app/api/partner/rfps/[id]/nda-notify/route.ts:68` | **lead agency**, from `inbox.agency_id` | Yes |
| 10 | `app/api/rfp/guest/[token]/route.ts:541` | **lead agency**, from `tokenRow.agency_id` | Yes |
| 11 | `app/api/rfp/guest/[token]/route.ts:703` | **lead agency**, from `tokenRow.agency_id` | Yes |

Four further sites resolve a profile by a company id but only to render a display name, not
to address an email. They break the same way and matter less:
`app/api/projects/[id]/onboarding-partners/route.ts:136`,
`app/api/agency/pool/[partnerId]/route.ts:78`,
`app/api/partner/projects/[projectId]/active-engagement/route.ts:174`,
`lib/server/partner-import-guard.ts:76`.

**The fix, and the decision inside it.** Every one of these becomes "resolve the
organization's notification recipients", which is a question nobody has answered. Three
options, and it is a product ruling:

- **the owner only** - closest to today's behaviour, one recipient, nobody is surprised;
- **every member** - matches "joining an organization means seeing what the organization
  sees", and is the only option under which a colleague can act on an RFP that arrived while
  the founder was away;
- **a per-member preference** - `profiles.notification_preferences` already exists as jsonb
  from `scripts/017`, so the per-member half of the answer is already built.

**Recommendation: every member, with `profiles.notification_preferences` as the opt-out.**
It is the only option that does not silently make the product worse for the second person
who joins, and the storage for the opt-out already exists. Whichever is chosen, put it in
ONE function - `resolveOrgNotificationRecipients(orgId)` in `lib/email.ts` - so there are
eleven call sites and one rule, not eleven rules.

---

## 8. The safety net, because the compiler is not one

Two checks. The first is genuinely build-time and catches the code half. The second needs
the database and catches the half no grep can see.

### 8a. The grep guard - run it in CI, and in the pre-commit checklist

After the rename, the old names must not appear anywhere in application source. This is a
whole-repo string check, it needs no database, and it runs in under a second.

```bash
# scripts/check-no-legacy-identity-columns.sh
# Fails the build if a pre-079 company identity column name survives in app source.
set -e
HITS=$(grep -rn -E "\b(agency_id|partner_id|voucher_agency_id|vouched_partner_id)\b" \
  app/ lib/ components/ contexts/ hooks/ middleware.ts \
  --include="*.ts" --include="*.tsx" || true)
if [ -n "$HITS" ]; then
  echo "Legacy identity column names found. 079 renamed these:"
  echo "  agency_id  -> org_id, or lead_org_id on a two-column table"
  echo "  partner_id -> vendor_org_id"
  echo "$HITS"
  exit 1
fi
```

Add it to the pre-commit checklist in `CLAUDE.md` beside `npx tsc --noEmit`. Note that this
guard is only correct **after** the rename lands - before then it fails on every line, which
is precisely why it is the last commit in the sequence below.

### 8b. The policy audit - the check worth its small cost

The failure this catches is the nastiest one in the whole epic. A policy body that still
says `org_id = auth.uid()` **works perfectly for a single-member organization**, because the
organization id equals the founder's uid for every backfilled row. It breaks the first time
a second person joins, in production, for one customer, with no error - the colleague simply
sees nothing.

Nothing in the code, the type system or the grep guard can see this. It lives in the
database.

`pg_policies` is not reachable through PostgREST, so the check needs a
`SECURITY DEFINER` function to expose it. Author it in 080, not 079 - it is a verification
tool, not part of the migration, and bundling it would make 079 larger for no gain:

```sql
-- Returns every policy on an organization-scoped table whose body still compares
-- something to auth.uid(). Empty result is the pass condition.
CREATE OR REPLACE FUNCTION public.org_policy_audit()
RETURNS TABLE (tablename text, policyname text, cmd text, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT p.tablename::text, p.policyname::text, p.cmd::text,
         coalesce(p.qual, '') || ' | ' || coalesce(p.with_check, '')
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename IN (
      -- every table 079 gave an org_id, lead_org_id or vendor_org_id
      SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.column_name IN ('org_id', 'lead_org_id', 'vendor_org_id'))
    AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) LIKE '%auth.uid()%'
    -- Legitimate uses of auth.uid() on an org-scoped table, allow-listed by name.
    -- Every entry here is a policy that matches the CALLER as a person rather than
    -- as a company. Adding a name to this list is a decision; make it visible.
    AND p.policyname NOT IN (
      'Partners update own inbox rows',                 -- email disjunct, bucket (U)
      'Partners insert RFP responses for their inbox',  -- email disjunct, bucket (U)
      'Partners can view their received invitations',   -- email disjunct
      'Partners can update received invitations',       -- email disjunct
      'Partners can claim partnership by email',        -- the pre-claim path
      'Partners select inbox rows by recipient email'   -- bucket (U)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.org_policy_audit() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.org_policy_audit() TO service_role;
```

Then a CI step, or a scheduled job, that calls it through PostgREST with the service role
key and fails on a non-empty result:

```js
const { data } = await service.rpc('org_policy_audit')
if (data?.length) { console.error('org-scoped policies still compare to auth.uid():', data); process.exit(1) }
```

**Why it is worth the cost.** It is about forty lines and it is the only mechanism that can
detect the one bug class this epic creates which is invisible until a customer hires
someone. The allow-list is the part to review, not the query: every name in it is a policy
that deliberately identifies a person rather than a company, and the list must not be
allowed to grow silently.

---

## 9. The recommended commit sequence

Ordered so **every commit builds and every commit before the last is deployable against
today's database.** The rename cannot be split across deployments - the columns cannot be
named both ways at once - so the whole sequence is one release, and commits 1 through 4
exist to make the review of commit 5 possible rather than to be shipped separately.

| # | Commit | Deployable alone? | Why here |
|---|---|---|---|
| 1 | `feat: resolveCallerOrgIds() and resolveOrgNotificationRecipients(), unused` | **Yes** | Add both functions to `lib/entitlements.ts` and `lib/email.ts` returning today's answer - the caller's own id, and the single profile email. Zero behaviour change, zero risk, and it means commits 4 and 5 are edits to call sites rather than new plumbing plus edits |
| 2 | `chore: the grep guard and the policy audit script, not yet enforced` | **Yes** | `scripts/check-no-legacy-identity-columns.sh` and the RPC caller from section 8, committed but not wired into CI. They fail today by construction, which is correct: they are the definition of done for commit 5 |
| 3 | `refactor: route every company-identity read through the two resolvers` | **Yes** | Mechanical. Every `.eq("agency_id", user.id)` becomes `.in("agency_id", await resolveCallerOrgIds(user.id))`, still naming the old column. `.in()` with a one-element array is exactly `.eq()`, so behaviour is identical and every subsequent commit is a pure string change. **This is the commit that makes the rename safe**, and it is worth doing on its own even if 079 slips |
| 4 | `refactor: the eleven email-resolution sites use the recipient resolver` | **Yes** | Same shape. The resolver returns one address today, so nothing changes; after 079 it returns the organization's recipients |
| 5 | `feat!: rename agency_id and partner_id to the organization columns` | **NO - ships with 079** | The 707 references, in one commit. One commit and not many: a half-renamed tree does not build meaningfully, and a reviewer needs to see the whole substitution at once to check it. Enable both guards from commit 2 in the same commit |
| 6 | `docs: record 079 as applied, and re-take the schema snapshot` | after the fact | The new `docs/schema-snapshot-<date>.md`, the `LIGAMENT_CONTEXT.md` migrations table, and `docs/schema-truth.md` section 2 |

**Commit 3 is the load-bearing one.** After it, the tree still names `agency_id` everywhere
and still works, but every company-identity read already goes through a single function that
knows how to answer the organization question. Commit 5 then degenerates to a find-and-
replace that the grep guard verifies exhaustively. Doing 5 without 3 means writing the
membership resolution and the rename in the same 707-line diff, and no one can review that.

**Order within commit 5**, for the person doing it: work the `org_id` group first (168
references, 15 tables, no ambiguity), then `lead_org_id` and `vendor_org_id` together per
file (a file that touches `partnerships` almost always touches both), then the 174
needs-a-human-read list last, with the census table open beside the file.

---

## 10. After the release: the live checklist

Run these against production, in this order, before telling anyone it is done. Every one is
a browser action or a read-only query.

1. `SELECT count(*) FROM public.organizations;` equals the profile count.
2. Sign in as `gmarkant@gmail.com`. Dashboard renders. Recent Activity is not empty.
3. `/agency/pool` lists the same number of vendors as before. Write the number down first.
4. Open a project. Its client, documents, assignments and milestones all render.
5. `/agency/bids` shows the same bids. Open one; the AI analysis and scores are there.
6. Create a project, then delete it. Both succeed. This exercises
   `projects_agency_insert` and `projects_agency_delete`, which are the two policies with
   the least existing traffic.
7. Sign in as a vendor (`gmarkant+partner71@gmail.com`). `/partner` lists their RFPs.
8. Open an RFP and submit or update a bid. This is the `vendor_org_id` write path.
9. Send a magic-link RFP to an email with no account. Open the guest link in a private
   window, upload a file, submit. This is `rfp_magic_tokens.org_id` plus the entire guest
   write path, and it is the largest single surface in the rename.
10. Claim a ghost partnership from a vendor account whose email matches. This is the one
    policy 079 rewrites whose WITH CHECK changed meaning.
11. Confirm an email actually arrived for steps 8, 9 and 10. Ten of the eleven recipient
    lookups fail silently, so absence of an error is not evidence.
12. `SELECT * FROM public.org_policy_audit();` returns zero rows.
13. Re-take `pg_policies`, commit it, and diff it against the pre-079 capture. The only
    differences should be the 83 rewritten predicates, the 2 folded `profiles` policies, the
    5 new ones, and the 9 role-list narrowings from `public` to `authenticated`.

---

## What this document does not cover

- **The membership interface.** Inviting a colleague, the member list, `org_invitations`.
  That is phase two and it ships with the feature, not with the rename.
- **Capability enforcement in routes.** `docs/capabilities.md` section 0 makes the argument
  that matters here: once bucket (a) moves to an organization predicate, every member
  satisfies it identically and RLS stops being able to tell an admin from a member. The
  capability checks named in that document have to exist in the routes **before** a second
  person joins any organization. They are not a precondition of the rename; they are a
  precondition of the feature the rename enables.
- **Whether any of this was executed.** None of it was. No column was renamed, no migration
  was applied, no query in section 8 was run against a database. The census in section 5 is
  the only part of this document produced by running something, and what it ran was a
  script over the repository, not against Postgres.
