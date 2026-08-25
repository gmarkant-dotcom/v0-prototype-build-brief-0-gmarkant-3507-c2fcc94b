# Refusals and notifications: session report

**2026-08-25. Branch `fix/refusals-and-notifications`, based on `2e609da`. Nothing pushed.**

---

## Every phase completed. Nothing was skipped.

| Phase | Outcome | Commit |
|---|---|---|
| 0 | Baseline taken, six gates | — |
| 1 | Invisible refusal fixed, one line | `9f65595` |
| 2 | `/agency/payments` copy corrected, findings established | `f4c6166` |
| 3 | Endpoint verified, bell shipped in both portals | `ab1a310` |
| 4 | Mechanism established, (a2) clean, 094 authored + test + down | `9f80138` |
| 5 | `docs/emitter-rulings-owed.md`, six sentences | `2565619` |
| 6 | Six gates re-run, all match baseline | `2565619` |
| Fix 3 | Pre-apply test corrected after its first real run; two findings recorded | this commit |

**The one thing that did not go to plan, and it is a good outcome, not a bad one:**
Phase 4's framing was that "a colleague would see an empty bell while rows exist for
their company." That is not what is happening. Notifications are user-scoped rows;
there is no company row. The colleague's *read* is fine. The rows were never
**written**. Section 5 below sets this out, and it is why 094 changes an INSERT policy
and not a SELECT one.

---

# 1. The invisible refusal. `9f65595`

**EXECUTED.** One class changed, `z-50` → `z-[60]`, at
`components/upgrade-required-modal.tsx:37`, plus the comment explaining why.

**READ.** `PaidUserProvider` renders `<UpgradeRequiredModal>` as a sibling **after**
`{children}` (`contexts/paid-user-context.tsx:290`). Every Radix dialog portals its
overlay and content to the end of `<body>` (`components/ui/dialog.tsx:41`). Both were
`z-50`.

**REASONED.** Equal z-index in one stacking context is settled by DOM order, and a node
appended to `<body>` comes after the provider's subtree. So a refusal raised from inside
a dialog rendered **under that dialog's own `bg-black/80` overlay**. `checkFeatureAccess()`
returned `false`, the caller returned early, and the user saw a button do nothing at all.

`z-[60]` and no higher, deliberately: it stays under the toast viewport (`z-[100]`,
`components/ui/toast.tsx:19`) and the alert-dialog layer (`z-[550]`,
`components/ui/alert-dialog.tsx:39`). Neither raises a paid-feature gate, and a premium
wall covering a destructive-action confirmation would be a worse bug than the one fixed.

## 1a. The blast radius: every caller, and whether it can fire from inside a dialog

`UpgradeRequiredModal` has exactly **one** import site — `PaidUserProvider` — so the real
caller list is every call to `checkFeatureAccess()`. **Thirteen call sites in nine files.**

| # | Call site | Feature name | Inside a dialog? |
|---|---|---|---|
| 1 | `components/new-project-dialog.tsx:63` | project creation | **YES — Radix `DialogContent`, portaled, `z-50`. This is the demonstrable case.** |
| 2 | `components/stages/stage-03-onboarding.tsx:241` | (none) | In-tree modal, `z-50` (`:1066`). Was already fine — see below. |
| 3 | `app/agency/pool/page.tsx:852` | (none) | No. `toggleBookmark`, called from the card list at `:2102`. |
| 4 | `app/agency/page.tsx:683` | file uploads | No. Page body. |
| 5 | `app/agency/page.tsx:748` | file uploads | No. Page body. |
| 6 | `app/agency/page.tsx:953` | AI output template | No. Page body. |
| 7 | `app/agency/page.tsx:1980` | file uploads | No. Inline `<label>` file input in the page body. |
| 8 | `app/agency/documents/page.tsx:350` | document uploads | No. Toolbar button that *opens* a modal. |
| 9 | `app/agency/magic-rfp/page.tsx:331` | file uploads | No. Page body. |
| 10 | `app/agency/magic-rfp/page.tsx:359` | AI brief structuring | No. Page body. |
| 11 | `app/agency/magic-rfp/page.tsx:416` | file uploads | No. Page body. |
| 12 | `app/agency/magic-rfp/page.tsx:463` | AI output template | No. Page body. |
| 13 | `components/agency-document-library-manager.tsx:156/197/232` | library upload/delete | No. Mounted plainly at `app/agency/documents/page.tsx:191`. |
| 14 | `components/stage-03-onboarding-production.tsx:129` | onboarding deploy | No. Page body; the modal it can open is a *success* modal. |
| 15 | `components/stage-03-onboarding-workflow.tsx:417` | onboarding package send | No. Its `z-[100]` modal (`:1133`) is the post-success one. |

**Why only #1 was actually broken, and it is worth being precise.** An in-tree page modal
at `z-50` (#2, and the pool/documents/network modals) sits **earlier** in the DOM than the
provider's own modal, so the refusal already painted **above** it. The defect needed a
**portaled** competitor, and Radix is the only thing in this codebase that portals.

**So: one of thirteen sites was visibly broken.** The reason the fix is still worth its own
commit is that #1 is *Create Project* — the first paid action a new agency takes — and the
next dialog-hosted gate anybody adds would have inherited the defect silently.

## 1b. Other in-tree overlays with the same shape

Every `fixed inset-0 … z-50` in-tree overlay was enumerated. **Fifteen of them.** None is a
refusal or an error surface, so per instruction none was touched:

`app/agency/documents/page.tsx:668`, `app/agency/pool/page.tsx:2280/2457/2674`,
`app/partner/marketplace/page.tsx:253`, `app/partner/network/page.tsx:1183/1234`,
`app/partner/onboarding/page.tsx:929`, `components/marketplace-content.tsx:319/344`,
`components/stages/stage-03-onboarding.tsx:1066`, `components/request-invitation-modal.tsx:97`.

All are content modals opened by a button on the same page. All are in-tree, so all sit
**behind** any portaled Radix layer and **in front of** nothing that matters. **They are only
at risk if somebody later opens one from inside a Radix dialog.** Reported, not changed.

**OPEN-A — `RequestInvitationModal` is unreachable.** It is rendered by `PaidUserProvider`
beside the upgrade modal and is opened only by `showInvitationRequest()`, which has **zero
callers anywhere** outside the context that defines it. It is dead UI, not a broken layer.
**Settles it:** `grep -rn "showInvitationRequest" app/ components/` returns only
`contexts/paid-user-context.tsx`. Not fixed — deleting live-looking UI is a product call.

## 1c. How Greg reproduces it, as the owner of a paid organization

The hard part is reaching a gate at all: `checkFeatureAccess()` returns `true` early for
`isDemo`, for `isLoading`, for `isAdmin`, for any partner/active-partner role, and for
`isPaid` (`contexts/paid-user-context.tsx:242-259`). **`gmarkant@gmail.com` is `is_admin=true`,
so it passes on the admin arm before entitlement is ever consulted.** Three ways in, easiest
first:

1. **Use a second account, not yours.** Sign up a fresh agency account. Its organization is
   created by the signup trigger with `organizations.is_paid` defaulting to `false`, and it
   is not an admin. Sign in, click **Create Project**, click **Create**.
   - **Before `9f65595`:** nothing happens. No error, no message, no navigation. Open dev
     tools and the upgrade modal **is in the DOM**, behind the dialog's overlay.
   - **After:** the "Premium Feature" modal appears **on top of** the create dialog.
2. **Or flip your own organization.** `UPDATE public.organizations SET is_paid = false WHERE
   id = <your org>;` — but you must **also** clear `profiles.is_admin` for the session, or the
   admin arm short-circuits the gate before entitlement is read. Put both back afterwards.
3. **Fastest confirmation with no data change at all** — this proves the *layering*, which is
   what changed: open any Radix dialog in the agency portal, and in the console run
   `document.querySelectorAll('[class*="z-50"],[class*="z-\\[60\\]"]')`. Before the fix the
   provider's overlay and the dialog overlay both report `z-50`; after, the provider's reports
   `z-[60]`.

---

# 2. `/agency/payments`. `f4c6166`

**One string changed on one page.** No fetch built, route not deleted, not relinked.

### (a) It is an orphan. Reachable by URL only.

**EXECUTED.** `grep -n "href:" components/agency-layout.tsx` returns ten nav items:
`/agency/dashboard`, `/agency/pool`, `/agency`, `/agency/bids`, `/agency/onboarding`,
`/agency/project`, `/agency/clients`, `/agency/documents`, `/agency/usage`, `/faq`.
**`/agency/payments` is not among them.** The only reference anywhere is
`lib/demo-data.ts:457`, an `actionUrl` in demo fixture data.

`/agency/utilization`, `/agency/msa` and `/agency/cashflow` are orphaned the same way —
the directories exist under `app/agency/` and no nav item points at any of them.

### (b) The data exists, and the agency is the one writing it

`payment_milestones` is live and **written by the agency side**:
`app/api/agency/msa/milestones/route.ts` inserts, updates and deletes rows there, driven by
**`/agency/msa`** (six fetch call sites, `app/agency/msa/page.tsx:254-958`).

A real fetch for `/agency/payments` would query `payment_milestones` filtered through
`projects.org_id IN (SELECT current_user_org_ids())`, which is exactly what the live agency
policy already permits: `"Agency can manage payment milestones"`, `USING (project_id IN
(SELECT pr.id FROM projects pr WHERE pr.org_id IN (SELECT current_user_org_ids())))`
(`079_organizations.sql:1505-1512`).

**Whether rows are there for Greg's own account is the one thing not established** — no
statement was run against any database this session. **The query that settles it:**

```sql
SELECT pr.org_id, o.name, count(*) AS milestones
FROM public.payment_milestones pm
JOIN public.projects pr ON pr.id = pm.project_id
JOIN public.organizations o ON o.id = pr.org_id
GROUP BY pr.org_id, o.name ORDER BY o.name;
```

### (c) The asymmetry is the actual finding

**The vendor half works. The agency half is a stub.**

`/partner/payments` is a **live nav item** (`components/partner-layout.tsx:64`) and it really
fetches: `app/api/partner/payments/route.ts` resolves the caller's organizations, resolves
their active partnerships, and reads `payment_milestones` with embeds for project and scope.
It scopes **explicitly** — `.in("vendor_org_id", callerOrgIds)`, `.in("partnership_id",
partnershipIds)` — and RLS is a second wall behind it.

So the same table is: **written by the agency, rendered to the vendor, and invisible to the
agency that wrote it.** That is the thing to decide, not the empty state's prose.

**What the copy says now:** "Not built yet. This page does not read any payment data, so
nothing will appear here as your projects and contracts progress. Milestones you have already
set are visible to your vendors on their side." The last sentence is true and load-bearing —
without it the new copy implies the milestones were lost.

### Vendor-side defect found while establishing (c). REPORTED, NOT FIXED, as instructed.

**`app/api/partner/payments/route.ts:182-190` is a dead query arm.** Its comment says the
`project_id` query exists to "cover NULL `partnership_id` on milestones". It cannot: **all
three** partner SELECT policies on `payment_milestones` require `partnership_id IN (SELECT
p.id FROM partnerships p WHERE p.vendor_org_id IN (…))`, and `NULL IN (…)` is never true. A
milestone with a null partnership is unreadable by any vendor under any of them.

**This is not a leak.** The same arm asks for *every* milestone on an awarded project,
including other vendors' — and RLS refuses those. The wall holds. The arm is simply doing
nothing for its stated purpose, and its comment describes behaviour the policies forbid.
**Settles it:**

```sql
SELECT count(*) FROM public.payment_milestones WHERE partnership_id IS NULL;
```
Zero means the arm was never needed. Non-zero means those rows are invisible to the vendor
they concern, and the fix is on the write side, not the read.

---

# 3. The notification bell. `ab1a310`

## 3a. What the endpoint verification found. It was safe.

**READ, in full, before a line of the bell was written** — `app/api/notifications/route.ts`.

- **Does it filter explicitly, or trust RLS?** **EXPLICITLY, everywhere.**
  `.eq('user_id', user.id)` on the list query (`:34`), on the unread count (`:55`), and on
  **both** arms of the PATCH (`:88`, `:99`). RLS (`"Users can view own notifications"`,
  `USING (user_id = auth.uid())`) is a second wall behind it, not the only one.
  **This is not the vendor-RFP-inbox shape, and the bell was safe to build on it.**
- **Which client?** The **caller's session client**. `requireAuth()` (`lib/api-auth.ts:31`)
  returns `createClient()` from `lib/supabase/server.ts`, which is cookie-scoped and uses the
  anon key. Never the service role.
- **Zero rows?** `notifications: notifications || []`, `unreadCount: count || 0`. **An empty
  array, not an error.** There is no error case for a new account's bell to swallow.

No fix was needed and none was made, so there is no separate query-fix commit.

## 3b. What the bell reuses, and what it does with an unknown type

**Everything is reused. Nothing new was written server-side.** New file:
`components/notification-bell.tsx`. Two insertions: `components/agency-layout.tsx:509` (the
logo block gains a flex row) and `components/partner-layout.tsx:200` (a pure insertion into
the existing right-hand cluster). No layout's fetching or rendering was restructured — the
bell does its own read and is otherwise inert.

- **The GET**, behind `useSWR("/api/notifications?limit=20")` with **no fetcher argument and
  no `refreshInterval`**, so it inherits `SWRProvider` verbatim: `dedupingInterval: 30000`,
  `revalidateOnFocus: false`. **No polling loop was added.** The trade is stated in the file:
  an item arriving mid-session shows on the next navigation. An interval set in a layout
  multiplies across every page in the portal, which is precisely what the constraint forbids.
- **The mark-all-read**, `PATCH { markAllRead: true }`, then `mutate()`. On a failed write the
  badge is left standing rather than zeroed — a count that silently clears itself hides unread
  items permanently.

**Unknown types.** `TYPE_LABELS` holds the eleven keys of `NotificationType`. **Nothing
filters on it**, so an unlisted type is never dropped: it falls through to
`unknownTypeLabel()`, which renders the raw type string legibly (`bid_submitted` →
"Bid submitted") and falls back again to "Update" for a null type. A row with a blank title
renders `"<label> notification"` rather than a correctly-sized empty row. **The
`mapMilestoneGroup` lesson applied in the opposite direction: a visible gap is a bug report,
a silent drop is not.**

**What the bell can actually show today is narrower than eleven, and that is not the bell's
doing.** The live `type` CHECK refuses three of the eleven declared types outright, and five
more permitted ones have never produced a row - see §5b. So the panel renders three types in
practice: `partnership_accepted`, `project_awarded`, `project_assignment`. **The label map was
left at all eleven anyway.** Narrowing it to what happens to exist today would mean the day a
missing writer is fixed, its rows arrive unlabelled - which is the failure the fallback exists
to prevent, reintroduced deliberately.

The map is deliberately **not** imported from `lib/notifications.ts` — that module builds a
service-role client and pulls in `@supabase/supabase-js`, which would land in the client
bundle of every page in both portals to read eleven strings. The duplication's cost is exactly
what the fallback covers.

## 3c. Three states, three sentences

Per the 086 precedent, **empty**, **failed** and **loading** never borrow each other's copy:

- **Loading** → "Loading…". No empty state is rendered before the answer is known.
- **Failed** (transport error **or** an `error` key in the body) → "Notifications could not be
  loaded right now. Reload the page to try again." **The badge is forced to 0 and hidden on
  failure**, so an unreachable endpoint never renders as a confident "0 unread".
- **Empty** → "Nothing here yet" + *"This is where you will see partnership invitations,
  incoming bids, awards and onboarding activity. Nothing has been sent to you so far."* It says
  **which kind of empty** and what would fill it. "You're all caught up" was rejected: it
  claims there were items and they were handled.

---

# 4. The sixteen write sites, classified. Phase 4 (a2).

**READ, all sixteen, one at a time.** Every one routes through `lib/notifications.ts`. The
classification question is *is this addressed to a PERSON or to a COMPANY?*

| # | Site | Type | Title | Addressed to | Client |
|---|---|---|---|---|---|
| 1 | `api/partnerships:584` | `partnership_invitation` | New Partnership Invitation | **COMPANY** (vendor org) | session |
| 2 | `api/partnerships:716` | `partnership_invitation` | New Partnership Invitation | **COMPANY** (vendor org) | session |
| 3 | `api/partnerships:1046` | `partnership_accepted` | Partnership Accepted | **COMPANY** (lead org) | session |
| 4 | `api/partnerships:1200` | `partnership_declined` | Partnership Declined | **COMPANY** (lead org) | session |
| 5 | `api/projects/[id]/assignments:205` | `project_assignment` | New Project Assignment | **COMPANY** (vendor org) | session |
| 6 | `api/projects/[id]/assignments:341` | `project_accepted`/`_declined` | Project Bid Accepted/Declined | **COMPANY** (lead org) | session |
| 7 | `api/projects/[id]/assignments:437` | `project_awarded` | Project Awarded! | **COMPANY** (vendor org) | session |
| 8 | `api/projects/[id]/onboarding-packages:448` | `onboarding_deployed` | Onboarding documents ready | **COMPANY** (vendor org) | session |
| 9 | `api/projects/[id]/onboarding/deploy:176` | `onboarding_deployed` | Onboarding materials sent | **COMPANY** (vendor org) | session |
| 10 | `api/agency/rfp-responses/[id]:1084` | `project_awarded` | Project Awarded! | **COMPANY** (vendor org) | session |
| 11 | `api/partner/rfps/[id]/response:429` | `bid_submitted` | New Vendor Bid / Updated | **COMPANY** (lead org) | session |
| 12 | `api/rfp/guest/[token]:583` | `bid_submitted` | Vendor Bid Updated | **COMPANY** (lead org) | **service role** |
| 13 | `api/rfp/guest/[token]:768` | `bid_submitted` | New Vendor Bid | **COMPANY** (lead org) | **service role** |
| 14 | `lib/magic-token-attach:413` | `project_assignment` | New RFP in your inbox | **COMPANY** (vendor org) | **service role** |
| 15 | `lib/award-partnership-resolution:103` | `partnership_accepted` | Partnership Accepted | **COMPANY — the caller's OWN org** | session |
| 16 | `lib/award-partnership-resolution:169` | `partnership_accepted` | Partnership Accepted | **COMPANY — the caller's OWN org** | session |

## The (a2) answer: all sixteen are company-addressed. There is no personal class.

Not one title or message names an individual. Every message is one company acting on another
— *"{agencyName} has invited you to become a vendor"*, *"{partnerName} has accepted"*,
*"{vendorNameOrEmail} submitted a bid on X"*, *"Congratulations! {agencyName} has awarded you
X"*.

**The one genuinely personal event class in this product writes no notification at all.** A
colleague invitation is addressed to one named individual, and
`app/api/org/invitations/route.ts`, its `accept/` and `revoke/` siblings, and
`lib/org-invitations.ts` contain **zero** notification writes. **EXECUTED:**
`grep -rn "notification\|notify" app/api/org/invitations/ lib/org-invitations.ts` returns
nothing.

**And there is no column that would tell the two apart** — `notifications` carries
`user_id, type, title, message, link, data, read, created_at` and nothing that says "personal".

**So the brief's dilemma resolves, and not by luck.** Both kinds do **not** share the table,
because only one kind exists. But the deeper point is that **the column would not have been
the right place for the distinction anyway**:

> **The leak lives in the fan-out, not in the policy.** A personal notification only reaches
> colleagues if somebody calls `createOrgNotification()` for it, which writes one row per
> member **by construction**. `createNotification()` — one row, one named user — already sits
> beside it and is the correct entry point for anything personal. **Widening the INSERT policy
> cannot make a personal notification reach a colleague; only calling the wrong function can.**

**OPEN-B. The ruling Greg owes, in one sentence:** *any notification addressed to an
individual must be written with `createNotification()` and never with
`createOrgNotification()`, because the org helper fans out over every member by design and no
column on `notifications` would let a policy catch the mistake.*

---

# 5. The colleague mechanism, and 094. `9f80138`

## (a) The exact mechanism, quoted

`"Scoped insert notifications"`, INSERT, `WITH CHECK`, at
`supabase/migrations/079_organizations.sql:1254-1259`:

```sql
CREATE POLICY "Scoped insert notifications"
  ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
  );
```

and the helper it turns on, `079:779-804`:

```sql
CREATE OR REPLACE FUNCTION public.current_user_active_counterparty_user_ids()
RETURNS SETOF uuid ... AS $$
  WITH my_orgs AS (
    SELECT m.org_id FROM public.org_members m WHERE m.user_id = auth.uid()
  ),
  active_counterparties AS (
    SELECT p.vendor_org_id AS org_id FROM public.partnerships p
     WHERE p.lead_org_id IN (SELECT org_id FROM my_orgs)
       AND p.vendor_org_id IS NOT NULL AND p.status = 'active'
    UNION
    SELECT p.lead_org_id AS org_id FROM public.partnerships p
     WHERE p.vendor_org_id IN (SELECT org_id FROM my_orgs)
       AND p.status = 'active'
  )
  SELECT m.user_id FROM public.org_members m
  WHERE m.org_id IN (SELECT org_id FROM active_counterparties);
$$;
```

**Why a colleague fails it.** `my_orgs` is used **only to find the other side**. The final
`SELECT` returns members of `active_counterparties` and nothing else — **the caller's own
organization is never in that set.** So a colleague is not `auth.uid()` and is not in the
counterparty set, and both arms refuse. The caller's own row lands on the first arm, which is
why the fan-out half-succeeds rather than failing outright, which is why nobody noticed.

`lib/notifications.ts:222` already logs it: *"org notification delivered to some recipients,
refused for others"*. Nobody reads logs.

**Which of the sixteen actually hit it: #15 and #16** (`lib/award-partnership-resolution.ts`),
which pass the **agency's own org id** while running on the agency's session client during an
award. Today the awarding user gets "Partnership Accepted" and their colleagues get nothing.
The other eleven session-client sites address a counterparty; the three service-role sites
never saw the policy.

**A second, pre-existing gap, unchanged by 094 and stated so it is not mistaken for one:**
the counterparty arm is **active-partnership-only**, so `notifyPartnershipInvitation()`
(partnership pending) and `notifyPartnershipDeclined()` (no longer active) write **nothing at
all, for anybody**. Widening that arm would let a stranger write into your inbox before you
have agreed to work with them. Left alone on purpose.

## (b) Policy, not query — and why the usual preference does not apply

**It is an INSERT problem, not a SELECT problem.** A colleague reads their notifications
perfectly well: `"Users can view own notifications"`, `USING (user_id = auth.uid())`.

The read-scope class taught that RLS is a wall and the query is the scope, so prefer the query
where either would work. **Here the query cannot work at all — no `SELECT` can return a row
that was never inserted.** So the choice was policy versus a third option:

- **Write through the service role** in `createOrgNotification()`. Rejected. It removes RLS
  from the notification write at **all sixteen** sites, silently changes behaviour at the
  pending/terminated sites, and cannot be reviewed as a diff of a predicate.
- **Widen the INSERT policy.** Chosen. It widens **who may be written to, not who may read** —
  no SELECT policy is touched, so nothing becomes visible to anyone. And it is **strictly
  smaller than what is already live**: the same caller can already write an arbitrary
  notification to every member of every active counterparty organization, i.e. people at other
  companies. This adds people at their own.

## (c) 094 was authored. It is not applied.

**Three files, `9f80138`:**

| File | What it is |
|---|---|
| `supabase/migrations/094_notifications_colleague_scope.sql` | The migration |
| `supabase/migrations/094_notifications_colleague_scope_down.sql` | The rollback |
| `docs/094-preapply-test.sql` | Nine assertions, one paste |

**Apply order, and it is unusually relaxed:** **this file is independent of the deploy.**
Nothing in the repository names `current_user_org_member_user_ids()` or the policy text, and
no column is added, so it may be applied **before the code, after it, or with no code at all**.
Nothing 42703s in either direction. That is the opposite of 092.

**Sequence:** run `docs/094-preapply-test.sql` → dry run 094 (`COMMIT` → `ROLLBACK`) → apply →
run the VERIFICATION block → update `LIGAMENT_CONTEXT.md`.

**The dry-run swap line numbers:**

| File | `BEGIN;` | `COMMIT;` ← swap this one for `ROLLBACK;` |
|---|---|---|
| `094_notifications_colleague_scope.sql` | line **281** | line **339** |
| `094_notifications_colleague_scope_down.sql` | line **85** | line **116** |

Both verified with `grep -n 'COMMIT;' <file>` — exactly one executable occurrence each; every
other mention is inside a comment with no trailing semicolon.

**What it does.** One new helper following every 079 convention (`SETOF uuid`, `SECURITY
DEFINER`, `SET search_path = public, pg_temp`, `CREATE OR REPLACE`, `REVOKE ... FROM PUBLIC`
**and** `FROM anon` by name, `GRANT` to `authenticated` only), and **one `ALTER POLICY`** that
adds a third arm:

```sql
user_id = auth.uid()
OR user_id IN (SELECT public.current_user_org_member_user_ids())
OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
```

**`ALTER POLICY`, not `DROP`-then-`CREATE`.** A `DROP` on a policy name that is not live
**silently no-ops** against this database — 079's own header records that several live policies
exist under names that appear nowhere in this repository. `ALTER` raises `42704` instead.
**The policy count therefore stays at 117**, which is itself a check.

**The pre-apply test, nine assertions, RAISE EXCEPTION mechanism (the third, and the only one
that renders in Greg's client — no fourth invented).** Headline, then tally, then detail; the
self-check (`v_logged <> v_ran`) overrides the headline, including a clean one.

| | Assertion | PASS is |
|---|---|---|
| T1 | Owner → colleague, **before** the fix | **REFUSED** (42501). The defect, demonstrated. |
| T2 | Owner → self, before the fix. **The control.** | SUCCEEDS. Without it a T1 refusal could just mean impersonation failed. |
| T3 | Owner → colleague, **after** | SUCCEEDS. The point of the migration. |
| T4 | Owner → a stranger, after | **REFUSED**. The widening has a boundary. |
| **T5** | **A colleague SELECTs a notification belonging to a different organization** | **0 rows.** The required assertion. |
| T6 | The same colleague SELECTs the row written to them | Exactly 1 row, so T5's zero is a refusal and not a broken read. |
| T7 | The counterparty arm survived the `ALTER` | Both helper names present in `with_check`. |
| T8 | Helper shape and grants | `SETOF uuid`, `SECURITY DEFINER`, `anon` holds no EXECUTE. |
| T9 | Policy count unchanged | before = after. |

Re-running it **after** applying flips T1 to INCONCLUSIVE, which is the proof the apply landed;
the file says so, because otherwise the headline would read "DO NOT APPLY 094 YET" and be
misread.

## (d) The ruling Greg owes anyway

Recorded above as **OPEN-B**, and it is in 094's header too: **anything addressed to an
individual goes through `createNotification()`, never `createOrgNotification()`.** 094 is safe
today because that rule is currently kept by accident (there are no personal notifications).
It needs to be kept on purpose from here.

---

# 5b. What the live `type` CHECK says, and what it does to the bell

**Added 2026-08-25 after the first real run of `docs/094-preapply-test.sql`.**

That run returned **DO NOT APPLY, 3 FAIL and 1 INCONCLUSIVE — and all four were one cause:**
`23514 notifications_type_check`. The test inserted `'bid_submitted'`, which the live
constraint does not permit. **The policy logic itself passed:** T1 demonstrated the defect, T4
proved the widening stops at the caller's own organization, T7 confirmed the `ALTER` extended
the predicate rather than replacing it, and T8/T9 confirmed helper shape, grants and an
unchanged policy count of 117. T5 and T6 were **contaminated, not independent** — T3's insert
never landed, so T6 had no row to read and its zero was correct behaviour. The inserts now use
`'partnership_accepted'`, which is permitted and already present seven times.

**That is a fixed test. The finding underneath it is not about the test.**

`notifications_type_check` permits **eight** values — `partnership_invitation`,
`partnership_accepted`, `project_assignment`, `project_accepted`, `project_declined`,
`new_message`, `document_uploaded`, `project_awarded`. The table contains **three**:
`partnership_accepted` 7, `project_awarded` 4, `project_assignment` 4.

`lib/notifications.ts` declares **eleven** types. **Three of them are not in the constraint at
all.**

### This changes how §4's (a2) classification should be read

The classification stands — every one of the sixteen write sites is company-addressed, and
that was established by reading each title and message, not by inference from what landed. But
it is now clear **why it was so easy to be clean:** the notification surface is far less
exercised than sixteen write sites suggests. **Six of the sixteen cannot write at all**, and of
the ten that can, five permitted types have never produced a row. The bell is being shipped
over an inbox that has been receiving **three** of eleven declared event types.

**None of this was fixed. No missing writer was implemented and no constraint was altered** —
both are out of scope here, and the constraint in particular is a schema change that belongs in
its own numbered migration with its own ruling.

### OPEN-M. Three declared types the table refuses. Six write sites that write nothing.

| Type | Write sites | Consequence |
|---|---|---|
| `partnership_declined` | #4 `api/partnerships:1200` | A vendor declining a partnership tells the agency nothing in-app. |
| `onboarding_deployed` | #8 `onboarding-packages:448`, #9 `onboarding/deploy:176` | A vendor is never told in-app that their kickoff package arrived. |
| `bid_submitted` | #11 `partner/rfps/[id]/response:429`, #12 `guest/[token]:583`, #13 `guest/[token]:768` | **An agency is never told in-app that a bid landed** — the single most useful notification in the product. |

**The two guest-token sites fail too, and that is worth being explicit about:** they run on the
service role, but **a CHECK constraint is not RLS** and the service role does not bypass it. My
§4 table lists those as "service role", which is correct about the policy and says nothing
about the constraint.

Every one of the six is caught: `createOrgNotification()` logs
`"org notification insert failed for every recipient"` with the code, and every call site wraps
it in try/catch. **So six write sites have been failing on every request and the only trace is
a log line nobody reads** — the same silent-failure class as the invisible refusal in §1.

**Settles it:**
```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass AND contype = 'c';

SELECT type, count(*) FROM public.notifications GROUP BY type ORDER BY count(*) DESC;
```

**Greg owes one ruling:** *does the constraint widen to admit the three types the code already
emits, or does the code stop emitting them?* Widening is a one-line `ALTER TABLE … DROP
CONSTRAINT … ADD CONSTRAINT …` in a new migration; it is **not** folded into 094, which must
stay two statements about one policy.

### OPEN-L. Five permitted types with no rows. Three different causes, and the difference matters.

1. **`partnership_invitation`** would tell a vendor company that a lead agency has invited them
   into its pool — it **is** wired (sites #1 and #2) and it **is** permitted, so its absence is
   the RLS refusal already recorded as **OPEN-G**: the partnership is still `pending`, so the
   active-only counterparty arm refuses every recipient.
2. **`project_accepted`** would tell a lead agency that a vendor accepted an invitation to bid
   on a named project — wired at site #6 and permitted, so its absence means that path has
   simply not been exercised in production, not that anything refuses it.
3. **`project_declined`** would tell a lead agency that a vendor declined the invitation to bid
   — same site, same helper, same reading.
4. **`new_message`** would tell the other side of a project that a message was posted to it, and
   it has **no emitter anywhere**: `grep -rn "new_message" app/ lib/ components/` returns only
   the type union at `lib/notifications.ts:256`.
5. **`document_uploaded`** would tell the other side that a document was added to a shared
   project, and it likewise has **no emitter anywhere** — only `lib/notifications.ts:257`.

**So "five permitted types have never been written" is three findings, not one:** one is
refused (1), two are unexercised (2, 3), and two were never built (4, 5). **No writer was
implemented for any of them.**

---

# 6. Gates: Phase 0 baseline against Phase 6

Compared to the numbers taken at the start of this session, **not** to any figure in a
document. `verify-rls` and `policy-audit:guard` were not run — neither reads a `.ts` file and
nothing here could move them.

| Gate | Phase 0 | Phase 6 | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit **0** | exit **0** | none |
| `pnpm build` | succeeds | succeeds, compiled in 9.3s | none |
| `pnpm lint` | **182 problems (154 errors, 28 warnings)**, exit 1 | **182 problems (154 errors, 28 warnings)**, exit 1 | none |
| `identity-columns:guard` | PASSED, 0 findings, **386 files** | PASSED, 0 findings, **387 files** | **+1 file scanned** |
| `org-id-reads:guard` | PASSED. Class B 60 OPEN, 0 REGRESSIONS, 1 IMPROVED, 14 known-open | identical | none |
| `embed-targets` | 0 / 0 / 0, **386 files** | 0 / 0 / 0, **387 files** | **+1 file scanned** |

**Every movement, explained:**

1. **386 → 387 files scanned, in two guards.** `components/notification-bell.tsx` is one new
   file under `components/`, which is a scanned root for both. It contributes **zero** findings
   to either — it names no company identity column and traverses no repointed foreign key. This
   is the only movement in the entire table and it is the new file being counted.
2. **Lint did not move at all, including the new file.** `pnpm lint 2>&1 | grep -c
   "notification-bell"` returns **0**. The 154 errors and 28 warnings are the same pre-existing
   set; nothing was added and nothing was fixed.
3. **`org-id-reads:guard` reports `IMPROVED 1 — lib/entitlements.ts recorded 1, found 0` in
   BOTH runs.** This is a **pre-existing baseline drift, present before this session touched
   anything**, and it is why the Phase 0 baseline was taken before any edit. It is not a
   regression and this session did not cause it. **Lowering the count in `KNOWN_OPEN_MIRROR`
   would have been an edit to a guard allow-list, which was prohibited, so it was left alone
   and is reported here instead.**
4. **The four SQL and Markdown files added by Phases 4 and 5 move no gate.** No gate reads a
   `.sql` file, and none reads `docs/`.

---

# 7. Browser checklist, ordered by risk

**Highest blast radius first.** For each: what to look at, and whether a failure means
**REVERT** or **DEBUG**.

### 1. Every page in BOTH portals still renders. `ab1a310` — **REVERT, do not debug.**

The bell is mounted in `components/agency-layout.tsx` and `components/partner-layout.tsx`.
A mistake there breaks every page in both portals at once, not one screen.

- Load `/agency/dashboard`, `/agency`, `/agency/bids`, `/agency/pool`.
- Load `/partner`, `/partner/rfps`, `/partner/bids`, `/partner/payments`.
- **Also load `/rfp/respond/<token>` and `/partner/rfps/<id>`** — these use `PartnerChrome`
  (the no-`PaidUserProvider` variant), which the bell also sits in.
- **Any blank page, any layout that fails to paint, any console error naming
  `notification-bell` → `git revert ab1a310`.** A shared layout is not a place to debug live.

### 2. The bell's own three states. `ab1a310` — **DEBUG.**

Click it. You should get exactly one of: "Loading…", the honest failure sentence, "Nothing here
yet", or a list. **A panel that is blank, or rows with a label and no text, is the unknown-type
handling failing** — that is contained to one dropdown and is worth debugging rather than
reverting.

Check the network tab: **exactly one `GET /api/notifications?limit=20` per page load, not a
repeating one.** A request every few seconds means an interval crept in and that **is** a
revert.

### 3. Create Project, from a non-entitled account. `9f65595` — **DEBUG.**

Reproduce per §1c. The "Premium Feature" modal must appear **above** the create dialog.
If it appears above a *toast* or above an *alert dialog*, the z-index went too high — but
that is a one-line adjustment, not a revert.

### 4. `/agency/payments`. `f4c6166` — **DEBUG.**

Navigate by URL. It should read "Not built yet". Cosmetic, orphaned, zero blast radius.

### 5. Migration 094. `9f80138` — **NOT A BROWSER STEP.**

Nothing to click. It is not applied, and applying it changes nothing you can see: a colleague's
bell simply starts filling from the next event. **Run `docs/094-preapply-test.sql` and read the
headline; that is the check.** The rollback is
`supabase/migrations/094_notifications_colleague_scope_down.sql` and its own header warns that
a successful rollback also looks like nothing — check V1, do not look at a screen.

### Reaching a paid-feature gate as the owner of a paid organization

Repeated here because it is the step most likely to waste time: **you cannot, from your own
account.** `checkFeatureAccess()` returns `true` on the `isAdmin` arm before entitlement is
consulted, and `gmarkant@gmail.com` is `is_admin=true`. Use a fresh signup, or clear **both**
`organizations.is_paid` **and** `profiles.is_admin` for the duration. §1c has all three routes.

---

# 8. Every OPEN item, with the query or command that settles it

| # | Item | Settles it |
|---|---|---|
| **OPEN-A** | `RequestInvitationModal` is unreachable — `showInvitationRequest()` has no callers. | `grep -rn "showInvitationRequest" app/ components/` → only the context that defines it. |
| **OPEN-B** | The personal-vs-company ruling. Anything addressed to an individual must use `createNotification()`, never the org fan-out. | Product ruling. Nothing to query — the check is a code review rule at each new write site. |
| **OPEN-C** | Does `/agency/payments` get built, deleted, or relinked? Copy is honest now; the surface is still absent. | `SELECT pr.org_id, count(*) FROM payment_milestones pm JOIN projects pr ON pr.id = pm.project_id GROUP BY pr.org_id;` — if rows exist for your org, the page has something to show and is worth building. |
| **OPEN-D** | The vendor payments dead query arm (`api/partner/payments/route.ts:182`). | `SELECT count(*) FROM public.payment_milestones WHERE partnership_id IS NULL;` — zero means the arm was never needed. |
| **OPEN-E** | Is 094 correct against live data? | `docs/094-preapply-test.sql`, one paste. Read the headline. |
| **OPEN-F** | Does any organization actually have a colleague yet? 094 is inert if not. | `SELECT o.name, count(*) FROM org_members m JOIN organizations o ON o.id = m.org_id GROUP BY o.name HAVING count(*) > 1;` — expected: `markant`, 2. |
| **OPEN-G** | The pending/terminated counterparty gap: invitation and decline notifications write nothing for anybody. Not touched by 094. | `SELECT status, count(*) FROM partnerships GROUP BY status;` — the `pending` count is how many invitations produced no in-app notification. |
| **OPEN-H** | `notifications` has **no `CREATE TABLE` anywhere in this repo**. Anything built on it is unreproducible from source. Carried from the design doc (R6), unchanged. | `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' ORDER BY ordinal_position;` — then reconstruct it as a numbered migration. |
| **OPEN-I** | Six emitter rulings. | `docs/emitter-rulings-owed.md`, written this session. Six sentences. |
| **OPEN-J** | `org-id-reads:guard` reports `lib/entitlements.ts` recorded 1, found 0. Pre-existing; the allow-list was not edited because editing it was prohibited. | `pnpm org-id-reads` and lower the `KNOWN_OPEN_MIRROR` entry to 0, or delete it. |
| **OPEN-L** | Five permitted notification types have never been written: `partnership_invitation` (refused, OPEN-G), `project_accepted` and `project_declined` (wired, unexercised), `new_message` and `document_uploaded` (no emitter anywhere). §5b. | `SELECT type, count(*) FROM public.notifications GROUP BY type;` and `grep -rn "new_message\|document_uploaded" app/ lib/`. |
| **OPEN-M** | `lib/notifications.ts` declares three types the live CHECK refuses - `partnership_declined`, `onboarding_deployed`, `bid_submitted` - so **six of the sixteen write sites raise 23514 and write nothing**, including the two service-role ones. Greg to rule: widen the constraint, or stop emitting them. §5b. | `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND contype='c';` |
| **OPEN-K** | Email delivery for notifications. Explicitly deferred — needs the "high priority" ruling. | Not wired. `docs/notifications-design.md` §E has the proposal. |

---

# 9. EXECUTED / READ / REASONED

**EXECUTED.** `npx tsc --noEmit`, `pnpm build`, `pnpm lint`, `pnpm identity-columns:guard`,
`pnpm org-id-reads:guard`, `pnpm embed-targets` — twice each, Phase 0 and Phase 6, and `tsc`
after every edit. Greps over `app/`, `components/`, `lib/`, `contexts/`, `hooks/` for every
`checkFeatureAccess` call site, every `fixed inset-0 … z-` overlay, every `notify*` /
`createOrgNotification` / `createNotification` call site, every `from('notifications')`, every
nav `href:`, and every caller of `attachMagicTokenToPartnerInbox`. Five commits.

**READ in full.** `components/upgrade-required-modal.tsx`; `contexts/paid-user-context.tsx`;
`app/api/notifications/route.ts`; `lib/notifications.ts`; `lib/api-auth.ts`;
`lib/supabase/server.ts`; `components/swr-provider.tsx`; `hooks/useFetch.ts`;
`hooks/use-agency-usage.ts`; `components/stages/stage-06-payments.tsx` (the non-demo branch);
`docs/emitter-coverage.md` §4 and §5.

**READ in part.** `components/agency-layout.tsx` and `components/partner-layout.tsx` (nav
definitions and the two insertion points); `app/api/partner/payments/route.ts` (both milestone
query arms); `079_organizations.sql` (PHASE 6 helpers, the `notifications` and
`payment_milestones` policy blocks); `docs/schema-baseline-2026-08-13.sql` (the three
`notifications` policies and the four `payment_milestones` ones); `092_org_entitlement.sql` and
`docs/092-preapply-test.sql` (for convention only).

**REASONED, and therefore unverified against a live database.** **No statement was executed
against any database this session, and 094 is not applied.** Specifically unverified:
that a colleague INSERT is refused today (T1 exists to prove it); that `ALTER POLICY` behaves
as expected in the Supabase SQL Editor; that the live policy text still matches `079`'s; that
`payment_milestones` holds rows for Greg's organization; and that the notification bell renders
correctly in a browser — **the fix, the bell and the copy change were all type-checked, built
and linted, and none of them was clicked.** §7 is the checklist that closes that gap.

**NOT DONE, deliberately.** No migration applied. No policy changed anywhere except in an
authored file awaiting review. No guard allow-list or `KNOWN_OPEN` count edited. No feature
flag touched. `middleware.ts`, `app/auth/callback/route.ts` and `accept_org_invitation`
untouched. Nothing numbered 093 or lower touched. No email delivery wired. No fetch built for
`/agency/payments` and the route neither deleted nor relinked. The vendor payments defect
reported and not fixed. **Nothing pushed.**
