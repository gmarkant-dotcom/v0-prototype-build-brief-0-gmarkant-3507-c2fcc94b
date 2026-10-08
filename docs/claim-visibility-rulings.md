# The claim visibility limit: rulings owed

Branch `fix/post-093-cleanup`, 2026-10-08. **ANALYSIS ONLY.** This run wrote no policy, no migration and
no route, and ran no SQL. Nothing below is implemented, recommended, ranked, or marked as a default. The
options run from widest read exposure to narrowest, which is an ordering by scope and nothing else.

Evidence labels: **READ** (a file in this repo), **EXECUTED** (a result a person ran against the live
database and told us), **RECALLED** (Postgres behaviour I am stating from the documentation, not tested
here), **UNKNOWN** (needs a live check; it is on the checklist at the foot).

---

## What is broken, and why 093 did not fix it

093 fixed how a claim is MATCHED (`btrim` equality instead of `ILIKE`) and what a claimer may WRITE (the
permit list). It did not touch whether the claimer can SEE the row. That is a separate gate and it is
shut.

**The mechanism, from source (READ).** `supabase/migrations/079_organizations.sql:1469-1485` creates the
only two SELECT policies on `partnerships`:

| Policy | USING |
|---|---|
| "Agencies can view their partnerships" | `lead_org_id IN (current_user_org_ids())` |
| "Partners can view their partnerships" | `vendor_org_id IN (current_user_org_ids())` |

The four others (INSERT for agencies; UPDATE for agencies; UPDATE for partners; UPDATE for the claim)
grant no read. An unclaimed row has `vendor_org_id` NULL, so the second policy cannot admit it to anyone,
and the person it is addressed to is not in the lead organization, so the first cannot either.
093's own header records the live policy count as 6, which is these six (REPORTED, 2026-10-08).

**Why that defeats the claim (RECALLED).** An UPDATE whose WHERE or RETURNING names a column of the
table must also pass the table's SELECT policies; rows that fail them are dropped silently, with no
error. Every claim in the application names columns:

| Claim path | File | Shape |
|---|---|---|
| Sign-up confirmation | `app/auth/callback/route.ts:176-217` | SELECT ids `where vendor_org_id is null ... ilike partner_email`, then UPDATE with the same WHERE |
| GET auto-claim | `app/api/partnerships/route.ts:268-338` | SELECT `...is('vendor_org_id', null)`, then UPDATE `.eq('id', ...)` |
| Award claim | `lib/partnership-award-claim.ts:30-62` | SELECT ghosts by email, then UPDATE `.eq('id')` |
| Guest RFP link | `app/api/rfp/guest/[token]/route.ts:76-92` | UPDATE `.eq('id')` after a SELECT by email |

In each, the SELECT returns an empty array with no error, the code concludes "nothing to claim", and
returns success. **EXECUTED (user, 2026-10-08):** impersonating the claimer, `auth.uid()` was correct,
a count of the subject row returned 0, and a count of the whole table returned 0. The live data
matches the prediction: six unclaimed rows addressed to existing profiles, five of them on accounts
created after the invite (since at least June 2026). Four were backfilled by hand on 2026-10-08
(REPORTED); the brief calls the other two deliberate consent-rule exclusions (REPORTED; which rows they
are is not recorded in this repository). `docs/093-t15-investigation.md` has the full account.

**A separate defect, not this ruling.** An invite created for an account that already exists, with
`vendor_org_id` left NULL by the import sites, is never claimed even if claiming worked, because every
claim path runs only at sign-up or on a vendor's own list read. See `docs/093-t15-investigation.md`
section 7b.

---

## RULING 1. How should a person who is invited before they have an account get their invitation linked?

Four options. **None is recommended.** For each: what it does, what it costs, what it exposes, and **what
a stranger could see or do if it were built wrong.**

### Option A. A narrow SELECT policy on `partnerships` for the addressee

What: a new PERMISSIVE SELECT policy admitting a row when `vendor_org_id IS NULL` and the row's
`partner_email` equals the caller's email under `lower(btrim())`. The existing claim UPDATE would then
reach the row and every existing claim path would start working with no code change.

Costs:
- A policy change on a table whose policies were just rewritten in 093; a new pre-apply test.
- It also makes the row **readable**, not just claimable, for as long as it stays unclaimed.
- The email must be the caller's verified email. Two sources exist in this schema: `profiles.email`
  (guarded against self-writes by migration 091, READ) read through a subquery as
  `partner_rfp_inbox` policies already do (`079_organizations.sql:1363`), or a SECURITY DEFINER function
  such as `current_user_email()` (089). Whether the address is verified at the moment a session exists is
  **UNKNOWN** (see checklist: sign-in before email confirmation).

**What it exposes if built right.** Every column of the row, to the addressee, because RLS has no column
granularity. That row is the AGENCY's record about the vendor: `partnership_notes` (which holds the
agency's private flags, the `{blacklisted}` flag among them, per 093's header), `reliability_summary`
and its timestamp, `nda_confirmed_*`, `msa_confirmed_*`, `invitation_message`, `invited_at`,
`contact_name`, `company_name`, `phone`, `website`. **A vendor invited by an agency would be able to read
the agency's private notes about them, and whether they are blacklisted, before they have accepted
anything.** This is the central cost and it is not hypothetical. Avoiding it needs a view exposing a
safe column subset plus changes to every reader, which is a larger design than a policy.

**What a stranger could see if it were built wrong:**
- `ILIKE` or any pattern operator instead of equality: the same wildcard hole 093 just closed, now as a
  READ. An account whose email is `%@x.com`, or just `%`, reads every unclaimed row for that domain, or
  the whole table of unclaimed rows, including other agencies' private notes. This is a worse failure
  than the write version.
- `btrim`/`lower` on one side only: a mismatch that either hides a legitimate row or matches a
  near-miss address.
- NULL handling that lets `NULL = NULL` through: every row with no `partner_email` becomes readable to
  every account with no email.
- Keyed on an unverified email: anyone who signs up using a victim's address reads the victim's
  invitations. Whether this is reachable depends on the UNKNOWN above.
- A shared mailbox (`info@agency.com`): everyone with a profile at that address reads it. 079 already
  records this as an unresolved product question for the inbox policies ("an organization does not have
  one email address, so 'whose mailbox counts' is a decision, not a rewrite", `079_organizations.sql:1114`).
- The policy is permissive and ORs with the other two: a typo in the predicate widens, never narrows.

This option is a **read widening**, which is Greg's call.

### Option B. A server claim endpoint using the service role

What: one route authenticates the user from the session, derives the email from the verified session
user (never from the request body), resolves the caller's own organization the way
`resolveCallerWriteOrgId` does, and runs the UPDATE with the service client, which bypasses RLS and so
is not subject to the SELECT filter. It would replace the four dead paths with one.

Costs:
- A new route that uses the service role. This run was forbidden from adding the service role to any
  route that does not already use it (it would be Greg's decision in any case).
- The route is now the only gate for what the policies used to enforce: ownership proof lives in
  application code.
- What still protects it in the database (READ): 087's half of the guard applies even to the service
  role (it has no exemption), so the vendor org written must have a member whose profile email equals
  the row's `partner_email`. 093's permit list is exempt for the service role (`auth.uid() IS NULL`).

**What it exposes if built right.** Nothing new is readable. The response should carry a count, never
rows.

**What a stranger could see or do if it were built wrong:**
- Email taken from the request body: a stranger submits a victim's address and claims the victim's
  invitations into the stranger's own organization. 087's `org_has_member_with_email` check would refuse
  it (the stranger's organization has no member at that address) - that is a backstop, not a design to
  lean on.
- Email from the body also makes the endpoint an oracle for "does this address have unclaimed
  invitations, and how many".
- Returning the claimed rows instead of a count exposes the private-notes columns listed under A.
- Resolving the organization from the request instead of the session: claims into an organization the
  caller does not belong to.
- A WHERE that is `ILIKE`, or that omits `vendor_org_id IS NULL`: re-pointing, which 087 refuses for an
  already-claimed row, but only after the statement has begun.
- A missing role/session check: an unauthenticated claim of anyone's invitations.

### Option C. A SECURITY DEFINER function the caller invokes on themselves

What: a database function `claim_my_invitations()` with no parameters. It reads `auth.uid()`, the
caller's `profiles.email` and the caller's own organization, and performs the claim itself, returning a
count. The same shape as `accept_org_invitation` from migration 089, which already compares an
invitation address against `current_user_email()` (READ). Nothing becomes readable; the function reads
what the policies hide, on the caller's behalf, and only for the caller's own address.

Costs:
- A new function, a grant, and a pre-apply test; every caller site changes to call it.
- It is the pattern this schema already trusts for a nearly identical problem, which is a point in
  its favour and not a recommendation.

**What it exposes if built right.** Nothing beyond a count.

**What a stranger could see or do if it were built wrong:**
- Any parameter naming an email or an organization turns it into the Option B failures above, from inside
  the database and without a route's session check in front of it.
- Granting EXECUTE to `anon`: the function reads `auth.uid()`, which is NULL, so it should do nothing,
  but 087's note on `org_has_member_with_email` records that `CREATE FUNCTION` here grants `anon`
  execute unless revoked, so the revoke must be explicit.
- A missing `SET search_path`: the standard SECURITY DEFINER hijack. Every function in this schema
  pins `public, pg_temp`.
- Returning a row or an organization id instead of a count: `org_has_member_with_email`'s own comment
  warns against exactly this ("a confirm-oracle into a lookup-oracle").

### Option D. Leave it manual and accept that stranded rows need a backfill

What: no code or policy change. Stranded rows are found by a query and linked by hand, as four were
today.

Costs:
- Every invitation to a vendor without an account at the time is stranded until someone notices. There
  is no error and no log line: the code reports success. The 2026-10-08 evidence is five rows over at
  least four months, found by chance.
- Requires a recurring detection query and a named owner; `docs/post-093-cleanup-report.md` section on
  the backfill queries has the read-only checks.
- The vendor sees an empty portal and no explanation, which is the failure diagnosed on 2026-08-14 and
  described in the callback's own comment.

**What it exposes.** Nothing.

**What a stranger could see if it were built wrong:** nothing; there is nothing to build. The risk is
in the manual write: a hand backfill that links `vendor_org_id` to the wrong organization. 087's guard
refuses an organization with no member at that address, which would have caught that for the four rows
done today.

### A smaller step that sits beside any option: stop reporting success on a silent zero

Independent of the ruling: the four claim paths return success when their SELECT is empty. A
`console.error` on "found 0 candidate rows for a user who signed up with an invitation outstanding"
cannot be written without knowing there were rows, so this needs the DB's view (an owner-side count),
which is Option B or C. Listed so it is not forgotten, not as a fifth option.

---

## RULING 2 (separate, raised by the same evidence). Should an invite to an existing account be linked at creation?

The sixth stranded row predates its invite. The import sites hard-code `vendor_org_id: NULL`
(`lib/server/partner-pool-import.ts:299`, `app/api/agency/email-scan/import/route.ts:115`) even when
they have just matched the address to a profile, with the stated intent "activation only happens via
invite then accept". Linking at insert would make the row visible to the vendor immediately; it is also
the point at which a vendor first sees an agency's private context. Not a claim-visibility question, but
no claim fix helps it.

---

## What I could not establish

- The live SELECT policy list is **not** known to match 079. The 6-policy count is REPORTED and matches;
  the names and predicates are not.
- Whether a session can exist before email confirmation, which decides whether "verified email" is a
  property the database can rely on or must check. This is a Supabase project setting I cannot read.
- The exact ILIKE/equality behaviour of the candidate policy under real data. Nothing was run.

## Live checklist (nothing run by me)

1. `SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname='public' AND tablename='partnerships' ORDER BY cmd, policyname;` - expect the six above and no SELECT policy mentioning `partner_email`.
2. Dashboard: Authentication, Providers, Email: is "Confirm email" on? Can a user hold a session before confirming?
3. Is `profiles.email` always equal to `auth.users.email` for the six rows' accounts (migration 091's comment says a divergence is permanent)?
4. How many rows match the detection query in `docs/post-093-cleanup-report.md` today?
5. Does anything service-role-side already claim ghosts (the guest RFP and award paths use the session client; confirm no other)?

## Merge-state

This document asserts no merge state. Check with `git merge-base --is-ancestor <sha> main`.
