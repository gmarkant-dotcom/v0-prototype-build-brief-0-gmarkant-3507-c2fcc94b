# 091 Phase 0 — the `profiles` writer census, and the gap table

**EXECUTED, not reasoned.** Every row below came off a `grep`/`sed` pass over
this working tree on branch `feat/m1-entitlements-fix`, clean at start. No
database was queried and this session holds no credential that could. No
migration was applied.

**One thing to know before reading anything else.** The brief's first required
read, `docs/091-entitlements-surface.md`, **does not exist on this branch.** It
was committed as `67c2878` on the sibling branch `feat/m1-entitlements`, whose
parent is this branch's HEAD (`c9421e7`). It was read in full, read-only, with
`git show 67c2878:docs/091-entitlements-surface.md`. **No branch was switched
and nothing was cherry-picked.** If Greg wants it on this branch,
`git cherry-pick 67c2878` is a docs-only commit. Every "the surface doc says"
reference below is to that object.

---

## Phase 0 baseline — all eight gates, EXECUTED once

| Gate | Exit | Numbers |
|---|---|---|
| `npx tsc --noEmit` | **0** | — |
| `pnpm build` | **0** | 202 lines of output, route table captured |
| `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)**, 7 fixable |
| `pnpm verify-rls` | **2** | environmental; cannot reach `pg_class` through PostgREST |
| `pnpm policy-audit:guard` | **1** | 60 policies on the 23 company-scoped tables, **FLAGGED 53** (44 direct, 9 indirect), 6 allow-listed |
| `pnpm identity-columns:guard` | **0** | **381 files**, TOTAL 0 |
| `pnpm embed-targets` | **0** | **381 files**, REPOINTED 0, PERSON 0 |
| `pnpm org-id-reads:guard` | **0** | **380 files**, OPEN 14 / 61, IMPROVED 0/0, REGRESSIONS 0 |

`verify-rls` and `policy-audit:guard` are environmental, read no `.ts` or `.sql`
file this session touches, and are **not run again**, per the brief. The other
six are re-run in Phase 6 and compared to these numbers, not to any number in a
document.

These match 090's final numbers exactly, which is the expected result: no source
file has changed since `c9421e7`.

---

## THE CENSUS — every write to `public.profiles`

Roots swept: `app/`, `lib/`, `components/`, `contexts/`, `hooks/`, `scripts/`,
`types/`, `supabase/`. Method: every `from("profiles")` in the tree, then a
five-line proximity window for `.update(` / `.insert(` / `.upsert(` / `.delete(`,
then each variable payload (`payload`, `updates`, `updatePayload`, `patch`,
`profilePatch`) traced to its construction site. SQL writers found separately by
grepping the migrations for `INSERT INTO public.profiles` and
`UPDATE public.profiles`.

**There is no `.upsert()` and no `.delete()` on `profiles` anywhere in the tree.**

### Session-client writers (browser or server, end-user JWT)

| # | File:line | Op | Client | Columns written, enumerated |
|---|---|---|---|---|
| 1 | `app/auth/callback/route.ts:23` | INSERT | session (server) | `id`, `email`, `full_name`, `company_name`, `company_linkedin_url`, `role`, `active_role`, `is_admin` (literal `false`) |
| 2 | `app/auth/callback/route.ts:88` | UPDATE | session (server) | conditional, from `updatePayload`: `role`, `active_role`, `company_linkedin_url`. **Never** an access flag — see its own comment at `:82`. |
| 3 | `app/agency/settings/user/page.tsx:101` | UPDATE | session (browser) | `full_name`, `display_name`, `notification_preferences`, `updated_at` |
| 4 | `app/agency/settings/user/page.tsx:104` | UPDATE | session (browser) | fallback after 3 fails: `full_name`, `updated_at` |
| 5 | `app/partner/settings/user/page.tsx:99` | UPDATE | session (browser) | `full_name`, `display_name`, `notification_preferences`, `updated_at` |
| 6 | `app/partner/settings/user/page.tsx:102` | UPDATE | session (browser) | fallback: `full_name`, `updated_at` |
| 7 | `app/agency/settings/profile/page.tsx:301` | UPDATE | session (browser) | `is_discoverable`, `updated_at` |
| 8 | `app/agency/settings/profile/page.tsx:261` → `lib/company-identity.ts:347` | UPDATE | session (browser) | `company_name`, `company_website`, `company_linkedin_url`, `default_nda_url`, `bio`, `location`, `agency_type`, `company_logo_url`, `meeting_url`, `is_discoverable`, `payment_terms`, `payment_terms_custom`, `business_criteria`, `updated_at` |
| 9 | `app/partner/profile/page.tsx:462` | UPDATE | session (browser) | `is_discoverable`, `updated_at` |
| 10 | `app/partner/profile/page.tsx:635` → `lib/company-identity.ts:347` | UPDATE | session (browser) | `company_name`, `company_website`, `company_linkedin_url`, `company_logo_url`, `agency_type`, `bio`, `location`, `capabilities`, `reel_url`, `capabilities_overview_url`, `credentials`, `work_examples`, `is_discoverable`, `updated_at` |
| 11 | `app/partner/legal/page.tsx:222` | UPDATE | session (browser) | `business_criteria`, `updated_at` |
| 12 | `app/partner/legal/page.tsx:350` | UPDATE | session (browser) | `business_criteria`, `updated_at` |
| 13 | `app/partner/legal/page.tsx:398` | UPDATE | session (browser) | `legal_entity_name`, `legal_entity_type`, `legal_ein`, `legal_address`, `legal_state_of_incorporation`, `updated_at` |
| 14 | `app/partner/rfps/[id]/page.tsx:1151` | UPDATE | session (browser) | `default_terms` |
| 15 | `app/api/profile/route.ts:67` | UPDATE | session (server) | conditional, from `updates`: `full_name`, `display_name`, `avatar_url`, `personal_linkedin_url`, `title`, `updated_at` |
| 16 | `app/api/profile/route.ts:84` | UPDATE | session (server) | the 42703 retry of 15, minus `title` |
| 17 | `app/api/profile/switch-role/route.ts:43` | UPDATE | session (server) | `active_role` (`'partner'`), and conditionally `secondary_role` (`'partner'`) |
| 18 | `app/api/profile/switch-role/route.ts:67` | UPDATE | session (server) | `active_role` (`'agency'`) |
| 19 | `app/api/user/active-role/route.ts:48` | UPDATE | session (server) | `active_role` |
| 20 | `app/api/partner/rfps/claim/route.ts:110` | UPDATE | session (server) | `active_role` (`'partner'`) |
| 21 | `app/api/partner/rate-info/route.ts:341` | UPDATE | session (server) | `bio`, `location`, `website`, `updated_at` |
| 22 | `app/api/partner/rate-info/route.ts:356` | UPDATE | session (server) | `bio`, `location`, `website`, `rate_info`, `updated_at` |
| 23 | `app/api/partner/rate-info/route.ts:369` | UPDATE | session (server) | fallback of 22: `bio`, `location`, `website`, `updated_at` |
| 24 | `app/api/admin/grant-agency-access/route.ts:21` | UPDATE | **session (server), admin-gated** | `secondary_role` |

### Service-role writers

| # | File:line | Op | Client | Columns written |
|---|---|---|---|---|
| 25 | `app/api/admin/users/[userId]/flags/route.ts:118` | UPDATE | **service role** | allow-listed `MUTABLE_FLAGS` only (`:32`): `is_paid`, `demo_access`, `is_admin`, plus `updated_at`. The body is never spread. |
| 26 | `app/api/admin/grant-access/route.ts:166` | UPDATE | **service role** | `is_paid` (literal `true`), `updated_at` |

### Database-function writers

| # | Where | Op | Fires as | Columns written |
|---|---|---|---|---|
| 27 | `supabase/migrations/079_organizations.sql:1864` — `handle_new_user()`, `AFTER INSERT ON auth.users` | INSERT | SECURITY DEFINER, **no session** | `id`, `email`, `full_name`, `company_name`, `role`, `active_role`, `secondary_role` |
| 28 | `supabase/migrations/079_organizations.sql:1877` — the same statement's `ON CONFLICT (id) DO UPDATE` | **UPDATE** | SECURITY DEFINER, **no session** | `email`, `full_name`, `company_name`. `role`/`active_role`/`secondary_role` are **deliberately absent** so a re-fired trigger cannot rewrite a role the user has since changed. |
| 29 | `supabase/migrations/090_active_org.sql:490` — `set_active_org(uuid)` | UPDATE | SECURITY DEFINER, **called by a session** | `active_org_id` |
| 30 | `supabase/migrations/090_active_org.sql:703` — `accept_org_invitation(text)` | UPDATE | SECURITY DEFINER, **called by a session** | `active_org_id`, only when currently NULL |

**Writer 28 is the one the brief singles out and it is the load-bearing one for
Phase 2.** `ON CONFLICT DO UPDATE` is an UPDATE. Any `BEFORE UPDATE` trigger on
`profiles` fires on it, including 090's, and including whatever 091 adds. It
writes `email`.

### Not writers, checked and cleared

- `lib/email.ts:441-449` **reads** `notification_preferences` to decide whether to
  send. It writes nothing. "The notification writer" in the brief is writers 3
  and 5, the two settings forms.
- `lib/server/partner-pool-import.ts` reads `profiles` (`:228`) and writes only
  `partnerships` (`:282`, `:314`, `:325`).
- `scripts/` contains no `profiles` write. Every hit in `scripts/` is inside
  `check-org-id-reads.mjs`'s own documentation and pattern strings.
- `components/`, `contexts/`, `hooks/` contain no `profiles` write at all.

---

## TWO FINDINGS FROM THE CENSUS, neither of which the brief asked for

### CENSUS-1. `grant-agency-access` writes another user's row with a session client

Writer 24, `app/api/admin/grant-agency-access/route.ts:21`, is
`auth.supabase.from("profiles").update({ secondary_role }).eq("id", userId)` —
a **session** client, targeting `userId` from the request body, which is
somebody other than the admin. Its own comment at `:17` says the choice is
deliberate:

> No service role here, deliberately. This write goes through the admin's own
> session client, so it is governed by the same profiles policies as the admin
> panel's other toggles.

**The profiles UPDATE policy is `USING (auth.uid() = id)`.** For every target
except the admin's own row, that write matches **zero rows** and PostgREST
returns **no error**. The route then returns `{ success: true }`. This is the
identical shape the flags route's own header (`:10-14`) describes as the reason
the flags were moved to the service role — and this route was not moved with
them.

REASONED from the policy text given in the brief's STATE block, not executed.
Settled by OPEN-091-1 in the session report. **It is not fixed here** — the brief
scopes Phase 4 to two specific items and this is not one of them.

It matters for Phase 2 only in that `secondary_role` has a session-client writer
either way (writer 17), so the outcome for the guard is unchanged.

### CENSUS-2. `linked_agency_id` is read once, written never, consumed never

`profiles.linked_agency_id` appears in exactly **two** places in the entire
tree:

```
contexts/paid-user-context.tsx:107   .select('..., linked_agency_id, ...')
contexts/paid-user-context.tsx:118   setLinkedAgencyId(profile?.linked_agency_id || null)
```

It is placed on the context value at `:177` and **no component destructures
`linkedAgencyId`**. Nothing in `app/`, `lib/`, `components/`, `contexts/`,
`hooks/`, `scripts/` or `supabase/` writes it, and no migration mentions it.
It is a column read into a context field that nothing consumes.

This settles the brief's Phase 1 question about it directly: see Phase 1.

---

## THE GAP TABLE — columns no writer in the census touches

All 44 columns from the authoritative list, checked one at a time. Method: the
census above, cross-checked against a per-column sweep for write-shaped
occurrences (`<column>:` as an object key) across `app/`, `lib/`, `components/`,
`contexts/`, `hooks/`.

**Exactly two columns are UNACCOUNTED, and one of those is accounted for by a
default.**

| Column | Written by | Status |
|---|---|---|
| `created_at` | **no writer** | **UNACCOUNTED — accounted for.** `DEFAULT now()`. Inference: the column default, and nothing else. Zero write-shaped occurrences against `profiles`; the 70 tree-wide hits are all other tables. Correct as-is. |
| `linked_agency_id` | **no writer, no consumer** | **UNACCOUNTED — genuinely.** Zero write-shaped occurrences anywhere. Inference: a column from a pre-079 lead-agency/vendor linkage that `partnerships` replaced. Nothing has written it in this tree's history. See CENSUS-2 and Phase 1. |

Every other column is accounted for:

| Column | Writers (census #) |
|---|---|
| `id` | 1, 27 |
| `email` | 1, 27, **28** |
| `full_name` | 1, 3, 4, 5, 6, 15, 16, 27, 28 |
| `company_name` | 1, 8, 10, 27, 28 |
| `role` | 1, 2, 27 |
| `updated_at` | 3–13, 15, 16, 21–23, 25, 26 |
| `is_paid` | **25, 26 only — both service role** |
| `is_admin` | **1 (INSERT, literal false), 25 only** |
| `demo_access` | **25 only** |
| `is_discoverable` | 7, 8, 9, 10 |
| `bio` | 8, 10, 21, 22, 23 |
| `location` | 8, 10, 21, 22, 23 |
| `website` | 21, 22, 23 |
| `agency_type` | 8, 10 |
| `avatar_url` | 15, 16 |
| `display_name` | 3, 5, 15, 16 |
| `notification_preferences` | 3, 5 |
| `meeting_url` | 8 |
| `rate_info` | 22 |
| `payment_terms`, `payment_terms_custom` | 8 |
| `capabilities_overview_url`, `credentials`, `work_examples`, `reel_url`, `capabilities` | 10 |
| `legal_entity_name`, `legal_entity_type`, `legal_ein`, `legal_address`, `legal_state_of_incorporation` | 13 |
| `active_role` | 1, 2, 17, 18, 19, 20, 27 |
| `company_website` | 8, 10 |
| `secondary_role` | **17 (session), 24 (session, admin-gated), 27** |
| `company_logo_url` | 8, 10 |
| `company_linkedin_url` | 1, 2, 8, 10 |
| `personal_linkedin_url` | 15, 16 |
| `default_nda_url` | 8 |
| `business_criteria` | 8, 11, 12 |
| `default_terms` | 14 |
| `title` | 15 |
| `active_org_id` | **29, 30 only — both SECURITY DEFINER functions, never a direct client write** |

### What the gap table decided

**It confirmed the deny-list shape the brief had already ruled, and it did so by
counting.** 42 of the 44 columns have at least one writer; 37 of those are
ordinary profile content a user edits from a settings form. A permit list would
be 37 entries maintained against 24 session-client write sites, and one omission
silently breaks a save. The deny-list is four entries maintained against a fact
that only changes when somebody adds a privilege column on purpose.

**It also produced the four columns whose writers are ALL non-session.**
`is_paid`, `is_admin`, `demo_access` and `email` are the only columns in the
whole table with no session-client UPDATE writer. That set fell out of the
census rather than being assumed, and it is the input to Phase 1.

**And it produced the two columns whose only writers are database functions:**
`active_org_id` (already guarded, by 090) and — on the UPDATE path — `email`
(writer 28, `handle_new_user`'s `ON CONFLICT DO UPDATE`). Any guard on `email`
must not fire on writer 28 or every re-fired signup trigger raises.

---

## EXECUTED / READ / REASONED

**EXECUTED.** `git rev-parse`, `git status`, `git log`, `git for-each-ref`,
`git show --stat`; the eight gates, once each; roughly fifteen `grep`/`sed`/`cat`
passes; one throwaway Node proximity scanner and one shell per-column sweep, both
in the session scratchpad, neither committed.

**READ in full.** `docs/091-entitlements-surface.md` (via `git show 67c2878:`),
882 lines; `lib/entitlements.ts` (463); `lib/acting-org.ts` (292);
`supabase/migrations/090_active_org_down.sql`;
`app/api/profile/route.ts`; `app/api/profile/switch-role/route.ts`;
`app/api/user/active-role/route.ts`; `app/api/admin/grant-agency-access/route.ts`.

**READ in part.** `supabase/migrations/090_active_org.sql` (header, section 2's
guard in full, section 3's oracle assessment, section 5's grants, the COMMIT and
the verification block); `supabase/migrations/079_organizations.sql` (PHASE 12's
`handle_new_user` in full); `docs/090-active-org-report.md` (the gate table);
`app/auth/callback/route.ts`; both settings-user pages; both profile pages;
`app/partner/legal/page.tsx`; `app/api/partner/rate-info/route.ts`;
`lib/company-identity.ts`; `app/api/admin/users/[userId]/flags/route.ts`;
`app/api/admin/grant-access/route.ts`; `lib/api-auth.ts`.

**REASONED, not executed.** CENSUS-1's zero-rows claim, which follows from the
policy text in the brief's STATE block rather than from a live write. Every
statement about which database role a given client resolves to — those follow
from how each file constructs its client, not from a live `SELECT current_user`.

**NOT DONE.** No migration authored yet (Phase 2). No database queried. No
policy read live. No push, no PR, no branch switch.
