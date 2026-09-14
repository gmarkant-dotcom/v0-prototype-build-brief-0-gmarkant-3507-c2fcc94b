# Budget actuals: what a throwaway extraction test established

**Date:** 2026-09-11
**Branch:** `feat/budgeting-findings`
**Status:** input to a future specification session. **This is not a specification.**
**Scope of this run:** one new file. No application code, no migration, no script, no SQL,
no change to any existing file.

---

## What this document is

A planned "00 Budgeting" stage would let a user upload their project budget, have Ligament
deconstruct it, and drive RFP allowances, margin visibility and delivery actualization from
it. Part of that is an **actuals feeder**: receipts and invoices are read, categorized against
a chart of accounts, and become the authoritative "actual" figure per budget line.

On 2026-09-11 a throwaway accuracy test was run to decide whether the actuals feeder is worth
building **before** any integration work begins. It was a standalone Python script at
`~/dev/receipt-test`, **not in this repository**, and it is not available to the author of this
document. What follows records what that test established, so that a later specification
session starts from evidence rather than from memory.

**None of the budgeting stage is built.** See "What exists in the repository today" below for
what that claim survives contact with.

---

## THE SAMPLE WAS NOT REPRESENTATIVE OF PRODUCTION SPEND

This is the first thing to read and it qualifies everything after it.

21 PDF files were processed page by page through the Anthropic API. Each page was extracted and
categorized against a 16-category chart of accounts. **280 receipts were extracted.**

The files were **personal expense reports from 2014 and 2015**. Their composition:

| Category | Entries | Share |
| --- | --- | --- |
| Catering | 129 | 46% |
| Travel | 74 | 26% |
| **Meals and cabs combined** | **203** | **73%** |
| Lodging | 1 | untested |
| Talent | 1 | untested |
| Fabrication | 1 | untested |
| Insurance | 1 | untested |

Three quarters of the set is meals and cabs. Four categories that a production budget leans on
heavily saw exactly one document each, which is not a test of those categories at all. Nothing
in the set resembles a vendor invoice, a talent payment, a fabrication quote or a certificate
of insurance.

**CONSEQUENCE: no rate in this test is a measured performance figure, and none is quoted here
as one.** A review rate was observed on the final run. It is deliberately not reported in this
document, because a rate measured on a set that is 73% restaurant checks says nothing about how
the feature would perform on production spend, and a number in a document outlives the caveat
attached to it. Counts that describe the **structure** of what was found are reported below,
because structure is what this test can actually establish. Every one of them carries its
caveat inline.

What this test **can** establish is architectural: what shape the data arrives in, where the
accuracy lever sits, and which failure modes exist at all. That is what the seven findings are.

---

## Verification statement: read in this repository versus taken from the brief

**Taken from the brief and not verifiable here:** everything about the test itself. The 21
files, the 280 receipts, the 16-category chart, the per-file receipt counts, the confidence
scores, the malformed-page counts and the cross-run entry counts all come from a script outside
this repository that the author of this document never saw. They are recorded as reported.

**Read in this repository**, with the result of each check:

| Claim | Verdict | Evidence |
| --- | --- | --- |
| There is no budgeting specification file anywhere in the repo | **Held, with a qualification** | `grep -rin "chart of accounts\|back of house\|actualization\|actuals"` across `*.md *.ts *.tsx *.sql` returns **nothing**. `find` for filenames matching `*receipt*`, `*actual*`, `*ledger*`, `*chart-of-accounts*` returns **nothing**. Budget material does exist, but it is a different feature. See the qualification below. |
| `072_budget_structure.sql` creates no budget tables | **Held** | Two statements: `ALTER TABLE rfp_magic_tokens ADD COLUMN IF NOT EXISTS budget_categories jsonb NULL` and `ALTER TABLE partner_rfp_responses ADD COLUMN IF NOT EXISTS budget_lines jsonb NULL`. No `CREATE TABLE`. Two further notes below. |
| `app/api/interpret/budget/route.ts` exists and does the opposite thing | **Held** | Read in full. It estimates. It ingests nothing. Described accurately below. |
| `docs/079-onboarding-docs-regression.md` is the same shape of failure | **Held** | Read in full. The match is exact, not approximate. Cited in finding 6. |
| Migration 085 set the principle that a company name survives the end of a relationship and its commercial terms do not | **Held** | Read in full. That sentence is close to verbatim from the file. Described in finding 7. |
| The organization model is "now live (migrations 079, 083, 085, 086)" | **Partially contradicted** | See below. |
| An earlier ruling dated 2026-09-10 treated `source_document` as producing ledger entries one-to-one | **Not verifiable here** | `grep -rn "source_document\|source document"` across `docs/` and the root `*.md` returns **nothing**, and no file in the repository carries that date. The ruling is outside this repository. Finding 1 corrects it on the brief's word alone. |
| Existing rulings cover the vendor trust boundary for budget data | **Not found as a written ruling** | The phrase "trust boundary" appears nowhere in the repository, and no document states that a vendor never sees the master budget. What exists is that boundary **implemented** rather than ruled: see the qualification below. |

### The qualification on "no budgeting specification"

The claim holds for the **00 Budgeting stage and the actuals feeder**. It does not hold for the
word "budget" generally, and a future reader searching the repository will hit this material
first:

| File | What it actually is |
| --- | --- |
| `supabase/migrations/072_budget_structure.sql` | Two JSONB columns, below |
| `lib/budget-categories.ts` (547 lines) | Shape, presets, parsers and arithmetic for **RFP budget categories** |
| `components/budget-category-editor.tsx` (340 lines) | The agency-side category authoring control |
| `components/bid-budget-categories.tsx`, `components/bid-budget-comparison.tsx` | The vendor-side entry form and the agency-side compare view |
| `docs/p2-reconciliation.md` section 3 | Why 072 was re-authored from tables to JSONB |
| `app/api/interpret/budget/route.ts` | A brief-to-estimate AI call, below |

All of it is one feature: **the lead agency authors budget categories on an RFP, and a vendor
enters their numbers against those categories in their bid.** It is about what a vendor quotes.
It has no upload path, no ingestion, no chart of accounts, no actuals, and no connection to the
agency's own project budget. **It is not the budgeting stage, and it is not a foundation the
actuals feeder can be built on.** It is, however, directly relevant to finding 2: see there.

The absence is also deliberate and recorded. `components/agency-layout.tsx:48` carries the
comment "00 BUDGETING IS NOT HERE, NOT AS AN ITEM, NOT AS A STUB, NOT AS 'COMING SOON'", and
`docs/post-m1-cleanup-report.md` records it twice, at line 420 and as open item OPEN-4 at line
481: "Deliberately absent from the nav. Waits on a workstream that has not started."

### Two further notes on migration 072

1. **The file documents its own re-authoring.** An earlier draft of 072 did create two
   relational tables, `rfp_budget_categories` and `bid_budget_lines`. Its header states that
   draft was never applied and explains why it was replaced: a broadcast writes one
   `partner_rfp_inbox` row per scope item per recipient, so parenting a category on an inbox
   row would copy the wizard's one set of categories once per row and destroy the shared
   category identity the relational model existed to provide. The JSONB shape keeps the keys
   stable across the fan-out. **So "072 creates no budget tables" is true of the file on disk
   today and was not true of an earlier draft of the same number.**
2. **072 is absent from the migration log.** The table in `LIGAMENT_CONTEXT.md` runs 070 then
   073. Its applied status is not recorded there either way.

### On "the organization model now live (079, 083, 085, 086)"

This is reported, not resolved.

- `LIGAMENT_CONTEXT.md:117` states: "This migration log stops at 078 and is incomplete. 079,
  080, 082 and 087 are applied and have no row here." So **079 is recorded as applied**, and
  083, 085 and 086 are not mentioned.
- `docs/m1-foundation-report.md:16` states: "**Migrations 085 and 086 are AUTHORED and NOT
  APPLIED.**"
- Both `085_counterparty_status_boundary.sql` and `086_member_identity_and_invitations.sql`
  open with "STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT" and describe themselves as
  authored, not applied.
- 083's applied status is not stated anywhere the author of this document could find.

The repository's own log declares itself incomplete, so the brief may simply be current where
the repository is stale. **The contradiction is recorded rather than resolved, because only the
live database settles it, and no query was run.** Finding 7 depends on which of these is true,
so it is worth settling before that finding is acted on.

### What `app/api/interpret/budget/route.ts` actually does

Its name will mislead a future reader, so this is stated plainly.

It is a `POST` route. It authenticates, refuses any caller whose `role` and `active_role` are
both not `agency`, and takes one field from the body: `brief_text`. It sends that brief to
Claude with a prompt asking for the cost signals in it (union indicators, talent volume,
location complexity, fabrication, VFX, usage scope, brand category) and returns a **budget
estimate**:

```
{ total_low, total_high, currency, line_items: [{ label, low, high }], justification }
```

**It goes from a creative brief to a guess at what the work should cost.** It does not read a
budget. It does not read a receipt. It accepts no file. It writes nothing to any table. It is
the exact opposite direction of travel from an ingestion path, and it shares nothing with one
but the word "budget".

Two incidental observations, neither acted on in this run:

- The route is itself an instance of the failure mode in finding 6. It calls `generateText`
  with no schema, strips markdown fences with a regex, and calls `JSON.parse` on the result
  inside a `try` that returns a 500 on any throw. A malformed response is a 500, which is at
  least visible, but it is free-form JSON parsing in exactly the shape the test found
  unreliable.
- It passes `anthropic("claude-sonnet-4-6")`, where `CLAUDE.md` documents
  `anthropic("claude-sonnet-4-20250514")` for the AI routes. Noted only; no file was changed.

---

## Finding 1. One source document produces many ledger entries

**Observed.** Single PDF files yielded 2, 11, 18, 25, 44 and 54 separate receipts. (From the
2014-2015 personal expense set; the counts describe the shape of the input, not a success
rate.) Expense reports, scanned batches and statement exports all arrive this way, and a
producer photographing a stack of receipts is normal behaviour, not an edge case.

**What it implies.** An earlier ruling, dated 2026-09-10 and not present in this repository,
treated a source document as producing "ledger entries" in a way that reads as one-to-one. It
is one-to-many, and the correction is not cosmetic.

**What it would change.**

- `source_document` and `ledger_entry` are **separate objects**, with the entry carrying its own
  identity, not a position inside a file.
- **Deduplication operates on entries**, not on files. Two files can carry the same expense
  (finding 4) and one file can carry the same expense twice.
- **The review queue is a queue of entries.** A 54-receipt file with three low-confidence
  entries is three items of work, not one, and a reviewer must be able to act on one entry
  without touching the other 51.
- **Deletion semantics are an open question.** Deleting a source document that has entries
  beneath it could: cascade and delete the entries; orphan them and keep the entries with a
  dangling provenance pointer; or refuse if any entry beneath it is reconciled against a budget
  line. Each is defensible and each has a different failure mode. **This is not picked here.**

---

## Finding 2. The chart of accounts is the accuracy lever, not the model

**Observed.** On an initial 13-category chart, **four of eight documents scored below the
confidence threshold**. Adding two categories, Wardrobe and Telecom and Connectivity, took that
to **zero**. The documents had been read correctly all along. The model had nowhere right to
file them.

The same pattern held on the larger set: a storage unit filed under Venue at **0.55**
confidence, a rental car filed under Equipment Rental at **0.55**, with the model's own stated
reasoning saying in both cases that it was choosing the closest available option. (Small
numbers, same unrepresentative set. They are quoted because the pattern, not the rate, is the
finding: low confidence tracked a missing category, and the model said so.)

**What it implies.** Accuracy on this task is a function of the chart the user composed, not of
the model. A user who composes a sparse chart gets bad output, has no way to see why, and
attributes the failure to the tool.

**What it would change.** The **template library and the composition step are load-bearing for
this feature**, not a convenience to be added later. The quality of the shipped templates
largely determines the quality of the product.

There is a precedent in this repository worth reading before designing that step, though it
serves a different feature. `lib/budget-categories.ts` already ships `PRESET_BUNDLES`: three
named bundles (Standard production, Retainer, Project fee), each a list of categories with an
optional `note` rendered as guidance. Its comments record a specific lesson: categories that
invite a non-money answer get filled in with a non-money answer. "Included hours" and "Overage
rate" were categories of their own until a vendor entered $235 under one of them, and they were
folded into the guidance note on the money category they qualify. A chart of accounts faces the
same hazard from the other direction.

---

## Finding 3. The product should tell the user their chart is incomplete

**Observed.** This falls directly out of finding 2. When the model filed a storage unit under
Venue at 0.55, its stated reasoning named the problem: the right category did not exist.

**What it implies.** This is a **feature, not a caveat**. The signal is already present in the
output, it is detectable without any new inference, and it is specific enough to act on:

> Twelve documents were filed under Venue with low confidence, and most of them look like
> storage. Add a Storage category?

**What it would change.** **The model's stated reasoning must be stored per entry**, not just
the category and the confidence score. A category and a score support only "these were
uncertain". The reasoning is what makes the prompt specific enough to be worth showing, and it
is what lets the suggestion name the missing category rather than merely flagging a cluster.
That is a storage decision taken at ingestion time and it cannot be recovered later without
re-running extraction.

---

## Finding 4. Deduplication is cross-document

**Observed.** The test found the same expense in two different files twice: a standalone WiFi
receipt that also appeared inside an expense report, and a credit card confirmation that
matched its own store receipt. Matching on **vendor plus date plus amount** detects both.

**What it implies.** The duplicate check must run across **all source documents for a project**,
not within one file. A per-file check would have caught neither of these.

**The false positive risk is real and was observed.** Two genuine same-day purchases from one
vendor at the same amount exist: the test found a restaurant check and its bar tab as two
separate and correct entries. Vendor plus date plus amount does not distinguish that from a
true duplicate.

**What it would change.** **A suspected duplicate is flagged for confirmation. It is never
auto-merged.** Auto-merging silently removes a real expense from a budget, which is the same
class of harm as finding 6: the total looks right and is not.

---

## Finding 5. Refunds and credits need a sign convention

**Observed.** The test surfaced a refund from a food vendor.

**What it implies.** Nothing in the current thinking handles a negative amount. A refund posted
as a positive actual **inflates spend against its budget line**, and does so invisibly, because
a larger actual is not obviously wrong.

**What it would change.**

- Ledger entries carry a **signed amount**.
- A credit **reduces** the actual on its line.
- **Extraction must identify a refund as a refund**, which is an extraction requirement and a
  chart-of-accounts requirement, not a display concern.

**Open:** a partial refund against an entry that has already been reconciled against a budget
line is harder, and is not resolved here. It touches whatever reconciliation model gets built.

---

## Finding 6. Extraction must be schema-enforced and lossless

**This is the most important operational finding in the test.**

**Observed.** Roughly **35 of about 160 pages** returned malformed output from a free-form JSON
request, and that was **after** the prompt had been tightened to constrain the free-text field.
Before a salvage path existed, those pages **failed silently**: the file reported success and
its receipts simply did not appear.

Across runs on **identical input**, the entry count was **186, 224, 237 and 280**. The variation
was **undetected loss**, not genuine difference in what the documents contained. (These counts
were produced by a throwaway script, not by a product implementation, so the specific rate of
loss is not transferable. That the loss was silent and that it varied run to run on the same
input are the transferable facts.)

**What it implies.** The naive implementation of this feature produces a budget that is missing
expenses and reports itself as complete. **Silent partial ingestion is the worst available
outcome here**, worse than an outright failure, because a visibly broken upload gets retried
and a quietly incomplete budget gets trusted, presented to a client, and used to make decisions.

**What it would change. Four requirements.**

1. **Extraction output must be schema-constrained**, so that malformed output is impossible by
   construction rather than recovered after the fact. A salvage path that parses broken output
   is a mitigation, not a fix, and it was itself the difference between 186 and 280.
2. **A page or a document that fails must be visible to the user as a failure.** Not a log line.
   Not a console warning. A state on the document.
3. **Re-ingesting the same document must converge, not duplicate.** The natural response to a
   suspected bad ingest is to upload the file again, and that must be safe.
4. **Ingestion must report how many entries it found.** A producer who uploads a 40-receipt
   expense report needs to see that 40 arrived. This is the only one of the four that the user
   can act on without being told anything is wrong.

### This repository has already shipped this exact failure once

Read `docs/079-onboarding-docs-regression.md`. It is the same shape, and it is worth reading in
full before designing ingestion.

On 2026-08-18 a lead agency sent an onboarding package to a vendor. The package row was created.
The vendor received an email with the subject "Your onboarding documents are ready". The route
returned `success: true` and the user saw the success modal. **Zero document rows were written.**

The diagnosis established that the document insert at
`app/api/projects/[id]/onboarding-packages/route.ts:338` was never attempted, because
`docs.length === 0` at line 328, because the request body's `documents` array arrived empty. The
client had built that array through three `continue` statements
(`components/stage-03-onboarding-workflow.tsx:428`, `:430`, `:441`), each of which **discards an
attachment without telling the user or the server**, and all three of which are indistinguishable
in their result. The report's own summary of the class: a send that reported success while
writing nothing.

Two details transfer directly to ingestion:

- The insert site itself was **well behaved**. It rolled the package row back and returned a 500
  on error. The report notes that this correctness is the only reason the diagnosis could reach
  a conclusion at all. **The failure was upstream, in code that dropped work quietly on the way
  to a correct writer.** An ingestion pipeline with a correct database layer has exactly this
  exposure.
- The proposed remedy is the same as requirement 4 above: refuse when the request carried
  documents and none survived, and tell the user which attachments were dropped and why, rather
  than proceeding with a silently emptied list.

The actuals feeder is a longer pipeline with more places to drop work than that route had.

---

## Finding 7. Who can read a source document. The questions, not the answers

**Observed.** A receipts ledger is more sensitive than budget data in a specific way. A receipt
**image** carries card last-four digits, personal addresses, individual spend patterns, and
sometimes an employee name. That is true of every receipt in a ledger, and it is true of the
image whether or not the extracted fields are filtered.

**What it implies.** Existing thinking covers the vendor boundary for **budget** data: a vendor
sees what a lead agency released to them for an RFP and never the master budget. As noted in the
verification statement, that boundary is not written down as a ruling in this repository, but it
is implemented in the 072 storage split: the agency authors `budget_categories` on the RFP row,
and a vendor writes only `budget_lines` on their own response row. **Nothing covers the receipts
ledger at all.**

**Four questions, stated as questions and deliberately not answered here.**

1. **Can a vendor ever see a source document, including one they issued themselves?** A vendor
   invoice is a document the vendor wrote. That is not the same as a document the vendor may
   read back out of the lead agency's ledger, alongside whatever else was filed with it.
2. **Under the organization model, can every colleague in a lead agency read every receipt, or
   is the scope narrower?** Note that whether that model is fully live is itself unsettled in
   this repository; see the verification statement.
3. **Does an ended partnership revoke access to documents from that engagement?**
4. **What is retained, and for how long, after a project closes?** Receipt images are the most
   sensitive artifact the platform would hold and the one with the least reason to be held
   forever.

### What migration 085 already settled, and what it did not

Question 3 has a principle to reason from, though not an answer. `085_counterparty_status_boundary.sql`
split counterparty visibility into two tiers:

- **The name tier**, `current_user_counterparty_org_ids()`, admits **every** partnership status
  and gates `public.organizations`. It is the only source of a counterparty's company name
  anywhere in the product, so narrowing it would blank vendor names out of a lead agency's own
  pool.
- **The commercial tier**, `current_user_commercial_counterparty_org_ids()`, **excludes**
  `terminated` and `removed`, and gates `public.profiles`, which carries `default_terms`,
  `business_criteria` and `default_nda_url`. It admits `pending` (an invitation in flight),
  `active`, and `suspended` (a pause is reversible and is not an ending).

The principle, close to verbatim from the function comment: **a company name survives the end of
a relationship; its commercial terms do not.** Ending a relationship used to revoke nothing,
which meant a vendor who merely declined an invitation had already handed over their insurance
limits by declining it.

Two things that file states about its own limits bear directly on a receipts ledger:

- **RLS is row level.** 085 changed **which rows** a counterparty may read, not which columns.
  A permitted reader still reads the whole `profiles` row. The file names column-level control
  as a larger design that it deliberately did not attempt. A receipt image is not
  column-filterable at all, so a ledger cannot inherit a row-level answer and call it done.
- **A residual is open and stated.** The live INSERT policy on `partnerships` constrains
  `lead_org_id` and says nothing about `vendor_org_id`, so a lead agency can insert a pending
  partnership naming any organization id it can obtain and thereby read that company's whole
  profile row without the other side being asked. 085 does not close it and names it as Greg's
  call.

### These four questions are BLOCKING

**A ledger built without an access model has to be rebuilt to get one.** Access scope determines
where the document rows live, what they are keyed on, whether the image and the extracted entry
are separable, and what a retention policy can even operate on. Retrofitting that onto a shipped
ledger is not a policy change, it is a migration of the most sensitive data in the product.
079 is this repository's own record of what a late structural rename costs: 707 column
references across 103 source files, with no partial failure mode and no grace period.

---

## Open questions

Everything above that needs a ruling, plus three that predate the test.

**From the test**

1. **Deletion semantics for a source document with entries beneath it.** Cascade, orphan, or
   refuse if any entry is reconciled. (Finding 1)
2. **Partial refunds against an already-reconciled entry.** (Finding 5)
3. **Can a vendor ever see a source document, including one they issued?** BLOCKING.
   (Finding 7)
4. **Can every colleague in a lead agency read every receipt, or is the scope narrower?**
   BLOCKING. (Finding 7)
5. **Does an ended partnership revoke access to documents from that engagement?** BLOCKING.
   (Finding 7)
6. **What is retained, and for how long, after a project closes?** BLOCKING. (Finding 7)

**Predating the test**

7. **The chart of accounts composition step.** Template variety, plus a step where the user
   check-marks the components they want. Finding 2 raises this from a convenience to a
   load-bearing part of the feature, which changes how much it is worth investing in.
8. **Whether the existing personal tool called Back of House is housed inside Ligament, or the
   budgeting stage is built fresh.**
9. **An intellectual property carve-out question on that tool's origin.** Unresolved, and it
   gates question 8 rather than following from it.

**A note rather than an open item**

10. **Which migrations are applied to production. Settled for the ones this document names,
    and left open past them.**

    **079, 080, 082, 083, 085 and 086 are all confirmed applied in production as of
    2026-09-11.** Verified by catalog query in the Supabase SQL editor, run as `postgres`, not
    by any document:

    | Probe | Result | Conclusion |
    | --- | --- | --- |
    | `milestone_events` table | exists | 080 applied |
    | `partner_vouches` policies | 3 | consistent with 082 applied |
    | `current_user_commercial_counterparty_org_ids` | exists | **085 applied** |
    | `profiles.title` column | exists | **086 applied** |
    | `project_documents` INSERT policy | 1 | **083 applied** |
    | total policies in `public` | 122 | see below |

    **This supersedes the contradiction recorded in the verification statement above, and the
    caveat in finding 7 about whether the organization model is fully live.** Both are now
    answered: it is live. `docs/m1-foundation-report.md:16`, which describes 085 and 086 as
    "AUTHORED and NOT APPLIED", was **correct when it was written and is now stale**. It is not
    wrong about its own moment, and it should not be read as current.

    **Why this stays a note.** The policy total is **122**. The reported baseline is 110 after
    086 on 2026-08-19, which would make 122 a gap of twelve and mean at least one further
    migration has been applied that the documents visible from this branch do not reflect.

    That baseline could not be located in the repository, and what the repository does record
    points the same direction by a different route. The counts written down here are **107**
    after 079 (`docs/079-authoring-report.md:242`), **104** recorded by 081 and **113** on
    2026-08-20 (`docs/unattended-session-2026-08-20.md:469`, which calls the delta of 9 between
    them "a delta that something must" account for), and **117** after 094
    (`docs/095-notification-types-ruling.md:98`). The nearest 110 is
    `docs/080-repair-report.md:37`, which counts "110 policy predicates 079 actually shipped"
    and is a different measure, not a total.

    122 is also the exact figure `docs/098-preapply-test.sql:1246` asserts as its own pass
    condition: "T14 policy count = 122 as predicted". So on the repository's own numbers the
    live total is consistent with migrations having been applied **through 098**, which is well
    past anything this document reasons about.

    Either reading reaches the same place. **Migrations beyond the six confirmed above have been
    applied, and the document set visible from this branch does not establish which of them are
    live or what they changed.** That is the part still owed, and it is why this is a note and
    not a resolved item. Questions 4 and 5 are reasoned against the organization model, so a
    specification session should re-derive the live policy set from the catalog rather than from
    any file here, including this one.

---

## What would make the next test worth running

The honest answer is short.

**A representative sample of production spend, with ground-truth categories written down before
anyone sees the model output.**

Both halves matter.

**Representative** means the shape of what a production actually spends on: vendor invoices,
talent payments, fabrication quotes, location fees, insurance certificates, equipment rental
agreements. The current set is 73% restaurant checks and cab receipts from 2014 and 2015, and
four of the categories that a production budget leans on saw one document each. A result
measured on that set cannot be projected onto the categories it did not test, and the categories
it did not test are the expensive ones.

**Ground truth written first** means somebody files each document by hand, records the answer,
and only then runs the extraction. Anything else grades the model against its own output. The
0.55 confidence scores in finding 2 illustrate the trap: they look like the model was uncertain,
and the actual cause was a missing category. Reading the output first and then deciding what the
right answer was would have recorded that as a model failure and hidden the real lever.

**Why the current result cannot substitute.** This test established which failure modes exist,
which is genuinely valuable and is why the seven findings above are worth acting on. It
established nothing about how often any of them occurs on real spend, and it cannot, because the
input was not that spend. Treating any figure from it as a baseline would mean comparing a future
measurement against a number that was never a measurement of the same thing.

**The order that follows from this.** The failure modes in findings 1, 4, 5 and 6 are structural.
They are true regardless of what the accuracy rate turns out to be, and they should be designed
for before any further measurement. The accuracy question is the one that needs the better
sample, and it is also the one that finding 2 suggests is mostly a question about the chart of
accounts rather than about extraction. **A second accuracy test run on another convenience
sample would produce another number that cannot be used.**
