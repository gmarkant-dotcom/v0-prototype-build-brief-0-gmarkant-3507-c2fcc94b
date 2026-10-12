"use client"

import useSWR from "swr"
import { isBudgetSpineMissing } from "@/lib/server/budget/result"
import { BUDGET_TABLES } from "@/lib/server/budget/schema"

/**
 * IS THE BUDGET SPINE ENABLED? Used only to decide whether a nav item links or stays a
 * placeholder. Never throws, never errors a layout: any failure reads as "not enabled".
 *
 * Detection is the server layer's own mechanism, isBudgetSpineMissing() from
 * lib/server/budget/result.ts (42P01 / PGRST205 and friends), applied to a one-row probe made with
 * the browser Supabase client under the caller's own session. It does not call the app's own API.
 * Row level security decides what the probe can see; the probe reads only `id`, keeps nothing, and
 * a zero-row answer still means "the table exists".
 *
 *   "core"       budget_template_categories (103): the agency 00 Budgeting item.
 *   "documents"  source_documents (104): the vendor Budget Documents item.
 *
 * Cached by SWR for the session; a reload after 103 / 104 are applied picks the change up.
 */
export type SpineProbe = "core" | "documents"

async function probe(kind: SpineProbe): Promise<boolean> {
  try {
    const { createClient } = await import("@/lib/supabase/client")
    const supabase = createClient()
    const table = kind === "core" ? BUDGET_TABLES.templateCategories : BUDGET_TABLES.sourceDocuments
    const { error } = await supabase.from(table).select("id").limit(1)
    if (!error) return true
    if (isBudgetSpineMissing(error)) return false
    return false
  } catch {
    return false
  }
}

export function useBudgetSpineEnabled(kind: SpineProbe): boolean {
  const { data } = useSWR(["budget-spine-enabled", kind], ([, k]) => probe(k as SpineProbe), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    dedupingInterval: 5 * 60 * 1000,
  })
  return data === true
}
