# The 056 signup-role defect: where it actually lives

**Date:** 2026-08-25  **Branch:** `fix/acting-role-read-scope`
**Status:** INVESTIGATION ONLY. Nothing was fixed. No migration was authored, and none
should be: `handle_new_user()` is a SECURITY DEFINER function this repository cannot
reproduce, and the fix this report recommends does not need one.

**Trigger case:** profile `647261c4`, signup 2026-08-23, chose `partner`, landed with
`active_role = 'agency'`. Same shape as partner23 and roughly twelve accounts in July.

---

## THE HEADLINE, BEFORE THE DETAIL

**The live trigger, as 079 defines it, CANNOT produce `role='partner'` with
`active_role='agency'`. It writes both columns from one variable, in one statement.**

That is not a quibble about wording. It decides where the fix goes. If the trigger cannot
produce the observed row, then either the live trigger is not the 079 one, or **a second
write produced the split** - and a migration against the trigger would fix neither.

Reading the code, there are exactly **two** application-side defects that can produce it,
both in `app/auth/callback/route.ts`, and **both are fixable without a migration**.

---

## (a) What `handle_new_user()` writes

`supabase/migrations/079_organizations.sql:1841-1926`, PHASE 12. SECURITY DEFINER,
`SET search_path = public, pg_temp`.

**It reads exactly one metadata key for the role decision:**

```sql
chosen_role := CASE                                              -- 079:1853-1856
  WHEN NEW.raw_user_meta_data->>'role' = 'partner' THEN 'partner'
  ELSE 'agency'
END;

other_role := CASE WHEN chosen_role = 'partner' THEN 'agency' ELSE 'partner' END;  -- :1858
```

**It writes all three role columns from those two variables:**

| Column | Value written | Line |
|---|---|---|
| `role` | `chosen_role` | 079:1873 |
| `active_role` | `chosen_role` | 079:1874 |
| `secondary_role` | `other_role` | 079:1875 |

Other keys read: `full_name`, `company_name` (both `COALESCE(..., '')`), plus
`company_name` again through a different normalization for `organizations.name`.

**Three properties that matter for this investigation:**

1. **`role` and `active_role` are written from THE SAME VARIABLE, in the same `INSERT`.**
   They cannot differ. There is no branch, no second statement, no later touch.
2. **The default for a missing or non-`'partner'` key is `'agency'`.** `ELSE 'agency'` is
   reached by a NULL key, an empty string, `'Partner'` with a capital P, a trailing space,
   or any other value. It is not a `partner`/`agency` test; it is a `partner`/everything-else
   test.
3. **`ON CONFLICT (id) DO UPDATE` deliberately excludes all three role columns**
   (079:1877-1882, with the comment saying so). A re-fired trigger on an existing profile
   updates `email`, `full_name` and `company_name` and touches no role.

**So: no metadata `role` key produces `agency`/`agency`. A `role: 'partner'` key produces
`partner`/`partner`. Neither produces the observed split.**

---

## (b) What the signup form puts in the metadata

`app/auth/sign-up/page.tsx:206`, inside `supabase.auth.signUp({ options: { data: { ... } } })`:

```ts
role: (hasRfpInviteContext || hasPartnershipInviteContext) ? 'partner' : role,
```

**The key name matches.** The form writes `role`; the trigger reads `->>'role'`. There is no
key-name mismatch, which was the first thing worth ruling out.

**Can `role` be null at submit?** In a browser, no. `role` is `useState<UserRole | null>(null)`
(:53) and every one of the four paths that reaches step 2 sets it first:

| Path | Line |
|---|---|
| RFP or partnership invite context | :68-69 `setRole("partner"); setStep(2)` |
| magic-link / pool-resend source | :74-75 `setRole("partner"); setStep(2)` |
| clicked the Agency card | :265-266 `setRole("agency"); setStep(2)` |
| clicked the Vendor card | :290-291 `setRole("partner"); setStep(2)` |

The submit handler is only reachable from step 2. The "back" control at :535 returns to step
1 without clearing `role`.

**But the submit handler validates six things and `role` is not one of them** (:120-147:
terms, privacy, password match, password length, company name, full name). The invariant
"role is always set by the time we submit" is held by the step machine alone, and nothing
asserts it. That is fragile rather than broken.

**And it is not a boundary.** `signUp()` is called client-side with the anon key. The file's
own comment at :199-203 already says this about `company_name`, and it is equally true of
`role`: a request not made by this form carries whatever metadata its author chose,
including none. There is no OAuth or OTP signup path in this repository
(`grep signInWithOAuth|signInWithOtp` returns nothing), so the form is the only *product*
entry point - but it is not the only possible one.

### Where the two disagree

Not on the key name, and not on the happy path. On two things:

> **DISAGREEMENT 1 - OPPOSITE DEFAULTS FOR A MISSING KEY.**
>
> | Component | Missing `role` means | Where |
> |---|---|---|
> | `handle_new_user()` | **`'agency'`** | 079:1853-1856, the `ELSE` |
> | `app/auth/callback/route.ts` | **`'partner'`** | :12, `metadata.role \|\| 'partner'` |
>
> ```ts
> const role = hasInviteContext ? 'partner' : (metadata.role || 'partner')   // :12
> ```
>
> Two components read the same absent key and reach opposite conclusions. Which one an
> account gets depends on which ran, and on whether the user ever clicked the confirmation
> link. This is the contract defect, and it is the one that explains the *July* cluster:
> the trigger stamps `agency`/`agency`, and the callback later overrides both to
> `partner`/`partner`, so the account's role depends on a race with the user's email client.

> **DISAGREEMENT 2 - AN ASYMMETRIC WRITE, AND THE ONLY THING IN THE CODEBASE THAT CAN
> PRODUCE THE OBSERVED ROW.**
>
> ```ts
> if (role === 'partner' && (existingProfile.role !== 'partner'
>                            || existingProfile.active_role !== 'partner')) {
>   updatePayload.role = 'partner'
>   updatePayload.active_role = 'partner'          // both, together - correct
> } else if (!existingProfile.role) {
>   updatePayload.role = role                       // :87 - role ALONE
> }
> ```
> `app/auth/callback/route.ts:83-88`
>
> **Line 87 writes `role` and leaves `active_role` untouched.** Every other writer of these
> columns in the repository moves them together or moves `active_role` alone deliberately.
> This is the single site where the two can diverge, and divergence is exactly the reported
> symptom.
>
> It fires when `existingProfile.role` is falsy - a profile row that exists with a NULL or
> empty `role`. The trigger never leaves `role` NULL, so this branch is unreachable **if the
> trigger ran**. It is reachable for a profile created some other way, which the callback's
> own insert branch at :30-56 exists to handle and whose comment says the trigger "does not
> always fire".

---

## (c) Trigger, form, or contract - and what can be fixed without a migration

**THE CONTRACT.** Neither component is internally wrong.

- **The trigger is self-consistent.** It writes `role` and `active_role` from one variable.
  Its `ELSE 'agency'` default is defensible in isolation. **It cannot produce the observed
  row.**
- **The form is self-consistent in a browser.** The key name is right, and the step machine
  guarantees a value. Its weakness is that the guarantee is structural rather than asserted,
  and that it is not a trust boundary.
- **The contract between them is broken in two places, and both are in TypeScript.**

### What can be fixed without a migration

| # | Defect | Location | Migration needed? |
|---|---|---|---|
| 1 | `role` written without `active_role` | `app/auth/callback/route.ts:87` | **No.** One line. |
| 2 | Callback defaults a missing role to `'partner'`; trigger defaults to `'agency'` | `app/auth/callback/route.ts:12` | **No.** One line. |
| 3 | Submit handler does not assert `role` is set | `app/auth/sign-up/page.tsx:120-147` | **No.** One guard. |
| 4 | Trigger's `ELSE 'agency'` treats "unset" and "agency" as the same thing | 079:1853-1856 | **Yes, and it is not needed** if 1-3 are done. |

**All three defects that matter are fixable in application code.** That is the decision this
report exists to support: **no migration is required, and one should not be written**, both
because this repository cannot reproduce the live SECURITY DEFINER function and because
fixing the trigger would not close either disagreement on its own.

### THE DECISION GREG OWES

**Which default is correct for a signup whose metadata carries no role?**

The two components must agree, and today they are opposites. Three answers, and the cost of
each:

| Answer | What changes | Cost |
|---|---|---|
| **`'agency'`** (adopt the trigger's default) | `route.ts:12` becomes `metadata.role \|\| 'agency'` | A vendor who signs up through a non-form path lands on the agency side. Matches the trigger, so the account is stable whether or not the callback runs. |
| **`'partner'`** (adopt the callback's default) | Requires a migration to change the trigger. | The one option that needs the thing this report says not to do. |
| **Refuse** - treat a missing role as an error | `route.ts:12` stops defaulting; the form asserts at :120 | Nothing silently lands on the wrong side. Costs a visible failure on a malformed signup, which is the correct place for it. Does not need the trigger to change: the trigger keeps `ELSE 'agency'` and the application simply never sends an absent key. |

**The asymmetric write at :87 does not need this ruling and should be fixed regardless.**
Writing `role` without `active_role` is wrong under every answer above.

---

## (d) The count query. NOT RUN - I have no database access.

**How many live profiles have `role` and `active_role` disagreeing:**

```sql
SELECT count(*) AS disagreeing,
       count(*) FILTER (WHERE role = 'partner' AND active_role = 'agency') AS partner_on_agency_side,
       count(*) FILTER (WHERE role = 'agency'  AND active_role = 'partner') AS agency_on_vendor_side,
       count(*) FILTER (WHERE active_role IS NULL)                          AS active_role_null,
       count(*) FILTER (WHERE role IS NULL)                                 AS role_null
  FROM public.profiles;
```

`role IS NULL` is included because it is the precondition for the asymmetric write at
`route.ts:87`. A non-zero count there is the population that branch can still reach.

**The per-row detail, which is what a decision actually needs:**

```sql
SELECT id, email, role, active_role, secondary_role, created_at
  FROM public.profiles
 WHERE role IS DISTINCT FROM active_role
    OR role IS NULL
 ORDER BY created_at DESC;
```

`IS DISTINCT FROM`, not `<>`: a NULL on either side must be counted, and `<>` would skip
exactly the rows the :87 branch produces.

### THE QUERY THAT SETTLES WHICH MECHANISM IT WAS, and it is the one to run first

Everything above turns on whether the live trigger is the 079 one. This reads the live
definition rather than trusting this repository:

```sql
SELECT p.proname,
       pg_get_functiondef(p.oid) LIKE '%raw_user_meta_data->>''role''%' AS reads_role_metadata,
       pg_get_functiondef(p.oid) LIKE '%chosen_role,%chosen_role,%'     AS writes_both_from_one_var,
       pg_get_functiondef(p.oid) LIKE '%ELSE ''agency''%'               AS defaults_to_agency
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
```

- **All three true** -> the live trigger is 079's, it cannot have written the split, and the
  cause is `route.ts:87` or a later session write. Fix the TypeScript.
- **`writes_both_from_one_var` false** -> the live trigger is NOT what this repo says, and
  everything in section (a) is about a function that is not running. Dump it in full before
  anything else:
  `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'handle_new_user';`

**And the metadata for the actual row, which discriminates "the form sent no role" from
"something wrote it later":**

```sql
SELECT u.id,
       u.raw_user_meta_data ->> 'role'   AS metadata_role,
       u.created_at                      AS auth_created,
       p.role, p.active_role, p.secondary_role, p.created_at AS profile_created
  FROM auth.users u JOIN public.profiles p ON p.id = u.id
 WHERE u.id = '647261c4-0000-0000-0000-000000000000';   -- full uuid needed
```

- `metadata_role = 'partner'` + `active_role = 'agency'` -> **the trigger did not write that
  value**; something after it did. `route.ts:87` is the only candidate in this repository.
- `metadata_role` NULL or absent -> the form did not send it, the trigger's `ELSE 'agency'`
  fired legitimately, and `role='partner'` was written afterwards - again by `:87`.

---

## What I EXECUTED, READ, and REASONED

**EXECUTED:** `grep` over `app/`, `lib/`, `components/`, `contexts/`, `hooks/` and
`supabase/migrations/`. Nothing else. **No SQL. No database access. No fixes.**

**READ:** `079_organizations.sql:1841-1926`; `app/auth/sign-up/page.tsx` in full;
`app/auth/callback/route.ts:1-100`; `app/api/user/active-role/route.ts` in full;
`app/api/profile/switch-role/route.ts:30-80`; `components/role-toggle.tsx:25-70`;
`app/api/partner/rfps/claim/route.ts:99-114`; `lib/acting-role.ts`.

**REASONED:** That the 079 trigger cannot produce the observed row. That `route.ts:87` is the
only site in this repository that writes `role` without `active_role`. That the browser flow
cannot submit a null role. Each is argued from a quoted line above and each could be wrong in
the way a careful reading can be wrong - which is why section (d) leads with the query that
checks the live trigger rather than trusting this file.

**NOT ESTABLISHED:** which mechanism actually produced profile `647261c4`. That needs the
two queries in (d), and I will not guess between them.

---

## The complete list of `active_role` writers, for whoever fixes this

| Site | Writes | Notes |
|---|---|---|
| `handle_new_user()` 079:1874 | `active_role = chosen_role` | always equal to `role` |
| `app/auth/callback/route.ts:50` | `active_role: role` | insert branch, equal to `role` |
| `app/auth/callback/route.ts:85` | `'partner'` | with `role`, together. Correct. |
| **`app/auth/callback/route.ts:87`** | **`role` only** | **the asymmetric one** |
| `app/api/profile/switch-role/route.ts:38` | `'partner'` | user-initiated, entitlement-checked |
| `app/api/profile/switch-role/route.ts:68` | `'agency'` | user-initiated, entitlement-checked |
| `app/api/user/active-role/route.ts:49` | body value | entitlement-checked |
| `app/api/partner/rfps/claim/route.ts:110` | `'partner'` | on invite claim, best-effort |

**A note on the two switch routes, because it looks like a lead and is not one.** The trigger
sets `secondary_role` to the opposite of the chosen role (079:1858), so **every partner
account is entitled to the agency portal by construction** and both switch routes will write
`active_role='agency'` on request. But both are reached only from `components/role-toggle.tsx`,
which fires on a click (`handleSwitch`, :41). Nothing calls them on mount, on login, or on
redirect - verified by grep. They cannot silently flip a fresh signup.
