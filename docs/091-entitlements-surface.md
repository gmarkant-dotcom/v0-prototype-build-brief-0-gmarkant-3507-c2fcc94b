# 091 — the entitlement surface, measured

**Read-only investigation.** No code was written or edited this session. No
migration was authored. No database was queried, and this session held no
credential that could have. Branch: `feat/m1-entitlements`, clean at start.

This starts from **OPEN-1 of `docs/090-active-org-report.md`** rather than
rediscovering it: `hasAgencyEntitlement()` reads `profiles.is_paid` on the
caller's own row, so a colleague of a paying owner is refused at
`app/api/projects/route.ts:552` with *"Active subscription required"*. 090 is
necessary and not sufficient. Everything below is what 091 would have to move,
and what is in the way.

**State taken as given, not re-derived:** 089 and 090 are applied and verified.
`profiles.active_org_id` exists with a SET NULL foreign key and the
`profiles_active_org_guard` BEFORE UPDATE trigger; `set_active_org(uuid)` is
live; `accept_org_invitation` initializes `active_org_id` if null. 117 policies
in `public`. `COLLEAGUE_INVITATIONS` is off and the invitation surface is inert.
Eighteen organizations, every one with exactly one member; sixteen have
`organizations.id = profiles.id` from the 079 backfill.

---

# READ THIS FIRST — what I could not establish, and two things I found

## Could not establish (no database access). Each has a query in the OPEN list.

1. **Which two organizations have `id <> profiles.id`.** Eighteen organizations,
   sixteen coincident, is given. The other two are not identified anywhere in
   the repository, and they are the accounts on which every fallback in this
   report behaves differently from the other sixteen. OPEN-A.
2. **Whether `authenticated` really holds a table-level UPDATE grant on
   `profiles`.** This is 090's own OPEN-5, still unqueried, and FINDING 1 below
   depends on it. OPEN-B.
3. **Whether any `org_members` row is not `owner`** — 090's OPEN-2, carried
   forward unchanged. OPEN-C.
4. **What `usage_tracking.plan_tier` actually holds per organization.** Nothing
   in this repository ever writes it to anything but `'starter'` or a carried
   forward prior value. OPEN-D.

## FINDING 1 — `profiles.is_paid` appears to be self-grantable today

This is not part of the brief and it is the most consequential thing the pass
turned up, so it is at the top rather than buried.

Migration 090's own section-2 header states the mechanism, about a different
column, and the argument is column-independent:

> `"Users can update own profile"` is table-wide and RLS has no column
> granularity, so not adding a policy does not stop a browser writing this
> column directly.
> — `supabase/migrations/090_active_org.sql:374`

The policy, from `docs/schema-snapshot-2026-08-13.md:207`:

```
profiles, Users can update own profile, UPDATE, {public}, PERMISSIVE,
  (auth.uid() = id), null
```

`USING (auth.uid() = id)`, `with_check` **null**. It constrains the *row*, not
the *column*. 090 answered this for `active_org_id` by adding a BEFORE UPDATE
trigger, because it had established that a column-level `REVOKE` is a no-op
against a table-level grant. **`is_paid` has no such trigger.** Grepping every
migration for a trigger on `public.profiles` returns exactly one hit, and it is
090's `profiles_active_org_guard`, which returns immediately unless
`active_org_id` itself changed.

So, REASONED and not executed: an authenticated user can `PATCH` their own
`profiles` row with `{"is_paid": true}` through PostgREST and grant themselves
the paid entitlement. Every gate in this report — the four
`hasAgencyEntitlement()` routes, the four `canUseAgencyAi()` routes,
`canUploadFiles()`, and `AgencySubscriptionGate` — reads that same column.

**This bears directly on 091.** `organizations` carries
`"Org admins update their organization"` (`079_organizations.sql:1797`) with the
identical shape — `USING (id IN (...admin org ids))`, `WITH CHECK (id IN
(...))`, row-constrained, no column granularity. Putting `is_paid` on
`organizations` **reproduces the hole one level up** and hands it to every owner
and admin, unless 091 guards the column the way 090 guarded `active_org_id`.
The precedent and the mechanism already exist in this repository.

Settled by OPEN-B. If the grant turns out to be column-level only, this finding
collapses and nothing else in the report changes.

## FINDING 2 — `agencyEntitlementId()` picks the wrong organization for a colleague

Item 3 asked whether the quota counters must move to the organization. They
already did, at 079: `usage_tracking.org_id`, `projects.org_id`. The counters
are not the problem. **The resolver is.**

`agencyEntitlementId()` (`lib/entitlements.ts:234`) still sorts memberships
`owner < admin < member` and takes the first. `resolveActingOrgId()` was written
because that ranking becomes a silent misattribution the moment anyone has two
memberships — and `resolveCallerWriteOrgId()` was migrated to it. **The quota
path was not.** So for exactly the colleague this milestone exists to create:

> B owns their own auto-created organization (role `owner`) and is a `member` of
> the paying company A. `agencyEntitlementId(B)` ranks owner above member and
> returns **B's own one-person organization**. Every AI analysis and every
> project B creates while acting for A is metered against B's own quota, not A's.

That is the exact inverse of the ruling. It is invisible today because nobody
has two memberships. It becomes live the same hour `COLLEAGUE_INVITATIONS` is
turned on, whether or not 091 ships.

---

# 1. Every read of `is_paid`, and every caller of the two functions

## 1a. `is_paid` — 15 select lists, 15 files, all on `profiles`

Fourteen inline `.select()` calls plus one named column-list constant. Grep is
exhaustive: every occurrence of the string `is_paid` under `app/`, `lib/`,
`components/`, `contexts/`, `hooks/`, `scripts/`, `types/` was enumerated and
every one that reaches PostgREST is in this table.

| # | File:line | What the read gates |
|---|-----------|---------------------|
| 1 | `app/api/admin/users/route.ts:15` (`ADMIN_USER_COLUMNS`) | Nothing. Feeds the admin user list. |
| 2 | `app/api/admin/users/[userId]/flags/route.ts:121` | Nothing. Re-read after the flag PATCH, to return the new state. |
| 3 | `app/api/agency/msa/ai-schedule/route.ts:68` | → `hasAgencyEntitlement()` at `:78`. AI milestone schedule generation. 403 *"Subscription required for AI features"*. |
| 4 | `app/api/agency/payment-synthesis/route.ts:59` | → `hasAgencyEntitlement()` at `:69`. Payment synthesis. Same 403. |
| 5 | `app/api/agency/projects/duplicate/route.ts:43` | → `hasAgencyEntitlement()` at `:46`. Duplicating a project. |
| 6 | `app/api/ai/master-brief/route.ts:48` | → `canUseAgencyAi()` at `:52`. Master brief generation. |
| 7 | `app/api/ai/rfp-output-template/route.ts:40` | → `canUseAgencyAi()` at `:44`. RFP output template generation. |
| 8 | `app/api/ai/route.ts:176` | → `canUseAgencyAi()` at `:180`. The generic AI tool route. |
| 9 | `app/api/documents/extract-text/route.ts:31` | → `canUseAgencyAi()` at `:35`. Document text extraction. |
| 10 | `app/api/partner/documents/upload/route.ts:44` | **Inline gate at `:58`**, not the module: `isDemoMode \|\| isPartner \|\| is_admin \|\| is_paid`. Vendor legal-document upload. |
| 11 | `app/api/partner/rfp-bid/upload/route.ts:29` | **Inline gate at `:43`**, same expression. Vendor bid-attachment upload. |
| 12 | `app/api/projects/route.ts:541` | → `hasAgencyEntitlement()` at `:552`. **Project creation. This is the OPEN-1 refusal.** |
| 13 | `app/api/upload/route.ts:54` | → `canUploadFiles()` at `:62`. The general upload route. |
| 14 | `app/auth/callback/route.ts:17` | Nothing gated. Read in the post-auth routing decision; `:45` and `:83` note the flags are deliberately never *written* here. |
| 15 | `contexts/paid-user-context.tsx:107` | **The whole client surface.** Sets `isPaid`, which drives `AgencySubscriptionGate` and `checkFeatureAccess()`. |

Direct field reads inside the module itself: `lib/entitlements.ts:333`
(`hasAgencyEntitlement`), `:353` (`canUseAgencyAi`), `:376` (`canUploadFiles`).

**Writers of `is_paid` — 2 routes, both admin-gated, both service-role:**

- `app/api/admin/grant-access/route.ts:167` — `.update({ is_paid: true })`, one
  target, behind an admin magic link.
- `app/api/admin/users/[userId]/flags/route.ts` — PATCH behind
  `requireAdminRole()`, allow-listed to `MUTABLE_FLAGS = ["is_paid",
  "demo_access", "is_admin"]` (`:32`). The request body is never spread.
- Surface: `app/admin/users/page.tsx` (`togglePaidStatus` `:124`,
  `grantAgencyAccess` `:128`).

Plus, per FINDING 1, an apparently unguarded self-write path through PostgREST.

**The client consumers of `isPaid`, which are what a user actually feels:**

`components/agency-subscription-gate.tsx:26` wraps the **entire agency layout**
(`components/agency-layout.tsx:817`) — an unentitled agency account sees a full
page reading *"Platform access has been restricted"* instead of the product.
`checkFeatureAccess()` (`contexts/paid-user-context.tsx:140`) is called from
eight components: `app/agency/documents/page.tsx:179`,
`app/agency/magic-rfp/page.tsx:111`, `app/agency/page.tsx:155`,
`app/agency/pool/page.tsx:313`, `components/agency-document-library-manager.tsx:54`,
`components/new-project-dialog.tsx:49`,
`components/stage-03-onboarding-production.tsx:39`,
`components/stage-03-onboarding-workflow.tsx:99`,
`components/stages/stage-03-onboarding.tsx:230`.

## 1b. `hasAgencyEntitlement()` — 4 route call sites

| File:line | Gates | Refusal |
|-----------|-------|---------|
| `app/api/projects/route.ts:552` | Project creation | 403 *"Active subscription required"* |
| `app/api/agency/projects/duplicate/route.ts:46` | Project duplication | 403 |
| `app/api/agency/msa/ai-schedule/route.ts:78` | MSA AI milestone schedule | 403 *"Subscription required for AI features"* |
| `app/api/agency/payment-synthesis/route.ts:69` | Payment synthesis | 403 |

Plus one internal composition: `canUseAgencyPortalAi()`
(`lib/entitlements.ts:390`). **It has zero call sites.** Its own doc comment
names the two routes it was written for — `msa/ai-schedule` and
`payment-synthesis` — and both of those call `hasAgencyEntitlement()` and
`canActAs()` as two separate statements instead. Dead code, and 091 will touch
it, so it is recorded here rather than found later.

`canUseAgencyAi()` — 4 call sites, all AI routes: `ai/master-brief:52`,
`ai/rfp-output-template:44`, `ai/route:180`, `documents/extract-text:35`.

`canUploadFiles()` — 1 call site: `app/api/upload/route.ts:62`.

**Two gates bypass the module entirely** and inline the expression:
`app/api/partner/documents/upload/route.ts:58` and
`app/api/partner/rfp-bid/upload/route.ts:43`. Both are vendor-side and both are
`true` for every vendor before `is_paid` is reached (see item 6).

## 1c. `agencyEntitlementId()` — 18 call sites, 12 files

Fifteen are quota calls. **Three are not**, and those three feed an organization
id into a *write* or a *scoping predicate*:

| File:line | Use |
|-----------|-----|
| `app/api/agency/email-scan/import/route.ts:168` | `agencyOrgId` → `importContact(...)`, which writes into the **shared vendor pool**. |
| `app/api/agency/email-scan/run/route.ts:341` | `agencyOrgId` → `enrichWithLigamentData(...)`, scoping partnership reads on `lead_org_id` **with a service-role client**, so this argument is the whole scoping. |
| `app/api/partner/partnerships/claim/route.ts:43` | `claimantOrgId` → written to `partnerships.vendor_org_id`, which **REFERENCES organizations(id)**. |

The fifteen quota calls: `agency/bids/[responseId]/ai-score:169,381`;
`agency/bids/[responseId]/decompose:144,193`;
`agency/bids/[responseId]/generate-summary:22,37`; `agency/bids/compare:115,167`;
`agency/delivery-reviews:290,321`; `agency/email-scan:73`;
`agency/email-scan/run:360`; `agency/projects/duplicate:52`;
`agency/usage:15`; `projects:559`.

---

# 2. `agencyEntitlementId()`'s failure behaviour, read from the code

`lib/entitlements.ts:234-252`, verbatim in structure:

```ts
export async function agencyEntitlementId(userId: string, client: OrgLookupClient): Promise<string> {
  if (!userId) return userId                                   // (A)
  const { data, error } = await client
    .from("org_members").select("org_id, role").eq("user_id", userId)
  if (error || !data || (data as unknown[]).length === 0) {    // (B)
    if (error) { console.error("[entitlements] agencyEntitlementId falling back to user id", {...}) }
    return userId
  }
  const rows = data as Array<{ org_id?: string | null; role?: string | null }>
  const rank = (r?: string | null) => (r === "owner" ? 0 : r === "admin" ? 1 : 2)
  const best = [...rows].sort((a, b) => rank(a.role) - rank(b.role))[0]
  return best?.org_id ?? userId                                 // (C)
}
```

**Three distinct fallback paths, all returning the caller's USER id:**

- **(A)** falsy `userId` — returned unchanged, no log.
- **(B)** query error **or** zero rows — returns `userId`. **Logged only in the
  error branch.** A caller who belongs to no organization falls back *silently*.
  (Contrast `resolveCallerOrgIds()` at `:174`, which logs that case explicitly.)
- **(C)** rows present but the winning row's `org_id` is null — returns
  `userId`. Not logged at all.

It is `Promise<string>`, deliberately unbranded, and the module header at `:80`
says why: leaving it a bare `string` is what stops the compiler letting the
value reach a write parameter typed `OrgId`.

## What that value does downstream

**Today, on the quota path.** `getOrCreateMonthlyUsage()`
(`lib/usage-tracking.ts:59`) upserts `{ org_id: agencyId, ... }` into
`usage_tracking`. 079 made `usage_tracking.org_id` **NOT NULL** (`:983`) and
added `usage_tracking_org_id_org_fkey → organizations(id) ON DELETE CASCADE` in
the PHASE 7 repoint loop (`:875`, executed at `:919`).

So the fallback is **never** what the function's own header claims. That header
(`lib/entitlements.ts:229`) says the fallback is *"merely wrong-and-harmless for
an organization created later, which would get a fresh usage_tracking row rather
than an error."* Against the post-079 schema:

- For the **sixteen** coincident accounts: `userId` **is** a valid
  `organizations.id`, the upsert lands on the correct row, and the fallback is
  accidentally *correct*.
- For any account whose organization id differs: the upsert raises **23503**,
  `getOrCreateMonthlyUsage` turns that into `throw new Error(...)` at `:102`, and
  the AI or project-create request **500s**. Not a fresh usage row. An error.

The header's claim was written before the FK existed and was not revised. It is
a documentation defect, not a behaviour change; it is recorded because 091 will
be read against that header.

**If entitlement becomes org-keyed** — that is, if a route resolves an
organization and reads `organizations.is_paid` for it — and `agencyEntitlementId()`
is what resolves it:

- **Sixteen legacy accounts:** `userId` matches an `organizations.id`, the right
  row comes back, and the entitlement answer is **right by the same accident
  that has hidden every id-confusion defect in this repository**.
- **Every other account:** the lookup matches **no row**. `is_paid` reads as
  `undefined`, `hasAgencyEntitlement()` returns `false`, and the account is
  locked out of project creation, project duplication, all four AI routes,
  uploads, and — through `PaidUserContext` — the entire agency portal behind
  `AgencySubscriptionGate`. **With no admin toggle able to fix it**, because the
  profile flag would no longer be the thing being read.

That is the failure this resolver is shaped to produce: correct for the sixteen
accounts that exist, and a total lockout for the seventeenth. It fails **open**
for the legacy set and **closed and invisibly** for the new set — the worst of
both directions.

`resolveCallerWriteOrgId()` (`:303`) is the resolver with the opposite failure —
same intent, returns `null`, every caller treats null as "fail the request", and
it delegates to `resolveActingOrgId()`. It exists precisely because
`agencyEntitlementId()`'s failure direction is wrong for anything but accounting.

---

# 3. The quota counters — where they live, what they are keyed on

**Both already sit on the organization. Neither has to move.**

| Counter | Where | Keyed on |
|---------|-------|----------|
| AI analyses | `usage_tracking.ai_analyses_count` | `usage_tracking.org_id` — renamed from `agency_id` at `079:659`, `SET NOT NULL` at `:983`, FK → `organizations(id) ON DELETE CASCADE`, `UNIQUE (org_id, month_start)` carried from `067`. |
| Projects | **Not stored.** Derived live. | `getActiveProjectsCount()` (`lib/usage-tracking.ts:146`) counts `projects` where `org_id = agencyId` and `status NOT IN (completed, archived)`. `projects.org_id` is NOT NULL with the same FK. |

RLS after 079 (`:1676`): `"Agencies manage own usage tracking"`, USING and WITH
CHECK both `org_id IN (SELECT public.current_user_org_ids())` — every member of
an organization reads and writes the same quota row. One row per organization
per month is the ruled billing unit and it needed no schema change beyond the
rename.

**So: no, they do not have to move.** The premise in the brief's item 3 — that
counters staying per-profile would give two colleagues a full quota each — was
true before 079 and is not true now.

**What is true instead is FINDING 2.** The counters are org-keyed but the
argument passed to them is resolved by `agencyEntitlementId()`, which ranks
`owner` above `member` and therefore returns a colleague's **own** organization
rather than the one they are acting for. The quota lands on the right *kind* of
row and the wrong *organization*. Every one of the fifteen quota call sites in
item 1c inherits this.

The fix is not a migration. It is pointing the quota path at the acting
organization the way the write path already does. That is a code change 091 can
carry or a separate pass can carry, and it is not a billing decision.

One more, for completeness: `usage_tracking.plan_tier` is `text NOT NULL DEFAULT
'starter'` (`067_usage_tracking.sql:6`). The **only** writer in the entire
repository is `getOrCreateMonthlyUsage`, which either carries forward the prior
month's value or writes `'starter'`. **Nothing promotes an organization to
`professional` or `enterprise`.** `getPlanLimits()` maps the three tiers to
5/50, 20/250, and Infinity/Infinity — so every organization is on Starter limits
unless somebody has edited SQL by hand. OPEN-D.

---

# 4. MIRROR OR DROP — the count, and what it does and does not decide

**The number: 15 select lists across 15 files.** All fifteen are on `profiles`.
Fourteen are inline `.select()` calls; one is the `ADMIN_USER_COLUMNS` string
constant at `app/api/admin/users/route.ts:15`. Enumerated in item 1a.

**The comparison, measured the same way in the same tree:** `company_name`
appears in **45 select lists across 30 files**. (The 090-era figure of 38/26 was
measured over a narrower path set; the ratio is what matters and it is unchanged
— `is_paid` is roughly a third of `company_name`'s footprint.)

**What the number decides: the 42703 blast radius does not force a mirror.**
Fifteen statements in fifteen files is a single mechanical pass, and thirteen of
those files have to be edited anyway if the gate moves off the profile column.
`company_name` could not be retired at 079 partly because thirty files is a
different kind of change; `is_paid` is not in that category.

**What the number does not decide, and these are the actual blockers:**

1. **`profiles.is_paid` is the only access grant this product has.** There is no
   billing provider (item 5). The two writers are admin-only, the admin UI lists
   the flag per user, and `grantAgencyAccess()` is how a real customer is
   switched on today. Drop the column with no org-keyed admin surface in place
   and there is no way to grant access to anybody in the interval.
2. **The migration is applied by hand and the code deploys separately.**
   `LIGAMENT_CONTEXT.md` and 090's apply order both make that explicit: migration
   first, then `git push`. PostgREST raises 42703 for the **whole statement** on
   one unknown column, so between a drop and the deploy that removes the column
   from those fifteen select lists, `app/auth/callback/route.ts:17` fails, the
   projects route fails, all four AI routes fail, and
   `contexts/paid-user-context.tsx:107` fails — the last of which puts every
   agency user behind `AgencySubscriptionGate`'s restriction page. A mirror makes
   the two deploys independent in both orders. A drop makes them a coupled
   release with a broken window in between.
3. **FINDING 1.** If the profile column stays and stays readable as an
   entitlement, the self-grant hole stays with it.

**Recommendation, stated and not designed:** 091 adds the organization column
and moves the *reads*; `profiles.is_paid` stays in place through 091 and is
retired by a later migration once an org-keyed admin surface exists. That is a
mirror by sequencing rather than a mirror by dual-write — nothing has to keep
the two columns in sync if only one of them is ever consulted after the deploy.
The migration itself is not designed here.

---

# 5. What `organizations` already carries, and whether a billing provider is read

## The table, in full

`079_organizations.sql:194-228`. Seven columns and one CHECK:

```
id                       uuid PRIMARY KEY DEFAULT gen_random_uuid()
name                     text NOT NULL
primary_contact_user_id  uuid REFERENCES profiles(id) ON DELETE SET NULL
is_lead_agency           boolean NOT NULL DEFAULT false
is_vendor                boolean NOT NULL DEFAULT false
created_at               timestamptz NOT NULL DEFAULT now()
updated_at               timestamptz NOT NULL DEFAULT now()
CONSTRAINT organizations_has_a_capability CHECK (is_lead_agency OR is_vendor)
```

**No plan. No tier. No seat count. No billing column of any kind.** And nothing
has been added since: grepping every migration for `ALTER TABLE
public.organizations` returns exactly one hit, `ENABLE ROW LEVEL SECURITY` at
`:268`. Migrations 080 through 090 add none.

`is_lead_agency` and `is_vendor` are explicitly **descriptive, not
authorization** (`:220`): *"no policy in this file reads them, precisely so a
wrong flag cannot lock anybody out of their own data."* They are not a seam an
entitlement could hide in.

## The only tier-shaped thing in the product

`usage_tracking.plan_tier`, `text NOT NULL DEFAULT 'starter'`, migration 067.
`lib/usage-tracking.ts:56` says so in as many words: *"There is no persisted
plan-tier field anywhere yet (profiles only has a boolean `is_paid`) —
`usage_tracking.plan_tier` is it, until a real billing/Stripe-driven tier lookup
exists."* It lives on a **monthly usage row**, not on the organization, so it is
a per-month attribute that happens to be carried forward, not a plan.

## Billing provider in the entitlement read path

**None. There is no billing provider anywhere in the repository.** Grepping
`app/`, `lib/`, `components/` and `package.json` for `stripe`/`Stripe` returns
two files and neither is an integration: `lib/email-domains.ts` (a domain
string in a list) and the `lib/usage-tracking.ts:56` comment quoted above. No
dependency, no webhook route, no customer id column. Not investigated further,
per the brief.

The capability map is already written for one that does not exist —
`lib/capabilities.ts:174-178`: `billing.view: admin`, `billing.change_plan:
owner`, `billing.cancel: owner`, `billing.payment_method_add: owner`,
`billing.payment_method_remove: owner`, under a comment at `:165` saying *"None
of these have code today."* Note that map already splits `view` (admin) from
`change_plan` (owner) — which is **narrower than the ruling**, and 091 is where
that discrepancy has to be settled one way or the other.

---

# 6. Vendor organizations — the entitlement concept does not exist for them

`hasAgencyEntitlement()` is **agency-only in practice**: all four call sites are
under `app/api/agency/` or are the agency project-create route. Nothing on the
vendor side calls it, `canUseAgencyAi()`, or `canUseAgencyPortalAi()`.

More than that — **vendor organizations have no entitlement concept at all**,
established four independent ways:

1. **No gate component.** `components/partner-layout.tsx` mounts no equivalent of
   `AgencySubscriptionGate`. Grepping it for `SubscriptionGate`,
   `hasAgencyEntitlement` and `is_paid` returns nothing. `AgencySubscriptionGate`
   is mounted in exactly one place: `components/agency-layout.tsx:817`.
2. **The client gate returns early for vendors.** `checkFeatureAccess()`
   (`contexts/paid-user-context.tsx:152-155`): *"Partner agencies collaborate in the
   lead agency's ecosystem; they are not the billable 'primary' subscriber — do
   not gate partner portal features on is_paid"* — `role === "partner" ||
   activeRole === "partner"` returns `true` before `isPaid` is consulted.
3. **`canUploadFiles()` short-circuits.** `lib/entitlements.ts:375`:
   `if (actingRole(profile) === "partner") return true`, before the billing test.
   The module header calls this *"the product decision, not an oversight."*
4. **The two inline vendor upload gates never reach `is_paid`.**
   `partner/documents/upload:58` and `partner/rfp-bid/upload:43` both read
   `isDemoMode || isPartner || is_admin || is_paid`, and both files' own comments
   at `:50` and `:35` say the `is_paid` clause *"never decides anything."*

**So the brief's premise for item 6 needs one correction, stated plainly rather
than worked around: the colleague *entitlement* lockout does not apply to vendor
organizations today, because there is no vendor entitlement to be locked out
of.** OPEN-1's *"Active subscription required"* cannot be reached from any
vendor surface.

**What does apply to vendor organizations identically** is the *acting-org*
lockout — the one 090 fixed. `resolveActingOrgId()` is portal-neutral; a vendor
colleague with two memberships and no `active_org_id` gets `"ambiguous"` and
cannot write, exactly as an agency colleague would. `/join` is deliberately
portal-neutral for this reason (`app/join/[token]/join-invitation-client.tsx:32`:
*"A colleague invitation is portal-neutral — an agency admin may invite somebody
whose account is a vendor account, and vice versa"*), and
`components/organization-switcher.tsx` is mounted in **both** chips
(`agency-layout.tsx:719`, `partner-layout.tsx:225`).

**The consequence for 091, and it is a product question, not a finding:** if
entitlement moves onto `organizations` as one column read by one function, then
either (a) vendor organizations get an entitlement they have never had and every
vendor is locked out on the day the column defaults to false, or (b) the read
path stays asymmetric and `organizations.is_paid` means "entitled *as a lead
agency*", which makes the column's name a lie for half the rows in the table.
Neither is decided here.

One asymmetry worth noting while it is cheap: the invitation **API** is
portal-neutral (`/api/org/invitations` resolves the acting org from membership
and never reads a portal), but the only **UI** for it is
`app/agency/settings/team/`. There is no vendor team page. A vendor org owner
can be invited and can accept; they have no page from which to invite.

---

# 7. The role escalation the ruling creates

Taking the ruling as given — *seats are paid for by the company, the admin role
manages billing, owner and admin may change the plan* — then **inviting someone
as admin grants billing rights**, and here is exactly what the current surface
permits. No fix is proposed.

## What constrains the role on an invitation: three things, and none of them is a role predicate

1. **The column CHECK.** `org_invitations.role text NOT NULL DEFAULT 'member'
   CHECK (role IN ('owner', 'admin', 'member'))`
   (`086_member_identity_and_invitations.sql:204`). Identical to
   `org_members.role`'s CHECK (`079:257`), deliberately.
2. **The INSERT policy.** `"Org admins create invitations"`
   (`089_org_invitation_lifecycle.sql:451`), `WITH CHECK (org_id IN (SELECT
   public.current_user_admin_org_ids()))`. Its own header at `:445` states the
   limit outright: *"WHAT THIS CONSTRAINS: org_id only. … email, role, token and
   expires_at are theirs to choose."* `current_user_admin_org_ids()` resolves
   `role IN ('owner', 'admin')` (`079:476`).
3. **The route gate.** `app/api/org/invitations/route.ts` validates the role with
   `isInvitableRole()` — which is membership in `INVITABLE_ROLES = ["owner",
   "admin", "member"]` (`lib/org-invitations.ts:154`) and nothing else — then
   checks the caller with `loadOrgRole()` and refuses unless
   `callerRole === "owner" || callerRole === "admin"`. **There is no comparison
   between the caller's role and the role being granted.**

The UI matches: `app/agency/settings/team/team-roster-client.tsx:508` renders a
`<select>` over all three of `INVITABLE_ROLES`, defaulting to `member`
(`:163`), shown to owner and admin alike (`mayInvite`).

And `accept_org_invitation()` **copies the role verbatim**
(`090_active_org.sql`, the org_members INSERT): *"role is COPIED VERBATIM. …
Any narrower list written here would be a guess at an unmade ruling."*

## So, stated as the brief asks

**An admin can currently grant: `owner`, `admin`, or `member` — to any email
address, in their own organization.** Under the ruling that is an admin handing
out billing rights, and also handing out **owner**, a role strictly above their
own.

**An owner can currently grant: exactly the same three.** There is no capability
an owner has here that an admin does not.

**Two adjacent facts that bound what this means:**

- **`org_members` has no UPDATE policy at all.** The complete policy set on that
  table is `"Members read their own membership row"` (SELECT, `079:1736`),
  `"Members read their organization roster"` (SELECT, `086:148`), `"Org admins
  add members"` (INSERT, `079:1740`), `"Org admins remove members"` (DELETE,
  `079:1744`). Postgres denies by default, so **nobody can change an existing
  member's role through any client.** The capability map's
  `org.member_role_change: admin` (`lib/capabilities.ts:170`) has no code and no
  policy behind it. A role change today is delete-then-re-invite.
- **`"Org admins remove members"` constrains `org_id` only, with no role
  predicate either.** So an admin can delete the **owner's** membership row. In
  combination with the above: an admin can invite a second owner, and an admin
  can remove the existing owner. The capability map says `org.member_revoke:
  owner` — the *policy* says admin. The revoke route
  (`app/api/org/invitations/revoke/route.ts:77`) makes the same owner-or-admin
  choice deliberately and flags the discrepancy in its own comment at `:71`.

`orgRoleFor()` (`lib/capabilities.ts:249`) still returns `"owner"`
unconditionally for every caller — 090's OPEN-2, unchanged. It is not what gates
the invitation routes (both use `loadOrgRole()`), but every `can()` call in the
UI still runs through it, so **the interface offers admin-and-owner actions to
plain members** and the server refuses them.

---

# 8. What an org going UNPAID does to its members — today, and the question

## Today, and it is per-person, not per-organization

There is no "org going unpaid" state. There is one boolean per profile, flipped
by an admin. For the person whose flag goes false, with `is_admin` false and
`NEXT_PUBLIC_IS_DEMO` unset:

- **The whole agency portal disappears.** `AgencySubscriptionGate`
  (`agency-layout.tsx:817`) renders a full-page *"Platform access has been
  restricted / Access to this account has been restricted by an administrator"*
  in place of every `/agency` route.
- **Server-side, ten gates refuse:** project create (`projects:552`), project
  duplicate (`duplicate:46`), MSA AI schedule (`ai-schedule:78`), payment
  synthesis (`payment-synthesis:69`), the four AI routes via `canUseAgencyAi()`,
  the general upload route via `canUploadFiles()`. All 403.
- **Reads are not gated.** Middleware checks auth and portal only; RLS is
  membership-derived and reads nothing about entitlement. Data is intact and
  visible to anything that bypasses the layout gate.
- **Colleagues are unaffected**, because the flag is on one profile row. Which is
  precisely the thing 091 changes.

## The product question. FLAGGED, NOT ANSWERED.

If entitlement becomes an organization fact, an organization going unpaid stops
being one person's problem and becomes every member's, simultaneously. What that
should do is a ruling, not an inference, and at minimum it has to answer:

- **Does the owner keep a way back in?** With the gate as written, an unpaid
  organization's owner cannot reach any `/agency` page — including whatever
  billing page 091 implies. A gate that blocks the person who has to pay is a
  trap. (Compare `AgencySubscriptionGate`'s existing escape hatch: a *"Learn
  more"* button opening `UpgradeRequiredModal`, which is not a billing surface.)
- **Read-only, or nothing?** Data is intact either way; the question is whether a
  lapsed customer can still see their projects and export, or sees the wall.
- **Does an admin get the same treatment as a member?** The ruling gives admins
  billing rights, which argues they need access to exercise them.
- **What about a member of a *second*, still-paid organization?** After 090 an
  account can hold two memberships. If one goes unpaid, entitlement becomes a
  property of the *acting* organization, not of the session — which means
  `hasAgencyEntitlement()` stops being answerable from a profile row at all and
  needs the acting org resolved first. That is a shape constraint on 091, not
  just a product question.
- **The copy is wrong for this case.** *"restricted by an administrator"* is
  written for the admin-toggle model. A lapsed payment is not an administrator
  action and should not read as one.

---

# 9. What a seat-limited accept would have to enforce, and where

Assuming nothing about whether seats are metered. Both shapes, as asked.

## Shape A — a flat company plan (seats unlimited, one price)

**Nothing to enforce at accept.** Entitlement is one fact on the organization;
`accept_org_invitation()` already copies `org_id` off the invitation row and
inserts the membership. Adding a colleague costs nothing, which is what the 079
ruling already recorded (`lib/entitlements.ts:24`) and what `usage_tracking`'s
`UNIQUE (org_id, month_start)` already implements.

The only enforcement point is the **entitlement read**, and the only question is
which organization it is keyed to — item 2's problem, not a seat problem. **No
change to `accept_org_invitation()` is required.**

## Shape B — N metered seats

The check has to live somewhere the invitee cannot go around, and there are only
two candidate moments.

**Creation (`POST /api/org/invitations`) is not sufficient on its own.**

- It can be raced: two admins with five seats and four members both see room,
  both send, both invitations are valid.
- Pending invitations are not members, so a count taken at creation time is
  counting the wrong thing — the seat is not consumed until somebody accepts,
  and an invitation may never be accepted.
- It is the right place for a *friendly* refusal ("you have no seats left"), and
  the wrong place for the *authoritative* one.

**Accept is the only moment a seat is actually consumed, so that is where the
authoritative check goes — and that means another `CREATE OR REPLACE` on
`accept_org_invitation()`.** It would be the third: 089 created it, 090 replaced
it to add the `active_org_id` set-if-null clause.

That function is the right host for four reasons already established in the
repository: it is `SECURITY DEFINER` (the invitee is not yet a member, so no
membership-derived policy can authorize the `org_members` INSERT); it runs in
one transaction, because PostgREST wraps each RPC call in one; the accept route
(`app/api/org/invitations/accept/route.ts`) is *one `.rpc()` call and nothing
else*, deliberately, so there is no application-side gap to slip through; and
`org_members` has **no INSERT path for a non-admin other than this function**, so
there is no second door.

**What a correct check would have to get right, none of which is designed here:**

1. **The count must be locked against a concurrent accept.** The existing `SELECT
   ... FROM org_invitations WHERE token = p_token FOR UPDATE` locks *one
   invitation row*. It does not serialize two **different** invitees accepting
   into the same organization at the same instant — both would count four
   members, both would pass a five-seat check, and the organization ends up with
   six. Serializing on the organization (locking the `organizations` row before
   counting `org_members`) or a constraint that cannot be raced is the shape;
   which one is a design decision.
2. **Ordering inside the function.** 090 identified one ordering constraint
   already — the `org_members` INSERT must land before the
   `profiles.active_org_id` set-if-null. A seat check must sit **before** the
   INSERT, and its refusal must abort the whole transaction, or the invitation
   gets marked `accepted` for somebody who was not admitted.
3. **The refusal needs a code and a sentence.** The function's error vocabulary
   is `LG001` (not found / not yours), `LG002` (no session), `LG003` (not
   pending), `LG004` (expired), and 090 added `LG005` (not your organization) on
   the guard trigger. An over-seat refusal is a sixth, and it has to be mapped in
   `lib/org-invitations.ts` alongside the others, or the invitee sees a raw
   SQLSTATE.
4. **What happens to the invitation.** Refusing an over-limit accept leaves the
   row `pending`, which is arguably right — a seat frees up and the same link
   works. But 089's design deliberately does **not** stamp status inside a
   raising branch, because the RAISE rolls it back; so "pending" is what happens
   whether or not anybody decides it should. Worth deciding rather than
   inheriting.
5. **Seats free silently.** `"Org admins remove members"` is a plain DELETE
   policy with nothing counting anything. A seat count derived live from
   `org_members` is self-correcting and needs no bookkeeping; a **stored** seat
   counter would drift the first time a member is removed. That argues for
   deriving, and it is worth stating before somebody adds a column.
6. **Where the seat number lives.** `organizations` has no column for it (item
   5) and `usage_tracking.plan_tier` is a per-month attribute of a usage row, not
   a plan. Whatever holds N does not exist yet.

---

# OPEN — what a database query would settle

Every one of these is **REASONED**. None was executed. Each carries the query.

### OPEN-A. Which two organizations have `id <> profiles.id`

Eighteen organizations, sixteen coincident, is given. The other two are the only
accounts on which `agencyEntitlementId()`'s fallback (item 2) behaves
differently from the rest — and they are where an org-keyed entitlement read
would produce a total lockout rather than an accidental success. They are not
identifiable from the repository.

```sql
SELECT o.id AS org_id, o.name, m.user_id, p.email,
       (o.id = m.user_id) AS id_coincides
FROM public.organizations o
JOIN public.org_members m ON m.org_id = o.id
JOIN public.profiles    p ON p.id = m.user_id
ORDER BY id_coincides, o.created_at;
-- EXPECTED: 18 rows, 16 with id_coincides = true. The 2 false rows are the
-- accounts every fallback in this report treats differently.
```

### OPEN-B. Is `profiles.is_paid` actually self-grantable? (FINDING 1)

090's OPEN-5, carried forward and now load-bearing for a different column. The
claim that a column-level REVOKE would be a no-op — and therefore that nothing
stops a browser writing `is_paid` on its own row — depends on `authenticated`
holding the **table-level** UPDATE privilege.

```sql
-- 1. The policy: is with_check still null, and is it still row-only?
SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='profiles' AND cmd='UPDATE';
-- EXPECTED per docs/schema-snapshot-2026-08-13.md:207:
--   "Users can update own profile", UPDATE, {public}, (auth.uid() = id), null

-- 2. Table-level UPDATE grant. If authenticated appears here, RLS is the ONLY
--    thing between a browser and any column on its own profile row.
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='UPDATE';

-- 3. Column-level grants, for the same reason.
SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='UPDATE';

-- 4. Confirm no trigger other than 090's guards this table.
SELECT t.tgname, p.proname, t.tgenabled
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE c.relname = 'profiles' AND NOT t.tgisinternal ORDER BY t.tgname;
-- EXPECTED from the migrations: exactly profiles_active_org_guard.
```

**If (2) returns `authenticated`, the hole is real and 091 must not reproduce it
on `organizations`** — whose UPDATE policy (`079:1797`) has the identical
row-only shape.

### OPEN-C. Does any `org_members` row hold a role other than `owner`?

090's OPEN-2, unchanged. It bounds item 7: with only owners, nothing in the role
escalation is reachable yet.

```sql
SELECT role, count(*) FROM public.org_members GROUP BY role;
-- EXPECTED today: one row, owner = 18. Anything else means a non-owner already
-- exists, orgRoleFor() is already lying about them, and item 7 is already live.
```

### OPEN-D. What tier is every organization actually on?

Nothing in the repository ever promotes a tier (item 3). If every row says
`starter`, then the three-tier limit table in `lib/usage-tracking.ts` has never
been exercised and 091's plan model starts from a blank slate rather than from
data that has to be preserved.

```sql
SELECT plan_tier, count(*) AS rows, count(DISTINCT org_id) AS orgs,
       min(month_start), max(month_start)
FROM public.usage_tracking GROUP BY plan_tier ORDER BY plan_tier;
-- EXPECTED if nothing has been hand-edited: one row, plan_tier = 'starter'.
```

### OPEN-E. Who is entitled right now, and does it survive the move?

The set of profiles carrying `is_paid = true` is the set 091 has to preserve, and
mapping it to organizations is what tells you whether the move is lossless.

```sql
SELECT p.email, p.is_paid, p.is_admin, m.org_id, m.role, o.name AS org_name
FROM public.profiles p
LEFT JOIN public.org_members  m ON m.user_id = p.id
LEFT JOIN public.organizations o ON o.id = m.org_id
ORDER BY p.is_paid DESC, p.email;
-- Two things to read off it: (a) which organizations must land entitled, and
-- (b) whether any organization contains BOTH a paid and an unpaid profile,
-- which is the only case where "move the flag up" is ambiguous. With one member
-- per organization it cannot happen today.
```

### OPEN-F. Is the FK on `usage_tracking.org_id` really what 079 intended?

Item 2's claim that the `agencyEntitlementId()` fallback raises 23503 — rather
than opening a fresh usage row, as its own header states — depends on this FK
existing with this shape.

```sql
SELECT r.relname AS table_name, c.conname, a.attname AS column_name,
       c.confdeltype, f.relname AS references_table
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
JOIN pg_class f ON f.oid = c.confrelid
JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = c.conkey[1]
WHERE c.contype='f' AND f.relname='organizations' AND r.relname='usage_tracking';
-- EXPECTED per 079 PHASE 7: usage_tracking_org_id_org_fkey, org_id,
-- confdeltype 'c' (CASCADE, inherited from 067's FK to auth.users).
```

### OPEN-G. Are there orphaned or user-keyed `usage_tracking` rows?

If 079's FK creation succeeded, there can be none — but the fallback in item 2
has been live since 079 shipped, and a 23503 in a route that swallows errors
would not be obvious.

```sql
SELECT u.org_id, count(*) FROM public.usage_tracking u
LEFT JOIN public.organizations o ON o.id = u.org_id
WHERE o.id IS NULL GROUP BY u.org_id;
-- EXPECTED: 0 rows. Any row means the FK is not what OPEN-F expects.
```

---

# What was EXECUTED, what was READ, what was REASONED

**EXECUTED:** `git branch --show-current` and `git status --porcelain` (branch
`feat/m1-entitlements`, clean); `ls` on `docs/` and
`supabase/migrations/`; `wc -l` on the two library files; and roughly twenty
`grep`/`sed`/`cat` passes over `app/`, `lib/`, `components/`, `contexts/`,
`hooks/`, `scripts/`, `types/` and `supabase/migrations/`. Every count in this
report — 15 `is_paid` select lists in 15 files, 45/30 for `company_name`, 18
`agencyEntitlementId()` call sites in 12 files, 4 `hasAgencyEntitlement()` call
sites, 0 `canUseAgencyPortalAi()` call sites, one `ALTER TABLE
public.organizations` in the whole migration set, one trigger on `profiles` —
came off one of those greps and can be re-run.

**Nothing was written or edited except this file.** No migration authored, no
guard allow-list or `KNOWN_OPEN` count touched, no gate run, no dev server, no
network call, no database query, no push, no PR.

**READ in full:** `docs/090-active-org-report.md` (OPEN section and the test
procedure around OPEN-1); `lib/acting-org.ts`; `lib/entitlements.ts`;
`lib/usage-tracking.ts`; `components/agency-subscription-gate.tsx`;
`app/api/org/invitations/route.ts`.

**READ in part:** `090_active_org.sql` (the header, section 2's guard trigger and
its COMMENT, and the whole replaced body of `accept_org_invitation`);
`079_organizations.sql` (the `organizations` and `org_members` DDL, PHASE 7's FK
repoint loop, PHASE 8's NOT NULL block, PHASE 9's indexes, the `org_members`,
`organizations` and `usage_tracking` policies, PHASE 12's `handle_new_user`);
`086_member_identity_and_invitations.sql` (the `org_invitations` DDL and its
read-only rationale); `089_org_invitation_lifecycle.sql` (the three policies and
the `"Org admins create invitations"` header); `067_usage_tracking.sql`;
`078_signup_role_trigger.sql`; `lib/capabilities.ts` (`orgRoleFor`,
`loadOrgRole`, the capability map); `lib/org-invitations.ts`;
`lib/feature-flags.ts`; `contexts/paid-user-context.tsx`;
`app/agency/settings/team/team-roster-client.tsx`;
`app/api/org/invitations/{accept,revoke}/route.ts`;
`app/api/projects/route.ts` (the POST gate block);
`app/api/agency/{msa/ai-schedule,payment-synthesis}/route.ts` (gate blocks);
`app/api/admin/{grant-access,users/[userId]/flags}/route.ts`;
`app/api/agency/email-scan/{import,run}/route.ts`;
`app/api/partner/partnerships/claim/route.ts`;
`docs/schema-snapshot-2026-08-13.md` (the `profiles` UPDATE policy row).

**REASONED, and therefore unverified against the live database:** FINDING 1 in
its entirety (the policy shape is read from a snapshot seven days older than 090,
and the grant is assumed from stock Supabase defaults — OPEN-B); FINDING 2's
consequence for a two-membership account, which no account currently has; every
claim in item 2 about what happens to the two non-coincident organizations
(OPEN-A); the 23503 claim about the fallback (OPEN-F, OPEN-G); the statement that
every organization is on Starter (OPEN-D); everything in items 8 and 9, which are
about states that do not exist yet.

**NOT DONE, and the brief did not ask for it:** the migration is not designed and
no SQL was written; the eight gates were not run; the billing provider was not
investigated beyond establishing that none is read in the entitlement path; the
budget spine was not touched.
