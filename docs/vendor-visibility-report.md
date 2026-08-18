# Vendor visibility run report

Branch: `feat/vendor-visibility`, cut from `main` at `0d784d5`.
Date: 2026-08-19. Six commits, local only. Nothing pushed, nothing merged, no SQL run.

---

## How to read the verification claims in this document

Every factual claim below is marked as one of two kinds, because this project has been
bitten repeatedly by results that looked like success and were not.

- **EXECUTED** means a command was run in this session and its exit code or output is
  reproduced here.
- **READ** means it was established by reading source or SQL. It is an argument, not a
  measurement.

**Nothing in this run was verified against the live database.** `POSTGRES_URL` and
`POSTGRES_PASSWORD` are present but empty, there is no `psql` and no pg driver, and the
brief forbids running SQL regardless. Every statement about what a policy does is READ from
`supabase/migrations/079_organizations.sql` and `docs/schema-snapshot-2026-08-13.md`. Every
statement about what live data contains is marked UNKNOWN rather than inferred.

---

## Phase 0. The five-minute read

READ from the body of `public.current_user_counterparty_org_ids()`,
`supabase/migrations/079_organizations.sql` lines 738-756.

### 0.1 Does it admit partnerships at any status, including pending?

**Yes. Confirmed from the SQL body, not from the comment.** The function is a two-arm UNION
over `public.partnerships` and there is **no status predicate anywhere in it**. The only
filters are on `lead_org_id`, `vendor_org_id`, and a NOT NULL test.

The migration's comment claims "ANY STATUS, deliberately, including 'pending' and
'removed'". The body agrees with the comment, and it is in fact broader than the comment
troubles to say: `'terminated'` and `'suspended'` are admitted too, by the same absence of a
predicate. That matters for Phase 5 and is treated there.

### 0.2 Does it require `vendor_org_id` to be NON-NULL on the lead-agency side?

**Yes, explicitly, and the vendor side excludes NULL implicitly.** Both arms:

```sql
SELECT p.vendor_org_id FROM partnerships p
 WHERE p.lead_org_id IN (SELECT org_id FROM my_orgs)
   AND p.vendor_org_id IS NOT NULL          -- explicit
UNION
SELECT p.lead_org_id FROM partnerships p
 WHERE p.vendor_org_id IN (SELECT org_id FROM my_orgs);   -- NULL is never IN a set
```

**This is decisive for Phase 2, exactly as the brief anticipated.** A GHOST partnership row
(`partner_email` set, `vendor_org_id` NULL, which is how this product records a vendor with
no account) grants **nothing, in either direction**. The first arm skips it by the explicit
NOT NULL. The second arm skips it because `NULL IN (...)` is never true. A ghost row is a
record and a claim target, and it is not a grant.

### 0.3 Is Phase 3 still load-bearing after Phase 2 ships?

**Yes. Phase 2 does not subsume Phase 3, and the two barely overlap.** Stated case by case:

| | Phase 2 gives | Phase 3 gives |
|---|---|---|
| Vendor with an account, no partnership | The pending row, therefore the DB-level grant | The surfaces that render it |
| Vendor with an account and a partnership | Nothing new (case i is skipped) | **Everything.** Every surface was broken even with an ACTIVE partnership |
| Vendor with no account (ghost) | A claim target only. No grant until signup | Nothing until claimed |
| Guest who never signs up | Nothing. Out of scope | Nothing. Out of scope |

Two independent reasons Phase 3 stands alone:

1. **Phase 3's defects fire with an active partnership.** Seven vendor-facing surfaces
   resolved the lead agency out of `profiles` keyed by an organization id. The partnership
   made no difference; the application was asking the wrong table.
2. **Phase 2 ships OFF.** `BROADCAST_CUES_PARTNERSHIP` defaults to false, so until Greg
   flips it Phase 2 changes nothing at all and Phase 3 is the only phase doing work.

The brief's 0.3 also asks whether **Phase 1** survives Phase 2. It does, entirely: Phase 1
is a code-layer id confusion with no relationship to partnership creation. I read that as a
typo for Phase 3 and have answered both.

**Order taken:** 1, 2, 3, 4, 5, as written. No reordering was implied by the answer.

---

## Phase 1. The parameter-passing class

### 1a / 1b. Inventory and classification

The brief put this at 21 helpers and 19 call sites and warned the number was a floor. **It
was a floor.** EXECUTED greps over `lib/`, `app/`, `components/`, `contexts/`, `hooks/`
found:

| Helper | File | Read/Write | Call sites | Passing a USER or PROFILE id |
|---|---|---|---|---|
| `loadBidAnalysisContext` | bid-analysis-context | R | 6 | **5** |
| `resolveResponseScope` | bid-analysis-context | R | 1 | **1** |
| `generateAndSaveBidSummary` | bid-summary-generation | R+W | 4 | **1** (3 correct) |
| `resolveRfpRubricForResponse` | rfp-evaluation-criteria-server | R | 4 | **3** |
| `reconcileProjectClientFields` | clients-server | R | 2 | **2** |
| `loadBidDeltaComparison` | delivery-review | R | 2 | **2** |
| `fetchScopedLibraryDocuments` | library-documents | R | 2 | **2** |
| `loadVendorTrackRecord` | ai-score route (local) | R | 1 | **1** |
| `attachMagicTokenToPartnerInbox` | magic-token-attach | **W** | 4 | **4** |
| `claimAwardedGhostPartnershipsByEmail` | partnership-award-claim | **W** | 3 | **3** |
| `markPartnershipInvited` | partnership-invitations | **W** | 2 | **2** (3 bad values) |
| `recordMilestone` / `recordMilestones` | milestone-events | **W** | 7 | **7** |
| `importPartnerRows` | server/partner-pool-import | **W** | 2 | **2** (wrong resolver) |
| `fetchVouchCount` / `fetchVouchCounts` | vouch-counts | R | 3 | **3** (not closed, see below) |

Plus three writes that are the same defect without a helper in between:

- `POST /api/partnerships` wrote `partner.id`, a profiles id, into `partnerships.vendor_org_id`.
  This was found already documented in the code as "SEPARATE 079 BUG, NOT FIXED HERE AND
  REPORTED INSTEAD".
- `POST /api/agency/broadcast-rfp` compared a profiles id to `partnerships.vendor_org_id`
  and wrote it into `partner_rfp_inbox.vendor_org_id`.
- `POST /api/agency/rfp/magic-link` used `agencyEntitlementId()` as a write resolver.

**Total closed: 12 helpers and 34 call sites, versus the brief's 21 and 19.**

**AMBIGUOUS, reported rather than guessed:** none. Every site resolved to USER, PROFILE or
ORG by reading the value's provenance in the same handler. The one genuinely undecidable
class is described under "not closed" below, and it is undecidable for an access reason, not
a legibility one.

### The three inconsistently-hardened callers, identified

`claimAwardedGhostPartnershipsByEmail` has exactly three callers and each was hardened
differently:

| Caller | Before | Verdict |
|---|---|---|
| `app/api/partner/projects` | `agencyEntitlementId(user.id, service)` | Wrong resolver |
| `app/api/partner/rfps` | `agencyEntitlementId(user.id, service)` | Wrong resolver |
| `app/api/partner/rfps/bids` | raw `user.id` | Not hardened at all |

`agencyEntitlementId()` is the wrong resolver for this helper and `lib/entitlements.ts` says
so in its own header: it **returns the user id unchanged** when membership does not resolve.
That is the correct failure for a usage row and a 23503 for a foreign key, and this helper
writes `partnerships.vendor_org_id`, which REFERENCES `organizations(id)`. All three now use
`resolveCallerWriteOrgId()` and fail closed on null.

### 1c. The fix, and the equal-or-narrower argument

**Reads** now take the caller's own organizations as a set, from `resolveCallerOrgIds()`,
and use `.in()` rather than `.eq()`.

The argument, which the hard limit requires stated:

- The predicate being replaced is `<org column> = <caller's user id>`. It was never an
  authority grant. It was an ownership filter that is **accidentally correct** for the
  sixteen accounts 079 backfilled, whose organization id equals their founder's user id.
- The replacement is `<org column> IN (the caller's own org_members rows)`. For all sixteen
  legacy accounts this is the identical single-element set, so the matched rows are
  **provably identical**. For any account created since, the old predicate matched **zero**
  rows.
- `resolveCallerOrgIds()` reads `org_members` for the caller. It is an **authority** set,
  not a visibility set. **No read or write anywhere in this run is scoped by
  `current_user_counterparty_org_ids()` or `current_user_visible_profile_ids()`.** The trap
  named in the brief was not walked into.
- `.in(col, [])` matches nothing, so a caller with no membership fails **closed**.

**Writes** now go through `resolveCallerWriteOrgId()`, which returns null rather than a
guess, and every caller treats null as "do not write". Four sites were switched off
`agencyEntitlementId()`.

`milestone_events.org_id` deserves a separate note. Migration 080 gives it **no foreign
key**, deliberately. So the seven emits writing `user.id` raised nothing at all. They simply
wrote a row invisible to the organization that created it, whose policy reads
`org_id = ANY (current_user_org_ids())`. A perfect success-shaped non-event: the breadcrumb
was written, the insert returned success, and nobody could ever read it.

**`resolveOrgIdForUser` / `resolveOrgIdsForUsers` are new.** Every pre-existing resolver
answers a question about `auth.uid()`. These answer it about somebody else: the vendor whose
profile an agency just matched by email, the bidder whose vouches are being counted. That
question had no answer before 079 because a `profiles.id` **was** the company. The absence
of that function is the direct cause of at least three of the write defects.

### NOT CLOSED, and why

Two vouch-count reads pass profiles ids into `partner_vouches.vendor_org_id`:
`app/agency/pool/[partnerId]/page.tsx` and `app/api/marketplace/discoverable/route.ts`.

**They cannot be closed at this layer.** READ from 079 line 1736: `org_members` carries
exactly one SELECT policy, `"Members read their own membership row"`, `USING (user_id =
auth.uid())`. A browser client or a session-scoped route therefore **cannot resolve another
user's organization at all**. The only fixes are a SECURITY DEFINER mapping in a migration,
or adding the service role to those surfaces, which the brief forbids. Both sites now carry
an in-place comment saying so. **The failure is an undercount, never a disclosure.**

The same blocker explains the pre-existing Tier B deferral at
`app/partner/network/page.tsx` line ~527, where `partner_access_requests.lead_org_id` is
written from a profiles id. Same root cause, same fix, left alone.

### 1d. Branded types

`OrgId = string & { readonly __brand: "OrgId" }`, minted in exactly four places (the
resolvers that read `org_members`) and required by every helper that filters or writes an
organization column. Because a user id is a plain `string` and `string` is not assignable to
`OrgId`, **the substitution this whole pass exists to close is now rejected by tsc**.

The most valuable single line is a negative one: **`agencyEntitlementId()` is deliberately
left returning a bare `string`.** Its unbranded return type is now what prevents it being
handed to a write. Four sites were doing exactly that.

Two named boundaries were added rather than scattering casts:

- `callerOwnsOrg(callerOrgIds, column)` replaced 26 authorization checks spelled
  `callerOrgIds.includes(row.org_id as string)`. That cast was a lie twice over: the column
  is nullable and PostgREST types it `any`. **Semantics are identical** - a null column was
  already `includes(null)` and therefore false. Nothing widens.
- `orgIdFromColumn` / `orgIdsFromColumns` name the crossing from a PostgREST column into the
  type system, so a reviewer can grep for every place one happens.

`recordMilestones()` now drops an event whose organization did not resolve, and logs it,
rather than writing an unreadable row.

**Cascade inside scope: 45 sites**, all mechanical, all at the helpers, their direct call
sites, or a named boundary. Well inside the abort rule.

#### The UserId half: measured, and abandoned

EXECUTED. `UserId` was written, applied to the four resolvers, and measured:

```
UserId cascade errors: 154
files affected:         84
```

That is not "the helpers and their direct call sites"; that is **every `user.id` in the
codebase, at every auth boundary**. It trips the hard abort rule by a factor of four. It was
reverted, `1c` and the `OrgId` half were kept, and the measurement is recorded in
`lib/entitlements.ts` so nobody re-derives it.

It also buys much less than the `OrgId` half. **Every observed instance of this defect class
is a user id reaching an organization parameter**, which the one-sided brand already
catches. The symmetric brand would only catch the reverse, which has not occurred once.

**A staged version, costed:** brand the return of `auth.getUser()` behind one wrapper in
`lib/api-auth.ts`, so `requireAgencyRole()` hands back a `UserId` and the cast lives in one
file instead of 84. That is roughly a day and it should be its own pass.

---

## Phase 2. Broadcast cues a partnership invitation

Implemented in `lib/broadcast-partnership-cue.ts`, wired into
`app/api/agency/broadcast-rfp/route.ts`, flagged in `lib/feature-flags.ts`, with the pure
predicate split into `lib/broadcast-cue-shape.ts` so no server module reaches the client
bundle.

`agency_partner_invitations` was confirmed a decoy: EXECUTED grep found **zero references**
in `app/`, `lib/` or `components/`, and 079 lines 523-525 drop all three of its policies.
Nothing here touches it.

### 2a. The three target states

| State | What is written | What the vendor gets |
|---|---|---|
| **(i)** account + existing partnership, ANY status | **Nothing.** The row is left exactly as it is | Unchanged |
| **(ii)** account, no partnership | Pending row, `vendor_org_id` set | Immediate mutual visibility. See 2d |
| **(iii)** no account at all | GHOST row: `partner_email` set, `vendor_org_id` NULL | **Nothing, in either direction**, until claimed |

Case (i) covers `'removed'` and `'terminated'` deliberately. Re-cueing a relationship the
agency ended would resurrect it behind their back. This is also what makes a repeat
broadcast idempotent for account holders.

**Does the claim path correctly promote a cued ghost?** READ, and **yes, by both routes**:

- `app/auth/callback/route.ts` claims every row with `vendor_org_id IS NULL` and
  `status IN ('pending','active')` matching the new account's email, setting
  `vendor_org_id = resolveCallerWriteOrgId(...)` and `profile_status = 'active'`.
- `GET /api/partnerships` (partner branch) claims the same set on the vendor's first portal
  load.

Both leave `status` untouched. **A promoted cue is still `'pending'`.** The vendor is
invited, not partnered, which is the ruling. Both use `resolveCallerWriteOrgId` and fail the
request loudly on a claim failure rather than returning an empty inbox.

**GUEST magic-link recipients who never create an account are OUT OF SCOPE.** Naming it
explicitly: they have no organization, so there is nothing for a partnership to point at and
nothing to accept in a portal they do not have. They bid as guests today and this changes
nothing for them.

### 2b. Idempotency and the TOCTOU history

Three things hold the invariant:

1. Targets are deduplicated **in memory** before any query, so one broadcast cannot race
   itself across scope items naming the same vendor.
2. The existence check reads **both** identity keys in one batch query - `vendor_org_id`
   when known and `partner_email` otherwise - because a ghost row and an account-holder row
   for the same person are one relationship recorded two ways.
3. **23505 is treated as "somebody else got there first", which is a success.** This is the
   discipline `lib/magic-token-attach.ts` already follows, and it is what lets migration 084
   be applied later **with no code change at all**.

**Stated plainly and not papered over:** until 084 is applied there is no index to raise
23505, so (1) and (2) carry the invariant alone and a sufficiently unlucky pair of
concurrent broadcasts could still duplicate. Application code cannot close a TOCTOU window.

**Migration 084 is AUTHORED AND NOT APPLIED**
(`supabase/migrations/084_partnership_cue_uniqueness.sql`, with a down migration). It
creates two partial unique indexes, not one, because a partnership has two identities:

- `(lead_org_id, vendor_org_id) WHERE vendor_org_id IS NOT NULL`
- `(lead_org_id, lower(partner_email)) WHERE vendor_org_id IS NULL AND partner_email IS NOT NULL`

A single index over both columns would constrain **nothing** on ghost rows, because NULL is
never equal to NULL in a unique index, and ghost rows are exactly what a broadcast to a typed
address creates.

**It carries a STOP GATE and it will fail by design if duplicates exist.** Whether
`partnerships` currently holds duplicates is **UNKNOWN** - I could not run the query. The
documented eight-duplicate-groups history is on `partner_rfp_inbox`, not on `partnerships`,
and that is not evidence that `partnerships` is clean. The migration deliberately does **not**
write a collapse statement: two rows for one pair may hold different statuses, NDA and MSA
state, and `partnership_notes`, and `project_assignments` and `delivery_reviews` carry
foreign keys that must be repointed before anything is deleted. That is Greg's decision on
the actual rows.

### 2c. What the cued row carries

```
lead_org_id         the broadcasting agency's own organization (resolveCallerWriteOrgId)
vendor_org_id       the recipient's organization, or NULL for a ghost
partner_email       always set - the only identity a ghost has, and the claim key
status              'pending'
profile_status      'active' when the org is known, 'unclaimed' otherwise
invitation_sent_at  NULL          <-- deliberately not stamped
partnership_notes   { cued_by_broadcast: { at, project_id, scope_item_name } }
```

**How it differs from a deliberate pool invitation:**

| | Deliberate | Cued |
|---|---|---|
| `status` | `'pending'` | `'pending'` |
| `invitation_sent_at` | set | **NULL** |
| `partnership_notes.cued_by_broadcast` | absent | **present** |
| Its own email | yes | none, the RFP mail already went |
| `/agency/pool` column | Invited | Discovered |

`invitation_sent_at` is the load-bearing one. `lib/partnership-state.ts` reads exactly that
column to decide Invited versus Discovered, so leaving it NULL keeps a cued row out of the
agency's **Invited** column with no new state at all. Nobody deliberately invited anyone.

READ and confirmed: `partnershipPoolColumn()` returns `"discovered"` for a cued row, and the
vendor's Invitations tab filters on `partnershipPoolColumn(p) !== "network"`, so **a cued row
does appear in the vendor's Invitations tab** and in the agency's Discovered column.

### 2d. THE COST. This needs Greg's ruling before the flag is flipped

The counterparty helper is **bidirectional** and admits **any status**. A pending row grants
the agency visibility of the vendor at the same instant it grants the reverse.

**It is much more than a company name and a contact.** READ from 079: three separate
`profiles` SELECT policies were dropped (lines 596-598) and replaced with **one** (line
1562):

```sql
CREATE POLICY "Users can view profiles of partnership members" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR id IN (SELECT public.current_user_visible_profile_ids()));
```

`current_user_visible_profile_ids()` calls `current_user_counterparty_org_ids()`. Row level
security is **row**-level, not column-level. So a single pending partnership row makes
**every column of every profiles row at each organization** readable to the other, including:

| Column | Migration | What it holds |
|---|---|---|
| `default_terms` | 070 | Payment terms, **kill fee**, IP rights, rate validity |
| `business_criteria` | 060 | Insurance limits, **COI document URL**, EIN state |
| `default_nda_url` | 050 | The agency's standard NDA |
| `credentials` | pre-log | Client list and past work |
| `email`, `bio`, `location`, `company_website`, LinkedIn URLs | 040/049 | Identity and contact |

**This is flagged as needing Greg's ruling BEFORE this ships.** A lead agency who merely
types a vendor's email into a broadcast would, on the next page load, be able to read that
vendor's standing commercial terms and kill fee. And the vendor would be able to read the
agency's. Neither party consented to that by being emailed.

Three options, with costs:

1. **Ship as designed.** Cheapest. Accepts that "we emailed you an RFP" discloses standing
   commercial terms both ways.
2. **Cue at a status the helper excludes.** Requires narrowing
   `current_user_counterparty_org_ids()` to exclude a new status, which is a migration and
   touches every one of the 83 policies that depend on it. Narrowing is permitted by the
   rules; the blast radius is not small.
3. **Do not cue account holders at all; cue only ghosts.** A ghost grants nothing (0.2), so
   the disclosure disappears entirely, and the vendor still gets the invitation the moment
   they sign up. Costs the case-(ii) vendor an invitation they would have seen sooner.

I have not chosen. The flag is off.

### 2e. The feature flag

**`BROADCAST_CUES_PARTNERSHIP`**, read in exactly one place: `broadcastCuesPartnership()` in
`lib/feature-flags.ts`. Greppable by that name.

**Default OFF. Merging this changes nothing.** The helper's first line checks the flag, so
with it unset the broadcast route makes one function call that returns a zero record and
writes nothing.

**What flipping it causes, and to whom:** set `BROADCAST_CUES_PARTNERSHIP=true` in Vercel
(Production and Preview) and redeploy. The **next** broadcast, and every one after, writes
one pending `partnerships` row per recipient who does not already have one. For recipients
who hold accounts, the mutual disclosure in 2d begins **immediately**, before anybody accepts
anything. Existing rows are untouched: the sixteen pending invitations that already exist,
eight of them real third-party contacts, are not modified, re-sent, or re-notified.

Unsetting the flag stops new cues. It does **not** undo rows already written; see the revert
section.

### 2f. Telling a deliberate invitation from an automatic one

Implemented, because it was small. `app/partner/network/page.tsx`, Invitations tab. The card
branches on `wasCuedByBroadcast(partnership.partnership_notes)`.

Read from the row's own marker and **deliberately not** inferred from `invitation_sent_at IS
NULL`. Those agree today, but a null `invitation_sent_at` also describes a Discovered pool
row that predates this feature, and reading one fact off another's absence is how the two
drift.

Copy shipped, under an "Opened by an RFP" label:

> **[Agency]** sent you an RFP, which opens an invitation to partner. You can bid on that
> RFP either way, and declining this does not withdraw you from it. Partnering is what keeps
> feedback, messages, onboarding and delivery with them in one place.

Against the deliberate copy, unchanged:

> **[Agency]** has invited you to join their vendor network on Ligament. By accepting, you'll
> be able to receive project briefs and collaborate with them directly.

The automatic copy states plainly that declining costs nothing, because under the ruling it
does not. The card sits in a passive list, so it is a banner in the sense that matters: it
blocks no bid and gates no screen.

---

## Phase 3. The reciprocal vendor-sees-agency tier

**Not skipped.** Phase 0.3 established that Phase 2 does not subsume it.

### 3a. Every vendor-facing surface, traced

**The headline finding: the ruled tier was already built, and every surface that fed it was
asking the wrong table.** `app/api/partner/network/[agencyId]/route.ts` already implements
the Aug 14 visibility matrix correctly - same tier names as the mirrored agency-to-vendor
route, same "null, do not omit" masking, same server-side decision.

Seven surfaces resolved a lead agency's identity out of `profiles` keyed by an
**organization** id. This is the "JOIN profiles ON profiles.id = an org id" trap 079's own
table comment names. Correct for the sixteen backfilled accounts, silently empty for every
account created since.

| Surface | Column | Resolved from, before | Survived non-discoverable + no partnership? | Symptom for a post-079 agency |
|---|---|---|---|---|
| `/partner/rfps` (Open RFPs) | `agency_company_name` | **`partner_rfp_inbox` snapshot**, written at broadcast | **Yes.** Denormalized, independent of both | None from the standard broadcast |
| `/partner/rfps` | `meeting_url` | `profiles` by org id | No | "Book a call" button silently absent |
| `/partner/rfps/[id]` | `meeting_url` | `profiles` by org id | No | Same |
| `/api/partner/payments` | agency name | `profiles` by org id | No | Name falls back to "Agency" |
| `/api/partner/projects` | agency name | `profiles` by org id | No | Falls back to "Lead Agency" |
| `/api/partner/projects/[id]/active-engagement` | full lead agency block | `profiles` by org id, **`.single()`** | No | **PGRST116 on zero rows.** Error logged, execution continued, whole block null. A vendor mid-engagement with no idea who they work for |
| `/api/partner/network/[agencyId]` | the whole tier | `profiles` by whichever id arrived | No | **"This agency's profile is private" even with an ACTIVE partnership** |
| `app/partner/profile` (Partnership Context) | agency names | `profiles` by org id | No | All named "Lead Agency" |
| `lib/magic-token-attach` | `agency_company_name` **snapshot** | `profiles` by org id | No | Every Lightning RFP stamped "Lead agency" **permanently** |
| `/api/partner/dashboard` | agency name | **`organizations`** | Yes, with a partnership | Already correct |
| `/api/partner/onboarding-packages` | lead org | **`organizations`** | Yes, with a partnership | Already correct |
| `GET /api/partnerships` (My Agencies) | `lead_org` | **`organizations`** | Yes, with a partnership | Already correct |

Two of these deserve emphasis:

- The **magic-token** one writes a **snapshot**. `partner_rfp_inbox.agency_company_name` is
  what the Open RFPs screen renders **and groups by**. Nothing re-reads it, so fixing the
  source does not repair rows already written. See the checklist.
- The **active-engagement** one used `.single()`, so it did not blank a name; it raised an
  error that was logged and ignored.

**The brief's evidence, reconciled.** The brief reports that the vendor's Open RFPs screen
rendered "m a r k a n t" only because that agency carries `is_discoverable = true`. Reading
the code, the standard broadcast path does not depend on discoverability at all: it renders
the denormalized `agency_company_name` snapshot. I could not run the live check that would
distinguish these, so I am recording the discrepancy rather than resolving it: the most
likely explanation is that the observed screen was a **magic-link/Lightning** invitation,
whose snapshot **was** broken by the `profiles`-by-org-id lookup in `magic-token-attach`.
**Step 9 of the checklist is written to settle this.**

### 3b / 3c. The tier, and what was actually wrong

The Phase 3c symptom - "shows contact name and email only, even with an ACTIVE partnership" -
has a precise cause. The tier route is opened from **two** places passing **two different
kinds of id**:

- My Agencies / Invitations pass `partnership.lead_org.id`, an **organizations** id.
- Discover passes a row from `/api/marketplace/discoverable`, a **profiles** id.

The route used the incoming value as both at once: `.eq("lead_org_id", id)` against
`partnerships`, which wants the organization, and `.eq("id", id)` against `profiles`, which
wants the person. For legacy accounts those are the same uuid. For a post-079 agency exactly
one works per entry point, and the My Agencies path hit the empty-select refusal.

Resolved once, at the top of the handler, into the `(orgId, profileId)` pair the rest needs.
The reverse lookup (`organizations` by `primary_contact_user_id`) **grants nothing**:
`organizations` returns a row only where a SELECT policy already admits it, so it can only
find an organization the vendor could already read.

The tier itself is unchanged. Public tier: identity. Partnership tier: contact, meeting
link, payment terms, plus the shared relationship facts already returned (`status`,
`accepted_at`, `invitation_sent_at`, and NDA/MSA confirmations held back until active).

`ORG_CONTACT_SELECT_MEETING` is new and closes the `meeting_url` deferral **on that
deferral's own terms**. It had asked whether to invent an `organizations.meeting_url` and
answered no, because a meeting link is a **person's** calendar. So it is reached through the
organization's designated primary contact: one hop further, not one table across.

### 3d. No migration was needed, and no prohibited fix was used

**The grant already exists and is already scoped to the specific relationship.** READ from
079:

```sql
CREATE POLICY "Members read counterparty organizations" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_counterparty_org_ids()));
```

paired with the rewritten profiles policy at line 1562. Both call the same helper, so
organization visibility and profile visibility are the same predicate **by construction**.
A vendor can read a lead agency's organization and its primary contact's profile exactly
when a partnership row exists, and not otherwise.

**So migration 085 was not authored and is not needed.** Nothing in Phase 3 touches a
policy, `is_discoverable`, or any predicate. All seven defects were the application asking
the wrong table. None of the prohibited fixes was used.

---

## Phase 4. M1 multi-user. Discovery only, no feature code

**No feature code was written in this phase.**

### 4a. What exists versus what M1 must add

| Thing | State | Evidence |
|---|---|---|
| `org_members` table | **Built.** `(org_id, user_id, role, invited_by, created_at)`, `UNIQUE(org_id, user_id)` | 079 line 250 |
| `org_members.role` | **Built.** `NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member'))` | 079 line 256 |
| Live role data | **One owner per organization**, from the 079 backfill and the PHASE 12 trigger | READ |
| `org_invitations` | **DOES NOT EXIST.** 079 deliberately did not create it | 079 line 106 |
| `lib/capabilities.ts` vocabulary | **Built.** 89 capabilities mapped to a minimum role, including 11 `org.*` / `billing.*` keys with no code behind them yet | EXECUTED count |
| `orgRoleFor()` | **Hard-codes `"owner"`** for every caller | READ |
| `loadOrgRole()` | **Written and deliberately unused.** Does the real `org_members` lookup | READ |
| **Capability enforcement** | **5 call sites in 3 routes.** 84 of 89 capabilities are declared and unenforced | EXECUTED grep |
| `lib/acting-role.ts` | **Built.** `active_role` over `role`, flipped by `POST /api/profile/switch-role` | READ |
| Entitlement | **Per profile, not per organization.** `organizations` has no `is_paid` column | `lib/entitlements.ts` header |
| Per-user title field | **DOES NOT EXIST.** No `title` or `job_title` column in any migration | EXECUTED grep |
| Team roster UI | **Does not exist** | |

**The single most important line in this section:** `can()` is defined for 89 capabilities
and called at 5 sites. The vocabulary is complete and the enforcement is 6% built. Today
that is invisible, because `orgRoleFor()` returns `"owner"` for everyone so every check
passes anyway. **The day a second member exists, 84 capabilities become decorative.**

### 4b. The judgment calls Greg must make

Each with options and cost. These are decisions, not recommendations dressed as findings.

**1. Which roles exist beyond owner, and what does each actually gate?**
- (a) Keep owner/admin/member as 079 defines them and adopt the existing 89-capability map.
  Cost: 84 routes need a `can()` call added; the map has never been used in anger and its
  defaults are untested against how the team actually works.
- (b) Ship owner/member only, collapse admin into owner. Cost: cheaper, but every capability
  currently marked `admin` (broadcast, award, decline, invite, onboarding) becomes owner-only
  and a colleague cannot run a broadcast.
- (c) Ship one role and gate nothing. Cost: a colleague can delete projects, award bids, and
  cancel billing on day one.

**2. Can a member invite another member, or only an owner?**
- The map currently says `org.member_invite: admin`, `org.member_revoke: owner`. That is a
  default nobody has ruled on. Cost of admin-invites: an admin can grow the org, and
  therefore the bill, without the owner. Cost of owner-only: the owner is a bottleneck on
  every hire.

**3. What happens to a member's created records when they are removed?**
- (a) Records stay, attribution stays. Cost: `milestone_events.actor_id` and
  `partnerships.msa_confirmed_by` name a person no longer at the company. Honest, possibly
  awkward.
- (b) Records stay, attribution nulls. Both columns are already `ON DELETE SET NULL`, so
  this is the current behaviour on **profile deletion**, not on org removal. Cost: the audit
  trail loses its subject.
- (c) Reassign to the owner. Cost: falsifies history.
- **Note:** `org_members` has `ON DELETE CASCADE` from both `organizations` and `profiles`,
  so removal from an org today means deleting the membership row. Nothing else moves. That
  is a default, not a decision.

**4. `resolveCallerWriteOrgId()` picks "highest role wins" across organizations.**
This is the one the brief flags and it is the sharpest. Today it cannot be wrong, because
every user belongs to exactly one organization. It becomes real the moment invitations ship.
- (a) **An ACTING ORGANIZATION held in session context**, mirroring exactly how
  `lib/acting-role.ts` handles the portal toggle and `POST /api/profile/switch-role` persists
  it to `profiles.active_role`. Cost: a new column (`profiles.active_org_id`), a switcher in
  both layouts, and a decision about what happens when the acting org is one the user was
  just removed from. This is the likely correct answer and it has a working precedent in this
  codebase.
- (b) Keep highest-role-wins. Cost: a user who owns company A and is a member of company B
  silently writes every record to A. Deterministic and wrong, with no error.
- (c) Require an explicit `orgId` on every write request. Cost: touches every write route and
  moves an authorization decision into the client payload, which the project's own rules
  forbid.

**5. Does a second member change billing?**
Ruled already: billing is per organization and adding a colleague costs nothing. But the
ruling is **not implemented** - `hasAgencyEntitlement()` reads `profiles.is_paid`, and
`organizations` has no entitlement column. So today **a colleague added to a paying
organization is not entitled** unless their own profile row says so. Decision needed: put
`is_paid` on `organizations` (a migration plus a billing-model change), or backfill
`is_paid` onto each invited member (cheap, and wrong the moment someone leaves).

**6. What is a "title", and is it identity or permission?** (Found, not in the brief's list.)
No column exists. If title is decorative it is one nullable `profiles.title`. If it is
expected to gate anything it collides with `org_members.role`, and two fields that look like
authority is how a permission system becomes ambiguous.

**7. Which organization does a dual-role account act as?** (Found.) Dual-role accounts
already exist. Portal (`active_role`) and organization are currently the same choice because
one user is one company. Under M1 they separate: a user could be an agency-side member of A
and a vendor-side member of B. Decision 4 and the portal toggle must be ruled on together or
they will disagree.

**8. Can a person be in two organizations at all?** (Found.) `org_members` allows it by
design (`UNIQUE(org_id, user_id)`, not `UNIQUE(user_id)`) and its table comment says
dual-role accounts already rely on it. If the answer is "no, one company per person", the
constraint should say so and decision 4 evaporates. This is the cheapest possible answer to
4 and it should be considered before the expensive one.

### 4c. Estimates

| Component | Files touched | Risk |
|---|---|---|
| `org_invitations` table + RLS (migration 086) | 2 SQL | **Medium.** New table, new policies, must not use a visibility set |
| Invite send + accept routes | 3-4 | **Medium.** Email, token, claim-on-signup. The claim path already exists and can be mirrored |
| Team roster UI (both portals) | 4-6 | Low |
| Switch `orgRoleFor()` to `loadOrgRole()` | 1 line + a caching decision | **High.** One line flips 89 capabilities from always-true to real. Nothing has ever exercised the false branch |
| Add `can()` to the 84 unenforced routes | ~60 | **High volume, low per-site risk.** Every one is a 403 that has never fired |
| Acting-organization (decision 4a) | 1 SQL + 6-8 | **High.** Touches every write resolver |
| Per-user title | 1 SQL + 2 | Low, if decision 6 says decorative |
| Org-level entitlement (decision 5) | 1 SQL + `lib/entitlements.ts` + billing | **High.** Billing |

**The riskiest item is the one-line one.** Replacing the body of `orgRoleFor()` is a single
edit that turns 89 always-true checks into real ones simultaneously, on code paths that have
never returned false in production.

---

## Phase 5. Staleness

### 5a. What can a vendor do with a pending invitation?

**A decline path exists.** READ: the Invitations tab on `/partner/network` calls
`handleDecline`, which sends `PATCH /api/partnerships` with `{ partnershipId, status:
'terminated' }`. The route requires `isPartner && partnership.status === 'pending'`, sets
the row to `'terminated'` with a fresh `updated_at`, and notifies the agency in-app and by
email.

**What happens to the row: it is updated, never deleted.** It leaves the vendor's
Invitations tab because `partnershipPoolColumn()` puts every non-pending row in the network
column.

So the brief's 5c condition - "if no decline path exists, add one" - **did not fire**.

**What was actually broken is the half that makes a decline mean anything.** Both sides of
that exchange looked the counterparty up in `profiles` by an **organization** id, ignored the
error, and skipped the send when it resolved to nothing:

- vendor declines: the agency was **never told**. The status changed and the decline landed
  nowhere the agency could see.
- vendor accepts: same, in the other direction.
- agency confirms NDA or MSA: the vendor was never told their access opened.

All four are fixed and are what 5c built. See below.

**THE FINDING THAT MATTERS MOST HERE, reported and not fixed:**

> **Declining does not revoke visibility.** `current_user_counterparty_org_ids()` admits
> partnerships at ANY status, `'terminated'` included (Phase 0.1). So a vendor who declines
> keeps that agency able to read their entire profiles row afterwards, forever.

This is not a defect. 079 states the any-status behaviour as deliberate: a terminated
relationship still has to name the company on its historical projects, bids and invoices.
But it was ruled when every partnership was one somebody chose to create. **It becomes a
different proposition the moment Phase 2 starts creating invitations nobody chose to send**,
because "decline" will read to a vendor as "withdraw my data", and it does not do that.

Options, with costs:

- (a) Leave it. Cost: "Decline" is misleading once Phase 2 is on.
- (b) Add a status the helper excludes (`'declined'`), used only by the vendor decline path.
  Cost: a migration touching the helper, and therefore every policy that calls it. Historical
  rows keep `'terminated'` and keep their visibility, so this only affects future declines.
- (c) Delete the row on decline of a **cued** invitation only. Cost: the agency loses the
  record that they contacted this vendor, and the next broadcast re-cues it, which is an
  invitation loop.
- (d) Do not cue account holders at all (option 3 in 2d). Cost: as stated there. **This
  single choice resolves both 2d and 5a**, which is worth weighing.

### 5b. Expiry and tidying. Recommended, not implemented

Sixteen pending invitations exist with no expiry, no tidying, and four are third-party
contacts holding real accounts who can already see a June invitation sitting un-actioned.

**Recommendation: a `expires_at` column with a visible state, not a sweeper that deletes.**

| Model | Cost |
|---|---|
| **Recommended: `partnerships.expires_at`, default 30 days on new pending rows, backfilled NULL on existing.** A pending row past `expires_at` renders as "Expired" and offers the agency a re-invite. Nothing is deleted and no cron is needed - it is a read-time comparison | One migration, one predicate in `partnershipPoolColumn()`, copy on two surfaces. Existing rows keep NULL and never expire, so **the sixteen live invitations are not silently invalidated**, which is the failure mode to avoid |
| Cron sweeper setting status to `'expired'` | Needs a Vercel cron (one is already TODO'd in `broadcast-rfp`), and a background job that mutates rows is exactly the class of thing this project has been bitten by when it silently does nothing |
| Delete pending rows after N days | Destroys the agency's record of contact, and the next broadcast re-creates it |
| Do nothing | The list grows monotonically. With Phase 2 on it grows once per broadcast recipient |

Deliberately **not** implemented, per the brief.

### 5c. What was built

The four silent notification failures above, routed through
`resolveOrgNotificationRecipients()` - the helper that already answers "who do we email for
this organization" at fourteen other sites - with a logged error when resolution fails
instead of a swallowed skip.

---

## Phase 6. Gates

**EXECUTED on `feat/vendor-visibility` at `c00ca1a`:**

| Command | Exit code |
|---|---|
| `npx tsc --noEmit` | **0** |
| `pnpm build` | **0** |
| `pnpm lint` | **1** (154 errors, 28 warnings) |
| `pnpm verify-rls` | **2** |
| `pnpm identity-columns` | **0** |
| `pnpm identity-columns:guard` | **0** |
| `pnpm org-id-reads` | **0** |
| `pnpm org-id-reads:guard` | **0** |
| `pnpm embed-targets` | **0** |
| `pnpm policy-audit` | **0** |
| `pnpm policy-audit:guard` | **1** |

**EXECUTED baseline comparison.** I created a git worktree at `main` and ran the same
commands against it, rather than taking the brief's numbers on trust:

| Command | main | branch | Delta |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | 0 | none |
| `eslint .` | 1, **182 problems (154 errors, 28 warnings)** | 1, **182 problems (154 errors, 28 warnings)** | **identical** |
| `verify-rls` | 2 | 2 | none |
| `policy-audit:guard` | 1 | 1 | none |
| `identity-columns:guard` | 0 | 0 | none |
| `org-id-reads:guard` | 0 | 0 | none |

The three known pre-existing failures are confirmed pre-existing and **unchanged**. This
branch adds **zero** lint errors and **zero** lint warnings.

`pnpm org-id-reads:guard` additionally reports its known-open baseline **shrinking**:
25 known-open sites before this branch, **18** after; class B from 71 to **66**.

Markdown link corruption check (`grep -rl "\](http://" app/ lib/`): EXECUTED, **no matches**.

---

## What I could NOT establish

Listed rather than resolved by guess.

1. **Whether `partnerships` currently holds duplicate pairs.** Decides whether migration 084
   can be applied at all. Query is in 084's stop gate. No database access.
2. **Whether the sixteen pending invitations include rows that would be affected by 084.**
   Same reason.
3. **The brief's Open RFPs evidence.** The brief states the agency name rendered only
   because `is_discoverable = true`; reading the code, the standard broadcast path renders a
   denormalized snapshot that does not depend on discoverability. I could not run the live
   check. Most likely the observed case was a magic-link invitation, whose snapshot **was**
   broken. **Checklist step 9 settles it.**
4. **Whether any `partner_rfp_inbox` rows already carry a wrong `agency_company_name`
   snapshot.** The Phase 3 fix repairs the writer, not rows already written. Query in the
   checklist.
5. **Whether every organization has a `primary_contact_user_id`.** The Phase 3 fixes reach
   the agency's identity through it. It is nullable by design, and a NULL means the vendor
   sees the organization name but no contact. The PHASE 12 trigger should set it; that is
   READ, not verified. Query in the checklist.
6. **Whether RLS nulls or errors on an unreadable embed.** `lib/org-contact.ts` documents
   this as an unverified assumption from a previous pass and I did not resolve it. The code
   handles null either way; the release risk differs (silent blanks versus a visible 400).
7. **Anything about live row counts, statuses or emails.** No SQL was run.

---

## Which phases are independently mergeable

**All six commits are independently mergeable, and none depends on an earlier one being
merged.** Verified by construction, not asserted: each was committed with `tsc`, `build` and
the three working guards green **at that commit**.

| # | Commit | Depends on | Merge alone? |
|---|---|---|---|
| 1 | `6d7b7c6` Phase 1c, id fixes | nothing | **Yes.** Highest value alone |
| 2 | `9408847` Phase 1d, branded types | **1c** (would conflict textually, not logically) | **Yes, with 1c** |
| 3 | `f815fa2` broadcast recipient lookup | nothing | **Yes.** Committed separately so Phase 1 stands complete without Phase 2 |
| 4 | `5ec0bda` Phase 2, the cue | nothing (uses `resolveOrgIdForUser` from 1c, so take 1c too) | **Yes.** And it is **inert** until the flag is set |
| 5 | `01bbe5a` Phase 3, vendor sees agency | nothing | **Yes.** Probably the one to merge first if only one ships |
| 6 | `c00ca1a` Phase 5, decline notifications | nothing | **Yes** |

If only one phase ships, **merge 5 (Phase 3)**: it repairs surfaces that are broken today for
the one live post-079 account, needs no flag, and touches no policy.

If two, add **1** (Phase 1c): it is the highest-severity class and it prevents the same
failures recurring at write time.

---

## What to revert if a phase turns out wrong

| Phase | Revert | What comes back |
|---|---|---|
| **1c** | `git revert 6d7b7c6` (after 1d) | Every helper returns to `.eq(col, <user id>)`. Correct for the 16 legacy accounts, broken for the new one. **Revert 1d first** or the branded types will not compile |
| **1d** | `git revert 9408847` | `OrgId` disappears; ids are bare strings again. `callerOwnsOrg` and `orgIdFromColumn` go with it. **1c keeps working**, it just stops being enforced by the compiler |
| **broadcast lookup** | `git revert f815fa2` | The manual-recipient branch treats a post-079 account holder as a ghost again |
| **2** | **Unset `BROADCAST_CUES_PARTNERSHIP` first.** That stops all new behaviour immediately with no deploy of code. Then `git revert 5ec0bda` if wanted | **Rows already cued are NOT undone by either.** They are ordinary pending `partnerships` rows and must be cleaned up deliberately. Identify them with `partnership_notes ? 'cued_by_broadcast'` |
| **3** | `git revert 01bbe5a` | All seven surfaces return to reading `profiles` by an org id. Correct for legacy accounts, broken for new ones. `ORG_CONTACT_SELECT_MEETING` disappears |
| **5** | `git revert c00ca1a` | The four notification emails go back to silently not sending for post-079 organizations |
| **084** | Not applied. If applied and wrong, run `084_partnership_cue_uniqueness_down.sql`. It drops two indexes and destroys nothing, but the TOCTOU window reopens |

**The one asymmetric item is Phase 2.** Code reverts cleanly; **rows do not**. Unsetting the
flag is the real off switch and it is instant.

---

## NUMBERED LIVE CHECKLIST FOR GREG

Two accounts:

- **A** = `gmarkant@gmail.com`, the "m a r k a n t" lead agency. A legacy account:
  `organizations.id` **equals** its user id, so it cannot falsify anything on its own.
- **B** = `gmarkant+neworg1@gmail.com`, company "New Org 1".
  user id `7cee347d-b224-40c2-a2cf-145c863ade9d`,
  org id `43c6628a-8953-4dc5-96da-fe0ecee5e57c`.
  **These differ. B is the only account that can falsify any of this.** Every step below
  that matters uses B.

Deploy this branch to a **preview** first. `BROADCAST_CUES_PARTNERSHIP` must remain unset
for steps 1 to 12.

### Part 1: read-only database checks (run these before clicking anything)

**1.** Confirm B's ids really do differ, so the rest of the checklist means something.
```sql
SELECT p.id AS user_id, om.org_id, o.name, o.primary_contact_user_id
  FROM profiles p
  JOIN org_members om ON om.user_id = p.id
  JOIN organizations o ON o.id = om.org_id
 WHERE p.email = 'gmarkant+neworg1@gmail.com';
```
**Expect:** one row. `user_id` = `7cee347d...`, `org_id` = `43c6628a...`, and they must
differ. **If `primary_contact_user_id` is NULL, stop and tell me** - several Phase 3 fixes
reach the agency's contact through it, and NULL means the vendor sees a company name with no
contact. (This is item 5 in "could not establish".)

**2.** Does any organization lack a primary contact?
```sql
SELECT count(*) FROM organizations WHERE primary_contact_user_id IS NULL;
```
**Expect:** 0. Any other number is a gap in the PHASE 12 trigger and affects every
organization-to-organization name resolution.

**3.** The migration 084 stop gate. Run **both** queries in
`supabase/migrations/084_partnership_cue_uniqueness.sql`.
**Expect:** 0 rows from each. **If either returns rows, do not apply 084** and send me the
output - collapsing duplicates is a decision on the actual rows, not a rule.

**4.** How many `partner_rfp_inbox` rows already carry a broken agency name snapshot?
```sql
SELECT count(*) AS broken_snapshots
  FROM partner_rfp_inbox
 WHERE agency_company_name IN ('Lead agency', 'Lead Agency');
```
**Expect:** unknown. The Phase 3 fix repairs the **writer**, not rows already written.
Anything above 0 is history that needs a one-off `UPDATE` from `organizations.name`, which I
have deliberately not written.

### Part 2: Phase 3, the vendor seeing the agency (flag stays OFF)

**5.** Sign in as **A**. Go to `/agency/pool`. Add **B** as a vendor by email
(`gmarkant+neworg1@gmail.com`) and send the invitation.
**Expect:** the row appears in the **Invited** column. **What this proves:** the Phase 1c fix
to `markPartnershipInvited` and `POST /api/partnerships` writes B's **organization** id
(`43c6628a...`) into `vendor_org_id`, not B's user id. Before this branch it wrote B's
profiles id and would have raised 23503 against `organizations(id)`.

**6.** Sign in as **B**. Go to `/partner/network`, **Invitations** tab.
**Expect:** the invitation from **A** is listed, showing "m a r k a n t" as the agency name,
**not** "Lead Agency" or blank.

**7.** Still as **B**, on that invitation card click **View Profile** (or open A from
**My Agencies** after accepting).
**Expect:** A's profile opens. **Expect NOT to see "This agency's profile is private".** That
message on an account you have a partnership with is the exact Phase 3c bug and means the fix
did not take.

**8.** Accept the invitation as **B**. Then check **A**'s inbox.
**Expect:** an email, subject `[B's company] accepted your partnership invitation`.
**What this proves:** the Phase 5 fix. Before this branch, accepting an invitation from a
post-079 organization sent **nothing** - the lookup found no row and the send was skipped in
silence. **A missing email here is the single clearest sign Phase 5 did not deploy.**

**9. THE STEP THAT SETTLES THE OPEN QUESTION.** As **A**, send a **Lightning RFP / magic
link** to B's address. Then as **B**, open `/partner/rfps`.
**Expect:** the RFP is grouped under **"m a r k a n t"**, not under **"Lead agency"**.
**What this proves:** `lib/magic-token-attach.ts` now reads `organizations` instead of
`profiles`. This is item 3 in "could not establish" - if it reads "Lead agency" here, the
snapshot writer is still wrong and I need to know.

**10.** Still as **B**, open that RFP's detail page.
**Expect:** if A has a `meeting_url` set in their user settings, a **"Book a call"** button
renders. If A has none set, no button, and that is correct. Set one on A first if you want
this step to mean anything.

**11.** As **B**, open `/partner/payments` and `/partner/projects`.
**Expect:** every lead agency reads **"m a r k a n t"**, never "Agency" or "Lead Agency".

**12.** If B has an awarded engagement with A, open it under `/partner/projects/[id]`.
**Expect:** the lead agency block renders with a name and an email. Before this branch this
route raised PGRST116, logged it, and rendered the whole block empty.

### Part 3: Phase 2, the cue. Do this LAST and on PREVIEW only

**Do not do Part 3 on production until you have ruled on section 2d of this report.**
Turning this on means a lead agency who merely emails a vendor an RFP can immediately read
that vendor's standing payment terms, kill fee and insurance limits, and the vendor can read
the agency's. Sixteen pending invitations already exist and eight are real third-party
contacts.

**13.** Confirm the flag is genuinely off. With `BROADCAST_CUES_PARTNERSHIP` unset, as **A**
broadcast an RFP to a **new** email address that has never been used, e.g.
`gmarkant+cuetest1@gmail.com`.
```sql
SELECT count(*) FROM partnerships WHERE partner_email = 'gmarkant+cuetest1@gmail.com';
```
**Expect: 0.** **If this is not 0, the flag is not working and nothing below should be run.**

**14.** Set `BROADCAST_CUES_PARTNERSHIP=true` on the **preview** environment and redeploy.

**15. THE CASE MOST LIKELY TO BE WRONG: a broadcast to an address with NO account.**
As **A**, broadcast an RFP to `gmarkant+cuetest2@gmail.com`, an address with no Ligament
account.
```sql
SELECT lead_org_id, vendor_org_id, status, profile_status, invitation_sent_at,
       partnership_notes -> 'cued_by_broadcast' AS cue
  FROM partnerships WHERE partner_email = 'gmarkant+cuetest2@gmail.com';
```
**Expect exactly one row**, with:
- `vendor_org_id` **NULL** (a ghost - this is the point),
- `status` = `'pending'`,
- `profile_status` = `'unclaimed'`,
- `invitation_sent_at` **NULL** (so it does **not** appear in A's Invited column),
- `cue` a JSON object with `at`, `project_id`, `scope_item_name`.

**16.** As **A**, open `/agency/pool`.
**Expect:** that address appears under **Discovered**, **not** under **Invited**. If it shows
as Invited, `invitation_sent_at` was stamped and a side effect is masquerading as a decision.

**17. Idempotency.** Broadcast the **same** RFP to the **same** address again.
Re-run the query from step 15.
**Expect: still exactly one row.** Two rows means the dedupe failed and 084 is required
before this ships.

**18.** Now sign up a new account using `gmarkant+cuetest2@gmail.com`. Complete signup and
land in the vendor portal.
Re-run the query from step 15.
**Expect:** `vendor_org_id` is now **populated** with the new account's organization id, and
`status` is **still `'pending'`**. The ghost was claimed and promoted; the vendor is
**invited, not partnered**. If `status` flipped to `'active'`, something accepted on the
vendor's behalf and that is wrong.

**19.** In that new account, open `/partner/network`, **Invitations** tab.
**Expect:** the invitation is listed under an **"Opened by an RFP"** label with the copy
beginning "sent you an RFP, which opens an invitation to partner", **not** the deliberate
"has invited you to join their vendor network" copy.

**20.** In the same account, open `/partner/rfps`.
**Expect:** the RFP is there and is **fully answerable**. Declining the invitation in step 21
must not change that.

**21.** Decline the invitation. Then re-open `/partner/rfps`.
**Expect:** the invitation leaves the Invitations tab, **and the RFP is still there and still
biddable**. That is the ruling: the RFP is a transaction, the partnership is a relationship.
Check **A**'s inbox for a `declined your partnership invitation` email.

**22.** Broadcast to **B** (who by now has an active partnership with A from step 8).
Re-run step 15's query against B's email.
**Expect:** **no new row.** Case (i) is skipped and the existing partnership is untouched -
in particular its `status` must still be `'active'`.

**23.** Turn the flag back off (`BROADCAST_CUES_PARTNERSHIP` unset) and redeploy preview.
**Expect:** further broadcasts create no rows. **The rows already created in steps 15 to 22
remain.** Delete them by hand if you want a clean state; identify them with
`partnership_notes ? 'cued_by_broadcast'`.

### Part 4: what to send me back

- Output of steps 1, 2, 3, 4 (the read-only queries).
- Whether step 9 read "m a r k a n t" or "Lead agency".
- Whether step 8's email arrived.
- Whether step 17 produced one row or two.
- Your ruling on section 2d before Part 3 is ever run on production.
