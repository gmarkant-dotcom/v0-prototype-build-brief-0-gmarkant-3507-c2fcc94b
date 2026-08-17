# The rename safety net, capabilities, and attribution

Written 2026-08-17. Four items, four commits, nothing pushed and nothing applied.

---

## When you are back

### What landed

Four commits on `main`, local only. `npx tsc --noEmit` and `pnpm build` both exit 0 at every
one of them.

| Commit | What |
|---|---|
| `fa5c601` | `chore:` two safety-net scripts, wired into `package.json`, deliberately not wired into the build |
| `ccb5ae8` | `feat:` `lib/capabilities.ts`, adopted at five route sites |
| `dbe3fdf` | `feat:` migration 080 authored, `lib/milestone-events.ts`, six milestones emitting |
| `9f24c2a` | `fix:` migrations 081 and 082 authored, two live security exposures |

Nothing renamed. Nothing applied. No write query run. No existing surface changed appearance.
Three migrations were authored and all three are unapplied: **080** (milestone events),
**081** (document and message INSERT scoping), **082** (partner vouches containment).

### What needs a decision

1. **`msa.confirm` vendor visibility.** `docs/capabilities.md` section 5 says the vendor does
   NOT see it. `docs/milestone-attribution-map.md` section 2 marks the same milestone with a
   `(V)`. The two documents disagree. A whitelist has to fail closed, so 080 leaves
   `msa.confirm` out of `vendor_visible_event_types()` and the vendor sees nothing. Adding it
   is one line in migration 080. Your call, and it is easier to make now than after 080 is
   applied.

2. **Whether the capability layer should be swept further before 079, or after.** Five sites
   are adopted. Twelve more are named below and none of them is gated by anything except
   ownership today. Every one of them becomes genuinely open to every colleague on the day
   079 lands. My read: sweep them in one focused run before the rename, not during it.

3. **Migration 082 phase 2 needs a code change shipped first**, and that code change is not
   in this run because item 4 was scoped to authoring migrations. Three read sites have to
   move onto the new RPCs before the exposure can be closed. They are listed by file and line
   in the 082 header and again below. It is maybe thirty lines of work and it has to precede
   the migration, not follow it.

4. **Whether 081 should be applied ahead of the rest.** It closes a hole any authenticated
   account on the platform can walk through today, and unlike 082 it needs no code change and
   no ordering. It is the one thing in this run I would apply this week.

### What needs a click

In this order. Everything here is yours; none of it can be done from this sandbox.

1. **Apply 081.** Fresh `pg_policies` capture first, then the file, then its verification
   queries, then the two browser smoke tests in its header.
2. **Apply 082 phase 1 only.** It creates two functions and changes nothing. Stop at the
   STOP GATE in the middle of the file.
3. **Apply 080**, if you want attribution recording from now rather than from 079. Until it
   is applied the six emitters log a warn line and drop the event, which is by design.
4. Later, once the 082 code change ships: **082 phase 2**.
5. **Re-take the `pg_policies` snapshot** after any of the above and commit it as
   `docs/schema-snapshot-<date>.md`. Split the export by table-name range or count the rows.

Full click-order checklist at the end of this document.

---

# Item 1: the rename safety net

The 079 authoring run established that the TypeScript compiler will not catch the rename. The
Supabase clients are built without generated `Database` types, so `.eq("agency_id", ...)` is
an untyped string and `npx tsc --noEmit` exits 0 either way. The safety net that would make
the rename credible does not exist. Two scripts now stand in for it.

Neither is wired into `pnpm build`. Both fail today by construction, because 079 has not been
applied and every occurrence and every policy they flag is currently correct. A failing guard
must not block a deploy today.

```json
"identity-columns":        "node scripts/check-identity-columns.mjs",
"identity-columns:guard":  "node scripts/check-identity-columns.mjs --guard",
"policy-audit":            "node scripts/audit-policy-snapshot.mjs",
"policy-audit:guard":      "node scripts/audit-policy-snapshot.mjs --guard"
```

## 1a. `scripts/check-identity-columns.mjs`

Walks `app/`, `lib/`, `components/`, `contexts/`, `hooks/` and `middleware.ts`, matches
`agency_id`, `partner_id`, `voucher_agency_id` and `vouched_partner_id` on word boundaries,
and attributes each hit to a table by, in order: an explicit `table.column` qualification, a
PostgREST embedded selector, then the nearest preceding `.from("...")` in the same file. The
table map is transcribed from `docs/079-rename-plan.md`.

**Inventory mode** prints every occurrence grouped by target name and exits 0.
**Guard mode** (`--guard`) exits 1 while any occurrence remains. Guard mode is what the rename
run uses to prove completeness. `--json` and `--quiet` are also accepted.

### Real output, inventory mode

```
$ node scripts/check-identity-columns.mjs
Legacy company identity columns in application source
Roots: app, lib, components, contexts, hooks, middleware.ts
Scanned 363 files.

--- becomes org_id  (168 references in 58 files)
  app/api/agency/active-engagements/route.ts
       98  agency_id            projects                       nearest .from()
  app/api/agency/bids/[responseId]/ai-score/route.ts
      174  agency_id            bid_scoring_criteria           nearest .from()
      204  agency_id            bid_evaluations                nearest .from()
      230  agency_id            bid_decompositions             nearest .from()
  ...

--- NEEDS A HUMAN READ - no table resolved, a comment, or a joined/embedded value  (217 references in 59 files)
  app/agency/bids/page.tsx
      209  partner_id           -                              no .from() context
      582  partner_id           -                              comment
      585  partner_id           -                              comment
      586  partner_id           -                              no .from() context
  ...
```

### The counts it produced

Measured after all four commits in this run.

| Bucket | Count |
|---|---:|
| becomes `org_id` | 168 |
| becomes `lead_org_id` | 163 |
| becomes `vendor_org_id` | 212 |
| needs a human read | 217 |
| **TOTAL** | **760** in 104 files |

At the first commit of this run, before items 2 and 3 touched any route, it read **749 in 103
files**. Items 2 and 3 added 11 references and one file. That is real and it is the guard
doing its job: nine are new `existing.partner_id` and `partnership.partner_id` reads in the
milestone emitters, and two are prose in `lib/capabilities.ts` describing the pre-079 world.
All eleven have to change at 079 and all eleven are now on the list.

### Reconciliation with the plan's 707, stated honestly

`docs/079-rename-plan.md` reports 707 references in 103 files. This scanner reports 749 in 103
files over the same tree at the same commit. **The file count matches exactly and the total
does not.** The plan's census script was not committed to the repository, so the two cannot be
reconciled line by line. What I can say precisely:

- This scanner counts every OCCURRENCE. Counting one hit per (file, line) instead gives 685,
  so the plan's 707 sits between the two and the difference is at least partly a
  per-line-versus-per-occurrence choice.
- The `org_id` bucket agrees exactly at 168, which is the group with no ambiguity in it.
- `lead_org_id` 163 vs 158, `vendor_org_id` 212 vs 207 and needs-a-human-read 217 vs 174 do
  not agree, and I did not make them agree by tuning the heuristic until the numbers matched.
  That would be fitting the instrument to the answer.

For the guard's actual purpose the discrepancy does not matter: guard mode asserts ZERO, and
zero is zero under either counting rule. The inventory counts are a work estimate, not a
proof.

## 1b. `scripts/audit-policy-snapshot.mjs`

Flags every policy on a company-scoped table whose body compares to `auth.uid()`. This is the
nastiest failure in the whole epic: a policy that still says `org_id = auth.uid()` works
perfectly for a single-member organization, because the organization id equals the founder's
uid for every backfilled row, and it breaks the first time a customer hires someone, in
production, for one customer, with no error. The colleague simply sees nothing.

It reads a snapshot file rather than a database. `pg_policies` is not reachable through
PostgREST and there is no database access from this sandbox, and in any case
`docs/schema-snapshot-2026-08-13.md` is the authoritative record while the on-disk migration
history is not. Snapshot path is the first positional argument and defaults to that file.

It parses the CSV properly, including quoted fields with embedded newlines, and it handles the
fact that the Aug 13 snapshot was assembled from two exports because Supabase truncates at 100
rows: two header rows, three duplicate data rows, both dropped.

Findings are split into **DIRECT** (this table's own company column compared to `auth.uid()`,
which is bucket (a) and is the exact bug) and **INDIRECT** (`auth.uid()` reaches the row
through a parent subquery or a partnership join, which is bucket (b) and still has to be read).
Six policies are allow-listed by name, transcribed from `docs/079-rename-plan.md` section 8b;
every one of them matches the caller as a PERSON rather than as a company, and the allow-list
is printed on every run so it cannot grow silently.

### Real output

```
$ node scripts/audit-policy-snapshot.mjs
Policy audit: company-scoped tables whose policies compare to auth.uid()
Snapshot: docs/schema-snapshot-2026-08-13.md
Parsed 104 distinct policies (3 duplicate row(s) dropped, 2 header rows - a split export)
60 of them sit on one of the 23 company-scoped tables.

FLAGGED: 53  (44 direct company-column comparison, 9 indirect)

  agency_library_documents
    [DIRECT] ALL    Agency manages own library documents
             roles={authenticated}  (agency_id = auth.uid()) | (agency_id = auth.uid())
  agency_partner_invitations
    [DIRECT] INSERT Agencies can create invitations
             roles={public}  | (agency_id = auth.uid())
  ...
  projects
    [INDIRECT] SELECT projects_partner_select_assigned
             roles={authenticated}  (EXISTS ( SELECT 1 FROM (project_assignments pa JOIN ...

Allow-listed and not flagged: 6
  agency_partner_invitations.Partners can update received invitations  -  email disjunct
  agency_partner_invitations.Partners can view their received invitations  -  email disjunct
  partner_rfp_inbox.Partners select inbox rows by recipient email  -  bucket (U)
  partner_rfp_inbox.Partners update own inbox rows  -  email disjunct, bucket (U)
  partner_rfp_responses.Partners insert RFP responses for their inbox  -  email disjunct, bucket (U)
  partnerships.Partners can claim partnership by email  -  the pre-claim path
```

### The counts it produced

| Measure | Count |
|---|---:|
| Distinct policies parsed from the snapshot | **104** |
| Duplicate rows dropped (the split export) | 3 |
| Policies sitting on one of the 23 company-scoped tables | 60 |
| **Flagged** | **53** |
| of which DIRECT | 44 |
| of which INDIRECT | 9 |
| Allow-listed by name, not flagged | 6 |
| Company-scoped tables absent from the snapshot | 0 |

**104 is a useful cross-check.** `supabase/migrations/079_organizations.sql` independently
states "104 on Aug 13" in its header. The parser arrives at the same number from the raw CSV,
which means the split export was reassembled without loss and the truncation that produced
Finding Zero did not happen again here.

The 60 minus 53 minus 6 leaves one policy on a company-scoped table with no `auth.uid()` in it
at all. That is `partner_vouches / Anyone can count vouches`, `qual: true`, and it is item 4b.

### Two things the audit does not do, and why

- It does not talk to a database, so it cannot know what is live TODAY, only what was live on
  2026-08-13. Every run prints a reminder to that effect.
- It does not implement the `org_policy_audit()` SECURITY DEFINER RPC proposed in
  `docs/079-rename-plan.md` section 8b. The brief for this run asked for a snapshot reader
  specifically. The RPC is still worth authoring in a later migration: it answers the same
  question against live data rather than against a file, and the two are complementary rather
  than alternatives.

---

# Item 2: the capability layer

## Shape

One module, `lib/capabilities.ts`, one exported gate function.

```ts
can(profile: CapabilityProfile, capability: Capability): boolean
```

Backed by one mapping held as data in one place:

```ts
export const CAPABILITY_MINIMUM_ROLE = {
  "vendor.invite":  "admin",
  "bid.award":      "admin",
  "payment.mark_paid": "owner",
  ...
} as const satisfies Record<string, GateRole>

export type Capability = keyof typeof CAPABILITY_MINIMUM_ROLE
```

89 capabilities, transcribed from `docs/capabilities.md` with the defaults that document
derived from the reversibility test. Nothing invented, nothing renamed. The value is the
MINIMUM membership role that holds the capability, and `owner > admin > member` is a rank
comparison rather than a set membership test, which is what keeps the mapping small enough to
edit.

Three deliberate properties:

- **`Capability` is a union type derived from the mapping's keys.** `can(profile, "bid.awrad")`
  does not compile. This is the only string in this codebase handed to a permission check that
  the compiler validates, and it exists precisely because nothing else here is checked.
- **Platform capabilities are outside the ranking.** `platform.*` resolves through
  `profiles.is_admin` and never through membership, so no amount of seniority inside a
  customer's organization can reach a Ligament staff capability.
- **An unknown capability fails closed.** Unreachable from TypeScript today, but the mapping
  is destined to become editable data and a lookup miss against editable data must never be an
  allow.

The module answers exactly one of the three questions a gated route asks. `lib/acting-role.ts`
answers "which side", `lib/entitlements.ts` answers "is the payer entitled", and this answers
"may this member". It does not test the side, on purpose: folding those two together is the
mistake `lib/entitlements.ts` exists to undo.

## Proof that nobody's permissions changed

The claim is that `can()` returns `true` for every capability, for every live user, today.
Here is the whole argument, and it rests on one function:

```ts
export function orgRoleFor(profile: CapabilityProfile): OrgRole | null {
  if (!profile) return null
  return "owner"
}
```

1. Every live user is the sole member and de facto owner of their own company. There is no
   organization, no `org_members` table, and no second member anywhere in the product. So
   `orgRoleFor()` returns `"owner"` for every authenticated caller.
2. `owner` has rank 3, the maximum. `ROLE_RANK["owner"] >= ROLE_RANK[anything]` is true for
   all three roles. So every organization capability resolves true.
3. The `platform.*` branch never reaches the ranking. It returns `profile.is_admin === true`,
   which is exactly what gates `app/api/admin/*` today. No platform capability is adopted at
   any route in this run, so that branch is currently unreached in production code.
4. `can()` returns false only when `profile` is null. At all five adopted sites the profile is
   already loaded and already proven non-null by an earlier guard that returns 403 or 500
   before the capability check is reached. In `broadcast-rfp` and `rfp-responses` the
   preceding test is `profile?.role !== "agency" && profile?.active_role !== "agency"`, which
   a null profile fails. In `partnerships` POST it is `canActAs(profile, 'agency')`, which
   returns false for a null profile.

So the only new 403 the five sites can produce is one that a pre-existing 403 already produced
one line earlier. **If applying the layer would deny anything anyone can do today, the brief
said to stop and report rather than ship a lockout. It does not, and here is the reasoning
rather than an assertion.** This is a code-read argument, not an executed one; see the
verification statement.

One incidental change worth naming: three profile SELECTs gained `is_admin`. That column is
read by `can()` as a staff bypass. Adding it changes nothing today, because staff already
resolve to `"owner"` like everyone else, and it means the bypass actually works when
`orgRoleFor()` stops being a constant.

## The five adopted sites

All five are server-side, in the route handler, before the write. All five are irreversible in
the sense `docs/capabilities.md` uses: each sends mail that the vendor has read by the time
anyone reconsiders. All five are on the "irreversible actions currently open to anyone" list in
that document's section 4.

| # | Capability | Site | Placed |
|---|---|---|---|
| 1 | `rfp.broadcast` | `app/api/agency/broadcast-rfp/route.ts` POST | Immediately after the agency-side check, before the body is parsed |
| 2 | `vendor.invite` | `app/api/partnerships/route.ts` POST | Immediately after `canActAs`, covering both the new-partnership branch and the terminated-partnership reactivation branch |
| 3 | `bid.award` | `app/api/agency/rfp-responses/[id]/route.ts` PATCH | After `nextStatus` is resolved and the awarded-transition guard runs, before any write |
| 4 | `bid.decline` | same route | same point |
| 5 | `bid.feedback` | same route | same point, gated on `shouldSendAgencyFeedbackEmail` |

Site 5 is worth a note. `bid.feedback` is gated on the exact same condition that sends the
feedback email, so the permission check and the irreversible act cannot drift apart. Feedback
that is not new sends no mail and is not a capability event.

Sites 3 and 4 also removed a small duplication: `existing.status !== "awarded" && nextStatus
=== "awarded"` was written twice in that handler and the decline condition three times. They
are now `isAwarding` and `isDeclining`, computed once at the gate. Same behaviour, and the
gate and the effect can no longer diverge.

## The remaining sites, for a later run

Not swept, on instruction. Every one of these is gated by ownership only today, which means
every one becomes genuinely open to every colleague on the day 079 lands.

| Capability | Site | Note |
|---|---|---|
| `vendor.remove` | `app/api/partnerships/route.ts` DELETE, line ~930 | Auth check then `partnership.agency_id !== user.id`. No role check of any kind |
| `vendor.invite_resend` | `app/api/agency/pool/resend-invitation/route.ts` | Overwrites `invitation_sent_at`, destroying the original send time |
| `msa.confirm` | `app/api/partnerships/route.ts` PATCH `action=confirm_msa` | Emits a milestone in this run but is NOT capability-gated. See judgment calls |
| `nda.acknowledge` (agency side) | `app/api/partnerships/route.ts` PATCH `action=confirm_nda` | Same shape |
| `payment.mark_paid` | `app/api/agency/msa/milestones/route.ts` | Owner-only by default. A vendor-visible financial assertion |
| `client.document_remove` | `app/api/agency/library-documents/[id]/route.ts` DELETE | Deletes the blob |
| `rfp.magic_link_send` | `app/api/agency/rfp/magic-link/route.ts` | Sends mail to an address with no account |
| `onboarding.package_send` | `app/api/projects/[id]/onboarding-packages/route.ts` | |
| `onboarding.deploy` | `app/api/projects/[id]/onboarding/deploy/route.ts` | |
| `delivery.review_complete` | `app/api/agency/delivery-reviews/route.ts` | The vendor may read a completed review |
| `bid.shortlist`, `bid.meeting_request` | `app/api/agency/rfp-responses/[id]/route.ts` | Same route as sites 3 to 5, left alone to keep the adoption at five |
| `project.delete` | **no route exists** | The capability must exist before the route does |
| `vendor.vouch` | **no route exists** | A browser-side insert and delete straight into `partner_vouches` at `app/agency/pool/[partnerId]/page.tsx:255-260`. There is no server-side place to put a check. This one needs a route before it needs a capability |
| `org.*`, `billing.*` | **no routes exist** | 079 creates the first four; billing creates the rest |
| `platform.*` | `app/api/admin/*` | Already gated on `is_admin`. Moving those to `can()` is a rewrite of a working gate, not a fix, and should be done deliberately |

---

# Item 3: the attribution mechanism

## What backs the feed today

**It is derived, and it cannot carry attribution.** Confirmed by reading
`app/api/agency/dashboard/route.ts:370-418`, which says so in its own comment. The feed is a
union of four timestamp columns computed in memory per request and never persisted:
`projects.created_at`, `partner_rfp_responses.submitted_at`, `partner_rfp_inbox.viewed_at`,
`onboarding_packages.partner_reviewed_at`. Sorted descending, sliced to
`RECENT_ACTIVITY_LIMIT = 15`.

Every line's subject is the COUNTERPARTY: the vendor who viewed, the vendor who bid, the vendor
who acknowledged onboarding. There is no column anywhere in that union naming which person on
the agency side did anything, and adding an actor column to the four source tables would not
create one, because those columns record when a vendor acted.

`notifications` is not a candidate either: per recipient rather than per event, no actor column
(the actor is prose inside `title`), a partnership-scoped INSERT policy that cannot reach a
colleague at all, and no reader anywhere in the codebase.

`docs/milestone-attribution-map.md` section 1 reached both conclusions before this run and this
run did not re-derive them. It concluded a table is needed.

## A table was authored: `supabase/migrations/080_milestone_events.sql`

**AUTHORED, NOT APPLIED.**

Structure, with the reasoning that matters:

- **Columns are named for the post-079 world.** `org_id` and `vendor_org_id`, holding profile
  ids today because one user is one company. Naming two more columns `agency_id` and
  `partner_id` would have added to a 700-plus-reference rename surface for no benefit. What
  changes at 079 is the VALUE these columns hold, not their name, so this table costs the
  rename nothing.
- **`actor_id` is nullable, with `actor_email` as a fallback.** Three vendor-side milestones
  arrive through the guest and magic-link path where there is no authenticated user at all.
  Modelling `actor_id` NOT NULL breaks the guest bid flow. The map warned about this
  explicitly and the warning is honoured.
- **No foreign key on `org_id` or `vendor_org_id`, deliberately.** 079 repoints existing FKs
  from `profiles` to `organizations` through a `DO` block generated from a table list that
  predates this file. An FK to `profiles` added here would survive 079 unnoticed and then
  reject every write made by an organization created after it, since those ids belong to no
  user. Adding the FK is on 080's own to-do list in its header.
- **`subject_id` is nullable.** Not every milestone has one row to point at: an RFP broadcast
  sent outside a project context has no project id, and the wizard permits that today.
- **`event_type` has no CHECK constraint.** The visibility rule is what has to fail closed, and
  it does. Constraining the write side too would mean a migration per new event type while
  buying nothing the whitelist does not already buy.

## The policy shape

Row level security is enabled in the same migration that creates the table, not a follow-up.
`docs/schema-truth.md` records that this repo cannot replay its own policy history; a table
that ships without policies for even one deploy is a table whose real policy set nobody can
reconstruct.

**Deny by default.** RLS on, three policies, nothing for `anon`, nothing for `public`.

| Policy | cmd | roles | Predicate |
|---|---|---|---|
| Members read own company milestone events | SELECT | authenticated | `org_id = auth.uid()` **(079 seam)** |
| Counterparty reads whitelisted milestone events | SELECT | authenticated | `partnership_id IS NOT NULL AND event_type = ANY (public.vendor_visible_event_types()) AND EXISTS (partnerships where id = partnership_id and partner_id = auth.uid())` **(079 seam)** |
| Members insert own company milestone events | INSERT | authenticated | `actor_side = 'agency' AND org_id = auth.uid() AND (actor_id IS NULL OR actor_id = auth.uid())` **(079 seam)** |

**No UPDATE policy. No DELETE policy. For anybody.** A breadcrumb that can be edited is not a
breadcrumb; corrections are new rows. This is also what fixes the two destructive milestones:
resending an invitation overwrites `invitation_sent_at` and a changed deadline overwrites the
old one, and an actor column on either row would record only who did it last.

**The vendor-visible subset is an explicit whitelist of event types**, held in
`public.vendor_visible_event_types()` returning a constant `text[]`. A function and not a
boolean column, because a column can be set by whatever performs the INSERT and a function can
only be changed by a migration. It is seeded with the 22-entry `(V)` set from
`docs/capabilities.md` section 5. A whitelist fails closed: a new event type is invisible to
the vendor until a migration says otherwise, which is the opposite of what a `is_private`
boolean does on the day somebody forgets to set it.

There is deliberately **no vendor-side INSERT policy yet**. Nothing emits a vendor-side event,
and a policy granting a write nobody makes is a policy nobody has reviewed against a real
caller. It ships with the first vendor-side emitter, in the same commit.

**Contact tiering is a separate control and is not enforced by this table**, correctly. The
table carries `actor_id`; resolving that to a display name is one lookup and resolving it to an
email is a different lookup with a different permission. Any vendor-facing render must route
the actor through the lead agency profile tiering shipped in `0016d33` and return a display
name only. `actor_email` must never be rendered to a counterparty at all: a guest actor's
address is a person's inbox with no tiering in front of it. This is stated at the bottom of 080
and in `lib/milestone-events.ts`.

## The emitter

`lib/milestone-events.ts`, two functions, `recordMilestone` and `recordMilestones`.

**Fire and forget by construction.** Neither throws, neither returns a failure, neither can
fail a caller. 080 is unapplied, so every insert currently returns Postgres `42P01`; that logs
at WARN with a message naming migration 080, and everything else logs at ERROR. An unapplied
migration reads as an unapplied migration in the logs rather than as a fault. This follows the
rule the email sends in this codebase already follow: the award is recorded, then the mail is
attempted inside try/catch, and a failed mail never rolls back the award. A breadcrumb is
strictly less important than the act it describes.

`eventType` is typed as `Capability`, so the event vocabulary and the permission vocabulary are
the same union and cannot drift into two spellings.

## The six milestones emitting

| Event type | Site | Vendor visible | Notes |
|---|---|---|---|
| `rfp.broadcast` | `app/api/agency/broadcast-rfp/route.ts`, after the inbox insert | yes | **One row per recipient, not one per broadcast.** Vendor visibility is per partnership, so a single row with no `partnership_id` would be invisible to every vendor it was actually sent to. One bulk insert, not N |
| `vendor.invite` | `app/api/partnerships/route.ts` POST, both branches | yes | The reactivation branch revives a TERMINATED partnership, which is a fresh invitation rather than a resend, so it carries `vendor.invite` and not `vendor.invite_resend` |
| `msa.confirm` | `app/api/partnerships/route.ts` PATCH `action=confirm_msa` | **no** | See the decision above. Emitted beside `partnerships.msa_confirmed_by`, which migration 051 already added and which the map says to treat as the precedent it is |
| `bid.award` | `app/api/agency/rfp-responses/[id]/route.ts`, last, after the assignment row and the mail | yes | Emitted last so the breadcrumb cannot claim an award that did not happen |
| `bid.decline` | same route | yes | The decline reason is deliberately NOT in the payload: it is already composed into `agency_feedback` and mailed, and duplicating it would put one sentence under two different read rules |
| `bid.feedback` | same route | yes | The clearest case in the product. The vendor is reading a human judgement signed by nobody |

Payloads carry names, counts, scope titles and booleans. Nothing internal, no scoring, no
colleague email addresses. The rule is written into `lib/milestone-events.ts`: a payload on a
vendor-visible event type is vendor-readable data, so it carries nothing the agency would not
put in the email it already sends for the same act.

Two selects gained a column to make this work: the feedback branch and the decline branch of
`rfp-responses/[id]` now select `partnership_id` from `partner_rfp_inbox`, because that is what
makes the event reachable by the vendor whose bid was reviewed.

**No existing surface changed appearance.** The dashboard feed still renders exactly what it
rendered before. Reading `milestone_events` into a feed is a later decision and this run did
not take it.

---

# Item 4: two authored security fixes

Both are live in production today. Both are authored and unapplied. Both drop policies by their
live names from `docs/schema-snapshot-2026-08-13.md`, and both carry a header instruction to
re-take `pg_policies` immediately before applying, because a `DROP` that matches nothing
reports success.

## 4a. Migration 081: `project_documents` and `project_messages` INSERT scoping

### The exposure today

```
project_documents  "Users can upload documents"
  INSERT  {authenticated}  WITH CHECK (uploaded_by = auth.uid())

project_messages   "Users can send messages"
  INSERT  {authenticated}  WITH CHECK (sender_id = auth.uid())
```

Read literally, the only thing either check asserts is that the caller wrote their own id into
the row. Neither says anything about the project. **Any authenticated account on the platform
can insert a document row or a message row against any project id and any assignment id
belonging to any customer, simply by naming it.**

Concretely, what that buys:

- A message row planted into another agency's project, which that agency's own SELECT policy
  then renders to them as legitimate traffic inside a workspace the attacker has no other
  access to.
- A document row with `visibility = 'all_partners'`, readable by every vendor assigned to that
  project, pointing at a blob URL the attacker controls.
- A row whose `assignment_id` belongs to a DIFFERENT project than its `project_id`. The partner
  SELECT policy on `project_documents` matches on `assignment_id` alone when
  `visibility = 'assignment'`, so a mismatched pair surfaces a document to a vendor on a
  project it was never filed against. This is a second, distinct hole.

The application routes are not the reason this has not been exploited. Both
`app/api/documents/upload/route.ts` and `app/api/projects/[id]/messages/route.ts` check project
access correctly before inserting. But the policy, not the caller, is the permission, and the
anon key plus any authenticated session reaches PostgREST with no route in front of it. Same
class of defect as an interface-only gate.

### What the fix closes

An INSERT now succeeds only when the caller is the lead agency that owns the project, or a
vendor assigned to that project through one of their own partnerships, AND the row's
`assignment_id`, when set, belongs to the same project the row names. The predicates are
deliberately the same conditions the two routes already enforce in application code. The routes
were right; the database was never told.

The `uploaded_by = auth.uid()` and `sender_id = auth.uid()` clauses are preserved, not
replaced. They are the only thing stopping a caller from attributing their own write to a
colleague, and under the organization model that becomes the more important half.

The vendor branch on `project_messages` is scoped on `project_id` rather than `assignment_id`,
because the messages route permits a vendor to post a project-level message with
`assignment_id` null and scoping on `assignment_id` alone would break that path.

Neither table carries a company identity column, so 079 renames nothing here. But both policy
bodies name `projects.agency_id` and `partnerships.partner_id`, which 079 does rename. Each
occurrence is marked `079:` and both policies must be rewritten in the same release or every
upload and every message send starts returning 42703.

**The worst failure mode is called out in the file.** The DROP and the CREATE run in one
transaction, so a stale policy name means the new scoped policy is created BESIDE the old
unscoped one. RLS policies are OR-ed. The exposure would survive the fix and the fix would look
like it worked. Verification query 2 in that file is a per-table count of INSERT policies,
expecting exactly 1.

## 4b. Migration 082: `partner_vouches` containment

### The exposure today

```
partner_vouches  "Anyone can count vouches"
  SELECT  {public}  USING (true)
```

The creating migration's comment says "Count queries are safe (no identifying info)". That is
true of the number and false of the table. **A policy grants access to ROWS. It cannot grant
access to an aggregate.** `USING (true)` for role `public`, which includes `anon`, means any
caller holding the publishable anon key can run

```sql
select voucher_agency_id, vouched_partner_id from partner_vouches
```

and read the complete who-vouched-for-whom graph of the entire platform. Not a count. The
edges, with both endpoints. What that discloses is which lead agencies rate which vendors, for
every customer at once: a competitive-intelligence dataset about Ligament's customers,
assembled by Ligament, published by accident.

The application only ever asks for a count, which is why it has never surfaced in the product.

### What the fix does

Drops the row grant. Delivers the count as a projection from two SECURITY DEFINER functions
with pinned `search_path` (`partner_vouch_count(uuid)` and `partner_vouch_counts(uuid[])`),
executable by `authenticated` and not by `anon`. Adds a colleague-scoped SELECT policy, which
is the "visible to colleagues, anonymous outside" half of the ruling and which is degenerate
today because a company has one member. **The vendor is never a reader**: no policy matches
`vouched_partner_id`, deliberately, and the vendor gets their own number through the function
without touching a row.

Two tightenings ride along, stated rather than smuggled: the count is no longer available to
anonymous callers, and the INSERT and DELETE policies are re-granted to `authenticated` instead
of `public` with their predicates unchanged character for character.

### It is containment, not the final shape

Stated in the file header, as instructed. **Blind two-way vouching is ruled but not built.** The
ruled product is mutual: each side vouches without seeing whether the other has, and the
pairing is revealed only when both have. Nothing in this table supports that. It has one
direction, one row, no reveal state, and no notion of a vendor vouching back. **When it is
built, this table is reshaped company-to-company**: `voucher_agency_id` becomes the
organization key and a separate `voucher_member_id` is added, because under the ruled model the
company vouches and a person presses the button. That is a different table from this one. 082
stops a live disclosure; it does not design the feature.

### 082 has a STOP GATE and it matters

**Dropping the `USING (true)` policy does not make the three counting call sites fail. It makes
them return 0.** PostgREST filters the rows out and reports the count of what survived, which
is nothing. No error, no log line, no 500, and every vouch badge in the product silently reads
zero, indistinguishable from a vendor with no vouches.

So the file is split into two transactions with a STOP GATE between them:

- **Phase 1** creates the two functions. Nothing reads them. Safe to apply today.
- **The gate**: deploy a code change moving three read sites onto the RPCs, then confirm the
  counts still render in production.
- **Phase 2** drops the exposure.

The three read sites, exactly, with line numbers as of this commit:

| # | Site | Change |
|---|---|---|
| a | `app/api/marketplace/discoverable/route.ts:80-87` | `.from("partner_vouches").select("vouched_partner_id").in(...)`, counted in JS, becomes `rpc("partner_vouch_counts", { p_partner_ids: profileIds })` |
| b | `app/partner/profile/page.tsx:209-213` | head count becomes `rpc("partner_vouch_count", { p_partner_id: user.id })` |
| c | `app/agency/pool/[partnerId]/page.tsx:227-231` | head count becomes `rpc("partner_vouch_count", { p_partner_id: partnerId })` |

The "have I vouched?" read at `app/agency/pool/[partnerId]/page.tsx:234-239` does NOT change.
It selects rows where `voucher_agency_id` is the caller, which the colleague-scoped policy
still permits.

That code change is not in this run because item 4 was scoped to authoring migrations, and
because writing it before phase 1 exists would mean shipping calls to functions that are not
there.

---

# Judgment calls taken

1. **The 080 table uses today's `auth.uid()` predicates, which my own audit flags, and I did
   not allow-list them.** `docs/milestone-attribution-map.md` section 5 says "do not add a 39th
   table keyed on `auth.uid()`". The brief says "today company means `agency_id`; mark it as a
   079 seam". Those pull in opposite directions. I followed the brief, because a table whose
   policies depend on 079's helper functions cannot be applied until 079 ships, and 079 is
   blocked on a 700-reference code rename. A table nobody can apply records nothing. The
   policies are marked `079:` at each site and the 080 header states plainly that
   `pnpm policy-audit` will flag them and that this is correct.

2. **New columns named `org_id` and `vendor_org_id` rather than `agency_id` and `partner_id`.**
   The table is new, so the post-079 name is available for free, and using it keeps 080 out of
   the rename surface entirely. The cost is that the column names briefly describe something
   they do not yet contain, which is why every one of them carries a column comment saying so.

3. **`msa.confirm` is not on the vendor-visible whitelist.** Two documents disagree; a whitelist
   fails closed. Flagged for decision rather than picked quietly.

4. **`msa.confirm` emits a milestone but is not capability-gated.** The brief capped adoption at
   five sites and that route has no profile load at all, so gating it would mean adding a query
   to a handler that currently needs none. Emitting needs no profile. Listed in the remaining
   sites.

5. **The reactivation branch of `partnerships` POST emits `vendor.invite`, not
   `vendor.invite_resend`.** It revives a TERMINATED partnership, which is a fresh invitation to
   a relationship that had ended. The dedicated resend route is the `vendor.invite_resend` site
   and is not emitting yet.

6. **`can()` lets `is_admin` bypass organization capabilities.** It matches
   `hasAgencyEntitlement()` and `canUseAgencyAi()` in `lib/entitlements.ts`. It changes nothing
   today. One bypass rule in the product rather than two.

7. **The scanner's counts do not match the plan's 707 and I did not make them match.** Detailed
   above. Tuning a heuristic until it reproduces a number produced by a script nobody kept is
   fitting the instrument to the answer.

8. **`isAwarding` and `isDeclining` replaced three duplicated inline conditions** in
   `rfp-responses/[id]`. Strictly this is a small refactor beyond the four items. It is
   confined to the handler the capability gates were added to, and its purpose is that the gate
   and the effect it guards cannot diverge, which is the failure mode
   `docs/capabilities.md` section 0 is entirely about.

9. **081 closes a second hole the brief did not name**: the `assignment_id` / `project_id`
   mismatch. It is one clause, it is in the same policy, and leaving a known adjacent hole open
   in a migration written to close its neighbour did not seem defensible. Called out in the
   file and here rather than slipped in.

10. **082 was split into two phases rather than authored as one block.** A single-block 082
    that Greg applied would silently zero every vouch count in the product. Splitting it makes
    the dependency on a code change impossible to miss.

---

# Not done, and why

- **The capability layer was not swept.** Capped at five by the brief. Twelve-plus remaining
  sites are named above.
- **The attribution emission was not swept.** Capped at six by the brief. The map counts 34
  agency-side and 8 vendor-side milestones.
- **No vendor-side milestone emits, and 080 has no vendor-side INSERT policy.** The two ship
  together, in one commit, when the first vendor-side emitter is written. The guest path's null
  `actor_id` needs a policy that permits it without permitting an authenticated caller to write
  somebody else's name, and that is worth writing against a real caller rather than
  speculatively.
- **The dashboard feed was not changed to read `milestone_events`.** The brief said rendering
  the feed differently is a later decision, and the table is unapplied.
- **The `org_policy_audit()` SECURITY DEFINER RPC from `docs/079-rename-plan.md` section 8b was
  not authored.** The brief asked for a snapshot-reading script and that is what was built. The
  RPC answers the same question against live data and is still worth having.
- **The 082 code change was not written.** Scoped out of item 4, and it cannot ship before
  phase 1 exists.
- **`pnpm lint` was not brought to zero.** It reports 178 problems (154 errors, 24 warnings) on
  `main` before any change in this run, and the same 178 after. All four files this run touched
  and both new library modules lint clean individually. The project checklist is
  `npx tsc --noEmit` and `pnpm build`, both of which pass; fixing 154 pre-existing lint errors
  is not this run's work.
- **Nothing was pushed. No migration was applied. No write query was run.**

---

# Honest verification statement

## Executed from this terminal, results observed

- `node scripts/check-identity-columns.mjs` in inventory, `--quiet`, `--json` and `--guard`
  modes. Guard mode exits 1 with 760 occurrences in 104 files. Output pasted above is real,
  copied from the terminal.
- `node scripts/audit-policy-snapshot.mjs` in default, `--json` and `--guard` modes. Guard mode
  exits 1 with 53 findings. Output pasted above is real.
- The audit parsed **104 distinct policies**, which independently matches the "104 on Aug 13"
  stated in the header of `supabase/migrations/079_organizations.sql`. That is a genuine
  cross-check of the parser against a number produced by a different process.
- `npx tsc --noEmit`: exit 0, at each of the four commits.
- `pnpm build`: compiled successfully, at each of the four commits.
- `npx eslint` on `lib/capabilities.ts`, `lib/milestone-events.ts`,
  `app/api/agency/broadcast-rfp/route.ts`, `app/api/partnerships/route.ts` and
  `app/api/agency/rfp-responses/[id]/route.ts`: clean, exit 0.
- `pnpm lint` on the whole repo, before and after: 178 problems both times.
- `git stash` / `git stash pop` to measure the lint baseline. No other git state was altered.
- Read, in full or in the cited ranges: `docs/capabilities.md`,
  `docs/milestone-attribution-map.md`, `docs/schema-snapshot-2026-08-13.md`, the cited sections
  of `docs/079-rename-plan.md` and `docs/079-authoring-report.md`,
  `docs/schema-baseline-2026-08-13.sql` lines 1075-1195, and the five route files edited.

## NOT executed. Claims that rest on reading, not running

- **No SQL in this run was executed anywhere.** Migrations 080, 081 and 082 have never been
  parsed by Postgres. They have not been syntax-checked, planned, or run against any database,
  local or remote. Every "expect N rows" in their verification blocks is a prediction from
  reading the snapshot, not an observation.
- **The 081 and 082 predicates have not been tested against a real caller.** I believe they
  reproduce what the routes already enforce, from reading those routes, and both files carry a
  browser smoke test for exactly that reason. A predicate that is one clause too strict returns
  "new row violates row-level security policy" to a legitimate user, and nothing in this
  sandbox can tell you whether that will happen.
- **The claim that nobody's permissions changed is a code-read argument, not an executed one.**
  No route in this run was invoked. The argument is laid out step by step above so it can be
  checked rather than trusted, and the five browser checks at the end of this document are how
  it gets confirmed against a real session.
- **The milestone emitters have never run.** `milestone_events` does not exist, so the WARN
  path in `lib/milestone-events.ts` has not been observed producing its log line, and the
  insert path has never inserted anything.
- **No live database was queried.** Not read-only, not at all. Every schema and policy fact in
  this document comes from `docs/schema-snapshot-2026-08-13.md` or
  `docs/schema-baseline-2026-08-13.sql`, both of which are point-in-time captures from
  2026-08-13. If the live policy set has moved since, 081 and 082 are written against a stale
  picture, which is why both of them open by telling you to re-capture first.
- **The scanner's attribution heuristic is not verified beyond spot checks.** I read a sample of
  each bucket and the resolutions looked right. I did not verify all 760.
- **`pnpm dev` was never started and no page was loaded.** Nothing in this run has been seen
  working in a browser.

---

# Live checklist, in click order

Everything items 2 and 3 changed is code that is already deployed-shaped and safe, so this list
is short. Items 4a and 4b are the ones that need care.

### A. Confirm items 2 and 3 changed nothing (before applying anything)

Deploy `main` as it stands, then, signed in as `gmarkant@gmail.com`:

1. **Broadcast an RFP** to at least one vendor. It sends, and the recipients receive mail.
   This exercises capability site 1 and milestone `rfp.broadcast`.
2. **Invite a vendor** from `/agency/pool`, to any address. It sends. Capability site 2 and
   milestone `vendor.invite`.
3. **Open a bid at `/agency/bids` and leave feedback.** It saves and the vendor gets the
   feedback email. Capability site 5 and milestone `bid.feedback`.
4. **Decline a bid** with a reason. It saves and the decline email arrives. Capability site 4
   and milestone `bid.decline`.
5. **Award a bid.** The assignment appears, the project moves out of draft, the award email
   arrives. Capability site 3 and milestone `bid.award`.
6. **Confirm an MSA** on a partnership from `/agency/pool/<partnerId>`. Milestone
   `msa.confirm`.

If any of steps 1 to 6 returns a 403 whose message ends in a capability name, stop: the
"nobody's permissions changed" claim is wrong and the offending `can()` call should be reverted
before anything else happens.

7. **Check the server logs** for lines beginning `[milestone]`. Expect one WARN per action
   above reading "milestone_events table not present - migration 080 is authored and not
   applied". Their absence means the emitter is not being reached; an ERROR instead of a WARN
   means something other than the missing table is wrong.
8. **The dashboard's Recent Activity renders exactly as before.** Nothing in this run should
   have changed it.

### B. Apply 081 (recommended first; needs no code change)

9. Capture `pg_policies` for `project_documents` and `project_messages` and confirm the two
   policy names in the 081 header appear exactly as written.
10. Run `supabase/migrations/081_scope_document_and_message_inserts.sql`. Expect "Success. No
    rows returned".
11. Run verification queries 1 to 4 in that file. **Query 2 is the one that matters**: exactly
    one INSERT policy per table. Two means the DROP missed and the exposure is untouched.
12. **As the lead agency, upload a document to a project.** It saves.
13. **As a vendor (`gmarkant+partner71@gmail.com`), post a message on an assigned project.** It
    sends.
14. If either fails with a row-level-security violation, restore the old policy from the 081
    header and report which one.

### C. Apply 080 (optional, whenever you want attribution recording)

15. Run `supabase/migrations/080_milestone_events.sql`.
16. Run its verification queries 1 to 6. Query 3 expects zero rows for `anon` or `public`;
    query 4 expects 22 event types and no `msa.confirm`.
17. Repeat any one of steps 1 to 6 above, then
    `SELECT event_type, actor_id, org_id, partnership_id, created_at FROM public.milestone_events ORDER BY created_at DESC LIMIT 10;`
    Expect one row per act, with `actor_id` equal to your user id. The WARN lines from step 7
    should stop appearing.

### D. Apply 082 phase 1 only

18. Run **phase 1 only** of `supabase/migrations/082_partner_vouches_containment.sql`, stopping
    at the STOP GATE. It creates two functions and changes nothing.
19. Run its phase 1 verification queries. Both functions `prosecdef = true` with a non-null
    `proconfig`, and `anon` cannot execute either.
20. **Do not proceed to phase 2.** The code change in section 4b has to ship first.

### E. Afterwards, whatever you applied

21. Re-take the full `pg_policies` snapshot, split by table-name range, with a row count, and
    commit it as `docs/schema-snapshot-<date>.md`. Expect 104 if you applied only 081 or only
    082 phase 1, and 107 if you applied 080.
22. Update the migrations table in `LIGAMENT_CONTEXT.md`.
23. Re-run `pnpm policy-audit <the new snapshot>` and note the new baseline. Applying 080 adds
    three flagged policies, all of them deliberate and all of them marked `079:`.
