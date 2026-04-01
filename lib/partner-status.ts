export const PARTNER_WORKFLOW_STATUSES = [
  "on_track",
  "at_risk",
  "delayed",
  "blocked",
  "complete",
] as const
export type PartnerWorkflowStatus = (typeof PARTNER_WORKFLOW_STATUSES)[number]

export const PARTNER_BUDGET_STATUSES = [
  "on_budget",
  "over_budget",
  "incremental_needed",
  "scope_creep",
] as const
export type PartnerBudgetStatus = (typeof PARTNER_BUDGET_STATUSES)[number]

export const ALERT_TRIGGER_STATUSES: PartnerWorkflowStatus[] = ["at_risk", "delayed", "blocked"]

export function isAlertStatus(status: string): boolean {
  return ALERT_TRIGGER_STATUSES.includes(status as PartnerWorkflowStatus)
}

export function workflowStatusLabel(s: string): string {
  const map: Record<string, string> = {
    on_track: "On Track",
    at_risk: "At Risk",
    delayed: "Delayed",
    blocked: "Blocked",
    complete: "Complete",
  }
  return map[s] || s
}

export function budgetStatusLabel(s: string): string {
  const map: Record<string, string> = {
    on_budget: "On Budget",
    over_budget: "Over Budget",
    incremental_needed: "Incremental Budget Needed",
    scope_creep: "Scope Creep Identified",
  }
  return map[s] || s
}
