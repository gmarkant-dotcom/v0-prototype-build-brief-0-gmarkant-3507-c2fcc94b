import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Use stored meeting/scheduling URLs as absolute hrefs — never relative to the site origin. */
export function normalizeMeetingUrlForHref(url: string | null | undefined): string {
  const t = (url ?? "").trim()
  if (!t) return ""
  if (t.startsWith("http://") || t.startsWith("https://")) return t
  return `https://${t.replace(/^\/+/, "")}`
}

/** Consistent display for status-update timestamps and alert panels (en-US, 12h). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}
