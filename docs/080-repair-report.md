# 080 repair report: `milestone_events` for the post-079 model

**Status: repaired, NOT applied.** Nothing in this session executed a statement against any
database. `supabase/migrations/080_milestone_events.sql` is edited on disk and waits for Greg.

Confirmed going in, and unchanged by this work: `milestone_events` does not exist, every
milestone emit is dropped with a logged PGRST205, and `partnerships` has no `partner_id`
column - only `lead_org_id` and `vendor_org_id`.

---

## 1. The policies

All three rewritten. The file no longer contains a company column compared to `auth.uid()`.

| Policy | Was | Now |
|---|---|---|
| Members read own company milestone events | `org_id = auth.uid()` | `org_id IN (SELECT public.current_user_org_ids())` |
| Members insert own company milestone events | `org_id = auth.uid()` | `org_id IN (SELECT public.current_user_org_ids())` |
| Counterparty reads whitelisted milestone events | `p.partner_id = auth.uid()` | `p.vendor_org_id IN (SELECT public.current_user_org_ids())` |

`actor_side` and `actor_id` in the INSERT `WITH CHECK` are untouched, as instructed. The
surviving `actor_id = auth.uid()` is the only `auth.uid()` left in any predicate in the file
and it is correct: `actor_id` is a **user**, not a company, and 079 did not rename it.

### The spelling is `IN (SELECT ...)`, not `= ANY (...)`

The brief asked for `= ANY (public.current_user_org_ids())`. That form does not compile.

`current_user_org_ids()` is declared `RETURNS SETOF uuid` (079:451-461), not `uuid[]`. In an
expression, `x = ANY (expr)` requires `expr` to be an array; a set-returning function offered
there resolves to its element type `uuid`, and Postgres raises **42809, "op ANY/ALL (array)
requires array on right side of ANY"**. Applying it that way would have swapped one apply-time
failure for another.

The `IN (SELECT ...)` form is not a workaround, it is the house convention: **every one of the
110 policy predicates 079 actually shipped uses it**, as do 082, 083, 085, 086 and 087. The
`= ANY` spelling has only ever existed inside instruction comments - the three in this file and
two more in `081_scope_document_and_message_inserts.sql:167,178`, which will need the same
correction when 081 is repaired.

Contrast, in the same policy and deliberately left alone:
`event_type = ANY (public.vendor_visible_event_types())`. That one is right, because
`vendor_visible_event_types()` returns a real `text[]`.

### No status predicate on the partnership

Stated in a new comment above the policy rather than left silent. 085 left
`current_user_counterparty_org_ids()` status-free on purpose, drawing its boundary around
**commercial terms**. A milestone is not a commercial term - it is the record of an act the
counterparty was a party to, and a vendor whose partnership later goes `removed` does not stop
having been sent that RFP. The whitelist is what fails closed here, not the status.

---

## 2. The backfill: moot, and the header now says so

The instruction is deleted, replaced by a statement of why there is nothing to do. The
migration has never been applied, so the table does not exist and holds zero rows. There are no
user ids in these columns to convert, because there are no values in these columns at all. The
table is created holding organization ids and has never held anything else. **No backfill
statement belongs in this migration or in any later one.**

---

## 3. The foreign keys: added, with the actions argued

Both were absent. 079 is applied and its PHASE 7 repoint DO block never named this table, so if
this file does not add them, nothing ever will. Declared inline, following 079 PHASE 7's own
naming convention so a future audit reading either the catalog or the names finds them:

| Column | Null | Constraint | Action |
|---|---|---|---|
| `org_id` | NOT NULL | `milestone_events_org_id_org_fkey` | `REFERENCES organizations(id) ON DELETE CASCADE` |
| `vendor_org_id` | NULL | `milestone_events_vendor_org_id_org_fkey` | `REFERENCES organizations(id) ON DELETE SET NULL` |

This is exactly 079 PHASE 7's stated rule - *"CASCADE on a NOT NULL identity column, SET NULL on
a nullable one"* (079:902-906). Each action is argued at its column:

**`org_id` -> CASCADE.** This does not weaken the append-only rule. That rule governs what a
*caller* may do to a row, and it is enforced by the absence of an UPDATE policy and a DELETE
policy for anybody. An organization ceasing to exist is not a caller editing a breadcrumb. Once
it is gone, `org_id IN (SELECT public.current_user_org_ids())` has nothing left to match, so
CASCADE removes rows already unreadable by every role. RESTRICT would make an organization with
one breadcrumb permanently undeletable; SET NULL is unavailable on a NOT NULL column.

**`vendor_org_id` -> SET NULL.** CASCADE would be wrong here in a way it is not on `org_id`: it
would delete a **lead agency's own** breadcrumbs because a counterparty was removed, destroying
the log of an organization that still exists and can still read it. RESTRICT would block
deleting any organization that had ever been on the receiving end of a milestone. SET NULL
leaves the owning agency's record standing - actor, event type, subject and payload untouched -
and costs no visibility, because counterparty reads were never keyed on this column. They are
keyed on `partnership_id`, which already carries `ON DELETE SET NULL` for the same reason.

---

## 4. Comments

- The two inline column comments are rewritten to the post-079 meaning and now state the FK and
  its ON DELETE action.
- The two `COMMENT ON COLUMN` statements are rewritten. These were **not** in the brief's
  `:189-196` range but had to change anyway: `org_id`'s said *"No FK on purpose - see the file
  header"*, which would have shipped as a direct contradiction of the constraint three lines
  above it. `actor_id`'s stale "not renamed by 079" phrasing is tightened to say what it is.
- **On the count.** The brief said four `079: replace X with Y` instruction comments. There were
  **three** (`:282-283`, `:290-291`, `:316-317`), plus **two** `-- 079:` column-meaning comments
  (`:190`, `:193-195`) - five markers in all. All five are gone, as are the `079 SEAM` prefixes
  inside the two `COMMENT ON COLUMN` bodies. `grep -n -- "-- 079:"` returns nothing. Every
  remaining mention of 079 in the file is prose explaining what was settled and why.
- The whole `THE 079 SEAM` header block (`:51-86`) is replaced by `THE 079 SEAM IS CLOSED`,
  which records all three rulings above, including the 42703 the counterparty policy would have
  raised and the 42809 the instructed `= ANY` spelling would have raised.
- A seventh VERIFICATION query is added, asserting both FKs exist with `confdeltype` `c` and
  `n`. Zero rows there means the FKs were lost and nothing else will add them.

---

## 5. `lib/milestone-events.ts` against the repaired schema

**No mismatch in column names.** `MilestoneRow` (`lib/milestone-events.ts:98-109`) declares ten
keys and every one is a column of the repaired table, spelled identically: `org_id`,
`vendor_org_id`, `partnership_id`, `actor_id`, `actor_email`, `actor_side`, `event_type`,
`subject_type`, `subject_id`, `payload`. It writes neither `id` nor `created_at`, both of which
default. Nothing it inserts is absent from the table, and nothing NOT NULL without a default is
absent from the insert.

**No mismatch in what it passes.** All eight emitters were checked, not just the types:

| Site | `orgId` | `vendorOrgId` | `partnershipId` |
|---|---|---|---|
| `partnerships/route.ts:623` | `writeOrgId` | `existing.vendor_org_id` | `reactivated.id` |
| `partnerships/route.ts:754` | `writeOrgId` | `partnerOrgId` (`resolveOrgIdForUser`) | `partnership.id` |
| `partnerships/route.ts:995` | `orgIdFromColumn(partnership.lead_org_id)` | `orgIdFromColumn(partnership.vendor_org_id)` | `partnershipId` |
| `broadcast-rfp/route.ts:533` | `writeOrgId` | `orgIdFromColumn(row.vendor_org_id)` | `row.partnership_id` |
| `rfp-responses/[id]/route.ts:701,866,963` | `orgIdFromColumn(existing.lead_org_id)` | `orgIdFromColumn(existing.vendor_org_id)` | inbox / award-context `partnership_id` |

Every `orgId` is an organization id - either `writeOrgId` from `resolveCallerWriteOrgId`, or a
`partnerships.lead_org_id` read post-087. Every `vendorOrgId` is a `partnerships.vendor_org_id`
or a `resolveOrgIdForUser` result. Every `partnershipId` is a `partnerships.id`. The two new
FKs are therefore satisfied by every call site as written, and the repaired INSERT policy
matches every one: `writeOrgId` is by construction one of the caller's organizations, and each
`lead_org_id` read is provably one too - `existing` is fetched under `.in("lead_org_id",
callerOrgIds)`, and the `msa.confirm` branch is guarded by
`callerOrgIds.includes(partnership.lead_org_id)`.

**Two things to know, neither a schema mismatch.**

1. **The 42P01 branch is dead; the live drop is PGRST205.** `recordMilestones` special-cases
   `error.code === "42P01"` to log the missing table at WARN naming migration 080
   (`lib/milestone-events.ts:171-177`). PostgREST does not surface the Postgres SQLSTATE for an
   unknown relation - it answers `PGRST205`, table not found in the schema cache, which is
   exactly what is in the logs today. So the intended "unapplied migration reads as an
   unapplied migration" WARN has never once fired; every dropped event has been logging at
   ERROR instead. **Applying 080 makes this moot** - the table will exist - so it needs no fix
   before you apply, and I have not touched it. Worth deleting or correcting afterwards rather
   than leaving a branch that documents a code the API cannot return.

2. **`partnerships/route.ts:623` skips `orgIdFromColumn`.** It passes
   `existing.vendor_org_id` raw where its seven siblings launder the column through
   `orgIdFromColumn`. It typechecks only because the Supabase row is loosely typed, and the
   value is correct post-087. Cosmetic inconsistency in the branded-type sweep, not a defect.

**Third-party note on the sweep the brief mentions.** The 33-line branded-type change left one
stale claim in this file. `lib/milestone-events.ts:153-157` still tells the reader
*"milestone_events.org_id has NO foreign key (migration 080, deliberately) - so an unusable
value raises nothing"*. After this repair that is false in the safe direction: an unusable
`org_id` now raises 23503 rather than writing an invisible row. The module's behaviour is
unaffected - it filters `orgId` for truthiness before inserting, and any error is caught,
logged and swallowed - but the comment should be corrected in the same commit that applies 080.
Its sibling copies of the same claim sit in the five `079 PARAMETER CLASS` comments at the call
sites.

---

## 6. `vendor_visible_event_types()` needs no anon revoke

**Agreed, and none was added.** The brief's reasoning holds and the file already does the
stronger thing anyway.

It takes no arguments, is `IMMUTABLE`, is **not** `SECURITY DEFINER`, and its body is a single
`SELECT ARRAY[...]` of 23 literal event names. It reads no table, so there is no row an
unprivileged caller could reach through it and nothing to leak but the whitelist itself - which
is public product behaviour, restated in `docs/capabilities.md` and in this migration's own
header. Compare the five 079 helpers, every one of which *is* `SECURITY DEFINER` and *does*
read `org_members`, and every one of which is revoked for that reason.

The file already carries `REVOKE EXECUTE ... FROM PUBLIC` plus `GRANT ... TO authenticated`
(`:205-206`), so `anon` cannot execute it regardless - `anon` is not `authenticated` and does
not inherit the revoked `PUBLIC` grant. VERIFICATION query 5 asserts exactly this and expects
`false`. A separate `REVOKE ... FROM anon` would be a no-op against a grant that was never made.

---

## 7. Line numbers, size, and gates

| | Before | After |
|---|---|---|
| `BEGIN;` | 106 | **130** |
| `COMMIT;` | 330 | **385** |
| Total lines | 394 | **465** |

Net +71 lines: the header block roughly doubles, the two column declarations gain their
argued FKs, three instruction comments and one stray `--` are deleted, and VERIFICATION gains
query 7.

**On the grep note.** `grep -n '^BEGIN;$'` does find this file's `BEGIN` - it always did. There
is no trailing whitespace: `od -c` on both lines gives exactly `B E G I N ; \n` and
`C O M M I T ; \n`, and `file` reports plain ASCII text. The anchored pattern returns
`106:BEGIN;` at exit 0 on the original and `130:BEGIN;` on the repaired file. Whatever produced
the earlier miss, it was not this file.

### Gates

All eight. Baseline is the `docs/087-award-fix-report.md` section 6 table.

| Gate | This run | Baseline | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | 0 | Passes. |
| `pnpm build` | **0** | 0 | Passes. Full production build. |
| `pnpm lint` | **1** | 1 | Unchanged. **183 problems, 154 errors, 29 warnings** - identical totals. |
| `pnpm verify-rls` | **2** | 2 | Known pre-existing. Fails before reading a policy; PostgREST does not expose `pg_class` here. |
| `pnpm policy-audit:guard` | **1** | 1 | Known pre-existing. Reads a static pre-079 snapshot. |
| `pnpm identity-columns:guard` | **0** | 0 | Passes. |
| `pnpm embed-targets` | **0** | 0 | Passes. |
| `pnpm org-id-reads:guard` | **0** | 0 | Passes. Class A **14**, Class B **62**, both unchanged. |

Every gate matches baseline exactly. This change touches one `.sql` file that no build step
reads, so that is the expected result rather than a reassuring one - **no gate in this
repository can tell you 080 is correct.** The apply is the test, and VERIFICATION queries 1-7
at the foot of the file are what read it.

---

## 8. Left alone, deliberately

- **The migration is not applied.** Repaired on disk only.
- **`081_scope_document_and_message_inserts.sql`** carries the same `= ANY` mistake in its
  instruction comments at `:167` and `:178`, and is also unapplied. Out of scope here; it will
  hit 42809 the same way if those comments are followed literally.
- **The `42P01` branch and the five `079 PARAMETER CLASS` comments** in application source.
  Both are described in section 5. Neither blocks the apply; both should be corrected in the
  commit that applies 080.
- **The snapshot note** at `:111-126` still expects 107 policies after this migration. Still
  right: this repair changes what the three policies say, not how many there are.
