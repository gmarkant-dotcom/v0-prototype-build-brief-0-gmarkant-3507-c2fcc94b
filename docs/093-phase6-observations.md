# Phase 6: two observations, reported and not fixed

**Branch:** `fix/acting-role-read-scope`  **Date:** 2026-08-21
**Status:** REPORT ONLY. No code was written for either item, and no SQL was written for (a).
Repair SQL for the snapshot drift is Greg's.

---

## (a) The denormalized agency name has drifted, and history was never repaired

### What was seen

The vendor screen grouped 96 `partner_rfp_inbox` rows under **"2 agencies"**, one of them
named **"April Test Greg Lead Agency"**, while **every one of those 96 rows carries the same
single `lead_org_id`** (markant's). Two names, one organization.

### Why

`partner_rfp_inbox.agency_company_name` is a **snapshot**, not a join. It is stamped at write
time and nothing ever re-reads it.

**Writers, both of them:**

| Site | Value written |
|---|---|
| `app/api/agency/broadcast-rfp/route.ts:242` and `:387` | `agencyDisplay`, resolved at broadcast time |
| `lib/magic-token-attach.ts:338` | `agencyCompanyName`, resolved at attach time |

**Reader that produces the grouping:** `components/partner-rfp-surface.tsx:514`

```ts
const key = groupBy === "agency"
  ? (r.agency_company_name || "Unknown Agency").trim()
```

The group key is the **string on the row**, not the organization id. Two spellings of one
company are two groups by construction, and the count in the header
(`components/partner-rfp-surface.tsx:519`, `${totalRfps} RFPs across ${totalGroups}
${groupNoun}`) counts groups, so it reports 2.

### This settles an open question from the vendor-visibility run

`docs/vendor-visibility-report.md` section "Open questions", item 4, asked:

> **Whether any `partner_rfp_inbox` rows already carry a wrong `agency_company_name`
> snapshot.** The Phase 3 fix repairs the writer, not rows already written.

**Answer: yes, they do.** The observation above is the evidence. That report's checklist item
4 looked only for the literal fallbacks `'Lead agency'` / `'Lead Agency'`, which is the
*magic-link* failure mode. **The drift seen here is a different and wider one:** these rows
carry a real, correct-at-the-time company name that has since been superseded by a rename.
A query for the literal fallback would have returned zero and been read as "no problem".

### The affected row count

**NOT MEASURED. I HAVE NO DATABASE ACCESS AND RAN NO QUERY.** Stating a number here would be
inventing one. This is the query that settles it, and it supersedes checklist item 4 of the
vendor-visibility report because it compares against the live name instead of looking for two
literals:

```sql
-- How many inbox rows carry a name that is no longer their organization's name?
SELECT count(*)                                             AS drifted_rows,
       count(DISTINCT i.lead_org_id)                        AS organizations_affected,
       count(DISTINCT i.agency_company_name)                AS distinct_stale_names
  FROM public.partner_rfp_inbox i
  JOIN public.organizations o ON o.id = i.lead_org_id
 WHERE i.agency_company_name IS DISTINCT FROM o.name;
```

And the per-name breakdown, which is what a backfill decision actually needs:

```sql
SELECT i.lead_org_id,
       o.name                  AS current_org_name,
       i.agency_company_name   AS stale_snapshot,
       count(*)                AS rows
  FROM public.partner_rfp_inbox i
  JOIN public.organizations o ON o.id = i.lead_org_id
 WHERE i.agency_company_name IS DISTINCT FROM o.name
 GROUP BY 1, 2, 3
 ORDER BY rows DESC;
```

Run the second one **before** the first is acted on. A `count(*)` cannot tell a rename apart
from a legitimately different value.

### The shape a backfill would take

**NOT WRITTEN AND NOT RUN.** This is the shape, so Greg can decide against a described thing
rather than an implied one.

1. **It is one `UPDATE`, joined on `lead_org_id`, not a per-row script.**

   ```sql
   -- SHAPE ONLY. NOT RUN. Read the four cautions below before adapting it.
   UPDATE public.partner_rfp_inbox i
      SET agency_company_name = o.name
     FROM public.organizations o
    WHERE o.id = i.lead_org_id
      AND i.agency_company_name IS DISTINCT FROM o.name;
   ```

2. **`IS DISTINCT FROM`, never `<>`.** Rows with a NULL snapshot exist (the magic-link path
   wrote NULL before its fix) and `NULL <> 'x'` is NULL, which is not true, so `<>` would
   skip exactly the rows most in need of repair.

3. **It must run as the service role or as `postgres`.** `partner_rfp_inbox` has no UPDATE
   policy for the agency arm at all: the only UPDATE policy is `Partners update own inbox
   rows`. An agency session running this matches zero rows and the editor reports success.
   **This is the failure mode to watch for** and the reason step 5 exists.

4. **It has no trigger to satisfy.** `partner_rfp_inbox` carries no BEFORE UPDATE trigger -
   the only triggers in this schema are 087's on `partnerships`, 090's and 091's on
   `profiles`, and 092's on `organizations`. Nothing will refuse it and nothing will rewrite
   it.

5. **Verify by re-running the count query, not by reading "Success. No rows returned".**
   Expect `drifted_rows = 0` afterwards. `UPDATE` in the Supabase SQL Editor reports the same
   success string whether it matched 96 rows or zero.

### The question the backfill does not answer, and which is the real one

A backfill repairs today and drifts again on the next rename. The snapshot exists because the
vendor cannot always read the lead agency's `organizations` row, and `/api/partner/rfps`
already batch-loads `organizations` for the meeting link
(`app/api/partner/rfps/route.ts:195-209`) through
`current_user_counterparty_org_ids()`. **So the join the grouping needs is already being
made, and the group key could be `lead_org_id` with the name resolved from that batch.** That
would make the drift unrenderable rather than merely repaired.

**Not done here.** It changes what the vendor sees for an agency they have no partnership
with (the organization would not resolve and the name would fall back), which is a product
ruling. Logged as **OPEN-RS-6**.

---

## (b) The two portals have structurally different navigation

Greg wants them mirrored. **Proposing nothing and building nothing** - this is what a
conversion would touch.

### What each portal is today

| | Lead agency | Vendor |
|---|---|---|
| File | `components/agency-layout.tsx`, 822 lines | `components/partner-layout.tsx`, 361 lines |
| Shape | fixed vertical sidebar, `w-[260px]`, `aside` at `:364` | horizontal top bar, `sticky top-0`, `header` at `:120` |
| Sections | three labelled: `Overview`, `BID REQUESTS`, `Resources` (`:30-56`) | three groups, **unlabelled**, separated by a `w-px` divider (`:31-47`, rendered `:143`) |
| Stage items | 00-04, five | 00-04, five (as of Phase 4 of this session) |
| Background | `HolographicBlobs` + `glass` | flat `#0C3535` header over `#FAFAFA` |
| Theme tokens | `border-border`, `bg-card`, `glass` | `vendor-foreground`, `vendor-muted`, `vendor-border`, `vendor-surface`, `vendor-background`, `vendor-muted-strong` |
| Project switcher | yes, `SelectedProjectProvider` + `useSelectedProject` | none |
| Subscription gate | `AgencySubscriptionGate` wraps children | none, deliberately - vendors are free |
| Usage banner | `UsageLimitBanner` | none |
| Providers | `SelectedProjectProvider`, `PaidUserProvider`, `UsageLimitModalProvider` | `PaidUserProvider`, `LeadAgencyFilterProvider` |
| Second entry point | `AgencyShell` (`:806`) | `PartnerChrome` (`:64`), documented as "no PaidUserProvider" |

**The section labels are the visible difference Greg named.** The vendor already has the same
three groups in the same order (`navGroups` is `NavItem[][]`); it renders a vertical rule
between them instead of a heading, because a horizontal bar has no room for both a step
number and a section label. The grouping is not missing. Only the labels are, and only because
of the axis.

### What a conversion would touch

**Reported as surface area, not as a plan.**

1. **`components/partner-layout.tsx`** - the header/nav block, roughly `:120-200`. The
   `navGroups` data structure needs no change at all: it is already the same shape as the
   agency's `navSections`, minus a `label` per group. Adding three labels is a data edit.

2. **Every vendor page's outer wrapper: 11 files.** `app/partner/{page,legal,marketplace,
   network,onboarding,payments,profile,projects/page,projects/[projectId]/page,
   rfps/[id]/page,settings/user/page}.tsx`, plus `components/partner-rfp-surface.tsx`. Each
   renders `<PartnerLayout>` and lays its content out for a **full-width** page. A 260px
   sidebar removes 260px from every one of them. This is the bulk of the work and none of it
   is in the layout file.

3. **The theme.** 1,553 `vendor-*` token usages across `app/partner` and `components`
   (`vendor-foreground` 586, `vendor-muted` 375, `vendor-border` 292, `vendor-surface` 138,
   `vendor-muted-strong` 106, `vendor-background` 53). **Mirroring the STRUCTURE does not
   require touching any of them** - the vendor can have a light sidebar. Mirroring the LOOK
   means all 1,553. These are two different projects and the request should say which.

4. **Three agency sidebar features with no vendor equivalent**, each a decision rather than a
   port: the project switcher and its `SelectedProjectProvider` (a vendor has no "selected
   project" concept - `contexts/selected-project-context.tsx` is the agency's single source
   of truth and CLAUDE.md forbids reading project state outside it), `NewProjectDialog` /
   `NewClientDialog` (a vendor creates neither), and `AgencySubscriptionGate` +
   `UsageLimitBanner` (vendors are free by design).

5. **`PartnerChrome` must keep working.** It is the no-`PaidUserProvider` shell used by the
   bid-submit flow specifically so that path never sits under agency subscription gating. A
   conversion that folds the two shells together would put the bid form back inside the gate.
   That is the one change here that could break a vendor's ability to submit a bid.

6. **Mobile.** The agency sidebar is `fixed` with no mobile collapse in the file; the vendor
   nav is `hidden md:flex`. Whichever direction this goes, one of the two currently has a
   mobile story the other does not.

### The observation worth acting on before any of that

**The vendor nav's groups are already the agency's groups.** After Phase 4 of this session the
two portals carry the same five workflow stages under the same five numbers. The remaining
difference is an axis and three missing labels, and the labels can be added to a horizontal
bar without moving a single page.

**That is not a recommendation.** It is the cheapest thing in this list and it is the only one
that does not touch 11 pages, and Greg should know both facts before choosing.
