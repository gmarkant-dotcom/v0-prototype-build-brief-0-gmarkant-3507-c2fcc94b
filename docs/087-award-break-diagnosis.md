# 087 broke the bid award path: diagnosis

**Status: diagnosis only. No code changed, no migration written, no fix applied.**

Observed locally, awarding a bid as markant:

```
partnerIdForResolution: c582bf50-3d40-493a-b1dc-5228451174f7
vendorEmail: null
message: new row violates row-level security policy for table "partnerships"
```

preceded by `[email] resolveOrgNotificationRecipients: no org_members rows, falling back to
the pre-079 profiles lookup` and `[email] resolveOrgNotificationRecipients resolved nobody`.

---

## Summary

The read that supplies `vendorEmail` is done with the **session client**, and every table it
touches is gated on a relationship that does not exist yet. It returns null, branch d of
`resolvePartnershipForAward()` inserts `vendor_org_id` set with `partner_email` NULL, and
087's narrowed INSERT policy refuses exactly that shape. 42501, HTTP 500.

**087 predicted this failure by name before it was applied.** `087:370-395`, "ORDERING
AGAINST THE CODE", describes this site, this branch, this null, and this refusal, and
PRE-FLIGHT **P3** is the query that was supposed to bound it:

```sql
SELECT count(*) FROM public.partnerships
WHERE vendor_org_id IS NOT NULL AND partner_email IS NULL;   -- EXPECTED: 0
```

with the instruction: *"If it is not 0, ship the code fix first (resolve the vendor email
from the magic token as the sibling branch already does) and apply this afterwards."* So
either P3 was not run, or it was run, returned non-zero, and the ordering instruction was
not followed. Worth knowing which, because a non-zero P3 also means live rows already carry
the shape and the pre-087 path had been producing it for a while.

---

## 1. Where `vendorEmail` comes from, and why it is null here

`app/api/agency/rfp-responses/[id]/route.ts:326-333`:

```ts
if (partnerIdForResolution) {
  const partnerProfile =
    (await resolveOrgNotificationRecipients(partnerIdForResolution, supabase))[0] ?? null
  vendorEmail = (partnerProfile?.email as string | null) || null
```

`supabase` here is the session client (`lib/supabase/server.ts`, line 26 of the route),
acting as the agency user. `resolveOrgNotificationRecipients` (`lib/email.ts:326-397`) makes
two reads, and RLS kills both:

**Read 1 - `org_members` where `org_id = c582bf50…`.** Two permissive SELECT policies exist
on that table and neither admits a counterparty's roster:

- `Members read their own membership row` (079:1736-1738) - `USING (user_id = auth.uid())`
- `Members read their organization roster` (086:148-150) - `USING (org_id IN (SELECT current_user_org_ids()))`

The vendor's org is not one of the caller's orgs, so this returns **zero rows for any
counterparty, always**. See the correction in section 2 - this is not evidence about the
vendor org's actual membership.

**Read 2 - the pre-079 fallback.** With no member ids, `lib/email.ts:349` sets
`lookupIds = [orgId]` and reads `profiles` by that id. For a legacy account this is the right
row: 079's PHASE 2 backfill created one organization per profile with **`organizations.id =
profiles.id`** (079:88, 280, 322), so `c582bf50…` is simultaneously the vendor's org id and
the vendor's profile id. The row exists. The caller cannot see it. `profiles` has exactly two
SELECT policies that could admit it:

- `Users can view profiles of partnership members` (079:1562-1567) -
  `USING (id = auth.uid() OR id IN (SELECT current_user_visible_profile_ids()))`, and
  `current_user_visible_profile_ids()` (079:766-777) is *own colleagues* UNION *members of
  `current_user_counterparty_org_ids()`*, which (079:738-756) is derived **from
  `public.partnerships` rows only** - "Partnerships only" is stated as the deliberate rule at
  079:721-728.
- `Authenticated users can read discoverable profiles` - `USING (is_discoverable = true)`
  (`docs/schema-snapshot-2026-08-13.md:202`), untouched by 079/085/087.

No partnership row exists yet - that is the entire reason the award path is in branch d - so
the first policy contributes nothing. The read therefore succeeds only for a vendor with
`is_discoverable = true`.

**Your hypothesis is confirmed, with one added condition.** The session client cannot read the
vendor's profile because no partnership exists yet *and* the vendor is not discoverable. The
second half matters: it is why this is not a total break. A discoverable vendor still awards
fine today, which is a bad failure signature - it looks account-specific and intermittent
rather than structural.

The chain then plays out mechanically in `lib/award-partnership-resolution.ts`: branch b
finds no active row, branch c's `orParts` contains only the `vendor_org_id` disjunct (the
`partner_email.ilike` disjunct is dropped because `normalizedEmail` is null) and finds
nothing, the branch-d recheck finds nothing, and the insert at `award-partnership-resolution.ts:144` writes
`vendor_org_id: partnerIdForResolution, partner_email: null` into 087's

```sql
vendor_org_id IS NULL OR public.org_has_member_with_email(vendor_org_id, partner_email)
```

Both disjuncts false. `org_has_member_with_email` explicitly returns false on a null email
(`087:513`, `AND p_email IS NOT NULL`), so it is false *for that reason alone* even before
membership is considered.

## 2. Correction: the org_members log line is not evidence the org is empty

> *"resolveOrgNotificationRecipients found NO org_members rows for that same org and resolved
> nobody. So 087's INSERT policy refuses it ... because the org has no members."*

The first half is right, the inference is not. Both `org_members` SELECT policies are scoped
to the caller's own organizations, so a **zero-row read of a counterparty's roster is the
expected, correct behaviour** and carries no information about what is in the table. The log
line means "RLS hid it", not "it is empty".

This distinction decides whether a fix is even possible:

- `public.org_has_member_with_email()` is **SECURITY DEFINER** (087:499-513), specifically so
  the policy can consult rows the caller cannot read - 087:476-481 says this in as many
  words. It sees the vendor's `org_members` row whether the agency can or not.
- 079's backfill created **one owner membership per profile** alongside each organization
  (079:280, "One organization per profile, id = the profile id. One owner membership").

So for a legacy vendor org, the membership almost certainly exists and
`org_has_member_with_email(c582bf50…, <vendor email>)` would evaluate **true** - if an email
were supplied. The insert is failing on the *null email*, not on an empty org. Confirm before
relying on it:

```sql
-- expect one row: the legacy vendor, org id == profile id
SELECT m.org_id, m.user_id, m.role, pr.email, pr.is_discoverable
FROM public.org_members m JOIN public.profiles pr ON pr.id = m.user_id
WHERE m.org_id = 'c582bf50-3d40-493a-b1dc-5228451174f7';
```

**A second thing the 42501 does not prove:** that `c582bf50…` names a real
`organizations` row at all. A WITH CHECK failure aborts the insert before the foreign key's
AFTER trigger fires, so an RLS refusal masks a would-be 23503. If this id arrived from
`partner_rfp_responses.vendor_org_id`, it was written by `app/api/rfp/guest/[token]/route.ts:603`
as `matchedProfile.id` - a **profiles** id in an organization column, the open V3
parameter-class defect 087:229-233 flags. That is accidentally correct for the sixteen legacy
accounts and a bad key for anything newer. Check directly:

```sql
SELECT id, name FROM public.organizations WHERE id = 'c582bf50-3d40-493a-b1dc-5228451174f7';
```

## 3. Is a vendor email available elsewhere? Yes - two of them, neither read on this branch

**a. `partner_rfp_inbox.recipient_email` - on the row the route has already fetched, and not
selected.** The award path's two inbox selects
(`app/api/agency/rfp-responses/[id]/route.ts:186` and `:230`) both read
`id, project_id, vendor_org_id, partnership_id, scope_item_name, master_rfp_json`. Adding one
column to a query the route already runs would put the address in hand with no extra round
trip.

Whether it is populated depends on which writer created the row, and the three writers split
cleanly:

| Inbox row origin | `vendor_org_id` | `partnership_id` | `recipient_email` | Reaches branch d? |
|---|---|---|---|---|
| Broadcast, pool vendor (`broadcast-rfp/route.ts:229-231`) | set | **set** (an active partnership is a precondition, `:213-222`) | **null** | No - branch a short-circuits |
| Broadcast, manual recipient (`broadcast-rfp/route.ts:374-377`) | set when the profile resolved | null when no active/pending partnership | **set** | **Yes** |
| Magic-token attach (`lib/magic-token-attach.ts:327-329`) | set | never written | **set** = `tokenRow.vendor_email` | **Yes** |

The one shape that has a `vendor_org_id` and no `recipient_email` is the pool-vendor row, and
that shape can never reach the resolver, because it always carries `partnership_id` and
branch a returns first. **Every inbox row that can actually hit this failure carries
`recipient_email`.**

Better still, on both of those rows the email and the org id were derived *from each other* at
write time - `existingProfileOrgId` comes from the profile matched on that same address
(`broadcast-rfp/route.ts:312-336`), and `magic-token-attach` writes `tokenRow.vendor_email`
next to the `partnerId` it was handed. That is precisely the invariant 087 enforces
(087:243-247, "Every legitimate writer derives the organization FROM the email address"), so
the value on the row is the one that satisfies the predicate.

**b. `rfp_magic_tokens.vendor_email`, keyed by `response_id`.** The route already runs this
exact query 15 lines below, in the sibling `else` branch (`:338-345`), and the agency can read
the table: `Agency can manage their own tokens`, `FOR ALL`,
`USING (org_id IN (SELECT current_user_org_ids()))` (079:1666-1668). It is only unavailable
when the bid did not originate from a magic link. This is the source 087:394 nominated.

**c. Nothing on `partner_rfp_responses`.** No email column - `scripts/014-partner-rfp-responses.sql`
carries `partner_display_name` (a denormalized name, explicitly "no cross-profile read
required") and nothing else. The third of the three inbox-less shapes, the token-only context
synthesized in-route at `:280-287`, gets `vendor_org_id` from `existing.vendor_org_id` and has
no inbox row to carry an address - it is (b) or nothing.

## 4. Secondary finding: the uncommitted H3 re-check is now dead code

Not the cause of this failure, but it is in the working tree, unpushed, on the same branch of
the same function, and it has the same root.

`app/api/agency/rfp-responses/[id]/route.ts:370-374` (uncommitted) now routes the
email->profile match through `resolveOrgIdForUser(matchedProfile.id, supabase)`.
`resolveOrgIdsForUsers` (`lib/entitlements.ts:439`) reads `org_members` **with the client it
is passed** - the session client here - and, per section 1, that read returns zero rows for
any user who is not the caller or a colleague. So `matchedVendorOrgId` is **always null for a
vendor**, `partnerIdForResolution` is never upgraded, the `partner_rfp_responses.vendor_org_id`
backfill never runs, and the path always logs `vendor matched by email belongs to no
organization, staying a guest` and falls through to the ghost insert.

The parameter-class change is correct - a profiles id had no business in that column. The
resolver it now depends on cannot be satisfied by a session client. Fixing the null email
in section 1 without noticing this leaves H3 permanently disabled.

The ghost insert it falls through to (`award-partnership-resolution.ts:176-184`,
`vendor_org_id: null`) satisfies 087's first disjunct, which is why the pure-guest branch of
the award path still works today and only the `vendor_org_id`-set branch broke.

## 5. What is not the cause

- **Not the trigger.** `partnerships_guard_identity_columns` is BEFORE UPDATE only. This is an
  INSERT, and the error text is the policy's, not the trigger's `RAISE`.
- **Not `lead_org_id`.** The lead half of the policy is unchanged character for character
  (087:548-551, policy body at 566-575) and `leadOrgId` is read under `.in("lead_org_id", callerOrgIds)`, so it is
  provably one of the caller's own orgs.
- **Not the `anon` REVOKE or the grants.** A missing EXECUTE grant raises 42501 from *inside*
  the function with a different message; this is the policy's own refusal text.
- **Not `existing.vendor_org_id` being stale.** Branch b/c would have found any partnership
  that existed under either id; the recheck immediately before the insert found none either.

## 6. Open questions a live query would settle

1. Which source supplied `c582bf50…` - `inboxRow.vendor_org_id` or `existing.vendor_org_id`?
   That decides whether an inbox row exists and therefore whether option 3(a) is available for
   this specific bid.
2. Does `c582bf50…` exist in `public.organizations`? (Section 2.)
3. Does it have an `org_members` row, and does that member's `profiles.email` equal the
   inbox/token vendor email? That is the whole predicate.
4. What does PRE-FLIGHT P3 return now? Non-zero means live rows already carry
   `vendor_org_id` + null `partner_email`, and those rows are unreachable by the email
   disjunct of branch c forever.
