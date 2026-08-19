# The award path stops depending on a profile read RLS refuses

**Status: code applied, uncommitted. No migration authored, no migration applied, no SQL
executed. 087 was not touched.**

Two files changed:

| File | What |
|---|---|
| `app/api/agency/rfp-responses/[id]/route.ts` | `recipient_email` selected and used; the H3 identity reads moved to the service client |
| `lib/award-partnership-resolution.ts` | branch d no longer builds a row 087 refuses |

The diagnosis this implements is `docs/087-award-break-diagnosis.md`. Its section 3(a) named
the column, section 4 named the secondary defect, and both are now closed.

---

## 1. What was wrong, in one paragraph

`resolveOrgNotificationRecipients()` was the *only* source of `vendorEmail` on the
`vendor_org_id`-is-set branch, and it runs on the session client. Its `org_members` read is
scoped to the caller's own organizations and its `profiles` fallback needs either an existing
partnership - which is exactly what this branch exists because there isn't - or
`is_discoverable = true` on the vendor. For a non-discoverable vendor it therefore resolves
nobody, correctly. `vendorEmail` came back null, branch d inserted `vendor_org_id` set with
`partner_email` NULL, and 087's INSERT policy refused it: both disjuncts of
`vendor_org_id IS NULL OR org_has_member_with_email(vendor_org_id, partner_email)` are false,
the second because the function returns false on a null email by construction (087:513).
42501, HTTP 500, award lost.

**The email was never actually missing.** It was on a row this handler had already fetched
and had chosen not to select.

---

## 2. Three sources, in order of authority

`route.ts:352-419`. The order is deliberate and the first two paragraphs of the comment there
say why.

| # | Source | Why it is in this position |
|---|---|---|
| 1 | `resolveOrgNotificationRecipients()` -> `profiles.email` | **Preferred, unchanged.** Where it succeeds - a discoverable vendor, or one already visible through a partnership - it also yields `company_name` and `full_name`, which nothing else here does. A vendor who awards fine today keeps awarding through exactly the same code. |
| 2 | `partner_rfp_inbox.recipient_email` (`:383`) | Added to both inbox selects (`:210`, `:254`) and to `InboxForAward` (`:201`). One column on a query the route already runs, no extra round trip. |
| 3 | `rfp_magic_tokens.vendor_email` by `response_id` (`:386-403`) | The source 087:394 nominated. The sibling `else` branch already runs this query; the agency can read its own token rows (079:1666-1668). |

**Why source 2 is always populated on the shapes that can reach here.** Three writers create
inbox rows. The pool-vendor broadcast row is the only one that leaves `recipient_email` null,
and it always carries `partnership_id`, so branch a returns before this code runs. The
manual-recipient row and the magic-token-attach row both carry it. On both, the address and
the `vendor_org_id` were derived *from each other* at write time, which is precisely the
pairing 087 checks - so the value on the row is the one that satisfies the predicate rather
than merely a value.

The token-only synthesized context (`:305-312`) has no inbox row, so it carries
`recipient_email: null` explicitly and falls through to source 3.

`vendorDisplayName` is filled from whatever the fallback found only when the profile read left
it at the `"Vendor"` placeholder (`:405-408`), so no name is ever downgraded.

Both outcomes log (`:410-417`): one line when the fallback supplied the email that RLS hid,
a different line when all three came back empty.

---

## 3. The ghost, and what it costs

`award-partnership-resolution.ts:144-224`.

The linked insert is now guarded on **both** halves of the vendor identity
(`:153`, `if (partnerIdForResolution && normalizedEmail)`), because 087 requires both. With an
organization but no address the function writes the ghost shape instead - `vendor_org_id`
null, `status: 'pending'`, `profile_status: 'unclaimed'` - which satisfies the policy's first
disjunct. With neither, it still returns the error it always did (`:179-183`), and the caller
still reports that as "no vendor account or email is linked to it".

**This is a fallback, not a design.** After section 2 it should be unreachable: it needs a
vendor organization whose profile RLS hid, an inbox row with no `recipient_email`, and no
magic token. It is deliberately loud (`console.error` at `:197`).

### What breaks downstream when an award produces this ghost

Answering the question directly. A ghost row created here carries **neither** identifying
column - no `vendor_org_id` and, unlike a pure-guest ghost, no `partner_email` either.

1. **The vendor never sees the project.** `project_assignments` is written against this
   `partnership_id` (`route.ts:719-750`) and the partner portal reaches its projects through
   partnerships matched on `vendor_org_id` or `partner_email`
   (`app/api/partnerships/route.ts:240`). Neither matches. The award is recorded on the
   agency's side and invisible on the vendor's.
2. **The award notifications are unaffected by the ghost - and were already broken anyway.**
   Both are keyed to `partner_rfp_responses.vendor_org_id`, not to the partnership, so the
   ghost changes nothing for them. See section 5.1: the *email* half of that pair is broken
   for this same population for the same reason, before and after this change.
3. **It is unclaimable by every existing claim path.** All six of them match on
   `partner_email` - `app/api/partner/partnerships/claim/route.ts:66`,
   `lib/partnership-award-claim.ts:39`, `lib/partnership-invitations.ts:36`,
   `app/api/rfp/guest/[token]/route.ts:67,128`, `app/api/agency/email-scan/import/route.ts:86`.
   A null email matches none of them, so the vendor creating an account later does not fix it.
4. **This resolver cannot find it again either**, so a second award to the same vendor creates
   a *second* ghost. Branch c looks for `vendor_org_id.eq` or `partner_email.ilike`, both null
   here, and 084's unique index only covers `vendor_org_id IS NULL AND partner_email IS NOT
   NULL`, so nothing dedupes them.
5. **Vendor Pool shows an unidentified "Discovered" row.** Correct bucketing - the column
   requires `vendor_org_id` truthy - with nothing in it to identify.
6. **Repair is possible but is two statements, in order.** 087's trigger guards `lead_org_id`
   and `vendor_org_id`; it does not guard `partner_email`. So a service-role fix writes
   `partner_email` first, then `vendor_org_id` - the second UPDATE is checked against the
   already-corrected email by `org_has_member_with_email` and passes. Doing it in one
   statement also passes, since the trigger reads `NEW` for both. Clearing `vendor_org_id`
   later is refused outright (087:616-624).

Weighed against the alternative - a 42501 that loses the award entirely and leaves the bid in
its previous status - a loud, repairable, agency-side-only record is the better failure. It is
still a bad record and the report says so rather than filing it as a success.

---

## 4. The secondary defect: H3 was dead code

`route.ts:437-500`. Diagnosis section 4 was right, and the fix is one client.

`resolveOrgIdForUser()` -> `resolveOrgIdsForUsers()` reads `org_members` **with the client it
is handed** (`lib/entitlements.ts:439`). Both SELECT policies on that table admit only
`user_id = auth.uid()` (079:1736-1738) or the caller's own organizations (086:148-150), so on a
session client the read returns zero rows for **every** counterparty. `matchedVendorOrgId` was
therefore always null: the `vendor_org_id` upgrade never fired, the
`partner_rfp_responses.vendor_org_id` backfill never ran, and the path logged *"vendor matched
by email belongs to no organization, staying a guest"* about vendors that plainly do belong to
one. It is now `vendorIdentityClient` (`:490`).

**I moved the `profiles` lookup two lines above it to the same client** (`:461`), which is one
step past the literal instruction, for this reason: it hits the identical wall. `profiles`
admits `id = auth.uid() OR id IN (current_user_visible_profile_ids())`, and that set is derived
from `partnerships` rows only (079:721-728, 766-777) - no partnership exists yet, which is why
this code is running - so it resolves a vendor only when `is_discoverable = true`. Fixing the
resolver and leaving the lookup on the session client would have left H3 disabled for exactly
the same population, one line earlier. Both reads are counterparty *identity* questions, not
visibility questions.

The safety argument for the service role here, stated in the comment at `:437-452` rather than
assumed: the caller is authenticated and role-checked at the top of the handler before either
read runs; the email being resolved is one the agency itself sent the RFP to; the reads return
one id and one org id into local variables, and nothing from either reaches the response body.
Same pattern and same justification as `app/api/agency/rfp/magic-link/route.ts:14-21`.

Two failure modes are now handled that RLS used to mask:

- **No service key** (previews, local without the env var): logs, falls back to the session
  client, and the re-link does not resolve. Explicit rather than silent.
- **Two profiles sharing an address**: `maybeSingle()` returns PGRST116 rather than being
  narrowed to one row by RLS. Logged, non-fatal, and the award falls through to the guest
  shape rather than guessing which profile is the vendor.

---

## 5. What was deliberately not done

### 5.1 The award email has the same defect, one screen further down, and I did not fix it

Found while tracing the ghost's downstream. `route.ts:803` resolves the "You have been
awarded" recipient with

```ts
const awardRecipients = await resolveOrgNotificationRecipients(existing.vendor_org_id, supabase)
```

- the identical session-client read that section 1 is about. For a non-discoverable vendor it
resolves nobody, `partner?.email` is falsy, and the send is skipped. It logs
*"no notification recipients for the vendor organization"* and returns HTTP 200. **So the
population this fix unblocks currently completes the award and is never told.** The in-app
notification beside it (`:851`, `notifyProjectAwarded`) writes against the organization id
directly and does fire.

Not fixed here because sending mail to a newly-derived address is outward-facing and is not
one of the five things this change was asked to do. The address is now in hand inside the
handler - `vendorEmail` at `:352-419` - so wiring it in is a small, separate change: hoist it
out of the `if (!partnershipId)` block and use it as the fallback when `partner?.email` is
empty. Worth doing deliberately rather than as a side effect of this one.

### 5.2 The rest


- **087 not touched.** It is applied and correct. 087:370-395 said the code was the side that
  needed fixing and it was right.
- **`resolveOrgNotificationRecipients()` not moved to the service client.** That is the other
  available fix for the same null and it is a larger blast radius - the function is used by
  every notification path in the app. Sourcing the address from a row the agency already
  legitimately holds is narrower. Worth revisiting as its own change, not inside this one.
- **`partner_rfp_responses.vendor_org_id` written by `app/api/rfp/guest/[token]/route.ts:603`
  as a profiles id** (the V3 parameter-class defect, 087:229-233) is untouched. H3's re-link
  now overwrites it with a real organization id on award, which narrows the exposure but does
  not close the writer.
- **P3 was not run.** No database credentials in this environment. If
  `SELECT count(*) FROM partnerships WHERE vendor_org_id IS NOT NULL AND partner_email IS NULL`
  is non-zero, those rows predate 087 and are unreachable by branch c's email disjunct forever;
  they need the two-statement repair in section 3.6.

---

## 6. Gates

All eight, run at the end of this change. Baseline is the `docs/m1-cleanup-report.md`
Phase 4 table.

| Gate | This run | Baseline | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | 0 | Passes. The bar CLAUDE.md sets. |
| `pnpm build` | **0** | 0 | Passes. Full production build. |
| `pnpm lint` | **1** | 1 | Unchanged. **183 problems, 154 errors, 29 warnings** - identical totals. |
| `pnpm verify-rls` | **2** | 2 | Known pre-existing. Fails before reading a policy; PostgREST does not expose `pg_class` here. |
| `pnpm policy-audit:guard` | **1** | 1 | Known pre-existing. Reads a static pre-079 snapshot. |
| `pnpm identity-columns:guard` | **0** | 0 | Passes. |
| `pnpm embed-targets` | **0** | 0 | Passes. |
| `pnpm org-id-reads:guard` | **0** | 0 | Passes. Class A **14** measured, unchanged. Class B **62** measured. |

**On Class B 62 vs the report's 66.** Not this change. The working tree already carried an
uncommitted batch - `app/agency/pool/[partnerId]/page.tsx`,
`app/api/agency/client-cash-flow/route.ts`, `app/api/agency/msa/milestones/route.ts`,
`app/api/agency/pool/[partnerId]/notes/route.ts` and the `KNOWN_OPEN_MIRROR` entries for them -
which took it 66 -> 62 before this session started. Neither file touched here appears anywhere
in the guard's output, in either class, before or after.

**The working tree is mixed.** These two files also carry the previous session's uncommitted
079 parameter-class work (the `OrgId` typing of `partnerIdForResolution`, the `leadOrgId`
crossing, the split award error messages). Committing `route.ts` commits that too. The other
six modified files are a separate batch and are not part of this change.
