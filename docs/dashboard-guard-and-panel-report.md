# Dashboard guards and the notifications panel: session report

**2026-08-26. Branch `fix/dashboard-guard-and-panel`, based on `cc58d29`. Nothing pushed.**

| # | Commit | What |
|---|---|---|
| 1 | `cfd3751` | `lib/fetcher.ts` checks `res.ok` |
| 2 | `b1d2360` | Partner dashboard: three optional chains |
| 3 | `ccc3530` | Agency dashboard: one shape check at the existing guard site |
| 4 | `2696742` | Notifications panel: `bg-card` → `bg-popover` |

**Gates: `npx tsc --noEmit` exit 0 after every commit; `pnpm build` compiled successfully in
10.8s.** The other six were not run, per instruction.

---

# 1. The route's zero-row shape. It was never the cause.

**READ.** `app/api/partner/dashboard/route.ts:466-479` returns **one complete object literal**:

```ts
return NextResponse.json({
  needsResponse: { items: needsResponse, expiredCount, onboardingPending },
  funnel: { openRfps, bidsSubmitted, bidsByStatus, winRate: {...}, agencyRelationships },
  reliability,
  activity: recentActivity,
}, { headers: noStoreHeaders })
```

At zero rows `needsResponse` is `{ items: [], expiredCount: 0, onboardingPending: [] }`. **The
key is never omitted and the object is never sparse.** There is no zero-row shape this code
had not seen, and nothing about the route was changed.

**So the brief's premise did not hold, and the Aug 21 read-scope fix is not implicated.** The
real cause is one line elsewhere.

## What actually put an object without `needsResponse` into the component

`hooks/useFetch.ts` uses `lib/fetcher.ts`, which was:

```ts
export const fetcher = (url: string) => fetch(url).then((res) => res.json())
```

**No `res.ok` check.** Four non-success bodies exist on this route, all JSON:

| Source | Status | Body |
|---|---|---|
| `requirePartnerRole()` → `requireAuth()` | 401 | `{ error: "Unauthorized" }` |
| `requirePartnerRole()` role check | 403 | `{ error: "Vendors only" }` |
| `route.ts:118` — any of three queries erroring | 500 | `{ error: "Failed to load dashboard data" }` |
| `route.ts:483` — catch-all | 500 | `{ error: "Failed to load dashboard data" }` |

All four were parsed and handed to the component **as `data`**. SWR never threw, `error`
stayed undefined, `isLoading` went false.

**And that is exactly the state the optional chain does not cover.** `a?.b.c` short-circuits
the **entire** chain when `a` is nullish — the case it was written for. It does **not**
short-circuit when `a` is an object that merely lacks `b`: `?.` proceeds, and `.c` is read off
`undefined` before `?? []` is ever reached. The `??` was never a guard here.

**REASONED, not established:** which of the four fired at 20:50 UTC on Aug 25. All four
produce it identically. A 401 on an expired session is the most likely by frequency, but the
Sentry event's request data would settle it and I did not have it.

---

# 2. The sweep. Every instance, and what I did with each.

**EXECUTED:** `grep -nE "\?\.[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$]"` over both dashboards, then
a read of every component either page renders that consumes the same payload.

| # | Location | Shape | Verdict |
|---|---|---|---|
| 1 | `app/partner/page.tsx:387` `dashboardData?.needsResponse.items ?? []` | Optional chain one level short | **FIXED** `cfd3751`/`b1d2360` |
| 2 | `app/partner/page.tsx:388` `…needsResponse.expiredCount ?? 0` | Same | **FIXED** |
| 3 | `app/partner/page.tsx:391` `…needsResponse.onboardingPending ?? []` | Same | **FIXED** |
| 4 | `app/partner/page.tsx:673` `funnel?.winRate.rate` | Same shape exactly | **NOT FIXED — cannot throw.** See below |
| 5 | `app/agency/dashboard/page.tsx:828-833` | Truthiness guard, different mechanism | **FIXED** `ccc3530` |

**`app/agency/dashboard/page.tsx` contains ZERO instances of the optional-chain shape.** It
uses no optional chaining on the payload at all. That is why the sweep as literally specified
would have returned nothing there, and why instance 5 needed your ruling rather than my
reading.

## Instance 4 — why it cannot be empty

`funnel` is itself `dashboardData?.funnel` (`:393`). On an error body that evaluates to
`undefined`, so `funnel?.winRate.rate` short-circuits at the `?.` and never reads `.rate`. It
would only throw with `funnel` **defined** and `winRate` **missing**, and the route emits
`funnel` as one complete literal at `:469-474` with `winRate` always present.

**One line note, as ruled:** `:677` already reads `funnel.winRate.awarded` with **no guard at
all**, inside a `funnel && …` truthiness check. If `winRate` ever did go missing, `:677`
breaks before `:673` does — so hardening `:673` alone would move the crash three lines down
rather than remove it.

## Instance 5 — the agency dashboard, and the mechanism I chose

**The defect.** `if (!dashboardData) return <DashboardSkeleton />` is a truthiness check. An
error body is an object, so it passed, and `dashboardData.attention` was `undefined`.
`AttentionQueue` (`:205`) does `for (const r of data.bidsAwaitingReview)` — **a throw inside
`for...of` during render**, which takes out the entire dashboard body rather than one row.

**Latent, not currently breaking**, exactly as you said: it fires only on 401/403/500 and the
dashboard renders correctly the rest of the time. That explains why it has no Sentry history.

### The mechanism: one predicate, one call site, bounded depth

I did **not** write five per-component guards. `dashboardPayloadGaps()` runs once at
`:855-861`, the single point where the payload crosses from the page into the components.

**Depth rule: every value a component actually iterates or reads — and stop there.**

| Section | Where it is consumed | Depth checked |
|---|---|---|
| `attention` | `AttentionQueue` iterates **four separate arrays inside it** — `:205`, `:215`, `:228`, `:238` | **one level in**: the key, plus all four arrays |
| `activity` | `ActivityFeed` reads `items.length` `:603`, `:609` | top-level key |
| `projects` | `RecentProjectsList` does `projects.slice()` `:647` | top-level key |
| `checklist` | `GettingStartedChecklist` reads booleans | top-level key |
| `funnel` | `FunnelMetrics` reads numbers | top-level key |

`attention` is the only one that needed depth, because it is the only component handed a
container and left to iterate its contents. Going deeper anywhere else would put this page in
the business of validating the internals of five components' props. `Array.isArray` rather
than a null check, since a null and a non-array both break a `for...of`.

### What a genuinely partial 200 does now — the trade, stated

**It renders the skeleton, indefinitely, and logs which sections were missing.** There is no
path out until the payload is whole.

**I chose that over defaulting the missing sections to empty arrays, deliberately.** On this
page, defaulting would print **"Needs your attention (0)"** — an all-clear — for a response
that never carried the attention data. A false all-clear on an attention queue is read as
fact and never reported. An unresolving skeleton is visibly unfinished and gets reported
within the hour. Given the choice between a silent lie and a visible hang on *this* surface,
the hang is the lesser harm.

**The branch is unreachable from any current response.** The route returns one complete
literal or an error, and after commit 1 an error body no longer arrives as `data`. So it is a
backstop against a **future** route that learns to answer partially — which is precisely when
a silent all-clear would be most expensive to trace. The `console.error` is the half that
keeps the skeleton diagnosable rather than a bare hang.

---

# 3. Every consumer that reads `data.error` off a failed response

**You asked for this listed rather than asserted empty. It is empty, and here is the working.**

**EXECUTED:** `grep -rn "useFetch<\|useFetch("` across `app/`, `components/`, `hooks/`,
`lib/`. **Eight consumers, all eight read.**

| # | Consumer | Reads | Reads `data.error`? |
|---|---|---|---|
| 1 | `app/agency/bids/page.tsx:532` | `data?.responses ?? []` | No |
| 2 | `app/agency/project/page.tsx:644` | `engData?.projects?.find(…)` | No |
| 3 | `app/agency/project/page.tsx:649` | `reviewsData?.reviews ?? []` | No |
| 4 | `app/agency/dashboard/page.tsx:771` | `dashboardData.attention` etc. | No |
| 5 | `app/partner/page.tsx:162` | `dashboardData?.needsResponse…` | No |
| 6 | `app/partner/projects/page.tsx:660` | `data?.projects ?? []` | No |
| 7 | `components/partner-rfp-surface.tsx:495` | `data?.rfps ?? []` | No |
| 8 | `components/partner-rfp-surface.tsx:498` | `bidsData?.bids ?? []` | No |

**Every `data.error` read in the repository belongs to a raw `fetch()` call with its own
`res.ok` check** — 30 sites across `agency/msa`, `agency/pool`, `partner/network`,
`partner/onboarding`, `rfp/respond`, `role-toggle`, `spreadsheet-import-panel` and others.
None goes through `lib/fetcher.ts`. **The hazard set is genuinely zero, and the change is
safe for that reason and not by assumption.**

## What the eight see now, which is a real behaviour change for three of them

`data` → `undefined`, `error` → `Error("HTTP 401")`, `isLoading` → `false`. So `data?.x ?? []`
still yields `[]` and nothing regresses in what renders.

**But three surfaces have error UI that could never fire until now:**

- `app/partner/projects/page.tsx:764` — *"Failed to load projects. Please refresh."*
- `components/partner-rfp-surface.tsx:659`, `:716`, `:740` — three error branches

They are written, correct, and were **unreachable for HTTP failures**, because `error` was
never set. Until today those surfaces answered a failed request with a **confident empty
state**: a vendor whose session had expired was told they had no RFPs and no projects. **That
quiet half is worse than the crash**, and turning it on is the second reason for commit 1
rather than a side effect of it.

Two footnotes: `app/agency/bids/page.tsx:532` destructures `error` and **never uses it**
(verified by reading `:532-760`), so nothing changes there. And throwing puts these requests
under `SWRConfig`'s `errorRetryCount: 2`, so a failure is attempted three times before
`error` settles — already true of every provider-fetcher consumer, now also true here.

---

# 4. Two fetchers, two behaviours, one codebase

**READ.** They were genuinely different:

| | `lib/fetcher.ts` (before) | `components/swr-provider.tsx:16-21` |
|---|---|---|
| `res.ok` check | **none** | `if (!res.ok) throw new Error(\`HTTP ${res.status}\`)` |
| On 401/500 | error body returned as data | throws |

**Which consumers use which.** `useSWR(url)` with **no fetcher argument** inherits
`SWRProvider`'s inline one; `useFetch()` passes `lib/fetcher.ts` explicitly, which overrides
it. So:

- **`lib/fetcher.ts`** — the eight `useFetch` consumers in §3.
- **`swr-provider.tsx`'s inline fetcher** — `hooks/use-agency-usage.ts` (`useSWR<…>("/api/agency/usage")`) and `components/notification-bell.tsx` (`useSWR<…>("/api/notifications?limit=20")`).

**That split is the whole explanation for why the same failure looked like two different
bugs.** The notification bell already handled a failed load honestly — it has a distinct
"could not be loaded" state and forces the badge to zero — *because it happened to be written
with `useSWR` and inherited the checking fetcher*. The partner dashboard crashed and the
vendor RFP list lied, because both reached for `useFetch`. **Nothing about the authors'
intent differed; only which hook they picked.**

**Should they be one? Yes.** As of `cfd3751` they are **behaviourally identical** — same
check, same throw, same message — so the duplication is now pure, and collapsing
`swr-provider.tsx` onto the exported `fetcher` would be a mechanical change with no semantic
content.

**NOT DONE THIS SESSION, as instructed.** It touches every SWR call site in the app and
belongs in its own change. **OPEN-N.**

---

# 5. The panel. Diagnosis, and why the vendor side is unaffected.

## It is (a): no solid background. Not z-index, not a layout blur.

**The line that decides it — `app/globals.css:12`:**

```css
--card: rgba(255, 255, 255, 0.07);
```

**7% white. 93% transparent.** The agency branch of the panel was `bg-card`, so the
dashboard's "Needs your attention" rows and metric cards rendered straight through it.

**Ruled out, with the lines that rule them out:**

- **Not z-index.** `components/agency-layout.tsx:497` — `<aside className="fixed … z-20">`;
  `:838` — `<main className="ml-[260px] min-h-screen relative z-10">`. 20 > 10, so the aside's
  entire subtree already paints above the page. The panel's own `z-30` sits above the aside's
  children. **Layering was correct throughout; the panel was simply see-through.**
- **Not a layout blur or opacity.** `globals.css:211-215` — `.glass { background:
  var(--surface-glass); backdrop-filter: blur(20px); }`. That is on the `<aside>` **itself**.
  `backdrop-filter` filters what is behind the element it is set on; **it does not make
  descendants translucent.** No opacity is applied to the panel by either layout.

## Why the vendor side is unaffected — and it is not the same token

**They are different classes, and that is the finding.** The component branches on `variant`:

```
isAgency ? "… bg-card border-border"      ← rgba(255,255,255,0.07)
         : "… bg-white border-black/10"   ← flat opaque
```

The vendor branch never used `--card` at all. **The asymmetry was baked into the component
when it was written, and only the agency half was ever wrong.** So the correct reading is not
"one token, two outcomes" — it is that the vendor half was written with a literal that cannot
fail, and the agency half was written to a convention that can.

**And here is why the convention can fail.** `CLAUDE.md` prescribes `bg-card border
border-border rounded-xl` for agency surfaces — under the heading **Modal backgrounds**. Every
modal in this codebase sits on a `bg-black/80 backdrop-blur-sm` overlay. **7% white over 80%
black reads as solid.** A dropdown has no overlay. The token is fine; the convention silently
assumes something else is darkening what is behind you, and says so nowhere.

## The fix, and that it is not a new choice

`bg-card` → `bg-popover` (`--popover: rgba(4, 20, 20, 0.95)`), in the component. **Neither
layout was touched.**

**`components/help-term.tsx:118-124` hit this exact bug, fixed it the same way, and left the
diagnosis in a comment:**

> *"Dark uses bg-popover (the --popover token, 95% opaque) explicitly rather than inheriting
> PopoverContent's own default… **bg-card was the bug: --card is only 7% opaque, effectively
> see-through.**"*

**I reintroduced a solved problem.** `--popover` is also what every Radix `DropdownMenuContent`
(`ui/dropdown-menu.tsx:45`, `:233`) and `PopoverContent` (`ui/popover.tsx:33`) already uses.

## Ladder position

**The panel stays `z-30`:**

| Layer | z | |
|---|---|---|
| Agency `<main>` | 10 | |
| Both portal layouts' chrome | 20 | |
| **Notifications panel** | **30** | above the chrome it hangs from |
| `UpgradeRequiredModal` | 60 | |
| Toast viewport | 100 | |
| Alert dialog | 550 | |

**A dropdown must lose to all three modal layers.** Specifically it must lose to `z-[60]`: if
the panel beat the upgrade modal, a refusal raised while the bell is open would paint behind
it — which is the precise defect fixed in `9f65595` last session, reintroduced from the other
direction.

## Other `bg-card` surfaces at risk

**EXECUTED:** `grep -rn "bg-card"` — 29 sites. Classified:

- **In-flow cards** (nothing behind them but the page background): `agency/pool:1583/1872/1964`,
  `settings/billing` ×3, `email-import-panel` ×3, `contact`, `privacy`, `terms`,
  `auth/confirmed`, `team-roster-client:477`, `ui/card.tsx`, `ui/alert.tsx`. **All fine** —
  a 7% tint over the page is exactly what the token is for.
- **Dialog and Sheet content** (a `bg-black/80 backdrop-blur-sm` overlay behind them):
  `agency/pool:2399/2431`, `agency/pool/[partnerId]:888`, `new-client-dialog`,
  `scoring-settings-sheet`, `delivery-review-sheet`, `bid-detail-sheet`,
  `marketplace-content:345`. **All fine** — the overlay does the darkening.
- **Floating with no overlay** — the category this bug lives in. After this fix, **one
  candidate remains**, reported not fixed:

**OPEN-O. `app/agency/settings/team/team-roster-client.tsx:509`** —
`<option className="bg-card text-foreground">` inside a native `<select>`. Where a browser
honours background-color on `<option>` (Chrome on Windows/Linux; macOS renders OS-native menus
and ignores it), 7% white resolves against the OS menu background — typically white — with
`text-foreground` (`#FFFFFF`) on top. **White on white.** Platform-dependent, invisible on the
machine it was almost certainly written on. **Settles it:** open the Invite-colleague role
select on Chrome/Windows.

## Does the fix hold for a populated panel?

**REASONED, not clicked.** Yes, and by construction rather than by luck: the background is on
the panel **container**, and the list inside it is `max-h-[380px] overflow-y-auto` with
`overflow-hidden rounded-xl` on the container. Rows scroll **inside** an already-opaque box,
so height and scroll position cannot expose anything behind. The unread-row tints
(`bg-accent/5` agency, `bg-[#C8F53C]/10` vendor) layer over an opaque base and stay subtle.

**This matters more than it did last week: with 094 applied, a colleague's panel now renders
real rows instead of the empty state,** so the populated case is the normal one rather than a
hypothetical.

---

# 6. What Greg should see, by looking

## `/agency/dashboard`, bell open — the panel fix

1. Open `/agency/dashboard` and let the attention rows and metric cards render.
2. Click the bell, top-right of the sidebar's logo block.
3. **The panel must be solid dark** (`rgba(4,20,20,0.95)`) with a visible border and shadow.
   **No attention row, no metric card, and no sidebar item may be readable through it.**
4. **Scroll the panel if it has more than a few rows.** Content must scroll *inside* the
   opaque box; nothing behind should become visible at any scroll position.
5. Compare against `/partner`: the same panel, white and opaque. **Both should now read as
   solid. Before this commit the agency one was see-through and the vendor one was not.**

**Regression to watch for:** the panel must **not** cover a toast or a dialog. Open the bell,
then trigger anything that raises a toast — the toast must appear **over** the panel.

## The guard fixes — deliberately invisible

**There is nothing to see on the happy path, and that is the point.** Both dashboards render
exactly as before. To see the fix work you have to make a request fail:

1. Sign in, open `/partner`, then in dev tools **block `/api/partner/dashboard`** (Network →
   Block request URL) and reload.
   - **Before:** console shows `TypeError: Cannot read properties of undefined (reading
     'items')`; the page still renders.
   - **After:** no TypeError. The dashboard renders its empty/zero state.
2. Same on `/agency/dashboard`, blocking `/api/agency/dashboard`.
   - **Before:** the whole dashboard body disappears — `AttentionQueue` throws in `for...of`.
   - **After:** the skeleton, and nothing thrown.
3. **The one thing you can see that is new:** open `/partner/rfps` with `/api/partner/rfps`
   blocked. **Before:** "no RFPs", a confident empty state for a failed request. **After:**
   the error branch at `partner-rfp-surface.tsx:659` finally renders. Same for
   `/partner/projects` (`:764`).

**Which step means revert rather than debug:** step 3. It turns on error UI that has never
rendered in production. If those branches are broken in some way that only shows at runtime,
that is `cfd3751` and it is one revert — `git revert cfd3751`. Everything else is contained to
one page.

---

# 7. Open items

| # | Item | Settles it |
|---|---|---|
| **OPEN-N** | Two fetchers, now behaviourally identical, still separate. Collapse `swr-provider.tsx`'s inline fetcher onto the exported one. | `grep -rn "useSWR<\|useSWR(" app/ components/ hooks/` — every call site that would change. Mechanical, no semantic content, own commit. |
| **OPEN-O** | `team-roster-client.tsx:509` — `bg-card` on a native `<option>`, white-on-white where the browser honours it. | Open the Invite-colleague role select on Chrome/Windows. |
| **OPEN-P** | Which of the four error responses fired at 20:50 UTC Aug 25. Not established. | The Sentry event's request data and breadcrumbs. All four produce the identical TypeError. |
| **OPEN-Q** | `CLAUDE.md`'s `bg-card` rule is written for modals and reads as universal. It is what made this bug look correct. | One clause: "…for modal content, which sits on an overlay. Floating surfaces with no overlay behind them use `bg-popover`." Not edited this session. |

---

# 8. EXECUTED / READ / REASONED

**EXECUTED.** `npx tsc --noEmit` after every one of the four commits, exit 0 each time;
`pnpm build`, compiled successfully in 10.8s. Greps for every `useFetch` consumer, every
`data.error` read, every `?.x.y` chain in both dashboards, every `bg-card` in `app/` and
`components/`, and every iteration point in the five agency dashboard section components.
Four commits. **The other six gates were not run, per instruction.**

**READ in full.** `lib/fetcher.ts`; `hooks/useFetch.ts`; `components/swr-provider.tsx`;
`app/api/partner/dashboard/route.ts` (every return path); `app/partner/page.tsx:380-400`,
`:640-690`; `app/agency/dashboard/page.tsx:43-100`, `:201-250`, `:591-660`, `:750-860`;
`components/help-term.tsx:110-135`; `app/globals.css` token block and `.glass`.

**READ in part.** The eight `useFetch` consumers, at their call sites and first use of `data`;
`components/ui/dropdown-menu.tsx`, `popover.tsx`, `sheet.tsx`, `dialog.tsx` for the z and
background conventions; `components/agency-layout.tsx:497`, `:838`.

**REASONED, and therefore unverified.** **Nothing was clicked in a browser and no statement
was run against any database.** Specifically: that the panel now renders opaque; that a
populated panel scrolls without exposing content behind it; that the three newly-reachable
error branches render correctly; which of the four error responses fired on Aug 25; and the
platform-dependent `<option>` behaviour in OPEN-O. §6 is the checklist that closes those.

**NOT DONE, deliberately.** No route response shape changed. Neither portal layout touched.
The two fetchers not consolidated. `partner/page.tsx:673` not hardened. `CLAUDE.md` not
edited. No migration touched. **Nothing pushed.**
