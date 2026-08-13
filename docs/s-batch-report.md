# S-Batch Run Report

Aug 13, 2026. Five commits, S1 and R1 through R4, stacked on the unpushed Q-batch. Not pushed.
`npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after every commit. Corruption scan clean.
No em dashes introduced. No migrations.

| Commit | What |
| --- | --- |
| `a26b81a` | S1 per-RFP bid evaluation could not persist anything |
| `2c04b3e` | R1 vendor bid tab no longer resets under refetch or autosave |
| `facc439` | R2 vendor note per budget category |
| `39aa78a` | R3 preset budget categories are money-only |
| `4c62ded` | R4 vendor-side HelpTerm captions on the bid form |

## Preflight

Working tree clean. `origin/main` at `f40ec9b` - the Phase 2 batch has been pushed since that run
reported. **Q-batch verdict: exists locally, unpushed** (`c4563c4`, `2f966d3`, `f1ef467`,
`768c2ba`). Stacked on it; nothing rebuilt. Nine unpushed commits total after this batch.

---

## S1 - per-RFP bid evaluation could not persist anything

Three failing operations, three diagnoses, all confirmed against the live database rather than
reasoned from source alone.

### (a) Save Evaluation and (b) Generate AI Scores - same root cause

Suspect (ii) from the brief: a conflict target that cannot match. Migration 075 backs the
per-RFP half of `bid_evaluation_scores` with a **partial** unique index:

```sql
CREATE UNIQUE INDEX ... ON bid_evaluation_scores (evaluation_id, rfp_criterion_key)
  WHERE rfp_criterion_key IS NOT NULL;
```

It had to be partial: 065's `UNIQUE(evaluation_id, criterion_id)` cannot cover rows whose
`criterion_id` is NULL, because NULLs are distinct in a unique constraint. But Postgres only
accepts a partial index as an `ON CONFLICT` arbiter when the statement repeats the index
predicate, and PostgREST emits no `WHERE` clause. Both writers called
`.upsert(..., { onConflict: "evaluation_id,rfp_criterion_key" })`, so every per-RFP score write
failed at **plan time**, before touching a row.

Probed live, with a deliberately unsatisfiable FK so nothing could be written under any outcome:

```
on_conflict=evaluation_id,rfp_criterion_key -> HTTP 400  42P10
   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
on_conflict=evaluation_id,criterion_id      -> HTTP 409  23503  (expected FK rejection)
```

The second proves the legacy path plans fine and is untouched by this fix.

Corroborated in the data: **14 legacy score rows, and zero rows with `rfp_criterion_key` set**, on
an RFP that does carry seven per-RFP criteria. Nothing per-RFP had ever persisted. The composite
showed 42 because it is computed in the browser from the draft, never read back.

**Fix.** New `writeRfpCriterionScores()` does select-then-update-or-insert instead of upserting.
That is the pattern this codebase already uses for exactly this reason - see the
`project_assignments` write in `app/api/agency/rfp-responses/[id]/route.ts`, which avoids
`onConflict` because it has no real unique constraint to target either. No migration; the partial
index still does its real job of preventing duplicates. The writer only touches columns the
caller supplies, so an AI rescore cannot blank a human score and a human save cannot blank the
AI's.

**Write shapes:**

| | Shape |
| --- | --- |
| Before (rejected) | `{ evaluation_id, rfp_criterion_key, criterion_name_snapshot, weight, ... }` via `ON CONFLICT (evaluation_id, rfp_criterion_key)` |
| After, per-RFP | `criterion_id` omitted -> NULL, `rfp_criterion_key` set, `criterion_name_snapshot` set; UPDATE by id when the row exists, INSERT otherwise. Satisfies 075's exactly-one-criterion CHECK. |
| After, legacy | **Unchanged** - `criterion_id` set, `rfp_criterion_key` NULL, still `.upsert` on `evaluation_id,criterion_id`. |

Both directions verified: the legacy branch is byte-identical to before, and the probe confirms
its conflict target still plans.

### (c) AI Analysis never resolves

Not a write-shape bug and not a per-RFP bug - **a partial failure reported as success.**

Live evidence on the bid in question: `ai_summary_generated_at` stamped today,
`ai_summary_short` PRESENT (473 chars), `ai_summary_detailed` NULL.

`generateAndSaveBidSummary` fires two Anthropic calls in parallel and returns `ok` when EITHER
succeeds. The 200-token short call landed; the 1400-token detailed call hit the shared 25s
default timeout and failed. The route returned 200, the sheet treated that as success, and the
Analysis tab rendered "No analysis available yet" forever - no error, no Retry, and a stamped
`generated_at` implying it had run fine. The function has always returned
`short_failed`/`detailed_failed`. Nothing read them.

**Fix.** The detailed call gets its own 50s budget; the route's `maxDuration` goes 30 -> 60 to
hold it; the partial failure is logged; and the sheet now reads `detailed_failed` and shows the
existing error-with-Retry treatment instead of the silent empty state. Success still clears the
error, since `setAnalysisError(null)` runs at the top of every attempt.

Also per the brief: the AI analysis prompt now receives the per-RFP rubric (it already received
the category breakdown and proposal sections), and the evaluation route's post-completion
recommendation prompt does too - it was reasoning about a composite score with no rubric behind
it.

---

## R1 - vendor bid tab resets

### Mechanism

**Deterministic, not intermittent, and the vendor's own autosave triggered it.**

`app/partner/rfps/[id]/page.tsx` had an effect calling `setActiveTab` unconditionally on every
run, with `inbox` and `existing?.status` among its dependencies. `inbox` is a fresh object on
every refetch, so the effect re-ran on refetches that changed nothing. Worse, the predicate
guarantees a flip: an unanswered RFP has `currentStatus === "new"`, which is not in the submitted
list, so `shouldDefaultToStatus` is TRUE. The vendor opens the RFP (lands on Status & Feedback),
clicks My Bid, types, and the first autosave turns `existing` from null into a row - the
dependency changes, the effect re-runs, and it reasserts "status" over the tab they were working
in.

### Fix

A default is a starting position, not an invariant to re-impose. It is applied once per RFP **id**
and never again; after that the tab moves only when the vendor moves it. Keyed on id rather than
a bare "already ran" ref because the App Router reuses this component when navigating between two
RFPs - a mount-scoped ref would leave the second RFP stuck on the first one's tab.

Same class, same file, also fixed: the awarded/declined effect re-asserted "status" on every
render that observed a terminal status, so a vendor looking at an awarded bid could not stay on
any other tab. It now fires on the TRANSITION into that status, tracked per `id:status`.

### Sweep

The agency bid-detail sheet's Analysis / Cost Breakdown / Evaluate group is **already immune and
left unchanged**. Its default is a `useState` initializer (`useState(initialTab || "analysis")`),
not an effect - the only other `setActiveTab` in that file is the user's own `onValueChange`
handler. Its inner component is keyed on `row.id`, so an SWR refetch producing a new object with
the same id does not remount it either. Nothing to fix; reported rather than edited to look
fixed.

---

## R2 - vendor note per budget category

One optional "Note or assumptions (optional)" field per budget CATEGORY on both bid paths, for
caveats a bare number cannot carry - exclusions, day counts, what a figure assumes. No per-line
notes: itemized lines already have a description field.

Stored inside the existing `budget_lines` JSONB as an optional `note` on each category entry. No
migration, no new column; every bid submitted before this simply has no note, which reads
identically to "left blank".

**A note alone is not an answer.** `buildBudgetLinesForSave` still skips a category with no
number, so a note in an otherwise-empty category cannot make the readiness count or the submit
gate believe it was filled in.

**Visually distinct from the agency's guidance**, which was the real risk - the two are different
things wearing similar words. The agency's guidance sits ABOVE the money, unlabelled, directly
under the category name (it is the question). The vendor's note sits BELOW the money with its own
explicit label (it is the answer's caveat).

Read surfaces: bid detail / cost breakdown prints the note under the category row, italic and
quiet, beneath the number it qualifies. The comparison table keeps its numbers clean - a category
where any vendor left a note gains a small marker on its label and becomes expandable, with the
notes rendered inside the existing expand panel alongside any itemization. Categories with
neither notes nor itemization stay flat and unexpandable.

Autosave and Save draft carry it on both paths with no extra wiring - the note travels inside the
same `budget_lines` payload the subtotals already use.

---

## R3 - preset budget categories are money-only

Live proof of the defect: a vendor entered $235 under "Included hours". That category asks a
question no dollar figure answers.

| Bundle | Before | After |
| --- | --- | --- |
| Standard production | Production, Post-production, Talent and cast, Location, Equipment, Crew, Travel and per diem, Contingency, Agency fee | **Same nine.** All are genuine cost buckets. Contingency and Agency fee gained "As a cash amount, not a percentage." |
| Retainer | Monthly retainer, **Included hours**, **Overage rate**, Pass-through costs | **Monthly retainer, Pass-through costs.** The two terms removed and folded into Monthly retainer's guidance: "The recurring monthly fee. State how many hours it includes and your overage rate in your note." |
| Project fee | Project fee, Expenses, Revisions | **Same three.** Revisions survives (revision rounds can be priced) but gained "The cost of the revision rounds you are including. State how many rounds that covers in your note." |

Contingency and Agency fee are habitually quoted as a percentage, and the field takes cash - the
same wrong-unit error as Included hours, caught before it happens. Every fold lands in the note
field R2 shipped a vendor-side counterpart for.

**Data is untouched.** Presets are a source list read at click time; an RFP already broadcast
carries its categories inside its own `master_rfp_json` or `rfp_magic_tokens` row, and nothing in
this commit reads or rewrites those. An RFP broadcast yesterday with Included hours still has it,
still renders it, and still shows whatever a vendor entered against it. Only the next preset
click differs.

---

## R4 - vendor-side HelpTerm captions

Two new glossary entries in `lib/glossary.ts` and `docs/glossary-content.md`: **Needed**, and
**Note or assumptions**.

New in this commit:

| Term | Where |
| --- | --- |
| `budget_needed` | the NEEDED badge on an unanswered category |
| `budget_category_note` | the R2 note label |

Already placed by Q3 in the same view region, and deliberately NOT given a second cue - the brief
named five targets and three were already covered:

| Term | Where |
| --- | --- |
| `additional_items` | the Additional items category name, vendor side |
| `itemized_line` | the block's intro line, "a subtotal, or itemize it" - this IS the itemize-versus-single-subtotal term, and the per-category Itemize / Use a single subtotal buttons sit in the same block |
| `guided_proposal_sections` | the "Guided sections (optional)" label |

The Needed entry carries the rule that actually trips vendors up: an honest 0 clears the badge,
because a blank is ambiguous where a zero is an answer. The note entry defines itself against the
agency's guidance explicitly, since the two sit in the same card.

Final vendor-form cue inventory, extracted from source: `budget_category`, `itemized_line`,
`additional_items`, `budget_needed`, `budget_category_note`, `guided_proposal_sections`. Six
terms, six cues, no term cued twice in one region.

---

## Open questions

1. **Q-batch is unpushed and now has S/R stacked on it** - all nine commits must go together.
2. **The evaluation route's legacy branch still uses `.upsert`**; only the per-RFP branch changed
   to select-then-write. Deliberate - the legacy conflict target is a real constraint and works -
   but the two write paths in one function now differ in shape.
3. **~170 unguarded `hover:` rules remain app-wide** (Q2 finding), plus the `border-sky-500`
   literal on the MSA button (Q4). Both design-pass items.
4. **Step 2's Continue validation is new behavior** added by Q1, not pre-existing.
5. **Award-created vs invite-created partnership state** - `award-partnership-resolution.ts`
   branch d never sets `invitation_sent_at`, so an award-created partnership would be Active with
   no invitation history. No such row exists yet. Flagged in the Q-batch report, still open.
6. **`bid_scoring_templates` is untouched by per-RFP criteria** - a template still applies to the
   global rubric only.

---

## Verification statements

Verified:

- `npx tsc --noEmit` exit 0 and `pnpm build` exit 0 after each of the five commits.
- Markdown-link corruption scan clean.
- S1's diagnosis: live read-only queries plus one write-safe `ON CONFLICT` probe that could not
  insert under either outcome (42P10 at plan time, or 23503 on an unsatisfiable FK).
- R3's shipped category list re-extracted from source after the edit rather than trusted from the
  diff; grep confirms no code reference to the two removed names remains.
- R4's cue inventory extracted from source.

Not verified:

- **No browser was opened at any point.** No evaluation saved, no scores generated, no tab
  observed, no bid submitted, no preset clicked, no popover opened.
- S1's 42P10 fix is proven at the mechanism level; that the new writer succeeds end to end is
  reasoned, not observed.
- R1's mechanism is read from the dependency array and the predicate, both deterministic, but no
  tab was observed flipping or staying put.
- R2's round trip through `seedBudgetDraft`, `buildBudgetLinesForSave` and `normalizeBudgetLines`
  is verified by reading, not by saving.

## Next steps

These nine commits are unpushed. Push them together, then re-test the three S1 operations against
the live per-RFP-scored bid: Save Evaluation, Generate AI Scores, and the Analysis tab. Confirm a
legacy global-rubric bid still scores and saves unchanged - that is the half most at risk from
this fix and the one no automated check covers.
