"use client"

import { useCallback } from "react"
import { useSWRConfig } from "swr"
import { projectBase } from "./client-api"

/** Revalidate every budget read of one project (chart, lines, summary, ledger, documents). */
export function useRefreshProject(projectId: string) {
  const { mutate } = useSWRConfig()
  return useCallback(() => {
    const base = projectBase(projectId)
    return mutate((key) => typeof key === "string" && (key === base || key.startsWith(`${base}/`)))
  }, [mutate, projectId])
}

/** Revalidate the agency template reads. */
export function useRefreshTemplate() {
  const { mutate } = useSWRConfig()
  return useCallback(() => mutate((key) => typeof key === "string" && key.startsWith("/api/agency/budget/templates")), [mutate])
}
