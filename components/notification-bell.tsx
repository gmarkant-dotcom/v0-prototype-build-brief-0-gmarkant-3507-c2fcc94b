"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Bell, Check } from "lucide-react"
import { cn, formatDateTime } from "@/lib/utils"
import { resolveNotificationDestination } from "@/lib/notification-routing"

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
 *
 * ---------------------------------------------------------------------------
 * PAGINATION, 2026-08-26. THE TWENTY-FIRST NOTIFICATION USED TO BE UNREACHABLE.
 *
 * This component asked for `?limit=20` and the endpoint had no offset or cursor, so the
 * twenty-first-newest row could not be reached from anywhere in the product. Not "hard to
 * find" - there was no request that returned it. That got worse the moment 095 turned on
 * `bid_submitted`, because bids arrive far more often than partnership acceptances.
 *
 * A CURSOR, NOT AN OFFSET. Rows arrive at the HEAD of this feed while the panel is open, and
 * an offset counts from the head: one new notification between page one and page two shifts
 * every row down a slot, so `offset=20` re-serves row 20 and the page boundary drifts by
 * exactly as many rows as arrived. A `created_at` cursor is anchored to a row rather than to
 * a position, so what arrives above it cannot move it.
 *
 * A BUTTON, NOT INFINITE SCROLL, and the reason is where this component is mounted. Infinite
 * scroll fires requests off scroll position inside a 380px box that exists on every page of
 * both portals - momentum on a trackpad would request two or three pages nobody asked for,
 * multiplied by every page in the portal. A button is one request per deliberate click, it
 * cannot fire while the panel is closed, and it is reachable from a keyboard.
 *
 * AND THE EXTRA PAGES DO NOT GO THROUGH SWR, DELIBERATELY. Page one stays on the useSWR call
 * below, unchanged, so the layout-mounted request keeps its 30-second dedupe. Further pages
 * are plain fetches held in local state. useSWRInfinite was the obvious alternative and was
 * rejected for this mount point: it re-requests EVERY loaded page on each revalidation, so a
 * person who had clicked "Load more" four times would issue five requests per revalidation
 * on every page of the portal. That is the multiplication the paragraph above exists to
 * prevent, arriving by a different door.
 *
 * ---------------------------------------------------------------------------
 * ROUTING, 2026-09-14. THE ROW WAS ALREADY CLICKABLE. IT WAS GOING TO THE WRONG PLACE.
 *
 * The reported defect was "clicking a notification does nothing", and the click target was
 * never missing: this file has pushed `n.link` since it shipped, and every write site sets a
 * link. Two things were actually wrong, and both are fixed here.
 *
 *   1. THE DESTINATION THREW THE IDENTIFIER AWAY. `notifyBidSubmitted` writes
 *      `data: { responseId }` and `link: '/agency/bids'` in the same call, so "April Partner
 *      Test Agency updated their bid" knew which bid it meant and sent you to a list of all
 *      of them. Pushed while already standing on that list, it moved nothing, which is what
 *      "does nothing" looked like. Destinations are now resolved from `(type, data, variant)`
 *      in lib/notification-routing.ts, at READ time, so rows already in the table get the
 *      better destination without a backfill.
 *
 *   2. `variant` DECIDED NOTHING. This is ONE component in BOTH portals and the endpoint
 *      filters by user, not by portal - so a dual-role user sees vendor rows in the agency
 *      portal and vice versa. Clicking one pushed the other portal's URL and middleware
 *      redirected them to their own portal's home, silently. Those rows are now inert here
 *      rather than dead-ended there.
 *
 * AND CLICKING A ROW NOW MARKS IT READ, which it never did. See markOneRead().
 *
 * The routing table this implements, all 26 (type, viewer side) cells of it, including the
 * ones deliberately left unrouted and the rulings still owed, is
 * docs/100-phase0-baseline.md.
 */

type NotificationRow = {
  id: string
  type: string | null
  title: string | null
  message: string | null
  link: string | null
  read: boolean | null
  created_at: string | null
  /**
   * The `data` jsonb, carried through because it is where the record identifiers live. The
   * endpoint has always returned it (`select('*')`); this type simply stopped at `link`, which
   * is the shape of the defect: `notifyBidSubmitted` writes `data.responseId` and a link of
   * `/agency/bids` in the same call, so the row knew which bid it was about and the panel did
   * not look. Typed `unknown` rather than a union of every payload shape - the two write sites
   * behind `project_assignment` do not agree on their keys (F3), so a declared shape would be
   * a claim this file cannot keep. lib/notification-routing.ts reads it defensively.
   */
  data?: unknown
}

type NotificationsResponse = {
  notifications?: NotificationRow[]
  unreadCount?: number
  /** Added with the cursor. Absent on any older cached body, which reads as "no more". */
  hasMore?: boolean
  nextCursor?: string | null
  error?: string
}

/** One page, first and subsequent alike. Also the endpoint's cap is 50, so this fits. */
const PAGE_SIZE = 20

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
 * The thirteen keys are exactly `NotificationType` in lib/notifications.ts. They are NOT
 * imported from it: that module builds a service-role Supabase client at call time and
 * pulls in @supabase/supabase-js, and importing it here would drag all of that into the
 * client bundle of every page in both portals to read thirteen strings. The cost of the
 * duplication is that a new type added there is not labelled here, and that cost is exactly
 * what the fallback covers - as 099 demonstrated, shipping `rfp_closed` and
 * `rfp_not_selected` straight onto the fallback because this map was not opened with it.
 *
 * lib/notification-routing.ts duplicates the same list for the same reason and pays the same
 * cost, and its `default` branch is the equivalent fallback for the destination.
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
  // Added 2026-09-14. Migration 099 put these two in the union and in the CHECK constraint and
  // did not add them here, so both had been rendering through unknownTypeLabel() as the raw
  // strings "Rfp closed" and "Rfp not selected". That fallback worked exactly as its header
  // says it should - visible rather than invisible - which is how this was found.
  rfp_closed: "RFP",
  rfp_not_selected: "RFP",
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
  const [open, setOpen] = useState(false)
  const [marking, setMarking] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // No fetcher argument and no refreshInterval: both come from SWRProvider. See the header.
  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>(`/api/notifications?limit=${PAGE_SIZE}`)

  /**
   * Every page after the first, plus the cursor for the page after those.
   *
   * `null` means nobody has clicked "Load more" yet, which is NOT the same as "there are no
   * more" - that distinction is what lets `nextCursor` below fall back to page one's cursor
   * without an effect. A `cursor` of null inside the object means the pager is finished.
   */
  const [more, setMore] = useState<{ rows: NotificationRow[]; cursor: string | null } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)

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
  /**
   * Page one and every loaded page after it, deduplicated by id - the house IIFE pattern,
   * and here it is load-bearing rather than defensive. The endpoint pages with `lte` on
   * `created_at` precisely so that a row sharing the boundary timestamp is never stepped
   * over, and the price of never skipping is that the boundary row comes back a second time.
   * This is where that duplicate is dropped.
   *
   * It also absorbs the other overlap: page one revalidates on its own schedule, so a row
   * that was page one's last item can reappear after new rows push it down.
   */
  const rows = useMemo(() => {
    if (failed) return []
    // Built inside the callback rather than above it: a `failed ? [] : ...` expression at
    // component scope is a new array reference on every render, so it would defeat the memo
    // it is a dependency of.
    const firstPage = data?.notifications ?? []
    const seen = new Set<string>()
    return [...firstPage, ...(more?.rows ?? [])].filter((n) => {
      if (!n?.id || seen.has(n.id)) return false
      seen.add(n.id)
      return true
    })
  }, [failed, data?.notifications, more])

  /**
   * THE BADGE IS THE SERVER'S FULL UNREAD COUNT AND IS NOT DERIVED FROM `rows`.
   *
   * `unreadCount` counts every unread row addressed to this user; `rows` holds the pages
   * that have been loaded. Counting the loaded rows instead would make the badge shrink to
   * fit the page, which is a smaller number and a wrong one. The two are allowed to
   * disagree and that disagreement is correct - see docs/bell-pagination-report.md.
   */
  const unread = failed ? 0 : data?.unreadCount ?? 0

  // No effect and no state sync: before anyone clicks, the cursor is page one's; after,
  // it is whatever the last loaded page returned. A revalidated page one therefore cannot
  // rewind a pager that is already running.
  const nextCursor = failed ? null : more ? more.cursor : data?.nextCursor ?? null
  const canLoadMore = Boolean(nextCursor) && !failed

  const loadMore = async () => {
    if (loadingMore || !nextCursor) return
    setLoadingMore(true)
    setLoadMoreFailed(false)
    try {
      const res = await fetch(
        `/api/notifications?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: "same-origin" }
      )
      if (!res.ok) {
        setLoadMoreFailed(true)
        return
      }
      const body = (await res.json()) as NotificationsResponse
      if (body.error) {
        setLoadMoreFailed(true)
        return
      }
      const known = new Set(rows.map((n) => n.id))
      const fresh = (body.notifications ?? []).filter((n) => n?.id && !known.has(n.id))
      setMore((prev) => ({
        rows: [...(prev?.rows ?? []), ...fresh],
        /**
         * STOP WHEN A PAGE ADDS NOTHING NEW, whatever `hasMore` says. `hasMore` is
         * `rows.length === limit` server-side, so it stays true for a page made entirely of
         * boundary duplicates. Without this the button would sit there loading the same
         * rows for ever. It costs the tail only in one shape - more than PAGE_SIZE rows
         * carrying an identical `created_at` for one person - and stopping is the right
         * failure for that: the alternative is a button that never finishes.
         */
        cursor: fresh.length > 0 ? body.nextCursor ?? null : null,
      }))
    } catch {
      setLoadMoreFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

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
      if (res.ok) {
        // The PATCH marked EVERY unread row for this user, not just page one's - so the
        // loaded pages below page one really are read now, and saying so locally is
        // accurate rather than optimistic. Leaving them alone would show a panel where the
        // top twenty lose their unread dot and everything under it keeps one.
        setMore((prev) => (prev ? { ...prev, rows: prev.rows.map((n) => ({ ...n, read: true })) } : prev))
        await mutate()
      }
    } catch {
      // Leave the badge as it is. A count that silently zeroes itself on a failed write is
      // worse than one that stays up: the second is wrong for thirty seconds, the first
      // hides unread items permanently.
    } finally {
      setMarking(false)
    }
  }

  /**
   * ONE ROW, MARKED READ. NEW BEHAVIOUR, AND IT REPLACES NOTHING.
   *
   * Clicking a row never marked it read: `openNotification` closed the panel and pushed, and
   * "Mark all read" was the only writer of `read` in the product. So there is no existing
   * read behaviour for routing to lose - the brief's 1a guards against a case that does not
   * exist here, and this is the case being added.
   *
   * NO NEW ENDPOINT. `PATCH /api/notifications` has accepted `{ notificationIds }` since it
   * was written and scopes its UPDATE to `user_id = auth.uid()` server-side
   * (app/api/notifications/route.ts:220-231). Nothing about who may write what changes.
   *
   * NOT OPTIMISTIC, FOR THE REASON markAllRead ALREADY GIVES. Local state moves only after the
   * server says the write landed. A badge that decrements on a request that failed hides an
   * unread item permanently; one that is stale for thirty seconds corrects itself. The panel
   * is closing and the user is navigating either way, so the optimism would buy nothing
   * visible and would cost exactly that.
   *
   * IT DOES NOT BLOCK NAVIGATION. The caller does not await it. The row is a real <Link>, so
   * the browser is already navigating while this is in flight, and a failed PATCH must never
   * be able to hold up or cancel a click that was about going somewhere.
   */
  const markOneRead = async (n: NotificationRow) => {
    if (n.read) return
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ notificationIds: [n.id] }),
      })
      if (!res.ok) return
      setMore((prev) =>
        prev ? { ...prev, rows: prev.rows.map((r) => (r.id === n.id ? { ...r, read: true } : r)) } : prev
      )
      await mutate()
    } catch {
      // Same reasoning as markAllRead: leave the badge alone rather than claim a write landed.
    }
  }

  const onRowActivate = (n: NotificationRow) => {
    setOpen(false)
    void markOneRead(n)
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
                {rows.map((n) => {
                  /**
                   * WHERE THIS ROW GOES FROM THIS PORTAL, OR NULL.
                   *
                   * `variant` decides. It used to be a colour switch and nothing else - every
                   * other use of `isAgency` in this file is a className - which is precisely
                   * how the same row came to be clickable in a portal that refuses it. See
                   * lib/notification-routing.ts and docs/100-phase0-baseline.md section 5.
                   */
                  const destination = resolveNotificationDestination(n, variant)

                  const body = (
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
                  )

                  /**
                   * THE SHARED GEOMETRY. Identical for both branches, so a routed row and an
                   * unrouted one are the same size and the same shape and the difference
                   * between them is only the affordance.
                   */
                  const frame = cn(
                    "block w-full text-left px-4 py-3 border-b last:border-b-0",
                    isAgency ? "border-border" : "border-black/5",
                    !n.read && (isAgency ? "bg-accent/5" : "bg-[#C8F53C]/10")
                  )

                  /**
                   * 1b. A ROW THAT IS NOT ROUTED MUST NOT LOOK CLICKABLE.
                   *
                   * No hover, no pointer cursor, no focus stop - a plain <div>, not a <div>
                   * with a handler and not a disabled <button> (which keeps the shape of a
                   * control and reads to a screen reader as one that is broken). The text is
                   * byte-identical to the routed branch, so nothing is hidden: the row still
                   * says what happened, it just does not promise to take you anywhere.
                   *
                   * This IS a change from today for the cross-portal rows, which currently
                   * navigate and get bounced by middleware to this portal's home with no
                   * message. That is a dead click with a side effect, and 1b is explicit that
                   * shipping a second set of dead clicks is not the fix for the first. R1 in
                   * docs/100-phase0-baseline.md puts the alternative to Greg.
                   */
                  if (!destination) {
                    return (
                      <li key={n.id}>
                        <div className={frame}>{body}</div>
                      </li>
                    )
                  }

                  /**
                   * 1e. A LINK, NOT A BUTTON, BECAUSE IT NAVIGATES.
                   *
                   * It was a <button type="button"> that called router.push, which is keyboard
                   * reachable but announces as "button" and cannot be opened in a new tab or
                   * have its target previewed. <Link> is the right element and the right
                   * implicit role for a control whose whole job is to go somewhere, and it
                   * costs nothing: onClick still closes the panel and marks the row read, and
                   * a cmd-click that opens a new tab marks it read too, which is correct.
                   */
                  return (
                    <li key={n.id}>
                      <Link
                        href={destination}
                        onClick={() => onRowActivate(n)}
                        className={cn(
                          frame,
                          "transition-colors",
                          isAgency ? "hover:bg-white/5" : "hover:bg-black/[0.03]"
                        )}
                      >
                        {body}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Below the list and inside the same scroll box, so it sits at the end of the
                loaded rows rather than pinned over them. Hidden entirely once the feed is
                exhausted - a permanently disabled control reads as broken. */}
            {!failed && rows.length > 0 && canLoadMore ? (
              <div className={cn("px-4 py-3 border-t", isAgency ? "border-border" : "border-black/10")}>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className={cn(
                    "w-full font-mono text-2xs uppercase tracking-wider py-1.5 rounded-lg transition-colors disabled:opacity-50",
                    isAgency
                      ? "text-foreground-muted hover:text-accent hover:bg-white/5"
                      : "text-black/50 hover:text-[#0C3535] hover:bg-black/[0.03]"
                  )}
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </button>
                {/* Says which request failed. A failed "Load more" must never be mistaken
                    for the end of the list, which is what a silently vanishing button
                    would look like. */}
                {loadMoreFailed ? (
                  <p className={cn("text-xs mt-2", isAgency ? "text-foreground-muted" : "text-black/60")}>
                    Older notifications could not be loaded. Try again.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
