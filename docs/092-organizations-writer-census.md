# The `public.organizations` writer census

**READ-ONLY. No code was edited to produce this file and no database was
queried.** Every row is a grep or a read of a file in this repository, and every
one is re-runnable — the commands are at the foot.

**WHY IT EXISTS.** OPEN-092-4 is resolved: 092's guard becomes a **permit list**
rather than a deny list. **A permit list cannot be derived from a guess.** Getting
one entry short does not fail a build — it breaks a write in production on the day
the migration is applied. So the list is derived from this census, and 092's header
quotes the line here that justifies every entry.

---

# 0. THE RULING THIS SERVES, AND WHY THE SHAPE INVERTS

**091 used a deny list on `profiles` and the count was the whole argument. On
`organizations` the count runs the other way, and so does the argument about the
future.**

| | `profiles` (091) | `organizations` (092) |
|---|---|---|
| Columns | 44 | **8** (7 + `is_paid`) |
| Ordinary user-editable content | 37, across 24 session write sites | **1** — `name` |
| Permit list would be | 37 entries, **one omission silently breaks a settings save** | **1 entry** |
| Deny list would be | 5 entries | 1 entry, **and every future column unguarded** |
| **What the NEXT column is likely to be** | more profile content — `bio`, a preference, a contact field | **AUTHORITY-SHAPED: plan tier, seat limit, billing customer id** |
| Failure mode of the wrong choice | a save breaks, loudly, at development time | **a privilege column ships self-grantable, silently** |

**That last row is the ruling.** On `profiles`, a permit list's failure mode is a
broken save and a deny list's is an unguarded privilege column — and adding `bio`
is not a deliberate act while adding a privilege column is, so the deny list's
risk was the smaller one. **On `organizations` every plausible future column is
authority-shaped**, so a deny list leaves each one unguarded until somebody
remembers, and "somebody remembers" is not a mechanism.

> **A permit list guards them BY DEFAULT, and its failure mode is a write that
> FAILS LOUDLY rather than a hole that opens silently.**

---

# 1. EVERY WRITER OF `public.organizations`, ANYWHERE

**Five. Two in application code, one in a library, two in SQL.** The search
covered `app/`, `lib/`, `components/`, `contexts/`, `hooks/`, `scripts/`,
`types/` and `supabase/`, for `.update(`, `.insert(`, `.upsert(`, `.delete(`
against the table, and for `INSERT INTO` / `UPDATE` / `DELETE FROM` in every
`.sql` file including down files.

| # | File:line | Operation | Client | **Columns written, enumerated** |
|---|---|---|---|---|
| **W1** | `lib/company-identity.ts:306` | `UPDATE` | **SESSION** | **`name`** — and nothing else, **not even `updated_at`** |
| **W2** | `app/api/admin/users/[userId]/flags/route.ts:159` | `UPDATE` | **SERVICE ROLE** | `is_paid`, `updated_at` |
| **W3** | `app/api/admin/grant-access/route.ts:193` | `UPDATE` | **SERVICE ROLE** | `is_paid`, `updated_at` |
| **W4** | `supabase/migrations/079_organizations.sql:322` (PHASE 2 backfill) | `INSERT` | **MIGRATION** | `id`, `name`, `primary_contact_user_id`, `is_lead_agency`, `is_vendor`, `created_at` |
| **W5** | `supabase/migrations/079_organizations.sql:1913` (`handle_new_user`) | `INSERT` | **TRIGGER**, `SECURITY DEFINER`, fires from `AFTER INSERT ON auth.users` | `name`, `primary_contact_user_id`, `is_lead_agency`, `is_vendor` |
| *(W6)* | `supabase/migrations/092_org_entitlement.sql:580` | `UPDATE` | **MIGRATION** | `is_paid`, `updated_at` — *092's own backfill, listed for completeness; it runs before the guard exists* |

**There is no sixth.** Verbatim, so each can be checked:

```ts
// W1  lib/company-identity.ts:305-309   THE ONLY SESSION-CLIENT WRITER IN THE PRODUCT
const { data: orgRows, error: orgError } = await client
  .from("organizations")
  .update({ name })
  .eq("id", acting.orgId)
  .select("id, name")
```

```ts
// W2  app/api/admin/users/[userId]/flags/route.ts:157-161   service role
const { data: orgRows, error: orgError } = await service
  .from("organizations")
  .update({ is_paid: isPaid, updated_at: new Date().toISOString() })
  .eq("id", orgId)
  .select("id, is_paid")
```

```ts
// W3  app/api/admin/grant-access/route.ts:191-195   service role
const { data: orgRows, error: updateError } = await supabase
  .from("organizations")
  .update({ is_paid: true, updated_at: new Date().toISOString() })
  .eq("id", orgId)
  .select("id")
```

```sql
-- W4  079_organizations.sql:322   PHASE 2, the backfill. Comments stripped.
INSERT INTO public.organizations (id, name, primary_contact_user_id,
                                  is_lead_agency, is_vendor, created_at)
SELECT
  p.id,
  COALESCE(NULLIF(btrim(p.company_name), ''), NULLIF(btrim(p.full_name), ''),
           NULLIF(split_part(COALESCE(p.email, ''), '@', 1), ''), 'Untitled organization'),
  p.id,
  (p.role IS DISTINCT FROM 'partner'),
  (p.role = 'partner'),
  COALESCE(p.created_at, now())
FROM public.profiles p
ON CONFLICT (id) DO NOTHING;
```

```sql
-- W5  079_organizations.sql:1913   PHASE 12, inside handle_new_user()
INSERT INTO public.organizations (name, primary_contact_user_id,
                                  is_lead_agency, is_vendor)
VALUES (org_name, NEW.id, chosen_role = 'agency', chosen_role = 'partner')
RETURNING id INTO new_org_id;
```

## What is NOT a writer, checked rather than assumed

- **No `DELETE` of `organizations` exists anywhere.** Not in application code, not
  in any migration, not in any down file.
- **`handle_new_user` is the ONLY database function that writes this table.** All
  twenty functions in the migration set were enumerated by name and the write
  grep over `supabase/` returns exactly the three statements above.
- **No `.rpc()` call in the application reaches a writer of this table.** The six
  RPCs the app calls are `accept_org_invitation`, `decline_org_invitation`,
  `org_has_member_with_email`, `partner_vouch_count`, `partner_vouch_counts` and
  `set_active_org`. `accept_org_invitation` writes `org_invitations`,
  `org_members` and `profiles`; `set_active_org` writes `profiles`. **Neither
  writes `organizations`, and neither must ever start** — both are called by a
  session client, so a `SECURITY DEFINER` body keeps that session's `auth.uid()`
  and the guard would refuse them.
- **The twenty-odd remaining `.from("organizations")` sites are READS** — name and
  contact lookups in the dashboards, the switcher, the invitation route and
  `lib/entitlements.ts:533`. Reads are not this census's subject and no guard
  touches them.

---

# 2. THE GAP TABLE — every column, and who touches it

**All eight columns are ACCOUNTED FOR. There are ZERO UNACCOUNTED columns.**

| Column | Session writer | Service-role writer | Migration / trigger writer | Status |
|---|---|---|---|---|
| `id` | — | — | **W4** (explicit `p.id`); W5 omits it and takes `DEFAULT gen_random_uuid()` | **ACCOUNTED** |
| `name` | **W1** | — | W4, W5 | **ACCOUNTED** |
| `primary_contact_user_id` | — | — | W4, W5 | **ACCOUNTED** |
| `is_lead_agency` | — | — | W4, W5 | **ACCOUNTED** |
| `is_vendor` | — | — | W4, W5 | **ACCOUNTED** |
| `created_at` | — | — | **W4** (explicit); W5 omits it and takes `DEFAULT now()` | **ACCOUNTED** |
| `updated_at` | **— NONE. See below.** | W2, W3 | W6 | **ACCOUNTED** |
| `is_paid` | — | W2, W3 | W6 | **ACCOUNTED** |

> **THE GAP TABLE IS EMPTY.** Every column has at least one identified writer, so
> the permit list can be derived without guessing at anything. **Had a single
> column been UNACCOUNTED, this census would have stopped here and 092 would not
> have been edited** — an unaccounted column on a permit list is a production
> breakage on apply, not a build failure.

## The one row worth staring at: `updated_at`

**`updated_at` HAS WRITERS BUT NO SESSION-CLIENT WRITER, AND THAT IS THE WHOLE
REASON IT IS NOT ON THE PERMIT LIST.**

W2, W3 and W6 stamp it, and all three are exempt by `auth.uid() IS NULL` — service
role and migration. **W1, the one session write in the product, writes `{ name }`
and nothing else.** That is not an inference: it is the object literal, quoted
above.

> **>>> THE TRIPWIRE. IF `lib/company-identity.ts:306` EVER ADDS `updated_at` — OR
> >>> ANY OTHER COLUMN — TO THAT `.update({ name })`, THAT COLUMN MUST JOIN THE
> >>> PERMIT LIST IN THE SAME COMMIT, or every company rename in the product
> >>> starts raising LG008.**
>
> This is the permit list's failure mode, and it is the one it was chosen for: it
> is **loud**, it lands at **development time**, and the fix is one word. Compare
> the deny list's failure mode, which is a privilege column shipping
> self-grantable with nothing anywhere reporting it.

**There is no `updated_at` auto-stamp trigger on this table** — `organizations`
carries no trigger at all before 092. So nothing stamps it implicitly and the
census above is the complete picture.

---

# 3. THE PERMIT LIST THIS CENSUS YIELDS

**A column belongs on the list only if a SESSION-CLIENT writer legitimately
writes it.** Applying that rule to the table above:

```
  PERMITTED:  name
```

**One entry, derived from exactly one census row: W1, `lib/company-identity.ts:306`.**

### `is_paid` IS NOT ON THE LIST, AND A MECHANICAL DERIVATION WOULD HAVE PUT IT THERE

W2 and W3 write it, so a script that asked "does anything write this column"
would have permitted it — **and that would delete the entire point of migration
092.**

**EXEMPT IS NOT THE SAME AS PERMITTED, and the distinction is the design.** Both
routes use the **service role**, so `auth.uid()` is NULL and they pass the
exemption test **before the permit list is ever consulted**. They never need to be
on it. Putting them on it would additionally permit a **browser** to write the
column — and the browser is the entire threat model, because every user is an
owner of their own organization and the UPDATE policy therefore authorises them to
write their own row.

**The same reasoning excludes `updated_at`, `is_lead_agency`, `is_vendor`,
`primary_contact_user_id`, `created_at` and `id`:** each is written only by an
exempt writer, or by no writer at all.

---

# 4. HOW TO RE-RUN THIS CENSUS

```bash
# Every reference to the table in application code
grep -rn '"organizations"' app/ lib/ components/ contexts/ hooks/ scripts/ types/

# Narrow to writes: a .update/.insert/.upsert/.delete within four lines of the .from
for f in $(grep -rln '"organizations"' app/ lib/ components/ contexts/ hooks/ scripts/ types/); do
  awk -v F="$f" '/from\(["'"'"']organizations["'"'"']\)/ {h=NR}
    h && NR>=h && NR<=h+4 && /\.(update|insert|upsert|delete)\(/ {print F":"NR"  "$0}' "$f"
done
# EXPECTED: exactly three hits - W1, W2, W3.

# Every SQL write, including down files
grep -rniE "insert into[[:space:]]+public\.organizations|update[[:space:]]+public\.organizations|delete from[[:space:]]+public\.organizations" supabase/
# EXPECTED: 079:322 (W4), 079:1913 (W5), 092:580 (W6). Nothing in any down file.

# Confirm no other function writes it
grep -rhoE "CREATE OR REPLACE FUNCTION public\.[a-z_]+" supabase/migrations/*.sql | sort -u
```

**And the one query that would settle it against the live database, which this
session could not run:**

```sql
-- Nothing in the repository can prove a column is unwritten in production.
-- This shows which organizations rows have ever been touched after creation.
SELECT count(*) FILTER (WHERE updated_at > created_at) AS ever_updated,
       count(*)                                        AS total
FROM public.organizations;
-- A row with updated_at > created_at was written by W1, W2 or W3.
-- EXPECTED before 092 is applied: a small number, from company renames.
-- AFTER 092: all of them, because the backfill stamps updated_at.
```
