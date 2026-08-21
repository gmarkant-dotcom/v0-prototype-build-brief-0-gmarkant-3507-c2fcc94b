# 091 Phase 1 — the authority set, and the shape of the guard

Input: `docs/091-profiles-writer-census.md` (Phase 0, this branch, `106469b`)
and `docs/091-entitlements-surface.md` (`git show 67c2878:`, sibling branch).
Everything here is **REASONED FROM THE CENSUS**. No database was queried.

---

## 1. THE SHAPE — deny-list, and the census is what confirms it

Not re-opened. The brief ruled it and Phase 0's gap table counted it:

**42 of 44 columns have a writer. 37 of those are ordinary profile content
edited from a settings form, across 24 session-client write sites.** A permit
list is 37 entries whose single failure mode is that one omission silently
breaks a save that reports success — the exact shape
`app/api/profile/route.ts:35` records having shipped for two migrations with
`personal_linkedin_url`. A deny-list is five entries whose single failure mode
is that a *future* privilege column goes unguarded, and adding a privilege
column is a deliberate act in a way that adding `bio` is not.

### The rot mitigation, chosen

The deny-list's one failure mode is drift, so it gets four countermeasures and
they are all cheap:

1. **The set lives in exactly one place in the function body** — one `IF ... IS
   NOT DISTINCT FROM ...` chain and one `IF ... IS DISTINCT FROM ...` block per
   column, in the same order, with no second copy anywhere. Adding a column is
   two edits in one screen.
2. **The migration header names the set, names this document, and states the
   rule**: *a new column on `profiles` that grants anything must join this set
   in the same migration that creates it.*
3. **`COMMENT ON FUNCTION` repeats the set verbatim**, so a `pg_proc` query
   answers "what is guarded" without anybody opening a `.sql` file. This is the
   only one of the four that survives someone reading the live database instead
   of the repository.
4. **A verification query extracts the guarded set from `prosrc`** and compares
   it to the expected literal, so a file/database divergence is detectable
   rather than assumed away. It is V4 in the migration.

**Recommended and NOT done here:** a line in `LIGAMENT_CONTEXT.md`'s migration
table for 091 naming the set. That table is updated by Greg after applying, per
the documented migration sequence, so writing it now would claim an apply that
has not happened.

---

## 2. THE AUTHORITY SET — decided from the census, one column at a time

The test applied to every candidate: **does any session client legitimately
UPDATE this column?** If yes, it cannot be guarded without breaking a live
path. If no, it belongs in the set. Census numbers refer to Phase 0's table.

### IN THE SET

| Column | Census evidence | Justification |
|---|---|---|
| **`is_paid`** | Writers **25** (`admin/users/[userId]/flags/route.ts:118`, service role, allow-listed) and **26** (`admin/grant-access/route.ts:166`, service role). **No session-client writer of any kind.** | The only access grant this product has. Ten server gates and the whole agency layout read it. Zero legitimate session writes, so guarding it costs nothing and closes the self-grant. |
| **`is_admin`** | Writer **25** (service role) and writer **1** (`auth/callback:44`, literal `false`, and an **INSERT** — a `BEFORE UPDATE` trigger does not fire on it). **No session-client UPDATE writer.** | Grants the admin panel, `requireAdminRole()`, and a bypass in every entitlement function. Self-granting it is strictly worse than self-granting `is_paid`. |
| **`demo_access`** | Writer **25** only. **No other writer in the tree.** | Same admin allow-list, same argument. It is in `MUTABLE_FLAGS` beside the other two and belongs in the same set for the same reason. |
| **`email`** | Writers **1** (`auth/callback:25`, session, **INSERT**), **27** (`handle_new_user` INSERT) and **28** (`handle_new_user`'s `ON CONFLICT (id) DO UPDATE SET email`, `079:1877`, no session). **No session-client UPDATE writer.** | **The most consequential one, and the brief is right about why.** 089's `current_user_email()` reads `profiles.email`, and `accept_org_invitation` compares the invitation address against it. A self-writable `email` means a user sets it to any address and accepts an invitation issued to that address, gated by token secrecy alone. It also lets `profiles.email` diverge from `auth.users.email` permanently, with no reconciler anywhere in the tree. |
| **`linked_agency_id`** | **Zero writers. Zero real readers.** CENSUS-2: two occurrences in the whole tree, both in `contexts/paid-user-context.tsx` (`:107` select, `:118` setter), placed on the context at `:177`, and **no component destructures `linkedAgencyId`**. | See the separate recommendation below. |

### NOT IN THE SET

| Column | Census evidence | Why not |
|---|---|---|
| **`role`** | Writer **2**, `auth/callback:88` — a **session** client writing `updatePayload.role`. | Guarding it breaks the vendor-portal correction that route exists for. The brief's guess is confirmed. |
| **`active_role`** | Writers **2, 17, 18, 19, 20** — five session-client writers: the auth callback, `switch-role` (both branches), `active-role`, and `partner/rfps/claim:110`. | This is the dual-role mechanism the user controls. Guarding it breaks "Switch to Vendor Mode" five different ways. |
| **`secondary_role`** | Writers **17** (`switch-role:43`, session, self-granting `'partner'` — free and self-serve by design) and **24** (`grant-agency-access:21`, session, admin-gated). | A session client legitimately self-grants `secondary_role = 'partner'`. **This is the one place the brief's "likely not" needed checking rather than assuming**, because `secondary_role='agency'` *is* an admin grant — but it travels on the same column as a self-serve one, and a trigger cannot tell them apart without encoding product policy in the database. Out, and the split is recorded as OPEN-091-2. |
| **`is_discoverable`** | Writers **7, 8, 9, 10** — four session-client writers, two of them dedicated toggles. | A legitimate settings toggle on both portals. Confirmed, not assumed. |

### The `linked_agency_id` recommendation, stated as the brief asks

**Nothing writes it. Nothing meaningfully reads it.** The single read lands on a
context field no consumer destructures, so removing the column today would
change no rendered pixel and no request.

**Recommendation: put it IN the set, and separately recommend dropping the
column.** Three reasons, and the cost asymmetry is the whole argument:

1. **A guard entry on a column with zero writers cannot refuse a legitimate
   write.** The risk of including it is exactly zero today.
2. **It is a relationship claim on a self-writable row**, which is the shape the
   guard exists for — a uuid naming another entity, not profile content. It is
   inert only because no code path consumes it. The day somebody wires it up as
   authorization, the hole is pre-existing and invisible.
3. **If a future feature genuinely needs a session client to write it**, the
   guard raises with a message naming the column, and the question it forces —
   *should a user be able to assert their own link to an agency?* — is precisely
   the question that should be asked at that moment rather than answered by
   default.

**Separately: recommend a later migration DROP the column**, at which point its
guard entry comes out with it. Not done here: 091 is a guard, and dropping a
column is a different change with a different blast radius. Recorded as
OPEN-091-3.

### THE FINAL SET — five columns

```
is_paid, is_admin, demo_access, email, linked_agency_id
```

---

## 3. SECOND TRIGGER, NOT AN EXTENSION OF 090'S — and this is the design call

The brief asks for this to be decided and justified. **Decision: a second
`BEFORE UPDATE` trigger, `profiles_authority_columns_guard`, on its own
function.** Five reasons, in order of weight:

1. **THE TWO GUARDS ARE OPPOSITE BY CONSTRUCTION AND THE HEADERS SAY SO.**
   090's guard is deliberately caller-independent — its own header at
   `090:344-349` states that it *"reads auth.uid() nowhere, which is what makes
   it independent of who is connected"*, because membership is a fact about the
   **row**. 091's guard is caller-dependent: "may this actor change this column"
   is a fact about the **actor**. Folding a caller test into a function whose
   header argues at length for having none produces a body that contradicts its
   own documentation, and that documentation is the thing the next reader
   trusts.

2. **090's SEPARABILITY IS AN EXPLICIT, WRITTEN PROPERTY** (`090:317`):
   *"IF YOU DISAGREE WITH ANY OF THIS: delete this entire section 2, and the
   migration is still coherent."* Extending the function destroys that. Two
   triggers keep both migrations independently reversible, which is what makes
   the down files honest.

3. **THE DOWN FILE IS STRICTLY SAFER.** A second trigger's down file is
   `DROP TRIGGER` then `DROP FUNCTION` — two statements that cannot be wrong.
   An extension's down file must `CREATE OR REPLACE` 090's body **verbatim**,
   and the 090 down file already documents why that class of restore is
   dangerous (`090_active_org_down.sql:113`): *"a rollback that omits a clause
   does not restore 089 — it invents a third version."*

4. **ORDER BETWEEN THEM IS IRRELEVANT, SO THERE IS NO COST.** Two `BEFORE
   UPDATE ... FOR EACH ROW` triggers fire in trigger-name order:
   `profiles_active_org_guard` sorts before `profiles_authority_columns_guard`
   (`c` < `u`), so 090's runs first. **Neither modifies `NEW`.** Each either
   `RETURN NEW` unchanged or `RAISE`. So the pair is order-independent, and a
   row that would be refused by both is refused by 090's first — which is the
   harmless direction, since both are refusals.

5. **The only argument the other way is one extra function call per `UPDATE`
   on `profiles`**, and both functions early-return on a handful of `IS NOT
   DISTINCT FROM` comparisons before touching anything.

---

## 4. THE EXEMPTION TEST — `auth.uid() IS NULL`, and why not the other three

The guard must exempt trusted writers or it breaks the admin flags route,
`lib/company-identity.ts`, `handle_new_user` and every future migration.
Four candidates, and they are **not** equivalent.

### Rejected: `current_user`

**It is meaningless inside a `SECURITY DEFINER` function** — `current_user`
resolves to the function's *owner*, so a `SECURITY DEFINER` guard testing
`current_user` tests a constant and exempts everything. Making it meaningful
requires `SECURITY INVOKER`, which is viable here (the body queries no table),
and under `SECURITY INVOKER` PostgREST's `SET LOCAL ROLE` does give a genuine
answer: `authenticated`, `service_role`, or `postgres`.

**Rejected anyway, on a fact this session cannot check.** It classifies
`handle_new_user` (writer 28) as exempt **only if** that function's owner is a
superuser role — and function ownership is not derivable from the repository.
If `handle_new_user` is owned by `supabase_auth_admin` rather than `postgres`,
an exemption list missing that role turns every re-fired signup trigger into a
raise. A test whose correctness depends on an unqueryable fact is the wrong test
for a guard that can refuse existing writes.

### Rejected: `session_user`

**It collapses the two cases the guard must separate.** PostgREST connects as
`authenticator` and then issues `SET LOCAL ROLE`, which changes `current_user`
and leaves `session_user` alone. So `session_user` is `authenticator` for a
browser **and** for the service role. It cannot distinguish them at all.

### Rejected: `auth.role()`

Closest to workable — it reads the JWT `role` claim, which is `authenticated`
for a session, `service_role` for the service key, and NULL with no JWT. It is
rejected for being **strictly weaker than `auth.uid()` with no compensating
benefit**: it tests a claim that PostgREST has already consumed to pick the
database role, so it answers the same question one step further from the
evidence, and it needs a string literal comparison where `auth.uid()` needs a
null test.

### CHOSEN: exempt when `auth.uid() IS NULL`

**The guard fires only when there is an end-user session behind the write.**

Three things recommend it. It depends on no ownership fact, so its behaviour is
derivable from the census alone. `auth.uid()` is already live and verified in
this schema — `set_active_org` calls it (`090:466`) and 090 is applied. And it is
the **stricter** of the workable options in the one place they differ, below.

**Where it differs from `current_user`, stated plainly:** a `SECURITY DEFINER`
function called *by a session client* keeps that session's `auth.uid()`, so it
stays **guarded**, whereas `current_user` would exempt it wholesale. That is the
behaviour to want: it means a future RPC cannot become a laundering path for an
authority column without somebody deliberately writing an exemption into it.
Today it costs nothing — `set_active_org` and `accept_org_invitation` (writers
29 and 30) write only `active_org_id`, so they leave on the early return and
never reach the test.

**One operational note, not a defect.** The Supabase SQL Editor's
role-impersonation feature sets `request.jwt.claims`, so a statement run under
impersonation **is** guarded. That is correct — you asked to be that user — and
it is exactly the mechanism the Phase 2 pre-apply test block uses to prove the
refusals.

---

## 5. THE WRITER-OUTCOME TABLE — every census writer against the chosen test

This is the 087 lesson applied: a trigger with no `WHEN` clause fires on paths
nobody traced, and 087's own header was wrong about which paths those were. So
every one of the 30 writers is walked, and **the reason each passes is named**,
because "early return" and "exempt" are different mechanisms with different
futures.

| # | Writer | Guarded column? | `auth.uid()` | Outcome | Mechanism |
|---|---|---|---|---|---|
| 1 | `auth/callback:23` INSERT | `email`, `is_admin` | non-null | **PASSES** | **INSERT. A `BEFORE UPDATE` trigger does not fire.** |
| 2 | `auth/callback:88` UPDATE | no | non-null | PASSES | early return |
| 3–6 | both `settings/user` pages | no | non-null | PASSES | early return |
| 7 | `agency/settings/profile:301` | no | non-null | PASSES | early return |
| 8 | `agency/settings/profile:261` → `company-identity:347` | no | non-null | PASSES | early return |
| 9 | `partner/profile:462` | no | non-null | PASSES | early return |
| 10 | `partner/profile:635` → `company-identity:347` | no | non-null | PASSES | early return |
| 11–13 | `partner/legal` ×3 | no | non-null | PASSES | early return |
| 14 | `partner/rfps/[id]:1151` | no | non-null | PASSES | early return |
| 15–16 | `api/profile:67`, `:84` | no | non-null | PASSES | early return |
| 17–18 | `api/profile/switch-role:43`, `:67` | no | non-null | **PASSES — the portal switch** | early return |
| 19 | `api/user/active-role:48` | no | non-null | PASSES | early return |
| 20 | `api/partner/rfps/claim:110` | no | non-null | PASSES | early return |
| 21–23 | `api/partner/rate-info` ×3 | no | non-null | PASSES | early return |
| 24 | `admin/grant-agency-access:21` | no (`secondary_role`) | non-null | PASSES | early return. **Still matches zero rows for any target but the admin's own — CENSUS-1, unchanged by 091.** |
| 25 | `admin/users/[userId]/flags:118` | **`is_paid`, `is_admin`, `demo_access`** | **NULL** (service role) | **PASSES** | **exemption** |
| 26 | `admin/grant-access:166` | **`is_paid`** | **NULL** (service role) | **PASSES** | **exemption** |
| 27 | `handle_new_user` INSERT (`079:1864`) | `email` | NULL | PASSES | **INSERT. Trigger does not fire.** |
| 28 | `handle_new_user` `ON CONFLICT DO UPDATE` (`079:1877`) | **`email`** | **NULL** — fires from `AFTER INSERT ON auth.users`, and an `auth.users` INSERT is never performed by an end-user session | **PASSES** | **exemption** |
| 29 | `set_active_org` (`090:490`) | no | non-null (session caller) | PASSES | early return |
| 30 | `accept_org_invitation` (`090:703`) | no | non-null (session caller) | PASSES | early return |

**Every writer passes. Three pass by exemption, two by not being an UPDATE, and
the remaining twenty-five by the early return.**

The single row this whole analysis turns on is **28**. It is the only UPDATE in
the product that writes a guarded column with no session, and it is the one the
brief said not to miss.

---

## 6. Decisions carried into Phase 2

- Function `public.profiles_guard_authority_columns()`, `SECURITY DEFINER`,
  `SET search_path = public, pg_temp`, matching 090.
- Trigger `profiles_authority_columns_guard`, `BEFORE UPDATE ON public.profiles
  FOR EACH ROW`. Second trigger; 090's is untouched.
- Early return on `IS NOT DISTINCT FROM` across all five columns, **before**
  `auth.uid()` is consulted — the common path is a settings save by a session
  client and it should not pay for the test.
- Exemption `auth.uid() IS NULL`, second.
- One `RAISE` per column, `ERRCODE = 'LG007'` — the next free code after 089's
  LG001–LG004 and 090's LG005–LG006, confirmed by grep over `supabase/` and
  `lib/`.
- `MESSAGE` is fixed user-facing copy; the column name goes in `DETAIL`, never
  a value. Oracle assessment in the migration header.
- API mapping **stated in the header, not implemented** — the brief forbids
  touching a route this phase. LG007 maps to **403**, and
  `lib/org-invitations.ts:77` is where the existing table lives.
