# Ligament 00 Budgeting: the specification

**Status:** specification. Nothing in it is built.
**Created:** 2026-09-14, branch `feat/budgeting-spec`.
**Supersedes:** a version drafted in conversation on 2026-08-28 that was never written to a
file. Several sessions have referred to a budgeting specification; until this file there was
nothing to read.

**This file records rulings Greg has already made and describes the repository as it is. It
does not make product decisions.** Where a ruling determines a table or a column, the ruling is
named. Where it does not, the open question is written instead. The single list at the foot is
the whole of what is owed.

---

## 0. Verification statement: what was EXECUTED versus what was READ

The house rule, applied to this file.

**EXECUTED in this session:**

| Check | Result |
| --- | --- |
| `ls docs/`, `grep -rln "ligament-00-budgeting\|budgeting-spec"` over `docs/` and root `*.md` | No budgeting specification exists. Only `docs/budget-actuals-findings.md`, which is a findings document and says so in its own header. |
| `cat supabase/migrations/072_budget_structure.sql` | Read in full. Two `ALTER TABLE` statements. No `CREATE TABLE`. |
| `cat app/api/interpret/budget/route.ts` | Read in full. |
| `sed -n '1,125p' lib/budget-categories.ts` | Read the shape, the presets and the R3 lesson. |
| `cat docs/budget-actuals-findings.md` | Read in full, 530 lines. |

**READ and taken on the word of another document, not independently re-verified here:**

- Everything about the receipt extraction test. It ran outside this repository in
  `~/dev/receipt-test` and no file of it is available. `docs/budget-actuals-findings.md` records
  it as reported and this file inherits that qualification rather than laundering it.
- The applied status of every migration. **No SQL was run in this session. There are no working
  database credentials.** `docs/budget-actuals-findings.md` open question 10 records a catalog
  query run by Greg on 2026-09-14 confirming 079, 080, 082, 083, 085 and 086 applied, and its own
  caution that this is a subset of a longer applied history rather than the end of it. That
  caution stands.

**NOT ESTABLISHED, and named here rather than glossed:**

- Whether migration 072 is applied. It is **absent from the migration log** in
  `LIGAMENT_CONTEXT.md`, whose table runs 070 then 073. Nothing in the repository records its
  status either way. The RFP bid budget feature described in section 2 reads and writes the two
  columns 072 adds, and that feature is shipped, which is suggestive and is not proof. **The
  query that settles it is in the open questions list.**

---

## 1. Three facts a future reader will otherwise get wrong

Stated first because each one is a trap that has already caught somebody.

### 1a. Migration 072 creates no budget tables

`072_budget_structure.sql` is two statements:

```sql
ALTER TABLE rfp_magic_tokens      ADD COLUMN IF NOT EXISTS budget_categories jsonb NULL;
ALTER TABLE partner_rfp_responses ADD COLUMN IF NOT EXISTS budget_lines      jsonb NULL;
```

**An earlier draft of the same migration number did create two relational tables**,
`rfp_budget_categories` and `bid_budget_lines`. The file's own header records that the draft was
never applied, that this was verified live, and why it was replaced:

> `app/api/agency/broadcast-rfp/route.ts` writes ONE `partner_rfp_inbox` row per (scope item x
> recipient). A broadcast to 6 vendors across 3 scope items is 18 rows. Parenting a budget
> category on a single `inbox_item_id` therefore forces the wizard's one set of categories to be
> copied 18 times, each copy with its own UUIDs.

So "072 creates no budget tables" is true of the file on disk and was **not** true of an earlier
draft carrying the same number. A reader who finds a reference to `rfp_budget_categories`
anywhere is reading about something that never existed in the database.

### 1b. `app/api/interpret/budget/route.ts` does the OPPOSITE thing to ingestion

Its name will mislead every future reader, so it is described plainly.

It is a `POST` route. It authenticates, refuses any caller whose `role` and `active_role` are
both not `agency`, and takes one field: `brief_text`. It sends that brief to Claude asking for
the cost signals in it (union indicators, talent volume, location complexity, fabrication, VFX,
usage scope, brand category) and returns:

```
{ total_low, total_high, currency, line_items: [{ label, low, high }], justification }
```

**It goes from a creative brief to a guess at what the work should cost.** It does not read a
budget. It does not read a receipt. It accepts no file. It writes nothing to any table. It is
the exact opposite direction of travel from an ingestion path and shares nothing with one but
the word "budget".

Two incidental observations, neither acted on:

- It is itself an instance of finding 6 in section 5. It calls `generateText` with no schema,
  strips markdown fences with a regex, and calls `JSON.parse` inside a `try` that returns 500 on
  any throw. A malformed response is at least visible, but it is free-form JSON parsing in
  exactly the shape the extraction test found unreliable.
- It passes `anthropic("claude-sonnet-4-6")` where `CLAUDE.md` documents
  `anthropic("claude-sonnet-4-20250514")` for the AI routes. Noted only. No file was changed.

### 1c. The existing budget feature is NOT this spine

There is a real, shipped, working budget feature in this repository. **It is a different
feature.** A reader searching for "budget" hits it first and will conflate the two.

| File | What it is |
| --- | --- |
| `supabase/migrations/072_budget_structure.sql` | The two JSONB columns above |
| `lib/budget-categories.ts` (547 lines) | Shape, presets, parsers and arithmetic for RFP bid budget categories |
| `components/budget-category-editor.tsx` | The agency-side category authoring control |
| `components/bid-budget-categories.tsx` | The vendor-side entry form |
| `components/bid-budget-comparison.tsx` | The agency-side compare view |
| `docs/p2-reconciliation.md` section 3 | Why 072 was re-authored from tables to JSONB |

All of it is one feature: **the lead agency authors budget categories on an RFP, and a vendor
enters their numbers against those categories in their bid.** It is about **what a vendor
quotes**. It has no upload path, no ingestion, no chart of accounts, no actuals, and no
connection to the agency's own project budget.

> **IT IS NOT THE BUDGETING STAGE AND IT IS NOT A FOUNDATION THE SPINE CAN BE BUILT ON.**

It is, however, directly relevant to the chart of accounts in section 4, and section 4 says how.

The absence of the budgeting stage is deliberate and recorded:
`components/agency-layout.tsx:48` carries the comment "00 BUDGETING IS NOT HERE, NOT AS AN ITEM,
NOT AS A STUB, NOT AS 'COMING SOON'", and `docs/post-m1-cleanup-report.md` records it twice, at
line 420 and as open item OPEN-4 at line 481.

---

## 2. The rulings, as settled

Each of these is Greg's and each is already made. They are recorded with their reasoning so that
the reasoning is available to whoever builds against them. **None of them is reopened here.**

### 2a. ARCHITECTURE (2026-08-19). Ligament ingests the budget and then OWNS it

Not a read-only mirror of an external spreadsheet. The ingested budget becomes **the working
artifact inside the product**.

**Why the distinction is load-bearing rather than philosophical.** A mirror has to answer "what
happens when the source changes" on every edit, forever, and the honest answers are all bad: a
re-import that overwrites in-product work, a merge UI nobody wants to operate, or a divergence
the user discovers late. Ownership answers it once: the spreadsheet is an import format, the
import happens, and after that the budget lives here. Everything downstream in this
specification depends on it. Four states per line (section 3) cannot be maintained against a
document somebody else is editing; version comparison (section 2b) needs a baseline the product
controls; the vendor boundary (section 5) needs the product to decide what is released.

### 2b. SCOPE (2026-08-28). Three parts, and one of them is Never

**THE SCHEDULE HALF IS OUT OF SCOPE.** Gantt, run of show, master calendar, on-site mode: all
**Never**, not "later". They are a different product and naming them as deferred would leave
them in every future scoping conversation.

**THE FEE-VERSUS-COST CATEGORY FLAG IS THE LOAD-BEARING PIECE.** Every category carries a flag
marking it as a fee or a cost. **Margin is only computable because of it.** Without the flag a
budget is a list of numbers that sum; with it the same list answers what the agency actually
makes, which is the question a producer's working spreadsheet exists to answer and the one a
generic budgeting tool does not.

**VERSION COMPARISON PLUS A MOVEMENT REPORT AGAINST AN APPROVED BASELINE IS THE STRONGEST
DIFFERENTIATOR.** Not "the budget changed" but "here is what moved, by how much, against the
version the client approved". A producer defending a number to a client is defending a delta,
not a total.

**What these three imply, and what they do not.** The fee-versus-cost flag is a ruling about a
category, so **a category carries a fee-or-cost flag**: that is implied and it is named as
implied. Version comparison implies that a budget has **versions** and that one of them can be
marked **approved**. It does not say whether a version is a snapshot, a diff, or an event log,
and this file does not pick. That is open question 3.

### 2c. FOUR STATES PER BUDGET LINE (2026-09-10)

Every budget line carries four states, not one number:

| State | What it is |
| --- | --- |
| **Estimate** | What the line was budgeted at |
| **Committed** | Awarded bids and purchase orders. Money promised but not yet spent |
| **Actual** | The receipts and invoices ledger. Money spent |
| **Paid** | Cash flow. Money actually out the door |

**CASH FLOW IS RECAST AS THE PAID STATE, not demoted to something additive.** This is the part
of the ruling most likely to be lost in a summary. Cash flow is not a separate feature bolted
beside the budget; it is the fourth column of the same row. A producer asking "have we paid
them" and a producer asking "what did this cost" are reading two states of one line.

**RECEIPTS AND INVOICES ARE ONE OBJECT TYPE IN THE LEDGER, WITH NO USER-FACING DISTINCTION.**
They differ in origin and not in what they do to a budget line, and a product that splits them
makes the user maintain a distinction that earns nothing.

**What this implies.** A budget line carries four monetary states. Whether those are four
columns on one row, or one column plus a ledger the other three are derived from, is **not
determined by the ruling** and is open question 2. The ruling does determine that Committed has
a source (awarded bids and purchase orders) and Actual has a source (the ledger), so neither is
free text.

### 2d. BUDGET LINE VERSUS RFP LINE (2026-09-10)

Per RFP, the user chooses one of two things:

1. **ACCEPT** the external budget line from the master budget as the RFP line, or
2. **DICTATE** a disparate line item for that RFP.

**Why both are needed.** Accepting is the common case and is what makes the master budget worth
having: the allowance a vendor bids against is the number the producer already budgeted.
Dictating exists because the two are not always the same number and the producer is entitled to
say so. A tool that only accepts forces the producer to edit the master budget to change what a
vendor sees, which corrupts the master budget to serve a message.

**This ruling is the hinge the vendor boundary hangs on**, and section 2e is the other half of
it.

### 2e. VENDOR TRUST BOUNDARY (2026-09-10)

> **A vendor sees ONLY what the lead agency accepted from external line items indicated for that
> RFP, or manual input. NO view into the master budget, ever.**

"Ever" is the word to preserve. This is not a default, not a permission, and not a setting.

**There is a precedent already implemented in this repository, though not written down as a
ruling until this file.** The 072 storage split is that boundary in miniature: the agency
authors `budget_categories` on the RFP row, and a vendor writes only `budget_lines` on their own
response row. The vendor never touches the agency's side of it. The spine's boundary is the same
shape at a larger scale.

**What it implies.** The RFP-facing line is a **released artifact distinct from the master budget
line**, whether it was accepted from one or dictated. It cannot be a pointer into the master
budget that the vendor is trusted not to follow, because RLS in this product is row level and a
permitted reader reads the whole row. `085_counterparty_status_boundary.sql` states this about
itself explicitly: it changed which **rows** a counterparty may read, not which **columns**, and
names column-level control as a larger design it deliberately did not attempt.

### 2f. CHART OF ACCOUNTS (2026-09-14)

**THE TEMPLATE BELONGS TO THE AGENCY** and is the house standard every project starts from.

**THE CHART ON A PROJECT IS A COPY, NOT A POINTER.** It starts as the template and then belongs
to that project.

> **COPY-ON-CREATE IS LOAD-BEARING.** If the project pointed at the template, editing the
> template would retroactively change categories on every past project, including closed ones
> with actuals filed against them. **A budget that changes shape after the fact is not a
> budget.**

The rest of the ruling:

- A category added on a project can be **PROMOTED BACK** to the agency template.
- Categories can be **ADDED freely at any time**, including mid-project.
- **MERGE IS ALLOWED BUT MUST CAPTURE HISTORY.** A ledger entry has to remember which category
  it was **originally filed under**, or a producer who merges two buckets cannot explain to
  finance why last month's export and this month's disagree.
- **RENAMING IS A MERGE INTO A NEW NAME** and carries the same record.
- **Nothing with money against it is silently deleted.**

**What this implies.** Two chart objects, one owned by an agency and one owned by a project, with
copy-on-create between them: that is determined by the ruling and is named as determined. A
ledger entry carrying its **original** category as well as its current one: also determined,
because "must capture history" has no other implementation. What is **not** determined is whether
the history lives on the entry, in a separate merge record, or both, and that is open question 5.

**The existing feature is relevant here and section 1c's warning still holds.**
`lib/budget-categories.ts` is not the spine, but it already shipped a lesson this chart will meet
from the other direction. Its R3 note records that "Included hours" and "Overage rate" were
categories of their own until a vendor entered $235 under one of them; they are **terms, not cost
buckets**, and were folded into the guidance note on the money category they qualify. A category
that invites a non-money answer gets a non-money answer. The chart of accounts faces the same
hazard, and the shipped `PRESET_BUNDLES` are worth reading before composing templates.

### 2g. BACK OF HOUSE (2026-09-14). Build fresh

The budgeting stage is **built fresh against this specification**.

An existing personal tool of Greg's covers similar ground. It is **the REFERENCE for what good
looks like, NOT a codebase to import.** The reasoning is concrete rather than aesthetic: it is
separately hosted, with **no organizations model, no row-level security and no vendor trust
boundary**. Importing it would mean rewriting it anyway, and rewriting it while pretending to
import it is the worse of the two jobs.

**Note that this ruling settles open question 8 in `docs/budget-actuals-findings.md`.** That
document lists "whether the existing personal tool called Back of House is housed inside
Ligament, or the budgeting stage is built fresh" as open; as of 2026-09-14 it is answered.
**Its question 9 is NOT settled by this** and is carried forward in section 7: an intellectual
property carve-out question on that tool's origin, which gated question 8 rather than following
from it.

### 2h. POSITIONING

**Ligament replaces the producer's working budget spreadsheet and exports what finance needs. It
is NOT the accounting ledger of record.**

This bounds the whole workstream. It is why the spec has no double-entry, no period close, no
audit trail in the accounting sense, and no chart of accounts mapped to a general ledger. It is
also why **export is a first-class requirement and not a nice-to-have**: the thing it is not
replacing still needs feeding.

---

## 3. What the rulings determine about the data model, and where they stop

Per the brief's own constraint: no data model is invented beyond what the rulings determine.

**DETERMINED, with the ruling that determines it:**

| Object or field | Determined by |
| --- | --- |
| A chart of accounts owned by an **agency** (the template) | 2f |
| A chart of accounts owned by a **project**, created as a **copy** | 2f, and copy-on-create is the explicit reasoning |
| A category carries a **fee-or-cost flag** | 2b. Margin is not computable without it |
| A ledger entry carries the category it was **originally filed under** | 2f, "must capture history" |
| A budget line carries **four** monetary states | 2c |
| Committed is sourced from **awarded bids and purchase orders** | 2c |
| Actual is sourced from **the ledger** | 2c |
| An **RFP-facing line** distinct from the master budget line | 2d and 2e together |
| A budget has **versions**, one of which can be **approved** | 2b |
| `source_document` and `ledger_entry` are **separate objects** | `docs/budget-actuals-findings.md` finding 1 |
| A ledger entry carries a **signed** amount | finding 5 |
| A ledger entry stores the model's **stated reasoning**, not just category and confidence | finding 3 |

**NOT DETERMINED. These are open questions, not gaps to be filled in by whoever builds first:**

- Whether the four states are four columns or one column plus derivations (question 2).
- Whether a version is a snapshot, a diff, or an event log (question 3).
- Where merge history lives (question 5).
- Every access-model question in section 6. Those are **blocking**.

---

## 4. The RFP hand-off, end to end

The one flow where the spine meets what is already built.

1. The project has a budget, with lines, on a chart copied from the agency template (2f).
2. For a given RFP, the producer either **accepts** a master budget line as the RFP line or
   **dictates** a disparate one (2d).
3. What the vendor sees is that released line and nothing else (2e). Never the master budget,
   never the other lines, never the fee-versus-cost flag, never any state but the allowance.
4. The vendor bids. **This is where the existing feature in section 1c already lives**, and the
   spine hands off to it rather than replacing it.
5. An awarded bid becomes the **Committed** state on the originating budget line (2c).

**Step 5 is the join that does not exist today and is the most consequential unbuilt link in the
flow.** Nothing in the repository connects a `partner_rfp_responses` row to a budget line,
because there are no budget lines. Whether the join is a column on the response, a column on the
budget line, or a separate reconciliation object is **not determined by any ruling** and is open
question 4.

---

## 5. Actuals ingestion

The conclusions of `docs/budget-actuals-findings.md`, folded in where they bear rather than
restated as a chapter. **Read that document before building any of this**; it carries the
evidence and the qualification that the sample was not representative of production spend.

### 5a. One source document produces many ledger entries

The single most important structural finding. Single PDFs yielded 2, 11, 18, 25, 44 and 54
separate receipts. A producer photographing a stack of receipts is normal behaviour.

**Therefore `source_document` and `ledger_entry` are separate objects**, and **dedupe, the review
queue and deletion semantics all operate on ENTRIES**:

- The entry carries its own identity, not a position inside a file.
- **Dedupe operates on entries** and runs **across all source documents for a project**, not
  within one file. The test found the same expense in two different files twice. Matching on
  vendor plus date plus amount detects both, and **a suspected duplicate is flagged for
  confirmation, never auto-merged**: two genuine same-day purchases from one vendor at the same
  amount exist, and the test found a restaurant check and its bar tab as exactly that.
- **The review queue is a queue of entries.** A 54-receipt file with three low-confidence entries
  is three items of work, and a reviewer must be able to act on one without touching the other
  51.
- **Deletion semantics are open** (question 1). Cascade, orphan, or refuse if any entry beneath
  is reconciled: each is defensible with a different failure mode, and this file does not pick.

### 5b. The chart of accounts is the accuracy lever, not the model

On a 13-category chart, four of eight documents scored below the confidence threshold. Adding two
categories took that to zero. **The documents had been read correctly all along; the model had
nowhere right to file them.**

This is why section 2f's chart is load-bearing for the whole feature and why the template library
and the composition step are not a convenience to be added later. **The quality of the shipped
templates largely determines the quality of the product.**

### 5c. The product tells the user their chart is incomplete

A feature, not a caveat. The signal is already in the output and needs no new inference:

> Twelve documents were filed under Venue with low confidence, and most of them look like
> storage. Add a Storage category?

**This is why the model's stated reasoning is stored per entry.** A category and a score support
only "these were uncertain". The reasoning is what lets the suggestion name the missing category.
**It is a storage decision taken at ingestion time and cannot be recovered later without
re-running extraction.**

### 5d. Signed amounts

Ledger entries carry a **signed** amount and a credit **reduces** the actual on its line.
**Extraction must identify a refund as a refund.** A refund posted as a positive actual inflates
spend invisibly, because a larger actual is not obviously wrong. Partial refunds against an
already-reconciled entry are open (question 6).

### 5e. Silent partial ingestion is the worst available outcome

Roughly 35 of about 160 pages returned malformed output from a free-form JSON request. Across
runs on **identical input** the entry count was 186, 224, 237 and 280. **The variation was
undetected loss.**

Four requirements:

1. **Extraction output is schema-constrained**, so malformed output is impossible by construction
   rather than recovered after the fact. A salvage path is a mitigation and was itself the
   difference between 186 and 280.
2. **A page or document that fails is visible to the user as a failure.** A state on the
   document. Not a log line.
3. **Re-ingesting the same document converges, not duplicates.** The natural response to a
   suspected bad ingest is to upload it again, and that must be safe.
4. **Ingestion reports how many entries it found.** The only one of the four a user can act on
   without being told anything is wrong.

> **This repository has already shipped this exact failure once.** Read
> `docs/079-onboarding-docs-regression.md` before designing ingestion. A lead agency sent an
> onboarding package, the vendor got an email saying their documents were ready, the route
> returned `success: true`, and **zero document rows were written**. The insert site was well
> behaved; the failure was upstream, in client code that dropped attachments through three
> `continue` statements without telling the user or the server. **An ingestion pipeline with a
> correct database layer has exactly this exposure, and it is a longer pipeline with more places
> to drop work.**

---

## 6. The access model is BLOCKING and is not answered here

`docs/budget-actuals-findings.md` finding 7 raises four questions. **This specification does not
answer them, by instruction and because they are not answerable without a ruling.**

1. **Can a vendor ever see a source document, including one they issued themselves?** A vendor
   invoice is a document the vendor wrote. That is not the same as a document the vendor may read
   back out of the lead agency's ledger, alongside whatever else was filed with it.
2. **Under the organization model, can every colleague in a lead agency read every receipt, or is
   the scope narrower?**
3. **Does an ended partnership revoke access to documents from that engagement?**
4. **What is retained, and for how long, after a project closes?** Receipt images are the most
   sensitive artifact the platform would hold and the one with the least reason to be held
   forever.

**WHY THEY BLOCK.** A ledger built without an access model has to be rebuilt to get one. Access
scope determines where the document rows live, what they are keyed on, whether the image and the
extracted entry are separable, and what a retention policy can even operate on. Retrofitting that
onto a shipped ledger is not a policy change, it is a migration of the most sensitive data in the
product. **079 is this repository's own record of what a late structural rename costs: 707 column
references across 103 source files, with no partial failure mode and no grace period.**

**A receipts ledger is more sensitive than budget data in a specific way.** A receipt image
carries card last-four digits, personal addresses, individual spend patterns and sometimes an
employee name, and that is true of the image whether or not the extracted fields are filtered.

**What 085 gives question 3 to reason from, without answering it.**
`085_counterparty_status_boundary.sql` split counterparty visibility into two tiers: a **name
tier** admitting every partnership status, and a **commercial tier** excluding `terminated` and
`removed`. The principle, close to verbatim from the function comment: **a company name survives
the end of a relationship; its commercial terms do not.**

Two limits that file states about itself bear directly here:

- **RLS is row level.** 085 changed which rows a counterparty may read, not which columns. A
  receipt image is not column-filterable at all, so a ledger cannot inherit a row-level answer
  and call it done.
- **A residual is open.** The live INSERT policy on `partnerships` constrains `lead_org_id` and
  says nothing about `vendor_org_id`, so a lead agency can insert a pending partnership naming
  any organization id it can obtain. 085 names it as Greg's call and does not close it.

**Related and larger, recorded because it bears on question 3.** No agency-side control anywhere
in this product ends a relationship with an active vendor, and no policy anywhere filters on
`partnerships.status`. So question 3 is currently unanswerable in a second sense: even a ruling
that ending revokes document access would have nothing to hang on.

---

## 7. Open questions

Each with its options and what each option costs. **None is answered.** Shape follows
`docs/emitter-rulings-owed.md`.

### 1. Deletion semantics for a source document with entries beneath it

*Carried from `docs/budget-actuals-findings.md` question 1.*

- **Cascade.** Deleting the file deletes its entries. Simple and predictable. **Cost:** deletes
  reconciled actuals, so a budget line silently drops money that was really spent.
- **Orphan.** Entries survive with a dangling provenance pointer. **Cost:** an actual nobody can
  trace to a document, which is the thing a finance export is asked to prove.
- **Refuse if any entry beneath is reconciled.** **Cost:** the user cannot delete a file they
  uploaded by mistake once one entry has been matched, and needs an unreconcile path first.

### 2. Are the four states four columns, or one column plus derivations?

*Implied by ruling 2c, not settled by it.*

- **Four stored columns on the line.** Reads are trivial. **Cost:** four numbers that can
  disagree with the ledger beneath them, and the disagreement is invisible.
- **Estimate stored, the other three derived** from committed bids, ledger entries and payment
  records. Cannot drift. **Cost:** every budget read becomes an aggregate, and "what was the
  actual on this line in March" needs point-in-time reconstruction.
- **Hybrid: derived, with a materialized cache.** **Cost:** invalidation, and a cache that is
  wrong in exactly the situations anyone would check it.

### 3. What is a budget version?

*Implied by ruling 2b, not settled by it.*

- **Full snapshot per version.** Comparison is a straight diff of two complete objects.
  **Cost:** storage grows with every save, and "every save" is what a working spreadsheet does.
- **Diff chain from a base.** Compact. **Cost:** reading any version means replaying, and a
  corrupt link loses everything after it.
- **Event log, versions as named points in it.** Richest movement report, because the log carries
  who and when per change. **Cost:** the most build, and the movement report has to summarize a
  log rather than subtract two numbers.

### 4. What joins an awarded bid to a budget line?

*Section 4 step 5. Not determined by any ruling.*

- **A column on `partner_rfp_responses`.** Cheapest. **Cost:** a vendor-writable table carrying
  a pointer into the agency's master budget, which is section 2e's boundary in the one direction
  it must not run.
- **A column on the budget line.** Keeps the pointer agency-side. **Cost:** one line holds one
  award, so a line split across two vendors needs a second mechanism.
- **A separate reconciliation object.** Many-to-many, and the natural home for partial awards.
  **Cost:** a whole object and its policies for a link that is one-to-one most of the time.

### 5. Where does merge history live?

*Implied by ruling 2f, not settled by it.*

- **On the entry**, as an original-category field. Survives everything. **Cost:** answers "what
  was this filed as" and not "what merges has this chart been through".
- **A separate merge record** on the chart. **Cost:** an entry alone cannot answer the question
  without joining, and exports are written against entries.
- **Both.** Complete. **Cost:** two records of one fact, and the usual consequence when they
  disagree.

### 6. Partial refunds against an already-reconciled entry

*Carried from `docs/budget-actuals-findings.md` question 2. Touches whatever reconciliation model
question 4 produces, and cannot be settled before it.*

### 7. The four access-model questions in section 6

**BLOCKING. They gate the actuals build entirely.** Restated there, not duplicated here.

### 8. Is migration 072 applied?

*Not established in this session. No SQL was run.* It is absent from the migration log in
`LIGAMENT_CONTEXT.md`, whose table runs 070 then 073. The query that settles it:

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE (table_name = 'rfp_magic_tokens'      AND column_name = 'budget_categories')
   OR (table_name = 'partner_rfp_responses' AND column_name = 'budget_lines')
ORDER BY table_name;
```

**EXPECTED:** 2 rows, both `jsonb`, both nullable. **Zero rows means the shipped RFP bid budget
feature has been writing to columns that do not exist**, which would be visible as a 42703 the
code already guards for, and is worth knowing either way.

### 9. The intellectual property carve-out on Back of House's origin

*Carried from `docs/budget-actuals-findings.md` question 9, and NOT settled by ruling 2g.*
Ruling 2g settles that the budgeting stage is built fresh and that the tool is a reference rather
than a codebase to import, which removes the import question. **It does not address the
carve-out**, and the carve-out is the half that was stated to gate rather than follow.

### 10. The chart of accounts composition step

*Carried from `docs/budget-actuals-findings.md` question 7.* Template variety, plus a step where
the user check-marks the components they want. Finding 2 raises this from a convenience to a
load-bearing part of the feature, which changes how much it is worth investing in. **Ruling 2f
settles the ownership and copy semantics of the chart and says nothing about how a user composes
one.**

---

## 8. What this specification deliberately does not contain

- **No timelines and no estimates.** By instruction.
- **No data model beyond section 3.** Everything section 3 does not list is an open question,
  and an unlisted invention would read to the next session as a settled decision.
- **No answer to any access-model question.** Section 6.
- **No schedule half.** Ruling 2b, and it is Never rather than later.
- **No accounting ledger semantics.** Ruling 2h.
