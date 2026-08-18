# M1 foundation, Phase 0: discovery

Branch `feat/m1-foundation`. Read only. No code, no SQL, no migration was written for this
phase. Nothing here was executed against a database.

## How to read the verification claims in this file

Every factual claim carries one of three markers.

- **READ** - I read the source and am reporting what it says.
- **EXECUTED** - I ran a command in this repository and am reporting its output.
- **NOT ESTABLISHED** - I could not settle it here. Every one of these becomes a numbered
  checklist item for Greg rather than a guess.

**No SQL of any kind was run.** Confirmed EXECUTED rather than assumed: `which psql` returns
nothing, and `POSTGRES_PASSWORD`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` and
`POSTGRES_PRISMA_URL` in `.env.production.local` each hold a value two characters long, which
is an empty pair of quotes. There is no working database credential in this environment.

---

## 0a. The judgment calls, restated

Source: `docs/vendor-visibility-report.md` section 4b, plus two calls that section raises
elsewhere and does not number. Restated, not answered. Where the original was vague I have
sharpened it into something a sentence can answer.

### Call 1. Which roles exist beyond owner, and what does each gate?

`org_members.role` is `CHECK (role IN ('owner','admin','member'))` and every live row is
`owner` (READ, 079 PHASE 2 backfill plus the PHASE 12 trigger). `lib/capabilities.ts` maps 89
capabilities to a minimum role and is called at 5 sites, so 84 of the 89 are declared and
unenforced. Three options. **(a) Keep all three roles and adopt the existing map:** the
vocabulary is already written and defensible, and the cost is roughly 60 routes gaining a
`can()` call plus the fact that no default in that map has ever been exercised against a real
second member. **(b) Owner and member only, admin collapsed into owner:** cheaper to ship and
easier to explain, and the cost is concrete - every capability the map currently marks `admin`
(broadcast, award, decline, invite, onboarding) becomes owner-only, so a colleague cannot run
a broadcast, which is close to the reason a second seat exists. **(c) One role, gate nothing:**
free, and a colleague can delete projects, award bids and cancel billing on their first day.
The answerable form: *does a non-owner colleague need to be able to broadcast an RFP and award
a bid on day one, yes or no?* Yes means (a). No means (b).

### Call 2. Can a member invite another member, or only an owner?

The map currently reads `org.member_invite: admin` and `org.member_revoke: owner`. That pairing
is a default nobody has ruled on, and it is asymmetric on purpose: an admin can grow the
organization but not shrink it. Cost of allowing admin invites: an admin can add people, and
therefore raise the bill, without the owner being involved, and there is currently no
notification that would tell the owner it happened. Cost of owner-only: the owner is a
bottleneck on every hire, including their own holidays. The answerable form: *may somebody
other than the owner add a person who costs money?*

### Call 3. What happens to a removed member's created records?

Attribution lives in at least `milestone_events.actor_id` and `partnerships.msa_confirmed_by`
(READ). Both are already `ON DELETE SET NULL`, but that fires on **profile deletion**, not on
removal from an organization - removing a member deletes only the `org_members` row and nothing
else moves (READ, `org_members` cascades from both `organizations` and `profiles`). So today's
behaviour is option (a) by default, not by decision. **(a) Records stay, attribution stays:**
the audit trail keeps naming a person who has left, which is honest and occasionally awkward.
**(b) Records stay, attribution nulls:** the trail survives and loses its subject, so "who
approved this" becomes unanswerable forever. **(c) Reassign to the owner:** the trail stays
complete and becomes false. The answerable form: *when somebody leaves, should the record still
say they did it?*

### Call 4. Which organization does a write belong to, when a user has more than one?

`resolveCallerWriteOrgId()` sorts the caller's memberships owner, then admin, then member, and
takes the first (READ, `lib/entitlements.ts`). It cannot be wrong today because every user has
exactly one membership. **(a) An acting organization carried in session context**, mirroring
`lib/acting-role.ts` and `POST /api/profile/switch-role`. Cost: a column, a switcher in both
layouts, a rule for what happens when the acting organization is one you were just removed
from, and a validation obligation on every request. **(b) Keep highest-role-wins.** Cost: a
user who owns company A and is a member of company B writes every record to A, deterministically,
with no error anywhere. **(c) Require an explicit `orgId` on every write request.** Cost: it
touches every write route and it moves an authorization decision into the client payload, which
this project's own rules forbid. **This run implements (a)** in Phase 2, because (b) is a known
wrong answer and (c) is a prohibited one. The part that still needs Greg is Call 8 below, which
can make the whole question evaporate.

### Call 5. Does a second member change billing, and how is entitlement stored?

The product ruling is already made: billing is per organization and a colleague costs nothing
extra. The ruling is not implemented. `hasAgencyEntitlement()` reads `profiles.is_paid` and
`organizations` has no entitlement column (READ), so **a colleague invited into a paying
organization is not entitled unless their own profile row says so**. Two ways to close it.
**Put `is_paid` on `organizations`:** one migration, an edit to `lib/entitlements.ts`, and a
change to whatever writes billing state; correct, and it touches billing. **Backfill `is_paid`
onto each invited member's profile:** cheap, one line in the accept handler, and wrong the
moment somebody leaves, because their personal profile keeps the entitlement. The answerable
form: *is the paying entity the company or the person?* The product answer is the company; the
question is whether that is worth a billing migration now or a known-wrong shortcut first.

### Call 6. Is a title identity or permission?

No `title` or `job_title` column exists anywhere (EXECUTED: no match in
`supabase/migrations/*.sql`, `scripts/*.sql`, or any `.ts`/`.tsx` file). If a title is
decorative it is one nullable `profiles.title` and nothing reads it for authorization. If it is
expected to gate anything it overlaps `org_members.role`, and two fields that both look like
authority is how a permission model becomes ambiguous. The answerable form: *will anybody ever
ask "can they do X" and get "they are a Senior Producer" as the answer?* This run builds the
decorative reading, because that is what the brief's Phase 3a asks for; Phase 3 states what
changes if Greg rules the other way.

### Call 7. Which organization does a dual-role account act as?

Dual-role accounts exist today. Portal (`profiles.active_role`) and organization are currently
the same choice because one user is one company. Under M1 they separate: a person can be an
agency-side member of A and a vendor-side member of B, and then "switch to the vendor portal"
and "switch to company B" are two different actions that can disagree. The answerable form:
*is the portal toggle a consequence of the organization you are acting as, or an independent
control?* Call 4 and this must be ruled together or the two switchers will contradict each
other.

### Call 8. Can a person belong to two organizations at all?

`org_members` is `UNIQUE(org_id, user_id)`, not `UNIQUE(user_id)`, and its table comment says
dual-role accounts already rely on that (READ). If the ruling is "one company per person", the
constraint should say so, Call 4 evaporates, Call 7 evaporates, and Phase 2 of this run becomes
dead code that costs nothing to leave in place. **This is the cheapest possible answer to Call 4
and it should be considered before the expensive one.** The answerable form: *should one Ligament
login ever be able to act for two different companies?*

### Call 9. What is the entry point for the second member, and is it invitation or domain?

Raised by 4c's estimate table but never stated as a decision. There is no `org_invitations`
table and 079 deliberately did not create one (READ, 079 line 106). Two shapes are already
present in this codebase and they behave differently: a token invitation mailed to one address
(the `partner_rfp_inbox.invite_token` pattern), or domain matching against the signup email
(`rfp_magic_tokens.domain_match_profile_id`, migration 061). The answerable form: *does a
colleague join because somebody mailed them a link, or because they signed up with the company
domain?* The second is how most people expect it to work and it is also how somebody joins a
company they do not work for.

---

## 0b. The M1 surface: what exists, what must be built

Everything in this table is READ from source in this repository or EXECUTED here. Nothing is
read from the live database.

| Thing | State | Where |
|---|---|---|
| `organizations` | **EXISTS.** `id, name, primary_contact_user_id, is_lead_agency, is_vendor, created_at, updated_at` | 079 line 194 |
| `org_members` | **EXISTS.** `id, org_id, user_id, role, invited_by, created_at`, `UNIQUE(org_id, user_id)` | 079 line 250 |
| `org_members.role` | **EXISTS.** `text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member'))` | 079 line 256 |
| Values the role column currently holds | **`owner`, and only `owner` - INFERRED FROM THE WRITERS, not observed live.** There are exactly two writers and both write the literal `'owner'`: the 079 PHASE 2 backfill (`SELECT p.id, p.id, 'owner' FROM public.profiles p`) and the PHASE 12 signup trigger (`VALUES (new_org_id, NEW.id, 'owner')`). **No application code writes `org_members` at all** - EXECUTED grep for insert/update/upsert/delete against that table across `app/`, `lib/`, `components/` and `scripts/` returns nothing. 079's own PHASE 2 verification block asks for `SELECT count(*) FROM public.org_members WHERE role <> 'owner'` and expects 0; that query is checklist step 3 here, because it has not been run in this session | 079 line 366, line 1918 |
| `org_invitations` | **DOES NOT EXIST.** 079 states it deliberately did not create one | 079 line 106 |
| `lib/capabilities.ts` | **EXISTS.** 89 capabilities mapped to a minimum role, 11 of them `org.*` / `billing.*` with no code behind them | `lib/capabilities.ts` |
| `orgRoleFor()` | **EXISTS and hard-codes `"owner"`** for every caller | `lib/capabilities.ts:249` |
| `loadOrgRole()` | **EXISTS, written and deliberately unused.** Does the real `org_members` lookup | `lib/capabilities.ts:281` |
| `lib/acting-role.ts` | **EXISTS.** `active_role` over `role`, flipped by `POST /api/profile/switch-role` | `lib/acting-role.ts` |
| Per-user title or job title | **DOES NOT EXIST.** No column in any migration or script, no reference in any `.ts`/`.tsx` | EXECUTED grep |
| Team roster UI | **DOES NOT EXIST.** `app/agency/settings/` holds `billing`, `profile`, `user` and a page; `app/partner/settings/` holds `user` only | EXECUTED `ls` |
| Org-level entitlement | **DOES NOT EXIST.** `organizations` has no `is_paid`; `hasAgencyEntitlement()` reads `profiles.is_paid` | `lib/entitlements.ts` |

### The blocker nobody has written down: `org_members` is self-row-only

```sql
CREATE POLICY "Members read their own membership row"
  ON public.org_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

(READ, 079 PHASE 11.) That is the **only** SELECT policy on the table.

**A team roster cannot be read with a session client today.** A caller asking "who else is in my
organization" gets back exactly one row, their own, at HTTP 200 with no error. This is the
success-shaped non-event pattern again: the roster would render, it would show one person, and
nothing anywhere would say it had been filtered.

Three ways out, and they are not equal.

1. **A second SELECT policy, `org_id IN (SELECT public.current_user_org_ids())`.** This is a
   widening and it is stated as one. The argument for it: `current_user_org_ids()` is
   `SECURITY DEFINER`, takes no argument, and derives its set from `auth.uid()` alone, so a
   caller cannot ask about an organization it does not belong to. The new predicate is a strict
   superset of the old one (your own membership row always sits in one of your own
   organizations), so no row that was readable stops being readable. And **it returns exactly
   the same rows as today for all 16 legacy accounts and for New Org 1**, because each of those
   organizations has exactly one member. It becomes meaningful only when a second member exists,
   which is the feature. This is what Phase 3 authors, in migration 086.
2. A `SECURITY DEFINER` roster function. Equivalent security, more machinery, and it puts the
   roster rule somewhere other than where every other visibility rule in this schema lives.
3. A service-role API route. Ruled out by the brief: do not add the service role to a route that
   does not already use it.

**One risk I could not clear and will not pretend I did.** Option 1 puts a call to
`current_user_org_ids()` inside a policy **on the very table that function reads**. The standard
Supabase pattern relies on the function owner bypassing RLS on `org_members`, which is true when
the owner owns the table and the table does not have `FORCE ROW LEVEL SECURITY`. 079 relies on
exactly this everywhere else, and it also says the existing self-row policy is safe *because* it
contains no subquery against `org_members`, which reads as caution about this precise case.
If the assumption is wrong the symptom is `42P17 infinite recursion detected in policy`, raised
on **every** read of `org_members` - which is loud, immediate, and reversible by dropping one
policy. It is verified by checklist step 4, before anything else in 086 is trusted.

### Where a colleague list would need to render

Six places, from READ of the current surfaces. Only the first is built in this run.

1. **`/agency/settings/team`** - the roster itself. Does not exist. Phase 3b builds it read only.
2. **`/partner/settings/team`** - the vendor-side mirror. `app/partner/settings/` currently holds
   `user` only. Not built here: the vendor portal has no settings index to hang it off, and
   inventing one is a new surface.
3. **The sidebar identity block** in `components/agency-layout.tsx` and
   `components/partner-layout.tsx` - renders one person's name over one company name today. Under
   M1 this is where "acting as" belongs.
4. **Attribution surfaces** - `milestone_events.actor_id` (table not created; 080 unapplied),
   `partnerships.msa_confirmed_by`, project message senders, delivery reviewers. Each renders a
   user id today and would want a name and a title.
5. **Assignment and onboarding surfaces** - `components/stage-03-onboarding-workflow.tsx` and
   the project detail pages, wherever "sent by" appears.
6. **The counterparty embeds** - the 13 sites behind `ORG_CONTACT_SELECT*` in `lib/org-contact.ts`
   render one organization's designated primary contact. Under M1 a company has several people
   and "who do I talk to" stops being a single answer.

---

## 0c. Two open items from the last run, closed

### `lib/milestone-events.ts`: why 33 lines changed while 080 was unapplied

**Established. It was the branded-type sweep, and it was not only that.** EXECUTED
`git log`/`git show`: the file has exactly two commits. `dbe3fdf` created it (177 lines).
`9408847`, *"refactor: make the id swap a compile error instead of a convention"*, changed it
by 24 insertions and 9 deletions - the 33 in the brief is the sum of both sides of the diff, not
33 changed lines.

The 9 deletions are the branded-type half and nothing else: `orgId: string` became
`orgId: OrgId | null`, `vendorOrgId?: string | null` became `OrgId | null`, and `toRow()` was
narrowed to `MilestoneEvent & { orgId: OrgId }`.

The 24 insertions are a **behavioural** change that the commit message states and the brief did
not carry: `recordMilestones()` now filters out any event whose organization did not resolve and
logs `"[milestone] dropped event(s) with no resolvable organization"`, instead of inserting it.
The reason given is specific - `milestone_events.org_id` has no foreign key by design, so an
unusable id raises nothing and merely writes a breadcrumb that the organization which created it
can never read, because the 080 read policy is `org_id = ANY (current_user_org_ids())`.

**Does the file reference a table 080 has not created?** Yes, one, and it is handled.
`milestone_events` is the only table the file touches (EXECUTED: a single `from("...")` call,
line 168) and it is created by migration 080, which is authored and unapplied. The file already
expects that: it catches PostgREST `42P01` and warns
`"migration 080 is authored and not applied. Event(s) dropped."` **So the module is entirely
inert in production today** - both of its call sites emit events, every insert fails
`42P01`, and every failure is swallowed with a warning. Nothing else in 080 is referenced.

### `partner_rfp_inbox`: what a stale agency-name snapshot looks like

**Established what it would look like. Whether any exist is NOT ESTABLISHED and needs SQL.**

There are two writers of `partner_rfp_inbox.agency_company_name` and they behave differently
(READ).

1. **The standard broadcast**, `app/api/agency/broadcast-rfp/route.ts:148`:
   `agencyDisplay = profile.company_name || profile.full_name || "Lead agency"`, read from the
   **caller's own profiles row**. This never depended on an organization lookup, so 079 did not
   break it. It is nevertheless org-model-wrong: it snapshots the *person's* `company_name`
   rather than `organizations.name`, and those two can diverge the moment either is edited.
2. **The magic-link / Lightning attach**, `lib/magic-token-attach.ts`: before commit `01bbe5a`
   this looked `tokenRow.org_id` up in `profiles`, which returns nothing for any organization
   created after 079, so the fallback fired and the row was stamped with the literal string
   **`Lead agency`**. Permanently, because nothing re-reads the snapshot.

So a stale row looks like exactly one of two things:

- **The hard case.** `agency_company_name = 'Lead agency'` while the row's `lead_org_id` resolves
  to an `organizations` row with a real `name`. Only the magic-link path can produce this, and
  only for an organization created after 079 - which today means **New Org 1 and nothing else**.
- **The soft case.** `agency_company_name` differs from `organizations.name` for the same
  `lead_org_id` for any other reason, which is ordinary snapshot drift after a rename. Note that
  079 backfilled `organizations.name` **from `profiles.company_name`** (READ, PHASE 2), which is
  the same column the broadcast path snapshots from, so for the 16 legacy accounts these two
  values should already agree unless the profile was renamed after a broadcast.

**Checklist item for Greg. Read only. Run in the Supabase SQL editor.**

```sql
-- 0c-1. How many inbox rows carry a name that no longer matches their organization.
SELECT
  count(*)                                                          AS total_rows,
  count(*) FILTER (WHERE i.agency_company_name = 'Lead agency')     AS stamped_literal,
  count(*) FILTER (WHERE i.agency_company_name IS DISTINCT FROM o.name) AS any_drift,
  count(*) FILTER (WHERE o.id IS NULL)                              AS org_row_missing
FROM public.partner_rfp_inbox i
LEFT JOIN public.organizations o ON o.id = i.lead_org_id;
```

Expected, if the Phase 3 fix was the whole story: `stamped_literal` is small and every row it
counts belongs to New Org 1. `any_drift` may exceed `stamped_literal` and the excess is ordinary
rename drift, not this bug. `org_row_missing` should be **0**; anything else means an inbox row
points at an organization that does not exist and is a separate problem.

```sql
-- 0c-2. The rows themselves, so the two classes can be told apart by eye.
SELECT i.id,
       i.lead_org_id,
       i.agency_company_name,
       o.name  AS organization_name,
       (i.master_rfp_json ? '_magic_token') AS came_from_magic_link,
       i.created_at
FROM public.partner_rfp_inbox i
LEFT JOIN public.organizations o ON o.id = i.lead_org_id
WHERE i.agency_company_name IS DISTINCT FROM o.name
ORDER BY i.created_at DESC;
```

`came_from_magic_link = true` together with `agency_company_name = 'Lead agency'` is the bug.
Anything else on that list is drift.

**Repair, only after reading the output of 0c-2 and only for the rows it identifies.** Not run
here, not recommended blind:

```sql
-- 0c-3. DO NOT RUN UNTIL 0c-2 HAS BEEN READ. Repairs only the literal-stamp class.
BEGIN;
UPDATE public.partner_rfp_inbox i
   SET agency_company_name = o.name
  FROM public.organizations o
 WHERE o.id = i.lead_org_id
   AND i.agency_company_name = 'Lead agency'
   AND (i.master_rfp_json ? '_magic_token')
   AND btrim(COALESCE(o.name, '')) <> '';
-- Read the row count. It must equal stamped_literal from 0c-1 restricted to magic-link rows.
COMMIT;  -- or ROLLBACK if the count surprises you
```

---

## What Phase 0 could NOT establish

1. **Whether any `partner_rfp_inbox` row actually carries a stale snapshot.** Query 0c-1 above.
2. **Whether the `org_members` roster policy in migration 086 recurses.** Reasoned to be safe,
   not proved. Checklist step 4.
3. **Whether every organization has a `primary_contact_user_id`.** Carried forward unresolved
   from the previous run. A null means a counterparty sees a company name and no contact.
4. **Every live row count, status distribution and email address.** No SQL was run.
