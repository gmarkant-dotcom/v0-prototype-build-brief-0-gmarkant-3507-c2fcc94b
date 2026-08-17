# 078 amendment, and widened signup notification recipients

Run date: 2026-08-17. Two commits, both local, nothing pushed. No migration applied,
no write query executed against the live database.

| Commit | Item |
|---|---|
| `70fee99` | Amend `supabase/migrations/078_signup_role_trigger.sql` |
| `cc719ab` | Widen `app/api/admin/notify-new-user/route.ts` recipients, fix the `company_name` lookup |

---

## Item 1. What changed in 078, and why

### The abort that was waiting to happen

As authored, 078 inserted into `email_verified`. That column does not exist on
`public.profiles`. The migration would have raised `42703` and aborted on the first
statement, leaving the live `handle_new_user` untouched and the signup role bug
unfixed. It also carried `is_paid = true` and two hardcoded comparisons of `NEW.email`
against the literal `'greg@withligament.com'`.

### The five changes

1. **`email_verified` removed** from the column list and the values list entirely.
2. **`is_paid` removed.** The column is `boolean` and defaults to `FALSE`. New signups
   land unpaid.
3. **`is_admin` removed.** Same. The first hardcoded `greg@withligament.com` comparison
   leaves the database.
4. **`demo_access` removed.** Same. The second hardcoded comparison leaves the database.
5. **Header rewritten** now that appendix query A8 has been run.

Everything else is untouched: the `SET search_path = public, pg_temp` pin, reading
`raw_user_meta_data->>'role'`, deriving `secondary_role` as the opposite of the chosen
role, and the `ON CONFLICT (id) DO UPDATE` clause that deliberately omits the three role
columns from its update list.

### Final column list

```sql
INSERT INTO public.profiles (
  id, email, full_name, company_name,
  role, active_role, secondary_role
)
VALUES (
  NEW.id,
  NEW.email,
  COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
  COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
  chosen_role,
  chosen_role,
  other_role
)
```

Seven columns. Down from eleven.

### Proof that every column exists

**What I could not do.** `information_schema` is not reachable from this environment.
`psql` is not installed on the machine, no Postgres driver is a project dependency,
`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` and `POSTGRES_PASSWORD` are all empty in
`.env.production.local`, and Supabase does not expose `information_schema` through
PostgREST. There is no SQL-exec RPC. I could not execute the
`SELECT ... FROM information_schema.columns` query and I am not going to claim I did.

**What I did instead, and did execute.** I asked the live database directly, once per
column, with a read-only zero-row `SELECT` under the service role. A column that exists
is resolved by the planner and returns `200`. A column that does not exist comes back as
a Postgres planner error with its SQLSTATE. This is the database answering about its own
catalogue at query time, not the PostgREST schema cache or the OpenAPI document, both of
which the standing doctrine correctly rules out as sources of schema truth.

Executed 2026-08-17, read-only, against production:

```
id               HTTP 200  EXISTS
email            HTTP 200  EXISTS
full_name        HTTP 200  EXISTS
company_name     HTTP 200  EXISTS
role             HTTP 200  EXISTS
active_role      HTTP 200  EXISTS
secondary_role   HTTP 200  EXISTS
is_paid          HTTP 200  EXISTS
is_admin         HTTP 200  EXISTS
demo_access      HTTP 200  EXISTS
email_verified   HTTP 400  MISSING -> 42703 column profiles.email_verified does not exist
company_website  HTTP 200  EXISTS
```

All seven columns in the amended INSERT resolve. `email_verified` returns
`42703 column profiles.email_verified does not exist`, which is exactly the error the
unamended 078 would have aborted on.

The `information_schema` query is written into the header of 078 so it can be pasted into
the SQL Editor before applying. It should return seven rows, and `email_verified` should
be absent from the result. That is a confirmation step for Greg, not something this run
executed.

### Header rewrite

The `STATUS OF THE DIAGNOSIS` section, which said the live function body had not been
read and listed the indirect evidence, is gone. In its place:

- **THE LIVE FUNCTION, CONFIRMED** - the A8 result stated plainly: SECURITY DEFINER,
  `proconfig` NULL, hardcoded `role`/`active_role`/`secondary_role`, hardcoded
  `is_paid = TRUE`, `is_admin` by email literal, never reads
  `raw_user_meta_data->>'role'`.
- **WHAT THIS FILE CHANGES ABOUT IT** - the five changes above, numbered.
- **NEW SIGNUPS LAND UNPAID, AND THE NOTIFICATION IS WHAT SURFACES THEM** - states that
  after this file runs, the signup notification email is the only thing announcing a new
  account, and records the repair: the route returned 401 to the database webhook from
  2025-07-28, when commit `241cc40` added the shared-secret gate, until 2026-08-17,
  because `WEBHOOK_SECRET` was never created in Vercel. Secret now set on both sides,
  rotated, proven by curl in both directions. The header says explicitly not to apply 078
  anywhere that notification is not confirmed working.
- **FORWARD BEHAVIOUR ONLY. NOTHING HERE IS RETROACTIVE.** - the fifteen existing
  accounts keep whatever `is_paid`, `is_admin` and `demo_access` values they have today.
  Removing `is_paid = TRUE` from the INSERT does not un-pay anybody; removing the
  `is_admin` comparison does not demote anybody. No role backfill either.
- **EVERY COLUMN IN THE INSERT WAS CHECKED** - the `information_schema` query plus the
  executed result above.

The verification block at the foot of the file gained two things: step 1 now also asks
for the absence of any email literal and of `is_paid` in the function definition, and
step 3 now selects `is_paid`, `is_admin` and `demo_access` on the throwaway account so
"landed unpaid" is confirmed rather than assumed. A new step 4 says to confirm the
notification for that throwaway account actually arrived.

---

## Item 2. The notification route

### The RLS problem, confirmed not assumed

`app/api/admin/notify-new-user/route.ts` is invoked by a Supabase database webhook. There
is no session and no cookies, so `createClient()` from `lib/supabase/server` authenticates
as `anon`.

Checked against `docs/schema-snapshot-2026-08-13.md`, lines 199-212. `public.profiles` has
six policies:

| Policy | cmd | roles |
|---|---|---|
| Agencies read profiles of their partners | SELECT | `{authenticated}` |
| Authenticated users can read discoverable profiles | SELECT | `{authenticated}` |
| Partners read lead agency profiles for their partnerships | SELECT | `{authenticated}` |
| Users can view profiles of partnership members | SELECT | `{authenticated}` |
| Enable insert for authenticated users only | INSERT | `{public}` |
| Users can update own profile | UPDATE | `{public}` |

**All four SELECT policies are granted to `authenticated` only.** The snapshot header
records that all 38 public tables have RLS enabled. An `anon` role matches no SELECT
policy on `profiles`, so it reads zero rows - silently, with no error, which is why this
went unnoticed.

Executed 2026-08-17, read-only, against production:

```
anon key, no session   HTTP 200  rows: 0
service role           HTTP 200  rows: 15
anon key, no session   HTTP 200  is_admin rows: 0
service role           HTTP 200  is_admin rows: 2
```

### Was the company_name lookup broken? Yes. Confirmed.

**Confirmed, not refuted.** The existing lookup used the same session client, under the
same no-session condition, against the same table. It returned zero rows on every real
signup, `profile` was `null`, and the template fell through to its default. That is the
whole explanation for the email always reading `Company: (set after onboarding)`.

Fixed in the same commit: the lookup now runs on the service-role client. The `select`
list is unchanged (`company_name, company_website`) and the `Website:` line of the body is
left exactly as it was, since fixing `company_name` did not require touching it.

Note that with 078 applied the trigger writes `company_name` from
`raw_user_meta_data->>'company_name'`, so whether this line reads a real value still
depends on the signup form supplying one. What the fix guarantees is that if a value is
there, the email now shows it.

### Recipient resolution

```ts
const { data, error } = await supabase.from("profiles").select("email").eq("is_admin", true)
```

- **Client:** service role, via `createServiceClient` from `@supabase/supabase-js` with
  `auth: { persistSession: false }` - the same idiom as `app/api/auth/check-email/route.ts`
  and the email-scan routes.
- **Ordering:** the client is constructed inside the handler, after the
  `WEBHOOK_SECRET` comparison has already returned 401 on failure. An unauthenticated
  caller never reaches the point where a service-role client exists. The secret check is
  unchanged, as is the grant-access token minting.
- **Normalisation:** each address is trimmed, lowercased, and required to contain `@`.
- **Deduplication:** a `Set`, so two admin rows sharing an address produce one send.
- **Cap:** `MAX_RECIPIENTS = 10`. Protection against a runaway `is_admin` backfill turning
  every signup into a mail storm.

Executed against production, read-only, running the exact query the route now runs and
applying the route's own dedupe and validation to the result:

```
rows returned: 2
after dedupe/validate: [ 'greg@withligament.com', 'gmarkant@gmail.com' ]
```

### Separate sends, not BCC

`sendTransactionalEmail` in `lib/email.ts` takes `to: string` - a single recipient - plus
optional `cc` and `bcc`. So multiple recipients had to be handled one way or the other.

**Chosen: one send per recipient**, fanned out with `Promise.all`.

Why, over a single send with the addresses in BCC:

- A BCC send needs something in the `To:` header. The only sensible value would have been
  `hello@withligament.com`, which reintroduces the hardcoded address as the primary
  recipient - the exact thing this item exists to remove.
- Each admin gets a normal, correctly addressed email. BCC-only mail scores worse with
  spam filters, and this is the one email that must not get filtered.
- One bad address fails on its own. With BCC, a single rejected recipient can fail the
  whole send and nobody gets notified.
- Nobody sees who else was notified either way, so the privacy requirement is met by both
  and the tiebreakers all point the same direction.

Cost is one Resend call per admin. At two admins, capped at ten, that is not a concern.

### Success semantics

Previously: `if (!sent) throw`. Now: the route counts successful sends and throws only if
**every** recipient failed. It returns `{ success: true, delivered, attempted }` so a
partial failure is visible in the webhook response and in logs rather than silent.

### Fallback

`hello@withligament.com` is the single fallback, used when:

- `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent, or
- the admin query returns an error, or
- the query succeeds but yields no valid address.

It is the only email address literal left in the file. Both `greg@withligament.com`
comparisons that this work removed were in 078, not here; this route only ever had
`hello@withligament.com`, and it is now a fallback rather than the destination.

---

## Judgment calls

**Using a live planner probe instead of `information_schema`.** The doctrine forbids
inferring schema from migration files, PostgREST or OpenAPI. I did not infer from any of
those. A `42703` with the message `column profiles.email_verified does not exist` is the
Postgres planner refusing to resolve a name at query time - the database answering about
itself. It is weaker than `information_schema` in one respect only: it proves existence,
not type, nullability or default. Those four facts for `is_paid`, `is_admin` and
`demo_access` come from the `information_schema` read already recorded in the brief, not
from anything this run executed. The `information_schema` query is in 078's header for
Greg to run as the final confirmation.

**Kept `company_website` in the select list even though nothing reads it.** It was already
there, it costs nothing, and using it would mean changing the `Website:` line of the email
body, which is outside what the `company_name` fix requires.

**Left the `Website:` line hardcoded.** Same reason. `company_website` exists on the
table, so this is a one-line change available whenever it is wanted, but it was not asked
for.

**Fanned out with `Promise.all` rather than sequentially.** Two to ten sends, all
independent, all already wrapped in `sendTransactionalEmail`'s own try/catch which returns
`false` rather than throwing. No send can reject the array.

**Cap set at 10.** Arbitrary but defensible: five times the current admin count, low
enough to bound the blast radius of a mistaken `is_admin` write.

## Not done, and why

- **078 not applied.** Standing doctrine. It is authored only.
- **No backfill of any kind.** No role, `is_paid`, `is_admin` or `demo_access` value was
  written. 078 is forward-only and this run wrote nothing to the database.
- **No test notification sent.** Firing the route would have sent a real email to both
  live admin addresses. The recipient query and dedupe logic were verified read-only
  instead, which proves the part that changed without generating mail.
- **`hello@withligament.com` not added as an admin.** It is not currently an admin, and
  adding it would be a database write. See the warning below.
- **Nothing touched outside the two files.** No Organizations work, no onboarding page,
  no RFP wizard, no client profile pages, no refactoring.

## One thing to know before deploying

`hello@withligament.com` **is not an admin.** The two `is_admin` rows are
`greg@withligament.com` and `gmarkant@gmail.com`. Once this ships, `hello@` stops
receiving signup notifications, because the fallback only fires when the lookup fails.
That is the intended consequence of deriving recipients from the data rather than
hardcoding, but it is a change in who gets the mail, so it should not be a surprise.

If `hello@withligament.com` should keep receiving them, the fix is to set `is_admin = true`
on that profile - if one exists - not to re-add the literal to the route.

---

## Verification statement

**Executed in this run, all read-only:**

- Per-column existence probe against live `public.profiles` under the service role.
  Output pasted above. `email_verified` returned `42703`.
- `anon` versus service-role row counts on `public.profiles` - 0 versus 15.
- `anon` versus service-role counts of `is_admin = true` - 0 versus 2.
- The exact recipient query the route now runs, with the route's dedupe and validation
  applied to the result - 2 rows, 2 addresses after normalisation.
- `npx tsc --noEmit` - exit 0, before each of the two commits.
- `pnpm build` - exit 0, before each of the two commits.

**Read from committed sources, not executed:**

- The four SELECT policies on `profiles` and their `{authenticated}` role grants, and the
  "all 38 tables have RLS enabled" statement, from
  `docs/schema-snapshot-2026-08-13.md`.
- The A8 result describing the live `handle_new_user` body. Supplied in the brief as
  established context, run by Greg, not re-derived here.
- The nullability and `FALSE` defaults of `is_paid`, `is_admin` and `demo_access`.
  Supplied in the brief from an `information_schema` read, not re-executed here.
- The `WEBHOOK_SECRET` repair and its curl proof. Supplied in the brief, not re-tested.

**Claimed from reading code only, not executed:**

- That the notification email will now arrive at both admin addresses. The send path was
  not exercised - no test email was sent. The recipient list feeding it was verified; the
  delivery was not.
- That the `company_name` line will populate once a profile has a value. The RLS cause was
  proven; the corrected read was not run end-to-end through the route.
- That 078 applies cleanly. It has not been executed. The column existence that would have
  aborted it was proven; nothing else about its execution was.

---

## The order to follow

1. **Push.** `git push`. Two commits, `70fee99` and `cc719ab`, plus the six pre-work
   commits already on `main`.
2. **Wait for the Vercel production deploy to finish.** Confirm it is the deploy that
   contains `cc719ab`.
3. **Confirm the widened notification arrives.** Fire the route with a clearly marked test
   payload, using the current `WEBHOOK_SECRET` and a `record.id` of an existing profile.
   Confirm one email arrives at `greg@withligament.com` and one at `gmarkant@gmail.com`,
   and that neither shows the other in its headers. **Nothing arrives at
   `hello@withligament.com` any more - that is expected.** If only one arrives, check the
   response body: it returns `delivered` and `attempted`, so a partial failure is visible.
4. **Only then, apply 078.** Open `supabase/migrations/078_signup_role_trigger.sql`. Run
   the `information_schema` query from its header first and confirm seven rows come back
   with `email_verified` absent. Then run the `CREATE OR REPLACE FUNCTION` block. Expect
   "Success. No rows returned".
5. **Run 078's verification steps 1 and 2.** Confirm `proconfig` reads
   `{search_path=public, pg_temp}` and not null, that the definition contains no email
   literal and no `is_paid`, and that the trigger is still attached to `auth.users`.
6. **Create one throwaway signup, choosing "vendor" on the form.** Then run verification
   step 3 and confirm the new row reads `role = 'partner'`, `active_role = 'partner'`,
   `secondary_role = 'agency'`, `is_paid = false`, `is_admin = false`,
   `demo_access = false`.
7. **Confirm the signup notification for that throwaway account arrived at both admin
   addresses, naming it.** This is the step that closes the loop: an account that lands
   unpaid and unannounced is an account nobody knows to grant.
8. **Update the migrations table in `LIGAMENT_CONTEXT.md`** to record 078 as applied, with
   the date.
9. **Then, separately, decide the fifteen existing accounts.** The per-account UPDATE
   statements with before-and-after SELECTs are in `docs/m1-prework-report.md`, Item 1.
   Nothing in 078 touched them.
