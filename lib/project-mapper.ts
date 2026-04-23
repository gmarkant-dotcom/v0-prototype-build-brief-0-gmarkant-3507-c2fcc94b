import type { MasterProject } from "@/lib/demo-data"

/** Map DB project row (title or legacy name) to UI MasterProject */
export function mapDbProjectToMaster(p: {
  id: string
  title?: string | null
  name?: string | null
  client_name?: string | null
  status?: string | null
  budget_range?: string | null
  start_date?: string | null
  end_date?: string | null
  created_at?: string | null
}): MasterProject {
  const raw = (p.status || "draft").toLowerCase()
  let status: MasterProject["status"] = "onboarding"
  if (raw === "open" || raw === "in_progress" || raw === "active" || raw === "bidding") {
    status = "active"
  } else if (raw === "completed") {
    status = "completed"
  } else if (raw === "cancelled" || raw === "on_hold") {
    status = "on_hold"
  } else {
    status = "onboarding"
  }

  return {
    id: p.id,
    name: (p.title || p.name || "Untitled project").trim(),
    client: (p.client_name || "").trim() || "Client TBD",
    status,
    createdAt: p.created_at || null,
  }
}
