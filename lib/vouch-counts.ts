/**
 * Vouch counts, read as a projection rather than as a table scan.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `partner_vouches` used to carry a policy reading
 *
 *   "Anyone can count vouches"  SELECT  {public}  USING (true)
 *
 * A policy grants access to ROWS, never to an aggregate, so `USING (true)` for
 * role `public` handed the complete who-vouched-for-whom graph of the whole
 * platform to anyone holding the publishable anon key. Migration 082 closed
 * that. See supabase/migrations/082_partner_vouches_containment.sql.
 *
 * 082 phase 1 created two SECURITY DEFINER functions that return the NUMBER
 * without granting row access:
 *
 *   partner_vouch_count(p_partner_id uuid)      -> bigint
 *   partner_vouch_counts(p_partner_ids uuid[])  -> (vendor_org_id, vouch_count)
 *
 * 082 phase 2 then dropped the `USING (true)` policy. Both phases are applied
 * and verified. These two RPCs are now the only way to obtain a vouch count.
 *
 * THE FALLBACKS ARE GONE, AND THEY HAD TO GO
 * ---------------------------------------------------------------------------
 * Until phase 2 landed, both functions here fell back to a direct
 * `partner_vouches` table read when PostgREST reported the RPC missing
 * (PGRST202). That fallback was correct for exactly as long as the `USING
 * (true)` policy existed to permit it, and this file said so at the time: "AFTER
 * 082 PHASE 2 IS APPLIED AND VERIFIED, DELETE THE FALLBACK."
 *
 * Leaving it in would have been worse than untidy. With the policy dropped, the
 * fallback query no longer fails - it returns 0, because PostgREST filters the
 * rows out and reports the count of what survived, which is nothing. That is the
 * exact silent zero the STOP GATE in 082 was written to prevent: every vouch
 * badge in the product reading zero with no error, no log line and no 500, and a
 * vendor with no vouches looking identical to a vendor whose count stopped
 * working. Dead code that cannot run is harmless; dead code that CAN run and
 * quietly answers wrong is a trap.
 *
 * So an RPC error is now just an RPC error: it logs with its code and returns an
 * empty count, which is what all three call sites already did on a failed query.
 * A PGRST202 in those logs means the 082 functions are missing from the schema
 * cache and every badge is reading zero - that log line is the whole warning
 * system now, which is why the code is included in it.
 *
 * 079 SEAM
 * ---------------------------------------------------------------------------
 * `partner_vouches.vendor_org_id` and `lead_org_id` are the post-079 names of the two
 * pre-079 vouched-partner / voucher-agency columns. The RPC parameter names do
 * not change; what changes is that the id passed is an organization id rather
 * than a profile id.
 */

/**
 * Shape shared by the browser and server Supabase clients, narrowed to what is used
 * here. Deliberately loose: naming the real builder types drags the full generated
 * PostgREST type graph in and tsc reports TS2589, "type instantiation is excessively
 * deep". These two functions read a count and nothing else, so the loose shape costs
 * no real safety - and the repository has no generated `Database` types for the
 * strict version to have checked against anyway (docs/079-rename-plan.md, "The one
 * thing to read before anything else").
 *
 * `from` is deliberately absent. It was here only for the deleted table-read
 * fallbacks, and leaving it off means this module cannot reach `partner_vouches`
 * directly even by accident.
 */
type PostgrestErrorish = { code?: string; message?: string } | null

type VouchCapableClient = {
  rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PostgrestErrorish }>
}

/**
 * Vouch count for one vendor. Returns 0 rather than throwing, which is what all
 * three previous call sites did.
 */
export async function fetchVouchCount(supabase: VouchCapableClient, partnerId: string): Promise<number> {
  const { data, error } = await supabase.rpc("partner_vouch_count", { p_partner_id: partnerId })

  if (error) {
    console.error("[vouch-counts] partner_vouch_count failed", { code: error.code, message: error.message })
    return 0
  }

  const n = typeof data === "number" ? data : Number(data)
  return Number.isFinite(n) ? n : 0
}

/**
 * Vouch counts for a set of vendors, as a map. Vendors with no vouches are absent
 * from the map; every caller reads a missing key as 0.
 */
export async function fetchVouchCounts(
  supabase: VouchCapableClient,
  partnerIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (partnerIds.length === 0) return counts

  const { data, error } = await supabase.rpc("partner_vouch_counts", { p_partner_ids: partnerIds })

  if (error) {
    console.error("[vouch-counts] partner_vouch_counts failed", { code: error.code, message: error.message })
    return counts
  }

  // This reads `vendor_org_id` off the RPC result. 082 as applied declares
  // `RETURNS TABLE (vendor_org_id uuid, vouch_count bigint)` (082:330), the post-079
  // name, so the two agree. If that function were ever recreated from a pre-079 copy of
  // the file it would return the old vouched-partner name instead, every key here would
  // be undefined, and every count would read 0 silently. 082's verification step V3
  // exists to catch exactly that.
  for (const row of (data as Array<{ vendor_org_id?: string; vouch_count?: number | string }> | null) ?? []) {
    const pid = row?.vendor_org_id
    if (!pid) continue
    const n = Number(row.vouch_count)
    counts.set(pid, Number.isFinite(n) ? n : 0)
  }
  return counts
}
