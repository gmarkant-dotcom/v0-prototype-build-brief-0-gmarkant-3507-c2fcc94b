# Relationship end: phase 0, ground truth

Branch `feat/relationship-end`, cut from `main` at `6a0a982`. Read-only phase. No SQL was run
and no credentials were used. Everything below is READ from source unless it says EXECUTED.

## 0. Baseline (EXECUTED, each gate its own unpiped command)

Measured on a throwaway worktree of `origin/main` (`6a0a982`) with the real `node_modules`
symlinked in and invoked directly (not through pnpm, see the worktree gate note). `pnpm build`
ran in the main checkout, which was byte-identical to `origin/main` at that moment.

| Gate | Exit | Output line |
|---|---|---|
| `tsc --noEmit` | 0 | clean |
| `pnpm build` | 0 | built |
| `eslint .` | 1 | `182 problems (154 errors, 28 warnings)` and `0 errors and 7 warnings potentially fixable` |
| `check-identity-columns.mjs --guard` | 0 | GUARD PASSED |
| `check-org-id-reads.mjs --guard` | 0 | 14 known-open sites, class did not grow |
| `check-embed-targets.mjs` | 0 | TOTAL 0 in 0 files |
| `audit-policy-snapshot.mjs --guard` | 1 | known (static snapshot) |
| `verify-rls.mjs` | NOT RUN | needs credentials; the brief forbids them. The known value is 2 |

The full lint triple is **182 / 154 / 28**, the same as the brief's known value.

## 1. 0d FIRST: can a vendor already suspend or terminate their own partnership?

### The route: yes it stops them, but not by an authorization check

`PATCH /api/partnerships` (`app/api/partnerships/route.ts:821`). The validation list at `:1056`
admits `suspended` and `terminated`. What keeps a vendor out of the write is only this shape:

```ts
// :1061  the vendor branch
if (isPartner && partnership.status === 'pending') { ... accept (active) / decline (terminated) ... }
// :1317  the only code that writes an arbitrary status
if (isAgency) { ... .update({ status, ... }) ... }
// :1425
return NextResponse.json({ error: 'Invalid operation' }, { status: 400 })
```

`isAgency = callerOwnsOrg(callerOrgIds, partnership.lead_org_id)` (`:872`). A vendor on an
ACTIVE row has `isPartner` true and `isAgency` false, so both branches are skipped and the
handler falls out to `400 Invalid operation`. A vendor on a PENDING row can write `active`
(accept) and `terminated` (decline) and nothing else; `suspended`/`removed` fall through to the
same 400. **No explicit check says "a vendor may not suspend". The denial is a fall-through that
happens to be correct.** Phase 1 makes it explicit.

### THE LIVE PRIVILEGE DEFECT IS ONE LAYER DOWN, IN THE DATABASE POLICY

`supabase/migrations/079_organizations.sql:1491`:

```sql
CREATE POLICY "Partners can update partnership status"
  ON public.partnerships AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (vendor_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));
```

No column restriction and no status predicate. The only trigger on the table,
`partnerships_guard_identity_columns` (087:596), pins `lead_org_id` and `vendor_org_id` and says
nothing about `status`. **So a signed-in vendor who talks to PostgREST directly (the anon key
ships in the browser bundle, and CLAUDE.md tells contributors to use the browser client) can
write `status = 'terminated'` or `'suspended'` or `'active'` on their own partnership, and also
`msa_confirmed_at`, `nda_confirmed_at`, `accepted_at` and `partnership_notes`.**
`app/partner/projects/page.tsx:366` is a first-party example of a browser-side partnership
UPDATE by the vendor, so the policy is in deliberate use for `payment_terms_requests`.

Consequence for this feature: even once the agency can suspend, **the suspended vendor can lift
their own suspension from the browser console**, and a vendor can end a relationship they do not
want to be in.

**This cannot be fixed in application code**, because the attacker bypasses the application.
The fix is a migration (a BEFORE UPDATE trigger, or a narrowed policy plus a column grant), which
this run is forbidden to author. It is recorded for the migration session and leads the report.
This is read from migration files, not the live catalog; query P1 in the report's checklist
confirms it.

## 2. 0c: the status vocabulary, from source

`partnerships.status` CHECK, as migration 063 writes it (063:33-34), **only if a constraint
already existed** (its own comment says the column may have been unconstrained):

```
CHECK (status IN ('pending', 'active', 'suspended', 'terminated', 'removed'))
```

`scripts/010` originally allowed four (no `removed`). Whether the live column carries this CHECK
is unverified (query P2 in the report). Nothing in this run depends on it: no new value is
introduced.

### Every site that reads or writes `partnerships.status`

"Meets suspended/terminated" is what the site does today, before this run.

| # | Site | Reads/writes | On `suspended` / `terminated` today |
|---|---|---|---|
| 1 | `app/api/partnerships/route.ts:122,158` GET agency | `neq removed` / `eq removed` | Returned, shown in pool. Correct |
| 2 | same GET, vendor branch | no status filter | Vendor receives all rows incl. ended ones. Correct for ruling 1 |
| 3 | `:584` POST re-invite | `=== 'terminated'` | Re-invites to `pending`, **resets `accepted_at` to null**. `suspended` falls to "Partnership already exists (status: suspended)". Correct, noted |
| 4 | `:1061-1216` PATCH vendor | `pending` only | N/A |
| 5 | `:1317-1335` PATCH agency | writes ANY validated status, no prior-status check, no notification, not idempotent, ownership by membership set | **Writes either. Allows `pending -> active` (skips vendor acceptance) and `pending/removed -> suspended`.** Phase 1 hardens it |
| 6 | `app/api/agency/broadcast-rfp/route.ts:222` pool recipients | `eq active` | **Refused** with 400 "not active vendors". Correct |
| 7 | same file `:375` manual typed email, existing account | `in (active, pending)` | **Falls through**: no partnership found, `partnership_id` null, the RFP still lands in the vendor's inbox by `vendor_org_id`. **"Stops new requests" is NOT true on this path** |
| 8 | `app/api/agency/rfp/magic-link/route.ts` | no partnership status read | Same: sends to any email. Not stopped |
| 9 | `lib/award-partnership-resolution.ts:59,85-105,130-148` | `eq active`, then ANY row | **THE WORST FALL-THROUGH.** Branch c and the d-recheck write `status: "active"` onto whatever row matches, **suspended and terminated included**, and fire `notifyPartnershipAccepted`. Awarding a bid from a paused/ended vendor silently reinstates them and tells the agency "partnership accepted" |
| 10 | `lib/partnership-award-claim.ts:54` | writes `active` where `vendor_org_id IS NULL` | Ghost rows only; `suspended`/`terminated` rows cannot be ghost. Not reachable |
| 11 | `app/auth/callback/route.ts:182,211`, `app/api/partner/partnerships/claim/route.ts:65` | `in (pending, active)` | Skipped. Correct |
| 12 | `app/api/agency/pool/[partnerId]/notes/route.ts:78` | `eq active` | **404 "No active partnership".** The agency's notes panel and the blacklist toggle stop working for the vendor |
| 13 | `app/api/agency/pool/[partnerId]/performance/route.ts:58` | `eq active` | **404.** Delivery-performance panel stops loading |
| 14 | `app/api/projects/[id]/onboarding-partners/route.ts:142` | `eq active` | Awarded-bid row with no `partnership_id` is skipped from the onboarding list |
| 15 | `app/api/agency/pool/[partnerId]/route.ts` `isActivePartnership` | tier | Drops to public tier. Refusal copy says "opens when they accept your invitation", which is wrong for suspended/terminated |
| 16 | `app/api/partner/network/[agencyId]/route.ts` `hasActivePartnership` | tier | Vendor sees only the agency's public profile and **loses the "Work awarded to you" history on that modal**. Their awarded work still lists on `/partner/projects` |
| 17 | `app/api/partner/payments/route.ts` | none (edff222) | Included, tagged "Paused"/"Ended" on the page. The pattern to match |
| 18 | `app/api/partner/projects/route.ts:87` | none | Awarded projects listed with no state. Vendor cannot tell |
| 19 | `lib/partnership-state.ts` | `partnershipPoolColumn` | both -> `network` ("Active vendors"). `isActivePartnership` is strictly `=== 'active'` |
| 20 | `app/agency/pool/page.tsx:1939-1953` | card | Badge "Suspended"/"Terminated" exists. Sub-line still says "Active since" (acceptedAt). No action controls |
| 21 | `app/agency/pool/page.tsx:1013,1413` Active vendors TILE | `=== 'active'` | Excludes both. The column header counts them. **Tile and column disagree under one name** the moment a row is written |
| 22 | `app/agency/page.tsx:189,223` | `isActivePartnership`, `isPendingPoolColumn` | Both excluded from the active list and from pending. Fine |
| 23 | `app/agency/msa/page.tsx:281` | `=== active` | Both vanish from the MSA page with no note |
| 24 | `app/partner/network/page.tsx:273,283,1350,1391` | badge + raw `capitalize` | Badges exist. Detail modal prints raw status text. No sentence explaining it |
| 25 | `app/partner/page.tsx:282` | `find active` | Only drives a rate-info completeness hint. Ended agency ignored. Harmless |
| 26 | `app/partner/profile/page.tsx:282` | `eq active` | "Partnership context" lists only active agencies; an ended one disappears from that list |
| 27 | RLS helpers `085`, `096` | `commercial_counterparty` admits pending/active/suspended, refuses terminated/removed | Terminated loses profile terms; suspended keeps them |
| 28 | RLS `notifications` INSERT | counterparty user ids | Terminated vendor is no longer a counterparty, so **an in-app row written AFTER the status flip is RLS-refused** (the decline path documents the same trap at `:1166-1181`) |

**Findings that gate Phase 2, in order:**
1. Row 9: a status the application writes can be silently undone by an award. Fixed in Phase 2 for
   `suspended`/`terminated`, narrowly.
2. Row 7/8: "stops new requests" is true for the pool broadcast only. Copy is worded to that.
3. Rows 12/13/15/16/20/23/24/26: the status is readable but renders as if nothing changed or as a
   generic failure. Phase 2 labels them. Rows 12, 13 and 16 are NOT changed (they are existing
   active-only gates and widening them is outside the brief); the dialog copy discloses 12/13.

## 3. 0e: the premise is half right

- **Confirmed:** nothing in `app/` writes `suspended` or `terminated` from the agency side.
  `grep` for both literals over `app lib components` finds only types, badges, comments and the
  vendor decline write.
- **Wrong:** "the route needs zero changes". The agency branch has no idempotency (a repeat writes
  and bumps `updated_at`), no prior-status guard (`pending -> active` skips acceptance;
  `removed -> suspended` is accepted), ownership uses the membership set rather than
  `resolveCallerWriteOrgId`, a vendor is denied only by fall-through, and it sends no mail. The
  brief requires all of those, so Phase 1 changes the route.

## 4. 0f: removed vs suspended vs terminated

| | `removed` | `suspended` | `terminated` |
|---|---|---|---|
| Offered on | Discovered column, never-invited contacts | Active vendors card (new) | Active vendors card (new) |
| Meaning | Archive of a contact never worked with | Pause | Ending |
| Vendor told | No | Yes (Phase 3) | Yes (Phase 3) |
| Reversible in product | No (nothing restores) | Yes | Yes |

The three verbs live on one page but on **disjoint row populations**: no card offers all three,
and the Discovered Remove is never shown on a row that has Suspend/Terminate. So no surface
offers three near-synonyms to one decision. **Residual overlap, a finding:** the API still accepts
`removed` on an ACTIVE row, and that is the only act that blanks nothing now but also tells
nobody. It is left as is.

A second residual: a vendor's own decline writes `terminated` onto a `pending` row. Those rows sit
in "Active vendors" badged "Terminated" and are indistinguishable by `status` from an agency
termination. Reinstatement therefore needs a discriminator; see the report.

## 5. Notification types (3a input)

`NotificationType` in `lib/notifications.ts:265` and the CHECK as widened by 095 and 099 permit
13 values; none of them honestly carries "partnership suspended" or "partnership ended"
(`partnership_declined` means a VENDOR declined an INVITATION). New in-app types are needed; that
is a migration. See the Phase 3 section of the report.
