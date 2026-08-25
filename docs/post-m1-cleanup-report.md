# Post-M1 cleanup: session report

Branch `fix/post-m1-cleanup`, from `ddc02b5`. **Nothing pushed. No migration authored or
applied. No database access sought.**

## Completeness, at the top

**All seven phases were completed.** Nothing was left undone or partially done.

Two items inside phases were deliberately **reported rather than fixed**, and both are called
out where the brief asked for exactly that judgement:

- The **create path can swallow its own refusal** (OPEN-2). Phase 2 asked me to report
  whether it can fail silently, separately from fixing the accept path. It can, and I found
  the mechanism.
- **`/agency/payments` shows false empty-state copy** (OPEN-3). Phase 4 said to report rather
  than paper over anything whose emptiness indicates a defect. This one does.

One item is a scope note rather than a gap: Phase 3's line 12 is **unruled and untouched**, as
instructed, with the analysis below.

### How to read this report

| Marker | Meaning |
|---|---|
| **EXECUTED** | I ran it and the output is quoted |
| **READ** | I read it in the repository at a named file and line |
| **REASONED** | I concluded it from what I read; not observed running |

The live database was never queried. Every claim about live data is either quoted from
`LIGAMENT_CONTEXT.md` / `docs/schema-snapshot-2026-08-13.md` (**READ**) or left as a query for
Greg to run.

---

## Gates: Phase 0 baseline against Phase 7

**EXECUTED**, both times, on this branch.

| # | Gate | Phase 0 | Phase 7 | Movement |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0, 0 errors | exit 0, 0 errors | none |
| 2 | `pnpm build` | exit 0, compiled 9.5s, 173 route lines | exit 0, compiled 8.4s, 173 route lines | none |
| 3 | `pnpm lint` | exit 1, 182 problems (154 errors, 28 warnings) | exit 1, 182 problems (154 errors, 28 warnings) | none |
| 4 | `pnpm identity-columns:guard` | PASSED, 385 files, TOTAL 0 | PASSED, **386 files**, TOTAL 0 | **+1 file scanned** |
| 5 | `pnpm org-id-reads:guard` | PASSED, class B OPEN 60, REGRESSIONS 0, IMPROVED 1 | PASSED, class B OPEN 60, REGRESSIONS 0, IMPROVED 1 | none |
| 6 | `pnpm embed-targets` | 385 files, REPOINTED 0, PERSON 0, TOTAL 0 | **386 files**, REPOINTED 0, PERSON 0, TOTAL 0 | **+1 file scanned** |

`verify-rls` and `policy-audit:guard` were **not run**, per instruction: neither reads a `.ts`
file and nothing in this session could move them.

### Every movement, explained

**There is exactly one, and it is the same one twice.** Guards 4 and 6 scan `app`, `lib`,
`components`, `contexts`, `hooks` and `middleware.ts`, and the file count went 385 to 386.

The session added exactly one new source file in those roots: **`lib/agency-empty-copy.ts`**
(Phase 4). Everything else was an edit to a file that was already being scanned, and
`docs/notifications-design.md` is markdown and outside the roots. Confirmed by
`git diff --name-status ddc02b5..HEAD | grep "^A"`, which lists only that file and the
markdown one.

**Findings did not move in either direction on any guard.** The count that changed is how many
files were looked at, not what was found: guard 4 still reports `org_id 0, lead_org_id 0,
vendor_org_id 0, needs-human-read 0, TOTAL 0 in 0 files`, and guard 6 still reports
`REPOINTED 0, PERSON 0, TOTAL 0 in 0 files`.

**Lint did move mid-session and was put back.** Phase 2's plain `<a href="/">` tripped
`@next/next/no-html-link-for-pages`, taking errors 154 to 155. Rather than accept a new error,
the rule is disabled **on that one line with the reason stated**: the full document load is the
fix, and `next/link` is precisely what would reintroduce the defect. Lint returned to 182 /
154 / 28 and stayed there for Phases 3 to 7. **No guard allow-list and no KNOWN_OPEN count was
edited**, and no comment had to be reworded.

**One pre-existing signal that is NOT mine.** Guard 5 reported, at baseline and unchanged at
the end:

```
CLASS B: these files now have FEWER findings than KNOWN_OPEN_MIRROR records.
  lib/entitlements.ts   recorded 1, found 0
```

It was already there in Phase 0, before I edited anything, and `lib/entitlements.ts` was never
touched this session. Lowering that count is exactly the allow-list edit that is prohibited, so
it is left alone and recorded here. **The guard still passes** - IMPROVED is not a failure.

---

## Phase 1. What the banner condition actually tested

**READ.** `app/join/[token]/join-invitation-client.tsx`, the accepted-outcome branch. The
condition was:

```tsx
{outcome.membershipCount !== null && outcome.membershipCount > 1 && ( ...orange banner... )}
```

`membershipCount` came from `app/api/org/invitations/accept/route.ts`, which counted rows in
`org_members` for the accepter after the RPC returned.

**So it fired on a membership-count test, not on a resolver refusal.** The brief anticipated
both, and this is the worse one.

**REASONED, from three files.** Every account gets an organization and an owner membership at
signup - `handle_new_user()` at `079_organizations.sql` PHASE 12, corroborated by 079 PHASE 2
backfilling one per existing profile. So an accepter always holds their own organization plus
the one they just joined, and `membershipCount > 1` is true for **every accept there has ever
been**. The banner was not wrong for an edge case. It was wrong for all of them, and all three
of its claims were false:

| Claim | Reality | Evidence |
|---|---|---|
| "Ligament cannot yet tell which one you are working as" | It can. `accept_org_invitation()` sets `profiles.active_org_id` to the inviting organization when NULL | `090_active_org.sql:704-706` (**READ**) |
| "creating and editing records will be refused" | Not refused. `resolveActingOrgId()` returns `stored-preference` with an org id | `lib/acting-org.ts` (**READ**) |
| "Until you can switch between them" | The switcher exists and renders on two or more memberships | `components/organization-switcher.tsx:123`, mounted at `agency-layout.tsx:719` and `partner-layout.tsx:234` (**READ**) |

### What replaced it

A membership count cannot answer the question, so the route now asks `resolveActingOrgId()` -
the module every acting-org write path already consults - and returns `actingOrgId`. Four
branches, one of which is the degenerate case:

| State | Copy | Styling |
|---|---|---|
| acting == the org just joined | "You are working as `<org>`, so anything you create will be filed there. You can change organization from the account menu in the sidebar." | Neutral. Information, not a warning |
| acting == a different org | "You are still working as the one you had already selected, so anything you create will be filed there rather than in `<org>`." | Neutral |
| acting == null (`ambiguous` / `preference-refused`) | "...none of them is selected, so creating and editing records will be refused. Choose the one you want to work in from the account menu in the sidebar." | **Amber.** The only branch that earns it |
| RPC did not name the joined org | Only the part true either way | Neutral |

The second branch exists because 090's set-if-null **deliberately does not overrule an existing
choice** (`090_active_org.sql:667-706`), so a second accept leaves the accepter acting for
their earlier pick. Writing "it is acting for the one just joined" unconditionally would have
recreated the same defect for that case.

---

## Phase 2. The accept path, and whether the create path can fail silently

### The three questions, answered

**READ.** The accept flow does **none** of the three things:

- **No session refresh.** `respond()` calls the API and sets React state. Nothing calls
  `refreshSession()`.
- **No org membership refetch.**
- **No hard navigation.** The confirmation exited through `<Link href="/">`, a Next.js **soft**
  navigation, which swaps the React tree and keeps the JS heap.

**So it soft-navigated with stale context, which is the cause the brief predicted.**

**REASONED,** and this is what makes it worse here than on an ordinary page: `SWRProvider` is
mounted in the **root** layout (`app/layout.tsx:5`), so one cache is shared by `/join` and
every portal page, configured `dedupingInterval: 30000` with `revalidateOnFocus: false`. A key
already in that cache is answered without revalidation for thirty seconds and never
revalidated on focus - exactly the window in which someone who accepts and acts immediately is
acting. React state fares worse: `PaidUserContext` resolves entitlement **once on mount** and
holds it, so a tree mounted before the accept holds the answer for the organization this
person used to be alone in.

The accept invalidates precisely those inputs. It adds an `org_members` row and 090 initializes
`profiles.active_org_id`; both feed `resolveActingOrgId()`, which is what
`resolveAgencyEntitlement()` reads to decide entitlement.

### The fix

A plain `<a href="/">` makes the exit a **full document load**, which discards the SWR cache,
every context and every resolved entitlement by construction and rebuilds from the post-accept
database. No cache-busting call to fall out of date, and nothing to remember when the next
provider is written.

The **declined** outcome deliberately keeps `next/link`: declining invalidates nothing a client
caches, so it has no reason to pay for a document load.

**The session is deliberately NOT refreshed.** Nothing about an organization rides in the JWT -
policies resolve membership live through `current_user_org_ids()` and `resolveActingOrgId()`
re-reads `org_members` on every call - so a `refreshSession()` here would be a token call on
the sign-in path that fixes nothing.

### Yes, the create path can fail silently. OPEN-2.

**Asked separately, as instructed, and the answer is yes.** I traced every exit from
`handleCreateProject` (`components/new-project-dialog.tsx`). Most are honest: a non-ok response
renders the error plus the HTTP status, a throw renders an error, and both usage guards open a
modal rather than returning quietly.

**But one of those modals cannot be seen.** **READ:**

- `UpgradeRequiredModal` is a **plain in-tree `<div className="fixed inset-0 ... z-50">`**
  (`components/upgrade-required-modal.tsx:17`), rendered inside `PaidUserProvider`.
- `NewProjectDialog`'s content goes through **`DialogPortal`** to the end of `<body>`
  (`components/ui/dialog.tsx:58-60`), also `z-50`.

**REASONED:** equal z-index in the same stacking context means DOM order decides, and a portal
appended to `<body>` comes after the provider's in-tree div. So when `checkFeatureAccess()`
refuses, the upgrade modal opens **underneath the create dialog and its own
`bg-black/80 backdrop-blur-sm` overlay**. The user clicks "Create Project" and sees nothing:
no error, no message, no navigation. That is the reported symptom exactly.

This composes with the staleness above into a complete account of the one-off: a tree mounted
before the accept resolves entitlement for the accepter's personal organization,
`checkFeatureAccess()` returns false, and the refusal is invisible. Later attempts worked
because the provider had remounted and resolved against markant.

**Not fixed here**, because it is a shared modal behind every paid-feature gate in both portals
and that is a wider blast radius than Phase 2. The remedy is one line; see OPEN-2.

---

## Phase 3. The callback fix, and the unruled default

### What changed: one line

**EXECUTED** (`git diff` filtered to added non-comment lines) - the entire code diff is:

```
+      updatePayload.active_role = role
```

at `app/auth/callback/route.ts:87`, inside `} else if (!existingProfile.role) {`.

**READ.** It is the only site in the repository that can make the two columns diverge.
`handle_new_user()` cannot: `079_organizations.sql:1873-1875` writes `role, active_role,
secondary_role` from `chosen_role, chosen_role, other_role` in one INSERT. The insert branch in
this same function cannot: it writes `role: role, active_role: role`. Every other writer moves
them as a pair. This branch moved one.

### What an existing user's sign-in does differently: nothing

**REASONED, and this is the claim prohibition 3b asked me to state.** The branch is guarded on
`!existingProfile.role`. `LIGAMENT_CONTEXT.md` records that all 18 live accounts carry
`profiles.role` matching their signup choice with zero mismatches (query D4, 2026-08-20), so
**no existing account reaches this branch at all** - before the change or after it. The branch
above it, which handles invite context and metadata-says-partner, is untouched byte for byte,
as is line 12. Nothing else in the file changed.

### Line 12: what removing it would take. NOT CHANGED.

```ts
const role = hasInviteContext ? 'partner' : (metadata.role || 'partner')
```

**READ.** The trigger disagrees with it. `079_organizations.sql` PHASE 12:

```sql
chosen_role := CASE WHEN NEW.raw_user_meta_data->>'role' = 'partner' THEN 'partner'
                    ELSE 'agency' END;
```

**Missing metadata means `'agency'` at the trigger and `'partner'` at the callback.** Two
defaults for one question.

**What breaks if the metadata genuinely lacks a role, REASONED per branch:**

- **The insert branch** (no profile row yet) writes `role: 'partner', active_role: 'partner'`.
  The account lands in the vendor portal. If they signed up as an agency, they see the wrong
  product and must be corrected by hand.
- **The update branch** now writes both columns together, so it is at least self-consistent -
  but it would still write `'partner'` over a profile the trigger had legitimately created as
  `'agency'` with a null role. The columns agree; the value can still be wrong.

**What removing it would take, in order:**

1. **Establish that it never fires.** The trigger writes a non-null role on every signup, so
   `metadata.role` should always be present by the time this runs. That is an assertion about
   live data, not about code - it needs the query below.
2. **Decide what a genuinely absent role means.** Three options: match the trigger and default
   to `'agency'`; refuse and route to a role-picker screen; or leave the profile untouched and
   let the trigger's value stand. The third is the smallest and probably right, since the
   trigger has already made a considered choice by the time the callback runs.
3. **Only then** change line 12, since it also feeds `hasInviteContext`, the insert branch and
   the function's return value - which is the post-authentication routing decision. It is not
   a one-line change and should not be treated as one.

**Recommendation, for Greg to rule:** option 3. Make the callback stop having an opinion about
a role the trigger already decided. That is a real change with real blast radius on every
sign-in, and it belongs in its own session.

### The divergence query. NOT RUN.

```sql
-- Count and list live profiles where role and active_role disagree.
-- IS DISTINCT FROM, so a NULL on one side and a value on the other counts as a disagreement
-- rather than evaporating into NULL the way <> would.
SELECT count(*) AS diverged
FROM public.profiles
WHERE role IS DISTINCT FROM active_role;

SELECT id, email, role, active_role, secondary_role, created_at
FROM public.profiles
WHERE role IS DISTINCT FROM active_role
ORDER BY created_at DESC;
```

Expected to return at least profile `647261c4` (role `partner`, active_role `agency`, signed up
2026-08-23). **The fix is forward-only: it stops new divergence, it does not repair existing
rows.** Any row this returns still needs a deliberate `UPDATE`, and which column is right is a
per-account judgement - `active_role` is what the person has been using, `role` is what they
chose at signup - so it is not safe to blanket-set one from the other.

---

## Phase 4. The empty-state inventory

**EXECUTED**: swept every `page.tsx` under `app/agency` and `app/partner`, resolved the thin
wrappers to their client components, and checked each list surface for a zero-row branch.

### Changed

| Surface | Was | Now |
|---|---|---|
| `/agency/pool` - Active vendors | "No active vendors match your search or filters." **unconditionally** | Filtered copy when any of **six** controls is active; otherwise "No vendors are in your network yet..." |
| `/agency/pool` - Invited | "No invited contacts match your search." **unconditionally** | Filtered copy when the search box has content; otherwise "You have not invited anyone yet..." |
| `/agency/pool` - Discovered | "No discovered contacts match your search." **unconditionally** | Filtered copy when searching; otherwise "No contacts have been added to your pool yet..." |
| `/partner/marketplace` | One branch served both "nobody has opted in" and "your search matched nothing", asserting the first | Split, following `VENDOR_RFPS_EMPTY` |
| Master Documents - "Client documents" | Section **hidden entirely** when empty | Renders with a sentence saying what belongs there. Sort/filter controls stay behind the length check |

The agency side's failure was the **opposite** of the vendor side's. The vendor surfaces said
nothing; the agency surfaces said something, and what they said was the *filtered* explanation
regardless of whether anything was filtering. A brand-new agency that had typed nothing was
told its search matched nothing - false twice over, and it points at the one control that
cannot help.

Copy lives in **`lib/agency-empty-copy.ts`**, mirroring the Aug 21 `lib/vendor-empty-copy.ts`.
The network list's predicate is a named helper rather than a boolean inlined in JSX, because
six controls feed it and the next person to add a seventh would otherwise have to remember to
extend an expression buried in markup - forgetting reintroduces the defect silently, and only
for users who have that one filter set.

### Checked and deliberately left alone: already honest

`/agency/bids` (top-level branches on `search`; the inner per-group message only renders inside
a group that has bids, so a filter genuinely is active), `/agency/project` (`partners.length`
vs `groups.length` distinguish correctly), `/agency/clients`, `/agency/utilization`,
`/agency/usage`, `/agency/msa`, the agency dashboard's activity and projects blocks,
`/partner/network` (three lists, all branch), `/partner/projects`, `/partner/onboarding` (with
loading and error guards), and the vendor surfaces fixed on Aug 21.

`/partner/payments` deserves a note: its inner "No projects match this filter." **cannot** be
reached with no filter active, because an outer guard renders "No awarded engagements with this
agency yet." before the filter select exists. Correct as written.

Settings and wizard pages map over static config constants (`DESIGNATION_KEYS`,
`INSURANCE_KEYS`, `STATUS_OPTIONS`, `allDisciplines`), not query results. Not list surfaces.

The dashboard's **"Needs your attention"** block is untouched, as ruled. It already reads
correctly ("You're all caught up.").

### Reported rather than papered over: OPEN-3

`/agency/payments`. See the open items.

---

## Phase 5. The nav, enumerated before and after

### Route enumeration

**EXECUTED.** `diff` of the unique `href` sets in each layout file, HEAD against working tree:

```
AGENCY ROUTE SET IDENTICAL
PARTNER (components/partner-layout.tsx) IDENTICAL ROUTE SET
```

The agency file has **one fewer href line** and the route set is unchanged: the hardcoded
dashboard link in the old Overview block is now supplied from `navSections` instead of being
written twice.

| Before | After |
|---|---|
| **Overview** | **HQ** |
| ◉ Summary Dashboard - `/agency/dashboard` | ◉ Summary Dashboard - `/agency/dashboard` |
| | ▣ Vendor Pool - `/agency/pool` *(moved here, number dropped)* |
| **BID REQUESTS** | **Workflow** |
| 00 Vendor Pool - `/agency/pool` | *(moved to HQ)* |
| 01 RFP Broadcast - `/agency` | 01 RFP Broadcast - `/agency` |
| 02 Bid Management - `/agency/bids` | 02 Bid Management - `/agency/bids` |
| 03 Onboarding - `/agency/onboarding` | 03 Onboarding - `/agency/onboarding` |
| 04 Delivery Performance - `/agency/project` | 04 Delivery Performance - `/agency/project` |
| **Resources** | **Resources** *(unchanged)* |
| ◐ Client Profiles - `/agency/clients` | ◐ Client Profiles - `/agency/clients` |
| □ Master Documents - `/agency/documents` | □ Master Documents - `/agency/documents` |
| ▤ Usage - `/agency/usage` | ▤ Usage - `/agency/usage` |
| ? FAQ - `/faq` | ? FAQ - `/faq` |

Plus the sub-links inside the two dropdown items, all unchanged: `/agency/brief`,
`/agency/magic-rfp` (RFP Broadcast); `/agency/pool`, `/agency/pool?import=email` (Vendor Pool).

**Vendor side, one change as ruled:** `00 Agency Network - /partner/network` becomes
`▣ Agency Network - /partner/network`. Number dropped, href unchanged, **group unchanged**.

### Active state, verified item by item

The HQ block used to be a **hand-written copy** of the loop's markup, with its own duplicated
active test and its own duplicated tooltip string - and the `hasPoolDropdown` branch that gives
Vendor Pool its hover dropdown and mobile inline list existed **only in the loop**. Moving the
item across that boundary by hand would have meant re-implementing it and losing the dropdown.
Both blocks now render through one `NavSectionBlock`, so an item behaves the same wherever it
is listed.

| Item | Test | Resolves |
|---|---|---|
| Summary Dashboard | `pathname === href \|\| startsWith(href)` | On `/agency/dashboard`. **Widened** from bare equality; checked - there are no routes beneath `/agency/dashboard`, so it highlights on exactly the same pathnames |
| Vendor Pool | `PoolNavItem`, unchanged | `/agency/pool` and `/agency/pool/<id>` |
| RFP Broadcast | `RfpBroadcastNavItem`, `pathname === "/agency"` exactly | `/agency` only. This is why `/agency` is excluded from the startsWith arm - it prefixes every agency route |
| Bid Management | equality or startsWith | `/agency/bids` |
| Onboarding | equality or startsWith | `/agency/onboarding` |
| Delivery Performance | equality or startsWith | `/agency/project`, **and also `/agency/projects/<id>`** - see OPEN-6 |
| Client Profiles | equality or startsWith | `/agency/clients` and `/agency/clients/<id>` |
| Master Documents | equality or startsWith | `/agency/documents` |
| Usage | equality or startsWith | `/agency/usage` |
| FAQ | equality or startsWith | `/faq` |

**Tooltips and dropdowns moved with the item.** Vendor Pool keeps `hasPoolDropdown`, so its
hover caption, its two sub-links and its mobile inline list travel with it. Summary Dashboard's
tooltip is now read from `navSections` rather than duplicated inline - same string.

### Not done, deliberately

**00 Budgeting does not exist** - not an item, not a stub, not "coming soon".
**Client Profiles is not renamed** to "Clients + Projects". Both are OPEN-4 and OPEN-5.

---

## Open items

Each with the query, command or file that settles it.

### OPEN-1. Colleague in-app notifications are refused by RLS. **Live, and silent.**

`lib/notifications.ts` rules that a notification goes to every member of the organization. The
live INSERT policy admits your own row or an **active partnership counterparty's**; a colleague
in your own organization is neither, so their row fails `WITH CHECK`. The code already knows -
it retries one row at a time and logs `"delivered to some recipients, refused for others"`.
With `COLLEAGUE_INVITATIONS` live, **a colleague is being notified of nothing in-app**, and the
only evidence is a Vercel log line. Detail in `docs/notifications-design.md` §B3.

```sql
SELECT polname, polcmd, pg_get_expr(polwithcheck, polrelid) AS with_check,
       pg_get_expr(polqual, polrelid) AS using_qual
FROM pg_policy WHERE polrelid = 'public.notifications'::regclass;
```

### OPEN-2. The Create Project button can do nothing at all, visibly. **Live.**

`UpgradeRequiredModal` is an in-tree div at `z-50`
(`components/upgrade-required-modal.tsx:17`); every Radix dialog portals to the end of `<body>`
at the same `z-50` (`components/ui/dialog.tsx:58-60`). Equal z-index, so DOM order decides and
the refusal renders **under** the dialog that asked for it.

**Settles it in the browser, no query needed:** sign in as an account whose acting organization
is not paid, open Create Project, click Create. Nothing visible happens. Inspect the DOM and
the upgrade modal is present, behind the dialog overlay.

**Remedy, one line:** raise `UpgradeRequiredModal` above the dialog layer - change `z-50` to
`z-[60]` at `upgrade-required-modal.tsx:17`. It currently either renders alone (unchanged) or
renders invisibly (broken), so raising it is strictly an improvement. **Not applied here**
because it is a shared modal behind every paid-feature gate in both portals.

### OPEN-3. `/agency/payments` tells the user something false. **Live, not nav-reachable.**

`Stage06Payments` renders "Payment milestones and vendor invoices will appear here once
contracts are executed and projects are underway." **Nothing will ever appear there.**
`components/stages/stage-06-payments.tsx:97-99`:

```ts
const payments      = isDemo ? demoPayments : []
const clientPayments = isDemo ? demoClientPayments : []
const cashflowData   = isDemo ? demoCashflowData : []
```

and `if (!isDemo)` returns the EmptyState before anything else runs. There is **no fetch in the
component**. Emptiness there does not mean "no data yet", it means the surface was never built.
Rewriting the sentence would paper over an unbuilt feature with better prose, which is what
Phase 4 said not to do.

**Settles it:** `grep -n "fetch\|supabase" components/stages/stage-06-payments.tsx` returns
nothing. It is not in the agency nav; it is reachable by URL only. **Greg to rule:** build it,
remove the route, or change the copy to say plainly that it is not available yet.

### OPEN-4. 00 Budgeting. **Owed.**

Deliberately absent from the nav. Waits on a workstream that has not started. Adding a disabled
or "coming soon" item would name an absent feature in a live nav.

### OPEN-5. "Client Profiles" to "Clients + Projects". **Owed, ruled but blocked.**

The rename is ruled. It depends on a project repository organised by client, which does not
exist. **Settles it:** when `/agency/clients/[id]` lists that client's projects, the rename
becomes true and can ship. Today it would describe a feature that is not there.

### OPEN-6. Delivery Performance highlights on project detail pages. **Pre-existing.**

`/agency/project` is the href; the startsWith arm also matches `/agency/projects/<id>`, which
is a different page (`app/agency/projects/[id]/page.tsx`). So opening a project detail
highlights Delivery Performance. **The expression is unchanged from the old loop** - not
introduced by the restructure. **Remedy:** treat `/agency/project` like `/agency` and test it
by equality, or give the two pages less collidable paths.

### OPEN-7. The vendor nav has no sections. **Owed.**

The vendor portal is a horizontal top bar with no section headers, so it has nowhere to put
HQ / Workflow / Resources. Converting it is scoped separately and was explicitly not attempted.
The two portals now agree on numbering; they do not yet agree on grouping.

### OPEN-8. `notifications` has no DDL on disk. **Pre-existing, Aug 13 discovery stands.**

Queries in `docs/notifications-design.md` §B1.

### OPEN-9. `role` / `active_role` divergence in live rows. **Forward-only fix.**

Query in Phase 3 above. The callback fix stops new divergence; existing rows still need a
deliberate per-account `UPDATE`.

### OPEN-10. `lib/entitlements.ts` IMPROVED signal on guard 5.

`recorded 1, found 0`. Present at baseline, file never touched this session. Lowering the count
is the prohibited allow-list edit, so it is left for Greg. The guard passes regardless.

---

## Browser checklist, ordered by risk

Walk these in order. **Steps 1 and 2 are revert-not-debug.**

### 1. Sign in as an existing account. **HIGHEST RISK.**

Sign in as `gmarkant@gmail.com`, then as `gmarkant@icloud.com`.

**Expected: absolutely nothing different.** Sign-in completes, you land where you always land,
and your portal is the one you were in before. Check `/agency/settings/user` (or the partner
twin) still shows the role you expect, and that the Switch to Vendor Mode toggle still behaves.

**This is the callback change.** It is guarded on a missing `profiles.role`, and no live
account has one, so it should be unreachable for every existing user.

> **If sign-in fails, or lands anybody in the wrong portal: REVERT, do not debug.**
> `git revert ab4e8b4` - Phase 3 is its own commit touching one file, and reverting it takes
> nothing else with it.

### 2. Every agency nav item loads, and the active state highlights the item you are on.

The nav renders in a **shared layout**, so a mistake breaks every agency page at once. Visit
each and confirm the page loads **and** the correct sidebar item is highlighted (accent text
plus the dot on the right):

| # | Click | Lands on | Should highlight |
|---|---|---|---|
| 2.1 | HQ - Summary Dashboard | `/agency/dashboard` | Summary Dashboard |
| 2.2 | HQ - Vendor Pool | `/agency/pool` | Vendor Pool |
| 2.3 | Workflow - 01 RFP Broadcast | `/agency` | 01 RFP Broadcast |
| 2.4 | Workflow - 02 Bid Management | `/agency/bids` | 02 Bid Management |
| 2.5 | Workflow - 03 Onboarding | `/agency/onboarding` | 03 Onboarding |
| 2.6 | Workflow - 04 Delivery Performance | `/agency/project` | 04 Delivery Performance |
| 2.7 | Resources - Client Profiles | `/agency/clients` | Client Profiles |
| 2.8 | Resources - Master Documents | `/agency/documents` | Master Documents |
| 2.9 | Resources - Usage | `/agency/usage` | Usage |
| 2.10 | Resources - FAQ | `/faq` | (leaves the portal) |

Also confirm: the section headers read **HQ**, **Workflow**, **Resources**; the Workflow run is
**01 to 04 with no 00**; and there is **no Budgeting item anywhere**.

> **If any agency page fails to render: REVERT, do not debug.** `git revert 29a944f` - Phase 5
> is its own commit touching only the two layout files.

### 3. Vendor Pool under HQ, in full.

- 3.1 It appears under **HQ**, beneath Summary Dashboard, with an icon and **no "00"**.
- 3.2 It loads `/agency/pool`.
- 3.3 **Desktop:** hover it. The dropdown still appears, with the caption "Manage your vendor
  network..." and both links, **Vendor Pool** and **Import Vendors**.
- 3.4 `Import Vendors` goes to `/agency/pool?import=email` and still opens the import flow.
- 3.5 Open a vendor's detail page (`/agency/pool/<id>`). **Vendor Pool stays highlighted.**
- 3.6 **Mobile / narrow window:** the inline sub-list appears beneath it instead of the hover
  card.
- 3.7 **Vendor portal:** Agency Network shows **no "00"**, still loads `/partner/network`, and
  is still in its usual position in the top bar. The numbered run reads 01 to 04.

### 4. Empty states, both portals.

Best seen on an account with an empty pool; otherwise use the search box to force the filtered
variant and confirm the two messages differ.

- 4.1 `/agency/pool`, **no search, no filters**, empty sections: each reads "No vendors are in
  your network yet...", "You have not invited anyone yet...", "No contacts have been added to
  your pool yet...". **None should mention a search.**
- 4.2 `/agency/pool`, type nonsense into the search box: all three switch to the "match your
  search" wording.
- 4.3 `/agency/pool`, clear the search, set a **status or discipline filter** that matches
  nothing: the Active vendors section shows the **filtered** message. This is the six-control
  predicate.
- 4.4 `/agency/documents`: the **Client documents** section is now visible even with no client
  documents, reading "No client documents yet...". Its sort and filter controls are hidden.
- 4.5 `/partner/marketplace`, no search: "No discoverable agencies right now" (unchanged).
- 4.6 `/partner/marketplace`, search for nonsense: "No agencies match your search".
- 4.7 The agency dashboard's **"Needs your attention"** still reads "You're all caught up."
  when empty. **Untouched - confirm it did not change.**

### 5. The accept confirmation copy. **Needs a NEW plus-address.**

Use **`gmarkant+markant2@gmail.com`**. Do **not** reuse `gmarkant+markant1@gmail.com`: it is
already a member of markant, so a re-invite fails at accept on
`org_members_org_user_unique` even though the pending slot is free.

- 5.1 Invite `gmarkant+markant2@gmail.com` to markant from `/agency/settings/team`.
- 5.2 Open the email, follow `/join/<token>`, sign up or sign in, and accept.
- 5.3 **The confirmation must NOT show the orange banner.** Expect a neutral panel:
  "Your account now belongs to more than one organization. You are working as markant, so
  anything you create will be filed there. You can change organization from the account menu in
  the sidebar."
  **No mention of contacting support. No claim that creating records will be refused.**
- 5.4 Click **Go to Ligament**. It is now a full page load - the browser genuinely reloads
  rather than transitioning instantly. That is the Phase 2 fix and it is the intended
  behaviour.
- 5.5 Navigate into the agency portal and **create a project immediately**. It should succeed
  first time. This is the silent no-op case.
- 5.6 Open the sidebar account menu and confirm the **organization switcher** lists both
  organizations with markant selected.
- 5.7 Switch to the other organization, then re-open `/join/<token>` for a *second* invitation
  if one is handy: the copy should now read "You are still working as the one you had already
  selected..." - the second branch.

### Which failures mean revert

| Step | On failure |
|---|---|
| **1** | **REVERT `ab4e8b4`.** Sign-in is every user, including Greg. Do not debug a locked-out estate |
| **2** | **REVERT `29a944f`.** A shared layout that fails takes every agency page with it |
| 3 | Debug. Contained to `PoolNavItem` and `navSections`; nothing else depends on them |
| 4 | Debug. Copy only, no behaviour |
| 5.3, 5.7 | Debug. Copy only |
| 5.5 | Debug **and check OPEN-2 first** - look for the upgrade modal hidden behind the dialog before assuming the accept path is at fault |

---

## Commits

| SHA | Phase | Scope |
|---|---|---|
| `f90d13a` | 1 | Accept confirmation copy + `actingOrgId` from the resolver |
| `d557458` | 2 | Post-accept exit becomes a full document load |
| `ab4e8b4` | 3 | **Own commit, one file, one line.** Callback writes both role columns |
| `b58f520` | 4 | Honest empty states + `lib/agency-empty-copy.ts` |
| `29a944f` | 5 | **Own commit, two layout files.** HQ / Workflow / Resources |
| `e162267` | 6 | `docs/notifications-design.md`, design only |

Nothing pushed. No migration authored, applied, or sought. `middleware.ts` untouched. No RLS
policy widened. No feature flag read or set. No migration numbered 093 or lower modified.
`accept_org_invitation` untouched. No guard allow-list or KNOWN_OPEN count edited. No value
read from any `.env` file.
