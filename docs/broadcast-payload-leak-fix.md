# `rfp.broadcast.payload.recipient_count`: removed, and a full audit of the other six payloads

2026-08-20. One code change (item 1). Items 2-4 are findings.

---

## 0. The defect, and why the timing was free

`app/api/agency/broadcast-rfp/route.ts` wrote `recipient_count: rows.length` into the
`payload` of **every** `rfp.broadcast` row. `rfp.broadcast` is on
`public.vendor_visible_event_types()`, and migration 080's counterparty policy is row level —
it grants the whole row:

```sql
CREATE POLICY "Counterparty reads whitelisted milestone events" ... USING (
  partnership_id IS NOT NULL
  AND event_type = ANY (public.vendor_visible_event_types())
  AND EXISTS (SELECT 1 FROM public.partnerships p
              WHERE p.id = milestone_events.partnership_id
                AND p.vendor_org_id IN (SELECT public.current_user_org_ids())))
```

There is no column projection in RLS. `payload` came with the row. So every vendor in a
broadcast could read the size of the field they were bidding against — a number the agency
discloses nowhere else in the product.

**Confirmed live before the change: `milestone_events` holds exactly one row, a
`bid.decline`, carrying no `recipient_count`; zero `rfp.broadcast` rows exist.** So there is
nothing to backfill, nothing to redact, and no migration. The whole fix is a deleted line
plus the reasoning that keeps it deleted.

The two options not taken, and why the ruling is right:

- **Redacting the payload** (strip fields at read time) leaves the data written. It protects
  the one reader that exists today and nothing else — a future vendor-side reader, an export,
  a support query, a service-role route, all still see it. Redaction is a property of a
  caller; absence is a property of the data.
- **Dropping `rfp.broadcast` from the whitelist** would take the vendor's ability to see that
  they were sent an RFP and by whom, which is the event's whole purpose and is why 080 put it
  on the list. It fixes a payload problem by deleting a feature.

Removing the data leaves the event vendor-visible, the payload honest, and the agency's label
intact — because the label was always derivable.

---

## 1. The change

`app/api/agency/broadcast-rfp/route.ts` — one field removed from the `rfp.broadcast` payload,
and a comment added at the emit stating the invariant, so the next person adding a field has
the rule in front of them rather than in a report:

> **EVERY FIELD BELOW MUST BE ABOUT THE ONE RECIPIENT THIS ROW IS FOR.**

The remaining payload is `scope_item_name`, `recipient_email`, `response_deadline`,
`nda_gate_enforced` — all four read off `row`, the recipient's own inbox row.

`recipient_count` appears **nowhere else**. Grepped `app/`, `lib/`, `supabase/`, `docs/` for
`*.ts`, `*.tsx`, `*.sql`, `*.md`: one write site, one mention in the design doc. It was never
read — consistent with `docs/080-emitter-coverage-report.md`, which establishes that nothing
in the product reads `milestone_events` at all. Nothing breaks.

**Where the agency's "to 49 vendors" comes from now.** `recordMilestones` issues one
`.insert()` for the whole batch — one statement, one transaction, one `now()` — so all rows
of a broadcast share a byte-identical `created_at`. The dashboard feed groups on that
(`docs/recent-activity-merge-design.md` §1.1) and the count *is* the group size. The number
survives; it is derived agency-side, where the fetch is scoped by `org_id`, instead of being
written into a row the counterparty can read. **The count exists for the agency precisely
because it is never written down.**

---

## 2. The derived count when the group is truncated

Asked directly, answered directly. Full reasoning is now
`docs/recent-activity-merge-design.md` §1.6; the result:

The feed fetches `ORDER BY created_at DESC LIMIT ACTIVITY_FETCH_LIMIT`. A batch is a
contiguous run of one timestamp, but ties have no deterministic internal order, so `LIMIT`
cuts at an arbitrary point inside whichever tie group straddles the boundary. Only the
**oldest** timestamp in the window can straddle it.

| Case | Count correctness | Action |
|---|---|---|
| Fetch returned **fewer** than the limit | Every group exact — the query exhausted the table | None. This is the only case at current volume. |
| Fetch returned **exactly** the limit, **>1** distinct timestamp | All groups exact **except** the oldest | Discard every row at the oldest timestamp. It is the one group that can be short, and the 15-line display cap would most likely have dropped it anyway. |
| Fetch returned **exactly** the limit, **1** distinct timestamp | The single batch is bigger than the window | Keep it — discarding would delete the product's largest broadcast from the feed. Set `countIsPartial`, render **"to 200+ vendors"**. |

**A broadcast larger than `ACTIVITY_FETCH_LIMIT` cannot be counted exactly from a capped
fetch and is rendered with a `+`, never a bare wrong number.** At a limit of 200 that
requires a single broadcast to 200+ recipients; the largest ever sent is 49. The §1.4 ceiling
log is the signal, and it now carries two meanings — the feed may be incomplete, and a count
may be short.

Exactness independent of the fetch would need a `GROUP BY` (no PostgREST expression without
an RPC) or one `count: "exact"` query per group. Neither is worth a migration or N round
trips for decoration on a feed line.

---

## 3. Audit: every payload field written by the six emitting types

**All six emitting types are on the whitelist.** `vendor.invite`, `msa.confirm`,
`rfp.broadcast`, `bid.feedback`, `bid.award`, `bid.decline` — every one. So *every* payload
field this product writes today is counterparty-readable. There is no "internal" emitter to
exempt.

Two questions per field, and only the second one finds defects:

1. Is the field about the reader? RLS routes each row to exactly one vendor org, via
   `partnership_id`. A field describing *that* vendor is not a disclosure — they already know
   it, usually because the product mailed it to them.
2. Is the field about **anyone else** — another vendor, the field as a whole, the agency's
   internal state? That is the `recipient_count` defect, whatever it is called.

### The table

| Type | Field | Who the row routes to | Verdict |
|---|---|---|---|
| `vendor.invite` ×2 | `partner_email` | The invited vendor | **OK.** Their own address, from the invitation they received. |
| | `invitee_has_account` | same | **OK.** Whether *they* already had an account. They must have one to read the row at all. |
| | `reactivated_from: 'terminated'` | same | **OK, noted below.** |
| `msa.confirm` | `msa_confirmed_at` | The vendor whose MSA it is | **OK.** A timestamp on their own paperwork. This is the exact case the 2026-08-17 ruling whitelisted the type for. |
| `rfp.broadcast` | `scope_item_name` | The one recipient of this row | **OK.** The scope they were asked to bid on. |
| | `recipient_email` | same | **OK.** Per-recipient row, so this is the reader's own address — not the recipient list. Worth restating because the plural-sounding name invites the opposite reading. |
| | `response_deadline` | same | **OK.** Their deadline, also in the mail they got. |
| | `nda_gate_enforced` | same | **OK.** Whether *their* row is NDA-gated. |
| | ~~`recipient_count`~~ | **every recipient** | **DEFECT — removed.** The only field describing the broadcast rather than the recipient. |
| `bid.feedback` | `scope_item_name` | The vendor being given feedback | **OK.** |
| | `status` | same | **OK.** Their own bid's new status, which the feedback email states. |
| `bid.award` | `project_id` | The **winning** vendor only | **OK.** Not a new disclosure — `project_id` is already returned to vendors by `app/api/partner/dashboard/route.ts:66`, `app/api/partner/projects/route.ts:141`, and five other partner routes. |
| | `project_name` | same | **OK.** They were just awarded it. |
| | `scope_item_name` | same | **OK.** |
| `bid.decline` | `scope_item_name` | The declined vendor | **OK.** |
| | `had_reason` | same | **OK.** A boolean about the message *they* received. The reason text itself is deliberately excluded — the emitter comment says why: it is already composed into `agency_feedback` and mailed, and duplicating it here would put one sentence under two different read rules. That instinct is the right one and it is what kept this payload clean. |

**One defect, and it is the one already known. Nothing else in the six payloads describes a
third party, the competitive field, or the agency's internal state.** No further change is
made, per the instruction to report before going beyond item 1.

### The one entry worth a second look, not changed

`vendor.invite` on the reactivation branch writes `reactivated_from: 'terminated'`. It tells
the vendor their partnership had previously been terminated. That is a fact about their own
relationship and one they were party to, so it is not a leak in the `recipient_count` sense —
nobody else's information is in it. It is flagged only because it is the single field in the
set that describes agency *history* rather than the current act, and history is where this
class of defect usually hides. Left as is; if it is ever unwanted, that is a product call
about tone, not a security fix.

### The rule this audit produces

Stated once, in the place it has to be obeyed — at each emit, and now in the comment at
`broadcast-rfp/route.ts`:

> A payload field on a whitelisted event type is read by the counterparty on that row.
> Write only fields **about that counterparty**. Anything about the broadcast, the field of
> bidders, another vendor, or the agency's own reasoning is a disclosure, however small the
> value looks.

Three of the seventeen unimplemented event types are where this will next matter, and all
three are whitelisted: `bid.shortlist` (do not write how many were shortlisted),
`rfp.deadline_change` (the old deadline is fine — it was theirs; who else it was changed for
is not), and `payment.mark_paid` (an amount is theirs; a total across vendors is not).

---

## 4. Gates

All eight, run after the change. Baseline is the `docs/087-award-fix-report.md` table, itself
baselined on `docs/m1-cleanup-report.md` Phase 4.

| Gate | This run | Baseline | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | 0 | Passes. The bar CLAUDE.md sets. |
| `pnpm build` | **0** | 0 | Passes. Full production build. |
| `pnpm lint` | **1** | 1 | Unchanged. **183 problems, 154 errors, 29 warnings** — identical totals. |
| `pnpm verify-rls` | **2** | 2 | Known pre-existing. Fails before reading a policy; PostgREST does not expose `pg_class` here. |
| `pnpm policy-audit:guard` | **1** | 1 | Known pre-existing. Reads a static pre-079 snapshot. |
| `pnpm identity-columns:guard` | **0** | 0 | Passes. 0 findings in 0 files. |
| `pnpm embed-targets` | **0** | 0 | Passes. 0 findings in 0 files. |
| `pnpm org-id-reads:guard` | **0** | 0 | Passes. Class A **14** known-open, Class B **62**, both unchanged. |

No gate moved. The change deletes one object property and adds comments; it touches no type,
no policy, no identity column and no embed.

---

## What changed on disk

| File | Change |
|---|---|
| `app/api/agency/broadcast-rfp/route.ts` | `recipient_count` removed from the `rfp.broadcast` payload; the per-recipient invariant documented at the emit. |
| `docs/recent-activity-merge-design.md` | The open finding marked closed. New §1.6: what the derived count does at the fetch ceiling. |
| `docs/broadcast-payload-leak-fix.md` | This file. |
