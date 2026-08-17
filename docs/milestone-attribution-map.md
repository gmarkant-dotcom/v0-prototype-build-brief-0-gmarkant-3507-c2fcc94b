# Milestone attribution map

**What would have to emit "who did this", where that code lives today, and whether anything
in the product can currently carry it.**

Written 2026-08-17, M1 pre-work. Discovery only. **No emission site was built in this run.**

Greg's ruling this maps: attribution belongs in M1, scoped to milestones rather than
row-level `created_by` on every table. Who sent the RFP to vendors, who reviewed and awarded
bids, who gave feedback. Visible to every member of the same company. The actor is named to
the vendor too, but contact details stay tier-scoped - only the named engagement contact's
email and preferred channel are shared, so a vendor cannot harvest a whole team's contacts.

---

## 1. Build nothing first: what actually backs "Recent Activity"

**It is derived. There is no events table, no activity table, and no actor anywhere.**

The dashboard feed that renders lines like *"April Partner Test Agency viewed the RFP for
Audience Strategy"* is built in memory, per request, in
`app/api/agency/dashboard/route.ts:369-418`. Its own comment says so:

> `// ── Activity feed - union of timestamped events from existing tables, no events`
> `// table involved. Newest first, capped at RECENT_ACTIVITY_LIMIT.`

### What it unions

| Source row | Timestamp column | Rendered as |
|---|---|---|
| `projects` | `created_at` | "Created project {name}" |
| `partner_rfp_responses` | `submitted_at` | "{partner} submitted a bid on {scope}" |
| `partner_rfp_inbox` | `viewed_at` | "{vendor} viewed the RFP for {scope}" |
| `onboarding_packages` | `partner_reviewed_at` | "{partner} acknowledged onboarding for {project}" |

Four columns. Sorted descending, sliced to `RECENT_ACTIVITY_LIMIT = 15`
(`app/api/agency/dashboard/route.ts:13`).

The partner-side feed in `app/api/partner/dashboard/route.ts:300-393` is the same shape
against a different set of columns: `partner_rfp_responses.shortlisted_at`,
`.meeting_requested_at`, `.declined_at`, `project_assignments.awarded_at`,
`payment_milestones.paid_at`, `partner_status_updates.created_at`.

### Answering the four questions asked

| Question | Answer |
|---|---|
| Table or derived? | **Derived.** Computed per request, never persisted. Nothing to query, nothing to page, nothing to retain. |
| What does it store? | **Nothing.** The union exists for the duration of one HTTP response. |
| Does it have an actor? | **No.** Every line's subject is the *counterparty* - the vendor who viewed, the vendor who bid. There is no column anywhere in that union naming which person on the agency side did anything. `projects.created_at` has no `created_by` beside it; `agency_id` names the company, which today is one person. |
| Is it company-scoped? | **Accidentally, yes.** Every query in the route filters `.eq("agency_id", agencyId)` where `agencyId = user.id` (`app/api/agency/dashboard/route.ts:74`). That is user-scoping that looks like company-scoping only because one user is currently one company. At 079 it becomes real company scoping for free, because `agency_id` becomes the organization key. |
| Can it carry agency-side events? | **No, and this is the finding.** Every event it can express is one a *counterparty* performed. There is no timestamp column anywhere that records an agency-side action by a person - "Alex sent the RFP", "Priya awarded the bid", "Sam gave feedback" have nowhere to live. Adding an actor column to the four source tables would not fix it either: those columns record when a *vendor* acted. |

### The other candidate mechanism, and why it is not one

`notifications` is a real table with live RLS. It is not an event log:

- **Per recipient, not per event.** `user_id` is the person being notified
  (`lib/notifications.ts:36`). One event that should be visible to three colleagues would
  need three rows, and there is no event identity tying them together.
- **No actor column.** The actor is prose inside `title`/`message`
  (`"${agencyName} has invited you..."`). Not queryable, not linkable, not translatable.
- **Nothing reads it.** `app/api/notifications/route.ts` opens with a TODO recording that
  its GET and PATCH have zero callers anywhere in the codebase. The write side is live from
  `app/api/partnerships/route.ts` and `app/api/projects/[id]/onboarding-packages/route.ts`,
  so the table is being populated and never read.
- **Its INSERT policy is partnership-scoped, not company-scoped.** From the authoritative
  snapshot: `user_id = auth.uid() OR EXISTS (partnerships where agency_id = auth.uid() AND
  partner_id = notifications.user_id AND status = 'active') OR` the mirror of that. A
  colleague is not a partnership, so a colleague cannot be notified at all.

**Conclusion: neither mechanism can carry milestone attribution. This needs a table.** The
proposed shape is section 5.

---

## 2. Agency-side milestones

`(V)` marks an event the vendor in that partnership also sees.

**"Carrier"** answers: can the derived feed express this today?
- **derived** - the feed already shows it, from an existing timestamp column
- **column only** - a timestamp exists, but no actor, and no feed line
- **nothing** - no persisted trace of the event at all

### Vendor pool

| Milestone | Emitting code site | (V) | Carrier |
|---|---|---|---|
| Vendor added (with source) | `app/api/agency/pool/add-partner/route.ts` (manual), `app/api/agency/pool/import-spreadsheet/route.ts` (spreadsheet), `app/api/agency/rfp/magic-link/route.ts` (auto-add from guest bid), `app/api/agency/email-scan/import/route.ts` (mailbox scan) | | nothing - four distinct entry points, no column records which one |
| Invitation sent | `app/api/partnerships/route.ts` POST, writes `partnerships.invitation_sent_at` | ✔ | column only |
| Invitation resent | `app/api/agency/pool/resend-invitation/route.ts` - rewrites the same `invitation_sent_at` | ✔ | **overwritten.** The resend destroys the original send time. No count, no history |
| Invitation accepted or declined | `app/api/partner/partnerships/claim/route.ts`, `app/auth/callback/route.ts` `claimPartnershipInvitations()` | ✔ | column only (`partnerships.status`, `profile_status`) - no timestamp at all |
| NDA confirmed | `app/api/partner/rfps/[id]/nda-notify/route.ts`, writes `partner_rfp_inbox.nda_confirmed_at` | ✔ | column only |
| MSA confirmed | `app/api/agency/msa/route.ts`, writes `partnerships.msa_confirmed_at` / `msa_confirmed_by` | ✔ | column only - **`msa_confirmed_by` already exists (migration 051) and is the one actor column in the whole product** |
| Vendor removed or blacklisted | `app/api/agency/pool/[partnerId]/route.ts` (status), `app/api/agency/pool/[partnerId]/notes/route.ts` (`{blacklisted}` inside the `partnership_notes` jsonb) | | nothing - irreversible-in-effect, invisible in history |
| Vouch given | **`app/agency/pool/[partnerId]/page.tsx:255-260`** - a browser-side insert/delete straight into `partner_vouches`, no API route | | nothing - see section 4 |

### Client and project

| Milestone | Emitting code site | (V) | Carrier |
|---|---|---|---|
| Client profile created | `app/api/agency/clients/route.ts` POST | | nothing |
| Client profile edited | `app/api/agency/clients/[id]/route.ts` PATCH | | nothing |
| Client documents added or removed | `app/api/agency/library-documents/route.ts`, `app/api/agency/library-documents/[id]/route.ts` | | nothing |
| Project created | `app/api/projects/route.ts` POST | | **derived** - the one agency-side line the feed already shows, and it names no person |
| Project client changed | `app/api/projects/[id]/route.ts` PATCH, the `'client_id' in body` branch at line 78 | | nothing |

### RFP

| Milestone | Emitting code site | (V) | Carrier |
|---|---|---|---|
| Client brief uploaded | `app/api/upload/route.ts` (folder `agency-library`) then `app/api/brief/save/route.ts` | | nothing |
| Master RFP generated | `app/api/ai/master-brief/route.ts` | | nothing - but `usage_tracking.ai_analyses_count` increments, so the *count* is company-scoped while the *actor* is lost |
| Master RFP regenerated | same route, called again | | nothing - indistinguishable from the first generation |
| Scope allocated | client-side wizard state in `app/agency/page.tsx`, persisted into the `partner_rfp_inbox` rows written by `app/api/agency/broadcast-rfp/route.ts:419` | | nothing |
| RFP broadcast sent, with recipients | `app/api/agency/broadcast-rfp/route.ts:419` inserts one `partner_rfp_inbox` row per recipient | ✔ | column only (`created_at` per row) |
| Magic link or guest invitation sent | `app/api/agency/rfp/magic-link/route.ts:161` inserts `rfp_magic_tokens` | ✔ | column only |
| Response deadline set or changed | `partner_rfp_inbox.response_deadline` (migration 041), `rfp_magic_tokens.response_deadline` (074) | ✔ | **overwritten** - a changed deadline leaves no trace of the old one, and the vendor is the party most affected by that |

### Bids

| Milestone | Emitting code site | (V) | Carrier |
|---|---|---|---|
| Bid received | `app/api/partner/rfps/[id]/response/route.ts` (portal), `app/api/rfp/guest/[token]/route.ts` (guest) | ✔ | **derived** |
| AI analysis run | `app/api/agency/bids/[responseId]/ai-score/route.ts`, `.../decompose/route.ts`, `.../generate-summary/route.ts`, `app/api/agency/bids/compare/route.ts` | | nothing - `ai_summary_generated_at` records when, never who |
| AI analysis retried | same four routes, called again | | nothing - a retry overwrites the previous result and its timestamp |
| Bid scored or evaluated | `app/api/agency/bids/[responseId]/evaluation/route.ts`, `app/api/agency/bids/rank/route.ts` | | nothing - `bid_evaluations.agency_id` names the company, not the scorer |
| Shortlisted | `app/api/agency/rfp-responses/[id]/route.ts:103` sets `shortlisted_at` | ✔ | column only, **and the vendor feed already renders it** |
| Meeting requested | same route, line 106, sets `meeting_requested_at` | ✔ | column only, rendered vendor-side |
| Awarded | same route (`awarded_at`), `app/api/projects/[id]/assignments/route.ts` | ✔ | column only, rendered vendor-side |
| Declined with reason | same route, line 109 sets `declined_at`, reason composed into `agency_feedback` | ✔ | column only, rendered vendor-side |
| Feedback provided | same route, `agency_feedback` + `feedback_updated_at` (lines 94-98) | ✔ | column only - **the single clearest case for attribution: the vendor is reading a human judgement signed by nobody** |

### Onboarding and delivery

| Milestone | Emitting code site | (V) | Carrier |
|---|---|---|---|
| Onboarding package sent | `app/api/projects/[id]/onboarding-packages/route.ts` | ✔ | column only |
| Kickoff scheduled | `app/api/projects/[id]/onboarding/deploy/route.ts` | ✔ | column only |
| Delivery review completed | `app/api/agency/delivery-reviews/route.ts` (`status = 'complete'`) | | column only - and the vendor may read the completed review (`delivery_reviews` partner SELECT policy), so an unsigned score reaches them |
| Status update resolved | `app/api/agency/projects/[projectId]/status-updates/route.ts` | ✔ | nothing - resolution is a state flip with no timestamp |

### Money

| Milestone | Emitting code site | (V) | Carrier |
|---|---|---|---|
| MSA record started | `app/api/agency/msa/route.ts` | | column only |
| Milestones set | `app/api/agency/msa/milestones/route.ts` | | nothing |
| Payment marked paid | `app/api/agency/msa/milestones/route.ts`, sets `payment_milestones.paid_at` | ✔ | **derived** vendor-side ("Payment received for {title}") |

---

## 3. Vendor-side milestones

Under the ruled model a vendor company is also an organization with members, so *"which
person at the vendor submitted this"* is the exact mirror of the agency requirement, and it
is the harder half: the agency is the party that has to trust the answer.

`(A)` marks an event the lead agency in that partnership also sees. All of these are (A) -
that is the point of them.

| Vendor milestone | Emitting code site | Carrier | Note |
|---|---|---|---|
| Bid submitted (A) | `app/api/partner/rfps/[id]/response/route.ts`, `app/api/rfp/guest/[token]/route.ts` | **derived** - agency feed shows *"{partner} submitted a bid on {scope}"* | The name rendered is `partner_rfp_responses.partner_display_name`, a **company** name. Which person authored the bid is not recorded |
| RFP viewed (A) | `app/api/partner/rfps/[id]/route.ts`, sets `partner_rfp_inbox.viewed_at` | **derived** - agency feed shows *"{vendor} viewed the RFP"* | `viewed_at` is a single nullable column: it records the first view and nothing else. Two colleagues both reading it is one row |
| Invitation accepted (A) | `app/api/partner/partnerships/claim/route.ts` | column only | The claim is by **email match**, so the acceptor is by construction the one mailbox owner. Under the org model an invited colleague could accept, and the mechanism has no way to say which |
| NDA acknowledged (A) | `app/api/partner/rfps/[id]/nda-notify/route.ts` | column only (`nda_confirmed_at`) | A legal acknowledgement with no signatory recorded. The strongest attribution case on the vendor side |
| Status update posted (A) | `app/api/partner/projects/[projectId]/status-update/route.ts` | **derived** vendor-side only | `partner_status_updates` has no author column; the agency sees the company, not the person |
| Bid revised (A) | `app/api/partner/rfps/[id]/response/route.ts` (re-submit path), `partner_rfp_response_versions` | column only | Versions exist. Who authored each version does not |
| Profile published / made discoverable (A) | `app/api/profile/route.ts`, `app/api/marketplace/discoverable/route.ts` | nothing | Changes what every agency in the marketplace sees |
| Payment terms requested (A) | `partnerships.payment_terms_requests` jsonb (migration 052) | nothing | A negotiation position with no negotiator named |

**One structural warning for 079.** Three of these arrive through the **guest / magic-link
path**, where there is no authenticated user at all: `app/api/rfp/guest/[token]/route.ts`
and `app/api/rfp/guest/upload/route.ts` identify the actor only by the email the token was
issued to. Any actor column has to be nullable with an email fallback, and the map must not
pretend a guest bid has a member id. Do not model `actor_id` as `NOT NULL`.

---

## 4. Vouching, the special case

**Ruled shape:** the voucher is visible to colleagues inside the same company, and anonymous
to everyone outside.

### What exists now

Table (`supabase/migrations/053_create_partner_vouches.sql`):

```
partner_vouches(id, voucher_agency_id, vouched_partner_id, created_at,
                unique(voucher_agency_id, vouched_partner_id))
```

Live policies, from the authoritative snapshot (`docs/schema-snapshot-2026-08-13.md:171-173`):

| Policy | cmd | roles | qual / with_check |
|---|---|---|---|
| Anyone can count vouches | SELECT | `{public}` | `qual: true` |
| Agencies can vouch | INSERT | `{public}` | `with_check: auth.uid() = voucher_agency_id` |
| Agencies can remove their vouch | DELETE | `{public}` | `qual: auth.uid() = voucher_agency_id` |

### The problem, stated plainly

**`qual: true` on SELECT means the vouch table is not anonymous today. It is fully public.**

The migration comment says *"Count queries are safe (no identifying info)"*. That is true of
the number and false of the table. The policy grants SELECT on **rows**, not on a count, to
role `public` - which includes `anon`. Any caller with the anon key can
`select voucher_agency_id, vouched_partner_id from partner_vouches` and read the complete
who-vouched-for-whom graph of the platform. The application only ever asks for a count
(`app/api/marketplace/discoverable/route.ts:81`, `app/partner/profile/page.tsx:210`), so the
exposure has never surfaced in the product - but the policy, not the caller, is the
permission. This is the same class of defect as an interface-only gate, and it is live now.

### What has to change

1. **Drop the `qual: true` SELECT policy.** Replace the public count with a security-definer
   function or an aggregated view that returns `count(*)` per `vouched_partner_id` and never
   returns a `voucher_agency_id`. A count is a projection; do not deliver it by granting row
   access and trusting every caller to aggregate.
2. **Add a colleague-scoped SELECT policy** returning rows only where
   `voucher_agency_id` belongs to the caller's own organization, through the membership
   function. That is the "visible to colleagues" half of the ruling, and it is exactly what
   an organization-scoped predicate gives.
3. **Rename `voucher_agency_id` at 079** to the organization key, and add a separate
   `voucher_member_id` - because under the ruled model the company vouches and a person
   presses the button, and colleagues need to know which person.
4. **The vendor is never a reader.** No policy on this table should ever match the vouched
   partner. Anonymity to the subject is the feature.

**Do not put a vouch event on the milestone table.** Its visibility rule is the inverse of
every other event's: colleague-visible, counterparty-invisible. Modelling it as one more
event type means one row whose read rule contradicts the whitelist that governs the rest,
which is precisely the shape that produces an accidental disclosure later. Vouching stays in
`partner_vouches` with its own policies.

---

## 5. If the mechanism is a table: required policy shape

It is a table. Section 1 rules out both alternatives.

### Non-negotiables

1. **Row level security enabled in the same migration that creates the table.** Not a
   follow-up. `docs/schema-truth.md` records that this repo cannot reliably replay its own
   policy history; a table that ships without policies for even one deploy is a table whose
   real policy set nobody can reconstruct.
2. **Organization-scoped through the membership function, deny by default.** No policy
   keyed on `auth.uid()` equalling a column. The predicate is *"the actor's organization is
   one of mine"*, resolved through the membership helper 079 introduces. Every table in the
   product today keys on `agency_id = auth.uid()` and every one of them is in bucket (a) of
   `docs/policy-rewrite-surface.md` for exactly that reason. Do not add a 39th.
3. **The vendor-visible subset is an explicit whitelist of event types.** Never "everything
   not marked private". The difference matters on the day someone adds an event type and
   forgets the flag: a whitelist fails closed and the vendor sees nothing new; a blacklist
   fails open and the vendor sees the agency's internal AI scoring. The `(V)` column in
   section 2 is the initial whitelist and it is a literal set of strings, checked against a
   constant in the policy, not a boolean column an INSERT can set.
4. **The membership predicate is a `SECURITY DEFINER` function with
   `SET search_path = public, pg_temp`.** Migration 078 exists because a SECURITY DEFINER
   function in this codebase shipped without that pin. Do not repeat it.
5. **No UPDATE policy and no DELETE policy for anybody.** A breadcrumb that can be edited is
   not a breadcrumb. INSERT and SELECT only; corrections are new rows.
6. **`actor_id` nullable, with an actor email fallback.** See the guest-path warning in
   section 3.

### Sketch

```sql
-- Shape only. Unnumbered on purpose - this is 079's or later, and nothing in this run
-- authored it as a runnable migration.
CREATE TABLE milestone_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,          -- the company the event belongs to
  actor_org_id  uuid NOT NULL,          -- who performed it (may be the vendor's org)
  actor_id      uuid NULL,              -- NULL for guest/magic-link actors
  actor_email   text NULL,              -- fallback identity for those
  event_type    text NOT NULL,          -- dotted vocabulary, see docs/capabilities.md
  subject_type  text NOT NULL,          -- 'project' | 'partnership' | 'bid' | ...
  subject_id    uuid NOT NULL,
  partnership_id uuid NULL,             -- set when a vendor is a party; drives (V) visibility
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE milestone_events ENABLE ROW LEVEL SECURITY;

-- Members read their own organization's events.
CREATE POLICY "Members read own org events" ON milestone_events
  FOR SELECT TO authenticated
  USING (org_id = ANY (public.current_member_org_ids()));

-- Counterparties read ONLY whitelisted event types, and only on a partnership
-- they are a party to.
CREATE POLICY "Counterparty reads whitelisted events" ON milestone_events
  FOR SELECT TO authenticated
  USING (
    partnership_id IS NOT NULL
    AND event_type = ANY (public.vendor_visible_event_types())
    AND partnership_id IN (SELECT id FROM partnerships
                           WHERE partner_org_id = ANY (public.current_member_org_ids()))
  );

-- Members write events attributed to themselves, inside their own organization.
CREATE POLICY "Members insert own org events" ON milestone_events
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_org_id = ANY (public.current_member_org_ids())
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

-- No UPDATE policy. No DELETE policy. Deliberate.
```

`public.vendor_visible_event_types()` returns the `(V)` set from section 2 as a constant
array. Keeping it in a function rather than a column is what makes it a whitelist.

---

## 6. Contact-detail tiering, which is a separate control

The ruling names the actor to the vendor but keeps contact details tier-scoped: only the
named engagement contact's email and preferred channel are shared, so a vendor cannot
harvest a whole team's contacts.

**That is not enforced by the milestone table and must not be.** The table carries
`actor_id`; it does not carry an email. Resolving `actor_id` to a display name is one
lookup, and resolving it to an email address is a different lookup with a different
permission. The tiering already has a home: the lead agency profile tiering shipped in
commit `0016d33` ("tier the lead agency profile for vendors, server-side").

**The 079 build must route vendor-facing actor rendering through that same tiering, and
return a display name only.** A vendor-facing endpoint that joins `milestone_events` to
`profiles` and selects `email` re-opens the harvest the tiering exists to prevent, one join
at a time.

---

## 7. Where this vocabulary comes from

Every `event_type` string must be the capability name from `docs/capabilities.md` for the
action that produced it. `bid.award` is the permission and `bid.award` is the breadcrumb.
One vocabulary, so that "who may do this" and "who did this" can never drift into two
different spellings of the same idea. `docs/capabilities.md` section "Milestone event
alignment" lists the pairs.

---

## 8. Proposal for Greg: is there a small additive step worth taking now?

The brief permits proposing an additive actor column, migration authored but unnumbered, if
it is genuinely small.

**Recommendation: no. Do not add actor columns now.**

Reasoning:

1. **It would not be small.** Section 2 counts 34 agency-side milestones and section 3
   counts 8 vendor-side ones. They live across 14 tables. "Add an actor column" is 14
   `ALTER TABLE` statements plus a write-site edit in roughly 30 routes, and it delivers
   nothing until something reads it.
2. **Six of the milestones have no row to attach a column to.** Vendor removed, scope
   allocated, milestones set, client documents removed, AI analysis retried, status update
   resolved - these leave no persisted trace at all, so there is no row whose actor column
   could be filled. Any column-based approach covers part of the map and silently omits the
   rest, which is worse than covering none: a partial breadcrumb trail reads as complete.
3. **Two of them are actively destructive.** Invitation resent overwrites
   `invitation_sent_at`; a changed response deadline overwrites the old one. An actor column
   on those rows records who did it *last*, and quietly discards the earlier fact. Only an
   append-only table fixes that, and once there is an append-only table the columns are
   redundant.
4. **Today every actor is the same person.** One user is one company until 079 lands.
   Populating `actor_id` now writes `agency_id` into a second column under a new name, and
   the honest-data doctrine says one source per state.

**One exception worth noting rather than acting on:** `partnerships.msa_confirmed_by` already
exists (migration 051) and is the only actor column in the product. 079 should treat it as
the precedent it is, not delete it, and should emit a matching `msa.confirm` milestone event
beside it so the two agree.

---

## 9. Summary for the 079 run

- Recent Activity is derived from four timestamp columns. It cannot carry attribution and
  extending it is not an option.
- `notifications` is per-recipient, actor-less, and unread by any UI. Not a candidate.
- The mechanism is a new organization-scoped, append-only, RLS-from-day-one table.
- The vendor-visible set is a whitelist of event types held in a function, seeded from the
  `(V)` column of section 2.
- Vouching is not a milestone event. It keeps its own table and needs its live
  `qual: true` public SELECT policy replaced - that is a real exposure today, not a
  refactor.
- Guest and magic-link actors have no user id. `actor_id` is nullable or the guest bid flow
  breaks.
- Event type names are capability names from `docs/capabilities.md`.
