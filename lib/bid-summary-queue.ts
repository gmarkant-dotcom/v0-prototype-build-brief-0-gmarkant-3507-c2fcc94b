"use client"

import { useSyncExternalStore } from "react"
import { mutate } from "swr"
import type { BidRow } from "@/lib/bid-shared"

/**
 * RULING S-A (2026-10-14): the AI bid summary is generated only through the agency's
 * generate-summary route, never on a vendor or guest submission. A bid arrives with its summary
 * PENDING (ai_summary_generated_at NULL). This module is the one client-side path to that route, so
 * the bids page, the bid detail sheet and the compare view share one in-flight call per bid and one
 * view of its state:
 *
 *  - WARM-UP. The bids page queues every pending bid on load; at most WARMUP_CONCURRENCY run at a
 *    time, so a long list does not fire dozens of AI calls at once.
 *  - ON DEMAND. Opening a bid (detail or compare) asks for it now: it skips the warm-up queue and
 *    the limit, and joins the warm-up's call if one is already running for that bid.
 *  - IDEMPOTENT. The route answers a bid that already has a complete summary from storage (no AI
 *    call, no usage); only an explicit Regenerate sends force.
 *
 * While a bid is queued or running its state is "generating", never an error. A failed call is
 * remembered as an error so the screen offers Retry, not a blank.
 */

const RFP_RESPONSES_URL = "/api/agency/rfp-responses"

export const WARMUP_CONCURRENCY = 2

export type BidSummaryFields = {
  ai_summary_short: string | null
  ai_summary_detailed: string | null
  ai_summary_generated_at: string | null
  short_failed?: boolean
  detailed_failed?: boolean
  skipped?: boolean
}

export type BidSummaryResult =
  | { ok: true; data: BidSummaryFields }
  | { ok: false; status: number; error: string; data: unknown }

const inFlight = new Map<string, Promise<BidSummaryResult>>()
const queue: string[] = []
const failed = new Map<string, string>()
/** The last summary the route returned for each bid, for views that hold their own copy of rows. */
const lastFields = new Map<string, BidSummaryFields>()
let warmupRunning = 0

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A bid with a submitted response and no summary ever generated. */
export function isBidSummaryPending(row: Pick<BidRow, "response_exists" | "ai_summary_generated_at" | "ai_summary_short">): boolean {
  return Boolean(row.response_exists) && !row.ai_summary_generated_at && !row.ai_summary_short
}

async function callRoute(responseId: string, force: boolean): Promise<BidSummaryResult> {
  try {
    const res = await fetch(`/api/agency/bids/${responseId}/generate-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, status: res.status, error: data?.error || "Analysis unavailable", data }
    // Patch the shared bids list in place (no revalidate round-trip) so every card and sheet
    // showing this bid picks the summary up immediately.
    void mutate(
      RFP_RESPONSES_URL,
      (current: { responses: BidRow[] } | undefined) =>
        current
          ? {
              ...current,
              responses: current.responses.map((r) =>
                r.id === responseId
                  ? {
                      ...r,
                      ai_summary_short: data.ai_summary_short ?? r.ai_summary_short,
                      ai_summary_detailed: data.ai_summary_detailed ?? r.ai_summary_detailed,
                      ai_summary_generated_at: data.ai_summary_generated_at ?? r.ai_summary_generated_at,
                    }
                  : r
              ),
            }
          : current,
      { revalidate: false }
    )
    return { ok: true, data: data as BidSummaryFields }
  } catch {
    return { ok: false, status: 0, error: "Analysis unavailable", data: null }
  }
}

function start(responseId: string, force: boolean, onSettled?: () => void): Promise<BidSummaryResult> {
  failed.delete(responseId)
  const p = callRoute(responseId, force).then((result) => {
    inFlight.delete(responseId)
    if (!result.ok) failed.set(responseId, "Summary unavailable - try again")
    else lastFields.set(responseId, result.data)
    onSettled?.()
    emit()
    return result
  })
  inFlight.set(responseId, p)
  emit()
  return p
}

function pump() {
  while (warmupRunning < WARMUP_CONCURRENCY && queue.length > 0) {
    const id = queue.shift() as string
    if (inFlight.has(id)) continue
    warmupRunning++
    void start(id, false, () => {
      warmupRunning--
      pump()
    })
  }
}

/** Bids page, on load: queue every pending bid not already queued, running or failed. */
export function warmUpBidSummaries(responseIds: readonly string[]) {
  let added = false
  for (const id of responseIds) {
    if (!id || inFlight.has(id) || queue.includes(id) || failed.has(id)) continue
    queue.push(id)
    added = true
  }
  if (added) {
    emit()
    pump()
  }
}

/**
 * On demand (a bid is open, or the user pressed Generate / Retry / Regenerate). Runs now; joins a
 * call already running for this bid unless `force` (Regenerate) is set.
 */
export function requestBidSummary(responseId: string, opts: { force?: boolean } = {}): Promise<BidSummaryResult> {
  const force = opts.force === true
  const running = inFlight.get(responseId)
  if (running && !force) return running
  const queued = queue.indexOf(responseId)
  if (queued >= 0) queue.splice(queued, 1)
  return start(responseId, force)
}

/**
 * Generating (queued or running), the last error, and the last summary the route returned, for
 * one bid. The snapshot is a string so it is stable between renders; `fields` is read beside it.
 */
export function useBidSummaryStatus(responseId: string): {
  generating: boolean
  error: string | null
  fields: BidSummaryFields | null
} {
  const snapshot = useSyncExternalStore(
    subscribe,
    () =>
      `${inFlight.has(responseId) || queue.includes(responseId) ? "1" : "0"}|${lastFields.get(responseId)?.ai_summary_generated_at ?? ""}|${failed.get(responseId) ?? ""}`,
    () => "0||"
  )
  const [generating, , error] = snapshot.split("|")
  return { generating: generating === "1", error: error || null, fields: lastFields.get(responseId) ?? null }
}
