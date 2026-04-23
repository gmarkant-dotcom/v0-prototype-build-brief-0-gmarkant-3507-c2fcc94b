# LIGAMENT_CONTEXT.md
# Read this file at the start of every Cursor session before writing any code.

---

## Project Overview

Ligament is an AI-powered vendor orchestration SaaS platform for independent
creative and production agencies. It operates as a DBA under Liveligood, Inc.
Lead agencies use Ligament to manage partner agencies across RFP broadcast,
bid management, onboarding, active engagements, and cash flow.

**Live site:** https://www.withligament.com
**Stack:** Next.js 16 / Supabase / Vercel / Resend / Anthropic API
**Package manager:** pnpm
**Coding tool:** Cursor
**Deployment:** Vercel (project: lig0330up) — deploy via `git push` only, never via Vercel CLI

---

## Test Accounts

| Role | Email | Notes |
|------|-------|-------|
| Lead Agency | gmarkant@gmail.com | Primary test account |
| Partner Agency | gmarkant@icloud.com | Primary partner test |
| Partner (manual) | gmarkant+partner8@gmail.com | Gmail plus-address, lands in gmarkant@gmail.com |
| Partnership ID | c0851865-8bb0-4417-aaf0-9185d1c83c7f | Active partnership between above accounts |

---

## Migrations Applied

**Current state: 001–044**

| Migration | Description |
|-----------|-------------|
| 001–038 | Core schema (see legacy handoff docs) |
| 039 | Dual-role accounts — PENDING (not yet applied, backlog) |
| 040 | company_website column on profiles |
| 041 | response_deadline on partner_rfp_inbox |
| 042 | partner_intent and intent_set_at on partner_rfp_inbox |
| 043 | viewed_at on partner_rfp_inbox |
| 044 | invite_token, invite_token_expires_at, claimed_at, nda_gate_enforced, nda_confirmed_at, agency_nda_notified_at on partner_rfp_inbox |

**When applying a new migration:**
1. Create the SQL file at supabase/migrations/[number]_[description].sql
2. Run it manually in Supabase SQL Editor
3. Update this file with the new migration number and description
4. Update the handoff doc header

---

## Architecture Rules

These rules apply to every change, every file, every prompt.
Cursor must follow all of them without being reminded each time.

### Email
- **Always** resolve recipient email from `profiles` table by user ID — never from a nullable column (e.g. never use `partner_rfp_inbox.recipient_email` as the send address for existing users)
- **Always** use `siteBaseUrl()` from `lib/email.ts` for all URLs in emails — never hardcode `https://withligament.com` or `https://www.withligament.com` directly
- `siteBaseUrl()` must return `https://www.withligament.com` (with www) — this is already enforced in lib/email.ts
- **Partner emails** must only contain links to `/partner/*` paths
- **Agency emails** must only contain links to `/agency/*` paths
- **Never** cross-portal link (no `/agency/*` in a partner email, no `/partner/*` in an agency email)
- **Always** use `buildBrandedEmailHtml()` from `lib/email.ts` — no plain text emails, no unbranded templates
- **Always** wrap Resend sends in try/catch — email failures must never fail the API request
- **Always** sign off every email as "The Ligament Team" with withligament.com
- **Never** use em dashes (—) in any email copy — use commas, periods, or "and" instead
- **Never** send an email to an empty string — always guard with `if (email)` before send

### API Routes
- Every route must authenticate via Supabase auth — return 401 if no session
- Check user role where relevant (agency vs partner) — return 403 if wrong role
- **Never** trust client payload for status transitions — derive status server-side based on the action taken
- **Never** silently drop a recipient or skip an operation — log warnings for skipped items
- Wrap all Resend sends in non-blocking try/catch (failure logs but does not fail request)
- For manual RFP recipients: always check if recipient is existing user before determining email state

### Database / Schema
- Every new table requires RLS policies — no table without RLS
- Every new migration file goes in `supabase/migrations/` with format `[number]_[description].sql`
- Never run migrations from code — create the SQL file and note "I will apply manually"
- After applying a migration, update the migrations table in this file
- Add indexes for any column used in WHERE clauses in high-traffic queries

### TypeScript
- Update all relevant TypeScript types and interfaces when adding new schema columns
- Never use `any` where a proper type can be inferred
- All new API response types should be explicitly typed

### UI / Frontend
- **All list views with filter or sort controls** must use the useMemo derived list pattern:
  ```typescript
  const displayedItems = useMemo(() => {
    let list = [...items]
    if (filter !== 'all') list = list.filter(...)
    list.sort(...)
    return list
  }, [items, filter, otherDependencies])
  // Always render displayedItems, never the raw items array
  ```
- **Never** show "no project selected" state while `isLoadingProjects` is true
- **Never** show empty/error states during hydration — wait for loading to complete
- All buttons and interactive elements must have legible text in default state — no text-foreground-muted, text-gray-400 or lighter on interactive elements
- Use `formatDateTime()` from `lib/utils.ts` for all date+time display — format: "Apr 23, 2026 at 2:37 PM"
- Use `formatDate()` for date-only display — format: "Apr 23, 2026"
- Deduplication by ID must be applied to projects array at both context level and render level
- Ligament's layout is always dark via :root CSS tokens but does NOT use the .dark class on <html> or <body>. Therefore dark:* Tailwind variants NEVER apply anywhere in this codebase. Never use dark:* utilities — use explicit color values or CSS token references instead.

### Auth / Middleware
- `middleware.ts` must preserve query params (especially `invite`, `email`, `nda`, `next`) when redirecting unauthenticated users
- New public routes (no auth required) must be added to the public paths list in `middleware.ts`
- `app/auth/callback/route.ts` must preserve invite params through the OAuth callback

### Copy / Content
- No em dashes anywhere in any user-facing copy
- Pricing: "Founding Member Annual Pricing — Available Until July 1, 2026" (this one exception uses em dash in the banner as a design element — do not change)
- All platform copy should be professional, direct, warm — not corporate, not casual

---

## Key File Reference Map

### Email
| File | Purpose |
|------|---------|
| `lib/email.ts` | `sendTransactionalEmail()`, `buildBrandedEmailHtml()`, `siteBaseUrl()` |
| `lib/bid-status.ts` | Status label mapping for agency and partner views |

### Auth & Access
| File | Purpose |
|------|---------|
| `middleware.ts` | Route protection, public path list, query param preservation |
| `app/auth/sign-up/page.tsx` | Signup — handles invite context params |
| `app/auth/login/page.tsx` | Login — handles invite context params |
| `app/auth/callback/route.ts` | OAuth callback — preserves redirect and invite params |
| `lib/partner-inbox-access.ts` | `partnerCanAccessPartnerRfpInbox()` — RFP access control including NDA gate |

### Project Context
| File | Purpose |
|------|---------|
| `contexts/selected-project-context.tsx` | Single source of truth for selected project — auto-selects on first login, deduplicates, race-safe |
| `components/agency-layout.tsx` | Agency sidebar — project switcher with render-level dedupe |
| `components/selected-project-header.tsx` | Project header — respects isLoadingProjects |

### RFP & Bid Flow
| File | Purpose |
|------|---------|
| `app/api/agency/broadcast-rfp/route.ts` | RFP broadcast — handles existing partners and manual recipients |
| `app/api/agency/rfp-responses/[id]/route.ts` | Bid management — award, decline, feedback, status transitions |
| `app/api/partner/rfps/route.ts` | Partner RFP inbox list |
| `app/api/partner/rfps/[id]/route.ts` | Partner RFP detail — marks viewed_at on first open |
| `app/api/partner/rfps/[id]/intent/route.ts` | Partner bid intent signal (will_respond, has_questions, requesting_call) |
| `app/api/partner/rfps/claim/route.ts` | Invite token claim after signup/login |
| `app/api/partner/rfps/[id]/nda-notify/route.ts` | Partner notifies agency of NDA signing |
| `components/agency-broadcast-responses.tsx` | Agency bid review UI |
| `app/partner/rfps/page.tsx` | Partner RFP inbox list UI |
| `app/partner/rfps/[id]/page.tsx` | Partner RFP detail UI — NDA gate, intent signal, bid form |

### Onboarding
| File | Purpose |
|------|---------|
| `app/api/projects/[id]/onboarding-packages/route.ts` | Active onboarding flow (Stage03OnboardingWorkflow) |
| `app/api/projects/[id]/onboarding/deploy/route.ts` | Dormant onboarding flow (Stage03OnboardingProduction — not mounted) |
| `components/stage-03-onboarding-workflow.tsx` | Active onboarding component |
| `components/stage-03-onboarding-production.tsx` | Dormant — predecessor to workflow, not in production use |

### Pricing
| File | Purpose |
|------|---------|
| `app/pricing/page.tsx` | 4-tier pricing: Solo ($1,800), Core ($3,600), Studio ($7,200, featured), Network (custom) |

---

## Pricing Tiers (current)

| Tier | Price | Seats | Projects/year | Features |
|------|-------|-------|---------------|---------|
| Solo | $1,800/year | 1 lead agency seat | 24 | Basic AI, email support |
| Core | $3,600/year | 4 lead agency seats | 60 | Basic AI, email support |
| Studio | $7,200/year | 8 lead agency seats | 200 | Full AI suite, priority support, consultations |
| Network | Custom | Unlimited | Unlimited | Everything + custom |

Banner: "Founding Member Annual Pricing — Available Until July 1, 2026"
Studio is the featured/highlighted tier.

---

## Manual Recipient Flow — State Machine

When a lead agency manually enters an email address in the RFP broadcast:

| State | Condition | Email Sent | CTA Destination |
|-------|-----------|------------|----------------|
| A — New user, no NDA | Not in profiles, requireNda false | Invite to create account & view RFP | /auth/sign-up?invite=[token]&email=...&scope=...&agency=... |
| A — New user, NDA required | Not in profiles, requireNda true | Invite to create account & sign NDA | /auth/sign-up?invite=[token]&...&nda=required |
| B — Existing user, NDA not signed | In profiles, nda_gate_enforced true, nda_confirmed_at null | NDA required notice | /partner/rfps?invite=[token]&nda=required |
| C — Existing user, no NDA or NDA signed | In profiles, no NDA gate or already confirmed | Standard RFP notification | /partner/rfps |

**After signup:** claim route at `/api/partner/rfps/claim` links the invite token to the new user's partner_id.
**After NDA signed:** partner notifies agency via `/api/partner/rfps/[id]/nda-notify`. Agency confirms in pool page. Partner receives access confirmation email.

---

## Notification Email Triggers (complete map)

| Trigger | Recipient | Subject pattern | Route |
|---------|-----------|-----------------|-------|
| RFP broadcast (existing partner, no NDA) | Partner | "New RFP from [Agency]: [Scope]" | broadcast-rfp |
| RFP broadcast (existing partner, NDA required) | Partner | "[Agency] shared a confidential RFP" | broadcast-rfp |
| RFP broadcast (manual, new user) | Manual email | "[Agency] invited you to respond to an RFP" | broadcast-rfp |
| RFP broadcast (manual, existing user, NDA) | Manual email | "[Agency] requires an NDA to share this RFP" | broadcast-rfp |
| Partnership invitation (new) | Partner | "[Agency] has invited you to join their partner network" | partnerships POST |
| Partnership invitation (re-invite) | Partner | "[Agency] has re-invited you to their partner network" | partnerships POST |
| Partnership accepted | Agency | "[Partner] accepted your partnership invitation" | partnerships PATCH |
| Bid submitted | Agency | "[Partner] submitted a bid on [Scope]" | rfp-responses |
| Bid revised | Agency | "[Partner] updated their bid on [Scope]" | partner/rfps/[id]/response |
| Bid feedback left | Partner | "Feedback received on your bid for [Scope]" | rfp-responses PATCH |
| Bid declined by agency | Partner | "Update on your bid for [Scope]" | rfp-responses PATCH |
| Bid awarded | Partner | "You've been awarded [Scope] — [Project]" | rfp-responses PATCH |
| Onboarding package sent | Partner | "Your onboarding package is ready — [Project]" | onboarding-packages |
| Partner status update submitted | Agency | "[Partner] submitted a status update on [Project]" | partner status-update |
| Agency resolves status update | Partner | "Your status update on [Project] has been reviewed" | agency status-updates |
| New project message | Other party | "New message on [Project]" | projects/[id]/messages |
| Agreement signed | Counterpart | "[Party] signed the agreement for [Project]" | agreements PATCH |
| Agreement declined | Counterpart | "[Party] declined the agreement for [Project]" | agreements PATCH |
| NDA signed (partner notifies agency) | Agency | "[Partner] has signed the NDA for [Scope]" | partner/rfps/[id]/nda-notify |
| NDA confirmed (agency unlocks access) | Partner | "Your NDA has been confirmed — [Scope] is now accessible" | partnerships PATCH |
| New user signup | hello@withligament.com | "New Ligament signup — review required" | admin/notify-new-user |

**Notification gaps (flagged, not yet implemented):**
- Onboarding acknowledged by partner → agency notification
- Meeting request acknowledgment
- Feedback seen state (partner_seen_feedback_at not tracked)
- Message read receipts (no per-user last-read marker)

---

## Known Open Issues (as of April 23, 2026)

| # | Issue | File(s) | Priority |
|---|-------|---------|----------|
| 1 | Document upload broken on /agency/onboarding | components/stage-03-onboarding-workflow.tsx, app/api/upload | P1 |
| 2 | Bid submission confirmation modal missing | app/partner/rfps/[id]/page.tsx | P2 |
| 3 | K.2 alert panel cross-project bleed — not yet retested | components, alert panel | P1 |
| 4 | Onboarding acknowledgment email not implemented | onboarding-packages route | P2 |
| 5 | Meeting request acknowledgment email not implemented | various | P3 |
| 6 | Message read receipts not tracked | projects/[id]/messages | P3 |
| 7 | Feedback seen state not tracked (partner_seen_feedback_at) | partner_rfp_responses | P3 |
| 8 | Dual-role accounts (migration 039) — backlog | profiles, sidebar toggle | Backlog |
| 9 | SWR caching — data flash on page load | high-traffic pages | Backlog |
| 10 | Server-side Sentry blocked by Turbopack | sentry config | Backlog |
| 11 | Stage03OnboardingProduction dormant — needs deprecation decision | components | Backlog |
| 12 | Invite token expiry cleanup — no scheduled job yet | partner_rfp_inbox | Backlog |

---

## Standard Prompt Preamble by Change Tier

### Tier 1 — Isolated UI change (copy, style, layout)
No preamble needed. Write the fix directly.

### Tier 2 — Single API route or component
Add to prompt:
```
Before implementing, identify what calls this route and what
it calls. Confirm changes do not break any callers or
downstream consumers. List findings before writing code.
```

### Tier 3 — New feature (schema + API + UI)
Add to prompt:
```
Before writing any code, audit and report:
SCHEMA: New columns/tables needed? Conflicts with existing?
RLS: New RLS policies needed? Existing policies still correct?
API: What existing routes read/write affected tables?
EMAIL: Recipient resolved from profiles? Correct portal URLs?
       Branded template used? siteBaseUrl() used?
UI: What components consume this data? Null handling correct?
TYPES: TypeScript types needing updates?
AUTH: New routes need middleware public path update?
Only proceed after reporting all findings.
```

### Tier 4 — Cross-cutting change (auth, middleware, context, shared utils)
Add to prompt:
```
Before writing any code, audit EVERY consumer of the
thing being changed. List every file that imports or
calls the affected module. For each consumer, confirm
the change will not break existing behavior. Fix any
blocking issues found before the main implementation.
Apply the broadest possible fix — not just the specific
instance, but every occurrence of the same pattern
across the entire codebase.
```

---

## Broad Fix Pattern

When fixing any bug or implementing any feature, always:
1. Fix the specific instance identified
2. Audit the entire codebase for the same pattern
3. Fix all instances in the same prompt/operation
4. Return a complete list of every file changed

This prevents fix → redeploy → discover same bug elsewhere cycles.

---

## Deploy Sequence

```bash
git add . && git commit -m "type: description" && git push
```

Commit message types: `feat`, `fix`, `chore`, `refactor`

Migration sequence (always before deploying dependent code):
1. Create SQL file in supabase/migrations/
2. Run in Supabase SQL Editor
3. Confirm "Success. No rows returned"
4. Update migrations table in this file
5. Then deploy code

Never use `vercel deploy` or Vercel CLI — always deploy via git push.

---

## Post-Deploy Verification

After every deploy, run this in Cursor:
```
The following files were just changed and deployed.
For each, identify any downstream component, API route,
or email that could be affected and verify it still
works correctly. Flag anything that looks broken without
fixing it yet — return a list of risks only.

[paste changed files list]
```

---

## Session End Checklist

Before ending any dev session:
- [ ] All changes committed and pushed
- [ ] This file updated with new migrations
- [ ] Open issues table updated
- [ ] Notification gaps table updated
- [ ] New handoff doc written with today's priorities for tomorrow
- [ ] QA checklist updated if new features were added (ligament_qa_v3.xlsx)
