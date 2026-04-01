/** Double-JSON-parse pattern used for budget_proposal / timeline_proposal (TEXT or JSON-encoded string). */
export function parseDoubleJson<T>(val: unknown): T | null {
  try {
    let v: unknown = val
    if (typeof v === "string") v = JSON.parse(v)
    if (typeof v === "string") v = JSON.parse(v)
    return v as T
  } catch {
    return null
  }
}

export function formatEngagementBudget(val: unknown): string {
  const o = parseDoubleJson<{ amount?: number; currency?: string }>(val)
  if (o?.amount != null && o?.currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: o.currency,
        maximumFractionDigits: 0,
      }).format(Number(o.amount))
    } catch {
      return `${Number(o.amount).toLocaleString("en-US")} ${o.currency}`
    }
  }
  return "—"
}

export function formatEngagementTimeline(val: unknown): string {
  const o = parseDoubleJson<{ duration?: number; unit?: string }>(val)
  if (o?.duration != null && o?.unit) {
    const unit = o.unit.trim()
    const label = unit.length > 0 ? unit.charAt(0).toUpperCase() + unit.slice(1) : unit
    return `${o.duration} ${label}`
  }
  return "—"
}
