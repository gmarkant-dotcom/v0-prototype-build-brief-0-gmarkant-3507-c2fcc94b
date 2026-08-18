# Generated database types: scoped assessment

**Recommendation only. Nothing here is implemented, and nothing here should be
implemented on this branch.** Requested as Phase 4d of the 079 hardening run.

Yesterday's release report argued the permanent fix for the org-id-versus-user-id
class is generated database types rather than a fifth grep script. This is the
scoped version of that argument, with the numbers measured rather than asserted.

---

## What the problem actually is

`.eq("agency_id", user.id)` is two untyped strings and one `any`. Measured in
this repository on 2026-08-18:

| Fact | Count |
|---|---|
| Files constructing a Supabase client | 132 |
| Distinct tables reached by `.from()` in app/ and lib/ | 40 |
| `.eq("<column>", ...)` call sites with a bare string column name | 497 |
| Places already carrying a hand-written `{ from: (table: string) => any }` client type to dodge TS2589 | 3 (`lib/entitlements.ts`, `lib/capabilities.ts`, `lib/vouch-counts.ts`) |

`lib/supabase/client.ts` calls `createBrowserClient(url, key, opts)` with no type
parameter. Without one, `@supabase/supabase-js` v2 falls back to a permissive
default schema: the column-name argument is `string`, and every returned row is
effectively `any`. So `tsc` has nothing to check. It cannot know that `org_id`
holds an `organizations.id` and `user.id` holds a `profiles.id`, because as far
as the compiler is concerned both are `string`.

That is why five successive scripts have been needed to find by text what a type
system finds by construction, and why each one was blind to the class the
previous one missed.

---

## What generating types would require

1. **Generate the schema types.**
   `npx supabase gen types typescript --project-id <ref> > lib/supabase/types.ts`
   against the live project. Read-only. Produces one file, roughly 2,000 to
   4,000 lines for 40 tables.

2. **Parameterize the three client factories.**
   `createBrowserClient<Database>(...)` in `lib/supabase/client.ts`,
   `createServerClient<Database>(...)` in `lib/supabase/server.ts`, and the
   service-role client. Three lines.

3. **Absorb the fallout.** This is the whole cost and it is not three lines. Every
   `.from()` result stops being `any`. Roughly 500 filter sites and every
   destructure of a query result get real types at once, and the codebase has
   been written for years against `any`: `(data as { id: string } | null)`,
   `as unknown as MagicTokenForAttach[]`, `Record<string, unknown>` insert
   payloads. Some of those casts will now be wrong rather than merely
   unnecessary, and each is a real read.

4. **Deal with TS2589.** Three files already carry a hand-written loose client
   type *because* naming the real builder type reaches "type instantiation is
   excessively deep". Generated types make that error more likely, not less, on
   the deeply nested embed selects this codebase uses (the four-level embed in
   `app/api/projects/route.ts` is the worst case). Expect to need explicit return
   annotations, or `.returns<T>()`, at the embed-heavy sites.

5. **Keep them current.** A generated file that drifts from the database is worse
   than none, because it type-checks against a schema that no longer exists.
   Regeneration has to be a step in the migration sequence in `CLAUDE.md`, right
   after "confirm Success. No rows returned".

---

## What it would catch that no script can

This is the part that matters, and it is genuinely large.

- **The parameter-passing class, entirely.** 21 helpers in `lib/` filter or write
  an organization column from a parameter. 19 call sites pass a user id into one.
  No line-based matcher can see them because the defect is a stack frame away
  from the column name. A typed `agencyId: OrgId` would fail every one at the
  call site.
- **Aliasing.** `const agencyId = user.id` defeated both the 188-site
  measurement and the 230-site re-measurement. Two whole route files
  (`app/api/agency/dashboard`, `app/api/partner/dashboard`) hid there and were
  found only by teaching the guard one level of alias resolution during this run.
  A type follows the alias for free.
- **Misspelled and stale column names**, which is what
  `scripts/check-identity-columns.mjs` exists for.
- **Wrong-shaped insert payloads**, which is what caused the 23502 in
  `lib/magic-token-attach.ts`.

**But it would NOT catch the actual 079 bug on its own, and this is the crucial
qualifier.** `organizations.id` and `profiles.id` are both `string` in generated
types. `.eq("org_id", user.id)` type-checks perfectly against them. To make the
compiler reject it you need **branded types** on top of generation:

```ts
type OrgId  = string & { readonly __brand: "organizations.id" }
type UserId = string & { readonly __brand: "profiles.id" }
```

and then a hand-maintained mapping from column to brand, because
`supabase gen types` emits neither. That is a second project on top of the
first, and it is the one that actually closes this class.

---

## What it would break

- **Every `as` cast that was papering over `any`.** Some become errors.
- **The three loose `OrgLookupClient` / `OrgRoleLookupClient` types**, which
  would want to be replaced by real ones and may reintroduce TS2589.
- **`tsc --noEmit` exit 0**, which is a hard gate before every commit in this
  project. It will not be 0 on the day types are turned on, and the branch is
  not shippable until it is. That is the real risk: a change that cannot be
  landed incrementally is a change that sits unlanded.

The mitigation is that it CAN be landed incrementally, if done deliberately:
generate `types.ts` first and commit it unused (zero risk), then parameterize one
client at a time, then fix the fallout per directory. Turning on all three
clients at once is the version that stalls.

---

## Time

Measured against this repository's actual size, not a general estimate.

| Step | Estimate |
|---|---|
| Generate types, commit unused | under 1 hour |
| Parameterize the browser client and clear its fallout | 1 to 2 days |
| Parameterize the server and service clients, clear fallout | 2 to 3 days |
| TS2589 remediation at the embed-heavy sites | 0.5 to 1 day |
| Wire regeneration into the migration sequence and CI | 0.5 day |
| **Subtotal: generated types working end to end** | **4 to 7 days** |
| Branded `OrgId` / `UserId` plus the column-to-brand mapping | 2 to 4 days more |
| **Total to actually close this class by construction** | **6 to 11 days** |

---

## Recommendation

**Do it, in that order, and not on this branch.**

1. **Now, this week, near zero risk:** generate `lib/supabase/types.ts` and commit
   it unused. It costs an hour, it is a read-only operation against the database,
   and it makes every later step a code change rather than a database step.
2. **Next, when there is a clear week:** parameterize the clients one at a time.
3. **Only then:** the branded-id layer, which is the part that would have made
   this entire three-day sequence of blind spots impossible.

Until step 3 lands, `scripts/check-org-id-reads.mjs` is the only thing bounding
the class, and its CLASS B header states honestly what it cannot see. Keep it.
Deleting it when generated types land but before brands land would remove the only
check that ever caught this.

**One thing to do regardless of any of the above, and it is cheap:** stop naming
organization-valued locals `agencyId` and `partnerId`. Both dashboard routes hid
their defect behind exactly that name. `agencyOrgId` is already used correctly in
`lib/server/partner-pool-import.ts` and in the pool import routes. A naming
convention is not a type system, but it is a one-hour change that would have made
two of this run's findings visible to the naked eye.
