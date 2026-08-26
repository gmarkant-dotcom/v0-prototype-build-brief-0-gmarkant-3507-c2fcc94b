"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Bell, Check } from "lucide-react"
import { cn, formatDateTime } from "@/lib/utils"

/**
 * THE CONSUMER FOR AN INBOX THAT HAS BEEN WRITTEN TO FOR MONTHS AND READ BY NOBODY.
 *
 * `notifications` has SIXTEEN write sites (every one of them routed through
 * lib/notifications.ts), a GET and a mark-all-read at app/api/notifications/route.ts, and -
 * until this file - ZERO callers of either. The route's own header comment says so. Rows
 * have been accumulating that no surface in either portal renders. This is a UI gap, not a
 * feature build: nothing new is written, no table is added, no endpoint is added.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WAS SAFE TO BUILD ON THAT ENDPOINT, WHICH WAS CHECKED BEFORE ANY OF THIS WAS
 * WRITTEN.
 *
 * The vendor RFP inbox trusted RLS for scoping and handed the agency's own outbound rows
 * back to the vendor portal. A read placed in a shared layout inherits whatever scoping
 * defect it is built on, on every page in the portal at once, so the endpoint was read
 * first:
 *
 *   - IT FILTERS EXPLICITLY. `.eq('user_id', user.id)` on the list query, on the unread
 *     count, and on both arms of the PATCH (route.ts:34, 55, 88, 99). RLS is a second wall
 *     behind it ("Users can view own notifications", USING user_id = auth.uid()), not the
 *     only one. This is not the vendor-inbox shape.
 *   - IT USES THE CALLER'S SESSION CLIENT, never the service role: requireAuth() returns
 *     the cookie-scoped client from lib/supabase/server.ts.
 *   - ZERO ROWS IS AN EMPTY ARRAY, NOT AN ERROR: `notifications: notifications || []`,
 *     `unreadCount: count || 0`. There is no error case for the empty inbox to swallow.
 *
 * ---------------------------------------------------------------------------
 * NO POLLING LOOP. This calls useSWR with NO refreshInterval, so it inherits SWRProvider's
 * configuration verbatim - dedupingInterval 30000, revalidateOnFocus false. One request per
 * mount, deduped across the thirty-second window. That matters more here than anywhere
 * else: this component sits in a layout that every page in the portal renders, so an
 * interval set here would multiply across the whole portal rather than costing one screen.
 * The trade is stated plainly: an item that arrives while the tab is open shows up on the
 * next navigation, not within seconds. A bell that is a few minutes stale is the correct
 * price for not adding a portal-wide poll.
 */

type NotificationRow = {
  id: string
  type: string | null
  title: string | null
  message: string | null
  link: string | null
  read: boolean | null
  created_at: string | null
}

type NotificationsResponse = {
  notifications?: NotificationRow[]
  unreadCount?: number
  error?: string
}

/**
 * WHAT EACH TYPE IS CALLED, AND WHAT HAPPENS TO A TYPE THAT IS NOT LISTED.
 *
 * THE mapMilestoneGroup LESSON, APPLIED: a type this map does not know must never be
 * silently dropped, and must never render as a blank row. Both failures look like the
 * feature working.
 *
 * It cannot be dropped, because nothing filters on this map - every row the endpoint
 * returns is rendered, and this map only decides the small grey label above the title. An
 * unlisted type falls through to `unknownTypeLabel()` below, which renders the raw type
 * string rather than nothing, so a type nobody has written wording for arrives looking
 * unfinished instead of arriving invisible. That is the intended outcome: a visible gap is
 * a bug report, a silent drop is not.
 *
 * The eleven keys are exactly `NotificationType` in lib/notifications.ts. They are NOT
 * imported from it: that module builds a service-role Supabase client at call time and
 * pulls in @supabase/supabase-js, and importing it here would drag all of that into the
 * client bundle of every page in both portals to read eleven strings. The cost of the
 * duplication is that a new type added there is not labelled here, and that cost is exactly
 * what the fallback covers.
 */
const TYPE_LABELS: Record<string, string> = {
  partnership_invitation: "Partnership",
  partnership_accepted: "Partnership",
  partnership_declined: "Partnership",
  project_assignment: "RFP",
  project_accepted: "Bid",
  project_declined: "Bid",
  new_message: "Message",
  document_uploaded: "Document",
  project_awarded: "Award",
  onboarding_deployed: "Onboarding",
  bid_submitted: "Bid",
}

/**
 * A type with no wording, rendered so it can be seen rather than hidden.
 *
 * `bid_submitted` becomes "Bid submitted". Not a translation - a legible placeholder that
 * names the thing so whoever sees it can say which wording is missing. Falls back again to
 * "Update" for a row whose type column is null or blank, which the absent DDL does not rule
 * out (the table has no CREATE TABLE anywhere in this repository, so no NOT NULL can be
 * assumed from source).
 */
function unknownTypeLabel(type: string | null): string {
  const raw = (type || "").trim()
  if (!raw) return "Update"
  const words = raw.replace(/[_-]+/g, " ").trim()
  if (!words) return "Update"
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function typeLabel(type: string | null): string {
  const raw = (type || "").trim()
  if (raw && TYPE_LABELS[raw]) return TYPE_LABELS[raw]
  return unknownTypeLabel(type)
}

/**
 * A row whose title is missing still renders something a person can act on.
 *
 * Every one of the sixteen write sites passes a literal title, so this should never fire
 * today. It exists because the alternative when it does fire is a row of correct height
 * with nothing in it, which reads as a rendering bug in the bell rather than as a bad row.
 */
function rowTitle(n: NotificationRow): string {
  const t = (n.title || "").trim()
  if (t) return t
  return `${typeLabel(n.type)} notification`
}

type BellVariant = "agency" | "vendor"

export function NotificationBell({ variant }: { variant: BellVariant }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [marking, setMarking] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // No fetcher argument and no refreshInterval: both come from SWRProvider. See the header.
  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>("/api/notifications?limit=20")

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // A response body carrying an `error` key is a failure even when the transport succeeded.
  // The badge must never render off a body this component could not read, or an unreachable
  // endpoint shows up as "0 unread", which is a claim rather than a silence.
  const failed = Boolean(error) || Boolean(data?.error)
  const rows = failed ? [] : data?.notifications ?? []
  const unread = failed ? 0 : data?.unreadCount ?? 0

  const markAllRead = async () => {
    if (marking || unread === 0) return
    setMarking(true)
    try {
      // The EXISTING mark-all-read. PATCH /api/notifications with markAllRead, which scopes
      // its UPDATE to user_id = auth.uid() server-side. No new endpoint.
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ markAllRead: true }),
      })
      if (res.ok) await mutate()
    } catch {
      // Leave the badge as it is. A count that silently zeroes itself on a failed write is
      // worse than one that stays up: the second is wrong for thirty seconds, the first
      // hides unread items permanently.
    } finally {
      setMarking(false)
    }
  }

  const openNotification = (n: NotificationRow) => {
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  const isAgency = variant === "agency"

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className={cn(
          "relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors",
          isAgency
            ? "bg-white/5 hover:bg-white/10 text-foreground-muted hover:text-foreground"
            : "hover:bg-white/10 text-white/80 hover:text-white"
        )}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span
            className={cn(
              "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full font-mono text-2xs flex items-center justify-center",
              isAgency ? "bg-accent text-accent-foreground" : "bg-[#C8F53C] text-[#0C3535]"
            )}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            /**
             * z-30: above this layout's own chrome (both portals pin theirs at z-20) and
             * BELOW every modal layer - 60 UpgradeRequiredModal, 100 toast, 550
             * alert-dialog. A dropdown must lose to all three. If it beat the upgrade modal
             * it would hide a refusal raised while the bell is open, which is exactly the
             * defect fixed in 9f65595.
             *
             * The agency sidebar is `fixed ... z-20` and <main> is `relative z-10`
             * (agency-layout.tsx:497 and :838), so the aside's whole subtree already paints
             * above the page. Layering was never the problem here.
             */
            "absolute z-30 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-xl overflow-hidden",
            /**
             * bg-popover AND NOT bg-card, BECAUSE --card IS 7% OPAQUE.
             *
             * globals.css:12 defines `--card: rgba(255, 255, 255, 0.07)`. On the agency side
             * this panel was `bg-card`, so the dashboard's attention rows and metric cards
             * showed straight through it. The vendor branch below was never affected: it is
             * `bg-white`, a flat opaque literal, which is why the same component rendered
             * correctly in one portal and illegibly in the other.
             *
             * WHY bg-card LOOKED CORRECT WHEN IT WAS WRITTEN. CLAUDE.md prescribes
             * `bg-card border border-border rounded-xl` for agency surfaces - and that rule
             * is written for MODALS, every one of which sits on a `bg-black/80
             * backdrop-blur-sm` overlay. 7% white over an 80% black overlay reads as solid.
             * A DROPDOWN HAS NO OVERLAY, so the same class is simply see-through. The token
             * is fine; the assumption baked into the convention is that something else is
             * darkening what is behind you.
             *
             * NOT A NEW CHOICE. components/help-term.tsx:118-124 hit this exact bug and
             * fixed it the same way, and says so: "bg-card was the bug: --card is only 7%
             * opaque, effectively see-through." --popover is rgba(4, 20, 20, 0.95), and it
             * is what every Radix dropdown and popover in this codebase already uses.
             */
            isAgency
              ? "left-0 top-full bg-popover border-border"
              : "right-0 top-full bg-white border-black/10"
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between px-4 py-3 border-b",
              isAgency ? "border-border" : "border-black/10"
            )}
          >
            <div className={cn("font-display font-bold text-sm", isAgency ? "text-foreground" : "text-[#0C3535]")}>
              Notifications
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={marking}
                className={cn(
                  "font-mono text-2xs flex items-center gap-1 transition-colors disabled:opacity-50",
                  isAgency ? "text-foreground-muted hover:text-accent" : "text-black/50 hover:text-[#0C3535]"
                )}
              >
                <Check className="w-3 h-3" />
                {marking ? "Marking..." : "Mark all read"}
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {isLoading && !data ? (
              /* Nothing is claimed while the answer is unknown. The house rule is never to
                 render an empty state during load - an inbox that says "you are all caught
                 up" and then fills in is the same lie as a promise that never fills. */
              <div className={cn("px-4 py-6 text-sm", isAgency ? "text-foreground-muted" : "text-black/50")}>
                Loading...
              </div>
            ) : failed ? (
              /* HONEST ABOUT THE FAILURE, rather than borrowing the empty state for it.
                 "No notifications" when the request failed tells somebody their inbox is
                 empty on the strength of a request that never answered. */
              <div className={cn("px-4 py-6 text-sm", isAgency ? "text-foreground-muted" : "text-black/50")}>
                Notifications could not be loaded right now. Reload the page to try again.
              </div>
            ) : rows.length === 0 ? (
              /* THE 086 PRECEDENT: say WHICH KIND OF EMPTY this is. "You are all caught up"
                 would be a guess - it claims there were items and they were handled. What
                 is actually known is that nothing addressed to this person has been written
                 yet, and the second sentence says what would put something here, so an
                 empty bell is not mistaken for a broken one. */
              <div className={cn("px-4 py-6", isAgency ? "text-foreground-muted" : "text-black/60")}>
                <div className={cn("font-display font-bold text-sm mb-1", isAgency ? "text-foreground" : "text-[#0C3535]")}>
                  Nothing here yet
                </div>
                <p className="text-xs leading-relaxed">
                  This is where you will see partnership invitations, incoming bids, awards and
                  onboarding activity. Nothing has been sent to you so far.
                </p>
              </div>
            ) : (
              <ul>
                {rows.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b last:border-b-0 transition-colors",
                        isAgency
                          ? "border-border hover:bg-white/5"
                          : "border-black/5 hover:bg-black/[0.03]",
                        !n.read && (isAgency ? "bg-accent/5" : "bg-[#C8F53C]/10")
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-1.5 w-1.5 h-1.5 rounded-full shrink-0",
                              isAgency ? "bg-accent" : "bg-[#0C3535]"
                            )}
                          />
                        )}
                        <div className={cn("flex-1 min-w-0", n.read && "pl-[14px]")}>
                          <div
                            className={cn(
                              "font-mono text-2xs uppercase tracking-wider mb-1",
                              isAgency ? "text-foreground-muted" : "text-black/40"
                            )}
                          >
                            {typeLabel(n.type)}
                          </div>
                          <div
                            className={cn(
                              "font-display font-bold text-sm",
                              isAgency ? "text-foreground" : "text-[#0C3535]"
                            )}
                          >
                            {rowTitle(n)}
                          </div>
                          {n.message ? (
                            <p className={cn("text-xs mt-0.5", isAgency ? "text-foreground-muted" : "text-black/60")}>
                              {n.message}
                            </p>
                          ) : null}
                          <div
                            className={cn(
                              "font-mono text-2xs mt-1",
                              isAgency ? "text-foreground-muted/70" : "text-black/40"
                            )}
                          >
                            {formatDateTime(n.created_at)}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
