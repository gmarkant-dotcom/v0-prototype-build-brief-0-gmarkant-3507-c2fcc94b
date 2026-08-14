# Admin Route Security Fix - Run Report

**Date:** Aug 13, 2026
**Branch:** `main`, local only. **Nothing pushed.**
**Commits this run:** `0a8a1fb` (Item 1), `fda45db` (Item 2), plus this report.
**Baseline:** `3026687`

---

## 1. THE GATING ANSWER (0.3) - no lockout, but read the second half

**`profiles.is_admin` exists, and Greg's account is flagged. The fix does not lock him out.
No SQL is required from him.**

Executed against the live database, read-only, service role, minimal projection:

```
GET /rest/v1/profiles?select=email,is_admin,is_paid,role&is_admin=eq.true

[{"email":"greg@withligament.com","is_admin":true,"is_paid":true,"role":"agency"},
 {"email":"gmarkant@gmail.com",   "is_admin":true,"is_paid":true,"role":"agency"}]
```

**Two accounts carry `is_admin = true`, not one.** This matters more than the lockout question,
because the fix moves in the opposite direction from the one the brief anticipated:

| Account | Admin access BEFORE this run | Admin access AFTER this run |
|---------|------------------------------|-----------------------------|
| `greg@withligament.com` | Yes, via the hardcoded email check | Yes, via `is_admin` |
| `gmarkant@gmail.com` | **No** - blocked by the hardcoded email check despite carrying `is_admin = true` | **Yes** |

`gmarkant@gmail.com` is listed in `LIGAMENT_CONTEXT.md` line 25 as the primary test account, so
this is almost certainly Greg's own second account and the widening is intended. **It is still a
real authorization change and it was not requested, so it is flagged here rather than buried.** If
that account should not have admin access, the correction is a one-line update Greg runs in
Supabase, given in §8.

Also note: `LIGAMENT_CONTEXT.md` line 25 records `is_admin=false` for `gmarkant@gmail.com`. Live
data says `true`. **The context file is stale on this point.** Not corrected this run - out of scope,
and the fix here reads live state, not the doc.

### The `profiles.is_admin` escape hatch is intact

The brief asked me to confirm from `docs/schema-snapshot-2026-08-13.md` that `is_admin` is not
itself governed by a policy that would prevent an admin from ever being created.

**I could not confirm this from that file, because the file does not contain the data.** Its
Policies section is the literal placeholder text `<PASTE THE FULL A0 OUTPUT HERE>` - the scaffold
was committed in `3026687` but the query output was never pasted in. What the file *does* carry is
a real prose finding: all 38 public tables have RLS enabled with at least one policy, none exposed,
none locked out, and `rfps` does not exist.

The substantive answer does not depend on the policy list. `is_admin` is set from the Supabase SQL
editor, which runs as a superuser where row level security does not apply, so an admin can always be
created regardless of what any policy says. The escape hatch cannot be closed by a policy.

**Open, and it matters for the admin panel:** the panel's Paid Status, Demo Access and Agency Access
toggles write to `profiles` from the *browser* client, so they depend on a live policy letting an
admin update other users' rows (`scripts/009` calls it "Admins can update all profiles"). Whether
that policy is live is UNCONFIRMED, and under RLS a blocked update returns success with zero rows
changed, so if it is missing the toggles have been failing silently all along. Query in §8.

---

## 2. ROUTE INVENTORY (0.1) AND CALLER MAP (0.2)

Four routes under `app/api/admin/`. Confirmed complete via `find app/api/admin -type f`.

| Route | Invoked by | Human or machine | Authorization BEFORE | Service role? | Returns |
|-------|-----------|------------------|----------------------|---------------|---------|
| `users` | `app/admin/users/page.tsx:59` via `fetch(..., {credentials:'same-origin'})` | **Human** | Session + `user.email === "greg@withligament.com"` | Yes | `select("*")`, up to 500 profiles, all companies |
| `grant-access` | The "Grant Access" CTA button in the new-signup email sent to `hello@withligament.com` by `notify-new-user`. Clicked from an inbox. | **Human**, but from email, not from inside the app | **No session check.** Per-user HMAC token in the query string only | Yes | HTML page |
| `grant-agency-access` | **No caller found anywhere in the repo.** | **Human** (by shape) | Session + hardcoded email | No | JSON |
| `notify-new-user` | Supabase DB webhook on new-user insert | **Machine** | `x-webhook-secret` header vs `WEBHOOK_SECRET` | No | JSON |

Nav entry point: `components/agency-layout.tsx:726` renders the `/admin/users` link, previously
gated on the same hardcoded email.

**Two caller-map findings worth Greg's attention, neither fixed (out of scope):**

1. **`grant-agency-access` is dead code.** Nothing calls it. The admin page has a function *named*
   `grantAgencyAccess` (`app/admin/users/page.tsx:115`), but it does not call this route - it
   writes `is_paid: true` directly through the browser client. So the button labelled "Agency
   Access" actually toggles paid status, and the route that would set `secondary_role: 'agency'` is
   never reached. It is secured this run regardless, because it is live and routable.
2. **Three of the panel's four write paths bypass the API entirely**, going straight from the
   browser to `profiles`. Those are governed by RLS, not by any route, so no route-level fix
   reaches them. This is the same class of issue as the Organizations M1 service-role work and is
   left for it.

---

## 3. THE REPORTED DEFECT THAT WAS NOT THE ACTUAL DEFECT

**Correcting my own prior report.** `docs/organizations-m1-discovery.md` rank 2 stated that
`grant-access` "takes its secret from the query string", that "the secret is the whole
authorization", and that "the secret must never appear in a URL". That characterization was wrong,
and it propagated into this run's brief. Reading `lib/grant-access-token.ts` shows:

- `GRANT_ACCESS_SECRET` **never appears in the URL.** The query string carries
  `<timestamp>.<hmac-sha256(userId:timestamp, secret)>`.
- The token is **scoped to a single user id**. It cannot grant access to anyone else.
- It **expires after 24 hours** (`MAX_TOKEN_AGE_SECONDS`), and rejects future timestamps.
- Comparison is **`timingSafeEqual`** on equal-length buffers.

That is a competently built capability token, not a leaked shared secret. The correction matters
because it changes the right fix: moving a well-formed capability token out of a URL that is
delivered *by email* would have broken the one-click workflow for no security gain.

**The actual defect, which is real and was not reported:** `GET` performed the write. The URL is
emailed to `hello@withligament.com`, and anything that follows links without a human deciding to -
a mail scanner, a corporate security gateway, a link-preview unfurler, a browser prefetcher -
granted paid access simply by touching it. A GET with side effects behind a URL that lands in an
inbox is the exploitable part, and it needs no attacker at all to fire.

---

## 4. HARDCODED-EMAIL AUTHORIZATION CHECKS (repo-wide)

Grepped all of `app/`, `lib/`, `components/`, `contexts/`, `scripts/`. **Authorization and gating
uses only.** `mailto:` links, `from:`/`to:`/`cc:` email addresses, seed data and test fixtures are
excluded as instructed and are not listed.

| File | Line | What it gated | Status |
|------|------|---------------|--------|
| `app/api/admin/users/route.ts` | 7, 19 | Server-side authorization for the whole user list | **Fixed** - `requireAdminRole` |
| `app/api/admin/grant-agency-access/route.ts` | 19 | Server-side authorization for a role grant | **Fixed** - `requireAdminRole` |
| `app/admin/users/page.tsx` | 27, 49 | Client-side gate; redirects non-matching users away | **Fixed** - reads `profiles.is_admin` |
| `components/agency-layout.tsx` | 251, 301 | Visibility of the admin nav link | **Fixed** - reads `profiles.is_admin` |

That is the complete list. After this run, `grep -rn "OWNER_EMAIL" app/ lib/ components/ contexts/`
returns exactly one hit, a doc comment in `lib/api-auth.ts` describing what was superseded.

One near-miss deliberately excluded: `app/auth/demo-access-denied/page.tsx:38` and
`app/pricing/page.tsx:99` embed `greg@withligament.com` in `mailto:` links. Contact details, not
authorization.

---

## 5. WHAT CHANGED, PER ITEM

### Item 1 - a single `requireAdmin` helper. Commit `0a8a1fb`

**Nothing new was built.** `lib/api-auth.ts` already contained `requireAdminRole`, already doing
exactly what the brief specifies - session or 401, `profiles.is_admin` or 403, read through the
caller's own cookie-scoped client. It carried a comment explaining that the real admin routes did
not use it and that wiring it in "would be a genuine authorization behavior change, not a
refactor". This run is that change.

| File | Change |
|------|--------|
| `lib/api-auth.ts` | Doc comment rewritten to state the contract, why the check must not use the service role, and why machine-invoked routes must not use it. 403 body narrowed from `"Admin only"` to `"Forbidden"`. |

No behavior change in this commit alone - nothing called the helper yet.

### Item 2 - every human-invoked admin route uses it. Commit `fda45db`

| File | Change |
|------|--------|
| `app/api/admin/users/route.ts` | `requireAdminRole` replaces the email check. `select("*")` narrowed to `id, email, full_name, company_name, role, is_paid, demo_access, created_at`. Driver error message logged, not returned. |
| `app/api/admin/grant-agency-access/route.ts` | `requireAdminRole` replaces the email check, and runs **before** the body is read. `error.message` no longer returned to the caller. |
| `app/api/admin/grant-access/route.ts` | Split GET from POST. GET verifies the token and renders a confirmation form, mutating nothing. POST verifies the token **and** requires an admin session, then grants. No query-string path still writes. |
| `app/admin/users/page.tsx` | Gate reads `profiles.is_admin`. `User` type drops `is_admin` and `secondary_role`, which it declared but never rendered. |
| `components/agency-layout.tsx` | Nav-link gate reads `profiles.is_admin`, folded into the profile select already being issued. No extra query. |

**Column reduction, derived by reading the page's JSX rather than guessing.** Rendered or used:
`id` (keys, toggle targets), `email`, `full_name`, `company_name` (rendered plus the search
filter), `role`, `is_paid`, `demo_access` (rendered plus stat tiles), `created_at`. Declared in the
type but read by nothing: `is_admin`, `secondary_role`. Both dropped.

**Row cap kept at 500 deliberately.** The brief said not to return more rows than the UI paginates.
The UI does not paginate - it renders one flat table with a client-side search filter, so 500 is
the entire result set, not a page size. Lowering it would silently hide accounts from Greg's own
tool. Left as a runaway guard and documented as such in the route.

**Service role retained, per route, only after the gate passes:**

- `admin/users` - **still required.** Listing every profile on the platform is the route's purpose,
  and the caller's own RLS scope on `profiles` is their own row plus discoverable and partnered
  profiles. No policy grants a cross-platform read.
- `grant-access` POST - **still required.** The target is an arbitrary new signup with no
  partnership or ownership relationship to the admin, so no `profiles` policy grants that write
  through the session client.
- `grant-agency-access` - **removed.** This write now goes through the admin's own session client,
  so it is governed by the same `profiles` policies as the panel's other toggles. If that update
  starts failing, it is the same missing-policy question raised in §1, surfacing honestly instead of
  being masked by a key that ignores policies.

### Item 3 - failure behavior, logging, lockout path. **No separate commit.**

Its three requirements were satisfied inside Items 1 and 2. I am not manufacturing a commit to have
one per item. Audited after the fact:

- **Terse bodies.** Every response body across all four routes is a static string:
  `Unauthorized`, `Forbidden`, `Internal error`, `Failed to load users`, `Failed to update access`,
  `Failed to notify about new user`, `Missing required record fields`, `userId and grant required`,
  `Required environment variables are not configured`. None varies with input.
- **No secret, token or profile row logged.** Nine log or Sentry calls across the four routes; all
  log a route tag plus either `error.message` or an exception. `admin/users` previously logged the
  whole Supabase error object and now logs `error.message`.
- **No input echoed.** `grep` for returned input or driver text finds nothing. The only
  caller-visible dynamic value anywhere is the granted account's own email on the grant-access
  success page, which is DB data shown to an authenticated admin and is HTML-escaped.

---

## 6. HOW GREG NOW INVOKES THE TWO GRANT ROUTES

### `grant-access` - the workflow is unchanged

**Nothing to relearn. Keep clicking the button in the email.** The link now opens a page with a
"Grant access" button instead of granting on page load. Click it and the grant completes.

The one new requirement: **be signed in to Ligament as an admin in that browser.** If not, the page
says so and the link stays valid for its full 24 hours, so signing in and clicking again works.

To drive it from a terminal, both steps, JSON accepted as well as form encoding:

```bash
# 1. Confirm the token is valid and see the confirmation page (writes nothing)
curl -i "https://www.withligament.com/api/admin/grant-access?user_id=<USER_ID>&token=<TOKEN>"

# 2. Perform the grant. Requires an admin session cookie.
curl -i -X POST "https://www.withligament.com/api/admin/grant-access" \
  -H "Content-Type: application/json" \
  -b "<your-supabase-auth-cookies>" \
  -d '{"user_id":"<USER_ID>","token":"<TOKEN>"}'
```

`<TOKEN>` is the one already in the email URL. There is no new secret to store anywhere.

### `grant-agency-access`

```bash
curl -i -X POST "https://www.withligament.com/api/admin/grant-agency-access" \
  -H "Content-Type: application/json" \
  -b "<your-supabase-auth-cookies>" \
  -d '{"userId":"<USER_ID>","grant":true}'
```

`grant: false` clears `secondary_role`. Requires an admin session. Reminder from §2: nothing in the
app calls this route, so this is currently its only invocation path.

---

## 7. EXECUTABLE VERIFICATION

Run against `pnpm dev` on `localhost:3000`. Commands and actual output, pasted verbatim.

### Every admin route, no cookie

```
### 1. GET /api/admin/users, no cookie
   status=401
{"error":"Unauthorized"}
### 2. POST /api/admin/grant-agency-access, no cookie
   status=401
{"error":"Unauthorized"}
### 3. POST /api/admin/notify-new-user, no secret header
   status=401
{"error":"Unauthorized"}
```

### `grant-access`, all four paths

To exercise the valid-token branches I restarted the dev server with
`GRANT_ACCESS_SECRET=throwaway-test-secret-not-production` and minted a matching token locally. **The
production secret was never read and never used.** Target id `11111111-1111-1111-1111-111111111111`,
confirmed afterwards not to exist.

```
### 4. GET /api/admin/grant-access, NO token
   status=403
### 5. GET /api/admin/grant-access, INVALID token
   status=403
### 6. POST /api/admin/grant-access, NO token
   status=403
### 7. GET /api/admin/grant-access, VALID token, no cookie  (must NOT mutate)
   status=200
<h1 style="font-size: 24px; margin-bottom: 12px;">Confirm access grant</h1>
<form method="POST" action="/api/admin/grant-access">
name="user_id"
name="token"
### 8. POST /api/admin/grant-access, VALID token, NO cookie  (the real gate)
   status=401
<h1 style="font-size: 24px; margin-bottom: 12px;">Sign in as an admin to continue.</h1>
```

Line 7 is the fix: a valid token on GET now yields a form, not a grant. Line 8 is the session gate
that did not exist before.

**Deviation from the brief's expectation, deliberate.** The brief expected 401 on every route with
no cookie. `grant-access` returns **403** on lines 4 to 6 because the token is checked *before* the
session. That ordering is intentional: a caller without a valid token gets one generic "invalid or
expired" response and cannot use the route to discover that an admin surface exists. The
descriptive sign-in message on line 8 is only reachable by someone already holding a correctly
signed, unexpired token.

### No writes occurred during verification

```
=== GET path: any mutation call? ===
   none - GET constructs no Supabase client and issues no write

=== admin accounts unchanged after verification ===
[{"email":"greg@withligament.com","is_admin":true,"is_paid":true},
 {"email":"gmarkant@gmail.com","is_admin":true,"is_paid":true}]

=== test uid 1111... exists? (expect empty) ===
[]
```

### Gates

`npx tsc --noEmit` exit 0 and `pnpm build` exit 0 before each of `0a8a1fb` and `fda45db`. ESLint
left report-only, not run as a gate.

---

## 8. SQL FOR GREG - none required, two optional

**No SQL is needed for the fix.** Both are optional follow-ups.

**(a) Only if `gmarkant@gmail.com` should NOT have admin access** (§1). Verify, change, verify:

```sql
SELECT email, is_admin FROM profiles WHERE email = 'gmarkant@gmail.com';
-- expect: is_admin = true

UPDATE profiles SET is_admin = false WHERE email = 'gmarkant@gmail.com';

SELECT email, is_admin FROM profiles WHERE is_admin = true;
-- expect: greg@withligament.com only
```

Run in the Supabase SQL editor, where row level security does not apply, so it works even if the
app is inaccessible.

**(b) Settles whether the admin panel's toggles actually work** (§1):

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd, policyname;
```

Look for an UPDATE policy letting an admin update rows other than their own. If there is none, the
panel's Paid Status, Demo Access and Agency Access buttons have been silently no-opping. This is
also the output that belongs in `docs/schema-snapshot-2026-08-13.md`, whose Policies section is
still the unfilled placeholder.

---

## 9. THE MIDDLEWARE FINDING (0.5) - CONFIRMED, reported not fixed

**Confirmed.** `middleware.ts:153`:

```
'/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
```

`api/` is excluded from the matcher, with the comment "api routes (allow direct access to API
endpoints)".

**One refinement to the claim, which matters for this fix.** The exclusion means API routes do not
get their session *refreshed* by the middleware. It does **not** mean they cannot read a session.
`createClient()` from `lib/supabase/server.ts` reads cookies through `next/headers` and works fine
inside a route handler for a valid, unexpired cookie. Confirmed empirically: 19 route files already
import `lib/api-auth.ts` and authenticate this way in production, and the previous versions of
`admin/users` and `grant-agency-access` did the same. Had this not been true, `requireAdminRole`
would have 401'd every caller and locked Greg out entirely.

The practical consequence is narrower than "routes cannot read sessions": a caller whose access
token has expired will not get it silently refreshed inside an API route, so they see a 401 where a
page would have transparently renewed. Not changed this run, per instruction.

---

## 10. JUDGMENT CALLS TAKEN

1. **Did not move the grant-access token out of the query string.** The brief's premise was wrong -
   there is no secret in the query string (§3). Removing a scoped, expiring, timing-safe capability
   token from an *emailed* URL would have broken the one-click workflow with no security gain.
   Fixed the actual defect, GET-with-side-effects, instead.
2. **Kept a GET on grant-access, rendering a form.** The brief said not to leave a working
   query-string path behind. GET still accepts the query string but performs no write; the only
   mutating path is POST. Read as compliant in substance.
3. **Added a session requirement to grant-access POST**, accepting that a not-signed-in admin now
   needs one extra step. The 24-hour token life makes the retry painless, and the page says exactly
   what to do.
4. **Left `notify-new-user` untouched.** Machine-invoked by a Supabase DB webhook, already
   protected by `WEBHOOK_SECRET`. `requireAdminRole` would have 401'd every real call and broken
   new-user signup notification silently - the failure the brief explicitly warned against.
5. **Secured `grant-agency-access` despite it having no callers.** Live and routable, so it gets
   the same treatment.
6. **Widened the UI gates too** (`app/admin/users/page.tsx`, `components/agency-layout.tsx`).
   Strictly beyond "API routes", but leaving them on the hardcoded email would mean
   `gmarkant@gmail.com` passes the API check while the page still redirects it away. A gate that
   disagrees with the thing it guards is a bug waiting to be filed.
7. **Kept `limit(500)` and did not add pagination.** The UI has none; reducing it would hide
   accounts from the admin's own tool.
8. **Dropped `is_admin` and `secondary_role` from the payload** and from the page's `User` type. The
   type declared them; the JSX reads neither.
9. **Ran read-only queries against the live database** using the service role key already present
   in `.env.local`, with minimal projections. The brief permits read-only SELECT for diagnosis and
   0.3 could not be answered otherwise. No write query was executed at any point.
10. **No Item 3 commit.** Its requirements were met inside Items 1 and 2; an empty commit to satisfy
    a numbering convention would be theatre.

---

## 11. NOT DONE, AND WHY

| Not done | Why |
|----------|-----|
| Middleware `api/` exclusion | Explicitly report-only (§9) |
| Re-scoping the other 20 service-role routes | Organizations M1 work |
| `notify-new-user` uses `!==` for its secret compare, not a timing-safe compare | Real but small finding. The brief said to leave that route unchanged this run |
| Sentry in `grant-access` may capture the request URL, and therefore the token, into a third-party service | Fixing it is a Sentry scrubbing config change, out of scope. Severity is much reduced now that a token alone cannot grant anything without an admin session |
| The panel's three browser-client writes to `profiles` | Governed by RLS, not by any route. No route-level fix reaches them |
| `grantAgencyAccess` in the UI sets `is_paid`, not `secondary_role` | Pre-existing UI bug, not a security defect, out of scope |
| `LIGAMENT_CONTEXT.md` line 25 stale on `is_admin` | Doc correction, out of scope |
| Returning 404 instead of 403 to non-admins | Item 1 explicitly specifies 401/403. Full non-distinguishability needs 404, which that spec forecloses. Bodies carry no distinguishing detail, which is the part I could satisfy |
| Non-admin account testing | No non-admin account available - both flagged accounts are admins |

---

## 12. HONEST VERIFICATION STATEMENT

**Executed by me, output pasted above:**
- `npx tsc --noEmit` exit 0 and `pnpm build` exit 0, before each commit.
- Eight `curl` probes against a live local dev server, statuses and bodies recorded verbatim (§7).
- Read-only `GET`s against the live Supabase REST API establishing the `is_admin` roster before and
  after, and confirming the test uid does not exist.
- `grep`/`awk` audits of logging, echoing, response bodies, and `OWNER_EMAIL` removal.

**Established by code inspection, not execution:**
- That GET on `grant-access` cannot write. Shown by the absence of any Supabase client construction
  or write call in the GET path, plus its 200 form response. **Not** proven by a before/after on a
  live row - doing that would have required granting paid access to a real production account,
  which the doctrine forbids.
- That the service role is still necessary for `admin/users` and `grant-access` POST. Reasoned from
  the policy shapes; the policy list itself is UNCONFIRMED because the snapshot is a placeholder.

**Not verified by anything I ran, browser required:**
- That a signed-in admin actually receives 200 from these routes. Every probe was cookieless, so
  **only the deny paths are proven.** The allow path rests on 19 existing routes using the same
  helper in production.
- That the admin panel renders correctly with the reduced column set.
- That the grant-access confirmation form completes a real grant end to end.
- That a signed-in **non**-admin receives 403. No such account exists to test with.

The success paths are the untested half. The checklist below is exactly that gap.

---

## 13. LIVE CHECKLIST

**Do the signed-out column first.** If any of those returns 200, stop and revert.

| # | Check | Expected |
|---|-------|----------|
| **Signed in as `greg@withligament.com`** | | |
| 1 | Admin link visible in the agency sidebar | Visible |
| 2 | `/admin/users` loads, table populated | Loads, all users listed |
| 3 | Table shows email, company/name, role, joined date, paid, demo | All render, no blanks from the column reduction |
| 4 | Search by email, name, company | Filters correctly |
| 5 | Toggle Paid Status | Flips and persists across reload. **If it silently reverts, see §8(b)** |
| 6 | Toggle Demo Access | Same |
| 7 | Open a grant-access link from a real signup email | Confirmation page, not an immediate grant |
| 8 | Click "Grant access" on that page | "Access granted." plus the account email; `is_paid` true in Supabase |
| **Signed in as `gmarkant@gmail.com`** | | |
| 9 | Admin link visible; `/admin/users` loads | **Now works where it did not before.** If unwanted, run §8(a) |
| **Signed out** | | |
| 10 | `/admin/users` in a private window | Redirects to login, no data flash |
| 11 | `curl https://www.withligament.com/api/admin/users` | `401 {"error":"Unauthorized"}` |
| 12 | `curl -X POST .../api/admin/grant-agency-access -d '{}'` | `401` |
| 13 | Open a valid grant-access link while signed out | Confirmation page; clicking gives "Sign in as an admin", **no grant** |
| 14 | Re-check that account in Supabase after 13 | `is_paid` **unchanged** |
| **Signed in as a non-admin** (create a throwaway account) | | |
| 15 | Admin link hidden; `/admin/users` redirects to `/agency` | Hidden, redirected |
| 16 | `curl` the routes with that session cookie | `403 {"error":"Forbidden"}` |
| **Regression** | | |
| 17 | Sign up a brand new account end to end | Signup completes; the `hello@withligament.com` notification email still arrives. **This is the `notify-new-user` webhook path - the one thing that would break silently if the shared secret had been touched.** |
