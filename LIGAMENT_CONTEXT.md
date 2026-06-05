# LIGAMENT_CONTEXT.md
Read this file at the start of every session before writing any code.

---

## Project Overview

Ligament is an AI-powered vendor orchestration SaaS platform for independent
creative and production agencies. It operates as a DBA under Liveligood, Inc.
Lead agencies use Ligament to manage partner agencies across RFP broadcast,
bid management, onboarding, active engagements, and cash flow.

**Live site:** https://www.withligament.com
**Stack:** Next.js 16 / Supabase / Vercel / Resend / Anthropic API / Vercel Blob / Supabase Storage
**Package manager:** pnpm
**Coding tool:** Cursor
**Deployment:** Vercel (project: lig0330up) - deploy via `git push` only, never via Vercel CLI

---

## Test Accounts

| Role | Email | Notes |
|------|-------|-------|
| Lead Agency | gmarkant@gmail.com | Primary test account, is_paid=true, is_admin=false |
| Partner Agency | gmarkant@icloud.com | Primary partner test |
| Partner (manual) | gmarkant+partner8@gmail.com | Gmail plus-address, lands in gmarkant@gmail.com |
| Partnership ID | c0851865-8bb0-4417-aaf0-9185d1c83c7f | Active partnership between above accounts |

---

## Migrations Applied (001-051)

| Migration | Description |
|-----------|-------------|
| 001-038 | Core schema (see legacy handoff docs) |
| 039 | Dual-role accounts - PENDING (not yet applied, backlog) |
| 040 | company_website column on profiles |
| 041 | response_deadline on partner_rfp_inbox |
| 042 | partner_intent and intent_set_at on partner_rfp_inbox |
| 043 | viewed_at on partner_rfp_inbox |
| 044 | invite_token, invite_token_expires_at, claimed_at, nda_gate_enforced, nda_confirmed_at, agency_nda_notified_at on partner_rfp_inbox |
| 045 | RLS policy - partners can claim partnership by email |
| 046 | CREATE INDEX IF NOT EXISTS idx_projects_agency_id ON projects(agency_id) |
| 047 | Added secondary_role text, active_role text to profiles. Backfilled active_role = role |
| 048 | Added company_logo_url text to profiles |
| 049 | Added company_linkedin_url text, personal_linkedin_url text to profiles |
| 050 | Added default_nda_url text to profiles |
| 051 | Added msa_confirmed_at timestamptz, msa_confirmed_by uuid to partnerships |

**When applying a new migration:**
1. Create the SQL file at supabase/migrations/[number]_[description].sql
2. Run it manually in Supabase SQL Editor
3. Confirm "Success. No rows returned"
4. Update this file with the new migration number and description
5. Deploy code after migration is confirmed

---

## Critical Architecture Constraints

### 1. Middleware excludes all API routes from session refresh
The middleware matcher excludes `api/` routes:
```
'/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
```
**Impact:** Any new API route using `createClient()` from `@/lib/supabase/server` cannot read the session cookie. Returns auth errors or empty data silently.

**BEFORE creating any new API route, ask:** can this be done with the browser Supabase client from the component instead?

**Solutions in order of preference:**
1. **Browser Supabase client** (best) - use directly from the component:
```typescript
const { createClient } = await import('@/lib/supabase/client')
const supabase = createClient()
const { data, error } = await supabase.from('table').select('*')
```
2. **Fetch from existing working routes** and filter client-side
3. **Avoid creating new server API routes** for simple CRUD

**Working API routes** (use as reference): `/api/projects`, `/api/partnerships`, `/api/agency/active-engagements`

### 2. Vercel Blob store is private-only
The connected blob store (`v0-prototype-build-brief-blob`) is private-only. Cannot upload public blobs.

**Rule:** Use **Supabase Storage** for all user-facing images. Use **Vercel Blob** only for private documents (NDAs, MSAs, contracts).

**Supabase Storage setup (created April 29):**
- Bucket: `avatars` - public bucket
- RLS policies: users can upload/update/delete their own files at `{user_id}/{filename}`
- Avatar/logo uploads route to this bucket when `folder` is `avatars`, `logos`, `agency-logos`, or `partner-logos`

### 3. AI routes use @ai-sdk/anthropic directly (NOT Vercel AI Gateway)
All AI routes use `@ai-sdk/anthropic` with `ANTHROPIC_API_KEY` env var. Do NOT use the Vercel AI Gateway string format (`"anthropic/claude-sonnet-4-20250514"`) - it requires Vercel paid credits and will 500.

**Correct pattern:**
```typescript
import { anthropic } from "@ai-sdk/anthropic"
// then:
model: anthropic("claude-sonnet-4-20250514")
```

**AI routes:** `app/api/ai/master-brief/route.ts`, `app/api/ai/rfp-output-template/route.ts`, `app/api/ai/route.ts`

**Anthropic API key:** `ANTHROPIC_API_KEY` is set in Vercel env vars (Production + Preview). The Anthropic account must have credits - Claude.ai subscription does NOT cover API usage.

### 4. Cursor/Claude.ai markdown link corruption
Claude.ai renders property access as markdown links in code blocks. When pasted into Cursor, these sometimes get written to files literally.

**Detection - run after every Cursor file write (Mac Terminal):**
```bash
grep -c "http://" "path/to/file.ts"
```
If result > 0, file may be corrupted. Verify with:
```bash
sed -n 'LINE_NUMBERp' "path/to/file.ts" | xxd
```
If hex shows plain ASCII the file is clean - Claude.ai is just rendering it visually as a link.

**Fix if actually corrupted (Mac Terminal):**
```bash
sed -i '' 's/\[user\.id\](http:\/\/user\.id)/user.id/g; s/\[params\.id\](http:\/\/params\.id)/params.id/g; s/\[e\.target\](http:\/\/e\.target)/e.target/g; s/\[form\.company\](http:\/\/form\.company)_/form.company_/g' "path/to/file.ts"
```

**Broad sweep before committing:**
```bash
grep -rl "\](http://" app/ --include="*.ts" --include="*.tsx"
```

---

## Diagnose Before Building - Required Checklist

Before writing any fix:
1. **Check middleware.ts** - does the route need session? Will middleware block it?
2. **Check DB directly** in Supabase SQL Editor - is the data actually there?
3. **Check `xxd`** on suspicious files - is corruption real or just display?
4. **Check existing working routes** - can we reuse instead of creating new?
5. **Check browser DevTools Network tab** - what status code and response body is the failing request returning?
6. **Check Vercel logs** - what is the actual server-side error message?

---

## Architecture Rules (never break)

- Never use `dark:*` Tailwind variants
- All emails via `buildBrandedEmailHtml()` + `siteBaseUrl()`, wrapped in try/catch
- API routes: auth check - role check - never trust client payload
- Migrations: SQL file - Supabase SQL Editor - confirm - deploy code
- pnpm only. Deploy: git push only.
- `npx tsc --noEmit` must pass (exit code 0) before every commit
- No em dashes anywhere in user-facing copy (one exception: "Founding Member Annual Pricing - Available Until July 1, 2026" uses em dash as design element - do not change)
- All platform copy: professional, direct, warm - not corporate, not casual

---

## UI / Component Rules

- **Never** show "no project selected" state while `isLoadingProjects` is true
- **Never** show empty/error states during hydration - wait for loading to complete
- All buttons and interactive elements must have legible text - no text-foreground-muted, text-gray-400 or lighter on interactive elements
- Use `formatDateTime()` from `lib/utils.ts` for all date+time display - format: "Apr 23, 2026 at 2:37 PM"
- Use `formatDate()` for date-only display - format: "Apr 23, 2026"
- Deduplication by ID must be applied to projects array at both context level and render level
- Use IIFE deduplication pattern:
```typescript
const displayedItems = useMemo(() => {
  const seen = new Set()
  return items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}, [items, filter, otherDependencies])
// Always render displayedItems, never the raw items array
```

### Modal Background Pattern
Partner discover page (`/partner/discover`) uses light theme. All modals must use solid white:
```jsx
<div className="w-full max-w-2xl bg-white rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
```
Agency portal modals use dark theme:
```jsx
<div className="w-full max-w-2xl bg-card border border-border rounded-xl p-6" onClick={e => e.stopPropagation()}>
```
**Never use `GlassCard` for modals** - it is transparent and unreadable over blurred backgrounds.

### Auth / Middleware
- `middleware.ts` must preserve query params (especially `invite`, `email`, `nda`, `next`) when redirecting unauthenticated users
- New public routes (no auth required) must be added to the public paths list in `middleware.ts`
- `app/auth/callback/route.ts` must preserve invite params through the OAuth callback

---

## Profile Data Model

| Field | Table | Purpose | Required |
|-------|-------|---------|----------|
| `avatar_url` | profiles | Individual user photo | No |
| `company_logo_url` | profiles | Company/agency logo | No |
| `company_linkedin_url` | profiles | Company LinkedIn - collected at signup | Yes (signup) |
| `personal_linkedin_url` | profiles | Individual LinkedIn | No |
| `company_name` | profiles | Company name | Yes |
| `company_website` | profiles | Company website | No |
| `role` | profiles | `agency` or `partner` | Yes |
| `active_role` | profiles | Current portal role (migration 047) | Yes |
| `is_paid` | profiles | Subscription active | - |
| `is_admin` | profiles | Admin access | - |

**Sidebar display logic:** `avatar_url` shown first, falls back to `company_logo_url`, falls back to initials. Applied in both `agency-layout.tsx` and `partner-layout.tsx`.

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
| `middleware.ts` | Route protection, public path list, query param preservation - excludes api/ from matcher |
| `app/auth/sign-up/page.tsx` | Signup - company_linkedin_url required field added Apr 29 |
| `app/auth/login/page.tsx` | Login - handles invite context params |
| `app/auth/callback/route.ts` | OAuth callback - syncs company_linkedin_url, preserves redirect and invite params |
| `lib/partner-inbox-access.ts` | `partnerCanAccessPartnerRfpInbox()` - RFP access control including NDA gate |
| `lib/supabase/server.ts` | Server Supabase client - session broken in new API routes due to middleware |
| `lib/supabase/client.ts` | Browser Supabase client - use this for new features |

### Project Context
| File | Purpose |
|------|---------|
| `contexts/selected-project-context.tsx` | Single source of truth for selected project - auto-selects on first login, deduplicates, race-safe |
| `components/agency-layout.tsx` | Agency sidebar - project switcher, avatar with logo fallback |
| `components/partner-layout.tsx` | Partner sidebar - same avatar pattern |
| `components/selected-project-header.tsx` | Project header - respects isLoadingProjects |
| `components/swr-provider.tsx` | SWR global config |

### Project Detail
| File | Purpose |
|------|---------|
| `app/agency/dashboard/page.tsx` | Project dashboard - reads budget_range for display |
| `app/agency/projects/[id]/page.tsx` | Project detail - uses browser Supabase client directly |
| `app/api/projects/route.ts` | Projects list - working session auth, use as reference |
| `app/api/projects/[id]/route.ts` | Single project CRUD - session broken, not used by frontend |
| `lib/project-mapper.ts` | Maps DB project rows to UI MasterProject type |

### RFP & Bid Flow
| File | Purpose |
|------|---------|
| `app/agency/page.tsx` | RFP Broadcast (Stage 01) - has draft persistence |
| `app/api/agency/broadcast-rfp/route.ts` | RFP broadcast - handles existing partners and manual recipients |
| `app/api/agency/rfp-responses/[id]/route.ts` | Bid management - award, decline, feedback, status transitions |
| `app/api/partner/rfps/route.ts` | Partner RFP inbox list |
| `app/api/partner/rfps/[id]/route.ts` | Partner RFP detail - marks viewed_at on first open |
| `app/api/partner/rfps/[id]/intent/route.ts` | Partner bid intent signal (will_respond, has_questions, requesting_call) |
| `app/api/partner/rfps/claim/route.ts` | Invite token claim after signup/login |
| `app/api/partner/rfps/[id]/nda-notify/route.ts` | Partner notifies agency of NDA signing |
| `components/agency-broadcast-responses.tsx` | Agency bid review UI |
| `app/partner/rfps/page.tsx` | Partner RFP inbox list UI |
| `app/partner/rfps/[id]/page.tsx` | Partner RFP detail UI - NDA gate, intent signal, bid form |

### AI Routes
| File | Purpose |
|------|---------|
| `app/api/ai/master-brief/route.ts` | Generates structured master RFP from uploaded brief |
| `app/api/ai/rfp-output-template/route.ts` | Generates RFP output template |
| `app/api/ai/route.ts` | General AI chat/completion route |

All use `anthropic("claude-sonnet-4-20250514")` from `@ai-sdk/anthropic`. Requires `ANTHROPIC_API_KEY` in Vercel env vars with active Anthropic credits.

### Onboarding
| File | Purpose |
|------|---------|
| `app/api/projects/[id]/onboarding-packages/route.ts` | Active onboarding flow (Stage03OnboardingWorkflow) |
| `app/api/projects/[id]/onboarding/deploy/route.ts` | Dormant onboarding flow (Stage03OnboardingProduction - not mounted) |
| `components/stage-03-onboarding-workflow.tsx` | Active onboarding component |
| `components/stage-03-onboarding-production.tsx` | Dormant - predecessor to workflow, not in production use |

### Partner Pool & Marketplace
| File | Purpose |
|------|---------|
| `app/agency/pool/[id]/page.tsx` | Partner profile + notes log |
| `app/agency/pool/marketplace/page.tsx` | Agency marketplace - View Profile modal added Apr 29 |
| `app/partner/discover/page.tsx` | Partner discover - View Profile modal added Apr 29 |
| `app/api/marketplace/discoverable/route.ts` | Public profile data for both marketplace pages |

### Settings & Profile
| File | Purpose |
|------|---------|
| `app/agency/settings/profile/page.tsx` | Company profile - logo, LinkedIn |
| `app/agency/settings/user/page.tsx` | User profile - photo, personal LinkedIn |
| `app/partner/profile/page.tsx` | Partner company profile - LinkedIn |
| `app/partner/settings/user/page.tsx` | Partner user profile - personal LinkedIn |
| `app/api/upload/route.ts` | File upload - images to Supabase Storage, docs to Vercel Blob |

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

Banner: "Founding Member Annual Pricing - Available Until July 1, 2026"
Studio is the featured/highlighted tier.

---

## Manual Recipient Flow - State Machine

When a lead agency manually enters an email address in the RFP broadcast:

| State | Condition | Email Sent | CTA Destination |
|-------|-----------|------------|----------------|
| A - New user, no NDA | Not in profiles, requireNda false | Invite to create account & view RFP | /auth/sign-up?invite=[token]&email=...&scope=...&agency=... |
| A - New user, NDA required | Not in profiles, requireNda true | Invite to create account & sign NDA | /auth/sign-up?invite=[token]&...&nda=required |
| B - Existing user, NDA not signed | In profiles, nda_gate_enforced true, nda_confirmed_at null | NDA required notice | /partner/rfps?invite=[token]&nda=required |
| C - Existing user, no NDA or NDA signed | In profiles, no NDA gate or already confirmed | Standard RFP notification | /partner/rfps |

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
| Bid awarded | Partner | "You've been awarded [Scope] - [Project]" | rfp-responses PATCH |
| Onboarding package sent | Partner | "Your onboarding package is ready - [Project]" | onboarding-packages |
| Partner status update submitted | Agency | "[Partner] submitted a status update on [Project]" | partner status-update |
| Agency resolves status update | Partner | "Your status update on [Project] has been reviewed" | agency status-updates |
| New project message | Other party | "New message on [Project]" | projects/[id]/messages |
| Agreement signed | Counterpart | "[Party] signed the agreement for [Project]" | agreements PATCH |
| Agreement declined | Counterpart | "[Party] declined the agreement for [Project]" | agreements PATCH |
| NDA signed (partner notifies agency) | Agency | "[Partner] has signed the NDA for [Scope]" | partner/rfps/[id]/nda-notify |
| NDA confirmed (agency unlocks access) | Partner | "Your NDA has been confirmed - [Scope] is now accessible" | partnerships PATCH |
| New user signup | hello@withligament.com | "New Ligament signup - review required" | admin/notify-new-user |

**Notification gaps (flagged, not yet implemented):**
- Partner pool invite - invite sends and appears in /agency/pool but Resend email never fires (P1 backlog)
- Onboarding acknowledged by partner - agency notification
- Meeting request acknowledgment
- Feedback seen state (partner_seen_feedback_at not tracked)
- Message read receipts (no per-user last-read marker)

---

## Open Items Backlog

| Priority | Item | Notes |
|----------|------|-------|
| P1 | Partner pool invite - no email notification | Invite sends and appears in `/agency/pool` but Resend email never fires. Check Vercel function logs for the invite POST endpoint. Likely missing email template or Resend API key scope issue. |
| P2 | Vercel env var security | `RESEND_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `POSTGRES_PASSWORD`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL` flagged "Needs Attention" - mark as Sensitive in Vercel dashboard. 2-min UI fix, no code changes. |
| P3 | QA Smoke Test v5 Sections 1+ | Section 0 (Regression) completed April 29. Sections 1+ not started. |
| P4 | Pool page SWR conversion | `loadPartnerships` / `loadAccessRequests` in `/agency/pool` still use raw useEffect + fetch. Convert to `useFetch`. |
| P5 | Supabase Pro upgrade | When first paying customer lands - unlocks pgBouncer Transaction mode. |
| P6 | `/api/projects/[id]` session fix | Route exists but session auth broken. Frontend works around it. Long-term: fix by adding to middleware matcher carefully or migrate to service role key. |

---

## What Shipped April 28-29 + June 4

### April 28
- Project detail page at `/agency/projects/[id]`
- Dashboard project cards link to detail page
- Partnership notes timestamped log
- RFP draft state persisted per project in localStorage
- Dual-role toggle end-to-end
- Admin Grant button via server route
- SWR global config, parallel API queries, useFetch on RFPs, stale-while-revalidate headers
- 48 TypeScript errors cleared

### April 29
- Project detail page fixed (was 404 - folder was `project` not `projects`)
- Project detail save fixed (uses browser Supabase client directly)
- Dashboard budget display fixed (reads `budget_range` not hardcoded 0)
- Avatar/logo system overhauled - user photo vs company logo separated (migration 048)
- Supabase Storage `avatars` bucket created (public)
- Upload route updated - images to Supabase Storage, docs to Vercel Blob
- `company_linkedin_url` - required at signup, auto-populates company settings both portals (migration 049)
- `personal_linkedin_url` - optional, in user settings both portals (migration 049)
- Auth callback `syncUserProfile` now syncs `company_linkedin_url` to existing profiles on email confirmation
- Public profile modals on `/partner/discover` and `/agency/pool/marketplace`
- "No contact email" replaced with "Request collaboration access" CTA
- Request Access modal fixed to solid white background

### June 4
- AI routes fixed - switched from Vercel AI Gateway to `@ai-sdk/anthropic` direct
- Installed `@ai-sdk/anthropic` package
- All three AI routes now use `anthropic("claude-sonnet-4-20250514")` pattern
- `ANTHROPIC_API_KEY` confirmed in Vercel env vars (Production + Preview)

---

## Standard Prompt Preamble by Change Tier

### Tier 1 - Isolated UI change (copy, style, layout)
No preamble needed. Write the fix directly.

### Tier 2 - Single API route or component
Add to prompt:
```
Before implementing, identify what calls this route and what
it calls. Confirm changes do not break any callers or
downstream consumers. List findings before writing code.
```

### Tier 3 - New feature (schema + API + UI)
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

### Tier 4 - Cross-cutting change (auth, middleware, context, shared utils)
Add to prompt:
```
Before writing any code, audit EVERY consumer of the
thing being changed. List every file that imports or
calls the affected module. For each consumer, confirm
the change will not break existing behavior. Fix any
blocking issues found before the main implementation.
Apply the broadest possible fix - not just the specific
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

This prevents fix - redeploy - discover same bug elsewhere cycles.

---

## Deploy Sequence

```bash
git add -A && git commit -m "type: description" && git push
```

Commit message types: `feat`, `fix`, `chore`, `refactor`

Migration sequence (always before deploying dependent code):
1. Create SQL file in supabase/migrations/
2. Run in Supabase SQL Editor
3. Confirm "Success. No rows returned"
4. Update migrations table in this file
5. Then deploy code

Never use `vercel deploy` or Vercel CLI - always deploy via git push.

---

## Post-Deploy Verification

After every deploy, run this in Cursor:
```
The following files were just changed and deployed.
For each, identify any downstream component, API route,
or email that could be affected and verify it still
works correctly. Flag anything that looks broken without
fixing it yet - return a list of risks only.

[paste changed files list]
```

---

## How Claude Works With G

- G pastes Cursor responses, terminal output, file contents
- Claude diagnoses before building - check middleware, DB, file integrity, DevTools, Vercel logs first
- Claude writes prompts G can paste directly - one change at a time
- After every Cursor file write: run `grep -c "http://" filename` to check for corruption
- Always specify **Mac Terminal** vs **Cursor terminal** for every command
- `npx tsc --noEmit` before every commit - must be exit code 0
- Deploy: `git add -A && git commit -m "..." && git push` from Mac Terminal

---

## Session End Checklist

Before ending any dev session:
- [ ] All changes committed and pushed
- [ ] This file updated with new migrations
- [ ] Open issues backlog updated
- [ ] Notification gaps updated
- [ ] TypeScript clean (npx tsc --noEmit = exit 0)
- [ ] QA checklist updated if new features added
