# The vendor removal run

Branch `feat/vendor-removal`, cut from `main` at `f94eaa3`. Three commits, one per phase.
**NOT PUSHED. NOT MERGED. NO MIGRATION AUTHORED. NO SQL RUN.**

**NO DATABASE WAS QUERIED AT ANY POINT.** This session had no credentials and did not seek
any. Every question needing a catalog read or a row count is in section 6 as a query for Greg,
with its expected value, and none of them was run.

The six emitter rulings were out of scope and are untouched. `lib/milestone-events.ts`,
`vendor_visible_event_types()` and `docs/emitter-rulings-owed.md` have no diff on this branch.

---

## 0. THE HEADLINE

1. **The brief's Phase 3 premise is false, and so was the finding it inherited.** A working
   Remove does NOT move a Discovered contact into "Active vendors". The row vanishes from the
   pool entirely, because `GET /api/partnerships` has always filtered removed rows out. The
   previous session reasoned from `partnershipPoolColumn()` without checking whether a removed
   row ever reaches it. It does not.
2. **The real defect is the opposite one, and it is the constraint the brief itself named.**
   A removed vendor could not be found again from anywhere in the product. "Removed" and
   "deleted" were the same thing to the only person who might want one back. Phase 3 fixes
   that.
3. **Archive is not a second state. `removed` already IS the archive**, in migration 063's own
   words. The control Greg ruled to keep would have been a synonym, so it is deleted instead.
4. **The false access promise was real and is gone**, but it lived in a dialog nothing could
   open. The claim is what mattered, not its reachability.
5. **Every gate matches its known baseline exactly.** One lint regression was introduced and
   caught during Phase 4, and removed before the commit was finalised.

---

## 1. PHASE 1. THE PROMISE THE PRODUCT DOES NOT KEEP

Commit `09cef4e`. Copy only. **No access behaviour is changed and revocation is not built.**

### 1a. Every surface that states or implies removal revokes access

I swept `app/`, `components/`, `lib/`, `docs/glossary-content.md` and the marketing pages for
revocation language, irreversibility claims and removal copy.

| # | File and line (before this branch) | Text | Verdict |
|---|---|---|---|
| 1 | `app/agency/pool/page.tsx:2615` | "Are you sure you want to remove {name} from your vendor pool? **They will no longer have access to your projects. This action cannot be undone.**" | **FALSE on both halves.** Rewritten. |
| 2 | `app/agency/pool/page.tsx:2647` | "Remove {email} from your pool? **This action cannot be undone.**" | Technically true, materially misleading. Rewritten. |
| 3 | `app/agency/pool/page.tsx:2585-2589` | "Not available yet. This vendor's bids, status updates and payment history are attached to this record..." | Accurate. Deleted in Phase 2 with its control. |
| 4 | `app/agency/pool/page.tsx:629-647` | Handler comment claiming Remove promotes the row into "Active vendors" | **FALSE.** Corrected. See section 3. |

**THE CLAIM APPEARS IN NO OTHER PLACE.** `docs/glossary-content.md` and `lib/glossary.ts`
carry no vendor-removal entry; their only "removed" string is about a budget category. No
email template mentions removal, and `PATCH /api/partnerships` sends no mail on a status
change to `removed` - `app/api/partnerships/route.ts:1279-1290` is a bare column write. There
is no FAQ entry. **The brief warned the claim might appear in more places than the dialog. It
does not.**

### 1a-i. THE CORRECTION THE BRIEF NEEDS: SURFACE 1 WAS UNREACHABLE

The dialog carrying the false access promise **could not be opened.** Nothing called
`setShowDeleteConfirm(true)`; the only control that ever did was disabled by the previous
session. So no user has read that sentence since that change shipped.

**It was still worth fixing and it is still a real finding.** The sentence was in the product,
and Phase 2 of the brief contemplates re-enabling exactly that control. Fixing the copy in
Phase 1 also keeps Phase 1 correct on its own if Phase 2 is reverted.

**The LIVE removal control is a different one.** It sits in the Discovered column
(`app/agency/pool/page.tsx:2220`, now `:2247`) and its dialog is surface 2. It acts only on
`pending` rows that were never invited, so the vendors it touches have no access to lose. The
false promise and the working control were never on the same screen.

### 1b. WHAT REMOVAL ACTUALLY DOES

Established by reading `partnershipPoolColumn()`, both pool filters, and every query in `app/`
and `lib/` that filters on `partnerships.status`.

**WHAT CHANGES FOR THE AGENCY**

| # | Effect | Where |
|---|---|---|
| 1 | The contact disappears from the pool entirely. Not moved, not badged. | `app/api/partnerships/route.ts:95` (embed) and `:129` (fallback), both `.neq('status','removed')` |
| 2 | They can no longer be chosen as an RFP broadcast recipient | `app/api/agency/broadcast-rfp/route.ts:222` requires `status='active'` |
| 3 | Their notes panel stops loading | `app/api/agency/pool/[partnerId]/notes/route.ts:72` |
| 4 | Their reliability/performance panel stops loading | `app/api/agency/pool/[partnerId]/performance/route.ts:58` |
| 5 | The award resolver's active-partnership path stops matching them | `lib/award-partnership-resolution.ts:59` |

**WHAT CHANGES FOR THE VENDOR**

| # | Effect | Where |
|---|---|---|
| 6 | **That agency's payment milestones vanish from the vendor's payments page** | `app/api/partner/payments/route.ts:77` requires `status='active'` |
| 7 | The agency disappears from the vendor's network page | `app/partner/network/page.tsx` - a removed row is in neither the active list nor the pending list, and the status badge renders `null` |

**WHAT DOES NOT CHANGE, WHICH IS THE POINT**

| # | Survives | Why |
|---|---|---|
| 8 | Every awarded project | `app/api/partner/projects/route.ts:87-90` reads the vendor's partnerships with **no status filter at all** |
| 9 | Documents, onboarding packages, status updates, messages, signed agreements | No RLS policy anywhere filters on `partnerships.status` (given fact, 2026-09-14) |
| 10 | Their bids and the requests they were sent | `partner_rfp_responses` and `partner_rfp_inbox` are untouched by a status change |

> **THE ONE-SENTENCE ANSWER.** Removal hides the contact from the agency's pool and stops them
> being sent new RFPs. It does not take away access to work already awarded. The only thing it
> takes from the vendor is sight of that agency's payment milestones, and that is a side
> effect of an `active`-only query, not a revocation.

### 1c. The rewritten copy. NOTHING IS SOFTENED

**Surface 1** now reads:

> Remove {name} from your vendor pool? They stop appearing in your pool and you will not be
> able to send them new RFPs. **Work already awarded to them is not affected.**

The access claim is deleted, not hedged. The third sentence is there because its absence is
what let the reader assume the opposite.

**Surface 2** now reads:

> Remove {email} from your pool? They stop appearing in your pool and you will not be able to
> send them RFPs. Their record and any bid history are kept, but nothing on this page adds
> them back.

**"This action cannot be undone" is dropped rather than softened.** It was true only because
nothing restored a removed row, and it read as if the record were destroyed. The replacement
says the record is kept AND that this page will not bring it back, which is the same warning
without the false implication.

### 1d. THE ROWS ALREADY REMOVED. WHAT IS TRUE OF THEM TODAY

**I could not establish how many there are. `Q1` in section 6 is the query and it was not
run.** What I can state without it, because it follows from the code rather than from a count:

> **EVERY PARTNERSHIP SITTING AT `status='removed'` RIGHT NOW IS A RELATIONSHIP WHERE THE
> AGENCY BELIEVES ACCESS WAS REVOKED AND IT WAS NOT.** Those vendors can still open every
> project they were assigned, every document, every onboarding package. No policy was ever
> written to stop them, and `/api/partner/projects` does not filter on partnership status. The
> agency cannot see this, because the row is filtered out of their pool: **they have no
> surface that lists who is in this state.** As of Phase 3 they do.

**Two of those rows are more urgent than the rest**, and `Q1` separates them: a row that was
`pending` before removal (a never-invited contact) had no access to lose and is harmless. A
row that was `active` before removal is a vendor with live project access and an agency that
thinks otherwise. `partnerships.accepted_at` is the discriminator and `Q1` returns it.

---

## 2. PHASE 2. THE DEAD DELETE BUTTON

Commit `081a4ef`.

### 2b. THE ANSWER, WHICH WAS ESTABLISHED BEFORE ANY CODE WAS WRITTEN

> **ARCHIVE IS NOT A SECOND STATE. `removed` IS ALREADY THE ARCHIVE, AND AN ARCHIVE BUTTON
> WOULD HAVE BEEN A SYNONYM FOR THE REMOVE CONTROL THAT ALREADY WORKS.**

This is not an inference from the name. Migration 063 created the value and said what it was
for, in these words (`supabase/migrations/063_invitation_sent_at.sql:11-13`):

> `'removed'` lets an agency hide a Discovered/Invited row from the pool without deleting the
> row outright, since it may carry associated `rfp_magic_tokens` or bid history worth keeping
> for audit.

That is the definition of archive, written three years of migrations ago. `GET
/api/partnerships` implements it with the two `.neq` clauses. An Archive button would `PATCH`
the same column, on the same table, to the same value, through the same handler, and the row
would then be hidden by the same two clauses. **Same act, same state, same code path.**

**The only difference is reach, and reach is not a state.** The working Remove is rendered
only on Discovered rows; the dead button sat on any vendor including active ones. That is a
question about which rows a control is offered on, not about what the control does.

**SO NO MIGRATION WAS AUTHORED AND NO CHECK CONSTRAINT WAS WIDENED.** 2c is conditional on
archive being distinct. It is not. **There are no BEGIN/COMMIT line numbers to report because
there is no migration.** Had one been needed, section 6 `Q3` would have had to settle first
whether `partnerships.status` is constrained at all - 063 only adds its CHECK if one already
existed, and its own comment says it probably did not.

### 2a/2c. What shipped

**The control is deleted, with its unreachable dialog, its dead handler and three orphaned
state hooks.** `handleDeletePartner`, `showDeleteConfirm`, `partnerToDelete`, `isDeleting` and
the now-unused `Trash2` import are gone.

**No capability is lost.** The control called `DELETE /api/partnerships`, which returns 501:
`public.partnerships` has no DELETE policy in any migration through 099, so RLS matched zero
rows for every caller including the owning agency. It could only ever produce an error.

**Why deletion rather than keeping it as a placeholder.** The previous session kept it visible
to hold a question open. That question has now been answered twice - by Greg's ruling, and by
063 - so the placeholder has served its purpose, and two buttons doing one thing is worse than
one button. The reasoning is recorded in the file where the control was, not only here.

### 2d. HOW I KNOW NO COUNTERPARTY RECORD IS DESTROYED OR ORPHANED

**This commit writes no SQL, issues no request and changes no query.** It stops rendering a
button and deletes code that was never reached. The ten foreign keys into `public.partnerships`
- eight CASCADE and two SET NULL per the brief's 2026-09-14 measurement - are the reason a hard
delete was never the answer, and a change that only removes a control cannot reach them.

**The 501 route is left in place.** It is now unreachable from the interface, but it is the
guard if anything ever calls the endpoint again, and removing it would be a second unasked
change in a commit about a button.

### 2e. THE GAP THIS LEAVES, WHICH IS A DIFFERENT GAP FROM THE ONE THE BUTTON WAS MARKING

> **NO AGENCY-SIDE CONTROL ANYWHERE IN THIS PRODUCT ENDS A RELATIONSHIP WITH AN ACTIVE
> VENDOR.**

Nothing in `app/` writes `'suspended'` or `'terminated'` from the agency side. The only writer
of `'terminated'` is the vendor (`app/partner/network/page.tsx:456`, and the decline branch at
`app/api/partnerships/route.ts:1179`). `PATCH /api/partnerships` accepts both values from an
agency (`:1019`) and no UI ever sends them.

**`'removed'` is the wrong value for that act.** It is the archive for a contact you never
worked with. Applying it to an active vendor silently blanks that vendor's own payments page,
because `/api/partner/payments:77` requires `status='active'`, and sends them no notification.
Building "Archive" on the detail panel would have shipped exactly that.

**That is the next piece of work and it is a product ruling, not a build task.** Section 5.

---

## 3. PHASE 3. THE POOL COLUMN DEFECT

Commit `4ae2980`.

### 3a. WHAT THE FUNCTION DOES TODAY, AND WHY THE TABLE IS NOT THE WHOLE STORY

`partnershipPoolColumn()` before this branch was three lines: `pending` splits on whether an
invitation was confirmed sent, everything else returns `"network"`.

| `status` | `invitation_sent_at` | Column returned | Rendered where |
|---|---|---|---|
| `pending` | set | `invited` | Invited column |
| `pending` | null | `discovered` | Discovered column |
| `active` | any | `network` | Active vendors |
| `suspended` | any | `network` | Active vendors, badged "Suspended" |
| `terminated` | any | `network` | Active vendors, badged "Terminated" |
| `removed` | any | `network` | **NOWHERE. The row never arrives.** |
| null / undefined | any | treated as `pending` | Invited or Discovered |
| any other string | any | `network` | Active vendors |

### 3a-i. >>> THE BRIEF'S PREMISE FOR THIS PHASE IS FALSE <<<

The brief states that a working Remove "moves a DISCOVERED contact INTO 'Active vendors'
badged 'Vendor (removed)'". **It does not, and it never has.**

**THE PROOF IS THREE FACTS AND THEY ARE ALL IN THE READ PATH, NOT THE COLUMN FUNCTION.**

1. `GET /api/partnerships`, agency branch, ends **both** of its queries with
   `.neq('status', 'removed')` - the embed at `route.ts:95` and the plain fallback at `:129`.
   That filter is original to the feature; 063 introduced `'removed'` for exactly this.
2. `/agency/pool` gets its `partnerships` array from that route and from nowhere else
   (`page.tsx:503`).
3. `handleRemovePartnership` **awaits `loadPartnerships()` on success** (`page.tsx:660`), which
   refetches through that same route.

So the moment the PATCH succeeds the row is refetched away. It is not promoted; it is gone.
**`partnershipPoolColumn()` is never asked about a removed row on that page, so its wrong
answer was invisible.**

**The previous session's "DISAGREEMENT 1" is wrong on the same point**, and it is wrong in a
second way I should state: it says the row would be "badged `Vendor (removed)` by
`partnershipStateLabel()`". `partnershipStateLabel()` is not what badges that card. The Active
vendors card computes its own badge (`page.tsx:1844-1856`), which has no `removed` case, so the
row would have read **"Active"** or **"New"**. `partnershipStateLabel()` is used only by the
spreadsheet importer's dedup map.

**The original comment that session "corrected" was right.** It said Remove "hides the row from
every pool section without deleting it." That is what happens.

### 3b. WHERE A REMOVED VENDOR GOES, AND WHY

The brief's two constraints are: it must not appear under "Active vendors", and **a producer
must be able to FIND it again**. The first was already satisfied. **The second was not, and
that is the live defect this phase fixes.**

There was no surface anywhere in the product that listed a removed contact. Removal is not
deletion - the row is kept deliberately - but with the filter unconditional, `removed` behaved
exactly like `deleted` to the only person who could have wanted it back. **That is the same
principle the closure ruling settled for RFP requests: a closed request stays findable.**

**What shipped, in three parts:**

**(1) `removed` gets its own column.** `PartnershipPoolColumn` gains a fourth value and
`partnershipPoolColumn()` tests for it by name rather than letting it fall through to
`"network"`. This closes a trap rather than fixing a visible defect: the wrong answer was
masked by a filter one layer up, and part (3) lifts that filter on purpose.

**(2) The two `!== "network"` call sites now name the pending pair explicitly**, via a new
`isPendingPoolColumn()` helper. **On the vendor's network page this is load-bearing, not
cosmetic.** The vendor branch of `GET /api/partnerships` applies **no status filter**, so a
removed row does reach `app/partner/network/page.tsx`. Under the old shorthand, giving
`removed` its own column would have moved those rows straight into that vendor's pending
invitations list - an agency that archived a contact would have reappeared in the vendor's
queue asking for an answer. **This is the regression the phase would have shipped if the
column change had been made alone.**

**(3) `?include=removed` and a "Removed contacts" section on `/agency/pool`.** The flag returns
**only** removed rows, so the archive is a separate list.

### 3b-i. THE EQUAL-OR-NARROWER ARGUMENT FOR `?include=removed`

**NO ACCESS PREDICATE IS WIDENED.**

- **RLS is untouched.** No policy is created, dropped or altered, and no migration is authored.
  The SELECT policy on `public.partnerships` carries no status predicate at all (given fact,
  2026-09-14), so these rows were **already readable by this exact caller**. The `.neq` was a
  presentation default in application code, not a security boundary.
- **The organization predicate is byte-for-byte unchanged.** Both queries still read
  `.in('lead_org_id', callerOrgIds)`. Nothing is loosened to `current_user_counterparty_org_ids`
  or any visibility set.
- **The auth and role checks are unchanged.** The flag is read after the session check and
  after `actingRole(profile)` resolves, and only the agency branch consults it.
- **The service role is not used.** This route did not use it before and does not now.
- **The flag NARROWS rather than widens when set**: `.eq('status','removed')` returns a strict
  subset of what `.neq(...)` excluded, and the two together return what one unfiltered query
  would have. No single request sees more than the pool did.
- **The vendor branch does not read the flag.** A vendor has no archive to browse, and that
  branch already returns removed rows unfiltered, so there is nothing for a flag to unlock.

### 3c. BEFORE AND AFTER, EVERY STATUS, INCLUDING THE ONES I DID NOT CHANGE

| `status` | Column BEFORE | Column AFTER | Rendered BEFORE | Rendered AFTER | Moved? |
|---|---|---|---|---|---|
| `pending`, invitation sent | `invited` | `invited` | Invited column | Invited column | no |
| `pending`, not sent | `discovered` | `discovered` | Discovered column | Discovered column | no |
| `active` | `network` | `network` | Active vendors | Active vendors | no |
| `suspended` | `network` | `network` | Active vendors, "Suspended" | unchanged | no |
| `terminated` | `network` | `network` | Active vendors, "Terminated" | unchanged | no |
| `removed` | `network` | **`removed`** | **nothing, anywhere** | **Removed contacts section** | **yes, from nowhere to somewhere** |
| null / undefined | `invited`/`discovered` | same | same | same | no |
| unknown string | `network` | `network` | Active vendors | Active vendors | no |

**Five of the eight rows are unchanged in both column and rendering.** The only row that moves
is `removed`, and it moves from invisible to visible. **No row moves between two visible
columns**, which is why section 3d has nothing to reconcile.

### 3d. THE COUNTS. NONE OF THEM CHANGE, AND THAT IS BY CONSTRUCTION

The pool page derives every count from one array, `partnerships`:

| Count | Expression | Changed? |
|---|---|---|
| "Active vendors" section count | `filteredNetworkRows.length` | no |
| "Invited" section count | `filteredInvitedRows.length` | no |
| "Discovered" section count | `filteredDiscoveredRows.length` | no |
| "Showing N results" | `filteredNetworkRows.length + filteredPartners.length` | no |
| "N in network (of M)" | same two arrays | no |
| Active vendors stat tile | `partnerships.filter(status === 'active').length` | no |
| Active engagements stat tile | separate route | no |
| Blacklisted stat tile | notes-derived | no |

**THE REASON IS THE DESIGN, NOT A COINCIDENCE.** The archive is loaded into its own state,
`removedRows`, and is **never merged into `partnerships`**. A removed contact that never enters
that array cannot change a count derived from it. The alternative - adding removed rows to
`partnerships` and filtering them back out at each render site - is exactly how a header ends
up disagreeing with the list beneath it, which the brief notes has happened twice here.

**The new section's own count cannot disagree with its body either.** The header renders
`removedRows.length` and the body maps `removedRows`. Same array, no filter between them.
**The search box deliberately does not narrow this list** - it drives the three `filtered*`
arrays and nothing else - so the count cannot drift from the rows while a query is typed.

**One count that was already correct and stays correct:** the Active vendors stat tile filters
`status === 'active'`, so it never included a removed row even when the column function claimed
one belonged there.

### 3e. WHAT I DID NOT BUILD, AND WHY

**There is no Restore control.** `PATCH /api/partnerships` validates status against
`['active','suspended','terminated','removed']` (`route.ts:1019`) and **rejects `'pending'`**,
so a Discovered contact cannot be put back where it came from without widening that list.
Restoring a never-invited contact and restoring an ex-active vendor are also different acts
with different consequences. **That is a ruling, and section 5 asks for it.** Finding a removed
vendor again is what the brief required and is what shipped.

---

## 4. PHASE 4. GATES

**EXECUTED. Every gate was run as its own command, unpiped, with `echo $?` as the next
statement. No exit code in this table was read through a pipe or from `$PIPESTATUS`.**

| Gate | Exit | Status |
|---|---|---|
| `npx tsc --noEmit` | **0** | **PASS** |
| `pnpm build` | **0** | **PASS** |
| `pnpm lint` | **1** | Known pre-existing. `182 problems (154 errors, 28 warnings)` - the exact triple the brief names. **Not a regression.** |
| `pnpm verify-rls` | **2** | Known pre-existing. PostgREST does not expose `pg_class`; has never worked. |
| `pnpm identity-columns:guard` | **0** | **PASS.** "No legacy company identity column names in application source." |
| `pnpm org-id-reads:guard` | **0** | **PASS.** "14 known-open sites remain... Passing here means the class did not grow." |
| `pnpm embed-targets` | **0** | **PASS.** TOTAL 0 in 0 files. |
| `pnpm policy-audit:guard` | **1** | Known pre-existing. Reads a static snapshot. |

> **A LINT REGRESSION WAS INTRODUCED AND CAUGHT HERE. REPORTING IT BECAUSE IT NEARLY SHIPPED.**
> The first Phase 4 lint run returned **183 problems (155 errors, 28 warnings)** - one error
> more than baseline. It was `react-hooks/immutability` on a call I had added to the mount
> effect, which referenced `loadRemovedPartnerships` above its own declaration. The archive
> load was moved to pair with `loadPartnerships()`, where it is already declared, and the count
> returned to 182/154/28. **The Phase 3 commit was amended before this report was written, so
> no commit on this branch carries the regression.** Comparing the triple against the brief's
> stated baseline is what caught it; the exit code was `1` either way.

**I did not re-run `pnpm lint` on `main` to re-derive the baseline.** My number matches the
brief's stated triple exactly, which corroborates it, but the independent check was not run.

**`CLAUDE.md` pre-commit checklist, both items executed.** `npx tsc --noEmit` exit 0.
`grep -rl "\](http://" app/ --include="*.ts" --include="*.tsx"` returned nothing (exit 1, no
matches).

**Em dashes: the branch diff was filtered to added lines only and counted for the em dash
character. The count is 0.** The two touched files
that contain em dashes (`app/agency/page.tsx`, `app/partner/network/page.tsx`) carry them on
pre-existing lines this branch does not touch.

### Independently mergeable, and what to revert

| Phase | Commit | Mergeable alone? | Revert | What comes back |
|---|---|---|---|---|
| 1 | `09cef4e` | **Yes.** Copy only, one file. | `git revert 09cef4e` | The false "no longer have access" sentence, in a dialog nothing can open. |
| 2 | `081a4ef` | **Yes**, but see below. | `git revert 081a4ef` | The disabled button, its dialog, the dead handler. |
| 3 | `4ae2980` | **Yes.** No file overlap with 2's deletions. | `git revert 4ae2980` | Removed vendors become unfindable again. |

**ONE ORDERING CONSTRAINT.** Phases 1 and 2 touch the same file and 2 deletes a block 1 edited.
**Reverting 2 alone is clean. Reverting 1 alone after 2 has landed will conflict**, because the
lines 1 changed no longer exist. If only Phase 1 must go, revert 2 first or drop the commit.
Phase 3 is independent of both.

**If one is wrong, which is most likely and what is the blast radius:**

- **Phase 3 carries the only behaviour change that reaches a vendor's screen**, and it is a
  deliberate non-change: the `isPendingPoolColumn` fix keeps a removed row out of the vendor's
  pending list, exactly where it is today. If that reasoning is wrong, the symptom is a vendor
  seeing an archived agency in their invitation queue. **Live checklist step 9 tests it.**
- **Phase 3's second risk is one extra GET per pool load.** `loadRemovedPartnerships()` fires
  alongside `loadPartnerships()`. It is not awaited and a failure is logged and swallowed, so
  it cannot block or break the page. If the request volume is unwanted, the single
  `void loadRemovedPartnerships()` line is a one-line removal.
- **Phase 2 cannot break a flow that worked**, because the flow it deletes returned 501.
- **Phase 1 changes two strings.**

---

## 5. THE QUESTIONS LEFT FOR GREG

### RULING 1. THE ROWS ALREADY AT `status='removed'`. THIS ONE IS LIVE AND IT IS FIRST.

Every such row is a relationship where an agency believes access was revoked and it was not.
**`Q1` says how many and, crucially, how many were `active` before removal.** A removed row
that was never invited is harmless. A removed row with an `accepted_at` is a vendor with live
project access and an agency that thinks otherwise.

**What to decide:** whether those vendors should lose access when revocation ships, be
contacted first, or be left alone because the agency may not have meant "revoke" at all. As of
Phase 3 the agency can at least see who they are.

### RULING 2. WHAT ENDS A RELATIONSHIP WITH AN ACTIVE VENDOR?

There is no control for this anywhere. `'suspended'` and `'terminated'` exist in the
vocabulary, `PATCH /api/partnerships` already accepts both from an agency, and **no UI ever
sends either.** The dead button was sitting where such a control would live, which is probably
why it was mistaken for one.

**The trap to avoid:** reaching for `'removed'` because it is the value that has a button.
Applying it to an active vendor blanks that vendor's payments page with no notification
(`/api/partner/payments:77`). If "end the relationship" is the act, it needs `'terminated'`,
its own copy, and a decision about whether the vendor is told.

### RULING 3. SHOULD A REMOVED CONTACT BE RESTORABLE, AND TO WHAT?

`PATCH` rejects `'pending'`, so restoring a Discovered contact needs that validation list
widened by one value - a one-line change, no migration, no policy. **The question is not the
code, it is the semantics:** does a restored never-invited contact go back to Discovered, and
does a restored ex-active vendor go back to `active` without the vendor agreeing again? Those
are different answers and the second one re-activates a relationship unilaterally.

---

## 6. QUERIES FOR GREG. NONE WERE RUN.

**Q1. THE ONE THAT MATTERS MOST. How many partnerships sit at `'removed'`, and how many of
them were live relationships?** Section 1d rests on this.

```sql
SELECT count(*)                                            AS removed_total,
       count(*) FILTER (WHERE accepted_at IS NOT NULL)     AS was_active_before_removal,
       count(*) FILTER (WHERE vendor_org_id IS NOT NULL)   AS has_claimed_account,
       count(*) FILTER (WHERE invitation_sent_at IS NOT NULL) AS was_invited,
       min(updated_at)                                     AS earliest_removal,
       max(updated_at)                                     AS latest_removal
FROM public.partnerships
WHERE status = 'removed';
```

**EXPECTED:** `removed_total` small and non-zero. **`was_active_before_removal` is the number
that decides Ruling 1.** If it is 0, every removed row is a never-accepted contact and nothing
is urgent. **Any non-zero value is that many vendors holding project access their agency
believes they lost**, and each one is nameable with the same `WHERE` clause plus
`SELECT id, partner_email, lead_org_id`.

**Q2. Does `public.partnerships` still have no DELETE policy?** Phase 2's claim that the
control could never work rests on this, and it is read from migration files, not the catalog.

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partnerships' ORDER BY cmd, policyname;
```

**EXPECTED:** INSERT, SELECT and UPDATE rows only. **Any DELETE row means the 501 is now wrong**
and the decision to delete the control should be revisited rather than assumed.

**Q3. Is `partnerships.status` constrained at all, and to which values?** Migration 063 adds
its CHECK **only if one already existed**, and its own comment says it probably did not. Nothing
in this run needed the answer because no new status value was introduced, but the next piece of
work will.

```sql
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'partnerships' AND con.contype = 'c';
```

**EXPECTED:** either one row naming the five values `pending, active, suspended, terminated,
removed`, **or no rows at all**, which means the column is free text and a new status needs no
migration. Both are plausible and the difference is a whole workstream.

**Q4. The foreign key arithmetic in the brief does not add up, and the discrepancy is worth
one query.** The 2026-09-14 fact block says **SEVEN** foreign keys are ON DELETE CASCADE and
then names **EIGHT** tables: `delivery_reviews`, `msa_agreements`, `onboarding_packages`,
`partner_status_updates`, `partnership_owners`, `partnership_profile_context`,
`payment_milestones`, `project_assignments`. With the two SET NULL keys that is ten total,
which matches, so the count of eight names is probably right and "SEVEN" is the slip - but one
of those eight might not be CASCADE.

```sql
SELECT c.conname, c.conrelid::regclass AS child,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                          WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET NULL'
                          WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f' AND c.confrelid = 'public.partnerships'::regclass
ORDER BY 3, 2;
```

**EXPECTED:** ten rows, eight CASCADE and two SET NULL. **Nothing in this run depends on the
answer** - no hard delete was built and none should be - but the number is quoted in a commit
message and in section 2d, and it should be right.

**A CORRECTION TO THE PREVIOUS REPORT WHILE THIS IS OPEN.** `docs/silent-failures-report.md`
lists `partner_rfp_responses` as carrying `partnership_id`. **It does not.** That table links
to `partner_rfp_inbox` through `inbox_item_id` (`app/api/partner/rfps/[id]/response/route.ts:315-320`)
and has no `partnership_id` column, which is why the brief's ten-key list correctly omits it.
The vendor's bids are protected by the SET NULL on `partner_rfp_inbox`, not by a key of their
own. The brief's list is right and the previous report's is not.

---

## 7. WHAT I COULD NOT ESTABLISH

1. **How many partnerships sit at `'removed'`, and how many of those were active relationships.**
   `Q1`. **This is the most load-bearing unknown in the report** and the only one that describes
   live user harm rather than a code property.
2. **Whether `public.partnerships` still has no DELETE policy.** Read from migration files only.
   `Q2`.
3. **Whether `partnerships.status` carries a CHECK constraint.** `Q3`. Not needed by this run;
   needed by the next.
4. **Which eight of the ten foreign keys are CASCADE.** `Q4`. Taken from the brief as given and
   not verified.
5. **Whether the 182/154/28 lint baseline is genuinely identical on `main`.** My count matches
   the brief's stated triple exactly, but I did not check out `main` and re-run it.
6. **Whether any surface outside this repository states that removal revokes access** - a help
   centre, onboarding email sent from Resend's dashboard, or sales material. I swept the
   codebase, which is all I can see.

---

## 8. THE LIVE CHECKLIST

**Accounts:** `gmarkant@gmail.com` (the "m a r k a n t" lead agency) and a vendor account.
**Run against a preview deploy of `feat/vendor-removal`, which is NOT pushed** - push the
branch first, or run locally with `pnpm dev`.

**Before starting, run `Q1` (section 6).** If `removed_total` is 0 you will need to create a
removed contact in step 3 to have anything to look at in steps 5 through 8. If it is non-zero,
step 5 shows you rows that already exist and step 6 is the one that matters most.

1. **Sign in as `gmarkant@gmail.com` and open `/agency/pool`.** Write down the three section
   counts (Active vendors, Invited, Discovered), the "Showing N results" line, and the Active
   vendors stat tile. **These are your before-values for step 8.**

2. **Open any vendor's detail panel from the Active vendors column.** Confirm there is **no
   "Remove from Pool" button** at the bottom, only "Close". *(Phase 2. Before this branch a
   greyed-out Remove sat there.)*

3. **In the Discovered column, press "Remove" on a contact.** Read the dialog **before
   confirming**. It must say they stop appearing in your pool, that you cannot send them RFPs,
   and that their record and bid history are kept. **It must NOT say "they will no longer have
   access to your projects" and must NOT say "this action cannot be undone".** *(Phase 1.
   THIS IS THE STEP THAT CONFIRMS THE COPY DESCRIBES WHAT ACTUALLY HAPPENED.)*

4. **Confirm the removal.** The row leaves the Discovered column.

5. **Confirm the removed vendor does NOT appear under "Active vendors".** Scroll the whole
   Active vendors column. The contact you just removed must not be in it, under any badge.
   *(Phase 3, first half of the constraint.)*

6. **Confirm the removed vendor can still be FOUND.** Below the three columns there is now a
   **"Removed contacts"** section with a count. Expand it. **The contact you removed in step 4
   must be listed there**, with its email and the date it was added. If it has a claimed
   account, "View profile" must open its pool profile page. *(Phase 3, second half, and the
   defect this phase exists to fix. Before this branch there was nowhere in the product to see
   this row.)*

7. **Reload the page.** The Removed contacts section must still list the same contact with the
   same count. *(Confirms the archive is read from the database and not from local state.)*

8. **CONFIRM EVERY SECTION COUNT AGREES WITH THE LIST BENEATH IT.** For each of the four
   sections - Active vendors, Invited, Discovered, Removed contacts - **count the rows by hand
   and compare to the number in its header.** Then compare the three original counts and the
   "Showing N results" line to what you wrote down in step 1: **the only one that may have
   changed is Discovered, down by one.** The Active vendors count, the Invited count, the
   Active vendors stat tile and "Showing N results" must all be **exactly** what they were.
   *(Phase 3d. A header contradicting its own body has been a real defect here twice.)*

9. **Type a search query that matches nothing** (for example `zzzzzz`). The three column counts
   must go to 0 and their lists must be empty. **The Removed contacts count and its list must
   not change** - the archive is deliberately outside the search. Confirm the header still
   equals the number of rows beneath it. Clear the search.

10. **Sign in as the VENDOR account and open `/partner/network`.** If that vendor has a
    partnership any agency has set to `'removed'`, it must appear in **neither** the active
    partnerships list **nor** the pending invitations list. **A removed agency must never show
    up asking the vendor to respond to an invitation.** *(Phase 3's `isPendingPoolColumn` fix.
    This is the regression the phase would have shipped if the column change had been made
    alone.)*

11. **Still as the vendor, open `/partner/projects`.** Any project awarded to them is still
    listed and still opens. *(Confirms section 1b item 8: removal revokes nothing. This step
    is expected to SUCCEED, and its succeeding is the finding.)*

12. **Sign back in as the agency and open the dashboard at `/agency`.** The pending-invitations
    figure must not have changed as a result of step 4. *(Phase 3's `isPendingPoolColumn` fix on
    `app/agency/page.tsx`.)*
