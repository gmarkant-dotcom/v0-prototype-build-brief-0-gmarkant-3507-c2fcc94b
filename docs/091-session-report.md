# 091 — session report. The profiles authority-column guard.

Branch `feat/m1-entitlements-fix`, six commits on top of `c9421e7`.
**Nothing was pushed. No PR. No migration applied. No database touched.**

---

# READ FIRST — three things, before anything below

## 1. Every phase completed. Two deviations from the brief, both deliberate.

**DEVIATION 1 — the required input document was not on this branch.**

The brief's first required read, `docs/091-entitlements-surface.md`, does not
exist on `feat/m1-entitlements-fix`. It was committed as **`67c2878`** on the
**sibling branch `feat/m1-entitlements`**, whose parent is this branch's HEAD.

It was read **in full, read-only**, with
`git show 67c2878:docs/091-entitlements-surface.md`. **No branch was switched.
Nothing was cherry-picked.** The brief said to stop rather than commit
elsewhere, so nothing was committed anywhere but here.

If you want it on this branch: `git cherry-pick 67c2878` — it is a docs-only
commit and touches nothing else.

**DEVIATION 2 — Phase 3 shipped a code change, and you may have meant it not to.**

Phase 3 says *"Comment-only in this phase"* immediately before the instruction
to correct the stale header comment. **I read that as scoping the comment
correction, not the phase** — the phase opens with *"Assess routing
agencyEntitlementId through it"* and says *"If any path turns working into locked
out, DO NOT SHIP IT"*, which reads as permission to ship if no path does.

**No path does.** The analysis is in section 5 and the conclusion is that the
change is a **provable no-op against the live database**: every branch that
differs from the old ranking requires more than one membership, and no account
has ever had one.

**If you meant the phase to be comment-only, it is one command:**

```
git revert e21a63a          # keeps the three comment corrections? NO - reverts them too.
```

Better, if you want the comments and not the resolver: the resolver change is
four lines at the bottom of `agencyEntitlementId()` in `lib/entitlements.ts`.
Replace the body with the old query-sort-take-first and keep every comment.

## 2. "Success. No rows returned" PROVES NOTHING.

> **In the Supabase SQL Editor, "Success. No rows returned" is the IDENTICAL
> message for a dry run that rolled everything back, for a real apply that
> committed, and for a perfectly correct file pasted into the wrong project's
> tab.**

It is not evidence of anything except that no statement raised. The verification
block at the foot of each migration is the only thing that distinguishes the
three, and it is the only thing that tells you which database you are looking at.
Run it.

## 3. Nothing here has been executed against a database.

The migration is **authored**. The pre-apply test is **written**. Both are
Greg's to run. This session held no credential that could have run either, and
attempted nothing.

---

# THE APPLY ORDER

**091 IS INDEPENDENT OF EVERY DEPLOY, IN BOTH DIRECTIONS.** It adds no column, so
nothing can 42703; it changes no function any route calls; it changes no policy.
There is no "migration first, then push" constraint the way 090 had one. The code
on this branch does not depend on it and it does not depend on the code.

```
STEP 1.  Run docs/091-preapply-test.sql.
         One paste. It writes and rolls back. Read every NOTICE line.
         This is the step that is NOT optional - see below.

STEP 2.  Dry run supabase/migrations/091_profiles_column_guard.sql.
         Change the COMMIT; on LINE 545 to ROLLBACK;. Run the whole file.
         Confirm no errors. PUT THE COMMIT BACK.

STEP 3.  Run 091_profiles_column_guard.sql for real.

STEP 4.  Run the VERIFICATION block, V1 through V7. It sits AFTER the COMMIT and
         is entirely commented out, so step 2 stopped at the COMMIT and executed
         none of it. Paste the queries one at a time.

STEP 5.  Update the migrations table in LIGAMENT_CONTEXT.md, and put the
         authority set in that row. NOT DONE HERE: that table records applies,
         and writing it now would claim one that has not happened.

STEP 6.  Push this branch whenever you like. Order does not matter.
```

**The rollback, if it is ever needed:**
`supabase/migrations/091_profiles_column_guard_down.sql`, `BEGIN;` on line 98,
`COMMIT;` on line 108. It destroys no data — 091 creates no column and writes no
row, so it is the cheapest rollback in the set. **Roll back only if 091 is
breaking a legitimate write, not as tidying**, and capture *which writer and
which column* first — that fact is a one-line fix to the authority set, not a
reason to remove the guard.

## The dry-run instruction, with the line number

> **`supabase/migrations/091_profiles_column_guard.sql` carries an executable
> `BEGIN;` on LINE 373 and an executable `COMMIT;` on LINE 545. To dry run,
> change the COMMIT on LINE 545 to `ROLLBACK;`.**

Verify before trusting it. The numbers were re-grepped after the last edit to the
file:

```
grep -n -i '^begin\|^commit\|^rollback' supabase/migrations/091_profiles_column_guard.sql
```

**Three hits, and three is correct:**

| Line | | |
|---|---|---|
| **373** | `BEGIN;` | executable — the transaction |
| 393 | `BEGIN` | plpgsql, the guard function's body. No semicolon. Matched by the case-insensitive form only. |
| **545** | `COMMIT;` | **executable — the one to swap** |

Exactly one line ends in `BEGIN;` and exactly one in `COMMIT;`. A different set
means this is not the file that was read.

**Do NOT verify with `grep -n '^BEGIN;$'`.** That anchored form has produced
false negatives in this repository and 087 nearly burned a dry run on it.

The down file: **`BEGIN;` on 98, `COMMIT;` on 108**, and only two hits, because
it defines no plpgsql body.

---

# THE PRE-APPLY TEST, AND HOW TO READ IT

`docs/091-preapply-test.sql`. **This is the deliverable, not an extra.**

**Why it exists.** 089 and 090 were **additive** — a column, a function, a trigger
enforcing an invariant nothing had ever violated. A dry run proving the file
parsed was proportionate evidence for those. **091 CAN REFUSE A WRITE THAT WORKS
TODAY.** A dry run of 091 proves it compiles and says nothing about whether the
settings page still saves, whether "Switch to Vendor Mode" still switches, or
whether the admin flags route can still grant somebody access.

**What it does.** One paste. It `BEGIN`s, installs the entire migration inline,
impersonates a real profile, runs **eleven assertions**, and `ROLLBACK`s.
PostgreSQL rolls back DDL, so afterwards the database is byte-identical to before
— whether or not 091 has already been applied.

**How to run it.** Paste the whole file into one SQL Editor tab and run it
**once, as one batch**. Do not run it in pieces: running only the first half
leaves the transaction open. **The NOTICE lines are the result.** If you see no
NOTICE output, the DO block did not run and you have learned nothing.

## The scoring, which runs in two directions

| Test | What it exercises | **PASS means** |
|---|---|---|
| **T1** | A settings-shaped save — `full_name`, `display_name`, `notification_preferences`, `updated_at`. Mirrors census writer 3. | **the write SUCCEEDED**, 1 row |
| **T2** | The portal switch. `active_role`, flipped. Mirrors writers 17–20. | **SUCCEEDED**, 1 row |
| **T3** | A `secondary_role` self-grant. Mirrors writer 17. | **SUCCEEDED**, 1 row |
| **T4a** | Self-grant `is_paid` | **the write RAISED LG007** |
| **T4b** | Self-grant `is_admin` | **RAISED LG007** |
| **T4c** | Self-grant `demo_access` | **RAISED LG007** |
| **T4d** | Rewrite `email` | **RAISED LG007** |
| **T4e** | Claim `linked_agency_id` | **RAISED LG007** |
| **T5** | A no-op write sending all five guarded values back unchanged | **SUCCEEDED** — the early return |
| **T6** | A write with no end-user session | **SUCCEEDED** — the exemption |
| **T7** | 090's guard still bites | **RAISED LG005** — 090's code, not 091's |

> **AN ERROR IS A PASS FOR T4a–T4e AND FOR T7. A SUCCESS THERE IS A FAILURE.**
> Every NOTICE line says which, so you never have to hold it in your head.

**If any of T1, T2, T3, T5 or T6 FAILs: DO NOT APPLY 091.** T1–T3 failing means
the authority set is wrong. **T6 failing is the serious one** — it would mean 091
has locked migrations and the admin routes out of the `profiles` table entirely.

**One outcome is neither PASS nor FAIL.** If a T4 write returns **42501**
(`insufficient_privilege`) instead of LG007, then role `authenticated` holds no
`UPDATE` on `profiles` at all, **the self-grant hole never existed, and 091 is
unnecessary rather than wrong.** That is 090's OPEN-5, and this file settles it as
a side effect. It is reported **INCONCLUSIVE**, and the verdict line says so.

**Two implementation details, both deliberate.** Each refusal runs in its own
plpgsql subtransaction, so an expected LG007 does not abort the run — that is what
lets eleven assertions report from one paste. And **both JWT GUCs are set**,
`request.jwt.claims` **and** `request.jwt.claim.sub`: Supabase's `auth.uid()` has
shipped in two forms, and setting only one would leave `auth.uid()` NULL, sail
every T4 straight through the exemption, and report five FAILs against a guard
that is correct.

**The one maintenance hazard**, stated in the file too: section A is a **copy** of
the migration's sections 1–3. If you edit the migration — and especially if you
add a column to the authority set — re-copy section A and add a T4 case. The
tally asserts 11 assertions ran; six guarded columns should make it 12.

---

# THE AUTHORITY SET — five columns, each from a census line

```
is_paid, is_admin, demo_access, email, linked_agency_id
```

| Column | The census line that decided it | Justification |
|---|---|---|
| **`is_paid`** | Writers 25 (`flags:118`) and 26 (`grant-access:166`), **both service role. No session-client writer of any kind.** | The only access grant this product has. Ten server gates and the whole agency layout read it. Guarding it costs nothing and closes the self-grant. |
| **`is_admin`** | Writer 25 (service role), plus writer 1 (`auth/callback:44`, literal `false`, and an **INSERT** — a BEFORE UPDATE trigger does not fire on it). **No session-client UPDATE writer.** | Grants the admin panel, `requireAdminRole()`, and a bypass in every entitlement function. Strictly worse to self-grant than `is_paid`. |
| **`demo_access`** | Writer 25 only. No other writer in the tree. | Same admin allow-list, same argument, same set. |
| **`email`** | Writers 1 and 27 (**INSERTs**) and **28** (`handle_new_user`'s `ON CONFLICT DO UPDATE`, no session). **No session-client UPDATE writer.** | 089's `current_user_email()` reads it and `accept_org_invitation` compares an invitation address against it. Self-writable `email` means a user sets it to any address and accepts an invitation issued to that address, gated by token secrecy alone. It also lets `profiles.email` diverge from `auth.users.email` permanently — there is no reconciler in the tree. |
| **`linked_agency_id`** | **Zero writers. Zero real readers** (CENSUS-2). | Guarding a column nothing writes cannot refuse a legitimate write, so the cost is exactly zero. It is a uuid naming another entity on a self-writable row — a relationship claim, not profile content — inert only because nothing consumes it yet. **Separately recommended for deletion**: OPEN-091-3. |

## Considered and LEFT OUT — each verified, not assumed

| Column | Why not |
|---|---|
| **`role`** | Writer 2, `auth/callback:88`, a **session** client. Guarding it breaks the vendor-portal correction that route exists for. |
| **`active_role`** | Writers 2, 17, 18, 19, 20 — **five** session writers. Guarding it breaks "Switch to Vendor Mode" five different ways. |
| **`secondary_role`** | **The one that needed checking rather than guessing.** `switch-role:43` **self-grants** `secondary_role='partner'` as a free, self-serve act — on the same column `grant-agency-access:21` uses for an admin grant. A trigger cannot separate those without encoding product policy. Out. See OPEN-091-2. |
| **`is_discoverable`** | Writers 7, 8, 9, 10 — four session writers, two of them dedicated toggles. A legitimate settings control on both portals. |

---

# THE WRITER-OUTCOME TABLE — all 30 census writers vs `auth.uid() IS NULL`

This is the 087 lesson applied: a trigger with no `WHEN` clause fires on paths
nobody traced, and **087's own header was wrong about which paths those were.**
So every writer is walked, and **the mechanism by which each passes is named**,
because "early return" and "exempt" have different futures.

| # | Writer | Guarded column? | `auth.uid()` | Outcome | Mechanism |
|---|---|---|---|---|---|
| 1 | `auth/callback:23` | `email`, `is_admin` | non-null | **PASSES** | **INSERT — the trigger does not fire** |
| 2 | `auth/callback:88` | no | non-null | PASSES | early return |
| 3–6 | both `settings/user` pages | no | non-null | PASSES | early return |
| 7 | `agency/settings/profile:301` | no | non-null | PASSES | early return |
| 8 | `agency/settings/profile:261` → `company-identity:347` | no | non-null | PASSES | early return |
| 9 | `partner/profile:462` | no | non-null | PASSES | early return |
| 10 | `partner/profile:635` → `company-identity:347` | no | non-null | PASSES | early return |
| 11–13 | `partner/legal` ×3 | no | non-null | PASSES | early return |
| 14 | `partner/rfps/[id]:1151` | no | non-null | PASSES | early return |
| 15–16 | `api/profile:67`, `:84` | no | non-null | PASSES | early return |
| 17–18 | `switch-role:43`, `:67` | no | non-null | **PASSES — the portal switch** | early return |
| 19 | `api/user/active-role:48` | no | non-null | PASSES | early return |
| 20 | `partner/rfps/claim:110` | no | non-null | PASSES | early return |
| 21–23 | `partner/rate-info` ×3 | no | non-null | PASSES | early return |
| 24 | `admin/grant-agency-access:21` | no (`secondary_role`) | non-null | PASSES | early return. **Still matches zero rows — OPEN-091-1, unchanged by 091.** |
| 25 | `admin/users/[userId]/flags:118` | **`is_paid`, `is_admin`, `demo_access`** | **NULL** | **PASSES** | **exemption** |
| 26 | `admin/grant-access:166` | **`is_paid`** | **NULL** | **PASSES** | **exemption** |
| 27 | `handle_new_user` INSERT (079:1864) | `email` | NULL | PASSES | **INSERT — does not fire** |
| 28 | `handle_new_user` **`ON CONFLICT DO UPDATE`** (079:1877) | **`email`** | **NULL** | **PASSES** | **exemption** |
| 29 | `set_active_org` (090:490) | no | non-null (session caller) | PASSES | early return |
| 30 | `accept_org_invitation` (090:703) | no | non-null (session caller) | PASSES | early return |

**All thirty pass. Three by exemption, two by not being an UPDATE, twenty-five by
the early return.**

**The single row this whole design turns on is 28.** `ON CONFLICT DO UPDATE` is an
UPDATE, so a BEFORE UPDATE trigger fires on it, and it writes `email`, which is
guarded. It fires from `AFTER INSERT ON auth.users`, and an `auth.users` INSERT is
never performed by an end-user session — there is no JWT during a signup, by
definition. So `auth.uid()` is NULL and it is exempt. **If that were wrong, every
re-fired signup trigger would raise.**

**And note what 29 and 30 establish.** They pass by the **early return**, not by
the exemption: a `SECURITY DEFINER` function called by a session client keeps that
session's `auth.uid()` and **stays guarded**. That is deliberate — it means a
future RPC cannot become a laundering path for an authority column without
somebody writing an exemption into it on purpose. It costs nothing today because
both write only `active_org_id`. **It is also what decides 092 Shape B's design**
— see `docs/092-entitlements-design.md` section 1.

---

# THE GAP TABLE, AND WHAT IT DECIDED

All 44 columns checked. **Exactly two are unaccounted, and one of those is
accounted for by a default.**

| Column | Status |
|---|---|
| `created_at` | **UNACCOUNTED — accounted for.** `DEFAULT now()` and nothing else. Correct as-is. |
| `linked_agency_id` | **UNACCOUNTED — genuinely.** Inference: a pre-079 lead-agency/vendor linkage that `partnerships` replaced. Nothing has written it in this tree's history. |

**The other 42 all have at least one writer**, enumerated in
`docs/091-profiles-writer-census.md`.

### What it decided — three things, and none of them was assumed

1. **It confirmed the deny-list shape by counting.** 37 of the 44 are ordinary
   profile content edited from a settings form, across **24 session-client write
   sites**. A permit list is 37 entries whose failure mode is that one omission
   silently breaks a save — the exact shape `app/api/profile/route.ts:35` records
   having shipped for two migrations with `personal_linkedin_url`.
2. **It PRODUCED the authority set rather than checking one.** The four columns
   with no session-client UPDATE writer — `is_paid`, `is_admin`, `demo_access`,
   `email` — fell out of the census. They were not guessed and then verified.
3. **It found the two columns whose only writers are database functions**:
   `active_org_id` (already guarded, by 090) and, on the UPDATE path, `email`
   (writer 28). The second is what forced the exemption analysis.

**And the same count decides 092 the other way.** `organizations` has 7 columns
of which a session client writes exactly **one**. So the guard there should be a
**permit list of `{name}`**, not a deny-list — which guards the billing column,
the seat count and every future column by default. The count is the argument in
both directions. `docs/092-entitlements-design.md` section 1.

---

# PHASE 3 — the resolver, and why shipping it is safe

`agencyEntitlementId()` ranked `owner` above `member`, so a colleague acting for
the paying company had every AI analysis and every project metered against **their
own one-person organization** — the exact inverse of the ruling.
`resolveCallerWriteOrgId()` was migrated off that ranking at 090. This was the
call site that was not.

**It now delegates to `resolveActingOrgId()` and keeps `?? userId`.** That is the
whole change, and the fallback is what makes it safe.

| Branch | Old ranking | Now | |
|---|---|---|---|
| lookup error | `userId` | `userId` | identical |
| no membership | `userId` | `userId` | identical, **and now logged** |
| **exactly 1 membership** | that org | that org | **identical — every account that exists** |
| >1, preference set | the OWNED org | **the ACTING org** | **THE FIX** |
| >1, no preference | the OWNED org | `userId` | **differs** |
| >1, stale preference | the OWNED org | `userId` | **differs** |

**No path that works today stops working.** The three branches that differ all
require more than one membership, and **nothing in this product has ever created
a second one**: 079 PHASE 2 inserts one per profile, PHASE 12's trigger one per
signup, and `accept_org_invitation` is behind `COLLEAGUE_INVITATIONS`, which is
off everywhere. It is a **provable no-op against the live database** and becomes
live behaviour on exactly the day the bug it fixes becomes live.

**Query count is unchanged** — `resolveActingOrgId` reads the stored preference
only when there is more than one membership to choose between.

## What was checked FIRST, because the brief was right to flag it

**`contexts/paid-user-context.tsx` does not import `lib/entitlements` at all.** It
reads `profiles.is_paid` directly with the browser client. A resolver refusal
**cannot** reach `AgencySubscriptionGate`, so the total-lockout risk the brief
named does not exist on this path.

**Nor do the four `hasAgencyEntitlement()` sites, the four `canUseAgencyAi()`
sites, or `canUploadFiles()`.** All three functions take a **profile object** and
never resolve an organization. **This change cannot reach any of the nine.**

Today `agencyEntitlementId()` feeds **18 sites: 15 quota calls and 3 that are
not.** The three non-quota ones matter and are named in the code now:

| Site | What it feeds |
|---|---|
| `agency/email-scan/import:168` | `importContact()` — writes the **shared vendor pool** |
| `agency/email-scan/run:341` | `enrichWithLigamentData()` — and the **service client bypasses RLS**, so that argument IS the whole scoping |
| `partner/partnerships/claim:43` | `partnerships.vendor_org_id`, which **REFERENCES organizations(id)** |

**All three get a better value in the branch that differs** — the acting
organization is the right answer for all three — **and the same value in every
other.**

## Three comment corrections, all the same stale claim

The header said the fallback *"would get a fresh usage_tracking row rather than an
error"*. **It would not, and has not since 079.** `usage_tracking.org_id` is NOT
NULL with an FK to `organizations(id)` added in the PHASE 7 repoint loop, so a
`userId` that is not also an `organizations.id` raises **23503**,
`getOrCreateMonthlyUsage` turns that into a `throw` at `lib/usage-tracking.ts:102`,
and the route **500s**. The fallback is accidentally **correct** for the sixteen
accounts 079 backfilled with `organizations.id = profiles.id`, and a 500 for
anybody else.

The claim appeared **three times** — in `agencyEntitlementId`'s header, in
`resolveCallerWriteOrgId`'s, and in the `OrgId` brand comment. All three corrected.

**The brand comment also overclaimed** and that is corrected too. It said an
unbranded return *"stops it being handed to a write"*. The brand only rejects a
parameter that is **itself typed `OrgId`**, and the three sites above pass the
value into plain `string` parameters. The protection is real and it is narrower
than it read.

---

# PHASE 4

## (a) One definition for the vendor upload gate

Both routes inlined `isDemoMode || isPartner || is_admin || is_paid`, identically,
and both carried the same paragraph explaining why they were **not** calling
`canUploadFiles()`. **That paragraph was right**, which is why this is a new named
function rather than the swap it looks like.

`canUploadFiles()` is **stricter on one reachable axis**: it asks
`actingRole(profile) === "partner"`, where `active_role` decides. The inline form
asked **either** column. For `role='partner'` / `active_role='agency'` /
`is_paid=false`, `canUploadFiles()` returns false and both routes have always
returned true. Swapping would have 403'd that account for no billing reason.

So `lib/entitlements.ts` gains **`canUploadVendorFiles()`**, term for term:

| Inline | Module | |
|---|---|---|
| `NEXT_PUBLIC_IS_DEMO === "true"` | `isDemoDeployment()` | that expression and nothing else, **and first as it was first**, so a demo deployment with no profile row still returns true |
| `role === "partner" \|\| active_role === "partner"` | `canActAs(profile, "partner")` | |
| `profile?.is_admin` | `is_admin === true` | identical for a boolean-or-null column: null is falsy and is not `=== true` |
| `profile?.is_paid` | `is_paid === true` | same |
| `profile` undefined | `if (!profile) return false` | the chain evaluated to `undefined`, which `if (!canUpload)` treated as a refusal |

**THE ONE NON-IDENTITY, stated rather than glossed.** `canActAs()` runs its inputs
through `normalize()`, which trims and lower-cases; the raw comparisons did not.
So `' Partner '` now satisfies the gate and did not before. That is a **widening,
in the permissive direction, on a vendor-only route that gates again immediately
afterwards** — and it cannot fire on any row that exists: every writer of `role`
and `active_role` in the repository writes the exact literal `'agency'` or
`'partner'`. **The query that settles it is OPEN-091-6 below.**

**`is_paid` is kept** even though it decides nothing here — a paid agency clears
this line and is turned away by "Vendors only" underneath it. Removing it would be
a behaviour change dressed as a cleanup, and if vendor-side billing ever exists,
its entitlement is now read in one place instead of two that have already drifted
once.

## (b) `canUseAgencyPortalAi()` — zero callers. NOT deleted.

Grepped **by name across every file type** outside `.git`, `node_modules` and
`.next`. **Two hits:** the definition at `lib/entitlements.ts`, and one row in a
documentation table at `docs/m1-prework-report.md:479`. No alternate spelling, no
case variant. **And no namespace import of the module exists anywhere**, so there
is no `entitlements.canUseAgencyPortalAi` property-access path a name grep would
miss. **It is genuinely uncalled, not apparently uncalled.**

**RECOMMENDATION: keep it — and the reason is not sentiment.** Adopting it at the
two routes its own doc comment names is **not free**. `msa/ai-schedule:78` and
`payment-synthesis:69` run the two halves as **two statements returning two
different refusals** — *"Subscription required for AI features"* and *"Agency
only"*. Collapsing them into one boolean would tell a caller who is entitled but
in the wrong portal that they need a subscription. That is a copy regression and a
support ticket. **Adoption needs those messages resolved first, which is a product
decision.**

Revisit when entitlement moves onto the organization: at that point
`hasAgencyEntitlement()` stops being answerable from a profile row and this
composition is the natural single place to make the pair async. If that design
lands without using it, delete it in the same change.

Both findings are recorded in the function's own header, so nobody re-derives them.

---

# GATES — Phase 6 against the Phase 0 baseline

Both runs **EXECUTED**, once each, in this repository. Compared to the measured
baseline, not to any number in a document.

| Gate | Baseline (Phase 0) | Final (Phase 6) | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit **0** | exit **0** | none |
| `pnpm build` | exit **0**, 202 lines | exit **0**, 202 lines | **none — route table byte-identical** |
| `pnpm lint` | exit **1**, **182 problems (154 errors, 28 warnings)** | exit **1**, **182 problems (154 errors, 28 warnings)** | **none — identical** |
| `pnpm identity-columns:guard` | exit **0**, 381 files, TOTAL 0 | exit **0**, 381 files, TOTAL 0 | none |
| `pnpm embed-targets` | exit **0**, 381 files, REPOINTED 0, PERSON 0 | exit **0**, 381 files, REPOINTED 0, PERSON 0 | none |
| `pnpm org-id-reads:guard` | exit **0**, 380 files, A: OPEN 14 / B: OPEN **61**, IMPROVED 0/**0**, REGRESSIONS 0 | exit **0**, 380 files, A: OPEN 14 / B: OPEN **60**, IMPROVED 0/**1**, REGRESSIONS 0 | **class B OPEN 61 → 60, IMPROVED 0 → 1** |
| `pnpm verify-rls` | exit **2** | *not re-run* | environmental; reads no `.ts` or `.sql` |
| `pnpm policy-audit:guard` | exit **1**, 60 company-scoped, FLAGGED 53 (44 direct, 9 indirect) | *not re-run* | environmental; parses a point-in-time snapshot |

`verify-rls` and `policy-audit:guard` were run once at Phase 0 and deliberately
not again, per the brief. **No gate in this repository reads a `.sql` file, so a
green gate says nothing whatever about migration 091.**

## The one movement, explained

```
CLASS B: these files now have FEWER findings than KNOWN_OPEN_MIRROR records.
  lib/entitlements.ts   recorded 1, found 0
```

**Cause: Phase 3.** `agencyEntitlementId()` used to issue its own
`.from("org_members").select("org_id, role").eq("user_id", userId)`. That was the
one recorded class-B site in the file. Delegating to `resolveActingOrgId()`
deleted it.

**It is a genuine improvement, not a relocation that hides.** The equivalent read
still exists in `lib/acting-org.ts`'s `loadMemberOrgIds()` — **but it existed
there before this change**, shipped with 090. So the net effect is one fewer
place in the codebase performing a user-id-keyed organization read.
`REGRESSIONS` is **0**, which confirms nothing appeared anywhere else.

> **THE COUNT WAS NOT LOWERED.** `KNOWN_OPEN_MIRROR` still records 1 for
> `lib/entitlements.ts`. The brief forbids editing a guard allow-list or a
> `KNOWN_OPEN` count, and **the gate passes at exit 0 either way** — `IMPROVED` is
> informational, only `REGRESSIONS` fails it. `git diff main..HEAD -- scripts/`
> is **empty**, which confirms no guard script was touched.
>
> **The one-line change, whenever you want it:** lower
> `lib/entitlements.ts` from 1 to 0 in `KNOWN_OPEN_MIRROR` in
> `scripts/check-org-id-reads.mjs`, or delete the entry.

**Nothing was reworded to satisfy a guard. No exemption was added. No allow-list
entry was touched.**

**File counts did not move** (381 / 381 / 380) and that is correct: this session
added **no** `.ts` or `.tsx` file. The three new artifacts are two `.sql` files and
four `.md` files, and no guard scans those roots.

---

# OPEN — every item, with the query or command that settles it

## Raised by this session

### OPEN-091-1. `grant-agency-access` writes another user's row with a session client

`app/api/admin/grant-agency-access/route.ts:21` is
`auth.supabase.from("profiles").update({ secondary_role }).eq("id", userId)` — a
**session** client targeting somebody other than the admin. The profiles UPDATE
policy is `auth.uid() = id`, so for every target but the admin's own row that
**matches zero rows, PostgREST returns no error, and the route returns
`{ success: true }` having written nothing.** Identical to the shape the flags
route's own header (`:10-14`) describes as the reason the flags moved to the
service role. **This route did not move with them.** Not fixed — out of the
brief's scope.

```sql
-- Does anybody actually carry secondary_role='agency'? If the answer is only
-- accounts that are also is_admin, this route has never granted anything to
-- anybody else.
SELECT p.is_admin, p.secondary_role, count(*)
FROM public.profiles p GROUP BY p.is_admin, p.secondary_role
ORDER BY p.is_admin DESC, p.secondary_role;
```

### OPEN-091-2. The `secondary_role` split

`switch-role:43` **self-grants** `secondary_role='partner'` as a free self-serve
act. `grant-agency-access:21` writes `secondary_role='agency'` as an **admin
grant**. **Same column, two different authorities**, which is why it is out of the
authority set — a trigger cannot separate them without encoding product policy.

**Ruling Greg owes:** should the agency grant live on its own column, or should
the guard learn the value? *(A guard that permits only `'partner'` from a session
would express it — but it puts a product rule in a trigger.)*

```sql
SELECT secondary_role, count(*) FROM public.profiles GROUP BY secondary_role;
-- Shows how much is actually at stake before deciding.
```

### OPEN-091-3. Drop `linked_agency_id`

Zero writers, zero consumers (CENSUS-2). Recommended for deletion by a later
migration, at which point its guard entry comes out with it.

```sql
SELECT count(*) AS total, count(linked_agency_id) AS non_null
FROM public.profiles;
-- EXPECTED: non_null = 0. Any non-zero value is data nothing in this
-- repository ever wrote, and it should be understood before the column goes.
```

### OPEN-091-4. The ambiguous branch of `agencyEntitlementId`

With >1 membership and no usable preference, the resolver refuses and the fallback
returns `userId`, where the old ranking returned the owned organization.
**Near-unreachable after 090** — `accept_org_invitation` initialises
`active_org_id` when it is null, so a colleague has a preference from the moment
they accept.

**Ruling Greg owes:** should a quota call for a genuinely ambiguous caller charge
their own organization, or fail loudly?

```sql
SELECT m.user_id, count(*) AS memberships, p.active_org_id
FROM public.org_members m JOIN public.profiles p ON p.id = m.user_id
GROUP BY m.user_id, p.active_org_id HAVING count(*) > 1;
-- EXPECTED today: 0 rows. Any row with active_org_id NULL is a live instance.
```

### OPEN-091-5. Does `authenticated` actually hold UPDATE on `profiles`?

090's OPEN-5, and **091's entire premise**. If the answer is no, the self-grant
hole never existed and 091 is unnecessary rather than wrong.
**`docs/091-preapply-test.sql` settles it as a side effect** — a T4 returning
42501 instead of LG007 is the answer. To ask directly:

```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='UPDATE';
-- If `authenticated` appears here, RLS is the ONLY thing between a browser and
-- any column on its own profile row, and 091 is load-bearing.

SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='UPDATE';
```

### OPEN-091-6. Are `role` and `active_role` literal-pure?

Settles Phase 4a's single non-identity: `canActAs()` normalizes case and
whitespace and the raw comparison it replaced did not.

```sql
SELECT role, active_role, secondary_role, count(*)
FROM public.profiles
GROUP BY role, active_role, secondary_role
ORDER BY count(*) DESC;
-- EXPECTED: every value is exactly 'agency', 'partner' or NULL. Any value that
-- differs only in case or whitespace is a row where the vendor upload gate now
-- answers differently than it did before this branch.
```

### OPEN-091-7. Is the 092 backfill window still open?

```sql
SELECT org_id, count(*) AS members
FROM public.org_members GROUP BY org_id HAVING count(*) > 1;
-- 0 rows: the backfill still has one unambiguous source per organization.
-- ANY ROW: it does not, and 092 needs a ruling first. See
-- docs/092-entitlements-design.md section 0.
```

### OPEN-091-8. Verify 091 landed and stayed landed

After applying, and any time you wonder whether the database and the repository
still agree, run **V4** from the migration — the rot check. It extracts the
guarded set from `prosrc` and compares it to the expected five.

## Carried forward, unchanged, from `docs/091-entitlements-surface.md`

**OPEN-A** which two organizations have `id <> profiles.id` · **OPEN-C** does any
`org_members` row hold a role other than `owner` · **OPEN-D** what
`usage_tracking.plan_tier` actually holds · **OPEN-E** who is entitled right now
and does it survive the move · **OPEN-F** the shape of the FK on
`usage_tracking.org_id` · **OPEN-G** orphaned `usage_tracking` rows. Each carries
its query in that document. **OPEN-B is settled** — the brief's STATE block
confirms the policy shape by construction, which is what made 091 worth writing.

---

# PRODUCT RULINGS DEFERRED — none of these was answered here

| # | Ruling | Where it is set out |
|---|---|---|
| 1 | **Shape A or Shape B** — flat company plan, or metered seats. Note Shape A is a **strict prefix** of Shape B. | `092-entitlements-design.md` §2, §3 |
| 2 | **What an unpaid organization does to its members** — and in particular whether the owner keeps a route to a billing page. A gate that blocks the person who has to pay is a trap. | §5 |
| 3 | **The role escalation.** An admin can currently invite anyone as **owner** and can **remove the owner**. Recommended conservative default: *an admin may not grant, nor remove, a role at or above their own.* **Named as Greg's ruling.** | §6 |
| 4 | **Does `organizations.is_paid` mean "entitled" or "entitled AS A LEAD AGENCY"?** Vendor organizations have no entitlement concept at all today. One column read by one function either locks every vendor out on the day it defaults to false, or makes the column's name a lie for half the rows. | §7 |
| 5 | **The `secondary_role` split** — one column, two authorities. | OPEN-091-2 |
| 6 | **Should `linked_agency_id` be dropped?** | OPEN-091-3 |
| 7 | **The ambiguous-caller quota question.** | OPEN-091-4 |
| 8 | **The partnership-claim collision** — the first colleague of a vendor company to sign up takes every ghost row addressed to that email. Pre-existing from 079, flagged at `partner/partnerships/claim:44`, unchanged here. | 079 rename plan §6 route 19 |

---

# WHAT WAS EXECUTED, WHAT WAS READ, WHAT WAS REASONED

## EXECUTED

`git rev-parse`, `git status`, `git log`, `git for-each-ref`, `git show --stat`,
`git diff --stat`; **the eight gates at Phase 0 and the six code-reading gates
again at Phase 6**; roughly twenty-five `grep`/`sed`/`cat` passes over `app/`,
`lib/`, `components/`, `contexts/`, `hooks/`, `scripts/`, `types/` and
`supabase/`; three throwaway scripts in the session scratchpad (a Node proximity
scanner for `profiles` writes, a per-column write-key sweep, a Node scanner for
`organizations` writes), **none committed**; `npx tsc --noEmit` and `pnpm lint`
after every code edit; two `pnpm build` runs whose route tables were diffed.

**Every count in this report came off one of those passes and can be re-run:**
30 writers to `profiles`, 44 columns checked one at a time, 2 unaccounted,
15 `is_paid` select lists (14 inline + 1 named constant) against `company_name`'s
45, 18 `agencyEntitlementId()` call sites of which 3 are not quota calls,
4 `hasAgencyEntitlement()` sites, 4 `canUseAgencyAi()`, 1 `canUploadFiles()`,
0 `canUseAgencyPortalAi()`, **1 writer of `public.organizations` in the entire
application**, 6 LG error codes in use before this session.

## READ

**In full:** `docs/091-entitlements-surface.md` (882 lines, via `git show`);
`lib/entitlements.ts`; `lib/acting-org.ts`; `lib/acting-role.ts`;
`supabase/migrations/090_active_org_down.sql`; `contexts/paid-user-context.tsx`
(the effect and `checkFeatureAccess`); `app/api/profile/route.ts`;
`app/api/profile/switch-role/route.ts`; `app/api/user/active-role/route.ts`;
`app/api/admin/grant-agency-access/route.ts`; both vendor upload routes.

**In part:** `090_active_org.sql` (header, section 2's guard in full, section 3's
oracle assessment, section 5's grants, the COMMIT, the verification block);
`079_organizations.sql` (PHASE 12's `handle_new_user` in full, the
`organizations` DDL, the `ALTER TABLE` grep); `docs/090-active-org-report.md`
(the gate table); `lib/usage-tracking.ts` (`getOrCreateMonthlyUsage`,
`checkUsageLimit`); `lib/api-auth.ts` (`requireAdminRole`);
`app/auth/callback/route.ts`; both `settings/user` pages; both profile pages;
`app/partner/legal/page.tsx`; `app/api/partner/rate-info/route.ts`;
`lib/company-identity.ts`; `app/api/admin/users/[userId]/flags/route.ts`;
`app/api/admin/grant-access/route.ts`; `app/api/agency/msa/ai-schedule/route.ts`
and `app/api/agency/payment-synthesis/route.ts` (the gate blocks);
`app/api/agency/email-scan/{import,run}/route.ts`;
`app/api/partner/partnerships/claim/route.ts`.

## REASONED — and therefore unverified against any live database

- **That `auth.uid()` is NULL for the service role**, because a service_role JWT
  carries no `sub` claim. Standard Supabase, not queried. **The pre-apply test's
  T6 is what proves it**, and T6 failing is the migration's stop condition.
- **That `auth.uid()` is NULL inside `handle_new_user`**, because an `auth.users`
  INSERT is never performed by an end-user session. Derived from what fires that
  trigger, not observed.
- **OPEN-091-1's zero-rows claim.** It follows from the policy text the brief
  supplied, not from a live write.
- **Every statement about which database role a given client resolves to.** Each
  follows from how the file constructs its client.
- **That the 091 authority set is complete.** It is complete against the census,
  which is complete against this working tree. A writer outside `app/`, `lib/`,
  `components/`, `contexts/`, `hooks/`, `scripts/`, `types/` and `supabase/` —
  a psql session, a Supabase dashboard edit, an external script — is outside what
  a grep can see.
- **The whole of `docs/092-entitlements-design.md`**, which is about states that
  do not exist yet.

## NOT DONE

**No migration applied.** No database queried, read or written. No policy read
live. No RLS widened. `middleware.ts` untouched. No feature flag set, flipped or
added to any env file. **No guard allow-list or `KNOWN_OPEN` count edited** —
`git diff main..HEAD -- scripts/` is empty. The budget spine untouched. **No
push, no merge, no PR.** `LIGAMENT_CONTEXT.md`'s migration table not updated,
deliberately: that table records applies, and 091 has not been applied.

---

# THE SIX COMMITS

| | |
|---|---|
| `106469b` | **Phase 0** — the profiles writer census and the gap table |
| `14b3bf1` | **Phase 1** — the authority set, and why a second trigger |
| `0be6cd9` | **Phase 2** — migration 091, its down file, and the pre-apply test |
| `e21a63a` | **Phase 3** — the resolver swap and three comment corrections |
| `c1c88ed` | **Phase 4** — one vendor upload definition, and the `canUseAgencyPortalAi` finding |
| `b437ece` | **Phase 5** — 092 designed both ways, not authored |

**Two files carry executable SQL and no gate reads either of them:**
`supabase/migrations/091_profiles_column_guard.sql` (680 lines) and
`docs/091-preapply-test.sql` (588 lines). **Run the test first.**
