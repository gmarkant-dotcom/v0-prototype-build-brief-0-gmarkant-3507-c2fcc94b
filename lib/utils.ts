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
