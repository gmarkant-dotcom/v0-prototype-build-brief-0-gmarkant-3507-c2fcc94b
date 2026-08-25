# Notifications and reminders: design

**Status: DESIGN ONLY. Nothing in this document has been built.** No table, no route, no
component, no migration, no placeholder. Every path named below is either something that
already exists and was read, or something that would have to be written.

Greg's ask, 2026-08-21: reminders to take action, "sort of a reflection of the dashboard",
user-toggleable, with high-priority items also going by email.

Written 2026-08-25 from source. Where a fact could only be settled against the live database,
the query is given and is **not** run.

---

## Rulings Greg owes before anything is built

| # | Decision | Why it blocks | Recommendation |
|---|----------|---------------|----------------|
| R1 | **Computed on read, or written as rows?** | Decides whether reminders can be marked read, deduplicated across a digest, or counted in a badge. Everything else follows from it. | **Written rows.** The table already exists and is already being written. See §C. |
| R2 | **Is a scheduler in scope?** | There is **no cron of any kind in this project**. `vercel.json` declares only a `maxDuration` override. A reminder that fires "three days before a deadline" cannot exist without one. | Yes, one Vercel cron. Without it there are no reminders, only an inbox. |
| R3 | **What counts as high priority?** | Governs who gets email and how often. Proposal in §E, not a decision. | Ship the inbox first with no email at all, then add email for one class. |
| R4 | **Vendors too, or lead agencies only?** | Doubles the surface and the copy. §F. | Both, and the cost of doing so is low. See §F. |
| R5 | **Fix the `notifications` INSERT policy for colleagues?** | The "every member of the organization" ruling is currently **defeated at the RLS layer**: a colleague's row is refused. §B3. This is a live defect that reminders would inherit and multiply. | Fix before building anything on top. |
| R6 | **Is the absent `notifications` DDL reconstructed?** | The table exists live and has **no `CREATE TABLE` anywhere in the repo**. Anything built on it is unreproducible from source. §B1. | Reconstruct it as a numbered migration after running the query in §B1. |
| R7 | **Extract the attention set from the dashboard route?** | Reminders must read the same computation, and today it cannot be called from outside. §A. | Yes. It is the precondition for "one source per number". |
| R8 | **Does a reminder ever repeat?** | "Bids awaiting review" is true every day until acted on. Reminding daily forever is how people mute a product. | Escalating intervals, not a daily repeat. |

---

## A. Where the attention set is computed, and whether it can be called from outside

### It is computed inline inside one route handler

`app/api/agency/dashboard/route.ts`, inside `export async function GET()` (line 113), in the
block headed `── Attention queue ──` at **line 446**. It runs to roughly line 490 and produces
four arrays plus a flag, returned at line 844:

```
attention: {
  bidsAwaitingReview,          // responses with status 'submitted', grouped by project
  rfpsClosingSoon,             // open RFP groups with a deadline inside RFP_CLOSING_WINDOW_DAYS
  pendingDeliveryEvaluations,  // completed assignments with no delivery review
  alerts,                      // unresolved vendor status updates, grouped by project
  isBrandNew,                  // projects.length === 0 && partnerships.length === 0
}
```

The vendor side has its own equivalent, rendered as "Needs your response" at
`app/partner/page.tsx:503`.

### It cannot be called from outside as-is. Not "awkwardly" - not at all.

It is not a function. It is a run of `const` statements in the body of a Next.js route
handler, closing over at least nine locals built earlier in the same handler: `responses`,
`inboxById`, `projectById`, `openRfpGroups`, `completedAssignmentIds`,
`reviewedAssignmentIds`, `alertsByProject`'s sources, `projects` and `partnerships`. There is
no export, no parameter list, and no way to reach it other than an authenticated HTTP GET
that also computes the funnel, the checklist, the activity feed and the project list.

**The consequence for R7.** A cron job cannot make that request: `GET()` derives the caller
from the session, and a scheduled job has no session and no single user to be. It could not
even loop over accounts, because the route answers for exactly one caller.

So a reminder builder has two options and only one of them is acceptable:

1. **Re-derive "needs attention" in the reminder job.** Cheap to start, and it is the exact
   thing Greg's brief rules out: two definitions of the same number that will drift, and the
   dashboard and the reminder email will one day disagree about how many bids are waiting.
2. **Extract the block into `lib/agency-attention.ts`** as
   `computeAttention(orgIds, client)`, returning the same four arrays. The dashboard route
   calls it and returns the result unchanged; the reminder job calls it per organization on
   the service role. One definition, two callers.

Option 2 is the precondition for everything below. It is a mechanical extraction, but not a
trivial one - the block currently reuses data the handler fetched for the funnel and the
activity feed, so the extraction has to either take those as parameters or re-query them, and
re-querying makes the dashboard measurably more expensive. **Take them as parameters.**

---

## B. What the `notifications` table actually looks like live

### B1. There is still no DDL on disk. The Aug 13 discovery stands.

`grep` for a `CREATE TABLE` naming `notifications` across `supabase/migrations/` and
`scripts/` returns **nothing**. The table exists - it is inserted into from 16 call sites and
read by `app/api/notifications/route.ts` - but its shape is only inferable from the code that
touches it, and inference is not a schema.

**Inferred columns**, from `lib/notifications.ts:198` (the insert) and
`app/api/notifications/route.ts` (the read, the ordering and the update):

| Column | Evidence |
|--------|----------|
| `id` | `.in('id', notificationIds)` in the PATCH |
| `user_id` | insert; `.eq('user_id', user.id)` in both GET and PATCH |
| `type` | insert; constrained in TypeScript only, see below |
| `title` | insert |
| `message` | insert, optional |
| `link` | insert, optional |
| `data` | insert, defaults to `{}` - almost certainly jsonb |
| `read` | `.eq('read', false)`, `.update({ read: true })` - boolean |
| `created_at` | `.order('created_at', { ascending: false })` |

`NotificationType` (`lib/notifications.ts:249`) is a **TypeScript union of eleven strings** and
nothing establishes that the database agrees. Whether there is a CHECK constraint or an enum
behind it is unknown, and it matters: a reminder would add new type values, and if a
constraint exists it must be widened in a migration first or every insert fails at runtime.

**The query that settles it. Not run.**

```sql
-- Shape, defaults and nullability.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notifications'
ORDER BY ordinal_position;

-- Constraints, including any CHECK on `type`, and the indexes.
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND rel.relname = 'notifications';

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'notifications';

-- Is `type` an enum rather than text?
SELECT t.typname, e.enumlabel
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
ORDER BY t.typname, e.enumsortorder;

-- How much is in there, and is anything actually being read?
SELECT count(*) AS total,
       count(*) FILTER (WHERE read) AS read_rows,
       count(*) FILTER (WHERE NOT read) AS unread_rows,
       min(created_at) AS oldest, max(created_at) AS newest
FROM public.notifications;

SELECT type, count(*) FROM public.notifications GROUP BY type ORDER BY count(*) DESC;
```

### B2. The policies are known, from the live snapshot

`docs/schema-snapshot-2026-08-13.md:89-95`, which is a `pg_policies` dump and is authoritative
in a way the migrations are not:

```
SELECT  "Users can view own notifications"    USING (user_id = auth.uid())
UPDATE  "Users can update own notifications"  USING (user_id = auth.uid())
INSERT  "Scoped insert notifications"         WITH CHECK (
          user_id = auth.uid()
          OR EXISTS (partnerships p WHERE p.agency_id  = auth.uid()
                       AND p.partner_id = notifications.user_id AND p.status = 'active')
          OR EXISTS (partnerships p WHERE p.partner_id = auth.uid()
                       AND p.agency_id  = notifications.user_id AND p.status = 'active'))
```

Read and update are strictly self-row. **That is the good news for a reminder inbox**: a
reminder addressed to you is invisible to everyone else by construction, with no new policy
needed.

**A caveat that must be checked, not assumed.** That INSERT policy compares `auth.uid()` to
`partnerships.agency_id` and `partnerships.partner_id`. Those are the pre-079 user-id
semantics. If 079 repointed those columns to organizations, this policy is now comparing a
user id to an organization id and is correct only for the sixteen backfilled accounts where
the two coincide - the same class of defect 093 was written to close on the claim policy. The
snapshot predates several of these migrations, so:

```sql
-- Does the live policy still read agency_id/partner_id, and do those columns still hold
-- user ids? Run both before trusting the INSERT path.
SELECT polname, pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy WHERE polrelid = 'public.notifications'::regclass;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='partnerships'
  AND column_name IN ('agency_id','partner_id','lead_org_id','vendor_org_id');
```

### B3. The "every member" ruling is currently defeated for colleagues

`lib/notifications.ts` opens with a ruling: an in-app notification goes to **every member of
the organization**. The INSERT policy above cannot express that. A colleague in your own
organization is neither `auth.uid()` nor an active partnership counterparty, so their row
fails `WITH CHECK`.

The code already knows. `createOrgNotification` (line 181) inserts the batch, and on failure
retries **one row at a time** so that a refused colleague does not roll back your own row,
then logs `"org notification delivered to some recipients, refused for others"`. The comment
at line 202 states the reasoning exactly.

So today, in production, with `COLLEAGUE_INVITATIONS` live: **an agency's colleague is not
being notified of anything in-app, and the only evidence is a warning line in the Vercel
logs.** This is R5, and it is not a reminders problem - reminders would simply inherit it and
write far more refused rows. It should be settled first.

### B4. Nothing reads the inbox. There is no bell.

`grep` for `api/notifications` across `app/`, `components/`, `hooks/` and `contexts/`,
excluding the route itself, returns **no caller**. Sixteen write sites, a working GET with an
unread count, a working PATCH with mark-all-read, and **no user interface anywhere**.

This is the single most useful fact in this document. The written-rows infrastructure Greg
would need for reminders is already built and already running; what is missing is the screen.
It also means the read/unread state currently has no way of ever becoming `true`, so whatever
is in that table is entirely unread - which the count query in §B1 will confirm.

---

## C. The decision that shapes everything else: computed on read, or written as rows

### Computed on read

The reminder is derived at the moment somebody looks, from the same query the dashboard runs.

- **Cost to build:** low, given R7. One extraction, one component, no migration, no scheduler.
- **Cost to run:** one attention query per page view. Already paid on the dashboard.
- **Always accurate.** A bid reviewed thirty seconds ago is gone from the list. Nothing can go
  stale, because nothing is stored.
- **Cannot be marked read.** "Needs attention" is a property of the world, not of a message.
  There is no row to flip.
- **Cannot be deduplicated across a digest.** To avoid emailing about the same bid twice, the
  job must remember what it sent. The moment it remembers, it is writing rows, and this is the
  other model wearing a hat.
- **Cannot be counted in a persistent badge**, cannot be linked to, cannot be dismissed, and
  cannot answer "what changed since I last looked".

### Written as rows

A row is inserted when the condition becomes true, and lives until read or superseded.

- **Cost to build:** higher, but **most of it is already paid.** The table exists, the insert
  helper exists, the fan-out exists, the read route exists, the mark-read route exists. What
  is missing is the screen (§B4), the scheduler (R2), and the RLS fix (R5).
- **Cost to run:** one cron invocation per interval plus the rows. Rows are small and prunable.
- **Can go stale**, and this is the real cost. A reminder saying "3 bids awaiting review" is
  wrong the moment two are reviewed. Two ways out, and they are not equivalent:
  - **Store the reference, not the count.** The row says "bids are awaiting review on Q3 Brand
    Campaign" and links to `/agency/bids`; the count is rendered live from the attention set
    at read time. Stale text becomes impossible because there is no count in the text.
  - Re-run a reconciliation job that deletes rows whose condition no longer holds. More
    machinery, more to go wrong.
- **Can be marked read, deduplicated, badged, linked and dismissed.** All four of the things
  the computed model cannot do.

### Recommendation

**Written rows, storing references rather than counts.** Not because it is the better model in
the abstract, but because in this codebase the computed model has to grow into it the moment
anyone asks for email deduplication, and because the written-row infrastructure is already
here and already executing - it is simply invisible.

**But build in this order**, which matters more than the choice:

1. **R5.** Fix the colleague INSERT refusal. Everything else writes more of the rows that are
   currently being refused.
2. **R6.** Reconstruct the DDL as a migration, after running §B1.
3. **The bell.** Surface `/api/notifications`, which already works, in both layouts. This
   ships value with **no new table, no cron and no migration**, and it makes the sixteen
   existing write sites visible for the first time.
4. **R7.** Extract the attention set.
5. **Only then** the scheduler and reminders.

Steps 1 to 3 are worth doing whatever Greg rules on R1.

---

## D. The mail helpers, and whether a digest path exists

### The helpers

`lib/email.ts`. Every email in the product goes through these, always inside try/catch, per
CLAUDE.md:

- `sendTransactionalEmail()` (line 95) - the Resend call.
- `buildBrandedEmailHtml()` / `buildBrandedEmailText()` (lines 20, 75) - the shell. A reminder
  email must use these and needs no new template type.
- `siteBaseUrl()` (line 127) - every link.
- `resolveOrgNotificationRecipients()` (line 390) - **the piece a digest needs most.** It fans
  an organization out to its member recipients over `org_members`, and it **already reads the
  opt-out**: line 449 skips a recipient whose `notification_preferences.email === false`.

### There is no digest path. This corrects the premise.

There is **no scheduled email of any kind**, and no scheduler to run one on: `vercel.json`
contains a single `maxDuration` override and **no `crons` array**. A grep for cron, daily,
weekly or digest across `app/api/` and `lib/` returns only unrelated hits (`createHash(...)
.digest('hex')`, and a `"digest"` string in a newsletter-detection word list).

What was confirmed working on Aug 13 is **per-broadcast batching**, not a digest.
`app/api/agency/broadcast-rfp/route.ts:600-660` groups the notifications of **one broadcast**
by recipient email and sends one message per recipient: subject
`"<Agency> has sent you N RFPs on Ligament"`, heading `"New RFPs in your vendor inbox"`, with
the scope items listed. It is one request fanning out to one email per person, not a
time-based collection of separate events.

**What that means for R2.** The grouping logic is a good model to copy - it is the right
shape - but every piece of scheduling is missing. A digest needs a Vercel cron entry, a route
protected by a shared secret (the `WEBHOOK_SECRET` pattern at `/api/admin/notify-new-user`,
P16, is the precedent), and a `last_digest_sent_at` marker per recipient so a redelivery or a
double firing does not send twice.

---

## E. What "high priority" would have to mean

**A proposal for Greg to rule, not a decision.** The principle: an item is high priority when
**doing nothing has a cost that cannot be undone later**. That is a deadline test, not an
importance test, and it is the only version that stays stable as the product grows.

| Attention item | Proposed | Reasoning |
|---|---|---|
| `rfpsClosingSoon` | **High** | The only one with a hard, external deadline. Once it passes, the RFP closes with whatever bids arrived. Nothing recovers that. |
| `alerts` (unresolved vendor status updates) | **High** | A vendor is blocked and waiting on the agency. The cost is somebody else's time, accruing now. |
| `bidsAwaitingReview` | Normal | Real work, no cliff. Reviewing on Thursday instead of Tuesday costs little. |
| `pendingDeliveryEvaluations` | Normal | Retrospective by definition. It can be done any time. |
| `isBrandNew` / checklist | **Never email** | Onboarding nudges to somebody who just signed up is the fastest route to a mute. |

Consequences to rule on with it:

- **Email is opt-out, not opt-in**, matching `resolveOrgNotificationRecipients()`, which treats
  anything other than `email === false` as consent (`lib/email.ts:370`).
- **One email per person per day, maximum**, containing every high-priority item. Not one per
  item.
- **Never email about something already seen.** Requires the marker in §D and is a reason for
  written rows.
- **R8: an unresolved item must not email daily forever.** Suggest day 1, day 3, day 7, then
  in-app only. A reminder that arrives every morning becomes a filter rule.

---

## F. Vendors too, or lead agencies only

**Recommendation: both, in the same build.** The reasons are structural rather than a matter
of fairness.

1. **Every piece of shared machinery is already portal-neutral.** `notifications` policies are
   `user_id = auth.uid()` with no role test. `/api/notifications` never reads a role.
   `createOrgNotification` fans out over `org_members`, which does not know what a portal is.
   The eleven existing `NotificationType` values already cover both directions - a vendor is
   the recipient of `project_awarded`, an agency of `bid_submitted`. **Building this for one
   portal would mean adding a role filter that does not currently exist.**
2. **The vendor already has an attention set** - "Needs your response" at
   `app/partner/page.tsx:503` - so R7 is one extraction per portal, not one plus a new feature.
3. **The vendor case is arguably stronger.** An agency lives in the product; a vendor visits
   when something needs them. A vendor's `rfpsClosingSoon` equivalent is a deadline they lose
   money by missing.
4. **The entitlement question does not arise.** Vendor access is free by the pricing copy and
   `PaidUserContext` short-circuits vendors to `vendor-free` before any entitlement read
   (`contexts/paid-user-context.tsx`), so nothing here needs an is_paid check.

**One thing that genuinely differs and must not be copied across:** the vendor portal is a
light theme with its own tokens (`vendor-surface`, `vendor-border`, `vendor-muted-strong`) and
a horizontal top nav with no room for a bell in the same place as the agency sidebar. That is
a placement question, not an architecture one.

---

## G. What was read to write this

Every claim above came from one of these. Nothing here was inferred from a document.

| Source | Established |
|---|---|
| `app/api/agency/dashboard/route.ts:113,446,844` | The attention set, its contents, and that it is inline in a session-scoped GET |
| `app/partner/page.tsx:503` | The vendor equivalent exists |
| `lib/notifications.ts:181,198,202,249` | The insert, the per-row retry, the union of eleven types, the "every member" ruling |
| `app/api/notifications/route.ts` | A working GET with unread count and a working PATCH with mark-all-read |
| grep for `api/notifications` across `app/`, `components/`, `hooks/`, `contexts/` | **No consumer. No bell.** |
| grep for `CREATE TABLE ... notifications` across `supabase/migrations/`, `scripts/` | **No DDL on disk** |
| `docs/schema-snapshot-2026-08-13.md:89-95` | The three live policies |
| `lib/email.ts:95,127,331,390,449` | The helpers, and that the email opt-out is already read |
| `app/agency/settings/user/page.tsx:55,79,98` and the partner twin | `notification_preferences` **is** read and written today, by both settings pages |
| `scripts/017-profiles-extended-fields.sql:11` | The column's origin: `ADD COLUMN IF NOT EXISTS notification_preferences JSONB` |
| `app/api/agency/broadcast-rfp/route.ts:600-660` | Per-broadcast batching, which is what the "digest" actually is |
| `vercel.json` | **No `crons` array.** No scheduler exists |

### On `notification_preferences` specifically, since the brief asked

**It is not dormant.** Three live readers and two live writers:

- `app/agency/settings/user/page.tsx` selects it (line 55), reads it into local state (79) and
  writes it back on save (98).
- `app/partner/settings/user/page.tsx` does the same at lines 54, 77 and 96.
- `lib/email.ts:425,441,449` selects it during recipient resolution and **treats
  `email === false` as an opt-out**, skipping that recipient.

So the user-toggleable half of Greg's ask **already has storage, already has a settings UI in
both portals, and is already honoured on the email path.** A reminder system should extend that
jsonb with named keys rather than introduce a second preferences mechanism.

Its shape is not constrained anywhere - it is nullable jsonb with no default
(`scripts/017-profiles-extended-fields.sql:11`) - so a reader must treat a missing key as the
default rather than as `false`, which is what `lib/email.ts:449` already does by testing for
`=== false` explicitly instead of for falsiness.
