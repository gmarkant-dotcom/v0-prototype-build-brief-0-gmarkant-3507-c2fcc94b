# LIGAMENT — Dev Handoff
**Prepared:** April 24, 2026 | **Next session:** April 25, 2026
**Stack:** Next.js 16 / Supabase / Vercel / Resend / Anthropic API
**Package manager:** pnpm | **Coding tool:** Cursor
**Deploy:** git add . && git commit -m "type: description" && git push (NEVER Vercel CLI)
**Live site:** https://www.withligament.com
**Vercel project:** lig0330up
**Repo path:** ~/Downloads/v0-prototype-build-brief-0-gmarkant-3507-c2fcc94b

---

## How Claude + Cursor Work Together
- Claude is the technical lead. Cursor executes.
- **File-first rule:** Before Claude writes any Cursor prompt, Claude tells you which files to paste. You paste them here. Claude reads them and writes a precise fix. This eliminates the audit→fix→redeploy→find-same-bug-elsewhere cycle.
- Paste Cursor responses back to Claude. Claude writes the next prompt.
- Never let Cursor audit AND fix in the same prompt without Claude reviewing the audit first.
- Start every Cursor session: "Read LIGAMENT_CONTEXT.md before proceeding. Follow all architecture rules defined there."

---

## Test Accounts
| Role | Email | Notes |
|------|-------|-------|
| Lead Agency | gmarkant@gmail.com | Primary |
| Partner Agency | gmarkant@icloud.com | Primary partner |
| Partner (accepted) | gmarkant+partner8@gmail.com | Active partnership |
| Partnership ID | c0851865-8bb0-4417-aaf0-9185d1c83c7f | Active |

---

## Migrations Applied: 001–045
| # | Description |
|---|-------------|
| 001–038 | Core schema |
| 039 | Dual-role accounts — PENDING (backlog) |
| 040 | company_website on profiles |
| 041 | response_deadline on partner_rfp_inbox |
| 042 | partner_intent, intent_set_at on partner_rfp_inbox |
| 043 | viewed_at on partner_rfp_inbox |
| 044 | invite_token, invite_token_expires_at, claimed_at, nda_gate_enforced, nda_confirmed_at, agency_nda_notified_at on partner_rfp_inbox |
| 045 | RLS policy — partners can claim partnership by email |

---

## Open Issues (priority order)
| # | Issue | File(s) | Priority |
|---|-------|---------|----------|
| 1 | useMemo not imported — ReferenceError crash on /agency/dashboard | app/agency/dashboard/page.tsx | P1 — fix first |
| 2 | createBrowserClient called without env vars — 5 Sentry errors/week | unknown component | P1 |
| 3 | GET /api/projects slow (1.8s→2.78s avg, 363 calls/week) — missing DB index on agency_id | app/api/projects/route.ts | P2 |
| 4 | Full TypeScript cleanup — npx tsc --noEmit, fix all errors in one pass | various | P2 |
| 5 | Master project details (client, budget, timeline) — no dedicated view | app/agency/dashboard/page.tsx | P2 |
| 6 | Partnership notes — single-entry overwrite, needs timestamped log | app/agency/pool/[id]/page.tsx | P2 |
| 7 | Nav avatar img fails to load (private Vercel Blob CORS) | components/agency-layout.tsx, components/partner-layout.tsx | P2 |
| 8 | Onboarding acknowledgment email not implemented | onboarding-packages route | P2 |
| 9 | Meeting request acknowledgment email not implemented | various | P3 |
| 10 | Message read receipts not tracked | projects/[id]/messages | P3 |
| 11 | Feedback seen state not tracked | partner_rfp_responses | P3 |
| 12 | Dual-role accounts (migration 039) | profiles | Backlog |
| 13 | SWR caching — data flash on page load | high-traffic pages | Backlog |
| 14 | Server-side Sentry blocked by Turbopack | sentry config | Backlog |
| 15 | Stage03OnboardingProduction dormant | components | Backlog |
| 16 | Invite token expiry cleanup — no cron job | partner_rfp_inbox | Backlog |
| 17 | Vercel spend limit $120 — monitor | Vercel billing | Monitor |

---

## What Was Fixed April 24

### Batch A — RFP Broadcast + Partnership Invite
- nda_gate_enforced null constraint fixed in bulk insert
- Full partnership claim flow built (signup context, callback, on-mount claim)
- Partnership invite CTA routes to /partner/invitations
- Migration 045: RLS policy for partners to claim by email
- Claim route uses service role client (auth.uid() subquery workaround)
- Supabase confirm email template updated to branded dark/green design

### Batch B — Project Creation
- isSubmitting guard on both modal branches (prevents duplicate creation)
- Single consolidated insert with .select("*") (budget/timeline now persist)
- 409 on duplicate project name across all statuses

### Batch C — Profile and Settings
- Profile photo upload: image MIME types accepted, server-side validation fixed
- Save Changes button covers display name + avatar on both portals
- "Settings saved" inline confirmation with 3s auto-dismiss
- Avatar preview uses initials circle (private Vercel Blob blocks img — P2 backlog)
- Agency company profile: custom discipline input added
- Admin notify email: copy updated to "set after onboarding"
- company_website added to marketplace discoverable API and card
- Partner profile button/chip contrast fixed on light backgrounds

### Batch D — Pool and Marketplace
- Marketplace shows "Connected" for already-partnered agencies
- Notes/feedback on /agency/pool/[id] confirmed working
- Status and legal filters confirmed working

### Batch E — Auth
- Login redirect fixed: agency lands on /agency/dashboard (was /agency)

### Batch F — Pricing
- Studio tier yellow outline moves on card click (selectedTier state)
- 3-card benefit teaser added above pricing grid
- Card padding reduced

---

## Session Priorities for April 25

### 1. Fix P1 Sentry errors (before any QA)
**Issue 1 — useMemo crash:**
File needed: app/agency/dashboard/page.tsx
Fix: add useMemo to the React import. One line.
Tell Claude "fix useMemo crash" and paste the file.

**Issue 2 — createBrowserClient env var:**
Search codebase for createBrowserClient calls outside of lib/supabase/client.ts.
Any call without env var guard needs: if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null

### 2. Add DB index for /api/projects performance
Run in Supabase SQL Editor:
CREATE INDEX IF NOT EXISTS idx_projects_agency_id ON projects(agency_id);
Then create supabase/migrations/046_projects_agency_id_index.sql with same SQL.

### 3. Run QA Smoke Test v5 (ligament_qa_v5.xlsx)
Run order:
- Section 0 items must be fixed in Cursor first
- Retest all 🔁 Retest rows (Sections 1-3, 14) — these were fixed Apr 24
- Run Sections 6-15 fresh (never tested)
- For K.1 award flow: after clicking award, check all 3 tables in Supabase immediately
- For K.2 alert bleed: switch projects rapidly 4-5 times while alert is pending

### 4. TypeScript cleanup
Run: npx tsc --noEmit
Paste all errors to Claude. Claude writes one Cursor prompt to fix everything in one pass.

---

## Architecture Rules (never skip, never override)

### The one rule that prevents the most bugs
**Never use dark:* Tailwind variants.** Ligament uses :root CSS tokens, not the .dark class. dark:* variants never apply. Use explicit color values or CSS token references.

### Email (every send point)
- Resolve recipient from profiles table by user ID — never nullable column
- siteBaseUrl() from lib/email.ts — never hardcode withligament.com
- Partner emails: /partner/* links only. Agency emails: /agency/* links only
- buildBrandedEmailHtml() always — no plain text, no unbranded templates
- Wrap all Resend sends in try/catch — email failure must never fail the API
- No em dashes in copy (one exception: Founding Member banner)
- Sign off: "The Ligament Team" + withligament.com

### API routes
- supabase.auth.getUser() — return 401 if no session
- Check role — return 403 if wrong role
- Never trust client payload for status transitions
- Never silently drop recipients or skip operations

### UI
- All list views: useMemo derived list pattern for filter/sort
- Never show "no project selected" while isLoadingProjects is true
- All buttons: legible text in default state
- formatDateTime() from lib/utils.ts for all timestamps
- Dedup projects by ID at context and render level
- foreground-muted = #CCCCCC on dark surfaces

### Broad fix pattern (always)
Fix the specific instance + audit entire codebase for same pattern + fix all instances + return complete file list.

---

## Key Files (paste these to Claude when relevant)
| File | Purpose |
|------|---------|
| app/agency/dashboard/page.tsx | Dashboard — has useMemo crash (P1) |
| app/agency/project/page.tsx | Active Engagements — K.2 alert bleed |
| app/api/agency/rfp-responses/[id]/route.ts | Award flow — K.1 three DB writes |
| app/api/projects/route.ts | Projects API — needs agency_id index |
| components/agency-layout.tsx | Agency sidebar, nav, avatar |
| components/partner-layout.tsx | Partner nav, avatar |
| components/file-upload.tsx | Shared upload — allowedTypes prop |
| app/api/profile/route.ts | Shared PATCH for user profile fields |
| app/api/upload/route.ts | File upload — all private blob |
| app/api/partnerships/route.ts | Partnership CRUD |
| app/api/partner/partnerships/claim/route.ts | Claim — service role client |
| app/auth/callback/route.ts | Email confirm, partnership claim |
| lib/email.ts | siteBaseUrl(), buildBrandedEmailHtml() |
| lib/upload-validation.ts | MIME type validation |
| middleware.ts | Route protection, param preservation |

---

## Deploy Sequence
```bash
git add . && git commit -m "type: description" && git push
```
Types: feat, fix, chore, refactor

Migration sequence:
1. Create SQL in supabase/migrations/[number]_[description].sql
2. Run in Supabase SQL Editor
3. Confirm "Success. No rows returned"
4. Update migrations table in LIGAMENT_CONTEXT.md
5. Deploy code

---

## Supabase Email Templates (Supabase dashboard → Auth → Email Templates)
- Confirm signup: branded dark/green template configured Apr 24
- Subject: "Confirm your Ligament account"
- CTA uses {{ .ConfirmationURL }} — do not change

---

## Session End Checklist
- [ ] All changes committed and pushed
- [ ] LIGAMENT_CONTEXT.md updated (migrations, open issues)
- [ ] New handoff doc written
- [ ] ligament_qa_v5.xlsx updated with new pass/fail results
