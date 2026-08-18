# org_invitations: the write policies, one predicate per ruling

**Status: NOTHING HERE IS A MIGRATION.** This document exists so that the session after
Greg's ruling on *who may invite* is a build and not a discovery. Pick one predicate per
operation from the tables below, paste it into a migration, and ship.

**No migration is authored in this pass, deliberately.** Migration 086 created
`public.org_invitations` with a SELECT policy and no write policies precisely because the
shape of an invitation needed no ruling and its authority does. Writing an INSERT policy now
would encode an authorization decision into the one place it is most expensive to change and
least visible to review. That was the right call and this document does not undo it.

Everything below is READ from source in this repository. **Nothing here was executed against
any database.** There are no working database credentials in the authoring environment
(`POSTGRES_URL` and `POSTGRES_PASSWORD` are empty strings, there is no `psql` on PATH and no
pg driver installed). Where a fact needs the live database, it is written as a checklist item
rather than asserted.

---

## 1. What 086 actually created

Read from `supabase/migrations/086_member_identity_and_invitations.sql`.

### 1a. The twelve columns

| # | Column | Type | Null | Default | What it is for |
|---|---|---|---|---|---|
| 1 | `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key. Internal only. It is deliberately **not** the thing in the invitation link: `token` is, so that the link can be rotated without the row identity moving. |
| 2 | `org_id` | `uuid` | NOT NULL | none | The organization being joined. `REFERENCES public.organizations(id) ON DELETE CASCADE` - deleting a company takes its outstanding invitations with it, which is correct, because an invitation to a company that no longer exists is not a thing anybody should be able to accept. |
| 3 | `email` | `text` | NOT NULL | none | The invitee. **Text, not a `profiles` reference**, because the entire point is that they may have no account yet. Matched case-insensitively by index 3 below. |
| 4 | `role` | `text` | NOT NULL | `'member'` | The role granted on accepting. `CHECK (role IN ('owner','admin','member'))`, mirroring `org_members.role` exactly so that if Greg's Call 1 collapses the vocabulary, `'admin'` simply stops being written and no constraint has to move. **This column is an escalation surface - see section 2.4.** |
| 5 | `token` | `text` | NOT NULL | none | The secret in the link. `UNIQUE` across the whole table, so a lookup by token needs no organization context - which is the point, because the person following the link has none. **086 specifies no generator.** Whatever writes this must produce something unguessable; see checklist item C4. |
| 6 | `status` | `text` | NOT NULL | `'pending'` | `CHECK (status IN ('pending','accepted','revoked','expired'))`. **There is no `'declined'`. See section 3.2 - that is a real gap, not a nit.** |
| 7 | `expires_at` | `timestamptz` | NOT NULL | **none** | NOT NULL with no default, deliberately: an invitation that never expires is a credential, and this codebase already learned that from the magic-link tokens. The sender decides the window; the schema insists there is one. **Nothing currently enforces it - see section 3.4.** |
| 8 | `invited_by` | `uuid` | NULL | none | Who sent it. `REFERENCES public.profiles(id) ON DELETE SET NULL`, so deleting a person does not delete the invitations they sent, it anonymises them. Nullable because of that `SET NULL`, not because it is optional at write time. |
| 9 | `accepted_by` | `uuid` | NULL | none | Who accepted. Same reference and same `ON DELETE SET NULL`. Distinct from `email` on purpose: somebody invited at `greg@personal.com` may accept from an account whose email is something else, and both facts are worth keeping. |
| 10 | `accepted_at` | `timestamptz` | NULL | none | When. Null until accepted. |
| 11 | `created_at` | `timestamptz` | NOT NULL | `now()` | Send time. |
| 12 | `updated_at` | `timestamptz` | NOT NULL | `now()` | **Nothing maintains this.** There is no `BEFORE UPDATE` trigger on this table and 086 does not create one, so it holds creation time forever unless every writer sets it by hand. That is the same shape the rest of this schema uses (`updated_at: new Date().toISOString()` written explicitly at each call site), so it is consistent rather than wrong - but it is a convention, not a guarantee. |

### 1b. The four indexes

086's verification block V6 says to expect **three** rows from `pg_indexes`. **That expectation
is wrong and the check will read as a failure when nothing has failed.** `pg_indexes` reports
constraint-backed indexes too, and `token text NOT NULL UNIQUE` creates one. There are four:

| # | Index | Definition | What it enforces |
|---|---|---|---|
| 1 | `org_invitations_pkey` | `UNIQUE btree (id)` | Row identity. Created implicitly by `PRIMARY KEY`. |
| 2 | `org_invitations_token_key` | `UNIQUE btree (token)` | One row per token, platform-wide. This is what makes `WHERE token = $1` a safe lookup with no organization context, and it is what turns a token collision into a `23505` at write time rather than an ambiguous read later. Created implicitly by the `UNIQUE` on the column. **This is the index 086's V6 forgot.** |
| 3 | `org_invitations_one_live_per_email` | `UNIQUE btree (org_id, lower(email)) WHERE status = 'pending'` | **One live invitation per address per organization.** Partial rather than plain, because the history matters: an address invited, declined, and invited again should keep both rows. Postgres enforces this instead of a check-then-insert in a route, which is the pattern that produced the duplicate `partner_rfp_inbox` rows in `LIGAMENT_CONTEXT.md` constraint 5 - two callers 11ms apart, both passing the check. `lower(email)` is what stops `Greg@` and `greg@` being two live invitations to one person. |
| 4 | `org_invitations_org_status_idx` | `btree (org_id, status)` | The read path. `"Org admins read their invitations"` filters on `org_id`, and every list view will filter on `status` next. Not unique, not enforcing anything. |

**Checklist item C1 for Greg:** run 086's V6 and expect **4 rows, not 3**. If it returns 3,
the `UNIQUE` on `token` did not take, and index 2 above does not exist - which would make a
token collision a silent duplicate rather than a `23505`.

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'org_invitations'
ORDER BY indexname;
-- EXPECTED: 4 rows, the four above.
```

### 1c. The one policy that exists

```sql
CREATE POLICY "Org admins read their invitations"
  ON public.org_invitations AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_admin_org_ids()));
```

RLS is enabled. There is **no INSERT, no UPDATE and no DELETE policy**, so Postgres denies all
three by default and the table is read-only to every client role today.

Note what this read policy already implies for section 3: **the invitee cannot read their own
invitation.** They are not an admin of `org_id`; they are usually not a member of it at all.
That is not an oversight to patch casually - it is the whole reason the accept path cannot be
built out of policies alone.

---

## 2. Who may INSERT: three predicates, one per answer

Greg's Call 2, `docs/m1-phase0-discovery.md`: *may somebody other than the owner add a person
who costs money?* The capability map currently reads `org.member_invite: admin` and
`org.member_revoke: owner` (`lib/capabilities.ts` lines 169 and 171, `docs/capabilities.md`
lines 164 and 166). That pairing is a default nobody has ruled on.

`public.current_user_admin_org_ids()` **already exists** and is exactly the owner-or-admin set.
Read from `079_organizations.sql` lines 466-482:

```sql
CREATE OR REPLACE FUNCTION public.current_user_admin_org_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.org_id FROM public.org_members m
  WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin');
$$;
-- REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated;
```

It takes no parameter, so a caller cannot name an organization it does not belong to. Same for
`public.current_user_org_ids()`.

### 2.1 Answer: OWNER ONLY

No helper exists for this set. Two shapes; **prefer (a)**.

**(a) A new helper, matching the family.**

```sql
CREATE OR REPLACE FUNCTION public.current_user_owner_org_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.org_id FROM public.org_members m
  WHERE m.user_id = auth.uid() AND m.role = 'owner';
$$;
REVOKE EXECUTE ON FUNCTION public.current_user_owner_org_ids() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_user_owner_org_ids() TO authenticated;
```

```sql
CREATE POLICY "Org owners create invitations"
  ON public.org_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_owner_org_ids()));
```

**(b) Inline, no new function.** This one works without `SECURITY DEFINER`, and it is worth
knowing why: the subquery is evaluated as the caller, so the `org_members` SELECT policy
applies to it - but that policy is `USING (user_id = auth.uid())` and the subquery filters on
exactly that, so the caller can always read the one row this needs.

```sql
CREATE POLICY "Org owners create invitations"
  ON public.org_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = org_invitations.org_id
      AND m.user_id = auth.uid()
      AND m.role = 'owner'));
```

(a) is preferred: the ownership test will be needed by `org.transfer_ownership` and
`org.delete` too, and one named set beats three hand-copied `EXISTS` clauses that can drift.

### 2.2 Answer: OWNER AND ADMIN

The map's current default. Nothing new is needed.

```sql
CREATE POLICY "Org admins create invitations"
  ON public.org_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()));
```

### 2.3 Answer: ANY MEMBER

```sql
CREATE POLICY "Members create invitations"
  ON public.org_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));
```

**The cost, stated:** under this answer, combined with section 2.4 left unaddressed, any member
can invite anybody at any role including `owner`. That is not an argument against the ruling -
it is an argument that 2.4 is not optional under this ruling.

### 2.4 WHATEVER THE ANSWER: THE PREDICATE ABOVE IS NOT SUFFICIENT ON ITS OWN

This is the same defect this run just closed on `public.partnerships`, and it will arrive here
by the same route if nobody says so. `"Agencies can create partnerships"` constrained
`lead_org_id` and **said nothing about any other column**, which turned a partnership insert
into a read of another company's commercial terms. See migration 087 and
`docs/m1-cleanup-report.md`.

Every predicate in 2.1 to 2.3 constrains `org_id` and nothing else. Three other columns on this
table are load-bearing and a client supplies all of them:

| Column | If unconstrained | Add to the `WITH CHECK` |
|---|---|---|
| `role` | **PRIVILEGE ESCALATION, and it is the sharp one.** A member or admin mints an invitation at `role = 'owner'`, to their own second email address, accepts it, and is now an owner. Every `owner`-gated capability follows: `org.delete`, `billing.cancel`, `org.transfer_ownership`. | Under owner-only: nothing needed, an owner may already grant anything. Under admin: `AND role <> 'owner'`. Under any-member: `AND role = 'member'`. |
| `status` | An insert lands directly at `'accepted'` with an `accepted_by` of the writer's choosing, skipping the accept path and every check in it. | `AND status = 'pending'` |
| `invited_by` | The audit trail is writable by the person it audits. Somebody else's name on the invitation you sent. | `AND invited_by = auth.uid()` |

`expires_at` is NOT NULL with no default, so it cannot be silently omitted - but it can be set
to the year 3000. Whether to bound it (`AND expires_at <= now() + interval '30 days'`) is a
product decision, not a security one; note that a policy predicate may call `now()` freely,
unlike an index predicate.

**The recommended full shape, for the admin ruling:**

```sql
CREATE POLICY "Org admins create invitations"
  ON public.org_invitations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    org_id     IN (SELECT public.current_user_admin_org_ids())
    AND role   <> 'owner'
    AND status =  'pending'
    AND invited_by = auth.uid()
  );
```

Written by **inclusion**, not exclusion. Migration 085 chose exclusion and was right to, because
it was building a VISIBILITY set where showing one row too many is the safe direction. This is
an AUTHORITY predicate. The safe direction is the other one: an unanticipated shape must be
refused, loudly, not admitted.

---

## 3. UPDATE and DELETE: the actor is different in every case

Three things can happen to a pending invitation, and **they do not share an actor**. This is
the part that cannot be answered by picking one predicate.

| Operation | Who acts | Are they a member of `org_id`? | Can a membership predicate authorize it? |
|---|---|---|---|
| **Revoke** | The sending organization | Yes | **Yes.** Section 3.1. |
| **Accept** | The invitee | **No, by definition** | **No.** Section 3.3. |
| **Decline** | The invitee | **No, by definition** | **No.** Section 3.2 and 3.3. |
| **Expire** | Nobody. Time. | n/a | **No.** Section 3.4. |

### 3.1 REVOKE - the only one a policy can do on its own

Actor: somebody at the sending organization. `status` moves `'pending'` -> `'revoked'`.

`org.member_revoke` currently defaults to `owner` while `org.member_invite` defaults to
`admin`, and `docs/capabilities.md` calls that asymmetry deliberate: an admin can grow the
organization but not shrink it. **Revoking an unaccepted invitation is not the same act as
revoking a member's access.** Nobody has gained anything yet, nothing is orphaned, and the
sender can simply invite again. It reads much closer to `org.member_invite` than to
`org.member_revoke`, and a defensible rule is *whoever may send one may withdraw one*, i.e.
the revoke predicate matches the section 2 answer.

```sql
-- Substitute the section 2 answer's helper for current_user_admin_org_ids().
CREATE POLICY "Org admins revoke their invitations"
  ON public.org_invitations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    org_id     IN (SELECT public.current_user_admin_org_ids())
    AND status =  'pending'
  )
  WITH CHECK (
    -- org_id REPEATED IN THE WITH CHECK ON PURPOSE. Without it the revoker can rewrite
    -- org_id and move the invitation to a company they do not belong to. That is exactly
    -- the omission 079 left on "Agencies can update their partnerships", which migration
    -- 087 had to close with a trigger. Do not repeat it here.
    org_id     IN (SELECT public.current_user_admin_org_ids())
    AND status =  'revoked'
  );
```

`USING (status = 'pending')` is what stops an already-accepted invitation being retroactively
revoked, which would leave a live `org_members` row with no record of why it exists. Revoking
access is a separate act on a separate table.

**What a policy still cannot express here:** `email`, `role` and `token` should be immutable
once the row exists, and `WITH CHECK` sees only the new row, so it cannot say "unchanged". If
that matters, it is a `BEFORE UPDATE` trigger, not a policy - the same reasoning and the same
shape as `partnerships_guard_identity_columns()` in migration 087.

### 3.2 DECLINE - and the vocabulary has no word for it

`status` is `CHECK (status IN ('pending','accepted','revoked','expired'))`. **There is no
`'declined'`.** So a decline today has to be recorded as one of:

- **`'revoked'`.** Free, and wrong: `'revoked'` means the sender withdrew the offer. Collapsing
  the two makes it impossible to tell "we changed our mind" from "they said no", which is
  exactly the distinction anybody looking at this list wants.
- **`'expired'`.** Worse. It asserts a time-based fact that did not happen.
- **Widen the CHECK to add `'declined'`.** One `ALTER TABLE ... DROP CONSTRAINT` plus one
  `ADD CONSTRAINT`, cheap now while the table is empty, and it keeps
  `org_invitations_one_live_per_email` behaving as 086 intended: a declined invitation stops
  being `'pending'`, so the address can be invited again, and both rows survive as history.

**Recommendation: widen the CHECK, in the same migration that adds the write policies.** The
table has no rows yet, so it costs nothing now and is a data migration later.

**Checklist item C2 for Greg:** confirm the table is still empty before assuming that.

```sql
SELECT count(*) FROM public.org_invitations;
-- EXPECTED: 0. It has no write policy, so this should be 0 unless something ran as postgres.
```

### 3.3 ACCEPT - the asymmetry, stated plainly

**The person accepting an invitation is not a member of the organization. That is what an
invitation is for.** So:

1. No membership-derived predicate can authorize the accept. `current_user_org_ids()` and
   `current_user_admin_org_ids()` both return nothing for them, on that organization.
2. **They cannot even read the invitation.** The only SELECT policy is
   `"Org admins read their invitations"`. An invitee following a link has no way to see the
   row it points at.
3. **And this is the decisive one: the accept is not one write, it is two.** It must flip
   `org_invitations.status` to `'accepted'` *and* insert a row into `public.org_members`. The
   only INSERT policy on `org_members` is `"Org admins add members"`,
   `WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()))` (079 lines 1740-1742).
   The invitee is not an admin of that organization. **So no combination of policies on
   `org_invitations` can produce a working accept.** Adding an UPDATE policy for the invitee
   would produce a half-accept: the invitation flips to `'accepted'` and no membership is
   created, at HTTP 200, with no error - the success-shaped non-event this codebase has been
   bitten by five separate times.

**The token is the credential, and it has to be, because it is the only thing the invitee
holds.** `org_invitations_token_key` makes a lookup by token alone unambiguous with no
organization context, which is exactly what a person who has no organization context needs.

#### What the accept path must therefore be

Two shapes. **Prefer (A).**

**(A) A `SECURITY DEFINER` function keyed on the token.** The table keeps zero write policies
for the invitee, and the function is the only door.

```sql
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_token text)
RETURNS uuid                      -- the org_members.id created, or raises
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv public.org_invitations%ROWTYPE;
  new_member_id uuid;
BEGIN
  -- THE ACTOR COMES FROM THE JWT AND NEVER FROM A PARAMETER. There is deliberately no
  -- p_user_id argument: a function that accepts one is one refactor away from trusting one.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO inv FROM public.org_invitations WHERE token = p_token FOR UPDATE;

  -- ONE MESSAGE FOR EVERY REFUSAL. Distinguishing "no such token" from "already accepted"
  -- turns this function into a token oracle.
  IF NOT FOUND
     OR inv.status <> 'pending'
     OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation is not valid' USING ERRCODE = '42501';
  END IF;

  -- <<< THE EMAIL-MATCH RULING GOES HERE. See "the sub-ruling" below. >>>

  INSERT INTO public.org_members (org_id, user_id, role, invited_by)
  VALUES (inv.org_id, auth.uid(), inv.role, inv.invited_by)
  ON CONFLICT (org_id, user_id) DO NOTHING
  RETURNING id INTO new_member_id;

  UPDATE public.org_invitations
     SET status = 'accepted', accepted_by = auth.uid(),
         accepted_at = now(), updated_at = now()
   WHERE id = inv.id;

  RETURN new_member_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_org_invitation(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.accept_org_invitation(text) TO authenticated;
```

**WHICH ROLE THIS RUNS AS, and what follows from that.** `SECURITY DEFINER` means the body
executes as the function's **owner** - in Supabase, `postgres`. A table owner bypasses RLS on
their own tables unless `FORCE ROW LEVEL SECURITY` is set. So inside this body:

- The `org_invitations` SELECT is **not** filtered by `"Org admins read their invitations"`.
  That is the point: it is how the invitee reads a row they have no policy for.
- The `org_members` INSERT is **not** checked against `"Org admins add members"`. Also the
  point, and also the danger: **this function is the entire authorization boundary for
  joining an organization.** Everything the policies would have done, it must do itself. That
  is why the checks above are explicit and why the actor is `auth.uid()` and never an
  argument.
- It must be `REVOKE`d from `PUBLIC` and `GRANT`ed to `authenticated`, matching every other
  helper in this schema, so an anon request is refused rather than reaching the body.
- `SET search_path = public, pg_temp` is not decoration. Without it a `SECURITY DEFINER`
  function is a schema-shadowing vector. Every helper 079 and 085 created sets it; this must
  too.
- `FOR UPDATE` on the select is what makes a double-click one membership instead of two. The
  `ON CONFLICT (org_id, user_id) DO NOTHING` is the belt to that braces. It relies on
  `org_members_org_user_unique UNIQUE (org_id, user_id)`, READ from `079_organizations.sql`
  line 260 - **checklist item C3 confirms it applied, because `ON CONFLICT` naming a
  constraint that does not exist is a runtime error, not a no-op.**

**(B) A service-role route.** `app/api/org/invitations/accept/route.ts` using
`SUPABASE_SERVICE_ROLE_KEY`, doing the same checks in TypeScript.

Cheaper to read and to test, and this codebase already does it for guest flows. The costs are
real: the service role bypasses RLS on **every** table, not just these two, so a bug in that
route is unbounded rather than bounded by the function's body; and the check lives in
application code, where the next caller of the same table is not obliged to repeat it. (A)
puts the rule where the data is. Prefer (A) unless the accept needs to do something SQL cannot,
such as sending the welcome email - and that can be a route calling the function.

#### The sub-ruling inside the accept: does the email have to match?

This is a second decision and it is smaller than Call 2 but it is not free.

- **Token alone is sufficient.** How most invitation links work. A forwarded link lets somebody
  the owner never intended join the company, at whatever `role` the invitation carries.
- **Token plus email match** - `lower(btrim(inv.email)) = lower(btrim(<caller's profiles.email>))`.
  Strictly safer. It breaks the ordinary case where somebody is invited at `greg@personal.com`
  and signs up with `greg@work.com`, and the failure is opaque to them.
- **Token plus a domain match on the invitee's email.** This is Greg's Call 9's other shape
  (`rfp_magic_tokens.domain_match_profile_id`, migration 061) arriving as a softener rather
  than as the entry point.

Whichever is chosen, it belongs at the marked line in the function above, so that there is
exactly one place it is enforced.

#### Decline, in the same shape

Decline has the same actor problem and takes the same solution: a second
`SECURITY DEFINER` function, `public.decline_org_invitation(p_token text)`, identical minus the
`org_members` insert, setting `status` to whatever section 3.2 resolves. It must **not** be an
UPDATE policy on the table, for the same reason: the invitee cannot read the row to find it,
and a policy keyed on their email would be a second authorization rule in a second place.

### 3.4 EXPIRE - nobody is the actor, and nothing runs

`'expired'` is in the `CHECK` and **nothing sets it**. There is no scheduled job in this
repository that touches this table. So an invitation whose `expires_at` has passed stays
`'pending'` forever, and because `org_invitations_one_live_per_email` is
`WHERE status = 'pending'`, **that dead invitation permanently blocks re-inviting the same
address to the same organization.** The second invitation fails with `23505` and the sender
gets a duplicate-key error about an invitation that expired months ago.

Three ways out, in ascending cost:

1. **Treat `expires_at` as the truth and `'expired'` as cosmetic.** The accept function already
   refuses on `expires_at <= now()`, so an expired invitation is inert. Add
   `... WHERE status = 'pending' AND expires_at > now()` to the *re-invite* path instead of to
   the index, and let a re-invite `UPDATE` the stale row rather than inserting beside it.
2. **A sweep.** `UPDATE org_invitations SET status = 'expired' WHERE status = 'pending' AND
   expires_at <= now()`, on a Vercel cron. Correct, and it is a new moving part with its own
   failure mode - and a cron that stops running is a silent one.
3. **Put it in the index.** *This one does not work and is written down so nobody tries it:*
   `WHERE status = 'pending' AND expires_at > now()` is rejected, because a partial index
   predicate must be `IMMUTABLE` and `now()` is `STABLE`. Postgres raises "functions in index
   predicate must be marked IMMUTABLE".

**Recommendation: (1).** It adds nothing that can stop running.

### 3.5 DELETE - recommend no policy at all

All three predicates, for completeness:

```sql
-- owner only
USING (org_id IN (SELECT public.current_user_owner_org_ids()))
-- owner and admin
USING (org_id IN (SELECT public.current_user_admin_org_ids()))
-- any member
USING (org_id IN (SELECT public.current_user_org_ids()))
```

**But the recommendation is to add none of them.** An invitation row is the record of an
authorization decision. Revoking is a status change and keeps that record; deleting destroys
it, and it also defeats what `org_invitations_one_live_per_email` was built for - 086's own
comment says "an address that was invited, declined, and invited again should keep both rows".
With no DELETE policy, Postgres denies by default and rows leave only through
`ON DELETE CASCADE` from `organizations`, which is the one case where keeping them is
meaningless. If a purge is ever needed it can be a `postgres`-side statement, which is a
deliberate act rather than a button.

---

## 4. The whole thing, as a decision sheet

Fill in the right-hand column, then write the migration.

| # | Decision | Options | Where it lands |
|---|---|---|---|
| 1 | Who may INSERT | owner / owner+admin / any member | Section 2.1, 2.2 or 2.3 |
| 2 | Cap on invited `role` | none / `<> 'owner'` / `= 'member'` | Section 2.4, into the same `WITH CHECK` |
| 3 | Who may revoke | same as 1 / owner only | Section 3.1 |
| 4 | Add `'declined'` to the status CHECK | yes / reuse `'revoked'` | Section 3.2 |
| 5 | Accept path | `SECURITY DEFINER` function / service-role route | Section 3.3 (A) or (B) |
| 6 | Email match on accept | token only / exact email / domain | Section 3.3, the marked line |
| 7 | Expiry handling | inert + re-invite updates / cron sweep | Section 3.4 |
| 8 | DELETE policy | none / one of three | Section 3.5, recommend none |

### The migration this becomes

One file, one `BEGIN`, one `COMMIT`, a matching `_down.sql`, a stop-gate header, a pre-flight
capture and a verification block with expected values stated - the shape 085 and 087 use, and
**not** the shape 086 used, which shipped with no transaction control at all so that the
dry-run procedure silently did nothing.

Its contents, given the decision sheet:

1. `current_user_owner_org_ids()` if decision 1 or 3 is owner-only.
2. The status `CHECK` widened if decision 4 is yes.
3. One INSERT policy, with the section 2.4 columns pinned.
4. One UPDATE policy for revoke, with `org_id` repeated in the `WITH CHECK`.
5. `accept_org_invitation(text)` and `decline_org_invitation(text)`, if decision 5 is (A).
6. No DELETE policy, if decision 8 is the recommendation.
7. Optionally a `BEFORE UPDATE` trigger pinning `email`, `role`, `token` and `org_id`, which is
   the only way to express immutability - see migration 087 for the pattern and for why a
   policy cannot do it.

### Checklist for Greg: four queries this document could not run

| # | Query | Expected | Why it matters |
|---|---|---|---|
| C1 | `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='org_invitations' ORDER BY indexname;` | **4 rows.** 086's V6 says 3 and is wrong. | If `org_invitations_token_key` is absent, a token collision is a silent duplicate instead of a `23505`. |
| C2 | `SELECT count(*) FROM public.org_invitations;` | 0 | Decision 4 is free while the table is empty and a data migration afterwards. |
| C3 | `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.org_members'::regclass AND contype='u';` | 1 row, `org_members_org_user_unique UNIQUE (org_id, user_id)` | `ON CONFLICT (org_id, user_id)` in the accept function is a runtime error if this constraint does not exist. READ from `079_organizations.sql` line 260, so this is a confirmation that 079 applied as written rather than an open question. |
| C4 | `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='org_invitations';` | Exactly 1 row, `"Org admins read their invitations"`, SELECT | More than one means a write policy was added out of band, and the deny-by-default this document assumes is no longer true. |

**One thing 086 leaves entirely open and no query can answer:** it specifies no generator for
`token`. Whatever writes the first invitation decides how unguessable the credential is. It
should be at least 128 bits from a CSPRNG (`gen_random_bytes(16)` encoded, or `crypto.randomUUID()`
in the route), and it must not be derived from `id`, `email` or `created_at`.
