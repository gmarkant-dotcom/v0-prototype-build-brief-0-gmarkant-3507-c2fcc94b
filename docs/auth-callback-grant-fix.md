# The auth callback stops granting access

Run date: 2026-08-17. One code commit, `7a7ca6d`, local only. Nothing pushed. No migration
applied, no write query executed against the live database.

---

## Finding first: what this route writes to `role` and `active_role`

**It does not hardcode a single role. It reads the signup metadata. But its fallback
disagrees with 078, and on the update branch that disagreement wins.**

`app/auth/callback/route.ts:10`, unchanged by this commit:

```ts
const hasInviteContext = !!(metadata.invite || metadata.invite_token || metadata.invite_type)
const role = hasInviteContext ? 'partner' : (metadata.role || 'partner')
```

### The insert branch

Writes `role: role, active_role: role` - the value derived above. This branch only runs when
no profile row exists, so it is not competing with 078; it is standing in for a trigger that
did not fire.

### The update branch

```ts
if (role === 'partner' && (existingProfile.role !== 'partner' || existingProfile.active_role !== 'partner')) {
  updatePayload.role = 'partner'
  updatePayload.active_role = 'partner'
} else if (!existingProfile.role) {
  updatePayload.role = role
}
```

So it overwrites what 078 wrote **only in one direction**: it can force a row to `partner`,
never to `agency`. An account whose metadata says `agency` falls through both conditions and
078's write survives untouched.

### Where that becomes the same defect class as the old trigger

078 falls back to `'agency'` when `raw_user_meta_data->>'role'` is absent. This route falls
back to `'partner'`. **Opposite fallbacks on the same missing input.** If a user existed with
no `role` in metadata, the trigger would write `agency`, then the callback would compute
`partner`, the first condition would fire, and it would overwrite both columns to `partner`.

**The direction is the opposite of the one anticipated in the brief.** The risk is not that
signups land as `agency` regardless of choice; it is that a role-less signup lands as
`partner` regardless.

### Why it is not currently reachable, which is why I did not change it

`supabase.auth.signUp` at `app/auth/sign-up/page.tsx:156-170` is the **only** user-creation
path in the repo, and it always sets `role` in `options.data`:

```ts
role: (hasRfpInviteContext || hasPartnershipInviteContext) ? 'partner' : role,
```

Greps executed across `app/`, `lib/`, `components/`: **zero** hits for `signInWithOAuth`,
`signInWithOtp`, `inviteUserByEmail`, `admin.createUser`, `generateLink`. There is no social
OAuth provider wired up at all. The "OAuth path" in the brief maps in this codebase to the
PKCE `code` exchange branch of the email-confirmation callback, not to a third-party
provider.

So `metadata.role` is always present for any account created through the product today, the
`|| 'partner'` fallback never fires, and the route respects what the user chose. It becomes
live the moment a user is created outside the app - the Supabase dashboard, the admin API, or
any future OAuth or invite provider.

**I changed nothing about role handling.** Per the brief, this is reported rather than fixed.
It needs a ruling, not a quiet edit: aligning the fallback to `'agency'` would be a
one-character-class change with real consequences for the invite flows, and the invite-context
force to `partner` above it is deliberate and documented. See "Needs a ruling" below.

---

## What changed in the callback

Two edits, both in `syncUserProfile`. Nothing else in the file was touched: session exchange,
`verifyOtp`, `exchangeCodeForSession`, `claimPartnershipInvitations`, every redirect, and all
role handling are byte-identical.

### Edit 1 - the insert payload

**Before** (lines 21-32):

```ts
await supabase.from('profiles').insert({
  id: user.id,
  email: user.email,
  full_name: metadata.full_name || '',
  company_name: metadata.company_name || '',
  company_linkedin_url: metadata.company_linkedin_url || null,
  role: role,
  active_role: role,
  is_paid: true,
  is_admin: false,
  demo_access: true,
})
```

**After:**

```ts
await supabase.from('profiles').insert({
  id: user.id,
  email: user.email,
  full_name: metadata.full_name || '',
  company_name: metadata.company_name || '',
  company_linkedin_url: metadata.company_linkedin_url || null,
  role: role,
  active_role: role,
  is_admin: false,
  // is_paid and demo_access are deliberately absent. Both columns default to
  // FALSE, matching migration 078: a new account lands unpaid and without demo
  // access, and stays that way until an admin grants it. This insert exists only
  // because the on_auth_user_created trigger does not always fire - it must create
  // the profile row, never grant access.
})
```

The insert itself stays, exactly as required. `is_admin: false` is left in place: it is an
explicit write of the column default, it grants nothing, and removing it was not asked for.

### Edit 2 - the existing-profile backfill

**Before** (lines 50-53):

```ts
if (metadata.company_linkedin_url) updatePayload.company_linkedin_url = metadata.company_linkedin_url
// Self-heal: restore access if it was ever lost, without touching is_admin
if (!existingProfile.is_paid) updatePayload.is_paid = true
if (!existingProfile.demo_access) updatePayload.demo_access = true
```

**After:**

```ts
if (metadata.company_linkedin_url) updatePayload.company_linkedin_url = metadata.company_linkedin_url
// No access flags are written here. This branch previously re-granted is_paid and
// demo_access whenever they were falsy, which meant an admin restricting a user was
// silently undone the next time that user hit this callback. Access is granted
// deliberately, from the admin panel or the grant-access route, and nowhere else.
```

The comment that called this "Self-heal: restore access if it was ever lost" is gone. That
comment was the whole problem stated out loud: it treated an admin's deliberate restriction
as data loss to be repaired.

---

## Repo-wide grep for writes that grant access

Searched `app/`, `lib/`, `components/`, `hooks/`, `contexts/`, `scripts/`, `supabase/`,
`middleware.ts`, across `*.ts`, `*.tsx`, `*.sql`, `*.js`, `*.mjs`. 99 total references to
`is_paid` / `demo_access`. Separated into writes and reads.

### TypeScript writes

| Location | Write | Verdict |
|---|---|---|
| `app/auth/callback/route.ts:29,31` | `is_paid: true`, `demo_access: true` on insert | **The defect. Fixed in `7a7ca6d`.** |
| `app/auth/callback/route.ts:52,53` | `updatePayload.is_paid = true`, `.demo_access = true` | **The defect. Fixed in `7a7ca6d`.** |
| `app/api/admin/grant-access/route.ts:167` | `.update({ is_paid: true, updated_at: ... })` | Exempt. Untouched. |
| `app/api/admin/users/[userId]/flags/route.ts:113` | `.update(updates)` from the request body | Exempt. Untouched. |
| `app/admin/users/page.tsx:113,124,126,128` | Client state and `setFlags` calls into the flags route | Exempt. Untouched. |

`contexts/paid-user-context.tsx:112-113` and `lib/entitlements.ts:102,122,145` are **reads**
only - a `console.log` and three `=== true` comparisons. No write.

`.rpc(` appears **zero** times in `app/`, `lib/`, `components/`. No route grants access
through a database function.

### SQL

This is where the brief was right to insist on looking, and it found real hazards.

| File | What it contains | Verdict |
|---|---|---|
| `supabase/migrations/056_default_dual_role_access.sql` | Its `handle_new_user` hardcodes `is_paid = true`; lines 43-49 also run a bulk `UPDATE ... SET is_paid = true` over existing rows | Historical, applied, **superseded by 078**. Left as-is: an applied migration is a record, not a live control. |
| `scripts/007-secure-admin-access.sql` | `CREATE OR REPLACE FUNCTION public.handle_new_user()` - writes `is_paid` false but sets `is_admin` by a `greg@withligament.com` literal, `role` fallback `'partner'` | **Hazard if run.** Not fixed - needs a ruling. |
| `scripts/009-comprehensive-auth-setup.sql` | `CREATE OR REPLACE FUNCTION public.handle_new_user()` - sets `is_paid`, `is_admin` and `demo_access` all by `greg@withligament.com` literal; also `UPDATE ... SET is_admin = true, is_paid = true, demo_access = true, role = 'agency'` for that address; inserts into `email_verified` | **Hazard if run.** Not fixed - needs a ruling. |

**The hazard, stated plainly:** `scripts/007` and `scripts/009` each contain a full
`CREATE OR REPLACE FUNCTION public.handle_new_user()`. Running either one in the SQL Editor
would **silently revert migration 078** - losing the `search_path` pin, the metadata role
read, the opposite-role derivation, and reinstating the hardcoded email comparisons.
`scripts/009` would additionally abort part-way on `email_verified`, which does not exist.

Nothing runs them automatically. `scripts/` is a legacy archive of 36 files; the only entry in
`package.json` that touches it is `"verify-rls": "node scripts/verify-rls.mjs"`, which is a
read-only checker. So this is a foot-gun, not an active bug.

### Needs a ruling (nothing done)

1. **`scripts/007` and `scripts/009` can revert 078.** Options: delete both, or add a
   `-- SUPERSEDED BY supabase/migrations/078. DO NOT RUN.` header to each. I did neither -
   both are outside this defect and deleting files is not something to do unasked.
2. **The `|| 'partner'` role fallback in the callback**, divergent from 078's `'agency'`.
   Not reachable today, live the moment a user is created outside the signup form.

---

## Read-only census

Executed 2026-08-17 against production, service role, `SELECT` only.

**16 profiles exist. All 16 carry `is_paid` true or `demo_access` true. Zero profiles have
both false.**

| email | is_paid | demo | admin | role | created_at | updated_at |
|---|---|---|---|---|---|---|
| greg@withligament.com | true | true | true | agency | 2026-03-26T02:18:31.725Z | 2026-06-10T17:27:36.783Z |
| gmarkant@icloud.com | true | true | false | partner | 2026-03-26T17:14:57.573Z | 2026-07-16T16:54:13.667Z |
| gmarkant@gmail.com | true | true | true | agency | 2026-03-26T17:15:50.157Z | 2026-07-16T16:37:42.294Z |
| mariannafayn@gmail.com | true | true | false | agency | 2026-05-05T12:55:42.479Z | 2026-05-05T12:55:42.479Z |
| victoriacaro91@gmail.com | true | true | false | agency | 2026-06-11T14:28:40.103Z | 2026-06-11T14:28:40.103Z |
| andrea@crescestudio.com | true | true | false | agency | 2026-06-11T18:10:04.815Z | 2026-06-11T18:10:04.815Z |
| gmarkant+partner22@gmail.com | true | true | false | agency | 2026-06-23T17:49:29.961Z | 2026-06-23T17:49:29.961Z |
| gmarkant+partner23@gmail.com | true | true | false | agency | 2026-06-23T19:12:11.886Z | 2026-06-23T19:12:11.886Z |
| marcusliwag@gmail.com | true | true | false | agency | 2026-06-25T16:12:27.678Z | 2026-06-25T16:12:27.678Z |
| info@ceoofgeo.com | true | true | false | agency | 2026-07-15T19:46:47.507Z | 2026-07-15T19:46:47.507Z |
| fredsqueo@gmail.com | true | true | false | agency | 2026-07-16T15:28:57.057Z | 2026-07-16T15:28:57.057Z |
| **sbatty@thelab.co** | **false** | true | false | agency | 2026-07-20T20:31:42.294Z | 2026-07-20T20:31:42.294Z |
| gmarkant+partner70@gmail.com | true | true | false | agency | 2026-08-06T14:16:48.898Z | 2026-08-06T14:16:48.898Z |
| gmarkant+partner71@gmail.com | true | true | false | partner | 2026-08-07T16:09:45.421Z | 2026-08-07T16:09:45.421Z |
| gmarkant+partner64@gmail.com | true | true | false | partner | 2026-08-17T15:14:45.046Z | 2026-08-17T15:14:45.046Z |
| gmarkant+partner63@gmail.com | true | true | false | partner | 2026-08-17T20:32:48.799Z | 2026-08-17T20:32:48.799Z |

Note the count: the previous run measured 15 profiles. It is 16 now because
`gmarkant+partner63@gmail.com` was created after that read.

### What this census cannot tell you

**It cannot distinguish a deliberate admin grant from a callback grant.** Nothing in
`profiles` records who wrote a flag or why. Both the admin flags route and the old callback
backfill wrote the same `true` to the same column.

**`updated_at` is worse than useless here, and this run proved it.** `sbatty@thelab.co` was
created on 2026-07-20, after 056, whose trigger hardcoded `is_paid = true`. It reads
`is_paid = false` today, so it was demonstrably restricted at some point. Yet its `updated_at`
is **identical to its created_at, to the microsecond**. The write that restricted it did not
bump `updated_at`.

Reading `app/api/admin/users/[userId]/flags/route.ts:111-114` confirms why: it calls
`.update(updates)` where `updates` is built from the request body only, and never sets
`updated_at`. The old callback backfill did not set it either. Only paths that write it
explicitly - `grant-access/route.ts:167` does - move it. So the eleven rows above whose
`updated_at` equals `created_at` prove nothing at all about whether they were ever touched.

Read-only queries cannot recover this history. If it matters, the answer is in Supabase's
Postgres logs or in Resend/Sentry, not in this table.

### The sbatty@thelab.co answer

**`sbatty@thelab.co` is `is_paid = false` right now. They have NOT been re-granted.**

```json
{
  "email": "sbatty@thelab.co",
  "role": "agency",
  "active_role": "agency",
  "is_paid": false,
  "is_admin": false,
  "demo_access": true,
  "created_at": "2026-07-20T20:31:42.294441+00:00",
  "updated_at": "2026-07-20T20:31:42.294441+00:00"
}
```

The restriction held, because this account has not been through the callback since it was
applied - the callback only runs on a confirmation link, not on routine logins, which go
through `/auth/login` directly. That is luck, not design: one click on a fresh confirmation or
password-reset link would have re-granted them before this commit.

**`demo_access` is still `true`.** Whoever restricted this account cleared `is_paid` and left
`demo_access` set. Whether that matters depends on what `demo_access` gates - it is not read
anywhere in `lib/entitlements.ts`, which tests `is_paid` only, so on current evidence it gates
nothing. Flagging it rather than acting on it; no flag was altered.

---

## Judgment calls

**Did not touch the role fallback.** Reported at the top instead. The brief said to state it
plainly and not fix it without saying exactly what changed and why - and the honest answer is
that the correct value for that fallback is a product decision, not a bug fix. It is also
currently unreachable.

**Left `is_admin: false` on the insert.** It writes the column default, grants nothing, and
removing it was not in scope.

**Left `is_paid, demo_access` in the `select` on line 15.** They are now unread. Removing them
would be a tidier diff but a wider one, and "do not refactor beyond this defect" points the
other way. Noting it so a future reader knows they are vestigial rather than load-bearing.

**Did not add the missing `updated_at` write to the flags route.** It is a real gap - it is
why this census cannot answer its own question - but the brief explicitly excludes that route.

**Reported `scripts/007` and `scripts/009` rather than editing them.** They can revert 078,
which is serious, but nothing executes them and deleting or annotating files is a decision to
take deliberately.

## Not done, and why

- **No profile's `is_paid`, `demo_access` or `is_admin` was altered.** No backfill. The census
  was `SELECT` only.
- **No migration applied, no write query run.** Standing doctrine.
- **Admin panel, flags route and grant-access route untouched.** Explicitly excluded.
- **078, the Organizations work and the RFP surfaces untouched.**
- **Nothing pushed.** `7a7ca6d` is local.

---

## Verification statement

**Executed in this run:**

- `npx tsc --noEmit` - exit 0, after the edits, before the commit.
- `pnpm build` - exit 0, after the edits, before the commit.
- Read-only census against production under the service role: 16 profiles, all 16 flagged,
  0 with both flags false. Table above is the query output.
- Read-only lookup of `sbatty@thelab.co`. JSON above is the raw response.
- Read-only probe confirming `updated_at` exists on `public.profiles` (HTTP 200).
- Repo-wide greps for `is_paid` / `demo_access` writes across `*.ts`, `*.tsx`, `*.sql`,
  `*.js`, `*.mjs`, including `scripts/` and `supabase/migrations/`.
- Greps confirming zero occurrences of `signInWithOAuth`, `signInWithOtp`,
  `inviteUserByEmail`, `admin.createUser`, `generateLink`, and zero `.rpc(` calls.

**Read from code or committed sources, not executed:**

- That `app/auth/sign-up/page.tsx` is the only user-creation path, and always sets
  `metadata.role`. Read at lines 156-170.
- That the flags route never writes `updated_at`. Read at lines 111-114. The behavioural
  proof - sbatty's `updated_at` equal to `created_at` despite a demonstrable restriction - was
  executed; the code reading that explains it was not.
- That `scripts/007` and `scripts/009` would revert 078. Read, not run. Obviously not run.
- The state of the live `handle_new_user` after 078, and the trigger still being attached.
  Supplied in the brief as established context, not re-queried here.

**Claimed from code reading only, not executed:**

- **That a new signup now lands `is_paid = false` and `demo_access = false`.** This is the
  intended outcome and the code no longer contains any statement that would set them true on
  this path - but no signup has been run through the changed code. It is unverified until step
  4 of the checklist below.
- That an admin restriction now survives a subsequent callback hit. Same: the write that undid
  it is gone from the source, but the scenario has not been exercised.
- That profile creation still works on the insert branch. The branch is unchanged apart from
  two removed keys, but it was not exercised.

---

## Live checklist, in click order

1. **Push.** `git push`. `7a7ca6d` plus the three commits already on `main` from the previous
   run.
2. **Wait for the Vercel production deploy** and confirm it is the one containing `7a7ca6d`.
3. **Restrict a throwaway account and prove it stays restricted.** In the admin panel, set
   `is_paid` false on `gmarkant+partner64@gmail.com`. Then send that account a fresh
   confirmation or password-reset link and click it. Before this commit the callback would
   have re-granted `is_paid`. Re-check the admin panel: it must still read false.
4. **Create one brand new throwaway signup.** Confirm the email, click the link, and check the
   admin panel. Expected: `is_paid` false, `demo_access` false, `is_admin` false, and `role` /
   `active_role` matching whichever side was chosen on the form. This is the step that
   verifies the intended outcome; nothing before it does.
5. **Confirm the signup notification for that account arrived** at `greg@withligament.com` and
   `gmarkant@gmail.com`, naming it.
6. **Then run the grant-access flow end to end** - see below. This is the important one.
7. **Decide the two rulings:** `scripts/007` and `scripts/009`, and the `|| 'partner'`
   fallback.

---

## Was restricting a user reversible before this fix?

**Yes, silently, and that is the point of this commit.**

Before `7a7ca6d`: an admin could set `is_paid` false in the admin panel, and the next time
that user clicked any link routing through `/auth/callback` - email confirmation, password
reset, an RFP or partnership invite - lines 52-53 saw the falsy value, treated it as damage,
and wrote `true` back. No log, no notification, no trace in `updated_at`. The admin had no way
to know the restriction had been undone short of re-opening the panel.

After `7a7ca6d`: **no.** The callback writes no access flag on any branch. `is_paid` and
`demo_access` are now written by exactly two places - the admin flags route and the
grant-access route - and both are deliberate admin actions.

---

## The grant-access flow is now load-bearing, and has never been tested end to end

With 078 applied and this commit deployed, **every new signup lands unpaid**. The only way a
new user ever gains access is the grant-access flow: the "Grant Access" button in the signup
notification email, the confirmation page it opens, and the submit that writes `is_paid`.

That complete path - **confirmation page renders, then submit while signed in as an admin,
then the user actually gaining access** - has never been exercised end to end. It could not
have been: the notification email that carries the button was returning 401 from 2025-07-28
until it was repaired earlier today, and until now the callback was granting access anyway, so
nothing depended on it.

It is now the single point of failure for onboarding. If it is broken, every new signup is
stranded unpaid with no route in.

**Greg should test it against `gmarkant+partner63@gmail.com`** - a real account, created today
at 20:32 UTC, currently pending. Note that it currently reads `is_paid = true`, granted by the
callback before this commit; set it back to false in the admin panel first so the test starts
from the state a real new signup will now be in. Then use the Grant Access button from that
account's notification email, complete the confirmation page while signed in as an admin, and
confirm the account can actually reach a paid surface afterwards.
