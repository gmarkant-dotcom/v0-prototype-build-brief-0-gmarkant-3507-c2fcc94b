# Lightning resend wipe (F7) and guest proposal sections (F8): report

Branch `fix/lightning-resend-guest-sections`, from `main` at 6e66fca. Date 2026-11-06.
No migration. Nothing under `supabase/` changed. No file on the parallel-build do-not-edit list changed.

Line numbers marked **(main)** are at 6e66fca, before this branch. Unmarked ones are on this branch.

## Commits

| Commit | What |
|---|---|
| 32980e3 | F7: explicit resend path, `lib/magic-link-resend.ts` and its test, Resend button sends `resend: true` |
| 7426b47 | F8: guest insert keeps `proposal_sections`, `lib/guest-bid-row.ts` and its test |
| (this doc) | report and `docs/test-script-lightning-fixes.md` |

## STEP 0 (read only)

### a. The resend path

- **Component.** `components/agency-rfp-magic-link-invite.tsx:112-128` **(main)**: `resendInvite` POSTs
  `/api/agency/rfp/magic-link` with `vendor_email`, `vendor_name || undefined` and `project_id`. Nothing else.
  The card is rendered at `app/agency/page.tsx:3067` (broadcast step of the `/agency` wizard) and lists every
  token of the selected project, including tokens sent from `/agency/magic-rfp`.
- **Route.** `app/api/agency/rfp/magic-link/route.ts` **(main)**:
  - `:134-153` parse the body. Every absent field normalizes to an empty value: `reference_materials` -> `[]`,
    `normalizeBusinessCriteriaRequired(undefined)` -> `{designations:{},insurance:{},notes:""}`
    (`lib/business-criteria.ts:185`), `normalizeBudgetCategories(undefined)` -> `[]`,
    `normalizeRfpEvaluationCriteria(undefined)` -> `[]`, `close_bidding_at_deadline` -> `false`,
    `scope_item_*` -> `null`, `show_client_to_vendors` absent -> `false`.
  - `:178-181` `response_deadline` absent -> a fresh 14-day default (R1), replacing the agency's date.
  - `:218-224` reads the existing token on `(org_id, project_id, vendor_email)`.
  - `:266-304` creates a NEW `rfp_records` draft and line from that empty body (source `magic_link`).
  - `:374-405` `tokenUpsertPayload`, written by `:414-418` `upsert(..., { onConflict: "org_id,project_id,vendor_email" })`.
- **Every token column a resend overwrote:** `vendor_name`, `scope_item_id`, `scope_item_name`,
  `scope_item_description`, `reference_materials`, `client_name_released` (to null), `business_criteria_required`,
  `token` (only when expired), `expires_at`, `status`/`submitted_at`/`response_id` (only when no bid),
  `response_deadline`, `budget_categories`, `evaluation_criteria`, `close_bidding_at_deadline`, and `rfp_line_id`
  (moved to the new empty record's line, `:404`). Only `require_terms_disclosure` was spared (`:397`).
  The `rfp_line_id` move matters on the agency side too: `lib/rfp-evaluation-criteria-server.ts:83-88` reads the
  rubric from the linked record first, so after a resend the agency's scoring used the empty record.
- **Could the route tell a resend from a new invite?** No. The body had no marker, and an existing token is not one:
  `/agency/magic-rfp` legitimately re-sends to an existing recipient with new content
  (`app/agency/magic-rfp/page.tsx:607-637`), and the code at `:213-217` **(main)** treats "a different invite
  surface targeting the same recipient" as normal.

### b. Other callers of the magic-link route

| Caller | Body | Depends on the upsert overwriting? |
|---|---|---|
| `app/agency/magic-rfp/page.tsx:607-637` (Lightning) | the full brief, criteria, categories, materials, template | It relies on a send writing everything it carries. Unchanged: it never sends `resend`. |
| `app/agency/page.tsx:1347-1367` (wizard, guest recipients) | scope item, materials, terms, deadline, client toggle, release; **no** criteria, categories, business criteria, close flag | No. Unchanged. See finding G2. |
| `components/agency-rfp-magic-link-invite.tsx:88-97` (card "Send Invitation") | email, name, project, terms only | No. Unchanged. See finding G1. |
| `components/agency-rfp-magic-link-invite.tsx:112-128` (card "Resend") | email, name, project | This is F7. Now sends `resend: true`. |
| `app/api/agency/pool/resend-invitation/route.ts:15` | does not call it | Its comment already says it avoids this route because the route resets the token. |

No caller depends on a resend blanking content. Only the Resend button changes behaviour; every other body has no
`resend` key and goes through the unchanged first-send path. **S2 not triggered.**

### c. The guest bid paths

- **Client.** Service role throughout: `app/api/rfp/guest/[token]/route.ts:148-154` (`getServiceSupabase`), used by
  `POST` at `:529`. No session; RLS does not run. The token lookup at `:540` and the expiry and closed checks
  `:548-559` are the permission.
- **Edit (update) path** `:635-649` **(main)**: carried `proposal_sections` (twice, a duplicated spread at `:647-648`).
- **New bid (insert) path** `:746-761` **(main)**: no `proposal_sections`. That is F8.
- **Shape.** `lib/proposal-sections.ts`: `Partial<Record<"approach"|"experience"|"team"|"assumptions", string>>`,
  normalized with blanks dropped, and `buildProposalSectionsForSave` returns null when nothing was written, so the
  key is sent only when there is content (076 pre-migration safety). The guest route already computed it at `:619`.
- **Vendor path to match** `app/api/partner/rfps/[id]/response/route.ts:254` (same builder) and `:323`
  (`...(proposal_sections ? { proposal_sections } : {})`). Read only; that file is on the do-not-edit list.
- **Guest page** `app/rfp/respond/[token]/page.tsx:652` sends `proposal_sections` only when non-empty, and `:470`
  reads it back for editing. **Agency view** `app/api/agency/rfp-responses/route.ts:128-144` reads the column and
  `components/bid-detail-sheet.tsx:527` renders it.

### d. Damage code cannot repair

Yes, both. Neither can be repaired by code, and this branch writes nothing to existing rows.

- **F7.** Every resend before this fix overwrote the token's content in place. Tokens resent after migration 118 have
  their original content on the earlier `rfp_records` row of the first send, so a hand repair is possible from there;
  tokens resent before 118 kept no copy anywhere. Repair needs a data change, which is out of scope (S1 applies to any
  repair, not to this fix). Query 1 below lists them.
- **F8.** A guest's sections on a first submit were never written anywhere (the request body is not logged). They are
  lost. A guest who later edited the bid had the edit path store whatever sections they sent then. Query 2 lists
  guest bids with no sections, which is a superset of the affected ones; the owner can only ask those vendors.

## Stop conditions

None hit. S1: no database change is needed for the fix. S2: a first-time invite is unchanged (the new branch runs only
on `resend === true`, `route.ts:239`). S3: no listed file was needed; the vendor route was read only.

## F7: cause and fix

**Cause.** The Resend button posted an almost empty body to the first-send path, which normalizes every absent field to
empty and upserts every content column unconditionally (`route.ts:374-418` **(main)**), and creates a new empty RFP
record whose line the token then moves onto (`:266-312`, `:404` **(main)**).

**Fix.**
- `components/agency-rfp-magic-link-invite.tsx:124` the Resend button sends `resend: true`.
- `lib/magic-link-resend.ts` (new, pure): `isResendRequest` (explicit `true` only) and `planMagicLinkResend`, which
  returns a patch limited to `RESEND_WRITABLE_TOKEN_COLUMNS`: `token` (only when the old one expired), `expires_at`
  (72 h), `vendor_name` (only when a non-empty, different name was sent), `status: "pending"` and
  `submitted_at: null` (only when there is no bid), and `response_deadline` (only when the stored one is missing or
  already passed; see assumptions).
- `app/api/agency/rfp/magic-link/route.ts:236-254` the branch, after the same auth, organization, project and existing
  token checks a first send runs; 404 when there is no invitation to resend.
- `route.ts:740-` `resendInvitation`: reads the token within the caller's organizations, `.update(plan.patch)` at
  `:789` scoped by `token` and `org_id IN callerOrgIds`. No upsert, no `createRfpRecordDraft`, no
  `setLinkColumn`. Then the same partner-inbox attach (`:811`, idempotent; it carries the token's untouched
  `rfp_line_id` and `client_name_released`), the invitation email (client name only from `client_name_released`, no
  budget), `markPartnershipInvited`, and the `rfp.magic_link_send` and deadline milestones on the same terms as a
  first send. Response shape unchanged, `warnings: []`.
- 118 and 120 guards and the allow-list: untouched. The resend writes no JSON column at all, so 120's vendor-copy key
  guard has nothing to check; the first send still builds `reference_materials` through
  `vendorTokenReferenceMaterials` (`route.ts:411-414`).
- `route.ts:740-` also closes the gap the first send leaves for a missing deadline column: the read falls back to
  `MAGIC_TOKEN_ATTACH_COLUMNS_NO_DEADLINE` on 42703 (`:760-764`) and the deadline is then never written.

## F8: cause and fix

**Cause.** The insert row at `app/api/rfp/guest/[token]/route.ts:746-761` **(main)** was written separately from the
edit row and left out the `proposal_sections` spread the edit row and the vendor path have.

**Fix.**
- `lib/guest-bid-row.ts` (new, pure): `buildGuestBidContent`, the bid-content columns both guest paths share, with the
  vendor path's conditional keys (`business_criteria_acknowledgments` only when sent, `budget_lines` and
  `proposal_sections` only when non-null). Bid content only.
- `route.ts:634-645` one `bidContent` input; `:650` the edit row and `:756` the insert row are built from it. The
  insert keeps `lead_org_id`, `vendor_org_id`, `inbox_item_id: null`, `partner_display_name`; the edit keeps
  `submitted_at`. The duplicated spread is gone.
- Migration 121 compatibility: neither row names `ai_summary`, `ai_summary_generated_at`, `composite_score`, any score
  or evaluation, or `agency_feedback`. The test asserts the exact key set.
- `saveGuestResponseRow`'s 42703 fallback still drops `proposal_sections` on a database without 076.

## Tests

Plain assertion files, run with `npx -y tsx`:

| File | Result |
|---|---|
| `lib/magic-link-resend.test.ts` | 45 passed |
| `lib/guest-bid-row.test.ts` | 19 passed |

Gates: `./node_modules/.bin/tsc --noEmit` exit 0. `eslint` (whole repo, JSON output, filtered to touched files): 0
errors and 0 warnings in every touched file except `components/agency-rfp-magic-link-invite.tsx`, which has 2
`react-hooks/set-state-in-effect` errors at `:57` and `:64`. Both are in untouched effects and are on main; this branch
adds none.

## Damaged-row queries (read only, for the Supabase SQL Editor)

**Query 1: F7, tokens a Resend overwrote.** A resend's `rfp.magic_link_send` milestone has a null
`scope_item_name`, because the Resend body never carried one. Lists every token whose latest send was such a resend
after an earlier send that did carry a scope item, with the earlier send's time, and the earlier `magic_link` records
of the same project that may hold the original content. Resends before milestone emission existed (080) are not seen
by this query; the second SELECT lists tokens whose content is empty now, which covers them but also includes card
first sends that never had content (finding G1).

```sql
-- F7, part 1: tokens whose latest send was a content-less resend after a send with content.
WITH sends AS (
  SELECT m.org_id,
         m.subject_id                              AS project_id,
         lower(m.payload->>'recipient_email')      AS vendor_email,
         m.payload->>'scope_item_name'             AS scope_item_name,
         m.created_at
  FROM public.milestone_events m
  WHERE m.event_type = 'rfp.magic_link_send'
),
latest AS (
  SELECT DISTINCT ON (org_id, project_id, vendor_email) *
  FROM sends
  ORDER BY org_id, project_id, vendor_email, created_at DESC
),
last_full AS (
  SELECT org_id, project_id, vendor_email, max(created_at) AS full_send_at
  FROM sends
  WHERE scope_item_name IS NOT NULL
  GROUP BY org_id, project_id, vendor_email
)
SELECT t.org_id,
       t.project_id,
       t.vendor_email,
       t.status,
       (t.response_id IS NOT NULL)                                       AS has_bid,
       lf.full_send_at                                                   AS last_send_with_content_at,
       l.created_at                                                      AS damaging_resend_at,
       t.scope_item_name,
       jsonb_array_length(coalesce(t.evaluation_criteria, '[]'::jsonb))  AS criteria_now,
       jsonb_array_length(coalesce(t.budget_categories, '[]'::jsonb))    AS categories_now,
       t.rfp_line_id,
       (SELECT array_agg(r.id ORDER BY r.created_at)
          FROM public.rfp_records r
         WHERE r.lead_org_id = t.org_id
           AND r.project_id = t.project_id
           AND r.source = 'magic_link'
           AND r.created_at <= lf.full_send_at + interval '1 minute')    AS candidate_original_records
FROM public.rfp_magic_tokens t
JOIN latest    l  ON l.org_id = t.org_id AND l.project_id = t.project_id AND l.vendor_email = lower(t.vendor_email)
JOIN last_full lf ON lf.org_id = t.org_id AND lf.project_id = t.project_id AND lf.vendor_email = lower(t.vendor_email)
WHERE l.scope_item_name IS NULL
  AND l.created_at > lf.full_send_at
ORDER BY l.created_at DESC;

-- F7, part 2: tokens whose content is empty now, whatever wrote them (superset; includes card first sends).
SELECT t.org_id, t.project_id, t.vendor_email, t.status, (t.response_id IS NOT NULL) AS has_bid,
       t.created_at, t.expires_at, t.rfp_line_id
FROM public.rfp_magic_tokens t
WHERE t.scope_item_name IS NULL
  AND jsonb_array_length(coalesce(t.evaluation_criteria, '[]'::jsonb)) = 0
  AND jsonb_array_length(coalesce(t.budget_categories, '[]'::jsonb)) = 0
  AND (
        t.reference_materials IS NULL
     OR (jsonb_typeof(t.reference_materials) = 'array'  AND jsonb_array_length(t.reference_materials) = 0)
     OR (jsonb_typeof(t.reference_materials) = 'object' AND jsonb_array_length(coalesce(t.reference_materials->'materials', '[]'::jsonb)) = 0)
      )
ORDER BY t.created_at DESC;
```

**Query 2: F8, guest bids with no sections.** Every bid reached through a token (`rfp_magic_tokens.response_id`)
whose `proposal_sections` is null or empty. Superset: a guest who wrote no sections is listed too. The lost text is not
recoverable from the database.

```sql
SELECT r.id            AS response_id,
       t.org_id,
       t.project_id,
       t.vendor_email,
       r.status,
       r.updated_at,
       t.submitted_at
FROM public.rfp_magic_tokens t
JOIN public.partner_rfp_responses r ON r.id = t.response_id
WHERE r.proposal_sections IS NULL
   OR r.proposal_sections = '{}'::jsonb
ORDER BY t.submitted_at DESC NULLS LAST;
```

## Security review list

1. `app/api/agency/rfp/magic-link/route.ts:236-254`: the resend branch runs after `requireAgency()` (session
   `getUser` and the paid-lead-agency gate, `:92-93`), `resolveCallerOrgIds` (`:106-110`), the project lookup
   scoped to the caller's organizations (`:190-202`), and the existing-token lookup scoped the same way
   (`:218-228`). A resend for another organization's project is a 404 before any write.
2. `route.ts:752-765`, `:788-793`: the token is read and updated with `.in("org_id", callerOrgIds)` and, for the
   update, `.eq("token", <the token just read>)`. The service role bypasses RLS, so these filters are the permission,
   as for every other write on this route.
3. `lib/magic-link-resend.ts`: the patch can only name the six renewal columns; no request field other than
   `vendor_name` reaches it, and that only as trimmed text. The test asserts no content column for six token shapes.
4. `route.ts:799-804`: the organization written into milestones and partnerships is the token's own, which is one of the
   caller's (read within `callerOrgIds`), branded via `orgIdFromColumn`; a null fails closed with a 500.
5. `route.ts:811`: the attach runs only when the vendor email matches an account (same lookup as a first send,
   `:204-211`). It writes no new client name or budget; it copies the token's existing release columns.
6. `route.ts:816-828` resend email: the client name comes only from `client_name_released` (D3), no budget is included (D2).
   The bearer token is not put in any milestone payload or log line added here.
7. `route.ts` resend response: same fields as a first send (`token`, `expires_at`, `email_sent`, `attached`,
   `warnings`). `token` was already returned to the agency before this change.
8. `app/api/rfp/guest/[token]/route.ts:634-645`, `:650`, `:756`: guest writes stay bid content only
   (`lib/guest-bid-row.ts`); `proposal_sections` passes through `normalizeProposalSections` (four known keys, strings,
   trimmed) before it is written, so no other key can be stored in the column. No agency-owned column is written.
9. Nothing in this branch builds vendor-facing JSON. The first-send path's use of `lib/rfp-vendor-copy.ts` is unchanged.

## Findings for the owner

- **G1. The card's "Send Invitation" form wipes an existing invitation too.** `components/agency-rfp-magic-link-invite.tsx:88-97`
  sends only email, name, project and terms through the first-send path. When the address already has a token on the
  project (the card itself says "An active invitation already exists - resending delivers the same link", `:151`), the
  effect is the F7 wipe. Not changed here: the brief named the Resend button, and turning this form into a resend when
  a token exists changes what that form does. Options: send `resend: true` when `checkResult` reports an existing
  invite, or keep it a first send and change the copy.
- **G2. The `/agency` wizard's guest send omits criteria, categories, business criteria and the close flag.**
  `app/agency/page.tsx:1347-1367`. Sent to an address that already has a Lightning token on the project, it blanks
  those four. It is a first send by intent, so it is not F7, but the outcome is the same.
- **G3. Resend failures are silent.** `resendInvite` (`components/agency-rfp-magic-link-invite.tsx:112-131`) shows
  nothing when the call fails, and now a resend can 404. Not changed (no copy was asked for).
- **G4. F7 repair.** Query 1 gives candidate original records. A repair would copy their criteria, categories,
  materials, scope item and line back onto the token: a data change for the owner to decide and run.
- **G5. The existing invite list GET still selects `*`** (`route.ts` GET, `select("*")`), returning every token column,
  the bearer token included, to the agency. Pre-existing, agency-only, noted for the record.

## Refused, assumptions, stopped on

- **Refused:** nothing.
- **Assumption A1, the deadline on a resend.** Before this change a resend always replaced the deadline with a fresh
  14-day default (R1 note at `route.ts:164-177`), which overwrites a date the agency chose. The brief says a resend must
  not change fields it did not send, so the resend now keeps the stored deadline. Exception: when it is missing or
  already passed, it gets the 14-day default, so a re-invited vendor is not sent into a closed window (with
  `close_bidding_at_deadline` the guest route would refuse the bid). The deadline milestones fire only in that case.
- **Assumption A2, no RFP record on a resend.** Before, every resend created a new (empty) `rfp_records` draft and
  broadcast it. A resend now creates none; the token stays on its original line. D4 ("one record per send") is read as
  one record per send of an RFP's content; a resend sends no new content.
- **Assumption A3, content fields on a resend body are ignored.** A body with `resend: true` and, say,
  `evaluation_criteria` does not write them. Only `vendor_name` is honoured. A caller that wants to change content sends
  a first send.
- **Assumption A4.** The guest page does not show evaluation criteria (`guestTokenView`,
  `app/api/rfp/guest/[token]/route.ts:236-246`, by design: the rubric is agency-only). The test script checks the rubric
  on the agency side and the business criteria, budget categories, scope and materials on the guest page.
- **Stopped on:** nothing.
