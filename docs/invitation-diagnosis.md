# Vendor invitation diagnosis

Date: 2026-08-14. Diagnosis only. No application code was written, no migration was authored,
no write query was executed. Every database statement below was a read.

## How the live reads were taken, and what that means for "confirmed"

Row values were read over the Supabase REST endpoint using `SUPABASE_SERVICE_ROLE_KEY`, GET
requests only. The service role bypasses row level security, so **every row-existence finding
below is authoritative at the table level**: "confirmed absent" means absent from the table,
not merely invisible. Where it matters, the separate question of what a given caller's session
client would see under RLS is answered against `docs/schema-snapshot-2026-08-13.md` and is
labelled as such.

Per standing doctrine, PostgREST was used for row data only. No schema fact and no policy fact
in this document is inferred from PostgREST, from OpenAPI, or from the on-disk migration
history. Policy statements come from the snapshot; behaviour statements come from reading the
code in this repository.

Every count query was issued with `Prefer: count=exact` and the exact `content-range` total is
quoted, so no result here can be a silently truncated 100-row export.

## Correction to the brief's premise

The brief names the lead agency as "markant, greg@withligament.com". Those are two different
accounts. The agency that performed this invitation is **gmarkant@gmail.com**, `company_name`
"m a r k a n t", id `79a82f92-c2bd-42ab-90a8-0b4d54f9e043`.

`greg@withligament.com` (`1449da7d-...`) owns **zero** partnerships rows (confirmed,
`content-range */0`). All 30 partnerships rows in the database belong to `79a82f92`
(confirmed: rows with `agency_id != 79a82f92` returned `*/0`). Nothing else in this diagnosis
depends on the distinction, but the queries below are keyed to the correct account.

---

# 0.7 first: has an existing-account invitation ever been accepted?

## No. Not once. Not for an existing account, and not for a new one.

| Measure | Value | Source |
|---|---|---|
| `partnerships` rows, total | **30** | `content-range 0-0/30` |
| `partner_id IS NULL` (unclaimed) | **26** | `0-0/26` |
| `partner_id IS NOT NULL` (claimed) | **4** | `0-0/4` |
| `invitation_sent_at IS NOT NULL` (an invitation was actually sent) | **16** | `0-0/16` |
| `accepted_at IS NOT NULL` (someone accepted) | **1** | `0-0/1` |
| Rows that were both invited and accepted | **0** | intersection of the two lists below |

The single row with `accepted_at` is:

```
id            c0851865-8bb0-4417-aaf0-9185d1c83c7f
agency_id     79a82f92 (m a r k a n t)
partner_id    62f06418 (gmarkant@icloud.com)
status        active
invitation_sent_at  null      <-- never went through any invitation path
accepted_at   2026-03-27T14:29:26Z
created_at    2026-03-27T13:15:47Z
```

That is the seed partnership already documented in `LIGAMENT_CONTEXT.md` under Test Accounts.
It was created on 2026-03-27, accepted 74 minutes later, `invitation_sent_at` is null, and its
vendor `gmarkant@icloud.com` is one of only two accounts left in the database that still hold
`profiles.role = 'partner'`. It predates migration 056 by three months.

All 16 rows carrying an `invitation_sent_at` have `accepted_at = null`. The oldest is
2026-06-10. So the honest statement is:

> The vendor-side acceptance of a partnership invitation has worked exactly once, in March,
> for a `role='partner'` account, on a partnership that no invitation flow ever touched. Since
> the invitation flow began stamping `invitation_sent_at` on 2026-06-10, **16 invitations have
> been sent and zero have been accepted.**

Three rows currently read `status = 'active'`: `c0851865` (accepted, above), `27c9b339`
(partner65, `partner_id` still **null**) and `e6361792` (partner71, claimed). Two of those
three are active with `accepted_at = null`, meaning they reached "active" without anyone ever
pressing Accept. See "Rows that need reconciling" at the end.

---

# 0.1 / 0.2 / 0.3 The write trace and the read trace, side by side

## The gap in one line

Both sides use the **same table**, `partnerships`. They do not disagree about the mechanism.
`GET /api/partnerships` serves the vendor the **agency** branch of its own handler, because it
branches on `profiles.role` and every affected vendor's `profiles.role` is `'agency'`.

```
app/api/partnerships/route.ts:47
    if (profile?.role === 'agency') {        // <-- role, not active_role
        ... .eq('agency_id', user.id)        // rows where the VENDOR is the agency
    } else {
        ... .eq('partner_id', user.id)       // the branch the vendor needed
    }
```

partner23 has `role = 'agency'`. They therefore receive the list of partnerships in which
*they* are the lead agency, which is empty. "No invitations yet" and "No agency partnerships
yet" are both that empty array, rendered twice.

## 0.1 The write

Vendor Pool "Send Invitation" (Discovered column, `app/agency/pool/page.tsx:1963`) and "Resend
Invitation" (Invited column, `:1897`) are the **same handler**,
`handleSendOrResendInvitation` at `app/agency/pool/page.tsx:543`. Both POST to
`/api/agency/pool/resend-invitation`.

`app/api/agency/pool/resend-invitation/route.ts`:

| Step | What it touches |
|---|---|
| auth | `requireAgencyRole()` from `lib/api-auth.ts` |
| account probe | `hasLigamentAccount(vendorEmail)` -> `lib/server/account-existence.ts`, service role, `profiles.select('id').ilike('email', ...)`, returns a bare boolean and nothing else |
| email | Resend, via `buildBrandedEmailHtml` / `buildBrandedEmailText` |
| database write | `markPartnershipInvited()` -> `lib/partnership-invitations.ts` |

Template selection, branching only on `hasLigamentAccount`:

| Case | Subject | Body | CTA | CTA URL |
|---|---|---|---|---|
| account exists | "{agency} wants to connect with you on Ligament" | "...based on a bid you submitted. Sign in to view and accept the invitation." | View Invitation | `/partner/invitations` |
| no account | "{agency} added you to their vendor network on Ligament" | "Create your profile to be discoverable..." | Create Your Profile | `/auth/sign-up?email=...&source=pool_resend` |

The email partner23 received was the correct one. That branch works.

`markPartnershipInvited` (`lib/partnership-invitations.ts`) is the entire database write:

- Looks up an existing `partnerships` row by `(agency_id, partner_id)` if a `partnerId` was
  passed, then by `(agency_id, ilike partner_email)`.
- If found: `UPDATE partnerships SET invitation_sent_at = now(), updated_at = now()`. It does
  **not** touch `status`, and it does **not** set `partner_id` even when the invitee demonstrably
  has an account, because the route never passes `partnerId` (it only ever computed a boolean).
- If not found: `INSERT partnerships (agency_id, partner_id: partnerId || null, partner_email,
  profile_status, status: 'pending', invitation_sent_at)`.

Tables touched: **`partnerships` only.** `agency_partner_invitations` is not written by this
path.

For completeness, the other writers of the same table:

| Path | Row it produces |
|---|---|
| `app/api/partnerships/route.ts` POST (the "Add by email" modal, `/agency/pool`) | `status:'pending'`, `partner_id` set only if the session client could read the invitee's profile, `invitation_message`, then `invitation_sent_at` stamped after a successful send |
| `lib/server/partner-pool-import.ts` (spreadsheet import and Add Partner) | `partner_id: null` **deliberately, even when `matchedProfileId` is known**, `status:'pending'`, `profile_status:'unclaimed'`, plus the migration-068 columns `contact_name` / `company_name` / `phone` / `website`. Its own comment: "Activation only happens via invite -> accept." |
| `app/api/rfp/guest/[token]/route.ts` (guest bid via magic link) | Case 1 exact profile match: `status:'active'`, `partner_id` set. Case 2/3 ghost: `partner_id: null`, `status:'pending'` |
| `app/api/agency/email-scan/import/route.ts` | ghost row, same shape as the import path |

## 0.2 The read

All three Agency Network tabs live in one file, `app/partner/network/page.tsx`. `/partner/invitations`
is a redirect stub (`app/partner/invitations/page.tsx`) that forwards to `/partner/network`, so
the invitation email's CTA lands on this page.

| Tab | Data source | Filter |
|---|---|---|
| My Agencies | `fetch('/api/partnerships')` -> `partnerships` state | `p.status === 'active'` (`:533`) |
| Invitations | the **same** `fetch('/api/partnerships')` response | `p.status === 'pending'` (`:532`) |
| Discover | `fetch('/api/marketplace/discoverable?role=agency')` | server-computed `has_partnership` |

On mount the page also POSTs `/api/partner/partnerships/claim` (`:327`) and then re-fetches.

Inside `GET /api/partnerships`, the branch the vendor should have taken (`:157-264`) does the
right thing: rows by `partner_id`, plus rows by `ilike partner_email` with `partner_id IS NULL`,
auto-claiming the latter, then hydrating the agency profile. It is never reached.

Discover succeeds because `app/api/marketplace/discoverable/route.ts` never asks what role the
caller is. It runs one role-agnostic query:

```
.from('partnerships').select('agency_id, partner_id, status')
.or(`agency_id.eq.${user.id},partner_id.eq.${user.id}`)
```

and sets `has_partnership` from the presence of a row **at any status**. The client maps that
to `collaborated`, which renders the "Worked Together" badge (`app/partner/network/page.tsx:436`,
`:985`). So Discover finds the row by `partner_id`, which the other two tabs would also have
found had they been allowed to run their own partner branch.

Two consequences worth separating:

1. Discover proves the row exists and is RLS-visible to partner23. The data was never missing.
2. "Worked Together" fires on a `pending`, never-accepted, never-worked-on invitation. That is
   a second, independent defect in the same page: `has_partnership` conflates "a row exists"
   with "we have collaborated".

## 0.3 The gap, stated plainly

| | Pool "Send Invitation" | Vendor My Agencies | Vendor Invitations | Vendor Discover |
|---|---|---|---|---|
| Table | `partnerships` | `partnerships` | `partnerships` | `partnerships` |
| Route | `/api/agency/pool/resend-invitation` | `GET /api/partnerships` | `GET /api/partnerships` | `/api/marketplace/discoverable` |
| Keys on | `agency_id` + `partner_email` | branches on `profiles.role` | branches on `profiles.role` | `agency_id` OR `partner_id`, role-agnostic |
| Result today | row written | empty | empty | row found |

**The Organizations M1 discovery is right that two invitation mechanisms exist, but the second
one is not involved in this failure.** `agency_partner_invitations`:

- **0 rows in the entire table** (confirmed, `content-range */0` on an unfiltered count).
- Its only writer, `app/api/invitations/send/route.ts`, has **no callers anywhere in the
  repository** (grepped across `app/`, `components/`, `lib/`, `contexts/`, `scripts/`).
- Its only other write site, `handleConfirmPartner` at `app/agency/pool/page.tsx:874`, is
  defined but never referenced from JSX.
- Nothing reads it. Not the pool page, not the vendor page, not any API route.

So the two mechanisms have never disagreed, because only one of them has ever run. The pool
writes `partnerships`; the vendor tabs read `partnerships`; the legacy table is inert.

---

# 0.4 The actual rows for this case

## The partnership

Exactly **one** `partnerships` row matches `partner_email ilike 'gmarkant+partner23@gmail.com'`
OR `partner_id = 6d9ee132` (confirmed, `content-range 0-0/1`).

```
id                  a45b1534-3215-4971-895a-fc9cd1fe967a
agency_id           79a82f92-c2bd-42ab-90a8-0b4d54f9e043   (m a r k a n t)
partner_id          6d9ee132-3780-4933-8eed-8ba5990e9665   (NOT null - claimed)
partner_email       gmarkant+partner23@gmail.com
status              pending
profile_status      unclaimed
invitation_sent_at  2026-08-14T14:43:24.871Z
accepted_at         null
invitation_message  null
contact_name        g23
company_name        23
created_at          2026-08-14T14:42:53.410Z
updated_at          2026-08-14T14:44:34.839Z
```

**Confirmed present.** Also confirmed RLS-visible to partner23's own session client: the
snapshot's `partnerships` policy "Partners can view their partnerships", SELECT,
qual `(partner_id = auth.uid())`, matches this row. The vendor could see it. Nothing asked for it.

Reading the timestamps as a sequence:

| Time | Event | Evidence |
|---|---|---|
| 14:42:53 | Row created as a Discovered contact | `created_at`; `contact_name`/`company_name` populated and `partner_id` null are the signature of `lib/server/partner-pool-import.ts` (Add Partner / import), which sets those migration-068 columns and deliberately leaves `partner_id` null |
| 14:43:24 | "Send Invitation" pressed, email sent | `invitation_sent_at`, 31 seconds later, written by `markPartnershipInvited` |
| 14:44:34 | `partner_id` populated | `updated_at`, 70 seconds later. Consistent with the claim running when partner23 opened `/partner/network`. `profile_status` is still `'unclaimed'`, which is the fingerprint of `app/api/partner/partnerships/claim/route.ts` - it sets `partner_id` and `updated_at` but not `profile_status`, unlike the auth-callback claim which sets both |

`status` was never advanced and `accepted_at` was never written, because nothing offered
partner23 an Accept button.

## The legacy invitation

`agency_partner_invitations` filtered to this email or partner id: **confirmed absent**,
`content-range */0`. Unfiltered: **confirmed absent, the table holds 0 rows**.

Note on visibility: this read used the service role, so absence is absolute rather than an RLS
artifact. For the record, the snapshot's policies would have permitted partner23's own session
to see such a row anyway ("Partners can view their received invitations", SELECT, qual
`(partner_id = auth.uid()) OR (partner_email = (SELECT profiles.email ...))`).

## The profiles

```
gmarkant+partner23@gmail.com   id 6d9ee132   role agency   active_role partner
                               secondary_role partner   is_paid true   is_discoverable false
                               created_at 2026-06-23T19:12:11Z

gmarkant@gmail.com             id 79a82f92   role agency   active_role agency   is_admin true
```

All confirmed. `active_role` reads `partner` now because partner23 switched portals during the
reproduction; at the moment they clicked the email it was `agency` (see 0.6).

---

# 0.5 The claim path: is acceptance reachable at all?

## The RLS policy is real and is dead code.

Snapshot, verbatim:

```
partnerships, Partners can claim partnership by email, UPDATE, {public}, PERMISSIVE,
  qual ((partner_id IS NULL) AND (partner_email ~~* (SELECT profiles.email FROM profiles WHERE (profiles.id = auth.uid()))))
  with_check (partner_id = auth.uid())
```

Three code paths perform a claim. None of them depends on this policy:

| Path | Client | Uses the 045 policy? |
|---|---|---|
| `app/api/partner/partnerships/claim/route.ts` | **service role** (explicitly, with a comment saying so) | No. Bypasses RLS entirely |
| `app/auth/callback/route.ts:85` `claimPartnershipInvitations` | session client | Would use it, but only fires once, on the email-confirmation link |
| `GET /api/partnerships:207` auto-claim | session client | Would use it - but sits inside the partner branch that affected vendors never reach |

So the policy is exercised at most on a first email confirmation, and never again. It is not
what claimed partner23's row; the service-role route did that, 70 seconds after the invitation.

## Acceptance itself

Acceptance is `PATCH /api/partnerships` with `{status: 'active'}`. Its guard is
`isPartner = partnership.partner_id === user.id` (`:629`) and `partnership.status === 'pending'`
(`:767`). For partner23 both conditions are **already satisfied**. The route would work today
if it were called.

The only caller is `handleAccept` at `app/partner/network/page.tsx:349`, wired to the Accept
Partnership button, which renders only inside `searchedPendingPartnerships.map(...)`. That
array derives from the `/api/partnerships` response, which is empty. There is no other entry
point: no deep link, no email CTA that accepts directly, no notification action.

**Answer: acceptance is not reachable.** Not because the claim failed - the claim succeeded -
and not because the PATCH is broken - it is not - but because the button that calls it is
rendered from a list that the read path never populates. The invitation is accept-able in the
database and unaccept-able in the product.

This also explains the 0.7 number. 16 invitations, 0 acceptances, is not a low conversion rate.
It is a closed door.

---

# 0.6 The role finding, separate from the invitation finding

**These are two independent defects.** Fixing the role state would not make the Invitations tab
show anything, and fixing the read path would not stop vendors landing in the agency portal.

## Why an account intended as a vendor opens in the lead agency portal

Traced end to end:

1. The email CTA is `${siteBaseUrl()}/partner/invitations`, with no `next` or `redirect` param.
2. Unauthenticated, `middleware.ts` `buildAuthRedirect` sends the user to
   `/auth/login?next=/partner/invitations`.
3. `app/auth/login/page.tsx:16` reads that `next`, and after sign-in pushes
   `/partner/invitations`. The login page's own `userRole` fallback is not what fires here.
4. `middleware.ts:129`: `if (isPartnerRoute && activeRole === 'agency') -> redirect /agency/dashboard`,
   where `activeRole = profile.active_role || profile.role`.

Step 4 is the bounce. It is correct middleware behaviour given the profile; the profile is wrong.

## What actually sets `role` and `active_role`

The suspicion about migration 056 is correct, and it is worse than the trigger alone.
`supabase/migrations/056_*.sql` does two things:

- Replaces `handle_new_user()` to INSERT `role='agency', active_role='agency',
  secondary_role='partner', is_paid=true` **unconditionally**, ignoring the signup metadata.
- Backfills `UPDATE profiles SET role='agency', active_role='agency', ... WHERE secondary_role
  IS NULL OR is_paid = false OR is_paid IS NULL` - which rewrote the role of existing vendors.

The counter-pressure is `syncUserProfile` in `app/auth/callback/route.ts:44`, which forces
`role`/`active_role` back to `'partner'` when the signup metadata says partner. That correction
was added in `3d4349b`, 2026-08-06, "fix: vendor invitation signups landing in agency portal".
It runs only on the email-confirmation callback, and it backfilled nothing.

The live data resolves this cleanly. Signup metadata was read from the Supabase Admin users
endpoint (read-only GET):

| Account | Signed up as (`user_metadata.role`) | `profiles.role` today | Created |
|---|---|---|---|
| gmarkant@icloud.com | `partner` | **partner** | 2026-03-26, pre-056 |
| gmarkant+partner23@gmail.com | `partner` | **agency** | 2026-06-23, same day 056 shipped |
| gmarkant+partner70@gmail.com | `partner` | **agency** | 2026-08-06, before the fix deployed |
| gmarkant+partner71@gmail.com | `partner` | **partner** | 2026-08-07, after the fix |

**partner23 chose Vendor at signup and the database recorded Lead Agency.** That is migration
056's trigger overwriting the user's own selection, confirmed against the account's stored
signup metadata.

Across 14 profiles: 12 hold `role='agency'`, 2 hold `role='partner'`, 5 hold
`active_role='partner'`. Three of those five vendors are carrying `role='agency'`.

## So which is it, account-state artifact or invitation bug?

Both, and they are separable:

- **Account-state artifact.** partner23 shows as "Lead Agency" in the admin roster because
  `profiles.role='agency'`, written by 056's trigger against the signup metadata. It also causes
  the portal bounce, via middleware reading `active_role` (also set to `'agency'` by 056).
  Repairing partner23's row alone would fix the landing and the roster label.
- **Invitation bug, and it is the load-bearing one.** `GET /api/partnerships:47` branches on
  `profiles.role`. A dual-role user operating in the vendor portal - `active_role='partner'`,
  `role='agency'` - is served the agency branch. Repairing partner23's row would incidentally
  mask this by moving them to `role='partner'`, but the route would still be wrong for every
  genuine dual-role account, which is the default shape 056 created for everyone.

Backlog item P12 audited `role === "partner"` gates and widened ~31 of them to
`role || active_role`. It missed this one, because this is not a partner-side gate being
denied - it is a positive agency-side branch being taken.

The same unfixed pattern exists at `app/api/projects/route.ts:121` and
`app/api/projects/[id]/messages/route.ts:39,157,251`. A vendor with `role='agency'` in the
vendor portal gets the agency branch of the projects list too.

---

# 0.8 One state, two definitions

Reproduced exactly against live data. CEO of GEO:

```
id                  46f6ed86-7100-49a4-a7ac-622b389ca818
partner_id          bc6330d3 (set)          status  pending
invited_at          2026-07-15T19:01:24Z    invitation_sent_at  null
accepted_at         null                    profile_status      active
invitation_message  "Please join and play around!"
created_at 2026-07-15T19:01:24Z             updated_at 2026-07-16T00:04:12Z
```

## The two definitions, side by side

| | Pool list, Column A "Active vendors" | Profile detail `/agency/pool/<partnerId>` |
|---|---|---|
| Where | `app/agency/pool/page.tsx:1042` | `app/api/agency/pool/[partnerId]/route.ts:78-92` |
| Test | `partnerships.filter(p => p.partnerId)` | `.eq('agency_id', me).eq('partner_id', id).eq('status','active')` |
| Means | "this contact has claimed a Ligament account" | "this partnership is active" |
| CEO of GEO | included, badged **Pending** | `404 "No active partnership with this partner"` |

The list column asks whether `partner_id` is populated. The detail route asks whether `status`
is `'active'`. Those are different questions, and `partner_id` answers the wrong one: it tracks
account claim, not relationship state. Because the claim path (0.5) fires automatically on the
vendor's next page load, any invited vendor who merely signs in gets promoted into "Active
vendors" without ever accepting anything.

The column knows it is contradicting itself - it renders a **Pending** badge on a row it filed
under "Active vendors" (`:1667`), and the label reads "Invited {date}" whenever
`status === 'pending'` (`:1661`).

Partner 23 behaved identically for the same reason: at 14:44:34 the claim set `partner_id`, the
row jumped from Discovered straight into "Active vendors" with a Pending badge, and its detail
page 404s.

## A third definition, for the date

"Invited Jul 15" on that card is **not** `invitation_sent_at`. `partnerships` carries two
invitation timestamps:

- `invited_at` - legacy, DB-defaulted at insert. For CEO of GEO it equals `created_at` exactly.
- `invitation_sent_at` - migration 063, written only after a confirmed successful send.

The pool list reads `invited_at || created_at` (`app/agency/pool/page.tsx:451`), so Column A
says "Invited Jul 15" for a row whose `invitation_sent_at` is **null**. Meanwhile the Invited
and Discovered columns (`:1158`, `:1165`) split on `invitation_sent_at`. So "invited" means one
thing in Column A's date and a different thing in Column B's membership.

## Which is correct per the intended model

`status` is correct, and `lib/server/partner-pool-import.ts:257` states the intended model in
its own comment: *"status/profile_status (and partner_id) never change here. Activation only
happens via invite -> accept."*

Under that model:

- `partner_id` = has this contact claimed an account. It is an account fact.
- `status` = is this partnership active. It is a relationship fact.
- Column A is mis-titled and mis-filtered. "Active vendors" should be `status === 'active'`.
- The detail route's `status = 'active'` test is consistent with the model, but 404 is the wrong
  *response* for a pending partnership (see 0.9). Being right about the state does not make a
  blank wall the right rendering of it.
- `invited_at` should be retired in favour of `invitation_sent_at`, which is the only one of the
  two that means an email actually went out.

One caveat I cannot close: `invitation_message` is written only by `POST /api/partnerships`, and
`partner_id` was almost certainly null at that insert (the invitee's profile was unreadable to
the session client, which is exactly the problem `lib/server/account-existence.ts` was later
added for), with the Jul 16 00:04 `updated_at` being the claim. That reading is consistent with
every field, but the row carries no audit trail, so it is inference, not proof.

---

# 0.9 Vendor profile visibility

## What the route does today

`app/api/agency/pool/[partnerId]/route.ts` gates **everything** behind one query at `:78`.
Before a single profile column is read, it requires an `active` partnership; on miss it returns
`404 {error: "No active partnership with this partner"}` and stops.

Past that gate it returns, in one undifferentiated payload: `full_name`, `company_name`,
`display_name`, **`email`**, `bio`, `location`, `website`, `agency_type`, `avatar_url`,
`company_logo_url`, **`meeting_url`**, **`rate_info`**, `business_criteria`, plus
`partnership.nda_confirmed_at` / `msa_confirmed_at` and an `engagement_history` of awarded bids.

There is no middle tier. It is all, or a 404.

## Where the refusal is enforced

**In the route.** Not the database, not the component.

Checked against the snapshot's five `profiles` policies, all PERMISSIVE and therefore OR-ed:

| Policy | qual |
|---|---|
| Authenticated users can read discoverable profiles | `(is_discoverable = true)` |
| Agencies read profiles of their partners | `EXISTS (partnerships p WHERE p.agency_id = auth.uid() AND p.partner_id = profiles.id)` |
| Users can view profiles of partnership members | own row OR either direction of a partnership |
| Partners read lead agency profiles for their partnerships | mirror of the above |

Note what the second and third policies do **not** say: neither mentions `status`. **RLS already
permits an agency to read the full profile row of any vendor it has a partnership row with, at
any status**, and permits any authenticated user to read any `is_discoverable = true` profile
row in full, including `email`. The database is more permissive than the route by a wide margin.

The component (`app/agency/pool/[partnerId]/page.tsx:311-323`) only renders `error` in a red box
with a fallback of "Vendor not found". It applies no policy of its own. It is the blank wall,
but it is not the thing building the wall.

## The matrix as it behaves today

| Vendor discoverable | Partnership | Route today | RLS would permit |
|---|---|---|---|
| yes | active | 200, full payload | full row |
| yes | pending / suspended / terminated / removed | **404** | full row, twice over |
| yes | none | **404** | full row, via the discoverable policy |
| no | active | 200, full payload | full row |
| no | pending / etc. | **404** | **full row** - this is CEO of GEO and Partner 23 |
| no | none | 404 | denied - the only cell where the DB is the backstop |

Four of the six cells are refusals the database never asked for. In exactly one cell is the
refusal actually enforced by Postgres.

Live scope check: only **2** profiles carry `is_discoverable = true` (confirmed, `0-1/2`) -
`gmarkant@gmail.com` and `gmarkant@icloud.com`. Neither CEO of GEO nor partner23 is
discoverable. So today's basic tier, if built, would still show nothing for these two vendors;
their unlock is the partnership row, not discoverability.

## What each tier would require, against Greg's ruling

| Tier | Fields | Where they live now | Gate |
|---|---|---|---|
| Basic, any lead agency, no partnership | name, location, disciplines, bio, designations | `profiles.company_name` / `full_name` / `display_name`, `.location`, `.agency_type` + `.capabilities`, `.bio`, `.business_criteria` | `is_discoverable = true` |
| Full, partnership exists | + contact info, documents, rates, notes, delivery history | `profiles.email` / `website` / `meeting_url`, `profiles.rate_info`, `partnerships.nda_confirmed_at` / `msa_confirmed_at`, `partnerships.partnership_notes`, `partner_rfp_responses` | a partnership row - and Greg must rule whether that means any row or `status='active'`, which is the 0.8 question again |
| Never | another agency's private data | see below | never |

**Can the current data model express these tiers without a schema change? Yes.** Every field
already exists, and every cross-agency leak is already prevented by an existing mechanism:

- `rate_info` is already partnership-scoped by `resolveRateInfoForPartnership`
  (`lib/partner-rate-info-read.ts`), so one agency's negotiated rate is not visible to another.
- `partnership_notes` is a column on the agency's own `partnerships` row, and
  `GET /api/partnerships:259` already strips it before any vendor-side response.
- `engagement_history` is already filtered `.eq('agency_id', user.id)`, so it shows only work
  the calling agency itself awarded.
- `is_discoverable` already exists as the vendor's own consent flag for the basic tier.

The one thing to build is field-level masking in the route, and there is a working precedent to
copy rather than invent: `app/api/marketplace/discoverable/route.ts` already implements exactly
this two-tier shape - it returns discoverable profiles to any authenticated caller and nulls
`email` unless an **active** partnership exists. That is the pattern, in this repository, today.

Because RLS returns the full row for a discoverable profile, the masking **must** be done
server-side in the route. It cannot be delegated to the database, and it must not be delegated
to the component.

The refusal copy is also a route concern. The remaining correct refusal - non-discoverable
vendor, no partnership - should say what it is and what would unlock it, rather than "Vendor not
found", which is both unhelpful and false.

---

# Options for Greg

## Option A - make the vendor tabs read what the pool writes

Change `GET /api/partnerships:47` to branch on portal context (`active_role`, falling back to
`role`) instead of `profiles.role`. Optionally apply the same change to the sibling routes
listed in 0.6.

- **Cost:** small. One branch condition; the partner branch beneath it is already written and
  already handles the by-email and auto-claim cases.
- **Forecloses:** nothing. It does not touch the schema, the email, or the pool.
- **Rows needing reconciliation:** two rows become immediately visible as pending invitations to
  their vendors - `a45b1534` (partner23) and `46f6ed86` (CEO of GEO). Both are legitimate,
  both are genuinely pending, both would then be accept-able. Separately, `27c9b339` (partner65)
  and `e6361792` (partner71) are `status='active'` with `accepted_at = null`; under Option A
  partner71 would see "Active Partnership" in My Agencies for a partnership they never accepted.
  Greg should rule whether those two are backdated to pending or left as-is.

## Option B - make the pool write what the vendor tabs read

- **Cost:** high, and it rests on a false premise. The vendor tabs already read `partnerships`.
  Writing `agency_partner_invitations` as well would require building a vendor-side read path
  for a table that has never held a row, then keeping two tables in sync forever.
- **Forecloses:** the single-source-of-truth model, permanently.
- **Recommendation: no.**

## Option C - converge on one mechanism and retire the other

Declare `partnerships` the sole invitation mechanism. Delete `app/api/invitations/send/route.ts`
and the dead `handleConfirmPartner` at `app/agency/pool/page.tsx:874`. Drop
`agency_partner_invitations` and its five policies in a later migration.

- **Cost:** near zero.
- **Forecloses:** nothing anyone uses.
- **Rows needing reconciliation:** **none.** The table is empty, confirmed unfiltered.

## Option D - one definition of active (the 0.8 ruling)

Make `partnerships.status` the sole authority. Column A filters `status === 'active'`; claimed
but unaccepted rows render in a pending presentation. Retire `invited_at` in favour of
`invitation_sent_at`.

- **Cost:** small, and confined to `app/agency/pool/page.tsx`.
- **Forecloses:** nothing.
- **Rows needing reconciliation:** the same two, `46f6ed86` and `a45b1534`, which move out of
  "Active vendors". Plus the two active-without-acceptance rows above.

## Option E - tiered profile visibility (the 0.9 ruling)

Split `app/api/agency/pool/[partnerId]/route.ts` into basic and full tiers, mirroring the
masking already in `app/api/marketplace/discoverable/route.ts`, and replace the remaining 404
with a refusal that names its unlock.

- **Cost:** medium. One route, one component branch, no schema change.
- **Forecloses:** nothing. Depends on Greg's Option D ruling for what "partnership exists" means.

## Recommendation

**A + C + D, then E.**

A is the actual fix for the reported failure and is the smallest change in this document. C is
free and removes a decoy that has already cost one discovery cycle. D removes the contradiction
that makes the pool unreadable. E is real product work and should follow, not block, the other
three.

Handle the role repair (0.6) as a **separate** decision. It needs a migration, which this pass
is forbidden from authoring, and it is a data question rather than a code question: which of the
12 `role='agency'` profiles signed up as vendors and should be corrected. The signup metadata in
`auth.users` is the evidence and it is intact - partner23 and partner70 both carry
`user_metadata.role = 'partner'`. Do not ship a role backfill as a side effect of the invitation
fix; A works correctly for dual-role accounts either way, which is the point of doing A rather
than only repairing rows.

---

# Reuse versus build

## Reuse as-is

| File | Why |
|---|---|
| `app/api/partnerships/route.ts:157-264` | The partner branch is complete and correct. It needs to be reached, not rewritten |
| `app/api/partnerships/route.ts` PATCH `:767-815` | The accept path works. Its guards already pass for partner23 |
| `app/api/partner/partnerships/claim/route.ts` | The claim works. It ran, it succeeded, it is not the bug |
| `lib/server/account-existence.ts` | Correct email branching. The email partner23 received proves it |
| `lib/partnership-invitations.ts` | The write is fine |
| `app/api/marketplace/discoverable/route.ts` | Two precedents: the role-agnostic partnership lookup that Option A should match, and the tier masking Option E should copy |
| `lib/partner-rate-info-read.ts` | Already solves cross-agency rate isolation for Option E |

## Build

| Thing | Where |
|---|---|
| Portal-context branch | `app/api/partnerships/route.ts:47`, and the same pattern at `app/api/projects/route.ts:121`, `app/api/projects/[id]/messages/route.ts:39,157,251` |
| `has_partnership` vs "Worked Together" | `app/api/marketplace/discoverable/route.ts` sets the flag from any status; `app/partner/network/page.tsx:436,985` renders it as collaboration history |
| One definition of active | `app/agency/pool/page.tsx:1042`, `:451`, `:1661` |
| Tiered profile response and an explanatory refusal | `app/api/agency/pool/[partnerId]/route.ts:78-92`, `app/agency/pool/[partnerId]/page.tsx:311-323` |

## Delete

`app/api/invitations/send/route.ts` (no callers), `handleConfirmPartner`
(`app/agency/pool/page.tsx:874`, no callers), and eventually the
`agency_partner_invitations` table (0 rows).

---

# What I could not determine without Greg

1. **Whether `role` should be repaired, and for whom.** 12 profiles hold `role='agency'`. The
   signup metadata identifies which of them chose Vendor, but whether to rewrite a live
   account's role, and whether dual-role users should keep `role='agency'` with `active_role`
   doing the work, is a product decision. It also needs a migration, which this pass could not
   author.
2. **The two active-without-acceptance rows.** `27c9b339` (partner65, `status='active'` with
   `partner_id` still **null**, which no reading of the model justifies) and `e6361792`
   (partner71, active, never accepted). Backdate to pending, or accept them as grandfathered?
3. **What "partnership exists" unlocks in Option E** - any row, or `status='active'` only. Same
   question as 0.8, applied to visibility rather than to a column heading.
4. **Whether "Worked Together" should mean collaboration or connection.** Today it means a row
   exists. It could mean `status='active'`, or it could mean an awarded engagement, which would
   need `partner_rfp_responses`.
5. **Why `46f6ed86` (CEO of GEO) has `invitation_sent_at = null` despite an
   `invitation_message`.** Either the Resend send failed silently on 2026-07-15 (which is what
   backlog item P1 describes) or the row predates the `invitation_sent_at` wiring. The row keeps
   no audit trail either way. Vercel function logs for 2026-07-15 19:01 UTC would settle it; I
   did not query them.
6. **Whether the pool should set `partner_id` at invitation time** when
   `hasLigamentAccount()` already returned true. Doing so would let the vendor see the invitation
   before their next page load, but it writes a linkage from a boolean the route deliberately
   does not expose, and `lib/server/partner-pool-import.ts` deliberately leaves `partner_id` null.
   That deliberate choice deserves a ruling rather than a quiet reversal.
