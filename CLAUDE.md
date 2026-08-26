# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Required reading:** `LIGAMENT_CONTEXT.md` contains the complete architecture constraints, migration log, file reference map, email trigger map, and open backlog. Read it at the start of every session before writing any code.

---

## Project

**Ligament** — AI-powered vendor orchestration SaaS for creative/production agencies. Lead agencies manage partner agencies across RFP broadcast, bid management, onboarding, and cash flow.

- **Live site:** https://www.withligament.com
- **Stack:** Next.js 16 / Supabase / Vercel / Resend / Anthropic API / Vercel Blob / Supabase Storage
- **Package manager:** pnpm (never npm or yarn)
- **Deploy:** `git push` only — never `vercel deploy`

---

## Commands

```bash
pnpm dev          # start dev server at localhost:3000
pnpm build        # production build
pnpm lint         # ESLint
npx tsc --noEmit  # TypeScript check — must pass (exit 0) before every commit
```

**Deploy sequence:**
```bash
git add -A && git commit -m "type: description" && git push
```
Commit types: `feat`, `fix`, `chore`, `refactor`

**Migration sequence** (always before deploying dependent code):
1. Create SQL file in `supabase/migrations/`
2. Run in Supabase SQL Editor — confirm "Success. No rows returned"
3. Update migrations table in `LIGAMENT_CONTEXT.md`
4. Then deploy code

---

## Architecture

### Dual-portal structure

Two separate portals share one Supabase auth system. Users are differentiated by `profiles.role` (`agency` | `partner`) and `profiles.active_role` (current portal). Dual-role users can switch portals via `/api/profile/switch-role`.

- `app/agency/` — Lead agency portal (authenticated, role-guarded)
- `app/partner/` — Partner portal (authenticated, role-guarded)
- `app/api/` — API routes (excluded from middleware session refresh — see constraint below)
- `app/auth/` — Auth pages (public)
- `app/pricing/`, `app/contact/`, `app/legal/` — Public marketing pages

### Middleware (`middleware.ts`)

Protects `/agency`, `/partner`, `/admin` routes. **Critical:** The matcher excludes `api/` — server Supabase clients inside API routes cannot read session cookies.

**For new data fetching, prefer the browser Supabase client directly from components:**
```typescript
const { createClient } = await import('@/lib/supabase/client')
const supabase = createClient()
```

Use `app/api/projects/route.ts` or `app/api/partnerships/route.ts` as reference if you do need a working server API route.

New public routes must be added to `publicPaths` in `middleware.ts`. The middleware preserves query params (`invite`, `email`, `nda`, `scope`, `agency`, `next`) when redirecting unauthenticated users.

### Data flow

- **SWR** handles all client-side data fetching. Global config in `components/swr-provider.tsx`. Use the `useFetch` pattern for new data hooks.
- **Selected project** is the single source of truth in `contexts/selected-project-context.tsx` — never read project state outside this context.
- `lib/project-mapper.ts` maps DB rows to the `MasterProject` UI type.

### Storage split

| Use case | Storage |
|----------|---------|
| User avatars, company logos, images | Supabase Storage (`avatars` bucket, public) |
| Private documents (NDAs, MSAs, contracts) | Vercel Blob (private-only store) |

Upload routing lives in `app/api/upload/route.ts` — it directs to Supabase Storage when `folder` is `avatars`, `logos`, `agency-logos`, or `partner-logos`.

### AI routes

All three AI routes use `@ai-sdk/anthropic` directly with `ANTHROPIC_API_KEY`. Do NOT use the Vercel AI Gateway string format — it will 500.

```typescript
import { anthropic } from "@ai-sdk/anthropic"
model: anthropic("claude-sonnet-4-20250514")
```

Routes: `app/api/ai/master-brief/route.ts`, `app/api/ai/rfp-output-template/route.ts`, `app/api/ai/route.ts`

### Email

All emails use `buildBrandedEmailHtml()` + `siteBaseUrl()` from `lib/email.ts`, always wrapped in try/catch. Sent via Resend. See `LIGAMENT_CONTEXT.md` for the complete notification trigger map.

---

## Key Rules

- **Never** use `dark:*` Tailwind variants
- **Never** show loading/empty states during hydration — wait for `isLoading` to be false
- **Never** use `GlassCard` for modals (transparent over blurred backgrounds)
- Deduplicate arrays by ID using the IIFE `useMemo` pattern — apply at both context and render level
- Use `formatDateTime()` / `formatDate()` from `lib/utils.ts` for all date display
- API routes: auth check → role check → never trust client payload
- No em dashes in user-facing copy (one exception in pricing banner — do not change)
- All platform copy: professional, direct, warm — not corporate, not casual

### Modal backgrounds

- Partner discover page (`/partner/discover`) — light theme, use `bg-white rounded-2xl`
- Agency portal — dark theme, use `bg-card border border-border rounded-xl`

**This rule holds only for surfaces sitting on an overlay.** `--card` is
`rgba(255, 255, 255, 0.07)` — 7% opaque. It reads solid in a modal only because every
modal sits on a `bg-black/80 backdrop-blur-sm` overlay that darkens the page first.

**Anything floating over page content with no overlay beneath it — dropdown, popover,
tooltip, menu, notification panel — needs an opaque background: use `bg-popover`**
(`rgba(4, 20, 20, 0.95)`), which is what every Radix dropdown here already uses. Worked
examples: `components/help-term.tsx` and the agency branch of
`components/notification-bell.tsx`, both of which shipped `bg-card` first and rendered
see-through.

---

## Pre-commit checklist

```bash
npx tsc --noEmit   # must be exit code 0
grep -rl "\](http://" app/ --include="*.ts" --include="*.tsx"  # check for markdown link corruption
```
