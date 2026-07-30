"use client"

import { useCallback, useEffect, useState } from "react"

export type DashboardPortal = "agency" | "partner"

function collapseStorageKey(portal: DashboardPortal, sectionKey: string): string {
  return `ligament:${portal}:section-collapsed:${sectionKey}`
}

/**
 * Section collapse/expand state, persisted per section per portal in localStorage. Shared
 * by the agency dashboard ("Needs Your Attention", "Recent Activity") and the partner
 * dashboard ("Needs Your Response", "Recent Activity").
 *
 * Always starts expanded (matches the server-rendered markup) - the persisted value is
 * only read after mount, so a section a returning visitor previously collapsed flashes
 * expanded for one frame rather than causing a hydration mismatch.
 */
export function useSectionCollapse(portal: DashboardPortal, sectionKey: string) {
  const [collapsed, setCollapsed] = useState(false)
  const key = collapseStorageKey(portal, sectionKey)

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(key) === "1")
    } catch {
      // localStorage unavailable (private mode, etc.) - stay expanded.
    }
  }, [key])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(key, next ? "1" : "0")
      } catch {
        // Ignore - collapse state just won't persist this session.
      }
      return next
    })
  }, [key])

  return { collapsed, toggle }
}

/**
 * Caps a list at `cap` items until expanded, always keeping any item matching `isUrgent`
 * visible even while collapsed - a deadline three days out shouldn't hide behind "Show all"
 * just because it's the sixth row.
 */
export function useCappedList<T>(items: T[], cap: number, isUrgent?: (item: T) => boolean) {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded((e) => !e), [])
  const hasMore = items.length > cap

  const visible =
    !hasMore || expanded
      ? items
      : (() => {
          const head = items.slice(0, cap)
          const extraUrgent = isUrgent ? items.slice(cap).filter(isUrgent) : []
          return [...head, ...extraUrgent]
        })()

  return { visible, hasMore, expanded, toggle, total: items.length }
}
