"use client"

import useSWR from "swr"
import { budgetFetch, BudgetApiError, projectBase } from "./client-api"
import type {
  BudgetLine,
  CategoryMerge,
  LedgerEntry,
  ProjectCategory,
  SourceDocument,
  TemplateCategory,
} from "@/lib/server/budget/schema"
import type { EstimateVsActual } from "@/lib/server/budget/summary"
import type { ProjectBudgetOverview, ProjectPartnership } from "@/lib/server/budget/overview"

/**
 * SWR hooks over the gated budget API. The repo's useFetch() discards the error body, and the
 * budget screens need it (404 enabled:false is "not enabled", not "not found"), so these use
 * useSWR with budgetFetch directly. A 4xx is not retried: "not enabled", "upgrade" and "not found"
 * do not change by retrying, and a reload picks up 103 / 104 once applied.
 */

const options = {
  revalidateOnFocus: false,
  onErrorRetry: (err: unknown, _key: string, _config: unknown, revalidate: (o: { retryCount: number }) => void, { retryCount }: { retryCount: number }) => {
    if (err instanceof BudgetApiError && err.status >= 400 && err.status < 500) return
    if (retryCount >= 2) return
    setTimeout(() => revalidate({ retryCount }), 2000)
  },
}

function useBudget<T>(url: string | null) {
  return useSWR<T>(url, (u: string) => budgetFetch<T>(u), options)
}

export const useBudgetProjects = () => useBudget<{ projects: ProjectBudgetOverview[] }>("/api/agency/budget/projects")

export const useBudgetProject = (projectId: string) =>
  useBudget<{ project: { name: string; clientName: string | null } }>(projectId ? projectBase(projectId) : null)

export const useChart = (projectId: string, includeArchived: boolean) =>
  useBudget<{ categories: ProjectCategory[]; merges: CategoryMerge[] }>(
    projectId ? `${projectBase(projectId)}/chart${includeArchived ? "?include_archived=1" : ""}` : null
  )

export const useLines = (projectId: string, includeArchived: boolean) =>
  useBudget<{ lines: BudgetLine[] }>(projectId ? `${projectBase(projectId)}/lines${includeArchived ? "?include_archived=1" : ""}` : null)

export const useSummary = (projectId: string) =>
  useBudget<{ summary: EstimateVsActual }>(projectId ? `${projectBase(projectId)}/summary` : null)

export const useLedger = (projectId: string) =>
  useBudget<{ entries: LedgerEntry[] }>(projectId ? `${projectBase(projectId)}/ledger?include_voided=1` : null)

export const useDocuments = (projectId: string, includeArchived: boolean) =>
  useBudget<{ documents: SourceDocument[] }>(
    projectId ? `${projectBase(projectId)}/documents${includeArchived ? "?include_archived=1" : ""}` : null
  )

export const usePartnerships = (projectId: string) =>
  useBudget<{ partnerships: ProjectPartnership[] }>(projectId ? `${projectBase(projectId)}/partnerships` : null)

export const useTemplate = (includeArchived: boolean) =>
  useBudget<{ categories: TemplateCategory[] }>(`/api/agency/budget/templates${includeArchived ? "?include_archived=1" : ""}`)

/** The manual-reference prefix: a document row recorded for a manual ledger entry, with no file. */
export const manualBlobPrefix = (projectId: string) => `budget/${projectId}/manual/`

export const isManualDocument = (doc: Pick<SourceDocument, "project_id" | "blob_path">) =>
  doc.blob_path.startsWith(manualBlobPrefix(doc.project_id))

/** A date-only value ("2026-10-01") shown without a timezone shift. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "-"
  const [y, m, d] = value.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}
