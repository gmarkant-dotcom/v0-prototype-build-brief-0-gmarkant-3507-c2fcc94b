# M1 pre-work report

Run date: **2026-08-17**. Branch `main`. Six commits, none pushed.

Nothing in this run touches the organizations model. The purpose was to clear noise and
settle inputs so migration 079 lands against a clean codebase.

---

## Decisions Greg owes

### 1. Run appendix query A8. It is still unexecuted.

The live body of `handle_new_user()` has never been read. This run tried to read it from the
terminal and could not: PostgREST cannot reach `pg_catalog.pg_proc`, no SQL-executing RPC is
exposed on the project, and the sandbox blocked both probe attempts. So it goes to you.

```sql
SELECT p.proname,
       p.prosecdef               AS security_definer,
       p.proconfig               AS config_settings,   -- null here means no search_path pin
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
```

**Everything in Item 1 that describes what the live trigger does is UNCONFIRMED until this
runs.** `supabase/migrations/078_signup_role_trigger.sql` is `CREATE OR REPLACE`: it will
overwrite whatever is actually there, so diff the live body against what 078 replaces before
running it.

The circumstantial case is strong (Item 1.2), but circumstantial is not read.

### 2. Which of the seven accounts to backfill.

**All seven have zero agency-side rows.** Zero projects, zero partnerships as agency, zero
clients, zero library documents. Counted read-only against production today.

That makes all seven simple flips by the test the brief set: nobody's own work gets hidden
behind a portal they can no longer see, because nobody has any.

Four of the seven are stuck in the lead agency portal right now and are the reason this item
exists: `mariannafayn@`, `victoriacaro91@`, `andrea@crescestudio.com`, `marcusliwag@`. The
other three already flipped `active_role` to `partner` by hand and are working; correcting
their `role` is tidying, not unblocking.

**One consequence to rule on, because it is a real loss of access.** Every one of the seven
carries `secondary_role = 'partner'` today. `POST /api/profile/switch-role` grants the agency
portal when `role = 'agency' OR secondary_role = 'agency' OR is_admin`. So today all seven can
reach the lead agency portal through the first clause. Setting `role = 'partner'` and leaving
`secondary_role` alone would take that away.

The per-account statements in Item 1.6 therefore write `secondary_role = 'agency'` as well,
which preserves exactly the access they have now and makes the whole flip reversible from the
portal switcher in one click. If you would rather these four lose lead agency access
entirely, drop that one column from the `SET` clause; the statements say where.

Nothing else in this run needs you before it is useful.

---

## Item 1: the signup role trigger and the role backfill

### 1.1 What migration 056 says on disk

```sql
-- supabase/migrations/056_default_dual_role_access.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (..., role, active_role, secondary_role, is_paid, ...)
  VALUES (..., 'agency', 'agency', 'partner', true, ...)
  ON CONFLICT (id) DO UPDATE SET email = ..., full_name = ..., company_name = ...;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Three defects, all visible in the file:

1. `role` and `active_role` are the literal `'agency'`. `NEW.raw_user_meta_data->>'role'`,
   which is where the signup form puts what the person actually chose, is never read.
2. `secondary_role` is the literal `'partner'` regardless. A vendor-primary account whose
   secondary role is also `partner` can never reach the other portal at all.
3. `SECURITY DEFINER` with no `SET search_path`. The function runs with whatever search path
   the caller has.

056 also ran a backfill writing `role = 'agency'` onto existing rows, so the damage is not
only forward.

### 1.2 The live trigger: UNCONFIRMED, but strongly corroborated

A8 has not been run. What the data says instead:

- **Every profile created after 056 carries `secondary_role = 'partner'`** - including the
  two whose `role` is `'partner'`. That value is 056's unconditional write. No other code
  path in the repository produces it.
- **The one pre-056 partner account**, `gmarkant@icloud.com` (created 2026-03-26), carries
  `secondary_role = 'agency'`, the 047-era shape. The break is visible in the data at exactly
  the point 056 landed.
- **Two accounts created after 2026-08-06 have `role = 'partner'` anyway.** That is not the
  trigger recovering. It is `app/auth/callback/route.ts:44-46`, shipped in commit `3d4349b`
  on 2026-08-06 ("vendor invitation signups landing in agency portal"), which corrects
  `role` and `active_role` to `partner` at email confirmation when the signup metadata says
  partner. It does not touch `secondary_role`, which is why those two rows read
  `role = partner`, `active_role = partner`, `secondary_role = partner` - a shape only a
  trigger writing `'partner'` unconditionally, plus a later heal, can produce.

**This matters for how urgent 078 is.** The callback heal already covers the common signup
path, so new vendors are landing correctly today. 078 fixes the root cause and the missing
`search_path`; it is not stopping active bleeding.

### 1.3 Which field decides the landing portal

**Both, in sequence, and `active_role` has the last word.** A backfill that writes only
`role` does nothing for the four stuck accounts. A backfill that writes only `active_role`
works, but bounces the user through a redirect on every login.

The sequence, traced through the code:

| Step | File | What it reads | What it does |
|---|---|---|---|
| 1. Login submits | `app/auth/login/page.tsx:79` | **`role` only** - the select list is literally `"role"` | `router.push('/agency/dashboard')` if `role === 'agency'`, else `/partner` |
| 2. Middleware sees the navigation | `middleware.ts:113` | `active_role \|\| role \|\| user_metadata.role` | Redirects `/agency` to `/partner` when the resolved value is `partner`, and `/partner` to `/agency/dashboard` when it is `agency` |
| 3. MFA path, if enabled | `app/auth/mfa-verify/page.tsx:93` | **`role` only**, same as step 1 | Same push, then middleware again |

Worked through for the four stuck accounts (`role = agency`, `active_role = agency`):

| Backfill writes | Step 1 pushes | Middleware resolves | Lands on | Correct? |
|---|---|---|---|---|
| `role = 'partner'` only | `/partner` | `active_role` = `agency` | **`/agency/dashboard`** | **No. Still stuck, and now bouncing** |
| `active_role = 'partner'` only | `/agency/dashboard` (role still agency) | `active_role` = `partner` | `/partner` | Yes, via a visible redirect on every login |
| both | `/partner` | `partner` | `/partner` | Yes, cleanly |

So: **`active_role` decides**, because middleware runs last and overrides. But `role` decides
the first hop, and leaving the two disagreeing means every login for these people is a
redirect bounce. **Write both.**

`lib/acting-role.ts` is consistent with this and is not the problem: `actingRole()` prefers
`active_role` and falls back to `role` only when `active_role` is genuinely unset. The two
places that still read bare `role` are the login page and the MFA page, both of which are
pre-session-establishment client code that middleware corrects a moment later.

### 1.4 The seven accounts, with agency-side row counts

Counted read-only against production on 2026-08-17 via the service role key: `profiles`
joined to the GoTrue admin API for signup metadata, and four `count(exact)` queries per
account.

**The platform now has 15 accounts, not 14.** `gmarkant+partner64@gmail.com` signed up today
and is not in the previous run's tally. It is not one of the seven: the callback heal caught
it, and it reads `role = partner` correctly.

| # | Email | Stored `role` | Signup meta role | `active_role` | `secondary_role` | projects | partnerships as agency | clients | library docs | Wrong portal? |
|---|---|---|---|---|---|---:|---:|---:|---:|---|
| 1 | `mariannafayn@gmail.com` | agency | **partner** | agency | partner | 0 | 0 | 0 | 0 | **YES** |
| 2 | `victoriacaro91@gmail.com` | agency | **partner** | agency | partner | 0 | 0 | 0 | 0 | **YES** |
| 3 | `andrea@crescestudio.com` | agency | **partner** | agency | partner | 0 | 0 | 0 | 0 | **YES** |
| 4 | `marcusliwag@gmail.com` | agency | **partner** | agency | partner | 0 | 0 | 0 | 0 | **YES** |
| 5 | `gmarkant+partner23@gmail.com` | agency | **partner** | partner | partner | 0 | 0 | 0 | 0 | no |
| 6 | `info@ceoofgeo.com` | agency | **partner** | partner | partner | 0 | 0 | 0 | 0 | no |
| 7 | `gmarkant+partner70@gmail.com` | agency | **partner** | partner | partner | 0 | 0 | 0 | 0 | no |

Account ids, needed for the statements in 1.6:

| # | Email | `profiles.id` |
|---|---|---|
| 1 | `mariannafayn@gmail.com` | `88055513-892d-45f0-9c72-2e9a20dd0786` |
| 2 | `victoriacaro91@gmail.com` | `20aabf79-5005-4ae9-9a39-795ab2d7253c` |
| 3 | `andrea@crescestudio.com` | `6cbf8191-c06f-4792-89f8-9bd7b6390b74` |
| 4 | `marcusliwag@gmail.com` | `a63260b8-ea6a-42cc-8b94-961f697f0198` |
| 5 | `gmarkant+partner23@gmail.com` | `6d9ee132-3780-4933-8eed-8ba5990e9665` |
| 6 | `info@ceoofgeo.com` | `bc6330d3-804b-4338-84ff-5a20ae064a34` |
| 7 | `gmarkant+partner70@gmail.com` | `c582bf50-3d40-493a-b1dc-5228451174f7` |

**Every count is zero. Not one of the seven is a complicated case.** For contrast, the only
account on the platform carrying real agency-side work is `gmarkant@gmail.com`: 6 projects,
31 partnerships, 2 clients, 10 library documents. It signed up as `agency`, is stored as
`agency`, and is not in this list.

Two observations from the same read, outside the seven:

- **`sbatty@thelab.co` carries `is_paid = false`.** It is the only account that does. This
  refutes a premise Item 2 was asked to test - see 2.2.
- `gmarkant@icloud.com` already reads `role = partner`, `secondary_role = agency`. Pre-056,
  and correct.

### 1.5 Migration 078, authored not applied

`supabase/migrations/078_signup_role_trigger.sql`.

- Reads `NEW.raw_user_meta_data->>'role'`; anything that is not exactly `'partner'` falls
  back to `'agency'`, so a malformed or absent value behaves exactly as it does today.
- Sets `secondary_role` to the **opposite** of the chosen role rather than always `'partner'`.
- Declares `SET search_path = public, pg_temp`.
- Leaves `role`/`active_role`/`secondary_role` out of the `ON CONFLICT DO UPDATE` list,
  exactly as 056 did, so a re-fired trigger never rewrites a role the user has since changed.
- **Contains no backfill.**

One thing it deliberately does not fix. `secondary_role = 'agency'` on a vendor signup grants
that vendor the lead agency portal for free, because `switch-role` tests for `'agency'` in
either column. 078 writes it anyway, because that is exactly the access every signup already
has today (056 writes `role = 'agency'` to everyone, satisfying the same test through the
first clause). Closing that door is a billing decision, it belongs with 079 where entitlement
moves onto the organization, and doing it in 078 would silently change what a plan includes.

**Numbering.** 078 is now this trigger fix; **079 is reserved for Organizations M1**. Recorded
in `docs/schema-truth.md` section 2 and in the `LIGAMENT_CONTEXT.md` migration table. The
earlier reservation of 078 for M1 is marked superseded in both places, and
`docs/proposed-migration-role-trigger.sql` - the unnumbered draft, whose header still claimed
078 was reserved for M1 - was deleted so there is one copy of this SQL and not two. Full-repo
grep before deleting found three references, all inside
`docs/schema-truth-and-m1-prep-report.md`, a dated historical report that correctly describes
the state at the time it was written.

### 1.6 Per-account statements, to run one at a time

**Do not run these as a block.** One account, one ruling, one statement, with the read either
side of it.

Each triplet is: read the current state, write, read it back. The `SELECT`s are read-only and
safe to re-run at any time.

#### Before anything: the whole picture, read-only

```sql
SELECT id, email, role, active_role, secondary_role, is_paid, created_at
FROM public.profiles
ORDER BY created_at;
-- Expect 15 rows. If fewer come back, the export truncated - re-run split by created_at.
```

#### 1. mariannafayn@gmail.com - stuck in the agency portal

```sql
-- BEFORE
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '88055513-892d-45f0-9c72-2e9a20dd0786';

-- WRITE
UPDATE public.profiles
SET role = 'partner', active_role = 'partner', secondary_role = 'agency'
WHERE id = '88055513-892d-45f0-9c72-2e9a20dd0786';
-- Drop `secondary_role = 'agency'` if this account should LOSE lead agency access.

-- AFTER
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '88055513-892d-45f0-9c72-2e9a20dd0786';
```

#### 2. victoriacaro91@gmail.com - stuck in the agency portal

```sql
-- BEFORE
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '20aabf79-5005-4ae9-9a39-795ab2d7253c';

-- WRITE
UPDATE public.profiles
SET role = 'partner', active_role = 'partner', secondary_role = 'agency'
WHERE id = '20aabf79-5005-4ae9-9a39-795ab2d7253c';

-- AFTER
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '20aabf79-5005-4ae9-9a39-795ab2d7253c';
```

#### 3. andrea@crescestudio.com - stuck in the agency portal

```sql
-- BEFORE
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '6cbf8191-c06f-4792-89f8-9bd7b6390b74';

-- WRITE
UPDATE public.profiles
SET role = 'partner', active_role = 'partner', secondary_role = 'agency'
WHERE id = '6cbf8191-c06f-4792-89f8-9bd7b6390b74';

-- AFTER
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '6cbf8191-c06f-4792-89f8-9bd7b6390b74';
```

#### 4. marcusliwag@gmail.com - stuck in the agency portal

```sql
-- BEFORE
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = 'a63260b8-ea6a-42cc-8b94-961f697f0198';

-- WRITE
UPDATE public.profiles
SET role = 'partner', active_role = 'partner', secondary_role = 'agency'
WHERE id = 'a63260b8-ea6a-42cc-8b94-961f697f0198';

-- AFTER
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = 'a63260b8-ea6a-42cc-8b94-961f697f0198';
```

#### 5. gmarkant+partner23@gmail.com - already working, tidying only

```sql
-- BEFORE
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '6d9ee132-3780-4933-8eed-8ba5990e9665';

-- WRITE
UPDATE public.profiles
SET role = 'partner', active_role = 'partner', secondary_role = 'agency'
WHERE id = '6d9ee132-3780-4933-8eed-8ba5990e9665';

-- AFTER
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = '6d9ee132-3780-4933-8eed-8ba5990e9665';
```

#### 6. info@ceoofgeo.com - already working, tidying only

```sql
-- BEFORE
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = 'bc6330d3-804b-4338-84ff-5a20ae064a34';

-- WRITE
UPDATE public.profiles
SET role = 'partner', active_role = 'partner', secondary_role = 'agency'
WHERE id = 'bc6330d3-804b-4338-84ff-5a20ae064a34';

-- AFTER
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = 'bc6330d3-804b-4338-84ff-5a20ae064a34';
```

#### 7. gmarkant+partner70@gmail.com - already working, tidying only

```sql
-- BEFORE
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = 'c582bf50-3d40-493a-b1dc-5228451174f7';

-- WRITE
UPDATE public.profiles
SET role = 'partner', active_role = 'partner', secondary_role = 'agency'
WHERE id = 'c582bf50-3d40-493a-b1dc-5228451174f7';

-- AFTER
SELECT id, email, role, active_role, secondary_role FROM public.profiles
WHERE id = 'c582bf50-3d40-493a-b1dc-5228451174f7';
```

### 1.7 Why this backfill is not the long-term model

Under the ruled Organizations model, `role` stops being a property of a person. It becomes a
property of the **organization** - capability flags on the org, saying whether it operates as
a lead agency, as a vendor, or as both - plus a **session view toggle** for which side a
member is currently looking at.

So this backfill is about unblocking four people this week. It is not a decision about the
model, and 079 should not treat these seven rows as evidence of anything. The columns they
write are ones 079 replaces.

---

## Item 2: the entitlement gates

### 2.1 What the gates checked before

Four distinct expressions, none of which asked the question it was meant to ask.

**The three AI routes** (`app/api/ai/route.ts`, `app/api/ai/master-brief/route.ts`,
`app/api/ai/rfp-output-template/route.ts`):

```ts
const allowed =
  isDemo || profile?.is_admin ||
  profile?.role === 'partner' ||
  (profile?.role === 'agency' && profile?.is_paid !== false)
```

Two of the three carried `profile?.is_admin ||` twice in the same expression, which is
cosmetic but tells you the expression was pasted rather than reasoned about.

**`app/api/documents/extract-text/route.ts`:**

```ts
const allowed = isDemo || profile?.role === "partner" || profile?.is_admin || profile?.is_paid
```

**`app/api/upload/route.ts:59`:**

```ts
const canUpload =
  isDemoMode || profile?.role === 'partner' || profile?.role === 'agency' ||
  profile?.is_admin || profile?.is_paid
```

**`app/api/agency/msa/ai-schedule/route.ts` and `app/api/agency/payment-synthesis/route.ts`:**

```ts
const allowed = isDemo || profile?.is_admin || (profile?.role === "agency" && (profile?.is_paid || profile?.is_admin))
```

The common defect: all of them answer *"may this caller"* using `profiles.role`. Since 056,
`role` says `'agency'` on every account regardless of what the signup form said, so it names
neither the side the caller is on nor anything at all about billing. Two questions -
which portal, and is the payer entitled - collapsed into one column that answers neither.

### 2.2 Confirming and refuting the previous run's findings

**CONFIRMED: `upload/route.ts:59` denied nobody.**

`role` is a text column that the trigger always populates, and every one of the 15 live
profiles holds exactly `'agency'` or `'partner'`. The second and third clauses of that
expression - `role === 'partner' || role === 'agency'` - therefore matched every
authenticated caller between them. The `403 'Upgrade to upload files'` was unreachable. Not
"rarely fired": unreachable.

**REFUTED: the premise that migration 056 set `is_paid = true` for everyone, so the bug is
latent.**

`sbatty@thelab.co` carries **`is_paid = false`** right now. Read today, read-only. The
account was created 2026-07-20, after 056, so the trigger inserted `true` and something set
it back - almost certainly the admin toggle at `app/admin/users/page.tsx:124`, which is what
it is for.

The conclusion needs splitting, though, because "the premise is false" and "somebody is being
wrongly denied" are not the same claim:

- The premise is false. There is a live account with `is_paid = false`, so any gate that
  actually reads `is_paid` is deciding something today, not in some future where billing
  writes the column.
- Nobody is being *wrongly* denied. `sbatty@thelab.co` is a lead agency whose access was
  deliberately restricted. Denying it AI is the gate working.
- The real hole was the other direction: `role === 'partner'` as a standalone allow clause,
  with no billing test anywhere in the expression. Three live accounts hold `role = 'partner'`
  today, and the Item 1 backfill would take that to as many as ten. Every one of them had
  unconditional access to the agency AI routes.

So: **latent in one direction, live in the other, and the previous run's stated reason was
wrong even where its conclusion was defensible.**

### 2.3 What the gates check now

New file, `lib/entitlements.ts`. It holds the billing half; `lib/acting-role.ts` keeps the
portal half. Nothing about plan contents or quota numbers changed.

| Function | Answers | Rule |
|---|---|---|
| `isDemoDeployment()` | is this the demo deployment | one home for the env var name |
| `agencyEntitlementId(userId)` | what identity are entitlement and quota keyed to | **returns the user id unchanged today.** The 079 seam |
| `hasAgencyEntitlement(profile)` | is the payer entitled | demo, or `is_admin`, or `is_paid === true` |
| `canUseAgencyAi(profile)` | may they run agency AI | demo, or `is_admin`, or acting as agency **and** `is_paid === true` |
| `canUploadFiles(profile)` | may they upload | demo, or `is_admin`, or acting as vendor (free), else `is_paid === true` |
| `canUseAgencyPortalAi(profile)` | portal + entitlement pair | `canActAs(agency) && hasAgencyEntitlement()` |

Three deliberate decisions inside it:

1. **`is_paid === true`, not `is_paid !== false`.** The two spellings were already
   inconsistent across routes - the AI routes used `!== false`, the project and upload routes
   used truthiness. One spelling, and it is the strict one: a null entitlement is not an
   entitlement. No live profile carries a null `is_paid`; verified read-only today.
2. **The standalone `role === 'partner'` allow clause is gone from the agency routes.** Every
   caller of `/api/ai/master-brief`, `/api/ai/rfp-output-template` and
   `/api/documents/extract-text` lives under `app/agency/`, verified by grep. `/api/ai` has
   no callers at all. That clause granted an agency capability to the vendor side for
   nothing.
3. **The portal question uses `actingRole()`, the session answer,** not the permissive
   `canActAs()` OR-widening - except in the two routes that already used `canActAs()` for
   their portal gate, where it is preserved exactly. Those two only had their **billing** half
   changed.

### 2.4 Every site marked for 079

All of these carry the literal string `"079:"` in a comment, so the migration run can find
them with one grep:

```
grep -rn "079:" app/ lib/
```

**Entitlement read sites** - these must read the organization's entitlement instead of the
member's `profiles.is_paid`:

| File | What changed now |
|---|---|
| `lib/entitlements.ts` | The seam itself. `hasAgencyEntitlement()` and `agencyEntitlementId()` are the two functions 079 rewrites |
| `app/api/ai/route.ts` | `canUseAgencyAi()` |
| `app/api/ai/master-brief/route.ts` | `canUseAgencyAi()` |
| `app/api/ai/rfp-output-template/route.ts` | `canUseAgencyAi()` |
| `app/api/documents/extract-text/route.ts` | `canUseAgencyAi()` |
| `app/api/upload/route.ts` | `canUploadFiles()` |
| `app/api/agency/msa/ai-schedule/route.ts` | `hasAgencyEntitlement()`, portal gate untouched |
| `app/api/agency/payment-synthesis/route.ts` | `hasAgencyEntitlement()`, portal gate untouched |
| `app/api/projects/route.ts` | `hasAgencyEntitlement()` |
| `app/api/agency/projects/duplicate/route.ts` | `hasAgencyEntitlement()` |

**Quota key sites** - ten calls across eight routes, every one now routed through
`agencyEntitlementId()`. It is the identity function today, so nothing changed at runtime:

| File | Call |
|---|---|
| `app/api/projects/route.ts:489` | `checkUsageLimit(agencyEntitlementId(user.id), ..., 'projects')` |
| `app/api/agency/projects/duplicate/route.ts:45` | `checkUsageLimit(..., "projects")` |
| `app/api/agency/bids/[responseId]/ai-score/route.ts:156, 368` | `checkUsageLimit` + `incrementAiAnalysis` |
| `app/api/agency/bids/[responseId]/decompose/route.ts:134, 183` | same |
| `app/api/agency/bids/[responseId]/generate-summary/route.ts:22, 33` | same |
| `app/api/agency/bids/compare/route.ts:108, 160` | same |
| `app/api/agency/delivery-reviews/route.ts:280, 311` | same |
| `app/api/agency/email-scan/route.ts:73` | `checkUsageLimit` |
| `app/api/agency/email-scan/run/route.ts:352` | `incrementAiAnalysis` |
| `app/api/agency/usage/route.ts:15` | `checkUsageLimits` |

`lib/usage-tracking.ts` carries a header explaining why: a colleague passing their own user id
would silently open a second `usage_tracking` row and receive a second full quota, which is
exactly what "adding a colleague costs nothing, a member consumes the organization's quota"
rules out.

**The quota model already matches the ruling.** `usage_tracking` is keyed on `agency_id`, one
row per agency per month, and nothing in it counts seats. 079 renames the column and changes
what gets passed in. That is all.

**Two routes deliberately left alone:** `app/api/partner/rfp-bid/upload/route.ts` and
`app/api/partner/documents/upload/route.ts`. Both are vendor-only, the vendor side uploads
free, and their vestigial `|| profile?.is_paid` clause decides nothing the "Vendors only"
check immediately below does not already decide - a paid agency clears the first line and is
turned away by the second. Rewriting them through `lib/entitlements.ts` would change behaviour
for a `role='partner'` / `active_role='agency'` account with no billing reason to. Both now
carry a comment saying so, and both are marked `079:`.

### 2.5 The one behaviour change with a live consequence

**`sbatty@thelab.co` can upload files today. After this deploy it cannot.**

`role = 'agency'`, `active_role = 'agency'`, `is_admin = false`, `is_paid = false`. Under the
old expression it cleared `role === 'agency'` and passed. Under `canUploadFiles()` it is not
acting as a vendor, is not an admin, and is not paid, so it gets the 403 the route has always
claimed to return.

That is the gate finally doing what its own error message says, and the `is_paid = false` was
set deliberately through the admin page. But it is a real change to a real account and you
should decide it rather than discover it. If the restriction was not meant to be that broad,
toggle `is_paid` back on at `/admin/users`; nothing in this run needs to be reverted for that
to work.

No other live account changes behaviour: the remaining 14 are either `is_admin`, `is_paid`,
or acting as a vendor.

---

## Item 3: milestone attribution

Full map in **`docs/milestone-attribution-map.md`**. Summary:

**Recent Activity is derived, not stored.** It is built per request in
`app/api/agency/dashboard/route.ts:369-418` as a union of four timestamp columns -
`projects.created_at`, `partner_rfp_responses.submitted_at`, `partner_rfp_inbox.viewed_at`,
`onboarding_packages.partner_reviewed_at` - sorted descending and sliced to 15. There is no
events table. Nothing is persisted. There is no actor column anywhere in it, and **every event
it can express is one a counterparty performed** - the vendor who viewed, the vendor who bid.
"Alex sent the RFP" has nowhere to live. It is scoped by `agency_id = user.id` on every query,
which is user-scoping that looks like company-scoping only because one user is currently one
company.

**`notifications` is not an alternative.** It is per-recipient rather than per-event, carries
its actor as prose inside a message string, has zero read callers anywhere in the codebase
(recorded in its own route's TODO), and its INSERT policy is partnership-scoped, so a
colleague cannot be notified at all.

**So the mechanism is a table.** The map covers **34 agency-side milestones and 8 vendor-side
ones across 14 tables**, each with its emission site, whether the vendor sees it, and whether
anything persists it today. Six leave no trace at all. Two are actively destructive: a resent
invitation overwrites `invitation_sent_at`, and a changed response deadline overwrites the old
one - so an actor column on those rows would record who acted *last* and discard the earlier
fact.

**Policy shape**, stated in full in section 5 of the map: RLS enabled in the same migration
that creates the table; organization-scoped through the membership function, deny by default;
the vendor-visible subset an **explicit whitelist of event types held in a function**, never
"everything not marked private"; the membership predicate a `SECURITY DEFINER` function with
`SET search_path = public, pg_temp`; **no UPDATE policy and no DELETE policy for anybody**,
because a breadcrumb that can be edited is not a breadcrumb; and `actor_id` nullable with an
email fallback, because guest and magic-link actors have no user id and modelling it `NOT
NULL` breaks the guest bid flow.

**Vouching** needs its own treatment and its own table. The ruled shape is
colleague-visible and outsider-anonymous, which is the inverse of every other event's
visibility rule - putting it on a table governed by a vendor-visible whitelist is how it
eventually leaks. Its live policy set also contains a real exposure: `Anyone can count
vouches` is `SELECT`, role `{public}`, `qual: true`. Migration 053's comment says counting is
safe, and the *number* is, but the policy grants access to **rows**, not to a count, so the
anon key can read the entire who-vouched-for-whom graph. The application only ever asks for a
count, which is why it has never surfaced. The policy is the permission.

**No migration was authored and no emission site was built.** The recommendation against an
additive actor-column step is argued in section 8 of the map: 14 `ALTER TABLE`s and roughly 30
route edits, it cannot cover the six milestones that have no row to attach to, and a partial
breadcrumb trail reads as a complete one. The one precedent worth keeping is
`partnerships.msa_confirmed_by`, which already exists from migration 051 and is the only actor
column in the product.

---

## Item 4: the capability catalogue

Full catalogue in **`docs/capabilities.md`**. Summary:

A named capability for every gated action, agency side and vendor side, in a stable dotted
vocabulary, each with what it gates, whether it is reversible by the ruled test, and a
proposed default of `owner` / `admin` / `member`. 90 distinct capability names across vendor pool,
clients, projects, RFP, bids, onboarding and delivery, money, organization and billing,
platform administration, and the vendor portal.

**Reversibility is applied literally:** can a member of the same organization put it back,
from inside the product, without help? Not "is there a backup". If undoing it needs you, a
migration, or the counterparty's cooperation, it is irreversible and defaults to admin.

**Every capability is enforced server-side, in the route handler, before the write.** The
document says this in section 0 and gives the reason: a capability hidden in the interface but
unchecked in the route is not a permission, and this codebase has shipped that mistake twice
this month - `docs/admin-security-fix-report.md`, and commit `72b8ed3`, which stopped testing
the invitee's role when inviting a vendor.

There is a corollary the 079 run has to act on. **RLS is not the capability check.** Row level
security answers "may this organization touch this row". Once bucket (a) of
`docs/policy-rewrite-surface.md` moves to an organization predicate, every member satisfies it
identically, and RLS stops being able to distinguish an admin from a member. **The capability
checks must exist in the routes before that migration runs, not after.**

### Irreversible actions currently open to anyone

Read as: *once 079 makes `agency_id` an organization key, will every member pass the check
that exists in the route today?*

Most of these routes are not unguarded now. They check `agency_id = user.id`, which is
simultaneously the ownership check and, accidentally, the only thing standing between one
person and the whole capability. **These are not future risks. They are present code with a
fuse in it.**

| Capability | Where | State today |
|---|---|---|
| `vendor.remove` | `app/api/partnerships/route.ts:930` DELETE | Ownership check only, no role check of any kind |
| `bid.award` | `app/api/agency/rfp-responses/[id]/route.ts` | Ownership only. The route already blocks un-awarding, so the code knows the transition is one-way |
| `bid.decline` / `bid.feedback` | same route | Ownership only, and it sends mail to the vendor |
| `rfp.broadcast` | `app/api/agency/broadcast-rfp/route.ts` | Ownership only. Emails the entire recipient list |
| `payment.mark_paid` | `app/api/agency/msa/milestones/route.ts` | Ownership only. A vendor-visible financial assertion |
| `client.document_remove` | `app/api/agency/library-documents/[id]/route.ts` DELETE | Ownership only. Deletes the blob |
| `vendor.vouch` | `app/agency/pool/[partnerId]/page.tsx:255-260` | **No route at all.** A browser-side insert and delete straight into `partner_vouches` through the anon-key client, gated only by RLS. There is no server-side place to put a check. This one needs a route before it needs a capability |

Three of the brief's named cases **have no code today**, and are catalogued so the capability
exists before the route does:

- **`project.delete`** - no deletion route exists. `app/api/projects/[id]/route.ts` exposes
  GET and PATCH only.
- **`org.member_revoke`** - no members exist yet. 079 creates this, and it is the first
  genuinely destructive member-facing action in the product.
- **`billing.cancel`, `billing.change_plan`, `billing.payment_method_remove`** - there is no
  billing integration in this repository. No Stripe dependency in `package.json`, and the
  Enterprise call to action on `/pricing` is "Contact Sales". `usage_tracking.plan_tier` is
  written by nothing but the carry-forward default in `lib/usage-tracking.ts`.

Capability names double as milestone event types from `docs/milestone-attribution-map.md`; the
pairs are listed in section 5 of the catalogue. `vendor.vouch` is deliberately excluded from
that alignment, for the visibility reason above.

---

## Item 5: the policy rewrite surface

Full per-policy table in **`docs/policy-rewrite-surface.md`**. Summary:

| Bucket | Definition | Count | Tables |
|---|---|---:|---:|
| **(a)** | Keyed directly on `agency_id` / `partner_id` equalling `auth.uid()` on the policy's own table. Predicate becomes a membership lookup | **49** | 22 |
| **(b)** | Relationship-scoped through `partnerships` / `projects` / `project_assignments`. Only the join column changes | **34** | 16 |
| **(c)** | User-scoped on `user_id = auth.uid()` (or `sender_id`, `uploaded_by`, `profiles.id`). Unchanged by the org model | **15** | 8 |
| **(d)** | Identity-independent: public, anon, or bare `true`. Unchanged | **3** | 3 |
| **(U)** | **Bucket undetermined. Flagged, not guessed** | **3** | 2 |
| | **Total** | **104** | **38** |

**Method note worth keeping.** The snapshot's CSV block holds **108** rows, not 104. Supabase
truncated the original export at 100 rows silently, so the file is two exports spliced at
`tablename = 'projects'`, and the seam repeats the header line plus the three `projects`
policies falling on both sides. Deduplicating by `(tablename, policyname)` gives exactly 104,
which agrees with the count `docs/schema-truth.md` states independently. That agreement is the
check that the parse is right, and it is exactly the truncation hazard the standing doctrine
warns about.

### The three undetermined policies

All three key on **an email address matched against the caller's own profile email**, which is
neither an id comparison nor a relationship join. **An organization does not have one email
address**, so there is no mechanical rewrite - this needs a product ruling.

| Table | Policy | Cmd | The question |
|---|---|---|---|
| `invitation_requests` | Agencies can view requests to their email | SELECT | A vendor requests access by typing a lead agency's email. Once that agency has several members, whose mailbox counts? |
| `invitation_requests` | Agencies can update requests to their email | UPDATE | Same, and this one grants write |
| `partner_rfp_inbox` | Partners select inbox rows by recipient email | SELECT | The ghost/unclaimed vendor path. May a colleague read a row addressed to another member's mailbox? |

Three further policies carry an email disjunct **beside** an id predicate and are classified by
the id half, with the email half noted: both `agency_partner_invitations` partner policies, and
`partner_rfp_inbox / Partners update own inbox rows`. They inherit whatever ruling the three
above get.

### The 15 production-only policies

All 15 were located and are marked in the per-policy table. Distribution:

- **9 in bucket (c)** - user-scoped, unchanged by the org model. 079 does not need to touch
  them and cannot break them by failing to drop them.
- **5 in bucket (b)**, **1 in bucket (a)** - these are the dangerous ones. A `DROP POLICY IF
  EXISTS` authored from a repo filename matches nothing, reports success, and leaves the live
  policy in place beside whatever 079 creates.

The one that matters most is `profiles / "Users can view profiles of partnership members"`
(bucket b): the policy that lets either side of a partnership read the other's profile row,
described in `docs/schema-truth.md` as the most load-bearing SELECT policy in the product, and
present in no file.

**Working rule for 079:** every `DROP POLICY` statement it contains must be copied from
`docs/schema-snapshot-2026-08-13.md`, never from a migration file, and the snapshot must be
re-taken and re-committed immediately afterwards.

### Two policies needing attention independent of 079

Found while classifying. Neither is an organizations problem; both are live now.

```
project_documents / Users can upload documents   INSERT {authenticated}  with_check: (uploaded_by = auth.uid())
project_messages  / Users can send messages      INSERT {authenticated}  with_check: (sender_id  = auth.uid())
```

Neither ties the row to a project the caller has any relationship with. The only condition is
that the row names the caller. Any authenticated user can insert a document row, or a message,
against any project id in the system. Both SELECT sides are correctly scoped, so nobody can
read back what they inserted unless they belong there, and the interface never offers the
action - which is mitigation, not permission. Worth fixing on its own schedule, and worth not
bundling into 079.

---

## Judgment calls taken

1. **Deleted `docs/proposed-migration-role-trigger.sql`.** Its header claimed 078 was reserved
   for Organizations M1, which this run made false, and keeping it would leave two copies of
   the same SQL with one of them actively misleading. Full-repo grep first: three references,
   all inside `docs/schema-truth-and-m1-prep-report.md`, a dated report that correctly
   describes the state when it was written. Git retains the file.
2. **Per-account backfill writes `secondary_role = 'agency'` as well as `role` and
   `active_role`.** Without it, flipping `role` to `'partner'` takes away lead agency portal
   access these seven have today, because `switch-role` tests for `'agency'` in either column.
   Writing it preserves the status quo and makes the flip one-click reversible. Called out for
   your ruling in "Decisions Greg owes".
3. **Migration 078 keeps granting `secondary_role = 'agency'` to new vendor signups.** That
   hands a vendor the lead agency portal for free - but so does today's behaviour, through
   `role = 'agency'`. Changing it in 078 would silently change what a plan includes. It belongs
   with 079.
4. **Normalized `is_paid !== false` to `is_paid === true`.** The two spellings were already
   inconsistent across routes. A null entitlement is not an entitlement. No live profile
   carries a null `is_paid`; verified read-only.
5. **Removed the standalone `role === 'partner'` allow clause from the agency AI routes rather
   than repairing it.** Every caller of those routes lives under `app/agency/`, verified by
   grep, so it granted an agency capability to the vendor side for nothing.
6. **Left the two `app/api/partner/*/upload` routes untouched.** Their entitlement clause is
   vestigial and the "Vendors only" check below it is the real gate. Rewriting them would
   change behaviour for a `role='partner'` / `active_role='agency'` account with no billing
   reason to. Both are commented and marked `079:`.
7. **Routed all ten quota call sites through `agencyEntitlementId()` even though it is the
   identity function today.** It is a no-op at runtime and it turns "find every place quota is
   keyed" into one grep for the 079 run.
8. **Bucket (d) in Item 5 is read as "identity-independent" rather than literally anon.** One
   of the three, `profiles / Authenticated users can read discoverable profiles`, is granted to
   `{authenticated}`, but its whole predicate is `is_discoverable = true` with no identity
   term. It belongs in (d) by the property the bucket exists to capture, which is that 079 does
   no work on it. Stated in the document.
9. **Classified mixed policies by the half that carries the rewrite work, and noted the other
   half.** `profiles / Users can view profiles of partnership members` and `notifications /
   Scoped insert notifications` both OR a self-row disjunct with partnership subqueries; both
   are bucket (b), because all the 079 work is in the joins.
10. **Recommended against the additive actor-column migration in Item 3** rather than authoring
    one. The brief permitted proposing it if genuinely small. It is not: 14 tables, ~30 route
    edits, and it cannot cover the six milestones with no row to attach to.

---

## Not done, and why

- **Appendix query A8 was not executed.** PostgREST cannot reach `pg_catalog.pg_proc`, no
  SQL-executing RPC is exposed on this Supabase project, and the sandbox blocked both attempts
  to probe for one. I did not work around the block. The query is at the top of this report and
  every dependent finding is marked UNCONFIRMED.
- **No migration was applied and no write query was run.** Everything against production this
  run was `SELECT` or the GoTrue admin `listUsers` read.
- **No role was backfilled.** The statements are here; they are yours to run.
- **No milestone emission site was built**, and no migration was authored for one.
- **`lib/usage-tracking.ts` quota numbers, plan contents and pricing are untouched.**
- **`pnpm lint` still exits 1**, with 178 pre-existing problems. Report-only per the brief;
  none of them are in a file this run created or changed, checked by grepping the lint output
  for each changed path.
- **Nothing was pushed.** Six local commits on `main`.

---

## Honest verification statement

### Executed from this terminal, results observed

| Check | How | Result |
|---|---|---|
| `npx tsc --noEmit` | before each of the six commits | exit **0** every time |
| `pnpm build` | before each of the six commits | exit **0** every time |
| `pnpm lint` | after the Item 2 code change | exit 1, 178 pre-existing problems, **none in a changed file** (grepped output for every changed path, no matches) |
| The 15 live profiles: id, email, role, active_role, secondary_role, is_paid, is_admin, created_at | `SELECT` via the service role key | table in 1.4 |
| Signup metadata role for all 15 | GoTrue admin `listUsers`, read | column in 1.4 |
| Agency-side row counts per account: `projects`, `partnerships as agency`, `clients`, `agency_library_documents` | four `count(exact)` reads per account, 60 reads | **all zero for all seven** |
| `sbatty@thelab.co` has `is_paid = false` | same read | confirmed |
| Snapshot parse yields exactly 104 unique policies | balanced-paren parser over the CSV block, dedup by `(tablename, policyname)` | 108 raw rows, 104 unique, agrees with `docs/schema-truth.md` |
| All 15 production-only policies located in the classification | set membership against the `docs/schema-truth.md` section 4 list | **15 of 15 matched** |
| Callers of the three AI routes and `extract-text` all live under `app/agency/` | repo-wide grep excluding `app/api/` | confirmed; `/api/ai` has no callers at all |
| No em dashes in anything this run wrote | grep | zero |

### NOT executed. Claims that rest on reading code, not running it

- **The live body of `handle_new_user()`.** Unread. Section 1.2's account of it is inference
  from the shape of the data, not observation. Marked UNCONFIRMED in the migration header too.
- **The login-to-middleware redirect sequence in 1.3.** Traced by reading
  `app/auth/login/page.tsx`, `middleware.ts` and `app/auth/mfa-verify/page.tsx`. **No browser
  was driven and no account was logged into.** The three-row outcome table is derived from the
  code, and it is the thing most worth confirming with a real click after any backfill.
- **Every 403 and 200 in section 2.5.** `canUploadFiles()` and `canUseAgencyAi()` were reasoned
  against the live profile rows, not exercised. `sbatty@thelab.co` losing upload access is a
  prediction from `is_paid = false` plus the new expression. It was **not** tested by signing
  in as that account, and it should not be - that account belongs to someone.
- **Migration 078 has not been run anywhere**, including locally. It has never been parsed by
  Postgres.
- **The `qual: true` exposure on `partner_vouches`** is read from the authoritative snapshot.
  No query was run with the anon key to demonstrate it, deliberately.
- **The two unscoped INSERT policies** in Item 5 are likewise read from the snapshot, not
  demonstrated.
- **No email was sent and no invitation was triggered.** Nothing in this run touched a mail
  path.

---

## Live checklist for Item 2, in click order

Deploy first, then walk this. Every step is a browser action against the deployed site.

**As `gmarkant@gmail.com`** (agency, `is_paid = true`, `is_admin = true`) - the paid path must
be unchanged:

1. Sign in. Land on `/agency/dashboard`. Recent Activity renders as before.
2. `/agency` - upload a client brief. **Expect: uploads.** (`canUploadFiles`, admin bypass.)
3. Same page - the brief's text extracts. **Expect: text appears, no 403.**
   (`canUseAgencyAi` on `/api/documents/extract-text`.)
4. Generate the master brief. **Expect: it generates.** (`/api/ai/master-brief`.)
5. Generate an RFP output template. **Expect: it generates.**
   (`/api/ai/rfp-output-template`.)
6. `/agency/magic-rfp` - run the template step there too. **Expect: it generates.**
7. Create a project. **Expect: created.** (`hasAgencyEntitlement` plus the project quota.)
8. Duplicate that project. **Expect: duplicated.** (`/api/agency/projects/duplicate`.)
9. `/agency/bids` on any bid - run AI scoring. **Expect: it runs, and the analysis counter
   moves.** (Quota routed through `agencyEntitlementId`.)
10. Check `/agency` usage display. **Expect: the AI analysis count went up by exactly the
    number of analyses run, not by more.** This is the check that
    `agencyEntitlementId()` did not accidentally open a second `usage_tracking` row.
11. MSA - run the AI payment schedule. **Expect: it runs.** (`hasAgencyEntitlement` +
    `canActAs`.)
12. Run the payment synthesis. **Expect: it runs.**

**As a vendor account** (`gmarkant+partner71@gmail.com` or `gmarkant+partner64@gmail.com`,
`role = partner`) - the vendor side must still be free:

13. Sign in. Land on `/partner`.
14. Open an RFP and upload a bid attachment. **Expect: uploads.**
    (`/api/partner/rfp-bid/upload`, untouched.)
15. `/partner/profile` - upload a company logo. **Expect: uploads.**
    (`/api/upload`, `canUploadFiles` vendor branch.)
16. `/partner/legal` - upload a legal document. **Expect: uploads.**
    (`/api/partner/documents/upload`, untouched.)
17. Submit a bid. **Expect: submits.**

**As a dual-role account** (`gmarkant+partner23@gmail.com`, `role = agency`,
`active_role = partner`):

18. Sign in. **Expect: `/partner`.**
19. Upload something on the vendor side. **Expect: uploads** - the vendor branch, keyed on
    `actingRole()`, not on `role`.
20. Switch to the agency portal. Upload a client brief. **Expect: uploads**, because
    `is_paid = true`.

**The restricted account** - do **not** sign in as `sbatty@thelab.co`. It belongs to someone.
Verify by reading instead:

21. `/admin/users` as an admin. Confirm `sbatty@thelab.co` still shows `is_paid = false`.
22. Decide: leave it restricted, in which case that account can no longer upload and that is
    intended; or toggle `is_paid` on, in which case it behaves as it did before this deploy.
    Either is fine. The point is that it is now a decision rather than an accident.

**If anything in 1-20 returns a 403 it did not return before**, the gate to look at is
`lib/entitlements.ts` and the specific function named in the 2.4 table for that route. Every
one of them is a pure function over `{role, active_role, is_paid, is_admin}` and the profile
row is one `SELECT` away.

---

## Commits, in order

| Commit | Item | Subject |
|---|---|---|
| `d96fcb4` | 1 | `feat: author migration 078, the signup role trigger fix` |
| `e804604` | 2 | `fix: entitlement gates read entitlement, not the signup role column` |
| `5f8e58e` | 3 | `docs: milestone attribution map, and what Recent Activity actually is` |
| `e1ac793` | 4 | `docs: capability catalogue for the 079 build` |
| `709f1e0` | 5 | `docs: classify all 104 live policies into the 079 rewrite surface` |
| this one | - | `docs: M1 pre-work report` |

**Nothing pushed.**
