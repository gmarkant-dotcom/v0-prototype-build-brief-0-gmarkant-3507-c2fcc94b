# Invitation read path and partnership state fix

Date: 2026-08-14. Implements the rulings in `docs/invitation-diagnosis.md`. Five commits, all
local. Nothing pushed. No migration written, no SQL executed except read-only SELECTs over the
Supabase REST endpoint, every one of them a GET.

`pnpm build` and `npx tsc --noEmit` both exit 0 on every commit. ESLint left report-only.

| Commit | Item |
|---|---|
| `458c459` | 1 - branch the read path on the acting role |
| `3ec552e` | 2 - one definition of partnership state |
| `59b38aa` | 3 - delete the dead second invitation mechanism |
| `b93c2c1` | 4 - tier the vendor profile response |
| `6d96a64` | 1 (follow-up) - fallback rule corrected after executing the helper |

---

# Read this first: partner23 will work

**`gmarkant+partner23@gmail.com` has `active_role = 'partner'`.** Confirmed read-only, just now:

```
GET /rest/v1/profiles?select=id,email,role,active_role,secondary_role,is_discoverable
    &email=ilike.gmarkant+partner23@gmail.com

[{"id":"6d9ee132-3780-4933-8eed-8ba5990e9665","email":"gmarkant+partner23@gmail.com",
  "role":"agency","active_role":"partner","secondary_role":"partner","is_discoverable":false}]
```

So the checklist runs on partner23 as-is. No role backfill is needed first, and no substitute
account is needed. `role` is still `'agency'`, which is exactly the dual-role shape the fix is
built for, so partner23 is in fact the *best* test account: an account whose `role` already read
`partner` would pass the checklist even with the bug still in place.

The three accounts that will also work, for the same reason, are
`gmarkant+partner70@gmail.com`, `info@ceoofgeo.com` (both `role='agency'`,
`active_role='partner'`) and `gmarkant+partner71@gmail.com` (`role='partner'`,
`active_role='partner'`). All 14 profiles were read; the full role table is at the end of this
document.

One caveat that is **not** about roles: the checklist step "open a discoverable vendor's profile
with no partnership" is not reachable from the `m a r k a n t` account today, because only two
profiles in the entire database carry `is_discoverable = true` and one of them is
`m a r k a n t` itself. See the checklist for the one-line toggle that makes it testable.

---

# Item 1: the read branch

## Which field, and why

**Branched on `profiles.active_role`, falling back to `profiles.role`.** The one definition now
lives in `lib/acting-role.ts` and is used by ten routes.

`active_role` is the right field because it is the only one that answers the question the branch
is asking. Traced from the code:

- `POST /api/profile/switch-role` writes **only** `active_role` (plus `secondary_role` when
  granting vendor access). It never touches `role`. Switching to `partner` is unconditional;
  switching to `agency` first requires `role === 'agency' || secondary_role === 'agency' ||
  is_admin`. So `active_role` is both the portal indicator *and* already entitlement-checked
  before it can be written.
- `middleware.ts:129` decides which portal is reachable from `profile.active_role ||
  profile.role`. The read path now agrees with the middleware instead of contradicting it.
- `role` is written once, by the signup trigger, and never again. Migration 056 made that trigger
  write `role='agency'` unconditionally, which is why 12 of 14 profiles carry it regardless of
  what the account is.

## The null handling, stated

From `lib/acting-role.ts`:

- `active_role` decides whenever it is **set and recognized** (`'agency'` or `'partner'`).
- `role` is consulted **only when `active_role` is genuinely unset** - null, absent, or empty
  string. This is the documented default from the brief.
- An `active_role` that is set but unrecognized resolves to **null**, not to `role`. A set value
  nobody understands must not be coerced into a portal.
- A null result falls to the **vendor branch**, which is the branch that only ever returns rows
  keyed to the caller's own id or email. The safe default is the non-privileged one.

That last rule is the subject of commit `6d96a64`. The first version of the module documented
the rule correctly and implemented a weaker one - unrecognized `active_role` fell through to
`role`, so `{role:'agency', active_role:'owner'}` was served the agency branch. It was caught by
executing the helper against eight profile shapes, not by reading it. Output below under
Executable verification.

## The accept path, traced end to end

Traced before declaring anything fixed. **The accept path works, and needed no change.**

| Step | Where | Finding |
|---|---|---|
| Button | `app/partner/network/page.tsx`, inside `searchedPendingPartnerships.map(...)` | Renders from the `/api/partnerships` response. Empty before, populated now |
| Handler | `handleAccept`, same file | `PATCH /api/partnerships` with `{partnershipId, status:'active'}` |
| Route exists | `app/api/partnerships/route.ts` PATCH | Yes |
| Guard 1 | `isPartner = partnership.partner_id === user.id` | partner23: `partner_id = 6d9ee132` = their own id. **Passes** |
| Guard 2 | `partnership.status === 'pending'` | partner23: `pending`. **Passes** |
| Write | `update({ status: 'active', accepted_at: new Date().toISOString() })` | **Writes both `status` and `accepted_at`.** Confirmed in source |
| Row level security | snapshot: `partnerships, Partners can update partnership status, UPDATE, qual (partner_id = auth.uid()), with_check (partner_id = auth.uid())` | The policy exists and matches. The UPDATE will not be silently swallowed by RLS |
| After-effects | `notifyPartnershipAccepted`, then an email to the agency | The agency profile read it needs is permitted by the snapshot's "Partners read lead agency profiles for their partnerships" policy |

No ruling needed: the intended status value is unambiguous in the code (`'active'`), the handler
exists, and it writes both fields. The accept path was never broken. It was unreachable.

## Every sibling instance found repo-wide

Grep was over `app/ lib/ components/ contexts/ scripts/` for every spelling of
`role === 'agency' | 'partner'` and `role !== ...`, then each hit read in context.

### Fixed - the same bug (a positive branch that serves the wrong half of a handler)

| File | What it was |
|---|---|
| `app/api/partnerships/route.ts:47` GET | The reported bug. Vendor served the agency query |
| `app/api/projects/route.ts:121, :358` GET | Vendor in the vendor portal served the agency project list |
| `app/api/projects/[id]/messages/route.ts:39, :60` GET | Same, for the message thread access check |
| `app/api/projects/[id]/messages/route.ts:157, :190` POST | Same, on the write path |
| `app/api/projects/[id]/messages/route.ts:251` | Notification `viewPath` picked the wrong portal for the recipient link |
| `app/api/projects/[id]/agreements/[agreementId]/route.ts:64-65` | `isPartner`/`isAgency` both keyed to `role`, so a dual-role vendor could never be `isPartner` and was **denied the right to sign their own assignment agreement** |

### Fixed - portal gates that backlog item P12 missed

P12 widened ~31 gates to `role || active_role` and left these. They fail closed rather than
serving wrong data, but they lock out exactly the accounts migration 056 created. Widened to
match `requireRole()` in `lib/api-auth.ts`, which is the repo's own established pattern:

| File | Gate |
|---|---|
| `app/api/partnerships/route.ts:314` POST | `role !== 'agency'` |
| `app/api/projects/[id]/route.ts:27, :64` | `role !== 'agency'`, twice |
| `app/api/projects/[id]/onboarding/deploy/route.ts:25` | `role !== 'agency'` |
| `app/api/projects/[id]/partner/route.ts:31` | `role !== 'partner'` |
| `app/api/agency/msa/ai-schedule/route.ts:78` | `role !== 'agency'` (portal line only) |
| `app/api/agency/payment-synthesis/route.ts:67` | `role !== 'agency'` (portal line only) |
| `app/api/agency/pool/[partnerId]/route.ts:75` | already correct; moved onto `canActAs` for one definition |

Blast radius of widening these: an account newly admitted is one with
`role='partner', active_role='agency'`. **No such account exists today** - the only
`role='partner'` accounts are `gmarkant@icloud.com` and `gmarkant+partner71@gmail.com`, both
with `active_role='partner'`. And `active_role='agency'` can only be written by switch-role,
which entitlement-checks first. So this widening grants nothing today and restores consistency
with the other ~40 routes.

### Fixed - a role read that should not have existed

`app/api/projects/[id]/agreements/[agreementId]/route.ts:103` read the **counterpart's**
`profiles.role` to choose which portal link to email them. Which side the counterpart is on is
already decided four lines earlier, by which side *we* are on
(`counterpartUserId = isPartner ? projectRow.agency_id : partnership.partner_id`). The role read
is now gone and `recipientIsAgency = isPartner`. It could not have been fixed with `active_role`
anyway: a recipient's current portal is not a fact this request can know.

### Flagged, not fixed - ambiguous, needs a ruling

**1. `app/api/partnerships/route.ts:393` - `if (partner && partner.role !== 'partner')` → 400
"Can only invite partner agencies, not lead agencies".**

This is the same 056 damage but about a *different person*, so `active_role` cannot answer it -
an invitee has no acting role in this request. It is nonetheless live and biting: 12 of 14
profiles carry `role='agency'`, so any invitee whose profile the session client can read is now
rejected as "a lead agency". It only fires when the profile *is* readable (an existing
partnership, or a discoverable profile), which is why new invitations still work and
re-invitations of existing pool members do not. Reproducible today against `info@ceoofgeo.com`.

Not fixed because choosing the replacement predicate is a product ruling, not a mechanical one:
`secondary_role === 'partner'` (true for 13 of 14 profiles, so nearly a no-op), or drop the check
entirely and let anyone be invited as a vendor. My recommendation is to drop it - the check
protects against a case the product no longer has, since every account is dual-role by default.

**2. The AI/upload entitlement gates** - `app/api/ai/route.ts:181`,
`app/api/ai/master-brief/route.ts:53`, `app/api/ai/rfp-output-template/route.ts:45`,
`app/api/documents/extract-text/route.ts:32`, `app/api/upload/route.ts:59`. All of the shape
`role === 'partner' || (role === 'agency' && is_paid !== false)`. These read `role` to decide
*entitlement*, not portal - a vendor gets AI free, a lead agency needs a subscription. Post-056
everyone reads as `'agency'`, so every vendor now hits the subscription branch. That is a real
behaviour change, but the correct fix depends on whether the free tier should follow the account
or the portal, which is Greg's call. Untouched.

**3. Display and signup reads of `role`** - `app/auth/confirmed/page.tsx:13`,
`app/auth/sign-up/page.tsx`, `app/admin/users/page.tsx`, `app/auth/callback/route.ts:44`. All
correct as-is: these are about the account, not the current portal.

---

# Item 2: one definition of an active partnership

## The shared predicate

`lib/partnership-state.ts`. Three exported tests and one label, accepting either the snake_case
shape the routes carry from Postgres or the camelCase shape the pool page renders:

- `isActivePartnership(row)` → `status === 'active'`. **The only test for active.** Never
  `partner_id`, never "a row exists".
- `wasInvitationSent(row)` → `invitation_sent_at` is present.
- `partnershipPoolColumn(row)` → `'network' | 'invited' | 'discovered'`. Exhaustive and mutually
  exclusive.
- `partnershipStateLabel(row)` → the human label, shared with the import dedup step so the
  importer cannot describe a row one way while the column it lands in describes it another.

`partner_id` means **claimed**, not active, and the two are no longer conflated anywhere. The
claim runs automatically on the vendor's next page load, which is precisely how never-accepted
invitations were being promoted into "Active vendors".

**On `network` vs `active`:** they are deliberately not synonyms. Column A holds
`status !== 'pending'`, so a suspended or terminated partnership stays beside the live ones,
badged for what it is. Refiling a terminated vendor under "Invited" would replace one lie with
another. The Active treatment *inside* the column is still `isActivePartnership()` alone.

**`invited_at` is retired.** `grep -rn "invited_at" app/ lib/ components/ contexts/` returns
only comments explaining the retirement, plus one unrelated hit
(`app/api/projects/route.ts:427`, a `project_assignments` response field of the same name, not
`partnerships.invited_at`). It was DB-defaulted at insert and equals `created_at` on every live
row, so it meant "added", not "invited". Every state and every date now reads
`invitation_sent_at`, `accepted_at` or `created_at`.

## Consumers moved onto it

`app/agency/pool/page.tsx` (all three columns, the import dedup label, the "new partnership"
window, the Active card's date), `app/api/agency/pool/[partnerId]/route.ts`,
`app/api/marketplace/discoverable/route.ts`, `app/partner/network/page.tsx` (both Agency Network
tabs), `app/agency/page.tsx`, `app/api/agency/dashboard/route.ts`,
`app/api/partner/dashboard/route.ts`, `contexts/lead-agency-filter-context.tsx`.

`app/api/agency/pool/[partnerId]/notes/route.ts` and `.../performance/route.ts` keep
`.eq("status","active")` in SQL - it is the same single predicate pushed into the query, and it
now carries a comment tying it to the helper.

## Before and after, per column

Computed from all 30 non-removed `partnerships` rows for `m a r k a n t`
(`79a82f92`), read-only, by applying both predicates to the live rows:

| Column | Before | After |
|---|---|---|
| A - Active vendors | **4** | **3** |
| B - Invited | **14** | **14** |
| C - Discovered | **12** | **13** |

Three rows move:

| Row | Vendor | Live state | Before → After | Why |
|---|---|---|---|---|
| `46f6ed86` | CEO of GEO | `pending`, `partner_id` set, `invitation_sent_at` **null** | A → **C Discovered** | Never active, and no invitation send was ever confirmed |
| `a45b1534` | partner23 | `pending`, `partner_id` set, invitation sent | A → **B Invited** | Invited, has not accepted. This is the required outcome |
| `27c9b339` | partner65 | **`active`**, `partner_id` **null** | B → **A Active vendors** | Its status already says active. See reconciliation below |

CEO of GEO landing in Discovered rather than Invited is the honest reading and worth flagging:
their `invitation_sent_at` is null, so by the only timestamp that means an email went out, no
invitation was ever confirmed sent to them. Open question 5 of the diagnosis (a silent Resend
failure on 2026-07-15, or a row predating the wiring) is unresolved and this makes it visible
rather than papering over it. Either way, the checklist requirement is met: **CEO of GEO no
longer appears as Active while pending.**

## Rows whose status disagrees with what the interface showed

**No database write was made.** Two rows are `status='active'` with `accepted_at = null`,
meaning they reached active without anyone pressing Accept (confirmed, `content-range 0-1/2`):

```
27c9b339  gmarkant+partner65@gmail.com  status=active  partner_id=NULL  accepted_at=null
e6361792  gmarkant+partner71@gmail.com  status=active  partner_id=set   accepted_at=null
```

`27c9b339` is the stranger of the two: active with no `partner_id` at all, which no reading of
the model justifies. Both now show as Active vendors, and after the Item 1 fix partner71 will
also see "Active Partnership" in My Agencies for something they never accepted. The SQL to
reconcile them is at the end of this document, for Greg to run. It is his ruling whether to
backdate them to pending or grandfather them.

---

# Item 3: the dead invitation mechanism

## Deleted

- `app/api/invitations/send/route.ts` (111 lines) - the only writer of
  `agency_partner_invitations`. The `app/api/invitations/` directory is now empty and removed.
- `handleConfirmPartner` in `app/agency/pool/page.tsx` (35 lines) - its only other write site.

## What the greps proved

Run over the **whole tree** (excluding `node_modules`, `.next`, `.git`), not just `app/`, per
doctrine:

| Term | Hits outside the two deleted call sites |
|---|---|
| `agency_partner_invitations` | `scripts/003_agency_partner_invitations.sql`, `docs/schema-snapshot-2026-08-13.md`, `docs/organizations-m1-discovery.md`, `docs/invitation-diagnosis.md` |
| `api/invitations` | `docs/organizations-m1-discovery.md`, `docs/invitation-diagnosis.md` |
| `handleConfirmPartner` | `docs/invitation-diagnosis.md` |

Every one of those is a *record of what exists*, not a caller. `contexts/` and `scripts/` were
both covered. **No caller was found, so nothing was stopped for.**

Two extra confirmations worth having:

1. The route was not merely uncalled, it could not have worked. It calls
   `supabase.auth.admin.inviteUserByEmail` on the **session** client, which has no admin
   privileges. Even a direct POST would have fallen into its `emailError` branch.
2. Verified by curl against the running dev server after deletion: `GET` and `POST` to
   `/api/invitations/send` both return **404**. Output under Executable verification.

## Templates and documents

**No email template references it.** `lib/email.ts` and `components/email-import-panel.tsx` were
checked; the branded email builder has no knowledge of this table or route.

**`LIGAMENT_CONTEXT.md` does not mention it at all** - grepped for `invitations/send`,
`agency_partner_invitations`, `handleConfirmPartner` and "Confirm Partner". Nothing. No context
edit was needed and none was made.

**Reported rather than edited**, per the brief:

- `docs/organizations-m1-discovery.md` lines 108, 143, 263, 504, 566, 585, 710, 734 describe
  `agency_partner_invitations` and `app/api/invitations/send/route.ts` as a live second
  mechanism. Those statements are now partly stale: the table still exists, the route does not.
  Left untouched - amending a prior discovery document is Greg's call.
- `docs/schema-snapshot-2026-08-13.md` lines 23-29 record the table's five policies. Those are
  still true and must stay true until the table is dropped.

## Deliberately left for the schema truth session

**The `agency_partner_invitations` table itself, and its five row level security policies.** The
table is not dropped, no migration is written. It holds 0 rows and no code touches it any more,
so it is inert but not gone. Dropping it belongs with the schema work that owns the snapshot.

Also left there: `scripts/003_agency_partner_invitations.sql`, which is the historical record of
how the table was created. Deleting it would not remove the table and would remove the evidence.

---

# Item 4: vendor profile visibility tiers

Not stopped. It came in at roughly the size of Item 2 - one route, one component, no schema
change - and reused `/api/marketplace/discoverable`'s masking pattern rather than inventing one.

## The pattern reused

`/api/marketplace/discoverable` returns discoverable profiles to any authenticated caller and
**nulls** `email` unless an active partnership exists. Two properties were copied exactly:

- The decision is made **server-side**. A field the caller is not entitled to is never put on the
  wire. This is not stylistic: row level security hands this route the entire profile row, so
  the route is the only place the decision *can* be enforced. It is never delegated to the
  component.
- Fields are **nulled, not omitted**, so the shape of the response does not itself signal what is
  being withheld.

## The six-cell matrix, after the change

| Vendor discoverable | Partnership | Before | **After** |
|---|---|---|---|
| yes | active | 200, full payload | **200, `tier:"partnership"`** - full payload, unchanged |
| yes | pending / suspended / terminated | **404** | **200, `tier:"public"`** - name, location, disciplines, bio, designations, insurance, company facts, website. Email, meeting link, rates, NDA/MSA state and delivery history nulled. `reason` names the current status; `unlock` says they open when the vendor accepts |
| yes | none | **404** | **200, `tier:"public"`** - same fields. `unlock` says to invite them |
| no | active | 200, full payload | **200, `tier:"partnership"`** - full payload, unchanged |
| no | pending / suspended / terminated | **404** | **200, `tier:"none"`** - no field of the vendor's profile at all. Returns only the agency's **own** partnerships-row record of the contact (`contact_name`, `company_name`, `partner_email`, `invitation_sent_at`, `status`), which is data the agency typed or imported themselves and already sees in the pool list. `reason` and `unlock` explain. This is CEO of GEO and partner23 |
| no | none | 404 "Vendor not found" | **403 with a reason and an unlock**: "This vendor's profile is private" / "They have not listed themselves in the marketplace, and you have no partnership with them." / "Invite them to your vendor network. Once they accept, their full profile opens to you." Rendered as an explanation, not a red error box |

The last row is the only cell where Postgres refuses too, which is exactly the cell the diagnosis
identified as the one legitimate refusal - and the route now says so in the place where the
database actually enforces it. With no partnership row and `is_discoverable = false`, none of the
five `profiles` policies matches, so the profile select comes back **empty** and the route never
gets to read `is_discoverable` at all. The refusal therefore sits on the empty-select path, not
after the tier decision. Putting it after the tier decision was the first attempt, and it was
wrong: that cell would have fallen through to the old "Vendor profile not found" 404 and stayed a
blank wall. Caught while verifying checklist step 15 against the snapshot's policy list.

## Field assignment

| Tier | Fields |
|---|---|
| public | `full_name`, `company_name`, `display_name`, `location`, `agency_type`, `bio` (rate JSON stripped), `business_criteria` (designations, insurance, company facts), `avatar_url`, `company_logo_url`, `website` |
| partnership adds | `email`, `meeting_url`, `rate_info`, `partnership.nda_confirmed_at` / `msa_confirmed_at`, `engagement_history`, and the agency's private notes (separate route, unchanged) |
| never | anything belonging to another agency |

The NEVER tier needed no new mechanism, and is unchanged: `partnership_notes` lives on the
caller's own `partnerships` row, `engagement_history` is `.eq("agency_id", user.id)`, and
`rate_info` goes through `resolveRateInfoForPartnership`, which is partnership-scoped.

One thing did tighten there. The parsed rate card is now withheld entirely below the partnership
tier. `resolveRateInfoForPartnership` falls back to a **legacy, unscoped** rate when no
per-partnership entry exists, and that legacy value is exactly the cross-agency leak the helper
exists to prevent. The bio is still parsed at every tier, because rate JSON can be embedded in
it and must be stripped either way - only the extracted rate card is dropped.

## Judgment call: website is public

Greg's PUBLIC list is "name, location, disciplines, bio, designations", which does not name
website, and "contact information" is listed under PARTNERSHIP. I put `website` in the public
tier and `email` + `meeting_url` in partnership. Reason: `/api/marketplace/discoverable`
**already returns `company_website` to any authenticated caller** for the same discoverable
profile, and masks only `email`. Withholding it here while the marketplace hands it over would
be two rules for one field, which is the thing this run is removing. If Greg wants website
behind the partnership tier, it is one line in
`app/api/agency/pool/[partnerId]/route.ts` and the marketplace route should change with it.

## Component changes

`app/agency/pool/[partnerId]/page.tsx`:

- The refusal is no longer a red box reading "Vendor not found". It renders the server's
  `error`, `reason` and `unlock`.
- Below the partnership tier the page shows an explicit panel naming what is closed and what
  opens it.
- The Rate information card, Engagement history card, Performance History block, Agency notes
  block and the NDA/MSA badges are all gated on the partnership tier. The badges matter: "NDA
  pending" on a vendor you have no partnership with asserts a document relationship that does
  not exist.
- Claimed contacts in the Invited and Discovered columns of `/agency/pool` gained a
  **View profile** link. After Item 2 they no longer sit in the column that had one, and the
  tiered page is the thing they should reach.

## Not done, and why

`partner.tags` is still `[]`. "Disciplines" reaches the page through `agency_type` only;
`profiles.capabilities` is not wired in, because the extractor for it
(`extractCapabilityValues`) is a private function inside `app/agency/pool/page.tsx` and hoisting
it to a shared module is a refactor this run did not need. It is a display gap that predates this
work, not a tiering gap - the field was not being sent before either.

---

# The 16 recipient addresses - confirm before pushing

Every `partnerships` row carrying `invitation_sent_at` with no `accepted_at`. Read-only,
`content-range 0-7/16` and `8-15/16`, split into two ranges so nothing was truncated at 100.
**Greg: confirm none of these is a real contact who should not be re-engaged before this is
pushed.**

| # | Recipient | Sent | Status | Claimed |
|---|---|---|---|---|
| 1 | **shola@serviceintelligencelabs.com** | 2026-06-10 17:11 | pending | no |
| 2 | **scott@searchgoodfriend.com** | 2026-06-10 20:02 | pending | no |
| 3 | **victoriacaro91@gmail.com** | 2026-06-10 20:28 | pending | no |
| 4 | **andrea@crescestudio.com** | 2026-06-10 20:44 | pending | no |
| 5 | **marcusliwag@gmail.com** | 2026-06-11 17:06 | pending | no |
| 6 | **gabriellamia.contact@gmail.com** | 2026-06-11 18:20 | pending | no |
| 7 | **ryan.ingrasin@gmail.com** | 2026-06-23 19:54 | pending | no |
| 8 | **fredsqueo@gmail.com** | 2026-07-08 15:19 | pending | no |
| 9 | gmarkant+pool1@gmail.com | 2026-07-17 13:56 | pending | no |
| 10 | gmarkant+compare@gmail.com | 2026-07-28 18:43 | pending | no |
| 11 | gmarkant+compare2@gmail.com | 2026-07-28 18:44 | pending | no |
| 12 | gmarkant+partner56@gmail.com | 2026-08-04 01:18 | pending | no |
| 13 | gmarkant+partner65@gmail.com | 2026-08-04 01:51 | **active** | no |
| 14 | gmarkant+partner64@gmail.com | 2026-08-04 02:54 | pending | no |
| 15 | gmarkant+partner71@gmail.com | 2026-08-14 14:12 | **active** | yes |
| 16 | gmarkant+partner23@gmail.com | 2026-08-14 14:43 | pending | yes |

**Eight of the 16 are real third-party addresses** (rows 1-8, bolded). Four of them are also
Ligament account holders in their own right: `victoriacaro91@gmail.com`,
`andrea@crescestudio.com`, `marcusliwag@gmail.com` and `fredsqueo@gmail.com`. After Item 1 ships,
**those four will see a pending invitation from `m a r k a n t` in their vendor portal the next
time they log in** - an invitation sent in June that has been invisible to them ever since. That
is the fix working as intended, but it is the outward-facing consequence of pushing, and it is
the reason this list exists.

The remaining eight are `gmarkant+` aliases and are test traffic.

Nothing in this run sent an email or triggered an invitation. Every request above was a GET.

---

# SQL for Greg

All read-only verification first. Nothing here has been run against the database as a write.

**V1 - read only. Confirm the two rows that are active without an acceptance.**
```sql
SELECT id, partner_email, partner_id, status, invitation_sent_at, accepted_at
FROM partnerships
WHERE status = 'active' AND accepted_at IS NULL;
-- expect exactly 2: 27c9b339 (partner65) and e6361792 (partner71)
```

**V2 - read only. Confirm the pool column counts this fix produces.**
```sql
SELECT CASE
         WHEN status <> 'pending' THEN 'A active vendors'
         WHEN invitation_sent_at IS NOT NULL THEN 'B invited'
         ELSE 'C discovered'
       END AS pool_column,
       count(*)
FROM partnerships
WHERE agency_id = '79a82f92-c2bd-42ab-90a8-0b4d54f9e043'
  AND status <> 'removed'
GROUP BY 1 ORDER BY 1;
-- expect A=3, B=14, C=13
```

**V3 - read only. Confirm partner23 can reach the vendor portal.**
```sql
SELECT id, email, role, active_role, secondary_role
FROM profiles
WHERE email ILIKE 'gmarkant+partner23@gmail.com';
-- expect role='agency', active_role='partner'
```

**V4 - read only. Who is discoverable, which decides the public tier.**
```sql
SELECT id, email, role, active_role, is_discoverable
FROM profiles WHERE is_discoverable = true;
-- expect exactly 2: gmarkant@gmail.com and gmarkant@icloud.com
```

**W1 - WRITE, Greg's ruling required. Backdate the two never-accepted "active" rows to pending.**
Only run this if the ruling is to reconcile rather than grandfather. Run V1 first.
```sql
UPDATE partnerships
SET status = 'pending', updated_at = now()
WHERE status = 'active' AND accepted_at IS NULL;
-- 2 rows. After this they leave Active vendors: partner65 -> Invited, partner71 -> Invited.
```

**W2 - WRITE, optional, only to make one checklist step testable.** Makes a second vendor
discoverable so the public tier can be seen from the `m a r k a n t` account. Equivalent to the
vendor toggling it themselves in their own settings, which is the preferable route.
```sql
UPDATE profiles SET is_discoverable = true
WHERE email ILIKE 'gmarkant+partner70@gmail.com';
-- revert with: UPDATE profiles SET is_discoverable = false WHERE email ILIKE 'gmarkant+partner70@gmail.com';
```

**Not written, and deliberately so:** any statement that changes `role` or `active_role`, and any
`DROP TABLE agency_partner_invitations`. Both belong to their own sessions.

---

# Executable verification

## The routes, curled against a running dev server

```
$ pnpm dev  (localhost:3000)

GET  /api/partnerships                                     -> 401  {"error":"Unauthorized"}
GET  /api/agency/pool/6d9ee132-3780-4933-8eed-8ba5990e9665 -> 401  {"error":"Unauthorized"}
GET  /api/projects                                         -> 401  {"error":"Unauthorized"}
GET  /api/marketplace/discoverable?role=agency             -> 401  {"error":"Unauthorized"}
GET  /api/invitations/send                                 -> 404  (Next.js not-found page)
POST /api/invitations/send                                 -> 404  (Next.js not-found page)
```

The 404s are Item 3 proved from the terminal: the route is gone, and a direct POST - the only way
it was ever reachable - no longer resolves. The 401s prove the changed routes still compile,
mount and reject an unauthenticated caller cleanly rather than throwing.

**What could not be curled, stated plainly:** an authenticated end-to-end request. There is no
test-account password in `.env.local`, and minting a session would have meant
`auth.admin.generateLink`, which the brief forbids as a side effect of testing. The two things
that would otherwise have been proved by an authenticated curl are proved below instead - the
branch decision by executing the helper, and the rows the branch returns by executing its
queries read-only.

## The branch decision, executed

`lib/acting-role.ts` run against every live profile shape plus the edge cases:

```
partner23 (role=agency, active_role=partner)   actingRole=partner  servedAgencyBranch=false canActAs(agency)=true
CEO of GEO (role=agency, active_role=partner)  actingRole=partner  servedAgencyBranch=false canActAs(agency)=true
gmarkant (role=agency, active_role=agency)     actingRole=agency   servedAgencyBranch=true  canActAs(agency)=true
icloud   (role=partner, active_role=partner)   actingRole=partner  servedAgencyBranch=false canActAs(agency)=false
active_role null, role=partner                 actingRole=partner  servedAgencyBranch=false canActAs(agency)=false
active_role null, role=agency                  actingRole=agency   servedAgencyBranch=true  canActAs(agency)=true
both null                                      actingRole=null     servedAgencyBranch=false canActAs(agency)=false
garbage active_role                            actingRole=null     servedAgencyBranch=false canActAs(agency)=true
```

Row 1 is the fix: partner23 is no longer served the agency branch. Rows 5-6 are the documented
fallback firing. Rows 7-8 are the null handling landing in the vendor branch. Row 8 is the case
that failed on the first attempt and produced commit `6d96a64`.

## The state predicate, executed

`lib/partnership-state.ts` run against the five live rows plus the two statuses that do not
currently occur:

```
c0851865 icloud          column=network     isActive=true  label="Active vendor"
a45b1534 partner23       column=invited     isActive=false label="Invited"
46f6ed86 CEO of GEO      column=discovered  isActive=false label="Discovered"
27c9b339 partner65       column=network     isActive=true  label="Active vendor"
e6361792 partner71       column=network     isActive=true  label="Active vendor"
hypothetical suspended   column=network     isActive=false label="Vendor (suspended)"
hypothetical terminated  column=network     isActive=false label="Vendor (terminated)"
```

## The queries the fixed branch runs, executed read-only

```
partner branch step 1 - partnerships WHERE partner_id = partner23:
  content-range: 0-0/1
  [{"id":"a45b1534-3215-4971-895a-fc9cd1fe967a",
    "agency_id":"79a82f92-c2bd-42ab-90a8-0b4d54f9e043",
    "status":"pending","invitation_sent_at":"2026-08-14T14:43:24.871+00:00","accepted_at":null}]

partner branch step 2 - unclaimed rows matching their email (the auto-claim set):
  content-range: */0        (nothing left to claim - the row is already claimed)

the OLD agency branch, for comparison - partnerships WHERE agency_id = partner23:
  content-range: */0        (this empty array is what "No invitations yet" was rendering)
```

That is the whole bug in three queries: the row the vendor needed was always there and always
RLS-visible to them, and the handler was running the query beneath it.

---

# Live checklist, in click order

Two commits' worth of behaviour, on `localhost:3000` or a preview deployment. **Nothing is
pushed.**

### A. The invitation becomes visible and acceptable

1. Sign in as **`gmarkant+partner23@gmail.com`**. You should land in the **vendor** portal, not
   the agency dashboard. (This already worked - their `active_role` is `partner`.)
2. Go to **`/partner/network`** → **Invitations** tab.
   **Expect: one invitation from `m a r k a n t`.** Before this fix this tab said "No invitations
   yet". This is the single load-bearing check in the whole run.
3. **My Agencies** tab → expect empty. They have not accepted yet.
4. **Discover** tab → `m a r k a n t` still appears. This worked before and must not regress.
5. Back on **Invitations**, click **Accept Partnership**.
   Expect: no alert, the row leaves Invitations and appears under **My Agencies** as an active
   partnership. Behind it, `status` becomes `active` and `accepted_at` is stamped.
6. The `m a r k a n t` account receives the "accepted your partnership invitation" email. Expect
   exactly one.

### B. The pool tells one story

7. Sign in as **`gmarkant@gmail.com`** and open **`/agency/pool`**.
8. **Column A "Active vendors"**: expect **4** rows now that partner23 has accepted -
   `gmarkant@icloud.com`, partner65, partner71, and partner23. (Before step 5 it is 3.)
9. **`info@ceoofgeo.com` must NOT be in Column A.** It is `pending` and was never confirmed
   sent, so expect it in **Column C, Discovered**, badged "Not Yet Invited". This is the
   "CEO of GEO no longer appearing as Active while pending" check.
10. **Column B "Invited"**: expect **13** after partner23 accepts (14 before). Every row is a
    contact who was actually sent an email and has not accepted.
11. **Column C "Discovered"**: expect **13**. Twelve import/ghost rows plus CEO of GEO.
12. Confirm no card in Column A carries a **Pending** badge. That combination is now
    unreachable.

### C. Profile visibility tiers

13. In Column A, click **View profile** on `gmarkant@icloud.com` (active partnership).
    Expect the **full** page: email, website, meeting link if set, NDA and MSA badges, Rate
    information, Engagement history, Performance History, Agency notes. Nothing lost.
14. In Column C, click **View profile** on **CEO of GEO** (claimed, pending, not discoverable).
    Expect **not** a 404 and **not** a red "Vendor not found". Expect the contact as your own
    pool recorded them, plus a **Limited view** panel saying their profile opens when they
    accept. No email of theirs, no rates, no notes block, no NDA/MSA badges.
    *This is the cell that used to be a blank wall.*
15. **Non-discoverable vendor, no partnership.** Open `/agency/pool/<any profile id you have no
    partnership with>` - `af0ef7a5-69bf-4725-bbd9-69ad348f4e4b` (`sbatty@thelab.co`) works.
    Expect a **403 rendered as an explanation**: "This vendor's profile is private", the reason,
    and "Invite them to your vendor network. Once they accept, their full profile opens to you."
16. **Discoverable vendor, no partnership.** **This step is not reachable today without a
    setup step** - only two profiles are discoverable and `m a r k a n t` has an active
    partnership with the only discoverable vendor. To test it, either have
    `gmarkant+partner70@gmail.com` switch on "discoverable" in their own vendor settings, or run
    **W2** above. Then open `/agency/pool/c582bf50-3d40-493a-b1dc-5228451174f7`.
    Expect a **Public profile** panel: name, location, type, bio, designations if any, website -
    and **no** email, **no** meeting link, **no** rate card, **no** NDA/MSA badges, **no**
    engagement history, **no** notes block, plus "Invite them to your vendor network. They open
    when the vendor accepts."

### D. Nothing else moved

17. `/agency/dashboard` - the vendor strip and the active-partner count still render.
18. `/partner/projects` as partner23 - still lists their assignments. (This is the
    `app/api/projects` sibling fix; a vendor with `role='agency'` was getting the agency list.)
19. `/agency/pool` → **Add Partner** → add a throwaway address. It lands in **Discovered**. Do
    **not** press Send Invitation unless you intend an email to go out.

---

# Judgment calls taken

1. **Branched on `active_role` with `role` as fallback only when unset**, and an unrecognized
   `active_role` resolving to null rather than to `role`. The brief's documented default, made
   strict in the one place it was ambiguous.
2. **A null acting role falls to the vendor branch.** That branch only returns rows keyed to the
   caller's own id or email, so it is the non-privileged default.
3. **Widened the seven portal gates P12 missed** rather than only fixing the branches. They are
   the same confusion failing closed instead of failing open, the repo already has an
   established pattern for them (`requireRole()`), and no account gains access today.
4. **Left the AI/upload entitlement gates and the invitee-role check alone** and flagged them.
   Both read `role` for something other than the acting portal, and both need a product ruling.
5. **Column A holds `status != 'pending'`, not `status = 'active'`.** Suspended and terminated
   partnerships stay beside the live ones rather than being refiled as "Invited". The Active
   treatment inside the column is still `isActivePartnership()` alone.
6. **CEO of GEO lands in Discovered, not Invited.** `invitation_sent_at` is null, and that is the
   only field that means an email went out. This makes diagnosis open question 5 visible.
7. **The Active card's date is now "Active since <accepted_at>" or "Added <created_at>".** With
   `invited_at` retired there is no honest third date, and inventing an "active since" from an
   invitation timestamp is exactly the kind of thing this run is removing.
8. **`website` sits in the public tier**, because `/api/marketplace/discoverable` already returns
   it to any authenticated caller. Flagged above as reversible in one line.
9. **Tier "none" returns the agency's own partnerships-row facts** (contact name, company name,
   the email they themselves recorded). It is their data and it is already on the pool list, and
   it is what keeps that cell from being the blank wall the brief forbids.
10. **Added a View profile link to claimed Invited and Discovered rows.** Item 2 moved those rows
    out of the only column that had one, so without this the tiered page would be unreachable
    from the pool.
11. **Left `scripts/003_agency_partner_invitations.sql` and the stale claims in
    `docs/organizations-m1-discovery.md` in place**, and reported them instead. Amending a prior
    discovery document is not this run's call.

# Not done, and why

- **No role or `active_role` backfill.** Forbidden by the brief and correctly so: 12 profiles
  carry `role='agency'`, the signup metadata in `auth.users` identifies which of them chose
  Vendor, and it needs a migration plus a ruling. Item 1 works correctly for dual-role accounts
  either way, which is the point of doing it this way rather than repairing rows.
- **No table dropped, no migration written, no database write of any kind.**
- **The two never-accepted "active" rows are not reconciled.** SQL W1 is above; the ruling is
  Greg's.
- **`app/api/partnerships/route.ts:393`** - the invitee-role check that now rejects most real
  invitees. Flagged with a recommendation, not changed.
- **The AI and upload entitlement gates.** Post-056 every vendor reads as `role='agency'` and
  hits the subscription branch. Real, out of scope, needs a product ruling.
- **`partner.tags` is still empty** - `profiles.capabilities` is not wired into the vendor
  profile page. Pre-existing display gap, not a tiering gap.
- **Nothing pushed.** Five commits, local only.

---

# Appendix: the full role table, read-only

All 14 profiles. `GET /rest/v1/profiles?select=id,email,role,active_role,secondary_role,is_discoverable`.

| Email | role | active_role | secondary_role | discoverable |
|---|---|---|---|---|
| andrea@crescestudio.com | agency | agency | partner | no |
| fredsqueo@gmail.com | agency | agency | partner | no |
| gmarkant@gmail.com | agency | agency | partner | **yes** |
| gmarkant@icloud.com | **partner** | partner | agency | **yes** |
| gmarkant+partner22@gmail.com | agency | agency | partner | no |
| **gmarkant+partner23@gmail.com** | agency | **partner** | partner | no |
| gmarkant+partner70@gmail.com | agency | **partner** | partner | no |
| gmarkant+partner71@gmail.com | **partner** | partner | partner | no |
| greg@withligament.com | agency | agency | partner | no |
| info@ceoofgeo.com | agency | **partner** | partner | no |
| marcusliwag@gmail.com | agency | agency | partner | no |
| mariannafayn@gmail.com | agency | agency | partner | no |
| sbatty@thelab.co | agency | agency | partner | no |
| victoriacaro91@gmail.com | agency | agency | partner | no |

Twelve of 14 carry `role='agency'`. Four carry `active_role='partner'`, and **three of those four
also carry `role='agency'`** - the exact shape that was being served the agency branch.
