# Panel and notification types: session report

Branch `fix/panel-and-notification-types`. Baseline `89dfb31`. Head `641c68e`.
Three commits. **Nothing pushed.**

---

# WHAT I COULD NOT COMPLETE

**PHASE 1 IS NOT FIXED. The panel is still see-through and I stopped, as instructed.**

`.glass` sets **no `opacity`**. That is branch (c) of the phase, which says stop and report,
do not try a fourth background token. I did not try one, and I did not portal the panel,
because portaling was the remedy prescribed under branch (b), which is conditional on `.glass`
setting opacity. It does not.

**The diagnosis in the brief is ruled out, and I could not replace it from source.** Section 1
below records everything the source does settle, including a second candidate I found and
killed, so the next attempt does not re-walk this ground.

**PHASE 2 IS DONE BUT UNCOMMITTABLE.** `CLAUDE.md` is gitignored at `.gitignore:19`. The
amendment is written and live on disk, but `git add` refuses it and I did not use `-f`, because
that ignore line looks deliberate and overriding it is Greg's call, not mine. Section 3.

Everything else completed: Phases 3, 4, 5 and 6.

---

# 0 / 6. THE GATES

Six gates, run once at the start and once at the end, and nowhere between. `verify-rls` and
`policy-audit:guard` were not run: neither reads a `.ts` file and nothing in this session can
move them.

| Gate | Baseline | Final | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0, no output | exit 0, no output | none |
| `pnpm build` | exit 0, compiled, 72/72 static | exit 0, compiled, 72/72 static | none |
| `pnpm lint` | exit 1, **182 problems (154 errors, 28 warnings)** | exit 1, **182 problems (154 errors, 28 warnings)** | none |
| `pnpm identity-columns:guard` | exit 0, TOTAL 0 in 0 files, 387 scanned | byte-identical output | none |
| `pnpm org-id-reads:guard` | exit 0, OPEN 60, REGRESSIONS 0, IMPROVED 1 | byte-identical output | none |
| `pnpm embed-targets` | exit 0, TOTAL 0 in 0 files, 387 scanned | byte-identical output | none |

**No movement in either direction, so there is nothing to explain.** The three guard outputs
were compared with `diff`, not by eye, and are byte-identical including the scanned-file count.

Two standing facts carried forward unchanged, neither caused nor touched by this session:

- **Lint has been red since before this session**, 154 errors. I did not fix or mask any of
  them and the count is identical at both ends.
- **`org-id-reads:guard` reports IMPROVED 1** at baseline and still does: `lib/entitlements.ts`
  recorded 1, found 0. The guard asks for the `KNOWN_OPEN_MIRROR` count to be lowered. **I did
  not lower it** — editing a guard allow-list or KNOWN_OPEN count is prohibited. It is
  pre-existing and passing.

No guard tripped on any comment I wrote, so no comment needed rewording.

---

# 1. THE PANEL: what `.glass` actually sets, and why it is not the cause

## 1a. Every property `.glass` sets, quoted

`app/globals.css:211-215`, quoted complete:

```css
.glass {
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
```

Three properties. `--surface-glass` is `rgba(4, 20, 20, 0.88)` (`app/globals.css:11`).

**There is no `opacity`.** Not in the rule, not anywhere near it.

I did not take that from source alone. The **built** stylesheet agrees:

```
.glass{background:var(--surface-glass);-webkit-backdrop-filter:blur(20px)}
```

(`.next/static/chunks/4dd66d5999c85273.css`.) Same three properties minus the unprefixed
`backdrop-filter`, which the build drops. Still no `opacity`.

## 1b. No ancestor sets opacity either

`.glass` was the named suspect, but the phase's real claim is "CSS opacity on an ANCESTOR", so
I walked the whole chain rather than one class. Agency panel, outermost to innermost:

| Element | Source | Sets opacity? |
|---|---|---|
| `<body className="font-sans antialiased min-h-screen">` | `app/layout.tsx:80` | no |
| `SWRProvider` | `app/layout.tsx:81` | renders no DOM node |
| `<div className="min-h-screen relative">` | `agency-layout.tsx:493` | no |
| `UsageLimitModalProvider` | `agency-layout.tsx:492` | renders no DOM node (`contexts/usage-limit-modal-context.tsx:90`) |
| `<aside className="fixed ... w-[260px] glass border-r border-border z-20 flex flex-col">` | `agency-layout.tsx:497` | **no** — see 1a |
| `<div className="p-6 border-b border-border">` | `agency-layout.tsx:499` | no |
| `<div className="flex items-start justify-between gap-3">` | `agency-layout.tsx:506` | no |
| `<div ref={containerRef} className="relative">` | `notification-bell.tsx:198` | no |
| the panel | `notification-bell.tsx:225-264` | no |

I also swept `app/globals.css` for every `opacity`, `mix-blend-mode` and `filter` declaration
in the file. Every `opacity` in it belongs to `.ai-badge`, `.hero-eyebrow-word`, or the
`blink` / `hero-eyebrow-cycle` / `blob-float` keyframes. **None of them matches anything in
that chain.**

## 1c. The second candidate, found and killed

Before reporting a dead end I tested the one other mechanism that produces a symptom
indistinguishable from a transparent panel: **dashboard content painting *over* it.** A metric
card on top of the panel looks exactly like a metric card seen through the panel.

It is not that either. `<main>` is `className="ml-[260px] min-h-screen relative z-10"`
(`agency-layout.tsx:838`). `position: relative` with a non-`auto` `z-index` **creates a
stacking context**, so every z-index inside `<main>` is sealed inside it and competes only with
`<main>`'s siblings as a single unit at `z-10`. The aside is `z-20`. The aside's entire subtree,
panel included, paints above the whole of `<main>` unconditionally.

I confirmed there is nothing inside `<main>` that could escape: the highest z-indexes on agency
surfaces are `app/agency/documents/page.tsx:668` and `app/agency/pool/page.tsx:2280` at `z-50`,
and `app/agency/pool/page.tsx:2561` at `z-[70]`. All of them are sealed by `<main>`'s stacking
context. Not one can reach the panel.

**The layering comment at `notification-bell.tsx:228-237` is correct.** It was correct before
and it is still correct.

## 1d. What that leaves

By every mechanism visible in source, **the panel should render at 95% opacity and be
effectively solid**: its own background is `rgba(4, 20, 20, 0.95)`, the utility that applies it
exists in the built CSS as `.bg-popover{background-color:var(--popover)}`, `--color-popover` is
correctly wired through `@theme inline` (`app/globals.css:87`) so the utility is genuinely
generated and not an inert class name, nothing above it is translucent, and nothing can paint
over it.

**I cannot reconcile that with the browser observation, and I am not going to invent a
mechanism to close the gap.** Three background tokens have now been tried. A fourth is not the
answer and neither is a guess dressed as a diagnosis.

**What the next session should establish first, in the browser, because none of it can be
settled from source:**

1. `getComputedStyle($0).backgroundColor` **on the panel element itself** — not the value of
   `--popover`, which is what was checked. Those are different claims. The variable resolving
   proves the token is defined; only the computed style proves the element is painting it.
2. Whether the loaded stylesheet is the one built from this branch. A `.bg-popover` rule that
   is absent from the served CSS would explain everything, and a stale CDN or service-worker
   copy would produce exactly the reported "the class landed but nothing changed".
3. `getComputedStyle()` for `opacity`, `mix-blend-mode` and `filter` **on each of the eight
   ancestors in the 1b table**, walking up from the panel. If one of them is not `1` / `normal`
   / `none`, that is the cause and source did not show it to me, which would itself be worth
   knowing.

**One incidental finding, reported because it is real and not because it is the cause:** the
production build **drops the unprefixed `backdrop-filter`** from `.glass` and ships only
`-webkit-backdrop-filter`. Chrome and Safari accept the prefixed form, so the sidebar looks
right there. **Firefox supports only the unprefixed property and will render the sidebar with
no blur at all.** That is a separate cosmetic defect on a separate browser. It does not affect
the panel and I did not touch it.

## 1e. How the panel closes, and whether portaling changed that

**Nothing was portaled**, so nothing about closing changed. Recording the answer anyway,
because the phase asked for it before portaling and the next session will need it.

`notification-bell.tsx:145-159`:

```js
const onDown = (e: MouseEvent) => {
  if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
}
```

**This is exactly the DOM `contains()` check the phase warned about.** `containerRef` is the
`<div className="relative">` at line 198, and the panel is a **child of that div**. A portal to
`document.body` would move the panel out of `containerRef`'s subtree, so every click inside the
panel would test as outside the container and **close the panel on the first click** — mark all
read, or opening any notification, would become unusable. Escape (`onKey`, line 150) is on
`document` and would survive; click-outside would not.

**So a portal is a two-part change, and the second part is not optional.** `containerRef` would
need a second ref on the panel itself and the test would become "outside the container AND
outside the panel". Anyone attempting the portal must do both in one commit.

## 1f. The vendor side, both halves confirmed

The phase asked me to confirm both halves rather than assume. Both hold, and they are
independent.

1. **The vendor branch uses `bg-white`.** `notification-bell.tsx:263`:
   `"right-0 top-full bg-white border-black/10"`. A flat opaque literal, not a token.
2. **The vendor nav is not inside `.glass`.** `grep -n "glass" components/partner-layout.tsx`
   returns **nothing**. The vendor header is
   `<header className="bg-[#0C3535] text-white sticky top-0 z-20">` (`partner-layout.tsx:128`),
   an opaque hex with no `glass` class and no `backdrop-filter` anywhere in the file.

Either one alone would be enough to make the vendor side immune. Both are true.

---

# 2. THE NATIVE-CONTROL DEFECT (OPEN-O) — FIXED

**Commit `e3ae7d3`.**

`team-roster-client.tsx` put `bg-card text-foreground` on a native `<option>`. `--card` is
`rgba(255,255,255,0.07)`; `--foreground` is `#FFFFFF`. A native option list is painted by the
browser on its **own white popup surface**, which inherits nothing from the dark portal behind
it. 7% white over white, with white text, is invisible.

macOS Chrome and Safari route `<option>` through native AppKit menus and discard author
`background` and `color` outright, which is why it looked correct on the machine it was written
on and on every machine it was tested on. Chrome and Firefox on Windows and Linux honour both.

Fixed to `bg-background text-foreground`. `--background` is `#0C3535`, a flat opaque hex, so it
is legible where the styling is honoured and falls back to the native menu where it is not.

## The sweep

The phase asked me to check the other `bg-card` sites for native form controls. **A line-based
grep is not adequate here** — in this codebase the tag and its `className` are usually on
different lines, so `grep "bg-card" | grep "<option"` finds almost nothing and would have
reported a false all-clear. I scanned tag-spanning instead: every `<option`, `<select`,
`<optgroup` and `<datalist>` in the repo, walking each opening tag to its closing `>` through
nested braces, then reading the `className` off the tag however many lines it spanned.

**89 native form-control tags found. Result:**

- **34 `bg-card` sites exist. Not one of them is a native form control.**
- Of roughly fifty `<option>` elements in the repo, **the one at
  `team-roster-client.tsx:524` was the only one carrying a `className` at all.** Every other
  one inherits the browser's own black-on-white and is correct by default.

**So OPEN-O was a single instance, and it is closed.** No other genuine instance of this shape
exists, and I fixed nothing speculatively.

## One adjacent finding I did NOT fix, deliberately

Seven agency `<select>` elements carry `bg-white/5 text-foreground` — a translucent background
with white text:

`app/agency/page.tsx:1616`, `app/agency/settings/profile/page.tsx:509` and `:598`,
`app/agency/settings/team/team-roster-client.tsx:503`, `app/agency/msa/page.tsx:1148`, `:1251`
and `:1750`.

**The closed control is fine** — it sits on the dark page, where 5% white stays dark and white
text is readable. **The open popup is the question**: Chromium on Windows and Linux derives the
option-list background from the `<select>`'s own `background-color` when the author sets one,
which would composite 5% white against the popup's white base and reproduce the same
white-on-white failure one level up.

I did not fix these, for two reasons. It is **outside the scope the phase set** (the sweep was
of the `bg-card` sites, and the answer there is a clean zero). And changing them means making
seven visible agency controls opaque teal instead of translucent — **a design change to
surfaces that currently look correct**, which is Greg's call and not a bug fix I should take
unilaterally.

**The codebase already contains the answer if he wants it:** `components/client-selector.tsx:199`
uses `bg-background border border-border text-foreground` on a `<select>` — an opaque token, the
same fix applied to `<option>` in `e3ae7d3`. The house pattern exists in one place and the other
seven diverge from it.

**Settles it:** open `/agency/settings/profile` in **Chrome on Windows** and open the country
select. Legible means leave all seven alone. Not legible means change all seven to
`bg-background`, matching `client-selector.tsx:199`.

---

# 3. THE CLAUDE.md AMENDMENT — WRITTEN, NOT COMMITTABLE

The phase's diagnosis is right and I want to be clear that I agree with it: **the guidance was
the defect.** `help-term.tsx:118-124` had already fixed this exact bug and left a comment naming
it, and it came back anyway, because `CLAUDE.md` prescribes `bg-card` under "Modal backgrounds"
and states no dependency. Every modal sits on a `bg-black/80` overlay where 7% white reads
solid. A dropdown has no overlay. Following the rule correctly produced the bug twice.

Added under `### Modal backgrounds`, kept to two short paragraphs:

> **This rule holds only for surfaces sitting on an overlay.** `--card` is
> `rgba(255, 255, 255, 0.07)` — 7% opaque. It reads solid in a modal only because every modal
> sits on a `bg-black/80 backdrop-blur-sm` overlay that darkens the page first.
>
> **Anything floating over page content with no overlay beneath it — dropdown, popover,
> tooltip, menu, notification panel — needs an opaque background: use `bg-popover`**
> (`rgba(4, 20, 20, 0.95)`), which is what every Radix dropdown here already uses. Worked
> examples: `components/help-term.tsx` and the agency branch of
> `components/notification-bell.tsx`, both of which shipped `bg-card` first and rendered
> see-through.

## The problem with it, which Greg needs to rule on

**`CLAUDE.md` is gitignored** (`.gitignore:19`, confirmed with `git check-ignore -v`).

So the amendment exists on this machine and nowhere else. It does not reach another clone,
another machine, or a fresh checkout. **The rule that caused this bug twice lives in a file
that is not version-controlled**, which means the fix for it cannot be reviewed, cannot be
carried forward, and will be silently absent for anyone who is not on this working copy.

I did not `git add -f` it. That ignore line looks deliberate and overriding it changes a repo
convention, which is a decision rather than a task.

**Two options, both Greg's:** un-ignore `CLAUDE.md` and commit it, or move this rule somewhere
tracked — `LIGAMENT_CONTEXT.md` is the obvious candidate and is already required reading. Until
one of those happens **Phase 2 is not actually done**, whatever the file on this disk says.

---

# 4. THE TWO FETCHERS (OPEN-N) — DIFFED, THEN COLLAPSED

**Commit `9fd78f4`. This is the highest blast-radius change in the session.**
**`git revert 9fd78f4` restores two fetchers. It is the only commit that needs reverting for
this change and it touches nothing else.**

I re-read both in full first, in a different session from the one that wrote `cfd3751`, and
diffed them before changing anything.

## The diff, property by property

| Property | `lib/fetcher.ts:65-69` | `swr-provider.tsx:15-19` (before) | Same? |
|---|---|---|---|
| `res.ok` check | `if (!res.ok) throw ...` | `if (!res.ok) throw ...` | yes |
| what it throws | `new Error("HTTP " + status)` | `new Error("HTTP " + status)` | yes |
| error shape | plain `Error`. no `.status`, no `.info`, no `.body` | identical | yes |
| headers | none set | none set | yes |
| credentials | not set → fetch default `same-origin` | not set → fetch default `same-origin` | yes |
| status on error | not attached | not attached | yes |
| body on error | not attached | not attached | yes |
| 204 / empty body | `res.json()` called unconditionally on ok → rejects `SyntaxError` | identical | yes |
| signature / return | `(url: string) => Promise<any>` | identical | yes |

**The function bodies are byte-identical once de-indented.** I verified that with `diff` rather
than by eye; the diff is empty.

**They are genuinely identical, so I collapsed them.** `swr-provider.tsx` now imports `fetcher`
from `@/lib/fetcher`.

## The ten consumers, one at a time

The eight `useFetch` sites reach `lib/fetcher.ts` through `hooks/useFetch.ts:5`, which passes it
explicitly. **`lib/fetcher.ts` is not modified by this commit**, so all eight are unchanged by
construction, not by argument:

| # | Consumer | Before → after |
|---|---|---|
| 1 | `app/agency/bids/page.tsx:532` | unchanged. `error` used as a boolean at `:674` |
| 2 | `app/agency/project/page.tsx:644` | unchanged. does not destructure `error` |
| 3 | `app/agency/project/page.tsx:649` | unchanged. does not destructure `error` |
| 4 | `app/agency/dashboard/page.tsx:824` | unchanged. does not destructure `error` |
| 5 | `app/partner/page.tsx:162` | unchanged. does not destructure `error` |
| 6 | `app/partner/projects/page.tsx:660` | unchanged. `error` as boolean at `:764`, `:765` |
| 7 | `components/partner-rfp-surface.tsx:495` | unchanged. `error` as boolean at `:659`, `:676` |
| 8 | `components/partner-rfp-surface.tsx:498` | unchanged. `bidsError` as boolean at `:716`, `:721`, `:740`, `:745` |

The two that actually move are the ones passing no fetcher, which fall back to `SWRConfig`:

| # | Consumer | Before → after |
|---|---|---|
| 9 | `hooks/use-agency-usage.ts:23` | identical function, now imported rather than defined inline. **Does not destructure `error` at all** (`usage: data ?? null`). Its fail-open path is untouched: on failure `usage` is null and `guardAction` returns `true`, deferring to the server-side check (`contexts/usage-limit-modal-context.tsx:78`). Entitlement behaviour is unchanged. |
| 10 | `components/notification-bell.tsx:143` | identical function, now imported. `failed = Boolean(error) \|\| Boolean(data?.error)` at `:164` — boolean use only. |

**Every SWR consumer in the codebase uses `error` as a boolean. Not one reads a property off
it**, so the `Error`'s shape is depended on nowhere and could not have been a hidden coupling.

**The one thing that genuinely changes** is function identity: the inline copy was rebuilt on
every `SWRProvider` render, the module constant is stable. **SWR keys its cache on the URL, not
on the fetcher**, so nothing re-fetches, no cache entry moves, and no dedupe window resets.
This is a small improvement, not a behaviour change.

**One shared latent issue, unchanged by the collapse and pre-existing in both:** both call
`res.json()` unconditionally on any ok response, so a `204` or an empty body from any of the
ten endpoints rejects with a `SyntaxError` and surfaces as `error`. That was true of both
fetchers before and is true of the one now. Not introduced here, not fixed here.

I also updated the header comment in `lib/fetcher.ts`, which said "THEY ARE DELIBERATELY NOT
COLLAPSED HERE" and would otherwise have become false the moment they were. **A stale comment
that contradicts the code is the exact failure mode this session exists to fix.**

---

# 5. THE 095 RULING — WRITTEN, NOTHING AUTHORED

**Commit `641c68e`. `docs/095-notification-types-ruling.md`.**

**In one line: eleven declared types against an eight-value CHECK means six of the sixteen write
sites raise 23514 and write nothing, and the decision Greg owes is whether the constraint widens
to eleven or the three types and six emit sites come out of the code instead.**

No SQL authored. No `supabase/migrations/095_*.sql` exists (verified: `ls | grep -c 095` returns
`0`). No pre-apply test. No database access sought. No migration modified at any number.

**The document records one finding the phase did not anticipate, and it changes what a widening
means.** The phase asked which of the six sites would start writing on the day it widens. The
answer is **four, not six** — because the constraint is not the only wall.

094's INSERT policy (applied, live) reads:

```
user_id = auth.uid()
OR user_id IN (SELECT public.current_user_org_member_user_ids())
OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
```

The counterparty arm is **active-only**. So:

- **`partnership_declined`** (`app/api/partnerships/route.ts:1200`) **stays silent even after a
  widening.** A partnership being declined is not active, and the decliner is not in the
  recipients' org, so all three arms fail. Making declines appear is a separate RLS ruling.
- **Both guest-token `bid_submitted` sites** (`app/api/rfp/guest/[token]/route.ts:583` and
  `:768`) use the **service role** and bypass RLS. They write unconditionally.
- **Both `onboarding_deployed` sites** write, since the partnership is active by then.
- **The partner-portal `bid_submitted` site** (`app/api/partner/rfps/[id]/response/route.ts:429`)
  writes only where an active partnership already links the two orgs.

**Anyone who widens the constraint expecting all six to light up will read a correct result as a
half-failure.** That is why it is in the document.

It also flags that the RLS comment at `lib/notifications.ts:171-179` describes the **pre-094**
predicate and is stale by one arm. I did not edit it — `lib/notifications.ts` is squarely inside
the surface this ruling governs, and touching it before the ruling is how 093 happened.

---

# 6. OPEN ITEMS, each with the query that settles it

| Item | State | The query that settles it |
|---|---|---|
| **OPEN-PANEL** the agency panel still renders see-through | **OPEN. Diagnosis ruled out, not replaced.** | In the browser on the panel element: `getComputedStyle($0).backgroundColor` — expect `rgba(4, 20, 20, 0.95)`. If it is that and the panel still reads through, walk the eight ancestors in §1b reading `opacity`, `mix-blend-mode`, `filter`. If it is **not** that, check whether the served CSS contains `.bg-popover{background-color:var(--popover)}` — a stale asset explains the whole symptom. |
| **OPEN-CLAUDEMD** the amendment is not version-controlled | **OPEN. Greg's ruling.** | `git check-ignore -v CLAUDE.md` → `.gitignore:19`. Either un-ignore and commit, or move the rule into `LIGAMENT_CONTEXT.md`. |
| **OPEN-095** the type CHECK ruling | **OPEN. Greg's ruling.** Document written. | `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check';` — also confirms the constraint's live name, which this session could not read and flagged as unconfirmed. |
| **OPEN-SELECTS** seven agency `<select>` with `bg-white/5` | **OPEN, reported not fixed.** §2. | Open `/agency/settings/profile` in **Chrome on Windows**, open the country select. Legible → leave all seven. Not legible → `bg-background`, per `client-selector.tsx:199`. |
| **OPEN-FIREFOX** `.glass` ships webkit-prefixed only | **OPEN, incidental.** §1d. | Load any agency page in **Firefox**. Sidebar blur absent → confirmed. Cosmetic, one browser. |
| **OPEN-204** both fetchers reject on an empty body | **OPEN, pre-existing, unchanged.** §4. | Any of the ten endpoints returning `204` or an empty `200` body surfaces as `error`, not as `data`. Not introduced or fixed here. |
| **OPEN-ENTITLEMENTS** `org-id-reads:guard` reports IMPROVED 1 | **OPEN by prohibition.** | `lib/entitlements.ts` recorded 1, found 0 in `KNOWN_OPEN_MIRROR`. Lowering it is prohibited to me. Guard passes either way. |

---

# 7. BROWSER CHECKLIST, ordered by risk

**Highest blast radius first. Steps 1 and 2 are REVERT-not-debug.**

### 1. `9fd78f4` — every SWR read in both portals. **REVERT, DO NOT DEBUG.**

The single change that can break both portals at once. **If any of these is wrong, run
`git revert 9fd78f4` immediately** — do not investigate on a live surface, because the failure
mode is data silently not arriving.

- `/agency/dashboard` loads with real data, not an empty state.
- `/partner` loads. **This is the screen that threw the original Sentry `TypeError`.**
- `/partner/projects` and the RFP inbox both populate.
- **The bell opens and lists rows** (consumer 10 — one of the two that actually moved).
- **Create a project as an org at its quota and confirm the upgrade modal still raises**
  (consumer 9 — the other one that moved, and the entitlement-critical one).

A wrong result here means a fetcher regression, and reverting is one commit with no
entanglement.

### 2. `e3ae7d3` — **needs a Windows machine, and macOS cannot test it.**

`/agency/settings/team` → **Invite colleague** → open the **Role** select **in Chrome on
Windows**. The role options must be **legible**. On macOS this step proves nothing either way,
because AppKit discards the styling.

**If the options are invisible or wrong-coloured, revert `e3ae7d3`** rather than trying another
token — the same three-token spiral that Phase 1 is stuck in. Reverting restores an invisible
list on Windows and a correct one on macOS, which is where it was this morning.

While there, confirm the **invitation flow still works end to end** — `COLLEAGUE_INVITATIONS` is
true in production and this is a live surface.

### 3. `641c68e` — docs only. Nothing to check in a browser.

Read `docs/095-notification-types-ruling.md` and rule. No code path is touched, so there is
nothing to break and nothing to revert.

### 4. The panel — **nothing shipped, nothing to verify.**

Not a checklist step. It is the three diagnostic queries in §6 OPEN-PANEL, to be run **before**
the next attempt rather than after.

---

# 8. EXECUTED / READ / REASONED

The distinction matters most in §1, where the conclusion is negative.

## EXECUTED

- All six gates, twice — start and end. Numbers in §0/6, guard outputs compared with `diff`.
- `npx tsc --noEmit` additionally after Phase 3 and Phase 4. Exit 0 each time.
- `pnpm build` additionally after Phase 4. Exit 0, 72/72.
- The tag-spanning scan of all **89** native form-control tags (§2). A written scan, not a grep.
- The byte-diff of the two fetcher bodies (§4). Empty.
- `git check-ignore -v CLAUDE.md` → `.gitignore:19`.
- `ls supabase/migrations/ | grep -c 095` → `0`.
- Three commits. **No push, no merge, no PR, no migration applied, no database access.**

## READ

- `app/globals.css` — `.glass`, `:root`, the `@theme inline` block, every `opacity` /
  `mix-blend-mode` / `filter` in the file.
- The **built** stylesheet `.next/static/chunks/4dd66d5999c85273.css` — `.glass` and
  `.bg-popover` as actually shipped. This is why §1a is not source-only.
- `components/notification-bell.tsx` in full, `components/agency-layout.tsx` and
  `components/partner-layout.tsx` around the mount points, `contexts/usage-limit-modal-context.tsx`,
  `app/layout.tsx`.
- `lib/fetcher.ts` and `components/swr-provider.tsx` in full; all ten consumers.
- `lib/notifications.ts` — the type union, all seven helpers, `createOrgNotification`'s error
  path; all sixteen write sites.
- `supabase/migrations/094_notifications_colleague_scope.sql` — **read only.** This is where the
  live INSERT policy came from, and reading it is what revealed that the `lib/notifications.ts`
  comment is a version behind.
- `docs/refusals-and-notifications-report.md` §5b — the source for the eight permitted values
  and the 15 live rows. **Recorded, not queried:** this session did not read the constraint from
  the database.

## REASONED

- **That `.glass` is not the cause.** Direct: it has no `opacity`, in source and in the built
  CSS. Confidence: high.
- **That no ancestor sets opacity.** From the eight-element chain plus the `globals.css` sweep.
  High for CSS-declared opacity; **cannot rule out something applied at runtime**, which is why
  §6 asks for `getComputedStyle` on each ancestor rather than treating this as settled.
- **That dashboard content cannot paint over the panel** (§1c). From `<main>`'s
  `relative z-10` creating a stacking context. High — this is specified CSS behaviour, not a
  browser quirk.
- **That a portal would break click-outside** (§1e). From `containerRef.current?.contains()` at
  `:148` testing a parent the panel would no longer be inside. High, and untested, because I
  did not portal it.
- **That Firefox loses the sidebar blur** (§1d). From the built CSS shipping only
  `-webkit-backdrop-filter`. Reasoned from the artefact; **not observed in Firefox.**
- **That the seven `<select>` sites may fail the same way as the `<option>`** (§2). Reasoned
  from Chromium deriving popup colours from the control. **Deliberately not acted on** —
  flagged for a Windows check.
- **That four of six sites start writing on a widening, not six** (§5). From 094's live policy
  text against each site's client and partnership state. High for the two service-role sites
  (RLS bypassed outright) and for `partnership_declined` (a declined partnership cannot be
  active). **Data-dependent for `app/api/partner/rfps/[id]/response/route.ts:429`**, and the
  document says so rather than rounding it up.
- **That E2 was marked confirmed on the email half.** **Taken from Greg's brief, not verified.**
  Neither "E2" nor "both submission paths" appears anywhere in `docs/` or `LIGAMENT_CONTEXT.md`.
