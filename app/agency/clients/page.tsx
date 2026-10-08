"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { GlassCard } from "@/components/glass-card"
import { NewClientDialog } from "@/components/new-client-dialog"
import { HelpTerm } from "@/components/help-term"
import { Plus, ChevronRight, Loader2 } from "lucide-react"
import { normalizeClientProfile, hasClientDefaults, type ClientProfile } from "@/lib/clients"
import { cn } from "@/lib/utils"

type RepositoryProject = {
  id: string
  name: string
  /** Null when the project has no client profile. A typed client_name is NOT a profile. */
  client_id: string | null
  client_name: string | null
  /** From lib/project-liveness via the route. The page defines no liveness of its own. */
  active: boolean
}

export default function ClientProfilesPage() {
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<RepositoryProject[]>([])
  // False means the projects read failed. That must not render as "no projects".
  const [projectsOk, setProjectsOk] = useState(true)
  const [truncated, setTruncated] = useState(false)
  const [activeOnly, setActiveOnly] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [clientsRes, projectsRes] = await Promise.all([
        fetch("/api/agency/clients", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/agency/client-projects", { credentials: "same-origin", cache: "no-store" }),
      ])
      const data = await clientsRes.json().catch(() => ({}))
      setAvailable(data?.available !== false)
      setClients(((data?.clients || []) as unknown[]).map(normalizeClientProfile).filter((c): c is ClientProfile => c != null))

      const pdata = await projectsRes.json().catch(() => ({}))
      if (projectsRes.ok && Array.isArray(pdata?.projects)) {
        setProjects(pdata.projects as RepositoryProject[])
        setTruncated(pdata.truncated === true)
        setProjectsOk(true)
      } else {
        setProjects([])
        setTruncated(false)
        setProjectsOk(false)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // A project is filed under exactly one client: the first match wins and the id is then spent,
  // so a duplicated row in the response can never render twice.
  const { byClient, unlinked } = useMemo(() => {
    const seen = new Set<string>()
    const grouped = new Map<string, RepositoryProject[]>()
    const none: RepositoryProject[] = []
    for (const p of projects) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      if (p.client_id) {
        const list = grouped.get(p.client_id) ?? []
        list.push(p)
        grouped.set(p.client_id, list)
      } else {
        none.push(p)
      }
    }
    return { byClient: grouped, unlinked: none }
  }, [projects])

  const showProject = (p: RepositoryProject) => !activeOnly || p.active

  return (
    <AgencyLayout>
      <div className="p-8 max-w-5xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl text-foreground">Clients + Projects</h1>
            <p className="text-sm text-foreground-muted mt-1 max-w-2xl">
              Your projects, organized by client. Set an end client up once and their documents
              and standing requirements apply to every RFP you name them on, instead of being
              re-entered each time.
            </p>
          </div>
          <NewClientDialog
            trigger={
              <button
                type="button"
                className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-accent-foreground font-mono text-sm transition-colors [@media(hover:hover)]:hover:bg-accent/90 active:bg-accent/80 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Plus className="w-4 h-4" />
                New client profile
              </button>
            }
            onCreated={() => void load()}
            navigateOnCreate
          />
        </div>

        {/* Never render a loading or empty state during hydration - wait for the fetch. */}
        {loading ? (
          <div className="flex items-center gap-3 text-foreground-muted py-12">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="font-mono text-sm">Loading client profiles...</span>
          </div>
        ) : !available ? (
          <GlassCard>
            <p className="text-sm text-foreground-muted">
              Client profiles are not set up on this database yet. Apply migration 077 and this
              page will start working. Nothing else is affected in the meantime - every RFP still
              takes a typed client name exactly as it does today.
            </p>
          </GlassCard>
        ) : (
          <>
            {!projectsOk && (
              <GlassCard>
                <p className="text-sm text-foreground-muted">
                  Projects could not be loaded just now, so the lists below are not shown. Your
                  client profiles are unaffected. Refresh to try again.
                </p>
              </GlassCard>
            )}

            {projectsOk && truncated && (
              <GlassCard>
                <p className="text-sm text-foreground-muted">
                  You have more projects than this page can list at once, so some are not shown
                  here.
                </p>
              </GlassCard>
            )}

            {projectsOk && (
              <div className="flex items-center gap-2" role="group" aria-label="Project filter">
                {[
                  { label: "Active projects", value: true },
                  { label: "All projects", value: false },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setActiveOnly(opt.value)}
                    aria-pressed={activeOnly === opt.value}
                    className={cn(
                      "px-3 py-1.5 rounded-lg border font-mono text-2xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      activeOnly === opt.value
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border text-foreground-muted [@media(hover:hover)]:hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {clients.length === 0 ? (
              <GlassCard>
                <p className="text-sm text-foreground-muted">
                  No client profiles yet. Create one for a client you work with repeatedly, and it
                  will be selectable the next time you start a project or broadcast an RFP.
                  Projects you create are listed below until they are linked to a client.
                </p>
              </GlassCard>
            ) : (
              <div className="space-y-4">
                {clients.map((client) => {
                  const own = byClient.get(client.id) ?? []
                  const visible = own.filter(showProject)
                  return (
                    <div key={client.id} className="rounded-lg border border-border bg-white/5">
                      <Link
                        href={`/agency/clients/${client.id}`}
                        className="flex items-center justify-between gap-4 p-4 rounded-t-lg transition-colors [@media(hover:hover)]:hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <div className="min-w-0">
                          <div className="font-display font-bold text-foreground truncate">{client.name}</div>
                          <div className="font-mono text-2xs text-foreground-muted mt-0.5">
                            {hasClientDefaults(client) ? "Defaults set" : "No defaults yet"}
                            {client.notes ? " · Has notes" : ""}
                            {projectsOk
                              ? ` · ${own.length} ${own.length === 1 ? "project" : "projects"}`
                              : ""}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />
                      </Link>
                      {projectsOk && (
                        <div className="border-t border-border px-4 py-3">
                          {visible.length === 0 ? (
                            <p className="text-sm text-foreground-muted">
                              {own.length === 0
                                ? "No projects for this client yet. Name this client when you start a project and it will be filed here."
                                : "No active projects for this client. Choose All projects to see the rest."}
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {visible.map((p) => (
                                <ProjectRow key={p.id} project={p} />
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {projectsOk && unlinked.length > 0 && (
              <div className="rounded-lg border border-border bg-white/5">
                <div className="p-4">
                  <div className="font-display font-bold text-foreground">No client profile</div>
                  <p className="font-mono text-2xs text-foreground-muted mt-0.5">
                    {unlinked.length} {unlinked.length === 1 ? "project is" : "projects are"} not linked to a client
                    profile, so they cannot be filed under a client. A typed client name is shown where
                    there is one.
                  </p>
                </div>
                <div className="border-t border-border px-4 py-3">
                  {unlinked.filter(showProject).length === 0 ? (
                    <p className="text-sm text-foreground-muted">
                      None of these are active. Choose All projects to see them.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {unlinked.filter(showProject).map((p) => (
                        <ProjectRow key={p.id} project={p} showTypedClient />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-foreground-muted">
          A <HelpTerm term="client_profile">client profile</HelpTerm> is internal to your agency.
          Notes never leave it. Only the documents and criteria you place into an RFP reach
          vendors.
        </p>
      </div>
    </AgencyLayout>
  )
}

function ProjectRow({ project, showTypedClient = false }: { project: RepositoryProject; showTypedClient?: boolean }) {
  return (
    <li>
      <Link
        href={`/agency/projects/${project.id}`}
        className="flex items-center justify-between gap-4 px-2 py-2 rounded-md transition-colors [@media(hover:hover)]:hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="min-w-0">
          <div className="text-sm text-foreground truncate">{project.name}</div>
          {showTypedClient && project.client_name && (
            <div className="font-mono text-2xs text-foreground-muted truncate">Client: {project.client_name}</div>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 font-mono text-2xs",
            project.active ? "text-success" : "text-foreground-muted"
          )}
        >
          {project.active ? "Active" : "Ended"}
        </span>
      </Link>
    </li>
  )
}
