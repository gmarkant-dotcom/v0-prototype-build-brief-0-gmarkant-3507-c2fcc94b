# Budget spine after 103 / 104: versions, Committed, Paid, the RFP hand-off (plan only)

**Written:** 2026-10-12, branch `feat/budget-ui`. Unattended session. **Nothing here is authored as a
migration, applied, or built.**

**Numbering (renumbered 2026-10-14, twice).** **116 is taken and applied** (2026-10-14) by
`116_budget_line_math.sql` (quantity x unit rate x multiplier). **117 is taken** by
`117_budget_line_kind.sql` (per-line fee or cost override, `feat/budget-line-kind`), so every
migration planned here starts at **118** or later. `docs/rfp-source-of-truth-design.md` section 3 now
claims **118, 119 and 120** for `rfp_records` (written as 116 to 118, moved to 117 to 119, then to 118
to 120 the same day). The budget migrations below stay written **B1 to B5** (budget migration 1 to 5)
and `docs/budget-actuals-feeder-plan.md` is **B0** (it says "116"; read that as "the next free number,
118 or later"). They take the next free numbers at authoring time, in the order of section 6: **from
121** if the RFP record keeps 118 to 120, or **from 118** if the owner authors budget work first, in
which case the RFP record moves up by the same count. The file name of this plan keeps "116" for its
links; its content is "118 and later".

**Read with:** `docs/ligament-00-budgeting-spec.md` (2b, 2c, 2d, 2e, section 4), the RULINGS 2026-10-09
section of `docs/budget-spine-build-plan.md`, `docs/budget-ui-report.md`.

---

## 1. Version baselines and the movement report (the strongest differentiator)

Spec 2b: "not 'the budget changed' but here is what moved, by how much, against the version the client
approved". Spec Q3 (what is a version) is **not ruled**; this plan recommends and asks.

**Recommendation: an explicit snapshot, taken at a deliberate moment, not on every save.** The cost the
spec names for snapshots ("every save is what a working spreadsheet does") applies only if a save makes a
version. Here a version is made by a button ("Save version", "Mark sent to client", "Mark approved"), so
storage grows with decisions, not keystrokes. A diff chain is rejected for the reason the spec gives (one
corrupt link loses the rest); an event log is the richest and the most build, and can be added later
under the same report.

### B1 sketch

```sql
CREATE TABLE public.budget_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id),
  label        text NOT NULL CHECK (btrim(label) <> ''),
  status       text NOT NULL CHECK (status IN ('saved','sent','approved','superseded')),
  note         text NULL,
  created_by   uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz NULL,
  UNIQUE (project_id, id)
);
-- At most one live approved baseline per project.
CREATE UNIQUE INDEX budget_versions_one_approved ON public.budget_versions (project_id) WHERE status = 'approved';

CREATE TABLE public.budget_version_lines (
  version_id     uuid NOT NULL,
  project_id     uuid NOT NULL,
  line_id        uuid NOT NULL,          -- NO foreign key: a snapshot outlives an R1 hard delete
  line_name      text NOT NULL,
  category_id    uuid NOT NULL,          -- no FK, same reason
  category_name  text NOT NULL,
  fee_or_cost    text NOT NULL CHECK (fee_or_cost IN ('fee','cost')),
  estimate       numeric(14,2) NOT NULL,
  PRIMARY KEY (version_id, line_id),
  FOREIGN KEY (project_id, version_id) REFERENCES public.budget_versions (project_id, id)
);
-- Snapshot function, SECURITY INVOKER, pinned search_path, 42501 unless the caller is the project's
-- agency (103's R6 shape): budget_snapshot_version(p_project_id uuid, p_label text, p_status text)
-- RETURNS uuid. Copies every live (non-archived) line with its CURRENT category name and flag.
-- RLS: PROJ predicate (103) for SELECT and INSERT; versions UPDATE only of status / approved_at;
-- no UPDATE on version lines; no DELETE anywhere. No vendor policy, ever (spec 2e).
-- Grants: 103 / 104 posture (R7).
```

### The movement report

Compare **current** (live lines now) with the **approved baseline** (or any two versions), joined on
`line_id`:

| Movement | Rule |
|---|---|
| Added | in current, not in baseline |
| Removed | in baseline, not in current (archived or deleted) |
| Changed | same line, estimate differs: show the delta in cents and percent |
| Moved | same line, `category_id` differs (a merge or a re-file) |
| Renamed | same line, name differs |

Rolled up per category and per fee / cost, with **margin movement**: fee total and fee / (fee + cost)
at baseline versus now. Exportable as CSV through the same quoting and formula neutralisation as
`lib/budget/csv-export.ts`. A merge between versions is explained from `budget_category_merges` (already
recorded), which is why 103 keeps merge history separately.

**Screens:** a Versions tab on `/agency/budgeting/[projectId]` (list, save, mark sent, mark approved, with
"approved replaces the previous approved, which becomes superseded"), and a Movement tab defaulting to
"now versus approved".

## 2. Committed: the bid-to-line link

Spec 2c: Committed is sourced from **awarded bids and purchase orders**. Spec Q4 (what joins an award to
a line) is not ruled. Constraint (spec 2e, build plan Phase C step 3): the pointer **must live on the
agency side**; `partner_rfp_responses` is vendor-writable and must never carry a budget-line id.

**Recommendation: a separate agency-only commitment record** (spec Q4 option 3). It is the only option
that handles a line split across two vendors and a purchase order with no bid, both of which are normal
in production budgets.

### B2 sketch

```sql
CREATE TABLE public.budget_commitments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id),
  budget_line_id     uuid NOT NULL,
  source             text NOT NULL CHECK (source IN ('award','purchase_order','manual')),
  rfp_response_id    uuid NULL REFERENCES public.partner_rfp_responses(id),   -- award source; agency-side pointer
  partnership_id     uuid NULL REFERENCES public.partnerships(id),
  reference          text NULL,                                               -- PO number
  amount             numeric(14,2) NOT NULL,
  cancelled_at       timestamptz NULL,                                        -- R2 style: never deleted
  cancel_reason      text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, budget_line_id) REFERENCES public.budget_lines (project_id, id)
);
-- Guard: rfp_response_id's RFP must belong to the project's agency; partnership lead_org_id = project org.
-- RLS: PROJ predicate; no DELETE policy or grant; no vendor policy.
```

Committed per line = signed sum of non-cancelled commitments (derived, R5's rule). The award flow in Bid
Management gains "Commit to budget line" after award, choosing the line (default: the line the RFP line
was released from, once section 4 exists).

## 3. Paid: a payments record

Spec 2c recasts cash flow as the **Paid** state of the same line. Today vendor payments live in
`payment_milestones` (read by vendors on `/partner/projects` and `/api/partner/payments`) and client
receipts in `client_cash_flow`. Neither joins a budget line.

**Constraint:** `payment_milestones` is vendor-readable, so a budget-line column on it would expose a
master-budget id to the vendor (spec 2e). The link must be agency-only.

### B3 sketch

```sql
CREATE TABLE public.budget_payment_allocations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.projects(id),
  budget_line_id        uuid NOT NULL,
  commitment_id         uuid NULL,
  payment_milestone_id  uuid NULL REFERENCES public.payment_milestones(id),
  amount                numeric(14,2) NOT NULL,
  paid_on               date NULL,
  voided_at             timestamptz NULL,
  void_reason           text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, budget_line_id) REFERENCES public.budget_lines (project_id, id),
  FOREIGN KEY (project_id, commitment_id) REFERENCES public.budget_commitments (project_id, id)
);
```

Paid per line = sum of non-voided allocations. A milestone marked `payment_received` (the real terminal
status; see design language decision 26) offers "Allocate to budget lines". One milestone may be split
across lines.

## 4. Budget line to RFP line hand-off (BLOCKED)

Spec 2d (accept or dictate) and 2e (a vendor sees only the released line). **Blocked on
`docs/rfp-source-of-truth-design.md`**: its `rfp_record_lines.released_budget` is the released artifact
this hand-off writes into, and its decisions D1 to D9 are open.

When unblocked:

- **Accept**: copy the master line's estimate into `rfp_record_lines.released_budget` (a copy, never a
  reference) and record the origin agency-side.
- **Dictate**: type a different released amount; the master line is untouched.

### B4 sketch (after the RFP record migrations)

```sql
ALTER TABLE public.rfp_record_lines ADD COLUMN budget_line_id uuid NULL;   -- agency-only table, so allowed
ALTER TABLE public.rfp_record_lines ADD COLUMN release_mode text NULL CHECK (release_mode IN ('accepted','dictated'));
-- Composite FK needs rfp_record_lines to carry project_id, or a guard trigger checks the line's project
-- equals the record's project_id. Vendor copies (partner_rfp_inbox.master_rfp_json) receive only
-- released_budget, never budget_line_id (the RFP design's step C already strips the rest).
```

Committed (section 2) then defaults its line from this column on award.

## 5. Housekeeping the UI run surfaced (B5, small)

1. **Atomic merge and rename**: a SECURITY INVOKER `budget_merge_categories(p_project_id, p_from, p_into)`
   doing insert-merge-row plus both re-points in one transaction (build plan known limit 1). The UI's
   "Finish merge" button is the current recovery path.
2. **Project category flag change**: there is no update path for `budget_project_categories.fee_or_cost`
   in the server layer, so the UI switches a flag by merging into a same-name category of the other
   flag. If the owner prefers an in-place flag change, add it to the UPDATE helper (no schema change; the
   policy already allows UPDATE) and record the change somewhere a finance export can see.
3. **Currency**: still unstored. `ADD COLUMN currency text NOT NULL DEFAULT 'USD'` on `projects` or on a
   budget header, before the first non-USD project. The UI shows no symbol until then.
4. **Live-name uniqueness**: names may repeat by design (103); the UI refuses duplicate template names and
   skips them in composition, but a project chart can hold two live categories of one name (the flag
   switch creates one briefly). A partial unique index on live names would need "live" to be a column.
5. **Boundary guard script**: build plan Phase C step 2 (`scripts/check-*.mjs` style) is still unbuilt:
   no file under `app/api/partner/`, `app/partner/` or `app/api/rfp/guest/` may name a 103 table or
   `ledger_entries`; `source_documents` only in `lib/server/budget/vendor-documents.ts`.

## 6. Ordering

1. **B0** feeder (ingestion state, hash, review, duplicate flag, manual document kind): independent of the
   rest; most valuable first because Actual is empty without it.
2. **B1** versions and the movement report: independent; the owner's strongest differentiator.
3. **B5** housekeeping: any time; item 1 before heavy merge use.
4. **B2** Committed: after Q4 is ruled. Usable for purchase orders and manual commitments before the RFP
   record exists.
5. **B3** Paid: after B2 (allocations may reference commitments).
6. **B4** RFP hand-off: after the RFP record migrations (`docs/rfp-source-of-truth-design.md`) and its
   D-decisions.

## 7. Owner decisions owed

1. **Q3**: is a version an explicit snapshot (recommended), a diff chain, or an event log?
2. Which moments make a version: manual save only, or also "sent to client" and "approved" automatically?
3. Can an approved baseline be un-approved, or only superseded by a newer approved version?
4. **Q4**: commitment record (recommended) versus a column on the line; and whether purchase orders
   without a bid are in scope for Committed.
5. Paid: allocate from `payment_milestones` (recommended), from a new agency-side payment record, or both.
6. Whether Committed and Paid exports join the finance CSV now or wait for B2 and B3 together.
7. The RFP hand-off waits on `docs/rfp-source-of-truth-design.md` D1 to D9, especially D2 (what is
   "released").
8. The margin formula. Since 2026-10-14 the UI and the CSV show both readings: margin (share of total)
   = fee / (fee + cost) and markup on cost = fee / cost, with margin amount = fee total. Confirm which
   one the client-facing documents use.
9. Migration numbering: 116 is budget line math (applied); 117 is budget line kind; the RFP record
   claims 118 to 120; B0 to B5 follow from 121 unless the owner orders budget work first (see
   Numbering above).
