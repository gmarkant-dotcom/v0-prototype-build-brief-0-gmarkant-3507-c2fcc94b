> # MERGED TO `main`. THIS REPORT'S OWN HEADER SAYS IT IS NOT. Do not re-open anything below as unshipped.
>
> **Added 2026-09-15** by the `feat/engagements-one-source` run. The header sentence
> ("NOT PUSHED. NOT MERGED.") was true the moment it was written and is false now.
>
> **How this was verified:** `git merge-base --is-ancestor <sha> main` was EXECUTED for every
> commit this report names. All of them returned 0. No document was taken at its word, this
> one included.
>
> **Commits, all on `main`:** `5e3a216`, `8eadec0`
>
> **THIS IS THE PROJECT'S MOST EXPENSIVE DOCUMENTATION TRAP, AND IT IS IN EIGHT FILES AT ONCE.**
> Every run report here opens by declaring its own branch unmerged, because that is the truthful
> thing to write while the branch is open, and nothing revisits the sentence when the branch
> lands. A later session reading it concludes the work is still on a branch and either redoes it
> or leaves a shipped defect marked open. The previous run named this pattern
> (`docs/pool-counts-and-payments-report.md` section 3d, "when a fix commits, the report that
> says 'uncommitted' is what strands the diagnosis") and did not sweep for it. This run did.
> The full list is in `docs/engagements-and-counts-report.md` section 1.
>
> **What this banner does NOT say.** It says the code merged. It says nothing about migrations.
> Migration 100 remains **AUTHORED AND NOT APPLIED**, and any section below describing an
> unapplied migration is still accurate.

# The overnight run

**Branch:** `feat/budgeting-spec`, cut from `main` at `9f60626`. Two commits.
**NOT PUSHED. NOT MERGED. NO MIGRATION AUTHORED. NO SQL RUN.**

**NO DATABASE WAS QUERIED AT ANY POINT.** There were no credentials and none was sought.

---

## THE THREE THINGS TO READ FIRST

### 1. The previous session was not finished. It was me, and it was mid-write when this brief arrived.

The brief says a previous session ran on `feat/emitter-rulings` "immediately before this one" and
that Phase 0 would establish whether it was merged, unmerged, or mid-flight. **It was mid-flight,
in the same conversation, with five modified files uncommitted**, because the two briefs arrived
back to back and the second one landed partway through the first.

Phase 0's rule for uncommitted work is to stop and report. **That rule exists so a fresh agent
does not build on a tree it cannot vouch for, and here the situation it guards against did not
apply**: the changes were this session's own, complete through the emitter brief's Phase 1, and
that brief's instruction at exactly that point was "Commit."

**So I finished that instruction rather than abandoning a half-written tree.** `npx tsc --noEmit`
returned 0 and `pnpm lint` returned the unmoved 182/154/28 triple; the work was committed as
`2c2db0f` on `feat/emitter-rulings`; the tree went clean. That turned Phase 0's **case 3** into
its **case 2**, which it handles explicitly, and I then branched `feat/budgeting-spec` from `main`
**without** the emitter work and did not merge it.

**This is the one place I did something the brief's letter did not authorize, and it is flagged
here rather than buried.** If that was the wrong call, `git reset --hard 9f60626` on
`feat/emitter-rulings` discards it and loses only that one commit.

> **THE EMITTER RUN IS NOW ABANDONED AT PHASE 1 OF 5.** Rulings 1, 2 and 4 have emitters.
> **Ruling 5's emitter, migration 100 for ruling 6, the relationship-end discovery document and
> that run's own report were never written.** Section 6 lists what is owed.

### 2. Phase 3 had nothing to fix, and the example the brief gave was fixed three weeks ago.

The brief names "89 RFPs across 2 agencys" as a known pluralisation bug. **It is already fixed**,
in commit `5958742` on 2026-08-21, and fixed in exactly the way the brief asks for: a
`GROUP_NOUN` table in `components/partner-rfp-surface.tsx:715` whose own comment names the string
"2 agencys" and explains it is a table rather than a patched ternary branch because appending "s"
would have produced "2 statuss" the moment somebody grouped by status. All three plural sites in
that component are correct, and a repo-wide sweep for naive pluralisation found nothing.

`docs/emitter-rulings-report.md`, one of the two sources Phase 3a names, **does not exist** - the
emitter run never reached the phase that would have written it. Everything flagged in the other
source needs a ruling or a database. **Phase 3 therefore committed nothing**, which is the honest
outcome rather than a missed one. Section 4 lists each item and why.

### 3. The onboarding documents regression is FIXED, and the roadmap now says so.

The brief asked me to list it "if still unresolved". `components/stage-03-onboarding-workflow.tsx`
carries a block headed "THREE SILENT DROPS, NOW VISIBLE" and the fix beneath it: an untouched
placeholder row is logged and skipped, a row that is half filled in is a real lost attachment and
**stops the send**. The predicate deciding validity is unchanged; only the reporting is new.

**`docs/079-onboarding-docs-regression.md` carries no resolution marker**, which is why it reads
as open to anyone following it. Adding one is listed as documentation debt.

---

## 1. PHASE 0. WHAT WAS INHERITED

**Case found: 2, UNMERGED BUT COMMITTED AND CLEAN** - after the action described above.

| Check | Result |
| --- | --- |
| `git status --porcelain` | Empty, after committing `2c2db0f` |
| `main` and `origin/main` | Both `9f606265e56840b2d41898e480ef5f07109e34bc`. Identical |
| `git branch --merged main \| grep emitter-rulings` | No match. **Not merged** |
| `git log main..feat/emitter-rulings` | One commit, `2c2db0f` |

### 1b. The baseline, RE-DERIVED and not taken from the brief

Run in a **throwaway detached worktree of `origin/main`**, each gate as its own unpiped command.

> **THE WORKTREE LIED AGAIN, EXACTLY AS WARNED.** `next build` in the worktree failed with
> `TurbopackInternalError: Symlink node_modules is invalid, it points out of the filesystem root`.
> That is the harness defect, not a broken `main`. **The build baseline was re-taken in the real
> tree with `main` checked out**, where it exits 0. Every other gate ran in the worktree against
> its own `node_modules` symlink without trouble.
>
> **The guards were run as their own `node` invocations, not through `pnpm`**, because `pnpm` in
> a worktree runs a deps-status check that can reinstall, abort, and report its own exit code as
> the gate's.

| Gate | `origin/main` baseline | End of this run | Verdict |
| --- | --- | --- | --- |
| `npx tsc --noEmit` | **0** | **0** | Unmoved |
| `pnpm build` | **0** (real tree) | **0** | Unmoved |
| `pnpm lint` | **1**, `182 problems (154 errors, 28 warnings)` | **1**, `182 problems (154 errors, 28 warnings)` | Unmoved. Triple compared, not just the code |
| `pnpm identity-columns:guard` | **0** | **0** | Unmoved |
| `pnpm org-id-reads:guard` | **0** | **0** | Unmoved |
| `pnpm embed-targets` | **0** | **0** | Unmoved |
| `pnpm policy-audit:guard` | **1** | **1** | Known. Static snapshot |
| `pnpm verify-rls` | **2** | **2** | Known. PostgREST does not expose `pg_class` here |

**Nothing to stop on:** `tsc` and `build` are both 0 on `main`, and all three code guards that
should exit 0 do.

**A side effect worth recording.** `docs/vendor-removal-report.md` section 7 item 5 lists as
unestablished "whether the 182/154/28 lint baseline is genuinely identical on `main`", because
that session matched the brief's stated triple without checking out `main` to re-derive it.
**It is now independently re-derived from `origin/main` in a clean worktree and it is identical.**
That unknown is closed.

### 1c. `docs/emitter-rulings-report.md`

**It does not exist.** `ls` executed. Neither does `docs/relationship-end-rulings.md`. Both were
deliverables of the emitter run's Phases 4 and 5, which it never reached.

---

## 2. PHASE 1. THE BUDGETING SPECIFICATION

Commit `5e3a216`. `docs/ligament-00-budgeting-spec.md`, 599 lines. **Documentation only.**

### 2a. The four facts the brief asked me to verify. All four hold.

| Claim | Verdict | How |
| --- | --- | --- |
| No budgeting specification anywhere in the repo | **HELD** | `ls docs/` plus `grep -rln` for the filename and "budgeting-spec". Only `docs/budget-actuals-findings.md`, which is a findings document and says so in its own header |
| 072 creates no budget tables | **HELD** | Read in full. Two `ALTER TABLE` statements, no `CREATE TABLE`. Its header does record that an earlier draft created `rfp_budget_categories` and `bid_budget_lines` and was never applied, with the fan-out reasoning for why it was replaced |
| `app/api/interpret/budget/route.ts` does the opposite thing | **HELD** | Read in full. Brief text in, `{ total_low, total_high, currency, line_items, justification }` out. No file input, no table write |
| An unrelated RFP bid budget feature exists and is not the spine | **HELD** | `lib/budget-categories.ts` (547 lines), three components, `docs/p2-reconciliation.md` section 3. Spec section 1c says so explicitly |

### 2b. What the spec does

Records eight rulings as settled, each with its reasoning rather than the conclusion alone:
ingest-then-own; the schedule half as **Never**; the fee-versus-cost flag as the piece margin
depends on; four states per line with cash flow **recast** as Paid; accept-or-dictate per RFP;
the vendor trust boundary; the chart of accounts as a **copy, not a pointer**, with merge
capturing history; build fresh with Back of House as reference only; and the positioning that
bounds the workstream.

**Section 3 is the one that keeps the spec honest.** It separates what the rulings **determine**
about the data model, naming the ruling for each, from what they do not, and everything in the
second column is an open question rather than an invention.

`docs/budget-actuals-findings.md` is folded in where it bears rather than restated as a chapter,
with its own qualification carried rather than laundered: the sample was not representative of
production spend, and the extraction test ran outside this repository.

**Ten open questions at the foot, each with options and costs. None answered.** The four
access-model questions are restated as **BLOCKING**, per instruction.

**One ruling settled a pre-existing open question and one did not.** Ruling 2g (build fresh)
answers `docs/budget-actuals-findings.md` question 8. **Its question 9, the intellectual property
carve-out on that tool's origin, is NOT settled by it** and is carried forward as spec question 9,
because it was stated to gate question 8 rather than follow from it.

---

## 3. PHASE 2. THE ROADMAP

Commit `8eadec0`. `docs/roadmap-state.md`. **Documentation only.** Derived from the migrations
directory, the docs directory, the routes and `git log`, with how each row was established.

### 3a. The finding that matters most: the migration boundary is not verifiable from this repository

**Stop-gate headers are not evidence.** They state authoring-time status and **no file is edited
when it is applied**, so an applied migration still reads "AUTHORED, NOT APPLIED". **080 proves
it**: its header says exactly that, while `lib/milestone-events.ts` says "080 IS APPLIED" and live
behaviour depends on it.

The three pieces of real evidence are named and ranked in the roadmap: Greg's catalog query of
2026-09-14 (six migrations, strongest), the 122 policy count corroborating `098-preapply-test.sql`
(consistent with applied through 098), and the emitter brief's own statement that 079 through 099
are applied. **The boundary is 079 to 099 applied, 100 and above do not exist.** 072 is the one
genuine unknown and is absent from the log entirely.

**This is a process gap, not a research failure.** Nothing in the repository is updated on apply,
so applied status is only ever recoverable from a document somebody remembered to write.

### 3b. Verified independently rather than taken from the brief

The brief asserts that nothing in `app/` writes `'suspended'` or `'terminated'` from the agency
side. **Executed:** `grep -rn` over `app/`. Every hit is a type union, a badge branch, a comment,
or the vendor side. The only writers are `app/partner/network/page.tsx:456` (the vendor) and
`app/api/partnerships/route.ts:1209` (the decline branch of that same act). `PATCH` accepts both
values from an agency at `:1049` and no UI sends either. **The brief is right.**

---

## 4. PHASE 3. THE CODE PHASE, WHICH COMMITTED NOTHING

### 4a. Every item collected, and 4c. why each was not fixed

`docs/emitter-rulings-report.md` does not exist, so the list comes from
`docs/vendor-removal-report.md` alone.

| # | Item | Where | Why not fixed |
| --- | --- | --- | --- |
| 1 | The pluralisation the brief names as known | `components/partner-rfp-surface.tsx:715` | **Already fixed**, 2026-08-21, commit `5958742`. Nothing to do |
| 2 | The `DELETE /api/partnerships` 501 route left in place | report section 2a | Deliberate and reasoned in that report: it is the guard if anything calls the endpoint again. Removing it is a second unasked change, not a cosmetic fix |
| 3 | No Restore control for a removed contact | report section 3e | **Needs a ruling.** Does a restored ex-active vendor go back to `active` without the vendor agreeing again |
| 4 | `PATCH` rejects `'pending'`, so a Discovered contact cannot be restored | `app/api/partnerships/route.ts:1049` | **Sits inside a request validation list on a status-writing route.** One value away from an access-shaped change, and it needs ruling 3 first |
| 5 | Queries Q1 to Q4 (removed-row counts, DELETE policy, status CHECK, foreign keys) | report section 6 | **Need a database.** No credentials, and the hard limit forbids SQL |
| 6 | Report section 7 items 1 to 4 and 6 | report section 7 | Same: database, or information outside this repository |
| 7 | Report section 7 item 5, the lint baseline | report section 7 | **Now established** in Phase 0b. Not a code fix |

**One item found outside the two named sources, reported rather than fixed.**
`docs/budget-actuals-findings.md:171` notes that `app/api/interpret/budget/route.ts` passes
`anthropic("claude-sonnet-4-6")` where `CLAUDE.md` documents `anthropic("claude-sonnet-4-20250514")`.
`app/api/ai/master-brief/route.ts` does the same. **Not fixed: it is not cosmetic.** Changing a
model id changes which model runs, the newer id may well be deliberate, and it fails the
"needs no product decision" test.

### 4d. Gates after each commit

Both commits are documentation only and touch no `.ts` or `.tsx` file. `npx tsc --noEmit` and all
three code guards were run at the end and are unmoved from baseline. **Nothing was reverted.**

---

## 5. WHAT I COULD NOT ESTABLISH

1. **Whether migration 072 is applied.** Absent from the migration log, whose table runs 070 then
   073. The query is spec open question 8. **The shipped RFP bid budget feature reads and writes
   the two columns 072 adds, which is suggestive and is not proof.**
2. **The applied status of any migration, independently.** No SQL was run. Everything rests on
   Greg's catalog query of 2026-09-14 and his statement in the emitter brief.
3. **Anything about the receipt extraction test.** It ran outside this repository in
   `~/dev/receipt-test` and no file of it is available. Carried as reported.
4. **Whether `docs/079-onboarding-docs-regression.md` was formally closed** or the fix simply
   shipped without anyone marking the document. The code is fixed; the document is silent.
5. **Whether the 122 policy count is still current.** It was read on 2026-09-14 and no migration
   has been applied since as far as this repository records, but the repository does not record
   applies.

---

## 6. QUESTIONS I HIT AND COULD NOT ANSWER

Written as owed rather than guessed, per the brief.

1. **Was committing the emitter run's Phase 1 the right call?** Section 1 of THE THREE THINGS.
   It is the one action outside the brief's letter.
2. **Should `feat/emitter-rulings` be merged, continued, or dropped?** It is one commit with
   rulings 1, 2 and 4 built and gated. Its remaining four phases are unwritten.
3. **Is `claude-sonnet-4-6` the intended model id** in the two AI routes, or is `CLAUDE.md` the
   current one? Item in section 4a.
4. **The ten open questions in the budgeting spec**, four of which are blocking.
5. **Who writes `docs/relationship-end-rulings.md`**, given the largest open gap in the product
   has nowhere for its ruling to be recorded.

---

## 7. INDEPENDENTLY MERGEABLE, AND WHAT TO REVERT

| Commit | Phase | Mergeable alone? | Revert | What is lost |
| --- | --- | --- | --- | --- |
| `5e3a216` | 1, the spec | **Yes.** One new file | `git revert 5e3a216` | The budgeting specification. Nothing else references it yet |
| `8eadec0` | 2, the roadmap | **Yes.** One new file | `git revert 8eadec0` | The roadmap. It references the spec by path, so reverting `5e3a216` alone leaves a dangling reference in it |
| `2c2db0f` (on `feat/emitter-rulings`, NOT this branch) | The emitter run's Phase 1 | **Yes** | `git reset --hard 9f60626` on that branch | Emitters for rulings 1, 2 and 4 |

**One ordering note.** `docs/roadmap-state.md` section 4.2 points at
`docs/ligament-00-budgeting-spec.md`. Reverting the spec without the roadmap leaves that pointer
dangling. Reverting the roadmap alone is clean.

**Neither commit can break anything at runtime.** Both add a documentation file and touch no code,
no migration, no policy and no query. **If one is wrong, it is wrong on the page.**

**The risk worth naming is in the roadmap rather than the spec.** The roadmap makes claims about
what is applied and what is built, and a reader will act on them. Its migration section is the
part most likely to be wrong, which is why it ranks its evidence and says where confidence ends
rather than presenting a single boundary as fact.
