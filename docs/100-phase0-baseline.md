# 100 - Phase 0 baseline for the notification routing run

Recorded before any non-doc file in this session was edited, on branch
`feat/notification-routing` cut from `f61409f fix: 099's WITH CHECK was too narrow in two
ways. Both closed.`, working tree clean.

The branch had **zero commits of its own** when every command in section 1 ran.
`git diff main --stat` was empty and `git status --porcelain` was empty, so the tree those
numbers describe is byte-for-byte `main`. The throwaway-worktree confirmation of the three
known-failing gates is owed at Phase 4 and is recorded there, not here.

Everything outside section 1 was **READ FROM SOURCE**. No database was queried. This session
has no working credentials and is prohibited from seeking them. Every question that needs a
row count or a live constraint definition is written into section 9 as a checklist item for
Greg, not guessed at.

---

## 1. The gates, as measured. EXECUTED.

| # | Command | Exit | Measured |
|---|---------|------|----------|
| 1 | `npx tsc --noEmit` | **0** | zero diagnostic lines |
| 2 | `pnpm build` | **0** | compiled in 8.4s, 72/72 static pages |
| 3 | `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)** |
| 4 | `pnpm identity-columns:guard` | **0** | GUARD PASSED, no legacy identity column names |
| 5 | `pnpm org-id-reads:guard` | **0** | class A 14 / class B 60, no growth, GUARD PASSED |
| 6 | `pnpm embed-targets --guard` | **0** | EMBED GUARD PASSED |
| 7 | `pnpm policy-audit:guard` | **1** | pre-existing, reads a static snapshot |
| 8 | `pnpm verify-rls` | **2** | pre-existing, PostgREST does not expose `pg_class` here |

Gates 3, 7 and 8 fail on `main`. **That is this tree.** The numbers to hold at Phase 4 are
**182 / 154 / 28** for lint, and exits 1 and 2 for the two database-reading scripts. These are
the same numbers 099's baseline recorded, which is the expected result for a tree that has not
changed since.

---

## 2. THE DEFECT, RESTATED AGAINST THE SOURCE. It is not the one in the brief.

### THE BRIEF SAYS: "clicking a notification in the panel does nothing... only the click target is missing."

### THE SOURCE SAYS: the click target has been there since the bell shipped, and it fires.

`components/notification-bell.tsx:451-455` renders every row as a real `<button
type="button">` with `onClick={() => openNotification(n)}`, and:

```ts
components/notification-bell.tsx:318-321
  const openNotification = (n: NotificationRow) => {
    setOpen(false)
    if (n.link) router.push(n.link)
  }
```

`notifications.link` is selected (`select('*')`, `app/api/notifications/route.ts:121`) and is
carried on the `NotificationRow` type (`:80`). **Every one of the write sites sets it** - all
nine helpers in `lib/notifications.ts` plus the three direct `createOrgNotification` calls, and
there are no others (section 3 enumerates them). So `n.link` is never null on a row this
product wrote, and `router.push` is reached.

This matters because "add an onClick" is not the fix, and shipping it would change nothing.

### SO WHAT WAS ACTUALLY OBSERVED? TWO MECHANISMS, BOTH REAL IN SOURCE, NEITHER REPRODUCED LIVE.

**M1. Every agency-side destination is a bare list URL, so the push is a visual no-op whenever
the viewer is already on that list.** `bid_submitted` - the exact type in the brief's example,
"April Partner Test Agency updated their bid on Lead Agency Management and Coordination" -
carries `link: '/agency/bids'` (`lib/notifications.ts:notifyBidSubmitted`). Pushing
`/agency/bids` while standing on `/agency/bids` closes the panel and moves nothing. `/agency/bids`
is where an agency reviews bids, so it is the single most likely page to be standing on when
that notification is clicked.

**M2. A row whose destination is the OTHER portal is bounced by middleware to this portal's
home, silently, with the destination discarded.** `middleware.ts:123-133`:

```ts
if (isAgencyRoute && activeRole === 'partner') { url.pathname = '/partner';          redirect }
if (isPartnerRoute && activeRole === 'agency')  { url.pathname = '/agency/dashboard'; redirect }
```

No message, no `next` parameter, no trace. If the viewer was already on the portal home, the
observable result is again that nothing happened. Section 5 establishes that this case is not
hypothetical: the bell shows the same rows in both portals.

**AND THE BRIEF'S SECOND SENTENCE IS THE REAL DEFECT, EXACTLY AS WRITTEN.** "A notification
reading ... cannot take you to that bid." It cannot, and the reason is not the click handler:
**no `link` written by this product carries a record identifier for a bid, even though the row's
`data` jsonb holds one.** `notifyBidSubmitted` writes `data: { responseId, ... }` and
`link: '/agency/bids'` in the same call. The identifier is on the row and the URL throws it away.

**WHAT I COULD NOT ESTABLISH.** Which of M1 or M2 Greg saw on 2026-09-14. Both produce the same
report. I have no live session and did not run the app. Section 9 item Q1 is the check that
distinguishes them, and it costs one click.

### ONE MORE THING THE CLICK DOES NOT DO TODAY: IT DOES NOT MARK READ.

`openNotification` closes the panel and navigates. Nothing sets `read`. The ONLY thing that
marks anything read in this product is the "Mark all read" control (`:289-316`), which PATCHes
`{ markAllRead: true }`. So clicking a single row leaves it unread and the badge unchanged.

This is stated here because the brief's 1a says "do not lose the read" if navigation and read
are currently one behaviour. **They are not one behaviour. There is no per-row read to lose.**
Per-row read is therefore NEW behaviour in Phase 1, and it needs no new endpoint: `PATCH
/api/notifications` already accepts `{ notificationIds: [...] }` and scopes the UPDATE to
`user_id = auth.uid()` server-side (`app/api/notifications/route.ts:220-231`).

---

## 3. (0a) EVERY NOTIFICATION TYPE, AND WHETHER THE TWO LISTS AGREE

### THE ANSWER: **THIRTEEN EACH. THEY AGREE. No disagreement to report.**

The union, `lib/notifications.ts:265-289` (13 members), against the CHECK constraint as widened
by `supabase/migrations/099_rfp_closure.sql:574-595` (13 values, quoted at 099's line numbers
inside its transaction, and superseding 095's eleven at `095_notification_types.sql:312-331`):

| # | Value | In `NotificationType` | In 099's CHECK | Added by |
|---|---|---|---|---|
| 1 | `partnership_invitation` | yes | yes | pre-095 |
| 2 | `partnership_accepted` | yes | yes | pre-095 |
| 3 | `project_assignment` | yes | yes | pre-095 |
| 4 | `project_accepted` | yes | yes | pre-095 |
| 5 | `project_declined` | yes | yes | pre-095 |
| 6 | `new_message` | yes | yes | pre-095 |
| 7 | `document_uploaded` | yes | yes | pre-095 |
| 8 | `project_awarded` | yes | yes | pre-095 |
| 9 | `partnership_declined` | yes | yes | 095 |
| 10 | `onboarding_deployed` | yes | yes | 095 |
| 11 | `bid_submitted` | yes | yes | 095 |
| 12 | `rfp_closed` | yes | yes | 099 |
| 13 | `rfp_not_selected` | yes | yes | 099 |

Set difference in both directions is empty. **Nothing still checks that they agree** - 095's own
`COMMENT ON CONSTRAINT` says so in as many words, and 099 repeats it - so this is a measurement
of today, not a guarantee about tomorrow.

### WHAT THIS CANNOT PROVE, AND IT IS THE SAME LIMIT 099 RECORDED

That the LIVE constraint matches the file. `LIGAMENT_CONTEXT.md` is explicit that the on-disk
history cannot reproduce the live database. 099 is recorded as applied to production, and its
own `DROP CONSTRAINT IF EXISTS ... , ADD CONSTRAINT` form makes the file correct whatever the
prior live list was, so the expectation is that live now holds exactly these thirteen.
**Query Q2 in section 9 settles it.** Nothing in this run writes a notification type, so a
mismatch would not be caused by this run - but it would silently decide which rows can exist to
be routed.

### A THIRD LIST NOBODY HAS MENTIONED, AND IT IS OUT OF SYNC

`components/notification-bell.tsx:118-130` holds `TYPE_LABELS`, and its header says "The eleven
keys are exactly `NotificationType`". **It has eleven keys and the union now has thirteen.**
`rfp_closed` and `rfp_not_selected` are missing, so both render through
`unknownTypeLabel()` (`:141-147`) as the grey category label **"Rfp closed"** and **"Rfp not
selected"**.

This is not a bug in the sense that it loses anything - the fallback exists precisely for this
and the file says so - but it is a visible cosmetic gap that shipped with 099, and it is in the
file this run has to edit anyway. Recorded as finding **F1**. Fixing it is a two-line addition
and is proposed for Phase 1.

---

## 4. (0b) WHAT EACH NOTIFICATION CARRIES, AND WHO RECEIVES IT

Read from the INSERT SITES, not from the table definition. There is no `CREATE TABLE
notifications` anywhere in this repository (confirmed: no match in `scripts/` or
`supabase/migrations/`), so the column list cannot be read from source at all and the payload
must be read from the writers.

**THE COMPLETE SET OF WRITERS.** Two functions insert into `notifications`, both in
`lib/notifications.ts`: `createOrgNotification` (`:216`, `:232`) and `createNotification`
(`:315`). **`createNotification` has zero callers** - every reference to it in the repository
is a comment recording what a site used to be. So every row in the table was written through
`createOrgNotification`, by one of nine helpers or one of three direct calls, listed below.
There is no fourteenth site and no out-of-band writer in application code.

**WHO RECEIVES.** `createOrgNotification` takes an ORGANIZATION id and fans out one row per
`org_members.user_id` (the ruling at the head of `lib/notifications.ts`). So the recipient SIDE
is fixed by which org id the call site passes, and it is not a property of the type in the
database - it is a property of the call site. Every call site is consistent within its type, and
that is checked below.

| # | Type | Write site(s) | Recipient org | Identifiers on the row (`data`) | `link` written today |
|---|---|---|---|---|---|
| 1 | `partnership_invitation` | `notifyPartnershipInvitation` <- `app/api/partnerships/route.ts:584`, `:716` | `vendorOrgId` -> **VENDOR** | `partnershipId`, `agencyName` | `/partner/invitations` |
| 2 | `partnership_accepted` | `notifyPartnershipAccepted` <- `app/api/partnerships/route.ts:1046`, `lib/award-partnership-resolution.ts:103`, `:169` | `leadOrgId` -> **AGENCY** | `partnershipId`, `partnerName` | `/agency/pool` |
| 3 | `partnership_declined` | `notifyPartnershipDeclined` <- `app/api/partnerships/route.ts:1200` | `leadOrgId` -> **AGENCY** | `partnershipId`, `partnerName` | `/agency/pool` |
| 4a | `project_assignment` | `notifyProjectAssignment` <- `app/api/projects/[id]/assignments/route.ts:205` | `vendorOrgId` -> **VENDOR** | `assignmentId`, **`projectId`**, `projectName`, `agencyName` | `/partner/projects/{projectId}` |
| 4b | `project_assignment` | `lib/magic-token-attach.ts:413` (direct) | vendor org -> **VENDOR** | **`inboxId`**, `magicToken` | `/partner/rfps/{inboxId}` |
| 5 | `project_accepted` | `notifyProjectResponse` <- `app/api/projects/[id]/assignments/route.ts:341` | `leadOrgId` -> **AGENCY** | `projectId`, `projectName`, `partnerName`, `accepted` | `/agency/bids` |
| 6 | `project_declined` | same site, same call | `leadOrgId` -> **AGENCY** | same | `/agency/bids` |
| 7 | `new_message` | **NONE** | n/a | n/a | n/a |
| 8 | `document_uploaded` | **NONE** | n/a | n/a | n/a |
| 9 | `project_awarded` | `notifyProjectAwarded` <- `app/api/projects/[id]/assignments/route.ts:437`, `app/api/agency/rfp-responses/[id]/route.ts:1084` | `vendorOrgId` -> **VENDOR** | **`projectId`**, `projectName`, `agencyName` | `/partner/projects/{projectId}` |
| 10a | `onboarding_deployed` | `app/api/projects/[id]/onboarding-packages/route.ts:448` (direct) | `vendorOrgId` -> **VENDOR** | `projectId`, `packageId` | `/partner/onboarding` |
| 10b | `onboarding_deployed` | `app/api/projects/[id]/onboarding/deploy/route.ts:176` (direct) | vendor org -> **VENDOR** | `projectId`, `assignmentId`, `deploymentId` | `/partner/projects/{projectId}?tab=onboarding` |
| 11 | `bid_submitted` | `notifyBidSubmitted` <- `app/api/partner/rfps/[id]/response/route.ts:466`, `app/api/rfp/guest/[token]/route.ts:583`, `:768` | `leadOrgId` / token `org_id` -> **AGENCY** | **`responseId`**, `scopeItemName`, `vendorNameOrEmail`, `isRevision` | `/agency/bids` |
| 12 | `rfp_closed` | `notifyRfpClosed` <- `app/api/agency/rfp-closure/route.ts:409` | `vendorOrgId` -> **VENDOR** | **none.** `scopeItemName`, `agencyName` are display strings | `/partner/rfps` |
| 13 | `rfp_not_selected` | `notifyRfpNotSelected` <- `app/api/agency/rfp-closure/route.ts:410` | `vendorOrgId` -> **VENDOR** | **none.** `scopeItemName`, `agencyName` are display strings | `/partner/rfps` |

### THE FINDINGS THAT FALL OUT OF THAT TABLE

**F2. TWO TYPES HAVE NO WRITE SITE AT ALL.** `new_message` and `document_uploaded` are declared
in the union and permitted by the constraint, and **nothing in the repository writes either**
(grep for both literals across `app/`, `lib/` and `components/` returns only the union
declaration itself). No row of these types can exist unless one was written out of band. They
carry no identifier because they carry nothing. They are UNROUTABLE by absence, not by
judgment. Note that `LIGAMENT_CONTEXT.md`'s email trigger map DOES list a "New project message"
email, sent from `app/api/projects/[id]/messages/route.ts` - so the event happens, the email
goes out, and **the in-app type for it was declared and never wired.** Recorded, not fixed:
wiring a new notification emitter is a feature, not a routing fix.

**F3. `project_assignment` IS TWO DIFFERENT PAYLOAD SHAPES UNDER ONE TYPE.** 4a carries
`projectId` and no inbox id. 4b carries `inboxId` and no project id. **A routing table keyed on
type alone cannot serve both**: reading `data.projectId` on a 4b row yields undefined and
reading `data.inboxId` on a 4a row yields undefined. Whatever Phase 1 builds has to branch on
which key is present, not on the type. This is the single most likely thing to get silently
wrong in this run, because the failure is a URL with the string "undefined" in it rather than an
error.

**F4. `onboarding_deployed` IS ALSO TWO SHAPES, AND THE TWO SITES DISAGREE ABOUT THE
DESTINATION.** 10a sends to `/partner/onboarding`; 10b sends to
`/partner/projects/{projectId}?tab=onboarding`. Same event class, same type, two different
pages. 10b's site is the DORMANT onboarding flow (`CLAUDE.md` lists
`app/api/projects/[id]/onboarding/deploy/route.ts` as "Dormant onboarding flow
(Stage03OnboardingProduction - not mounted)"), so in practice today only 10a fires - but both
are live code and both are in the type.

**F5. TWO OF THE THIRTEEN CARRY NO IDENTIFIER, AND SAYING SO IS THE ANSWER.** `rfp_closed` and
`rfp_not_selected` carry `scopeItemName` and `agencyName`, which are **display strings, not
keys**. `app/api/agency/rfp-closure/route.ts:409-410` has the inbox row in hand (`row.vendor_org_id`
is read from it on the same line) and passes neither its id nor the project id. So these two
cannot be routed to a record by any means available at read time. They can only be routed to a
list. Options for changing that are in section 7.

---

## 5. (0c) THE ROUTING TABLE, KEYED ON (TYPE, VIEWER SIDE)

### FIRST, THE FACT THAT MAKES THE VIEWER SIDE A REAL KEY AND NOT A FORMALITY

**THE BELL SHOWS THE SAME ROWS IN BOTH PORTALS. IT DOES NOT FILTER BY PORTAL.**

- One component, not two: `components/notification-bell.tsx`, mounted at
  `components/agency-layout.tsx:509` as `variant="agency"` and at
  `components/partner-layout.tsx:224` as `variant="vendor"`.
- `variant` is used for **colour only**. Every use of `isAgency` in that file is a className
  branch. It reaches no query, no filter and no destination.
- The query is `/api/notifications?limit=20` with no type and no side parameter, and the
  endpoint scopes on `user_id = auth.uid()` alone (`app/api/notifications/route.ts:122`).

So for a user who holds both roles - the case the brief names, and `profiles.secondary_role` /
`active_role` exist to serve - **every notification appears in both portals**, including the ones
whose destination is the other portal.

### AND THE ORG MODEL MEANS ONE USER REALLY DOES RECEIVE BOTH SIDES

Notifications are addressed to `org_members.user_id` of the recipient organization. Migration
079 creates one organization per profile, and `organizations` carries both `is_lead_agency` and
`is_vendor`, so one organization can be the lead agency in one partnership and the vendor in
another. The same user id therefore legitimately receives `bid_submitted` (as the agency) and
`project_awarded` (as the vendor), and sees both rows in whichever portal they are standing in.

### WHAT HAPPENS TODAY WHEN THE SIDE IS WRONG, AND HOW THE PORTAL IS DECIDED

The destination does NOT choose its portal. **`middleware.ts` chooses, from
`profiles.active_role`, and it does not ask where you were going.** Reading
`middleware.ts:113-133`:

- `activeRole` is `profiles.active_role`, falling back to `profiles.role`, falling back to
  `user_metadata.role`.
- Agency route while `activeRole === 'partner'` -> **redirect to `/partner`**. Destination
  discarded. No `next` parameter is set on this branch (`buildAuthRedirect`, which does preserve
  `next`, is used only for the unauthenticated case).
- Partner route while `activeRole === 'agency'` -> **redirect to `/agency/dashboard`**. Same.

So clicking an out-of-portal notification today takes you to your own portal's home page and
tells you nothing. **If you were already on that home page, nothing visibly happens** - which is
mechanism M2 in section 2.

**MUST THE MODE SWITCH?** To land on the record, yes: there is no way to render `/agency/bids`
while `active_role = 'partner'`. Switching is possible - `POST /api/profile/switch-role`
exists and flips `active_role`, and `app/components` already drive it from the portal toggle -
but **clicking a notification would then silently change which portal the user is in**, which is
a product decision about a side effect, not a routing detail. **It is listed UNROUTED below and
put to Greg in section 7 as R1.**

### THE TABLE. 13 TYPES x 2 VIEWER SIDES = 26 CELLS.

"Native" means the viewer side matches the side the write site addresses (section 4). "Foreign"
means a dual-role user is seeing the row from the other portal.

| # | Type | Viewer side | Destination surface | URL shape | Identifier needed | Present per 0b? | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | `partnership_invitation` | **vendor** (native) | Vendor network, Invitations tab | `/partner/network?tab=invitations` | none (list) | n/a | **ROUTED (list)** |
| 1 | `partnership_invitation` | agency (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 2 | `partnership_accepted` | **agency** (native) | Agency partner pool | `/agency/pool` | none (list) | n/a | **ROUTED (list).** Record-level blocked, see F6 |
| 2 | `partnership_accepted` | vendor (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 3 | `partnership_declined` | **agency** (native) | Agency partner pool | `/agency/pool` | none (list) | n/a | **ROUTED (list).** Record-level blocked, see F6 |
| 3 | `partnership_declined` | vendor (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 4a | `project_assignment` (assignments) | **vendor** (native) | Vendor project detail | `/partner/projects/{projectId}` | `data.projectId` | **YES** | **ROUTED (record)** |
| 4b | `project_assignment` (magic token) | **vendor** (native) | Vendor RFP detail | `/partner/rfps/{inboxId}` | `data.inboxId` | **YES** | **ROUTED (record)** |
| 4 | `project_assignment` | agency (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 5 | `project_accepted` | **agency** (native) | Agency bid management | `/agency/bids` | none usable, see F7 | n/a | **ROUTED (list)** |
| 5 | `project_accepted` | vendor (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 6 | `project_declined` | **agency** (native) | Agency bid management | `/agency/bids` | none usable, see F7 | n/a | **ROUTED (list)** |
| 6 | `project_declined` | vendor (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 7 | `new_message` | either | - | - | - | **no row can exist** | **UNROUTABLE** (F2) |
| 8 | `document_uploaded` | either | - | - | - | **no row can exist** | **UNROUTABLE** (F2) |
| 9 | `project_awarded` | **vendor** (native) | Vendor project detail | `/partner/projects/{projectId}` | `data.projectId` | **YES** | **ROUTED (record)** |
| 9 | `project_awarded` | agency (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 10a | `onboarding_deployed` (packages) | **vendor** (native) | Vendor onboarding list | `/partner/onboarding` | none read by surface, see F8 | n/a | **ROUTED (list)** |
| 10b | `onboarding_deployed` (deploy, dormant) | **vendor** (native) | Vendor project detail | `/partner/projects/{projectId}` | `data.projectId` | **YES** | **ROUTED (record)** |
| 10 | `onboarding_deployed` | agency (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 11 | `bid_submitted` | **agency** (native) | Agency bid management, that bid's detail sheet | `/agency/bids?response={responseId}` | `data.responseId` | **YES** | **ROUTED (record).** THE BRIEF'S DEFECT |
| 11 | `bid_submitted` | vendor (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 12 | `rfp_closed` | **vendor** (native) | Vendor RFPs, **Closed tab** | `/partner/rfps?tab=closed` | none exists (F5) | **NO** | **ROUTED (list).** Record-level impossible |
| 12 | `rfp_closed` | agency (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |
| 13 | `rfp_not_selected` | **vendor** (native) | Vendor RFPs, **Closed tab** | `/partner/rfps?tab=closed` | none exists (F5) | **NO** | **ROUTED (list).** Record-level impossible |
| 13 | `rfp_not_selected` | agency (foreign) | - | - | - | - | **UNROUTED** (cross-portal, R1) |

### THE THREE DESTINATIONS THAT HIDE THE THING THE NOTIFICATION NAMES

Three of the URLs above are not the URLs written today, and each is a one-parameter change to
the destination rather than a new surface. All three were found by reading the destination,
not by assuming it.

**F9. `/partner/rfps` lands on a tab that deliberately excludes closed rows.**
`components/partner-rfp-surface.tsx:572` initialises `const [activeTab, setActiveTab] =
useState<RfpTab>(surface === "bids" ? "my-bids" : "open")` and **nothing reads a tab from the
URL** (`useSearchParams` is used at `:560-564` for `invite`, `invite_status` and `nda` only).
Closed rows are partitioned out of the open list at `:632-639` and rendered only under
`activeTab === "closed"` (`:934`). So today an `rfp_closed` notification takes the vendor to a
list that is defined as not containing it. `?tab=closed` fixes that.

**F10. `/partner/invitations` lands on the wrong tab of `/partner/network`.**
`app/partner/invitations/page.tsx` is a `redirect("/partner/network")` stub, and
`app/partner/network/page.tsx:314` initialises `activeTab` to `"my-agencies"` with no URL
parameter, while the invitation lives under `"invitations"` (`:723`, `type Tab` at `:132`).
`?tab=invitations` fixes that.

**F11. Two `link`s already carry a query parameter the destination does not read.** 10b writes
`/partner/projects/{projectId}?tab=onboarding`, and `app/partner/projects/[projectId]/page.tsx`
reads no search parameters at all. The parameter has always been inert. Same for the deploy
email, see section 6.

### THE OTHER FINDINGS BEHIND THE "list" VERDICTS

**F6. `partnership_accepted` / `partnership_declined` cannot reach a record, and the blocker is
the payload, not the surface.** A per-partner surface exists at `/agency/pool/[partnerId]`, and
its parameter is a **vendor organization / profile id**, not a partnership id
(`app/agency/pool/[partnerId]/page.tsx:151`, then `:259` `.eq("vendor_org_id", partnerId)` and
`:737` which takes `profile.partnership.id` SEPARATELY and says in a comment that the two are
different things). The notification carries only `partnershipId`. There is no way to turn one
into the other at read time without a new query. Option in section 7 as R2.

**F7. `project_accepted` / `project_declined` carry `projectId`, and `/agency/bids` has no
project parameter.** The page groups by client or project in component state
(`app/agency/bids/page.tsx:575` `groupBy`) and reads no search parameters at all. Routing these
to a record would mean either a project filter parameter on the bids page or a different
destination, and neither is forced by this run. Left at the list.

**F8. `onboarding_deployed` (10a) carries `projectId` and `packageId`, and
`/partner/onboarding` reads no search parameters.** Confirmed by grep: the only matches for
`"project"` in `app/partner/onboarding/page.tsx` are a discriminant on a local
`type: "agency" | "project"` union, not a query parameter. Left at the list.

### AN EMPTY UNROUTED LIST WOULD BE A WARNING SIGN. THIS ONE IS NOT EMPTY.

**UNROUTED, awaiting Greg:** all 11 cross-portal (foreign) cells, as one ruling (R1).
**UNROUTABLE by absence:** `new_message`, `document_uploaded` (F2).
**ROUTED to a list only, record-level deliberately not attempted:** `partnership_accepted`,
`partnership_declined` (F6), `project_accepted`, `project_declined` (F7), `onboarding_deployed`
10a (F8), `rfp_closed`, `rfp_not_selected` (F5, impossible rather than deferred).
**ROUTED to the record:** `bid_submitted` agency, `project_assignment` both shapes,
`project_awarded`, `onboarding_deployed` 10b.

---

## 6. (0e) THE EMAIL DEEP LINKS, AGAINST THE IN-APP LINKS

Inventoried by grepping every `ctaUrl` in `app/` and `lib/`, then reading each. Only the events
that ALSO write an in-app notification are compared; the rest are listed after.

| Event | In-app `link` today | Email `ctaUrl` | Agree? |
|---|---|---|---|
| Bid submitted / revised | `/agency/bids` | `/agency/bids` (`lib/email.ts:304`, `buildAgencyBidNotificationEmail`) | **YES** |
| Vendor accepted/declined a project invite | `/agency/bids` | `/agency/bids` (`app/api/projects/[id]/assignments/route.ts:377`) | **YES** |
| Partnership accepted | `/agency/pool` | `/agency/pool` (`app/api/partnerships/route.ts:1122`) | **YES** |
| Partnership declined | `/agency/pool` | `/agency/pool` (`app/api/partnerships/route.ts:1267`) | **YES** |
| NDA signed by vendor | n/a (no in-app type) | `/agency/pool` (`app/api/partner/rfps/[id]/nda-notify/route.ts:106`) | n/a |
| RFP closed / not selected | `/partner/rfps` | `/partner/rfps` (`app/api/agency/rfp-closure/route.ts:474`) | **YES, and both are wrong the same way** (F9) |
| Project assignment / invite to bid | `/partner/projects/{projectId}` | **`/partner/rfps`** (`app/api/projects/[id]/assignments/route.ts:261`) | **NO. F12** |
| Project awarded | `/partner/projects/{projectId}` | **`/partner/rfps`** (`app/api/agency/rfp-responses/[id]/route.ts:1070`) and **`/partner/projects`** (`app/api/projects/[id]/assignments/route.ts:464`) | **NO. F13** |
| Onboarding package sent (10a) | `/partner/onboarding` | `/partner/onboarding` (`app/api/projects/[id]/onboarding-packages/route.ts:415`) | **YES** |
| Onboarding deployed (10b, dormant) | `/partner/projects/{id}?tab=onboarding` | **`/partner/onboarding?project={id}`** (`app/api/projects/[id]/onboarding/deploy/route.ts:169`) | **NO. F14** |
| Partnership invitation | `/partner/invitations` | `acceptUrl`, branching on whether the invitee has an account (`app/api/partnerships/route.ts:589`, `:722`) | **PARTIAL. F15** |

### THE DISAGREEMENTS, AS FINDINGS

**F12. Project assignment: email says `/partner/rfps`, bell says `/partner/projects/{id}`.** Two
different pages for one event. The email is arguably the better of the two for an *invitation to
bid* (the vendor has not been awarded anything yet, so a project detail page that only renders
awarded engagements will show them an empty state - see section 8). **This is a real
contradiction and the email may be the correct side of it.** Put to Greg as R3.

**F13. Project awarded: THREE destinations for one event.** Bell `/partner/projects/{projectId}`,
one email `/partner/rfps`, another email `/partner/projects` (the list, no id). The bell's is the
most specific and is the only one of the three that names the record.

**F14. Onboarding deployed (dormant): email points at `/partner/onboarding?project={id}`, bell
at `/partner/projects/{id}?tab=onboarding`.** Different pages, and **both query parameters are
inert** - neither destination reads a search parameter (F11, F8).

**F15. Partnership invitation: the email deliberately branches and the bell cannot.** The email
sends an existing account to the portal and a new address to signup with an invite token; the
bell only ever exists for a user who already has an account, so `/partner/network?tab=invitations`
is the right single answer and this is a difference rather than a contradiction. No action.

### EMAIL DEEP LINKS WITH NO IN-APP COUNTERPART AT ALL

Listed for completeness, because each is an event where a bell row would be expected and there
is none. Not in scope for this run; this is the F2 gap seen from the email side.

`/partner/rfps` from RFP broadcast (`app/api/agency/broadcast-rfp/route.ts:481`, `:613`, `:668`
and `resend-invite/route.ts:143`) and from bid feedback / decline
(`app/api/agency/rfp-responses/[id]/route.ts:913`, `:1204`); `/agency/dashboard` from a vendor
status update (`app/api/partner/projects/[projectId]/status-update/route.ts:254`);
`/partner/projects` from an agency status-update resolution
(`app/api/agency/projects/[projectId]/status-updates/route.ts:229`); per-project message and
agreement links (`app/api/projects/[id]/messages/route.ts:292`,
`app/api/projects/[id]/agreements/[agreementId]/route.ts:123`); `/partner/invitations` or signup
from a pool re-invite (`app/api/agency/pool/resend-invitation/route.ts:62-64`); and the admin
grant link (`app/api/admin/notify-new-user/route.ts:140`).

---

## 7. THE RULINGS GREG OWES. Nothing below is decided by whoever writes the fix.

**R1. A notification whose destination is the other portal: inert, or switch the portal?**
Eleven of the 26 cells. Today it redirects to your own portal's home with no message, which is
a dead click with a side effect.
- **(a) Inert.** The row renders, shows its type and message, and is not clickable in the wrong
  portal. Cost: a dual-role user has to switch portals themselves before the row works. Benefit:
  no dead clicks, no surprise mode change, no new failure mode. **Recommended, and it is what
  Phase 1 implements** unless Greg says otherwise, because it is the only option that does not
  invent a behaviour.
- **(b) Switch then navigate.** Click calls `POST /api/profile/switch-role`, waits, then pushes.
  Cost: clicking a notification silently changes which portal you are in, which will surprise
  someone mid-task, and it is a write on a click. Also needs a failure path when the switch is
  refused (switching TO agency requires `secondary_role === 'agency'` or `is_admin`,
  `app/api/profile/switch-role/route.ts`), so a vendor-only account clicking an agency row still
  has to see something.
- **(c) Filter them out of the bell entirely per portal.** Cost: **rejected on evidence.** The
  bell is the only consumer of this table; hiding rows per portal means a vendor-side award
  notification is invisible while you are in agency mode and there is nothing to tell you it
  exists. That is the "silent drop" the bell's own header argues against.

**R2. Give the partnership notifications a record destination?** Requires adding
`vendorOrgId` to the `data` payload of `notifyPartnershipAccepted` / `notifyPartnershipDeclined`
so `/agency/pool/{vendorOrgId}` becomes reachable (F6). Three lines in
`lib/notifications.ts` plus the three call sites, and it only helps rows written AFTER it ships -
existing rows stay at the list. Not done in this run: it changes what emitters write, which is a
wider blast radius than routing what they already write.

**R3. Which destination is right for "invited to bid": `/partner/rfps` or
`/partner/projects/{id}`?** F12. The email and the bell disagree today and **the email may be
right**: `/partner/projects/{id}` renders awarded engagements only, so a vendor who has been
invited and not yet awarded lands on "No awarded engagement found for this project." Phase 1
keeps the bell's existing destination rather than changing it on my own judgment, so the
disagreement survives this run **by design**. If Greg rules for the email, the bell's
`project_assignment` 4a cell moves to `/partner/rfps` and F12 closes.

**R4. Should `rfp_closed` / `rfp_not_selected` carry an identifier?** F5. One extra key in the
`data` payload at `app/api/agency/rfp-closure/route.ts:409-410` (the inbox row is already in
hand) would let a future run route them to `/partner/rfps/{inboxId}`. Not done here for the same
reason as R2.

**R5. Wire `new_message` and `document_uploaded`, or remove them?** F2. The message email
already sends. Either the emitter is missing or the two types are dead vocabulary that should
come out of the union and the constraint. Both are feature decisions.

---

## 8. (0f) THE DELETION PROBLEM. WHAT EACH DESTINATION DOES WITH AN IDENTIFIER THAT NO LONGER RESOLVES

This decides Phase 2. Read from source; no live test was possible.

### FIRST, WHAT CAN ACTUALLY DISAPPEAR

| Row | Can it be deleted from inside the product? | Evidence |
|---|---|---|
| `projects` | **NO.** No `DELETE` handler under `app/api/projects/`, and no `.delete()` on `from("projects")` anywhere in `app/`, `lib/` or `components/`. Out-of-band only. | grep, both forms |
| `partnerships` | **YES, hard delete.** `app/api/partnerships/route.ts:1384` `.delete().eq('id', partnershipId)`, with a header comment recording that whether this should be a status change is itself an open item (`docs/092-session-report.md`) | read |
| `partner_rfp_inbox` | **YES**, by the magic-token race collapse, `lib/magic-token-attach.ts:195`. It repoints `partner_rfp_responses.inbox_item_id` to the survivor before deleting losers. | read |
| `partner_rfp_responses` | **NO** delete path found. A bid is not withdrawn by deletion. | grep |
| `project_assignments` | **CASCADES** from `projects`: `project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE` (`scripts/010-closed-ecosystem-schema.sql:73`) | read |

And the one that matters for the RFP detail destination: `partner_rfp_inbox.project_id
REFERENCES public.projects(id) **ON DELETE SET NULL**` (`scripts/013-partner-rfp-inbox.sql:11`).
**So deleting a project does NOT delete the inbox row.** The RFP survives its project.

### THEN, WHAT EACH ROUTED DESTINATION DOES

| Destination | Identifier gone | Identifier belongs to another company | Verdict |
|---|---|---|---|
| `/partner/rfps/{inboxId}` | API returns **404 `{error:"Not found"}`** (`app/api/partner/rfps/[id]/route.ts:34`). Page renders a red panel reading "Not found" with a "Back to Open RFPs" link (`app/partner/rfps/[id]/page.tsx:1281-1290`). | **Identical 404** (`:65`), after `partnerCanAccessPartnerRfpInbox` refuses using `resolveCallerOrgIds` (`:18`, `:44`) | **GRACEFUL. Non-disclosing. NOTHING TO DO.** |
| `/partner/projects/{projectId}` | Assignments cascade away, so `rows.length === 0` -> **`{found:false}`** (`app/api/partner/projects/[projectId]/active-engagement/route.ts:146`). Page renders **"No awarded engagement found for this project. You'll see details here after the lead agency awards your bid."** (`app/partner/projects/[projectId]/page.tsx:356-361`) | **Identical `{found:false}`**, because the assignment read is `.in("partnership_id", partnershipIds)` where `partnershipIds` comes from `.in("vendor_org_id", callerOrgIds)` (`:94-97`, `:129`) | **NOT A CRASH, BUT MISLEADING. See below. THIS IS PHASE 2.** |
| `/agency/bids?response={responseId}` | Does not exist yet. Behaviour is Phase 1's to specify, section 9 of the brief's 1d. | same | **NEW. Specified in Phase 1.** |
| `/agency/pool`, `/agency/bids` (list), `/partner/onboarding`, `/partner/rfps?tab=closed`, `/partner/network?tab=invitations` | No identifier in the URL. Nothing to resolve, nothing to fail. Each surface's own read is org-scoped. | same | **N/A. NOTHING TO DO.** |

### THE ONE MISLEADING STATE, AND WHY IT IS NARROWER THAN IT LOOKS

`/partner/projects/{projectId}` says **"You'll see details here after the lead agency awards
your bid."** That sentence is a promise about the future. It is correct for the common case (a
vendor invited to bid, not yet awarded) and it is **false for a deleted project**, where no
award can ever arrive, and false for a project that was never theirs.

The route cannot tell those cases apart without a wider read, and widening it is forbidden and
would also be wrong: distinguishing "deleted" from "not yours" is exactly the existence
disclosure 1d warns about. **So Phase 2 does not try to distinguish them.** What it can fix is
the promise: a sentence that describes the two possibilities without claiming either. That is a
copy change on one branch of one page, and it is the whole of Phase 2.

Note also that the 404 branch at `:173` ("Project not found") is reachable only when awarded
assignment rows exist for a project row that does not - which the CASCADE makes impossible
through normal deletion. It is dead in practice, and left alone.

---

## 9. WHAT I COULD NOT ESTABLISH. QUERIES AND CHECKS FOR GREG. NONE OF THESE WERE RUN.

**Q1. WHICH MECHANISM WAS OBSERVED ON 2026-09-14?** Not a query, one click. In the agency portal,
navigate to `/agency/dashboard` (NOT `/agency/bids`), open the bell, click the "April Partner
Test Agency updated their bid" row. If the URL becomes `/agency/bids`, the observation was M1
(same-route push) and Phase 1's record-level destination is the fix. If the URL stays on the
dashboard or becomes `/partner`, it was M2 and the portal keying is the fix. Section 2 explains
why both produce the same report.

**Q2. Does the live CHECK hold exactly the thirteen of section 3?**
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass
  AND conname = 'notifications_type_check';
```
EXPECTED: the thirteen listed in section 3. Any value present live and absent from that list is
a type that can exist and that this run's routing does not know about.

**Q3. Which types actually have rows, and how many?**
```sql
SELECT type, count(*) AS n, count(link) AS with_link, count(*) FILTER (WHERE read) AS read_n
FROM public.notifications GROUP BY type ORDER BY n DESC;
```
EXPECTED per section 4: zero rows for `new_message` and `document_uploaded`, and
`with_link = n` for every type. **`with_link < n` for any type falsifies section 2's claim that
`n.link` is never null**, and would mean some rows genuinely were dead clicks for the plainest
possible reason. This is the single most valuable query on this list.

**Q4. Does the `notifications` table have the columns this code writes?** There is no
`CREATE TABLE` for it anywhere in the repository, so the column list cannot be read from source.
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='notifications' ORDER BY ordinal_position;
```
EXPECTED: at least `id, user_id, type, title, message, link, data, read, created_at`.

**Q5. Do any `project_assignment` rows carry neither `projectId` nor `inboxId`?** F3.
```sql
SELECT count(*) FROM public.notifications
WHERE type='project_assignment'
  AND data->>'projectId' IS NULL AND data->>'inboxId' IS NULL;
```
EXPECTED: 0. A non-zero answer is a third payload shape this baseline did not find, and those
rows must be left unrouted rather than sent to a URL containing "undefined".

**Q6. Do any `bid_submitted` rows lack `responseId`?** The one record-level route this run adds.
```sql
SELECT count(*) AS total, count(data->>'responseId') AS with_response_id
FROM public.notifications WHERE type='bid_submitted';
```
EXPECTED: equal. Any row without it stays on the list destination, which Phase 1 handles, but
the count tells Greg how much of the bell actually improves.

**Q7. Is any vendor near the R6 ceiling Phase 3 adds?** The count that decides whether the
ceiling is theoretical or live. `docs/vendor-attention-queue.md` records **67** rows for the April
vendor; the brief for this run says **64**. I did not reconcile those two numbers and cannot -
both are live measurements taken on different days, and neither is in source.
```sql
SELECT vendor_org_id, count(*) FROM public.partner_rfp_inbox
GROUP BY 1 HAVING count(*) > 400 ORDER BY 2 DESC;
```
EXPECTED: no rows. Any row at or above 500 is a vendor for whom Phase 3 changes what is on
screen today, and section 3 of the Phase 3 write-up says what they will see.

**Q8. Is `notifications.read` NOT NULL, or can it be null?** The bell treats `read: boolean |
null` and renders the unread dot on any falsy value (`components/notification-bell.tsx:81`,
`:465`). Phase 1's per-row mark-read writes `read: true`, so this changes nothing either way, but
it is unknown and is the kind of thing that decides a filter later. Covered by Q4's output.

---

## 10. WHAT PHASE 1 WILL DO, STATED BEFORE IT IS WRITTEN

For approval alongside the table above. Nothing here is built yet.

1. **A destination resolver, keyed on (type, payload, viewer side)**, in a new
   `lib/notification-routing.ts` with no Supabase import - the bell must not pull
   `lib/notifications.ts` into the client bundle, and `TYPE_LABELS`' header already explains why.
   It returns a path or `null`. `null` means the row is not clickable.
2. **The portal rule is structural, not a table someone maintains.** Whatever destination is
   computed, if it does not start with the current variant's prefix (`/agency` for `agency`,
   `/partner` for `vendor`), the resolver returns `null`. That is R1(a), and it makes every
   cross-portal cell inert by construction rather than by 11 table entries that could each be
   got wrong.
3. **An unknown future type falls back to the row's stored `link`**, still subject to rule 2. A
   type added to the union later stays clickable in its own portal instead of going inert
   silently, which is the same argument `unknownTypeLabel()` already makes for the label.
4. **`bid_submitted` gets `?response={responseId}`** and `/agency/bids` reads it, matching
   against the already-fetched, org-scoped list (`/api/agency/rfp-responses`, which resolves
   `resolveCallerOrgIds` and filters `.in("lead_org_id", callerOrgIds)`). **No new endpoint and
   no fetch by id**, so authorization is inherited rather than re-implemented.
5. **`?tab=` on the two vendor surfaces** for F9 and F10, validated against the tabs that
   surface actually renders.
6. **Per-row mark-read on click**, through the existing `PATCH { notificationIds: [id] }`.
   Optimistic locally, not blocking navigation.
7. **A routed row is a `<button>` as it is today** (already correct for 1e: real element, real
   keyboard focus, real Enter/Space). An unrouted row becomes a non-interactive element with no
   hover and no pointer cursor, and carries the same text.
8. **F1's two missing `TYPE_LABELS` keys** added.

Phase 1 changes no policy, no migration, no emitter, and no access predicate. **This run needs
no migration at all**: every identifier it routes on is already written to `notifications.data`
by code that is already live. If that changes, migration 100 will be authored with the explicit
BEGIN/COMMIT, down file, stop-gate header and verification block the standing rule requires.
