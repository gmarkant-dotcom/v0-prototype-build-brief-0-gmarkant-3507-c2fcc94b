# Notification types session report

**Branch:** `feat/notification-types-and-guidance`
**Date:** 2026-08-26
**Nothing was pushed. Nothing was applied. No database was contacted.**

---

## Completion

All four phases completed. Nothing was blocked, skipped or left partial.

**One thing did not match the brief and I did not quietly pick a reading.** The brief
states that widening the CHECK makes "FOUR write sites start working, NOT six". My census
finds **five** call sites starting to write, not four. It is a unit mismatch rather than a
disagreement about behaviour, both numbers are defensible, and §3 sets out the derivation
so the count can be settled by eye. It changes nothing about whether to apply 095.

---

## 1. Phase 1 - CLAUDE.md, audited and COMMITTED

`CLAUDE.md` was gitignored at `.gitignore:19`, so the guidance shaping every session lived
on one machine. That is why the `bg-card` rule was reintroduced after it had already been
fixed **and commented** in `help-term.tsx` - the comment was in the repo, the rule was not.

### The history question, settled first

Git history is permanent, so the question was not only "is this file clean now" but "has
it ever held a credential". That question has a definitive answer here:

```
git log --all --oneline -- CLAUDE.md        -> empty
git rev-list --all --objects | grep CLAUDE.md -> 0
```

**The file has never existed in git history under any ref.** There is no prior blob, so
committing it published exactly the 135 lines audited and nothing historical. Had any
blob existed, the audit would not have been sufficient on its own and I would have
withheld.

### What it contained, BY CATEGORY

Full read, 135 lines, plus pattern scans for credential prefixes (`sk-`, `pk_`, `eyJ`,
`xox*`, `ghp_`, `AKIA`, `-----BEGIN`), connection strings (`postgres://`, `mysql://`,
`mongodb://`, `redis://`), `password`/`secret`/`token`/`api_key` assignments, bearer
values, email addresses, UUIDs, and opaque strings of 20+ characters.

| Category | Found | Line | Disposition |
|---|---|---|---|
| Credential, token, key, connection string, password | **none** | - | - |
| Bearer value or authorization header | **none** | - | - |
| Email address | **none** | - | - |
| UUID or opaque identifier | **none** | - | - |
| Customer or client name | **none** | - | - |
| Internal or non-public URL | **none** | - | - |
| Public URL | 1 | 13 | `https://www.withligament.com`, the public marketing site. Already committed at `LIGAMENT_CONTEXT.md:12`. |
| Env var NAME, no value | 1 | 86 | `ANTHROPIC_API_KEY`. The name only. |
| Model identifier | 1 | 90 | A public Anthropic model string. |

**Verdict: clean. Committed.** `.gitignore:19` removed, file added, in `bb75628`. The
staged blob was re-scanned after staging, not only before.

### The bg-card amendment (item d) - present, at lines 117-126

It was already written in the previous session and is in the committed file. It states the
rule's **dependency** rather than the rule alone: `--card` is `rgba(255,255,255,0.07)`, 7%
opaque, and reads solid in a modal only because every modal sits on a
`bg-black/80 backdrop-blur-sm` overlay that darkens the page first. Anything floating over
page content with no overlay beneath it - dropdown, popover, tooltip, menu, notification
panel - needs `bg-popover`. Both worked examples are named: `components/help-term.tsx` and
the agency branch of `components/notification-bell.tsx`, each of which shipped `bg-card`
first and rendered see-through.

### Item (e) - everything else the ignore rules hide. Report only, nothing changed.

| Path | Ignored by | Guidance or configuration? | Action |
|---|---|---|---|
| `CLAUDE.md` | `.gitignore:19` | **Guidance** - the only one | Un-ignored and committed |
| `.env.local`, `.env.production.local` | `.gitignore:12,21` | Configuration, secret | Stays. Never opened. |
| `.vercel/` | `.gitignore:8,18` | Configuration, machine-local | Stays |
| `tsconfig.tsbuildinfo` | `.gitignore:20,22` | Build artifact | Stays |
| `.claude/settings.local.json` | **`~/.config/git/ignore:1`** - a GLOBAL gitignore, not this repo's | Configuration - 64 permission allow entries | Stays |
| `.claude/scheduled_tasks.lock` | `.git/info/exclude:8` | Runtime lock | Stays |

**Nothing else the ignore rules hide is guidance.** Two notes worth having:

- `.claude/settings.local.json` is hidden by a **global** gitignore at
  `~/.config/git/ignore`, not by anything in this repository. A teammate cloning this repo
  would not inherit that rule. It holds only permissions, so nothing is lost, but the
  ignore is not reproducible from the repo.
- `.gitignore` carries three redundant pairs: `.env*.local` (12) is subsumed by `.env*`
  (21); `.vercel/` (8) duplicates `.vercel` (18); `tsconfig.tsbuildinfo` appears at both
  20 and 22. Harmless. **Not changed** - item (e) says report only.

---

## 2. Phase 2 - migration 095

### The full filename, stated because a glob got this wrong last week

```
supabase/migrations/095_notification_types.sql          <- THE MIGRATION
supabase/migrations/095_notification_types_down.sql     <- THE ROLLBACK
```

> **A `095_*.sql` glob matches the DOWN FILE FIRST.** `_down` sorts before `.sql` on the
> character after `types`. Every migration in that directory has a `_down` sibling that
> sorts first alphabetically, and a `094_*` glob matched one and applied it by mistake
> this week. Both files open by naming themselves in their first lines. Open the one you
> mean by its whole name.

### Apply order

1. Run `docs/095-preapply-test.sql`. Read the headline. Expect **"SAFE TO APPLY 095."**
2. Dry run `095_notification_types.sql`: change `COMMIT` to `ROLLBACK`, run, confirm no
   errors, **put it back**.
3. Run it for real.
4. Run the VERIFICATION block, V1 through V6. Every query states its expected value.
5. Update the migrations table in `LIGAMENT_CONTEXT.md`.
6. **No code deploy is required.** The emitting code is already correct and already
   deployed; it has been waiting on the database.

### Dry-run COMMIT line number

| File | `BEGIN;` | `COMMIT;` |
|---|---|---|
| `095_notification_types.sql` | line **292** | line **341** |
| `095_notification_types_down.sql` | line **142** | line **177** |

**The COMMIT to change for the dry run of the migration is line 341.**

Verify with the house form, never the anchored one:

```bash
grep -n 'COMMIT;' supabase/migrations/095_notification_types.sql
```

**Both greps return more than one line and that is correct.** The extra hits are the
header quoting itself and the V4/V5 probes in the commented verification block, which are
real `BEGIN;`/`ROLLBACK;` pairs that happen to be commented out. Every extra is prefixed
`--`. The executable pair is the only pair with no comment marker. The header says this
explicitly, because "exactly one line of each" would have been false here.

### What it does

One `ALTER TABLE`, two actions, one statement: drop `notifications_type_check`, add it
back under the same name with eleven values instead of eight. No table, no column, no row,
no backfill, no policy, no function, no grant.

The eleven are `lib/notifications.ts:265-276` exactly. Verified mechanically - the literals
extracted from the SQL diff clean against the literals extracted from the TypeScript union,
eleven for eleven.

### Validation

The table holds **15 rows** in three types: `partnership_accepted` 7, `project_awarded` 4,
`project_assignment` 4 (queried live 2026-08-25 during 094's pre-apply run - I did not
re-query, per the standing prohibition). All three are inside the eight being kept, so
`ADD CONSTRAINT` validates against current data by construction. No `NOT VALID` /
`VALIDATE CONSTRAINT` split at that size: it exists to avoid holding a lock while scanning
a large table, and it would leave a constraint that does not guarantee what it says.

`V2` re-counts rather than trusting the header, and the pre-apply test asserts it (T3).

### The down file is NOT symmetric, and that is the most important thing on it

`ADD CONSTRAINT` validates existing rows. So restoring the eight-value constraint **fails
with 23514 the moment one row of the three new types exists** - which, after a working
095, is the expected state rather than an edge case.

> **095 is trivially reversible until it is used, and progressively harder afterwards.
> That is the opposite of the usual shape.**

The failure is safe - the statement aborts and nothing changes - but it *is* a failure, and
you have rolled nothing back when you see it. The down file leads with this, gives the
read-only query that settles whether the rollback can succeed at all, and offers three
honest options if it cannot (don't roll back; delete the rows first, knowingly; or restore
a narrower ten). It deliberately does **not** contain a `DELETE` anybody could run by
reflex, and it names the one option that is not on the list: adding `NOT VALID` to make the
error go away, which would leave the database lying about what it enforces.

### The one comment correction, and nothing else

`lib/notifications.ts` - the RLS note formerly at `:171-179`, now `:171-196`. It described
the INSERT policy as two arms and called the own-organization case "NOT FIXED HERE ...
Greg's call". **094 is applied and added a third arm**, so it was wrong about the live
predicate *and* wrong about the state of the decision. Corrected in place.

**Comment-only, verified mechanically** - the diff was filtered for any changed line not
beginning with `*`, `*/` or `/**`, and there were none. Untouched: the eleven-type union,
all sixteen emit sites, `createOrgNotification()`'s body. `npx tsc --noEmit` exit 0.

---

## 3. The four-not-six framing, restated - and the number I actually measured

### The framing, which is correct and is the point

**The widening does not light up all six write sites. One stays silent, by design, and it
is not a half-failure.**

094's INSERT policy arm for counterparties is `current_user_active_counterparty_user_ids()`,
which is **active-only** (`079:779-804`). A partnership being *declined* is not an active
one: it is `pending` before that handler runs and `terminated` after it, so the agency's
user id is in neither arm and the INSERT is refused **in both orderings**. 095 removes the
CHECK barrier from `partnership_declined`; RLS then refuses it a second time.

The code already says so, at `app/api/partnerships/route.ts:1186-1197`. The email on that
path is what actually reaches the agency, and 088's `invitation.decline` milestone is a
second channel that does land, because it goes through a different policy with a different
predicate.

> **Do not read a silent `partnership_declined` as this migration having half-worked.** It
> is the correct and predicted result. Making that one land is a second policy change on a
> different predicate and a separate decision - not a wider CHECK.

### The count, which depends on the unit

The brief said four. My census finds five. Both are right; they count different things.

| Unit | Count |
|---|---|
| Call sites emitting the three types (OPEN-M's unit) | **6** |
| Call sites that **start writing** after 095 | **5** |
| **Route files** that start writing after 095 | **4** |
| Call sites that stay silent | **1** |

Four routes and five call sites are the same fact counted twice: sites #12 and #13 are two
calls in **one** route, `app/api/rfp/guest/[token]/route.ts`. That is very likely where the
"four" came from.

### The census, run against the working tree

| # | Site | Type | Client | After 095 |
|---|---|---|---|---|
| 4 | `app/api/partnerships/route.ts:1200` | `partnership_declined` | session | **STILL SILENT** - RLS, active-only arm |
| 8 | `app/api/projects/[id]/onboarding-packages/route.ts:452` | `onboarding_deployed` | session | WRITES - route gates on `status = 'active'` |
| 9 | `app/api/projects/[id]/onboarding/deploy/route.ts:180` | `onboarding_deployed` | session | WRITES |
| 11 | `app/api/partner/rfps/[id]/response/route.ts:429` | `bid_submitted` | session | WRITES |
| 12 | `app/api/rfp/guest/[token]/route.ts:583` | `bid_submitted` | **service role** | WRITES |
| 13 | `app/api/rfp/guest/[token]/route.ts:768` | `bid_submitted` | **service role** | WRITES |

Site numbers are OPEN-M's (`docs/refusals-and-notifications-report.md:519-525`). **The line
numbers are this branch's and were re-checked, not copied** - OPEN-M records the onboarding
sites at `:448` and `:176`, four lines earlier than they now sit.

One honest caveat on the "WRITES" column, since it is a reasoned claim and not an executed
one: sites #8, #9 and #11 run on a session client, so they additionally require the
partnership to be **active** at the moment of the write. #8 is guaranteed - the route
returns 400 unless `partnership.status === 'active'`. #9 and #11 are not explicitly gated,
but reach the notification through an assignment or an RFP inbox row that implies an
accepted partnership. Sites #12 and #13 are unconditional: the service role does not see
RLS at all.

> **A CHECK constraint is not RLS, and the service role does not bypass it.** That is why
> #12 and #13 fail today despite bypassing every policy in the database, and it is the
> sentence most likely to be got wrong later. §4 of the refusals report lists them as
> "service role", which is correct about the policy and silent about the constraint.

---

## 4. What an agency will see in the bell that they did not before

> **An agency starts being told in-app that a bid landed.**

That is the headline change and the single most useful notification in the product. All
three `bid_submitted` sites are among the five that start writing, so it lands from the
authenticated partner flow **and** from both guest magic-link flows.

Concretely, an agency bell that today shows only partnership acceptances, project
assignments and awards starts also showing:

- **"New Vendor Bid"** / **"Vendor Bid Updated"** - `{vendor} submitted a bid on "{scope}"`,
  linking to `/agency/bids`.

And on the vendor side:

- **"Onboarding documents ready"** / **"Onboarding materials sent"** -
  `{agency} sent onboarding materials for "{project}"`.

### The E2 note, because the lesson outlives the fix

E2 on Aug 7 was marked **CONFIRMED LIVE** for fixing "both submission paths, email +
in-app". **The email half worked and was the only half checked.** The in-app half has
raised 23514 on every submission ever since.

A bell with nothing in it looks exactly like a bell with nothing to say, which is why
nobody caught it for nineteen days. The defect was eventually found by accident: 094's
pre-apply test copied a type out of the product's own type union to write a test row, and
the table refused it. **A confirmation that tests one of two channels and reports both is
the failure mode here, and it is worth more than the constraint change.**

---

## 5. Roadmap item - FLAGGED, NOT BUILT

### The bell has no filtering, grouping or pagination, and 095 is what makes that bite

Widening the CHECK means the bell starts filling with `bid_submitted` rows, which are the
highest-frequency event in the product. With 86 RFPs and real bid volume, an agency's bell
gets noisy fast.

Verified against the code, not assumed:

- `components/notification-bell.tsx:143` fetches `"/api/notifications?limit=20"` - a
  **hardcoded newest-20**, rendered as one flat list.
- `app/api/notifications/route.ts:41-52` supports `limit` and an `unread=true` filter, and
  has **no offset or range** - so there is no pagination to expose even server-side.
- The UI exposes **neither** parameter. There is no type filter, no grouping, no "load
  more", and no way to reach anything older than the twentieth-newest notification.

**What it would need, in one sentence:** cursor pagination on `created_at` in the API plus
a "load more" in the panel, and grouping by `type` (or by the `data.projectId` /
`data.responseId` already written into every row) so that eight bids on one RFP collapse to
one expandable line rather than eight.

Left for Greg. Not built.

---

## 6. Gates - Phase 0 baseline vs Phase 4, measured both times

Compared against the Phase 0 run in this session, not against any number in a document.

| Gate | Phase 0 baseline | Phase 4 | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | none |
| `pnpm build` | exit 0, 72/72 static, 173 route lines | exit 0, 72/72 static, 173 route lines | none |
| `pnpm lint` | exit 1, **182 problems (154 errors, 28 warnings)** | exit 1, **182 problems (154 errors, 28 warnings)** | none |
| `pnpm identity-columns:guard` | exit 0, 387 files, TOTAL 0 | exit 0, 387 files, TOTAL 0 | none |
| `pnpm org-id-reads:guard` | exit 0, Class A OPEN 14, Class B OPEN 60, REGRESSIONS 0, IMPROVED 1 | exit 0, Class A OPEN 14, Class B OPEN 60, REGRESSIONS 0, IMPROVED 1 | none |
| `pnpm embed-targets` | exit 0, 387 files, TOTAL 0 | exit 0, 387 files, TOTAL 0 | none |

**Every movement in either direction: there were none.** That is the expected result and
it is worth stating why rather than treating a flat table as self-evident - the only
TypeScript touched this session was a **comment**, and the three new files are `.sql` and
`.md`, which no gate reads. The build output was diffed line for line against the baseline
log with timings normalised out: **identical**.

Two standing conditions, both present in the Phase 0 baseline and therefore **not caused by
this session**:

- `pnpm lint` exits 1 on 154 pre-existing errors. It was already failing before any change
  here. Not touched.
- `org-id-reads:guard` reports **IMPROVED 1**: `lib/entitlements.ts` is recorded as 1 in
  `KNOWN_OPEN_MIRROR` and now finds 0. The guard passes anyway (it only fails on growth).
  **The count was not lowered** - editing a guard allow-list or a KNOWN_OPEN count is
  prohibited. Flagged for Greg as OPEN-3 below.

`verify-rls` and `policy-audit:guard` were **not run**, in either phase. Neither reads a
`.ts` file and neither is affected by anything in this session.

---

## 7. Which commit reverts what

Each phase is its own commit, so each is independently revertible. **This matters more than
usual this session**: it both commits a previously-private file and stages a change to a
live CHECK constraint, and those are only independently reversible because they are
independently committed.

| Commit | Reverting it undoes | Reverting it does NOT undo |
|---|---|---|
| **`bb75628`** `chore: commit CLAUDE.md` | Publishing `CLAUDE.md`; restores `.gitignore:19` | Anything about 095. **Note: reverting does not unpublish.** The blob is in history from this commit onward. |
| **`bbd1a7e`** `feat: author 095` | The migration, its down file, and the `lib/notifications.ts` comment correction | **Nothing in the database.** 095 is authored, not applied. If Greg has already applied it, this revert removes the *file* and leaves the *constraint widened*. |
| **`403d609`** `test: the 095 pre-apply test` | `docs/095-preapply-test.sql` | Anything else. Purely additive. |
| this commit | This report | Anything else |

> **`git revert bbd1a7e` is not a database rollback.** If 095 has been applied, the only
> thing that narrows the constraint again is running
> `095_notification_types_down.sql` - and read its header first, because after a working
> 095 it will likely raise 23514 and change nothing.

To revert the migration but keep the comment correction (they are one commit):
`git revert -n bbd1a7e && git checkout HEAD -- lib/notifications.ts && git commit`. The
comment describes 094's policy, is correct whether or not 095 exists, and should not travel
with a 095 revert.

---

## 8. Open items, each with the query that settles it

**OPEN-1. The four-versus-five write-site count.** The brief says four start working; the
census finds five call sites in four route files. A unit mismatch, not a behavioural
disagreement, and it changes nothing about whether to apply. Settled by eye against §3's
table, or mechanically:

```bash
# returns exactly the six call sites, one per line, in path order
{ grep -rn 'type: "onboarding_deployed"\|type: .onboarding_deployed.' app
  grep -rn "notifyBidSubmitted(\|notifyPartnershipDeclined(" app | grep -v ":import"
} | sort
```

**OPEN-2. Does `partnership_declined` deserve its own policy change?** After 095 it is the
only one of the eleven types that is wired, permitted by the CHECK, and still refused. It
needs an INSERT policy arm that admits a counterparty across a *non-active* partnership -
which is the same gap as OPEN-G (`partnership_invitation`, pending). One decision would
close both.

```sql
SELECT policyname, cmd, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='notifications' AND cmd='INSERT';
```

**OPEN-3. `org-id-reads:guard` reports `lib/entitlements.ts` recorded 1, found 0.**
Pre-existing, present in the Phase 0 baseline. The guard asks for the count to be lowered.
Not done - editing a KNOWN_OPEN count is prohibited to me, and it is a one-line change for
Greg.

```bash
pnpm org-id-reads:guard 2>&1 | grep -A3 IMPROVED
```

**OPEN-4. The row count in 095's header may drift.** It states 15, from a live query on
2026-08-25. After 095 lands, five write sites start adding rows. T3 in the pre-apply test
reports the actual number and never fails on a mismatch.

```sql
SELECT count(*) FROM public.notifications;
SELECT type, count(*) FROM public.notifications GROUP BY type ORDER BY count(*) DESC;
```

**OPEN-5. Nothing keeps the CHECK and the TypeScript union in sync.** They agree today,
verified mechanically this session. If the union gains a twelfth type, the constraint
refuses it silently at runtime and the next person meets 23514 exactly the way this one was
met. No gate reads a `.sql` file, and none compares the two lists.

```bash
diff <(sed -n '265,276p' lib/notifications.ts | grep -oE "'[a-z_]+'" | tr -d "'" | sort) \
     <(sed -n '292,341p' supabase/migrations/095_notification_types.sql | grep -oE "'[a-z_]+'" | tr -d "'" | sort)
```

**OPEN-6. Five permitted types still have no rows** - `partnership_invitation`,
`project_accepted`, `project_declined`, `new_message`, `document_uploaded`. Three different
causes; unchanged by this session. Recorded as OPEN-L in the refusals report.

```sql
SELECT type, count(*) FROM public.notifications GROUP BY type;
```

**OPEN-7. `.claude/settings.local.json` is hidden by a global gitignore**, not this repo's.
Not reproducible from a fresh clone. Configuration only, so nothing is lost - noted because
the ignore is invisible to anyone reading `.gitignore`.

```bash
git check-ignore -v .claude/settings.local.json
```

---

## 9. Executed / read / reasoned

**EXECUTED.** `npx tsc --noEmit`, `pnpm build`, `pnpm lint`, `pnpm identity-columns:guard`,
`pnpm org-id-reads:guard`, `pnpm embed-targets` - twice each, Phase 0 and Phase 4, plus
`tsc` again after the comment edit. `git log --all`/`git rev-list --all --objects` over
`CLAUDE.md`. Pattern scans of `CLAUDE.md` for nine classes of sensitive content, run again
against the staged blob. `git check-ignore -v` on every ignored path. Greps over `app`,
`lib`, `components`, `contexts`, `hooks` for every reference to the three types, every
`createOrgNotification`/`createNotification` call site with its `type`, and every caller of
`notifyBidSubmitted` / `notifyPartnershipDeclined`. A build-log diff, baseline against
Phase 4, timings normalised. Static verification of `docs/095-preapply-test.sql`: a scanner
respecting `''` escaping and `--` comments confirming quote balance; `BEGIN`/`END`,
`IF`/`END IF`, `LOOP`/`END LOOP` pairing; assertion accounting; and a byte-level diff of
its section A against the migration's `ALTER`. Literal-extraction diffs of the eleven types
across `lib/notifications.ts`, `095_notification_types.sql` and the down file's eight. Four
commits.

**READ in full.** `CLAUDE.md` (135 lines, the Phase 1 subject); `.gitignore`;
`.git/info/exclude`; `lib/notifications.ts`; `app/api/notifications/route.ts`;
`docs/094-preapply-test.sql` header, subject-resolution, T1/T2 and report/backstop
sections; `094_notifications_colleague_scope.sql` header and executable body;
`094_notifications_colleague_scope_down.sql` header; OPEN-M and OPEN-L in
`docs/refusals-and-notifications-report.md`.

**READ in part.** `LIGAMENT_CONTEXT.md` (RLS preamble, migration log, architecture rules,
UI rules, notification trigger map, backlog); `components/notification-bell.tsx` (the SWR
call and the type-label map); `app/api/partnerships/route.ts` (the decline branch);
`app/api/projects/[id]/onboarding-packages/route.ts` and `.../onboarding/deploy/route.ts`
(client construction, partnership resolution, the notification call);
`app/api/partner/rfps/[id]/response/route.ts` and `app/api/rfp/guest/[token]/route.ts`
(client construction and the `notifyBidSubmitted` calls); `package.json` scripts.

**REASONED, and therefore unverified against a live database.** **No statement was executed
against Postgres and no database was contacted at any point.** Everything about the live
constraint, the eight permitted values, the 15 rows and their three types is taken from
094's pre-apply run on 2026-08-25 as recorded in `docs/094-preapply-test.sql` and OPEN-M,
per the standing instruction to take the state as given. That 095 applies cleanly, that
validation cannot fail, and that the down file will raise 23514 once new-type rows exist
are all **predictions from the shape of `ADD CONSTRAINT`**, not observations - which is
precisely what `docs/095-preapply-test.sql` exists to convert into observations before
anything is applied. The "WRITES" column in §3 is reasoned from each route's client
construction and partnership gating; only site #8's active-partnership requirement is
guaranteed by an explicit check in the route.

---

## 10. Next action for Greg

1. Read `CLAUDE.md` as committed in `bb75628` and confirm the Phase 1 audit agrees with
   what you expected to be in it.
2. Run `docs/095-preapply-test.sql`. Expect **"SAFE TO APPLY 095."** with 10/10.
3. Dry run `supabase/migrations/095_notification_types.sql` - **COMMIT is line 341**.
4. Apply it, then run V1-V6.
5. Update the migrations table in `LIGAMENT_CONTEXT.md`.
6. Submit one bid and watch the agency bell. That is the check E2 never did.

**Nothing was pushed.**
