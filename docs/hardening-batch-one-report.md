# Security and Hardening Batch One - Run Report

**Date:** Aug 13, 2026
**Baseline:** `2f6288f`. **Local only, nothing pushed.**
**Commits:** `cbba1b7` (1), `5cf88d0` (2), `89ff508` (4), `3553f9b` (5). Item 3 shipped no code, by its own rule.

---

## 1. THE ADMIN TOGGLE NO-OP (0.1) - CONFIRMED, and worse than described

`docs/schema-snapshot-2026-08-13.md` gives `profiles` **exactly six policies**:

| Policy | Cmd | Roles | Qual |
|--------|-----|-------|------|
| Agencies read profiles of their partners | SELECT | authenticated | `EXISTS (partnerships p WHERE p.agency_id = auth.uid() AND p.partner_id = profiles.id)` |
| Authenticated users can read discoverable profiles | SELECT | authenticated | `is_discoverable = true` |
| Partners read lead agency profiles for their partnerships | SELECT | authenticated | mirror of the above |
| Users can view profiles of partnership members | SELECT | authenticated | own row OR either side of a partnership |
| Enable insert for authenticated users only | INSERT | public | with_check `auth.uid() = id` |
| **Users can update own profile** | **UPDATE** | public | **`auth.uid() = id`** |

**One UPDATE policy. No admin policy of any kind. No DELETE policy at all.** The expected
finding is confirmed exactly.

### Which toggles existed, what each wrote, and which could ever work

| Toggle | Wrote | Could it ever work? |
|--------|-------|---------------------|
| Paid Status | `profiles.is_paid` on the clicked row | **Only on Greg's own row.** Every other row matched `auth.uid() = id` false, updated zero rows, reported success |
| Demo Access | `profiles.demo_access` | Same |
| Agency Access | `profiles.is_paid` (**not** `secondary_role` - see below) | Same |

All three were browser-client writes. Under RLS a blocked UPDATE is not an error: PostgREST
returns 2xx with an empty result set. The old code checked only `if (!error)`, so it always
took the success branch and flipped the switch in local state. **The panel has been reporting
success for writes that never happened, for every account except the admin's own.**

**Two side findings.** The button labelled "Agency Access" calls a function named
`grantAgencyAccess` that writes `is_paid`, not `secondary_role`. The route that would write
`secondary_role`, `/api/admin/grant-agency-access`, has **no caller anywhere in the repo**. The
mislabelling is pre-existing and is not fixed here; it is a UI-copy question, not a security
one, and fixing it silently would change what an admin thinks they are clicking.

---

## 2. ROUTE INVENTORY AND WRAPPER TRANCHE (0.2)

**110 API routes. 22 used `lib/api-auth.ts` at baseline, 88 did not.**

The headline risk was smaller than the brief assumed, and the shape is worth recording:
**only 8 of the 88 lacked a session check at all**, and 7 of those are deliberately public.

### Risk ranking

| Tier | Definition | Count | Disposition |
|------|-----------|-------|-------------|
| **1** | No auth, not intentionally public | **1** (`extract-google-doc`) | **Wrapped** |
| **2** | Calls `getUser()` but never returns 401 | 2 (`auth/google-email`, `auth/microsoft-email`) | **Skipped** - they redirect to login instead, which is correct for a browser OAuth start. The wrapper would replace a redirect with a JSON 401 and break the flow |
| **3** | Session-only check, hand-rolled, writes or serves company data | 11 | **9 wrapped**, 2 skipped |
| **4** | Session + role check, hand-rolled | ~67 | Deferred to the next batch |
| **n/a** | Intentionally public | 7 | Excluded, listed below |

### Wrapped this run: 10 files, 14 handlers

`extract-google-doc` (POST), `avatar` (GET), `upload/delete` (DELETE), `documents/[id]` (GET),
`documents/delete` (DELETE), `documents/upload` (POST), `notifications` (GET, PATCH),
`profile` (PATCH), `projects/[id]/assignments` (GET, POST, PATCH),
`partner/partnerships/claim` (POST).

Nine of the ten replaced a byte-identical `if (!user) return 401` with `requireAuth()`, so
behavior is unchanged. `extract-google-doc` is the one real gain: **it had no authorization at
all.** Both callers (`app/agency/page.tsx`, `app/agency/brief/page.tsx`) are authenticated
agency screens, so it was never meant to be public. It is **not** an SSRF vector - the fetch
target is rebuilt server-side from a regex-extracted document id and can only ever point at
`docs.google.com`. The exposure was unmetered anonymous use of the endpoint as a Google Docs
proxy.

### Deliberately excluded, with reason

| Route | Why |
|-------|-----|
| `rfp/guest/[token]`, `.../file`, `.../upload`, `.../attach-existing-account` | Guest RFP paths. Access is the magic token by design |
| `contact` | Public marketing form |
| `auth/check-email` | Runs before any session exists, by design |
| `admin/notify-new-user` | Supabase DB webhook, no session, `WEBHOOK_SECRET` header |
| `auth/google-email/callback`, `auth/microsoft-email/callback` | OAuth callbacks, authorized by the OAuth state parameter |

### Skipped despite qualifying

| Route | Why |
|-------|-----|
| `brief/save` | Falls back to verifying a bearer token via `serviceVerifier.auth.getUser(token)` when no cookie is present. `requireAuth` would reject those callers outright |
| `agency/library-documents/file` | Uses a single-line `if (!user) return ...` form the transform did not match. Correct as-is; deferred rather than hand-edited for one line |
| `auth/google-email`, `auth/microsoft-email` | Tier 2 above |

**Remaining unwrapped: 78.** Next batch continues at Tier 3 leftovers, then Tier 4, where each
route needs its role check read individually - the wrapper's `role === X || active_role === X`
is deliberately more permissive than some hand-rolled `role === X` checks, so those are not
mechanical.

---

## 3. RATE LIMITING (0.3) - NOTHING BUILT, DELIBERATELY

**There is no shared store in this project.** Checked and all negative:

- No `REDIS_*`, `UPSTASH_*`, `KV_*`, `EDGE_CONFIG` or equivalent in `.env.local` or
  `.env.production.local`.
- No `@upstash/*`, `redis`, `@vercel/kv`, `ioredis` or `@edge-runtime/*` in `package.json`.
- No existing rate-limiting code anywhere in `app/` or `lib/`.

Per the item's own instruction, **nothing was implemented.** Vercel Functions with Fluid
Compute reuse instances but do not share memory across them, so an in-process counter limits
one instance and lets every other instance through. Shipping one would have created a false
belief that the guest endpoints are protected, which is worse than the current honest absence.

### The unprotected surface, for whoever picks this up

| Route | Writes? | Current protection |
|-------|---------|--------------------|
| `POST /api/rfp/guest/[token]` | **Yes** - `partner_rfp_responses`, `partnerships` | Token validity only |
| `GET /api/rfp/guest/[token]` | No | Token validity only |
| `POST /api/rfp/guest/upload` | Blob write | Token validity only |
| `GET /api/rfp/guest/file` | No | Token plus blob-path match |
| `POST /api/contact` | **Yes** - `contact_submissions` | **None.** Unauthenticated insert |
| `GET /api/auth/check-email` | No | **None.** A user-enumeration oracle |

`rfp_magic_tokens` does carry RLS with one policy in the live snapshot, which resolves an item
my earlier M1 discovery marked UNCONFIRMED and flagged as the highest-value unknown. It is
protected. That constrains the damage but does not rate-limit anything.

### Options and costs

| Option | Cost | Notes |
|--------|------|-------|
| **Upstash Redis via Vercel Marketplace + `@upstash/ratelimit`** | ~30 min, free tier covers this volume | The standard answer. Sliding window by IP and by token. **Recommended** |
| **Vercel WAF rate limiting rules** | No code at all, configured in the dashboard | Per-path rules by IP. Cannot key on a token in the path segment as cleanly. Fastest to switch on |
| **Vercel BotID** | Small integration | Targets automation rather than volume. Complements, does not replace |
| **Postgres counter table** | A migration plus a write per request | Reuses infrastructure you have. Adds a DB write to every guest request, which is the wrong direction for the endpoints that are already the cheapest to abuse |
| **In-process counter** | 20 min | **Rejected.** Does not limit anything in a multi-instance deployment |

When implemented: key by IP **and** token, return bare 429 with no indication of which limit
tripped, and never log the token.

---

## 4. WHAT CHANGED, PER ITEM

### Item 1 - admin toggles actually write. `cbba1b7`

| File | Change |
|------|--------|
| `app/api/admin/users/[userId]/flags/route.ts` | **New.** `PATCH`. `requireAdminRole` first; service client constructed only after it passes; allow-list `is_paid`, `demo_access`, `is_admin`; **zero rows returned as 404, never success**; last-admin guard returns 409 |
| `app/admin/users/page.tsx` | Toggles call the route. Local state updated only from the row the server reports writing. Error banner added |

No RLS policy was added, per instruction. An "admins update all profiles" policy would let any
browser session holding an admin cookie write any column of any profile.

The **last-admin guard** counts admins with the service role inside the route. A browser-side
count would read 1, because the caller's own RLS scope on `profiles` cannot see other admins -
so the guard would have waved through exactly the write it exists to stop.

### Item 2 - wrapper tranche. `5cf88d0`

10 files, 14 handlers, listed in §2. Applied with a scripted transform so every site is
identical, then diff-reviewed and verified with curl.

### Item 4 - the ruled micro-items. `89ff508`

**(a) Attention queue client names.** Four row builders in `app/api/agency/dashboard/route.ts`
gained `clientName`; `app/agency/dashboard/page.tsx` threads it through four row types and
renders it as a muted mono segment beside the existing timeframe.

Sourced from `projects.client_name`, **not** from a join to `clients`. `lib/clients-server.ts`
is the single reconciler of those two fields and overwrites `client_name` from the client
profile's own name whenever `client_id` is set, so `client_name` already *is* the profile's
name. Adding a join would have created a second path that could disagree, which the
honest-data doctrine forbids. No `client_id` reaches the browser.

**(b) Guest currency "Other".** The guest form kept its own hardcoded ten-currency array while
the portal used the shared eleven-entry `BUDGET_CURRENCY_OPTIONS`. The guest list now **is**
that shared constant, so the duplication is gone rather than merely aligned.

Selecting Other reveals a "Which currency" field and submission is blocked until it is filled,
because `serializeBudget` drops an empty custom value and the agency would receive an amount
with no currency at all.

**Server-side bug found while doing this:** `app/api/rfp/guest/[token]/route.ts` ran
`.toUpperCase()` on the incoming currency, which turns `"Other"` into `"OTHER"` and misses
`serializeBudget`'s case-sensitive `currency === "Other"` check. Shipping the UI alone would
have stored a bid whose currency read as the literal string `OTHER` with the custom value
silently discarded. Fixed alongside.

**(c) Invitation copy for existing accounts.** The root cause was not the copy, it was the
lookup. Both routes asked "does this person have an account?" using the **caller's session
client**, and per the snapshot an agency can SELECT a profile only when it is their own, when
`is_discoverable = true`, or when a partnership already links them. **Inviting someone is by
definition the case where no partnership exists**, so the lookup returned null for every
invitee who has an account but is not discoverable, and they got signup copy.

New `lib/server/account-existence.ts` resolves the boolean with the service role and returns
**only** a boolean. It is never echoed in any response, so it cannot become an enumeration
oracle for a caller who should not have one. Both call sites are already authenticated.

In `app/api/partnerships/route.ts` only the email branch moved. The existing session-scoped
`partner` lookup still governs partnership linkage, the role check and the in-app
notification, all of which need a readable profile row. Changing those would have altered
partnership semantics, which is outside this item.

### Item 5 - documentation that lies. `3553f9b`

| File | Change |
|------|--------|
| `supabase/migrations/077_client_profiles.sql` | Header `NOT APPLIED` to `APPLIED`, citing the snapshot line that proves it |
| `supabase/migrations/075_*.sql`, `076_*.sql` | Status **left unchanged**, note added - see below |
| `LIGAMENT_CONTEXT.md` line 25 | `is_admin=false` to `is_admin=true` for `gmarkant@gmail.com` |
| `LIGAMENT_CONTEXT.md` | New section: the snapshot is authoritative, the migration history is not, plus the two consequences that keep producing bugs |

**I did not mark 075 and 076 applied.** The snapshot is a `pg_policies` dump; those two
migrations add columns, not policies, so it can neither confirm nor refute them. Claiming a
status I could not verify would have repeated the exact error being fixed. Each now carries a
note saying so, with the `information_schema` query that settles it.

---

## 5. EXECUTABLE VERIFICATION

`pnpm dev` on `localhost:3000`, no cookie, verbatim output.

```
=== ITEM 2: newly wrapped, no cookie (expect 401) ===
  GET    /api/avatar                                    -> 401
  DELETE /api/upload/delete                             -> 401
  GET    /api/documents/abc                             -> 401
  DELETE /api/documents/delete                          -> 401
  POST   /api/documents/upload                          -> 401
  GET    /api/notifications                             -> 401
  PATCH  /api/notifications                             -> 401
  PATCH  /api/profile                                   -> 401
  GET    /api/projects/abc/assignments                  -> 401
  POST   /api/projects/abc/assignments                  -> 401
  PATCH  /api/projects/abc/assignments                  -> 401
  POST   /api/partner/partnerships/claim                -> 401
  POST   /api/extract-google-doc                        -> 401
=== ITEM 1: admin flags, no cookie (expect 401) ===
  PATCH  /api/admin/users/abc/flags                     -> 401
```

Bodies are terse and identical:

```
$ curl -s -X PATCH localhost:3000/api/admin/users/abc/flags -H 'Content-Type: application/json' -d '{"is_paid":true}'
{"error":"Unauthorized"}
$ curl -s -X PATCH localhost:3000/api/admin/users/abc/flags -H 'Content-Type: application/json' -d '{}'
{"error":"Unauthorized"}
```

The second matters: the gate runs **before** the body is parsed, so an empty body still gets
401 rather than the 400 it would earn after authorization.

Deliberately public routes still reachable, confirming the tranche did not overreach:

```
  GET  /api/auth/check-email       -> 200
  GET  /api/rfp/guest/badtoken     -> 404   (token rejected, not auth)
  POST /api/contact                -> 400   (validation, not auth)
  POST /api/admin/notify-new-user  -> 401   (webhook secret, unchanged)
```

**Item 3 shipped nothing, so there is no 429 to demonstrate.**

**A correction to my own process.** My first pass at the Item 2 sweep used a shell loop whose
argument splitting was broken and printed `400` for four routes. Those numbers were an artifact
of my probe, not the routes. Direct single calls returned 401, and the table above is from a
corrected run. Recording it because a wrong green result is exactly the failure mode this
whole batch is about.

**Gates:** `npx tsc --noEmit` exit 0 and `pnpm build` exit 0 before each of the four commits.
ESLint report-only, not run as a gate.

---

## 6. JUDGMENT CALLS TAKEN

1. **Included `is_admin` in the flags allow-list** though no UI exposes it. The brief's
   last-admin guard requirement only makes sense if `is_admin` is settable, and it removes the
   need to hand-edit the database. The UI still offers no admin toggle, matching the existing
   "prevents accidental admin escalation" intent.
2. **Wrapped 10 routes, not 15.** The cap is a ceiling. Tier 4 routes each need their role
   check read individually, and the wrapper is deliberately more permissive than some
   hand-rolled checks, so batching them mechanically would have changed behavior.
3. **Used `client_name` rather than joining `clients`** for the attention queue, because
   `lib/clients-server.ts` already reconciles the two and a join would be a second source.
4. **Fixed the guest API's `.toUpperCase()`** even though the item named only the selector.
   Shipping the UI without it would have stored broken data.
5. **Moved only the email branch in `partnerships`**, leaving partnership linkage on the
   session-scoped lookup, to keep (c) to its stated scope.
6. **Left 075 and 076 marked NOT APPLIED** rather than guess.
7. **Did not fix the "Agency Access" mislabelling** or the dead `grant-agency-access` route.
   Reported instead; both are product-copy decisions.
8. **Read-only queries against live Supabase** with the service role already in `.env.local`,
   for the admin roster only. No write query ran at any point.

---

## 7. NOT DONE, AND WHY

| Not done | Why |
|----------|-----|
| Rate limiting | No shared store. Item 3's own rule forbids a fake limiter |
| 78 remaining unwrapped routes | Cap and correctness. Risk table above is the queue |
| `brief/save` wrapper | Bearer-token fallback would break |
| `agency/library-documents/file` wrapper | Single-line 401 form the transform did not match |
| Admin panel's other browser writes | None remain: all three toggles now go through the route |
| "Agency Access" writes `is_paid` not `secondary_role` | Pre-existing UI-copy bug |
| `/api/admin/grant-agency-access` has no callers | Reported in the previous run, still true |
| ESLint sweep, `hover:` sweep, onboarding page, Organizations M1 | Explicitly out of scope |
| Any RLS policy, migration, constraint or trigger | Explicitly forbidden |

---

## 8. HONEST VERIFICATION STATEMENT

**Executed, output pasted:**
- 14 curl probes against a live dev server, all 401, plus 4 public-route probes confirming no
  overreach.
- `npx tsc --noEmit` and `pnpm build`, both exit 0, before each of the four commits.
- Read-only REST queries establishing the `is_admin` roster.
- `git diff` review of every transformed route.

**Established by reading the authoritative snapshot, not by execution:**
- That `profiles` has exactly one UPDATE policy and no admin policy. This is the load-bearing
  claim behind Item 1 and behind (c). It comes from Greg's own `pg_policies` dump.

**Not verified by anything I ran - needs a browser or a real send:**
- **That an admin toggle now actually persists.** Every probe was cookieless, so **only the
  deny paths are proven.** The success path is unexercised.
- That the last-admin guard returns 409 in practice. It requires an admin session and a live
  admin count of 1; the live count is 2, so it cannot be triggered without changing data,
  which the doctrine forbids.
- That the attention queue renders client names.
- That the guest currency field behaves and round-trips.
- **That either invitation email now arrives with the correct copy.** This needs a real send to
  a real address that has an account and no partnership.

The success paths are the untested half of everything in this batch. The checklist is that gap.

---

## 9. LIVE CHECKLIST, IN CLICK ORDER

**A. Admin toggles - the headline fix.** Signed in as `greg@withligament.com`.

1. `/admin/users`. Pick **any account that is not yours.** Click Paid Status. It flips.
2. **Reload the page.** It is still flipped. Before this batch it silently reverted. This single
   step is the whole of Item 1.
3. Confirm in Supabase: `SELECT email, is_paid FROM profiles WHERE email = '<that account>';`
4. Toggle Demo Access on another account, reload, confirm it persists.
5. Click "Grant" under Agency Access on a vendor row. Note it sets **paid status**, not agency
   access. That mislabelling is pre-existing and deliberately unfixed.
6. **Force a failure:** with DevTools open, block `/api/admin/users/*` (or go offline) and click
   a toggle. **A red error banner must appear and the switch must not move.** A silent flip
   here means the regression is back.

**B. Last-admin guard.** Both known accounts are admins, so the guard cannot fire today.
To exercise it, temporarily clear `is_admin` on `gmarkant@gmail.com` in Supabase, then:

```bash
curl -i -X PATCH https://www.withligament.com/api/admin/users/<GREG_USER_ID>/flags \
  -H 'Content-Type: application/json' -b '<admin cookies>' -d '{"is_admin":false}'
```

Expect **409** and the "last admin account" message. Restore `is_admin` afterwards.

**C. Attention queue.** `/agency/dashboard`. Rows under "Needs your attention" show the client
name beside the row. A project with no client shows nothing extra, never a blank chip and never
a uuid.

**D. Guest currency.** Open a Lightning RFP guest link. In Budget, open the currency select:
**"Other" is present.** Pick it, leave the new field empty, submit: blocked with a message
naming the field. Fill it, submit, then confirm in `/agency/bids` that the bid shows the typed
currency rather than a bare number or the literal "OTHER".

**E. Invitation copy.** The one that needs a real send. Pick an email that **already has a
Ligament account and no partnership with you**, and is not discoverable.

7. `/agency/pool`, invite that address. The email subject and CTA must be the **connect**
   variant ("View Invitation", pointing at `/partner/invitations`), not "Create Your Profile"
   pointing at `/auth/sign-up`.
8. Resend to the same address. Same connect copy.
9. Invite a genuinely new address. It must still get the **signup** copy.

**F. Regression sweep.** Confirm nothing in the wrapper tranche broke a signed-in path: upload
an avatar, upload and delete a document, open a project's assignments, and paste a Google Doc
URL into the brief screen at `/agency/brief` (that last one exercises `extract-google-doc`,
which changed from no-auth to authenticated).
