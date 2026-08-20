# The company name write path

**Date:** 2026-08-20
**Status:** code written, gates re-run, **not committed** — held for the writer list in section 3.
**Database:** not written to. The repair SQL in section 5 was authored, not run.

---

## The defect, restated from source

`organizations.name` had **no write path anywhere in the codebase**. Verified rather than
assumed: `grep` for `insert`/`update`/`upsert`/`delete` against `.from("organizations")`
across `app/`, `lib/`, `components/` and `scripts/` returns **zero matches**. Sixteen call
sites read that table; none writes it.

Both settings forms wrote `profiles.company_name` and nothing else. All thirteen
counterparty embeds in `lib/org-contact.ts` read `organizations.name`. So the value a vendor
saw for a lead agency and the value that agency edited in its own settings were two
different columns with no connection between them.

They agree today only because 079 PHASE 2 seeded `organizations.name` **from**
`profiles.company_name`, and nobody has renamed a company since. The first rename would have
diverged them silently, permanently, on the counterparty-facing side, with no error anywhere
— a save that reports success and changes nothing anyone else can see.

**The Caro Creative Inc. row has a mechanism, and it is visible in migration 079.** The
PHASE 12 trigger writes `organizations.name` through
`COALESCE(NULLIF(btrim(...), ''), ...)` and writes `profiles.company_name` as a bare
`COALESCE(NEW.raw_user_meta_data->>'company_name', '')` — **no `btrim` at all**. PHASE 2's
backfill has the identical asymmetry (`NULLIF(btrim(p.company_name), '')` into the org, the
raw column left alone). One column was normalized at birth and the other was not, so a
trailing space typed on the signup form survived in exactly one of the two. That is the
nineteen bytes against eighteen.

---

## 1. Which column is authoritative

**`organizations.name` wins. `profiles.company_name` is a mirror of it, not a peer, and it
is mirrored rather than retired.** I agree with your view; the argument follows, and then
the part of it I do not agree with — retiring the mirror outright — with what breaks.

### Why the organization wins

1. **It is the org model's own column.** After 079 a company *is* an `organizations` row and
   a profile is a **person**. A person's row carrying the company's name is a category error
   that only survives while a company has exactly one member — the same assumption
   `lib/acting-org.ts` was written specifically to stop relying on.

2. **It is the only one counterparties can read.** The `profiles` SELECT policies limit a
   caller to their own row, `is_discoverable` rows, and partnership-linked rows.
   `organizations` has a dedicated counterparty SELECT policy sharing one predicate with it
   (`current_user_counterparty_org_ids()`). `profiles.company_name` therefore cannot serve
   the cross-company read even in principle — which is the whole product.

3. **It is `NOT NULL`, with a fallback chain already committed** in 079 PHASE 2 and the
   PHASE 12 trigger. `profiles.company_name` is nullable, and the agency form wrote `null`
   on an empty field. The mirror has a state the authority does not, which means "clear the
   company name" was an operation that could only ever produce disagreement.

4. **Multi-member has one answer here and none there.** When colleague invitations ship
   (086 is on disk), N members each carry a private copy of the company name in their own
   profile row, and there is no principled way to pick one. `organizations.name` has exactly
   one row. This is not hypothetical — it is the next feature.

### What breaks if `profiles.company_name` is retired outright

Retiring it is a **separate migration with a real blocker**, and I did not do it. Four
things break, in descending order of how badly:

**a. The discoverable path has no organizations policy, and this one is a genuine blocker,
not a chore.** `organizations` has exactly two SELECT policies — "Members read their
organizations" and "Members read counterparty organizations". **There is no
`is_discoverable` equivalent.** Two surfaces depend on that gap:

- `app/api/partner/network/[agencyId]/route.ts:133`
- `app/api/agency/pool/[partnerId]/route.ts:69`

Both read a `profiles` row for a company the caller has **no partnership with**, reached
only through the discoverable policy. `current_user_counterparty_org_ids()` does not return
that organization, so moving those reads to `organizations.name` returns null and the
company name renders blank. This is the same shape as `UNPUBLISHED_VENDOR_LABEL` in
`lib/org-contact.ts`, and that constant's own comment records why widening the visibility
rule is not a free move. Closing this needs a third `organizations` SELECT policy plus a
decision about what "a discoverable organization" means, which is a product ruling, not a
rename.

**b. Roughly thirty-eight `profiles` select lists across twenty-six files name the column,
and PostgREST fails the *whole statement* with 42703 for one unknown column.** Dropping the
column does not degrade those reads, it breaks them outright, all at once, in production.
Every one has to be edited before the drop, not after. This is the same hazard the 086
`title` guard in `app/api/profile/route.ts` was written for, at twenty-six times the scale.

**c. The signup trigger writes it.** `handle_new_user()` inserts `company_name` in its
`profiles` INSERT and in its `ON CONFLICT DO UPDATE` list. Retiring the column means a
`CREATE OR REPLACE` on that function, which `LIGAMENT_CONTEXT.md` says must be diffed
against the live body first (appendix query A8) because the repo cannot reproduce the
database.

**d. The admin user list.** `app/admin/users/page.tsx:19,81,290` renders and text-filters on
`company_name` per user. It would need an org join, and the admin panel runs service-role,
so this one is mechanical rather than blocked.

**Recommendation:** keep the mirror. It costs one extra write per save, it is now
structurally impossible to diverge, and it keeps (a) working without a policy decision. Kill
it as its own piece of work, in the order c → b → a → d, when the invitation feature forces
the multi-member question anyway.

---

## 2. One function, following `reconcileProjectClientFields`

**`lib/company-identity.ts`**, new. `saveCompanyIdentity()` and `normalizeCompanyName()`.

Same ruling shape as `lib/clients-server.ts`: one fact, two columns, setting either
reconciles the other, every writer goes through it, **no CHECK and no trigger**. The reason
is the one already argued there — the invariant is enforced at the write path, where the
caller can be told what happened, rather than in the database, where the failure arrives as
an opaque constraint violation on a statement naming only one of the two tables.

**Three deliberate differences from the precedent, each forced by the shape of this pair:**

1. **It does the writing.** `reconcileProjectClientFields()` computes fields and hands them
   back, because `client_id` and `client_name` live on **one row of one table** and a caller
   cannot persist half of them. Here the two fields live on **two different tables**, so a
   function that only returned values would leave the second write to the caller and the
   invariant would be back to discipline. So `saveCompanyIdentity()` takes the caller's
   remaining `profiles` payload as a `profilePatch` and issues both writes itself. A
   `company_name` in that patch is ignored and overwritten — that disagreement is the exact
   defect the function exists to prevent, which is the same ruling as "the entity wins" in
   the precedent.

2. **Order is load-bearing.** `organizations.name` is written **first**. If it fails,
   nothing else is attempted and the two columns still agree. If it succeeds and the
   `profiles` write fails, the authoritative counterparty-facing value is correct and only
   the mirror lags, which a retry converges. The reverse order would leave every
   counterparty reading a stale name while the owner's own settings page showed the new one
   — precisely the failure being prevented. The failure result carries `orgNameWritten` so a
   caller can tell the two apart.

3. **Every update carries a `.select()`.** A PostgREST update whose WHERE matches no row
   because RLS filtered it returns **HTTP 200 with no error** —
   `LIGAMENT_CONTEXT.md` records this costing the admin panel a whole feature. The
   `organizations` UPDATE policy is `id IN (SELECT current_user_admin_org_ids())`, which is
   `role IN ('owner','admin')`. Every live account is the sole **owner** of its one
   organization, so it matches today. **A plain `member` added by the invitation feature
   will not match**, and gets a 403 that says so rather than a success that wrote nothing.

**Organization resolution goes through `resolveActingOrgId()`** (`lib/acting-org.ts`), not
`resolveOrgIdForUser()` (`lib/entitlements.ts`). This is a **write**, and the latter's own
comment calls its owner/admin/member ranking "deterministic rather than correct". Same
reason `lib/acting-org.ts` exists. No organization id is accepted as a parameter; it is
derived from `org_members` on every call, keyed by a user id from `getUser()`.

**One behaviour change, called out because it is not a refactor.** Clearing the company name
is now refused (400) instead of silently writing `null` to the mirror and leaving the
authority untouched. `organizations.name` is `NOT NULL`, so "no company name" is not a state
the model has. It takes **both** the company field and `full_name` being blank to reach the
refusal — the partner form previously had no `full_name` fallback at all and now shares the
agency form's.

---

## 3. Every writer — the full list

Searched the whole repo, both portals, `lib/`, `components/`, `scripts/` and
`supabase/migrations/`. The method: every object-key occurrence of `company_name:` and
`agency_company_name:` (44 hits), then every `.from('profiles')` insert/update/upsert (24
hits), then every `.from('organizations')` write (0 hits), each classified by hand.

### Writers of the company identity — four, all now routed

| # | Site | What it wrote before | Now |
|---|---|---|---|
| 1 | `app/agency/settings/profile/page.tsx:258` | `profiles.company_name` only, inside a 15-column update | `saveCompanyIdentity()`; the other 12 columns ride in as `profilePatch` |
| 2 | `app/partner/profile/page.tsx:632` | `profiles.company_name` only, **raw, no trim, no fallback** | `saveCompanyIdentity()`, with `accountFullName` as the fallback |
| 3 | `app/auth/sign-up/page.tsx:163` | `company_name` into `raw_user_meta_data`; the trigger then writes **both** columns, org btrimmed and profile not | `normalizeCompanyName()` at the source — **this is the Caro fix** |
| 4 | `app/auth/callback/route.ts:26` | `profiles.company_name` on the fallback insert | `normalizeCompanyName()` only — see the exception below |

**Site 4 is deliberately not fully reconciled.** It runs only when `handle_new_user()` did
**not** fire, and that trigger is what creates the organization and the `org_members` row.
There is no organization to reconcile against, so `saveCompanyIdentity()` would resolve
`no-membership` and fail closed, turning a recoverable signup into a blocked one. It gets
the trim — the invariant that needs no organization — and nothing else. Reasoning is in the
comment at the call site.

### Confirmed *not* writers — checked and cleared

- **`app/agency/settings/user/page.tsx` and `app/partner/settings/user/page.tsx`.** These
  are the other two settings forms and they were the obvious suspects. Both write only
  `full_name`, `display_name`, `notification_preferences`. Neither touches `company_name`.
- **`app/api/profile/route.ts`.** Whitelist is `full_name`, `display_name`, `avatar_url`,
  `title`, `personal_linkedin_url`. A `company_name` sent here is silently discarded, which
  is correct now and was already the behaviour.
- **`app/api/admin/users/[userId]/flags/route.ts`.** Allow-listed booleans plus
  `updated_at`. Reads `company_name`, never writes it.
- **All sixteen `.from("organizations")` call sites.** Every one is a `.select()`.

### Adjacent, different column, deliberately untouched

- **`partnerships.company_name`** (migration 068) — written by
  `lib/server/partner-pool-import.ts:278,304` and read by `app/api/agency/pool/[partnerId]`.
  This is the **ghost/unclaimed** pre-claim name for a vendor with no `profiles` row and no
  organization to join to. It is not a mirror of `organizations.name` and must not be routed
  through this function. Worth a separate look for the same trim, since it is also
  user-typed and also unnormalized — **not** done here.
- **`partner_rfp_inbox.agency_company_name`** — written by `lib/magic-token-attach.ts:338`
  and `app/api/agency/broadcast-rfp/route.ts:242,387`. A deliberate **snapshot** of the
  agency's name at broadcast time, per its own comment. A snapshot is supposed to be able to
  disagree with the live value; that is what makes it a snapshot. Left alone.

---

## 4. Trim on write

`normalizeCompanyName()` in `lib/company-identity.ts` — `trim()`, and empty collapses to
`null` so "no company name" is one state and not two. Applied at all four writers above.
Both forms also echo the normalized value back into the field on success, so the user is not
shown an untrimmed string the database does not hold.

**The SQL-side asymmetry remains and is reported rather than migrated.** `handle_new_user()`
still writes `profiles.company_name` without `btrim`. Every producer of that metadata is now
trimmed at the source (site 3 is the only one), so the asymmetry has nothing left to act on.
Fixing it properly means a `CREATE OR REPLACE` on a `SECURITY DEFINER` function whose live
body the repo cannot reproduce — that is a migration and a diff-against-A8 exercise, not
part of a write-path fix. Folding it into the next trigger change is the cheap moment.

---

## 5. Repair SQL for the one drifted row — **not run**

Preview first. Expect exactly one row, Caro Creative Inc., 19 against 18.

```sql
-- READ ONLY. Confirm the blast radius before the UPDATE.
SELECT p.id            AS profile_id,
       o.id            AS org_id,
       o.name          AS org_name,
       p.company_name  AS profile_company_name,
       octet_length(o.name)         AS org_bytes,
       octet_length(p.company_name) AS profile_bytes,
       btrim(p.company_name) = o.name AS whitespace_only_drift
FROM   public.profiles p
JOIN   public.org_members m ON m.user_id = p.id AND m.role = 'owner'
JOIN   public.organizations o ON o.id = m.org_id
WHERE  p.company_name IS DISTINCT FROM o.name
ORDER  BY whitespace_only_drift DESC, o.name;
```

Then the repair.

```sql
BEGIN;

-- organizations.name is authoritative, so the MIRROR is what moves.
--
-- The btrim guard is the point of this statement: it restricts the update to drift that is
-- purely leading/trailing whitespace, which is the only kind that exists today and the only
-- kind that is unambiguously a normalisation bug rather than a disagreement. A genuine
-- conflict - two different names - is deliberately NOT touched here. There is nothing to
-- reconcile today, and if there ever is, it wants a human, not this statement.
--
-- Joined through org_members rather than through the legacy o.id = p.id coincidence, so it
-- is correct for the post-079 organizations too.
UPDATE public.profiles p
SET    company_name = o.name
FROM   public.org_members m
JOIN   public.organizations o ON o.id = m.org_id
WHERE  m.user_id = p.id
  AND  m.role    = 'owner'
  AND  p.company_name IS DISTINCT FROM o.name
  AND  btrim(p.company_name) = o.name;

-- Expect UPDATE 1. Anything else, ROLLBACK and re-read the preview.

COMMIT;
```

**`updated_at` is deliberately not stamped.** `app/api/admin/users/[userId]/flags/route.ts`
records that `profiles.updated_at` is being read as evidence that *somebody decided
something* — twelve of the sixteen live profiles have `updated_at = created_at`, and that is
the signal. Stripping a stray space is not a decision by that account's owner, and stamping
it would falsify the census for that row. If you would rather stamp it, add
`, updated_at = now()` to the SET list, but do it knowing what it costs.

**Order does not matter.** The code fix removes the source; the SQL removes the residue.
Either can land first.

---

## 6. Gates

Baseline as stated: lint **182**, `org-id-reads` Class B **61**, both lowered by the dead
code deleted in the 2026-08-20 session.

| Gate | Baseline | Now | Moved? |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | 0 | no |
| `pnpm build` | 0 | 0 | no |
| `pnpm lint` | 182 / 154 err / 28 warn | 182 / 154 / 28 | **no** |
| `pnpm verify-rls` | 2 | 2 | no |
| `pnpm policy-audit:guard` | 1 | 1 | no |
| `pnpm identity-columns:guard` | 0 | 0 | no |
| `pnpm embed-targets` | 0 | 0 | no |
| `pnpm org-id-reads:guard` | 0, A 14, B 61 | 0, A 14, B 61 | **no** |

Nothing moved. **No allow-list was added or widened.** `verify-rls` at 2 and
`policy-audit:guard` at 1 are the two gates the 2026-08-20 report established cannot detect
anything until the policy snapshot is re-taken; they are recorded here as unchanged, not as
passing.

The `org-id-reads` guard still prints its seven `recorded N, found 0` lines, including the
pre-existing stale `lib/vouch-counts.ts` record. Unchanged by this work.

---

## 7. Two things for you, neither fixed here

**a. The signup fallback insert creates an account with no organization.**
`app/auth/callback/route.ts` inserts a `profiles` row when `handle_new_user()` did not fire.
It does **not** create an `organizations` row or an `org_members` row. Post-079 that is an
account locked out of its own data by deny-by-default, with no error anywhere — the exact
failure 079 PHASE 12's own header warns about. Pre-existing, not introduced here, and out of
scope for a company-name change, but it is now the one path that can produce a profile with
no organization, which is also the one input `saveCompanyIdentity()` cannot serve.

**b. The census arithmetic does not close.** Your figures are 18 organizations, 15 legacy
(`organizations.id = profiles.id`), 2 genuinely post-079. That is 17. One organization is
unaccounted for in either bucket. It may be a miscount, or it may be an organization with no
matching profile id and no post-079 provenance — which would be worth knowing about before
the invitation feature starts creating organizations in earnest. The preview query in
section 5 will surface it if it has an owner; if it returns nothing for that row, the
organization has no `org_members` row at all, which is its own problem.
