# 092 — moving entitlement onto the organization. DESIGN ONLY.

**NOTHING IS AUTHORED HERE. No SQL was written, no migration file exists, no
database was queried.** 092 is blocked on a ruling Greg has not made, so both
shapes are designed and costed and neither is built.

Inputs: `docs/091-entitlements-surface.md` (`git show 67c2878:`),
`docs/091-profiles-writer-census.md`, `docs/091-guard-shape.md`,
`supabase/migrations/091_profiles_column_guard.sql`.

---

# 0. THE BACKFILL WINDOW. THIS IS AT THE TOP BECAUSE IT CLOSES.

**Every one of the eighteen organizations has exactly one member, today.**

That is not a convenience. It is the entire reason a backfill from
`profiles.is_paid` to an organization column has a defined answer: **one member
per organization means exactly one unambiguous source row per target row.**
`UPDATE organizations SET is_paid = (that member's flag)` is total, deterministic
and reviewable.

**THE MOMENT ANY ORGANIZATION HAS TWO MEMBERS, "which member's flag becomes the
company's" HAS NO CORRECT ANSWER.** Not a hard one. None. If A is paid and B is
not, both `OR` and `AND` are defensible and both are guesses, and the guess is
permanent because the source column is on its way to being retired.

This is the same shape as the company-name drift that
`lib/company-identity.ts` exists to prevent: preventive right up until somebody
renames, and then archaeology. It has one additional property that makes it
worse — **the drift is silent**, because nothing compares the two flags.

**WHAT THIS MEANS FOR SEQUENCING, stated as a constraint rather than advice:**

> **092's backfill must land before `COLLEAGUE_INVITATIONS` is switched on, or
> the ruling about which flag wins has to be made under time pressure by
> whoever is doing the migration.**

`accept_org_invitation()` is the only thing in this product's history that can
give an organization a second member. It is behind that flag and the flag is off
everywhere. So the window is open, it is open only because the flag is off, and
closing it costs one `UPDATE` today and a product decision tomorrow.

The query that measures the window, and it should return zero rows every day
until 092 lands:

```sql
SELECT org_id, count(*) AS members
FROM public.org_members GROUP BY org_id HAVING count(*) > 1;
-- 0 rows: the backfill still has one unambiguous source per organization.
-- ANY ROW: it does not, and Greg owes a ruling before 092 can be written.
```

And the one that shows what the backfill would actually write:

```sql
SELECT m.org_id, o.name, count(*) AS members,
       bool_or(p.is_paid)  AS any_member_paid,
       bool_and(p.is_paid) AS every_member_paid
FROM public.org_members m
JOIN public.profiles p      ON p.id = m.user_id
JOIN public.organizations o ON o.id = m.org_id
GROUP BY m.org_id, o.name
ORDER BY any_member_paid DESC;
-- EXPECTED today: 18 rows, members = 1 on every one, and any_member_paid =
-- every_member_paid on every one. 16 true, 2 false, matching the known
-- is_paid distribution.
-- ANY ROW WHERE any_member_paid <> every_member_paid is the ambiguity above,
-- already realised.
```

---

# 1. THE GUARD. WHICH OF 091's MECHANISMS TRANSFER, AND WHICH DO NOT.

**The hole 091 closed on `profiles` exists on `organizations` in an almost
identical shape, and the role gate that looks like it closes it does not.**

`"Org admins update their organization"` (079:1797) has `qual` and `with_check`
both `id IN (SELECT public.current_user_admin_org_ids())`, and that helper
resolves `role IN ('owner','admin')`. That reads like a privilege check.
**It buys nothing against self-granting, because EVERY USER OWNS THEIR OWN
ORGANIZATION BY CONSTRUCTION** — 079 PHASE 2 backfilled one per profile with
role `owner`, and PHASE 12's trigger creates one per signup with role `owner`.
So every authenticated user is an owner of some organization, and the policy
authorises them to `UPDATE` it. A billing column on that table is
self-grantable by exactly the argument 091 made about `profiles.is_paid`, one
level up.

> **THE COLUMN MUST BE BORN WITH ITS GUARD. Same migration, same transaction.**
> Between an `ALTER TABLE ... ADD COLUMN` and a later `CREATE TRIGGER` there is
> a window in which any authenticated user can `PATCH
> /rest/v1/organizations?id=eq.<their own org>` with the billing column set.
> The window is however long it takes to notice, and migrations here are applied
> by hand.

### Transfers unchanged

| 091 mechanism | Transfers? | Why |
|---|---|---|
| **A trigger, not a policy** | **Yes, exactly** | `organizations` DOES have a `with_check`, unlike `profiles` — and it makes no difference. **A `WITH CHECK` still has no `OLD`.** "The plan column did not change" is a statement about two rows and a `WITH CHECK` can only make statements about one. Structurally identical to 091's argument and to 087's. |
| **A trigger, not a column `REVOKE`** | **Yes** | `REVOKE UPDATE (col) ... FROM authenticated` is a no-op while that role holds table-level `UPDATE`. Nothing about that is specific to `profiles`. |
| **Early return on `IS NOT DISTINCT FROM`** | **Yes, and it is LOAD-BEARING here** | See below. |
| **`RAISE`, never a silent revert** | **Yes** | A silently reverted plan change is a customer who believes they upgraded. |
| **A distinct `ERRCODE`** | **Yes.** `LG008` | 089 used LG001–LG004, 090 LG005–LG006, 091 LG007. Map it to **403** at `lib/org-invitations.ts:77`, alongside LG007. |
| **Column named in `DETAIL`, value never interpolated** | **Yes** | Same assessment: the caller supplied the column name, and PostgREST publishes the schema through OpenAPI anyway. A value would confirm state to somebody who may not be able to read it. |

**Why the early return is load-bearing rather than an optimisation.** There is
**exactly one writer of `public.organizations` in the entire application** —
measured, not assumed:

```
lib/company-identity.ts:305   .from("organizations").update({ name }).eq("id", acting.orgId)
```

and it is a **SESSION client**. Every company rename in the product goes through
it. Without an early return on "no guarded column moved", a guard on
`organizations` would raise on every rename. With one, the rename never reaches
the caller test.

### Transfers mechanically, but the question underneath it must be re-decided

**The exemption test.** `auth.uid() IS NULL` transfers as code. What it MEANS
does not transfer for free:

- On `profiles`, "no session client legitimately writes `is_paid`" is a measured
  fact — the census found zero such writers — so "no session may write it" IS
  the rule.
- On `organizations`, **the ruling says the opposite**: owner and admin *may*
  change the plan. So a session client eventually *should* write this column.

**It still resolves to the same test, and the reasoning is worth writing down
because it is not obvious:**

1. **Today there is no billing provider anywhere in the repository.** So there is
   no validated flow a session write could come from, and every session write to
   a billing column today is a self-grant. `auth.uid() IS NULL` is exactly right.
2. **When a billing provider arrives, it still is.** A plan change from Stripe or
   anything like it arrives as a **webhook**, server-side, on the service role —
   `auth.uid()` is NULL and the write is exempt. The browser never writes the
   plan; it writes to the provider, and the provider tells the database.

So the test survives the arrival of billing without amendment. **What must NOT
happen is a later "the owner is allowed, so let owners through" amendment**,
because "is an owner" is true of every user about their own organization.

### DOES NOT TRANSFER: the deny-list shape. INVERT IT.

**091 uses a deny-list over 5 of 44 columns and the count is the whole argument.
On `organizations` the count runs the other way, so the shape should too.**

`organizations` has **seven** columns: `id`, `name`, `primary_contact_user_id`,
`is_lead_agency`, `is_vendor`, `created_at`, `updated_at`. Of those, **a session
client writes exactly one: `name`.**

So the guard on `organizations` should be a **permit list of one**:

> A caller with an end-user session may change `name`. Any other column moving is
> refused.

| | `profiles` (091) | `organizations` (092) |
|---|---|---|
| Columns | 44 | 7 |
| Written by a session client | 37 | **1** (`name`) |
| Permit list size | 37 — untenable | **1** |
| Deny list size | 5 | 5, and growing with every future column |
| Failure mode of the chosen shape | a future privilege column ships unguarded | a future *user-editable* column breaks until it joins the permit list |

**The inverted shape is strictly better here and the reason is the future
column, not the present one.** A permit list guards the billing column, the seat
count, and everything after them **by default**. Its failure mode is loud and
lands at development time — somebody adds a user-editable column, the save
raises LG008, and they add one word to a list. 091's failure mode is silent and
lands in production.

**One thing the permit list must not omit:** `lib/company-identity.ts:305`
currently writes `{ name }` and nothing else — not even `updated_at`. If it ever
adds one, that column joins the permit list in the same commit.

### DOES NOT TRANSFER FOR FREE: the interaction with `accept_org_invitation`

**This is the one nobody would go looking for, and it decides Shape B's design.**

091 established that **a `SECURITY DEFINER` function called BY A SESSION CLIENT
keeps that session's `auth.uid()`, so it stays GUARDED.** That was recorded as a
feature: a future RPC cannot become a laundering path for an authority column
without somebody deliberately exempting it.

`accept_org_invitation()` is `SECURITY DEFINER` and is called by a session
client — the invitee's. So:

> **Under Shape B, if `accept_org_invitation()` writes anything to
> `organizations` — decrementing a stored seat count, stamping a `seats_used` —
> THE GUARD REFUSES IT, and accept breaks the day the guard ships.**

Two ways out, and one is clearly right:

**(a) DERIVE the seat count from `org_members`. Never store it.** Accept then
only READS `organizations` and never writes it, and the guard never fires.

**(b) Exempt `accept_org_invitation()` by name inside the guard.** Workable, and
it turns the rule into "no session, OR this one named function" — which is the
first entry of a permit list of functions, and the second one gets added without
the argument being made again.

**Take (a).** And note what has happened: **two independent arguments now land on
the same answer.** The surface doc reached "derive, do not store" from drift —
`"Org admins remove members"` is a plain `DELETE` policy with nothing counting
anything, so a stored counter is wrong the first time a member is removed. This
one reaches it from the guard. When two unrelated constraints agree, that is the
design.

---

# 2. SHAPE A — the flat company plan

`organizations` gains a boolean. Colleagues are unlimited. One price per company.

### What 092 would contain

1. `ALTER TABLE public.organizations ADD COLUMN is_paid boolean NOT NULL DEFAULT false;`
2. The backfill, in the same transaction, from the one member per organization
   that section 0 guarantees.
3. **The guard, in the same transaction.** Permit list of `{name}`, `LG008`.
4. Grants and `REVOKE ... FROM anon BY NAME` on the guard function.
5. Verification after the `COMMIT`.

### Accept needs no change. Confirmed, not assumed.

Entitlement is one fact on the organization; `accept_org_invitation()` already
copies `org_id` off the invitation row and inserts the membership. Adding a
colleague costs nothing, which is what the 079 ruling recorded
(`lib/entitlements.ts:24`) and what `usage_tracking`'s `UNIQUE (org_id,
month_start)` already implements. **No third `CREATE OR REPLACE`.**

### Cost

| | |
|---|---|
| Migration | One `ALTER`, one `UPDATE`, one function, one trigger. The smallest migration since 083. |
| Code | The 15 select lists (section 3), plus the admin grant surface. |
| Guard | Born with it. No accept-time interaction at all. |
| Product surface | None. Nobody has to be told what a seat is. |
| **Risk** | **The backfill window (section 0) and nothing else.** |

### What it forecloses

Nothing structurally — a seat count can be added later, and section 0's
ambiguity is *already spent* by then because entitlement lives on the
organization. **Shape A is a strict prefix of Shape B.**

---

# 3. SHAPE B — metered seats

`organizations` gains a seat allowance. Accepting an invitation **becomes a
billing event**, so the check must live where an invitee cannot go around it.

### The check goes at accept, and that means a third `CREATE OR REPLACE`

**Creation (`POST /api/org/invitations`) is not sufficient on its own:**

- It races. Two admins, five seats, four members: both see room, both send, both
  invitations are valid.
- Pending invitations are not members. A count at creation time counts the wrong
  thing — the seat is consumed at accept, and an invitation may never be
  accepted.
- It is the right place for a *friendly* refusal and the wrong place for the
  *authoritative* one.

**Accept is the only moment a seat is consumed.** `accept_org_invitation()` is
the right host for four reasons already established in the repository: it is
`SECURITY DEFINER` (the invitee is not yet a member, so no membership-derived
policy can authorise the `org_members` INSERT); PostgREST wraps each RPC in one
transaction; the accept route is one `.rpc()` call and nothing else,
deliberately, so there is no application-side gap; and `org_members` has no
INSERT path for a non-admin other than this function.

> **`CREATE OR REPLACE`, NEVER `DROP` THEN `CREATE`.** A stock Supabase project
> grants `anon` EXECUTE on functions in `public` by default privilege, from both
> `postgres` and `supabase_admin`. `CREATE OR REPLACE` preserves the ACL; DROP
> then CREATE **re-grants `anon` EXECUTE on the function that writes
> `org_members`**. This is the mistake 088 made. It would be the third replace:
> 089 created it, 090 replaced it to add the `active_org_id` set-if-null clause.

### What the check must get right. Five things, none designed here.

1. **DERIVE, DO NOT STORE.** Section 1's convergence. `SELECT count(*) FROM
   org_members WHERE org_id = ...` at accept time. Self-correcting on removal,
   and it keeps accept a pure reader of `organizations`, which is what keeps the
   guard out of its way.
2. **THE COUNT MUST BE LOCKED AGAINST A CONCURRENT ACCEPT.** The existing
   `SELECT ... FROM org_invitations WHERE token = p_token FOR UPDATE` locks **one
   invitation row**. It does not serialize two *different* invitees accepting
   into the same organization at the same instant — both count four members, both
   pass a five-seat check, and the organization ends with six. Locking the
   `organizations` row before counting `org_members` is one shape; a constraint
   that cannot be raced is another. **Which one is a design decision, and
   `SELECT ... FOR UPDATE` on `organizations` interacts with the guard only if it
   then writes, which under (a) it does not.**
3. **ORDERING INSIDE THE FUNCTION.** 090 identified one constraint already: the
   `org_members` INSERT must land before the `profiles.active_org_id`
   set-if-null. A seat check must sit **before** the INSERT, and its refusal must
   abort the whole transaction, or the invitation is marked `accepted` for
   somebody who was not admitted.
4. **THE REFUSAL NEEDS A CODE AND A SENTENCE.** `LG009` — after 092's own LG008.
   It must be mapped in `lib/org-invitations.ts` alongside LG001–LG004 or the
   invitee sees a raw SQLSTATE.
5. **WHAT HAPPENS TO THE INVITATION.** Refusing an over-limit accept leaves the
   row `pending`, which is arguably right — a seat frees and the same link works.
   But 089 deliberately does not stamp status inside a raising branch, because the
   `RAISE` rolls it back. So `pending` is what happens whether or not anybody
   decides it should. Worth deciding rather than inheriting.

### Cost

| | |
|---|---|
| Migration | Everything in Shape A, **plus** a third `CREATE OR REPLACE` of the product's most security-sensitive function, plus a concurrency design. |
| Code | Shape A's, plus an LG009 mapping, plus a friendly pre-check at creation, plus a seat-count surface on the team page. |
| Guard | Shape A's, **plus** the accept interaction in section 1. |
| Product surface | Real. Seats have to be explained, sold, and shown. |
| **Risk** | Shape A's, plus a concurrency bug in the one function that admits people to organizations. |

### Recommendation on the shape itself

**Not made here — it is the ruling.** But one fact belongs next to it: **Shape A
is a strict prefix of Shape B.** Everything Shape A builds, Shape B needs.
Nothing Shape A builds has to be undone to get to Shape B. **The cost of doing A
first and B later is close to zero, and the cost of doing B first and finding
the model wrong is the third replace of `accept_org_invitation()`.**

---

# 4. MIRROR OR DROP — and the deploy ordering hazard, stated explicitly

**The number: 15 select lists across 15 files**, all on `profiles`. Fourteen
inline `.select()` calls plus the `ADMIN_USER_COLUMNS` constant at
`app/api/admin/users/route.ts:15`. Re-measured in this tree: 14 inline + 1 named.
For scale, `company_name` is **45**.

**The blast radius does not force a mirror.** Fifteen statements in fifteen files
is a single mechanical pass. **These do:**

### (1) THE DEPLOY ORDERING HAZARD. THIS IS THE ONE.

> **A migration goes live the moment Greg runs it in the SQL Editor. That is
> independent of git and independent of Vercel.** There is no ordering
> relationship between "the migration is applied" and "the code that matches it
> is deployed" other than the one a human maintains by hand.

**PostgREST fails the WHOLE statement with 42703 for one unknown column.** It
does not ignore it. So between a `DROP COLUMN is_paid` and the push that removes
it from those fifteen select lists:

- `app/auth/callback/route.ts:17` fails — **the post-authentication routing
  decision**, so confirming an email breaks.
- `app/api/projects/route.ts:541` fails. Project creation.
- All four AI routes fail.
- **`contexts/paid-user-context.tsx:107` fails**, which sets `isPaid`, which
  drives `AgencySubscriptionGate` over `components/agency-layout.tsx:817` — so
  **every agency user sees "Platform access has been restricted" instead of the
  product.**

**A mirror makes the two deploys independent in BOTH orders. A drop makes them a
coupled release with a broken window in between, and the window is however long
the Vercel build takes plus however long it takes to notice.**

### (2) `profiles.is_paid` is the only access grant this product has

There is no billing provider. `grantAgencyAccess()` is how a real customer is
switched on today. Drop the column with no org-keyed admin surface in place and
**there is no way to grant access to anybody in the interval.**

### (3) 091 changed the third reason, and it is worth recording

The surface doc's third blocker was that leaving `profiles.is_paid` readable as
an entitlement leaves the self-grant hole with it. **091 closes that.** With the
guard applied, leaving the column in place through 092 is safe in a way it was
not before — it can no longer be self-granted, only read.

### RECOMMENDATION

**092 adds the organization column and moves the READS. `profiles.is_paid` stays
in place through 092 and is retired by a later migration, once an org-keyed
admin surface exists.**

That is **a mirror by SEQUENCING, not a mirror by dual-write.** Nothing has to
keep the two columns in sync, because after the 092 deploy only one of them is
ever consulted. The stale one sits there, read by nobody, until a migration
drops it — and by then no select list names it, so the drop is free.

**In scope for 092 and easy to forget:** the two writers of `profiles.is_paid`
(`admin/grant-access:166` and `admin/users/[userId]/flags:118`) and the admin UI
must move to the organization column in the same push that moves the reads.
Otherwise the admin panel goes on flipping a flag nothing reads, reports success,
and grants nobody anything — the exact silent-success shape this codebase keeps
being bitten by.

---

# 5. WHAT AN ORGANIZATION GOING UNPAID DOES TO ITS MEMBERS

**PRODUCT QUESTION. FLAGGED, NOT ANSWERED.** It is a ruling and inferring it here
would be inventing one.

Today there is no "org going unpaid" state — there is one boolean per profile,
flipped by an admin, and its effect is per-person. **092 makes it simultaneous
for every member of a company**, which is a different product event even though
it is the same boolean.

What the ruling has to answer, listed so none is discovered later:

- **Does the owner keep a way back in?** With `AgencySubscriptionGate` as
  written, an unpaid organization's owner cannot reach **any** `/agency` page —
  including whatever billing page 092 implies. **A gate that blocks the person
  who has to pay is a trap.**
- **Read-only, or nothing?** The data is intact either way. The question is
  whether a lapsed customer can still see and export their projects.
- **Does an admin get the same treatment as a member?** The ruling gives admins
  billing rights, which argues they need enough access to exercise them.
- **A member of a SECOND, still-paid organization.** After 090 an account can
  hold two memberships. If one lapses, entitlement becomes a property of the
  **acting** organization rather than of the session — which means
  `hasAgencyEntitlement()` stops being answerable from a profile row at all and
  needs the acting organization resolved first. **That is a shape constraint on
  092, not only a product question**, and Phase 3 of this session has already put
  the resolver in place for it: `agencyEntitlementId()` now returns the acting
  organization.
- **The copy is wrong for this case.** *"Access to this account has been
  restricted by an administrator"* is written for the admin-toggle model. A
  lapsed payment is not an administrator action and must not read as one.

---

# 6. THE ROLE ESCALATION THE RULING CREATES

**If admins manage billing, then inviting someone as admin grants billing
rights.** Here is exactly what the current surface permits.

### What constrains the role on an invitation: three things, none a role predicate

1. **The column CHECK.** `org_invitations.role text NOT NULL DEFAULT 'member'
   CHECK (role IN ('owner','admin','member'))` (086:204).
2. **The INSERT policy.** `"Org admins create invitations"` (089:451),
   `WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()))`. Its own
   header states the limit: *"WHAT THIS CONSTRAINS: org_id only. … email, role,
   token and expires_at are theirs to choose."*
3. **The route gate.** `app/api/org/invitations/route.ts` validates the role with
   `isInvitableRole()` — membership in `["owner","admin","member"]` and nothing
   else — then refuses unless the caller is owner or admin. **There is no
   comparison between the caller's role and the role being granted.**

And `accept_org_invitation()` **copies the role verbatim**, deliberately: *"Any
narrower list written here would be a guess at an unmade ruling."*

### So, plainly

**An admin can currently grant `owner`, `admin` or `member`, to any email
address, in their own organization.** Under the ruling that is an admin handing
out billing rights — **and handing out `owner`, a role strictly above their
own.** An owner can grant exactly the same three. There is no capability an
owner has here that an admin does not.

**And `"Org admins remove members"` has no role predicate either.** It constrains
`org_id` only. **So an admin can delete the owner's membership row.** In
combination: an admin can invite a second owner, and an admin can remove the
existing owner.

**One fact bounds all of it:** `org_members` **has no UPDATE policy at all** —
the complete set is two SELECTs, one INSERT and one DELETE. Postgres denies by
default, so **nobody can change an existing member's role through any client.** A
role change today is delete-then-re-invite. The capability map's
`org.member_role_change: admin` (`lib/capabilities.ts:170`) has no code and no
policy behind it.

### RECOMMENDATION — the conservative default, and it is GREG'S RULING TO MAKE

> **An admin may not grant, nor remove, a role at or above their own.**
>
> - An **admin** may invite `member`, and may remove a `member`.
> - An **owner** may invite `owner`, `admin` or `member`, and may remove any of
>   them.

It is conservative in the sense that matters: **it takes away only capabilities
nobody has deliberately been given.** No current interface offers "promote a
colleague to owner" as a feature — the `<select>` at
`team-roster-client.tsx:508` renders all three because `INVITABLE_ROLES` has
three entries, not because anybody ruled that admins should hand out ownership.

**Where it would be enforced, if ruled — three places, and all three are needed:**

1. **`POST /api/org/invitations`** — compare `callerRole` to the requested role.
   Cheap, friendly, and **not sufficient**: the policy still permits the INSERT.
2. **The `"Org admins create invitations"` policy** — a `WITH CHECK` comparing
   the new row's `role` to the caller's. This one CAN be a policy, and the
   contrast with 091 is worth noting: it is a statement about **one row**, the
   row being inserted, so a `WITH CHECK` expresses it fine. 091 needed a trigger
   only because column immutability needs `OLD`.
3. **`"Org admins remove members"`** — a role predicate, so an admin cannot
   delete an owner. This is the half most likely to be forgotten, because the
   escalation reads as an *invitation* problem and half of it is a *deletion*
   problem.

**`accept_org_invitation()` needs no change for this**, and should not get one.
It copies a role off a row that the three enforcement points above have already
constrained. Putting a second, narrower list inside it would be the guess its own
header refuses to make.

**Not designed here, and out of scope for 092 unless Greg rules otherwise.**
Recorded so the ruling is made deliberately rather than discovered by an admin
removing an owner.

---

# 7. OPEN — the rulings 092 is blocked on

| # | Ruling | Who owes it | Blocks |
|---|---|---|---|
| 1 | **Shape A or Shape B.** Flat company plan, or metered seats. | Greg | All of 092. Note Shape A is a strict prefix of Shape B. |
| 2 | **What an unpaid organization does to its members** (section 5), and in particular whether the owner keeps a route to a billing page. | Greg | The gate copy and the read path. Not the migration. |
| 3 | **The role escalation** (section 6). Adopt the conservative default, or rule otherwise. | Greg | Nothing in 092 directly. It becomes urgent the day `COLLEAGUE_INVITATIONS` is switched on. |
| 4 | **Does `organizations.is_paid` mean "entitled" or "entitled AS A LEAD AGENCY"?** Vendor organizations have no entitlement concept at all today, established four ways in the surface doc. One column read by one function either locks every vendor out on the day it defaults to false, or makes the column's name a lie for half the rows. | Greg | The column's name and its default. |
| 5 | **Is the backfill window still open?** (section 0). | A query, not a ruling. | The backfill's correctness. |
