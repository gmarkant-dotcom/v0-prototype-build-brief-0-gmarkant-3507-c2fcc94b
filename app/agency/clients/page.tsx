"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { GlassCard } from "@/components/glass-card"
import { NewClientDialog } from "@/components/new-client-dialog"
import { HelpTerm } from "@/components/help-term"
import { Plus, ChevronRight, Loader2 } from "lucide-react"
import { normalizeClientProfile, hasClientDefaults, type ClientProfile } from "@/lib/clients"

export default function ClientProfilesPage() {
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/agency/clients", { credentials: "same-origin", cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      setAvailable(data?.available !== false)
      setClients(((data?.clients || []) as unknown[]).map(normalizeClientProfile).filter((c): c is ClientProfile => c != null))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <AgencyLayout>
      <div className="p-8 max-w-5xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl text-foreground">Client Profiles</h1>
            <p className="text-sm text-foreground-muted mt-1 max-w-2xl">
              Set an end client up once. Their documents and standing requirements then apply to
              every RFP you name them on, instead of being re-entered each time.
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
        ) : clients.length === 0 ? (
          <GlassCard>
            <p className="text-sm text-foreground-muted">
              No client profiles yet. Create one for a client you work with repeatedly, and it
              will be selectable the next time you start a project or broadcast an RFP.
            </p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/agency/clients/${client.id}`}
                className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border bg-white/5 transition-colors [@media(hover:hover)]:hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <div className="min-w-0">
                  <div className="font-display font-bold text-foreground truncate">{client.name}</div>
                  <div className="font-mono text-2xs text-foreground-muted mt-0.5">
                    {hasClientDefaults(client) ? "Defaults set" : "No defaults yet"}
                    {client.notes ? " · Has notes" : ""}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />
              </Link>
            ))}
          </div>
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
