"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePaidUser } from "@/contexts/paid-user-context"
import { Loader2, Upload, ExternalLink, Trash2 } from "lucide-react"
import { isClientScopedDocument } from "@/lib/library-documents"
import { BidFormCollapsibleSection } from "@/components/bid-form-collapsible-section"
import { cn } from "@/lib/utils"

type LibraryRow = {
  id: string
  section: string
  kind: string
  label: string
  source_type: string
  external_url: string | null
  blob_url: string | null
  file_name: string | null
  updated_at: string
  /** ITEM 2. Null for an agency document, set for a client-scoped one. */
  client_id?: string | null
}

const AGENCY_SLOTS = [
  { kind: "nda", title: "NDA" },
  { kind: "msa", title: "MSA" },
  { kind: "sow", title: "SOW" },
] as const

const TEMPLATE_SLOTS = [
  { kind: "client_brief", title: "Client Brief" },
  { kind: "master_brief", title: "Master Brief" },
  { kind: "partner_brief", title: "Vendor Brief" },
  { kind: "budget", title: "Budget" },
  { kind: "timeline", title: "Timeline" },
  { kind: "other", title: "Other" },
] as const

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

export function AgencyDocumentLibraryManager() {
  const { checkFeatureAccess } = usePaidUser()
  const [rows, setRows] = useState<LibraryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingKind, setPendingKind] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, { label: string; url: string }>>({})
  /** id -> name, joined from the clients table by the API. Never a string stored on the row. */
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  // ITEM 3. Presentation only. No section changes what it queries. Default open, no
  // persistence, consistent with the wizard's use of the same shared wrapper.
  const [openSections, setOpenSections] = useState({ agency: true, templates: true, client: true })
  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  const [clientSort, setClientSort] = useState<"client" | "updated">("client")
  const [clientFilter, setClientFilter] = useState<string>("all")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/agency/library-documents", { credentials: "same-origin" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data?.error as string) || "Could not load library (run migration 024?)")
        setRows([])
        return
      }
      setRows((data.documents || []) as LibraryRow[])
      setClientNames((data.clientNamesById || {}) as Record<string, string>)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const agencyRows = useMemo(() => rows.filter((r) => !isClientScopedDocument(r)), [rows])
  const clientRows = useMemo(() => rows.filter((r) => isClientScopedDocument(r)), [rows])

  /** Clients actually present in the list, so the filter can never offer an option that
   *  returns nothing. Derived from the same rows the section renders - one source. */
  const clientFilterOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>()
    for (const row of clientRows) {
      const id = row.client_id as string
      const name = clientNames[id] || "Client"
      const entry = byId.get(id)
      if (entry) entry.count += 1
      else byId.set(id, { id, name, count: 1 })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [clientRows, clientNames])

  const visibleClientRows = useMemo(() => {
    const filtered =
      clientFilter === "all" ? clientRows : clientRows.filter((r) => r.client_id === clientFilter)
    return [...filtered].sort((a, b) => {
      if (clientSort === "updated") {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }
      const an = clientNames[a.client_id as string] || ""
      const bn = clientNames[b.client_id as string] || ""
      const byName = an.localeCompare(bn)
      return byName !== 0 ? byName : a.label.localeCompare(b.label)
    })
  }, [clientRows, clientFilter, clientSort, clientNames])

  // ITEM 2. The slot grid is built from AGENCY documents only. Client documents are written
  // under section 'agency' (the CHECK allows nothing else), so without this filter a client's
  // file could occupy the agency's own NDA or Other slot and silently change what the existing
  // slot lookup returns. Scope is decided by isClientScopedDocument, the one shared predicate.
  const bySectionKind = useMemo(() => {
    const m = new Map<string, LibraryRow[]>()
    for (const r of agencyRows) {
      const k = `${r.section}:${r.kind}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    }
    return m
  }, [agencyRows])

  const latest = (section: string, kind: string) => bySectionKind.get(`${section}:${kind}`)?.[0]

  // Collapsed-header counts, derived from the SAME latest() lookup the slots render, so a
  // header can never disagree with what is inside it.
  const agencyFilledSlotCount = AGENCY_SLOTS.filter((slot) => latest("agency", slot.kind)).length
  const templateFilledSlotCount = TEMPLATE_SLOTS.filter((slot) => latest("templates", slot.kind)).length

  const setForm = (key: string, patch: Partial<{ label: string; url: string }>) => {
    setForms((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }))
  }

  const uploadFile = async (section: "agency" | "templates", kind: string, file: File) => {
    if (!checkFeatureAccess("library upload")) return
    const key = `${section}-${kind}`
    setPendingKind(key)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("folder", "agency-library")
      const up = await fetch("/api/upload", { method: "POST", body: fd, credentials: "same-origin" })
      const upData = await up.json().catch(() => ({}))
      if (!up.ok) throw new Error(upData?.error || "Upload failed")

      const label = forms[key]?.label?.trim() || file.name
      const res = await fetch("/api/agency/library-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          section,
          kind,
          label,
          source_type: "file",
          blob_url: upData.url,
          blob_path: upData.pathname,
          file_name: upData.filename,
          file_type: upData.contentType,
          file_size: upData.size,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Save failed")
      setForm(key, { label: "", url: "" })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setPendingKind(null)
    }
  }

  const saveUrl = async (section: "agency" | "templates", kind: string) => {
    if (!checkFeatureAccess("library upload")) return
    const key = `${section}-${kind}`
    const label = forms[key]?.label?.trim()
    const url = forms[key]?.url?.trim()
    if (!label || !url) {
      setError("Enter label and URL")
      return
    }
    setPendingKind(key)
    setError(null)
    try {
      const res = await fetch("/api/agency/library-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          section,
          kind,
          label,
          source_type: "url",
          external_url: url,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Save failed")
      setForm(key, { label: "", url: "" })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setPendingKind(null)
    }
  }

  const remove = async (id: string) => {
    if (!checkFeatureAccess("library delete")) return
    const res = await fetch(`/api/agency/library-documents/${id}`, { method: "DELETE", credentials: "same-origin" })
    if (res.ok) await refresh()
  }

  const renderSlot = (section: "agency" | "templates", slot: { kind: string; title: string }) => {
    const row = latest(section, slot.kind)
    const key = `${section}-${slot.kind}`
    const busy = pendingKind === key

    return (
      <div
        key={key}
        className="rounded-lg border border-border/60 p-4 bg-white/5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-display font-bold text-foreground">{slot.title}</div>
          {row && (
            <Button type="button" variant="ghost" size="sm" className="text-red-200 hover:text-red-100" onClick={() => void remove(row.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
        {row ? (
          <div className="space-y-1 font-mono text-xs text-foreground-muted">
            <div className="text-foreground text-sm">{row.label}</div>
            <div>Updated {formatDate(row.updated_at)}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" className="border-border/60" asChild>
                <a href={`/api/agency/library-documents/file?id=${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">
                  Download / Open
                </a>
              </Button>
              {row.source_type === "url" && row.external_url && (
                <Button type="button" variant="outline" size="sm" className="border-border/60" asChild>
                  <a href={row.external_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    External
                  </a>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-foreground-muted">No document on file.</p>
        )}

        <div className="border-t border-border/40 pt-3 space-y-2">
          <Input
            placeholder="Label for new version"
            value={forms[key]?.label || ""}
            onChange={(e) => setForm(key, { label: e.target.value })}
            className="bg-white/5 border-border h-9 text-sm"
          />
          <div className="flex flex-wrap gap-2 items-center">
            <label className="inline-flex items-center gap-2 text-xs text-foreground/90 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>PDF / DOCX</span>
              <input
                type="file"
                accept=".pdf,.docx"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadFile(section, slot.kind, f)
                  e.target.value = ""
                }}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Or paste URL"
              value={forms[key]?.url || ""}
              onChange={(e) => setForm(key, { url: e.target.value })}
              className="bg-white/5 border-border h-9 text-sm flex-1"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void saveUrl(section, slot.kind)}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save URL"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-foreground-muted py-12">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
        Loading document library…
      </div>
    )
  }

  return (
    <div className="space-y-8 mb-10">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 font-mono">
          {error}
        </div>
      )}

      {/* ITEM 3. The same F1 shared wrapper the wizard uses, not a new one. Default open,
          collapsed headers carry a count, no persistence. The slot grids inside are NOT
          sorted or restructured: they are fixed named slots, not lists. */}
      <BidFormCollapsibleSection
        title="Agency documents"
        summary={`${agencyFilledSlotCount} of ${AGENCY_SLOTS.length} filled`}
        open={openSections.agency}
        onToggle={() => toggleSection("agency")}
        theme="dark"
      >
        <p className="text-sm text-foreground-muted">
          NDA, MSA, and SOW - upload, replace, or link. Used when building onboarding packages.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {AGENCY_SLOTS.map((s) => renderSlot("agency", s))}
        </div>
      </BidFormCollapsibleSection>

      <BidFormCollapsibleSection
        title="Key templates"
        summary={`${templateFilledSlotCount} of ${TEMPLATE_SLOTS.length} filled`}
        open={openSections.templates}
        onToggle={() => toggleSection("templates")}
        theme="dark"
      >
        <p className="text-sm text-foreground-muted">
          Client Brief, Master Brief, Vendor Brief, Budget, Timeline, and Other. Store files or
          external links.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TEMPLATE_SLOTS.map((s) => renderSlot("templates", s))}
        </div>
      </BidFormCollapsibleSection>

      {/* ITEM 2. One library shelf, honest about scope. Client-scoped documents cannot live in
          the slot grid above - that grid is a fixed set of named slots holding one latest row
          each, and a client's documents are an open set. They list here instead, every row
          carrying a chip naming its client. Agency documents carry NO chip: absence of a chip is
          the agency signal. Renders nothing at all when no client has documents. */}
      {clientRows.length > 0 && (
        <BidFormCollapsibleSection
          title="Client documents"
          summary={`${clientRows.length} across ${clientFilterOptions.length} client${clientFilterOptions.length === 1 ? "" : "s"}`}
          open={openSections.client}
          onToggle={() => toggleSection("client")}
          theme="dark"
        >
          <p className="text-sm text-foreground-muted">
            Documents attached to a client profile. They apply to RFPs for that client and appear
            on that client&apos;s engagements only.
          </p>

          {/* ITEM 3. Sorting and filtering apply to THIS section only. The slot grids above are
              fixed named slots, not lists, and are deliberately left alone. The filter is driven
              by the clients actually present, so it can never offer an option that returns
              nothing. No general search was built. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Sort</span>
            {([
              { key: "client" as const, label: "Client name" },
              { key: "updated" as const, label: "Updated" },
            ]).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setClientSort(option.key)}
                className={cn(
                  "font-mono text-2xs px-2 py-1 rounded border transition-colors",
                  clientSort === option.key
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-foreground/90"
                )}
              >
                {option.label}
              </button>
            ))}

            {clientFilterOptions.length > 1 && (
              <>
                <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted ml-2">
                  Client
                </span>
                <button
                  type="button"
                  onClick={() => setClientFilter("all")}
                  className={cn(
                    "font-mono text-2xs px-2 py-1 rounded border transition-colors",
                    clientFilter === "all"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-foreground/90"
                  )}
                >
                  All
                </button>
                {clientFilterOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setClientFilter(option.id)}
                    className={cn(
                      "font-mono text-2xs px-2 py-1 rounded border transition-colors",
                      clientFilter === option.id
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-foreground/90"
                    )}
                  >
                    {option.name} ({option.count})
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="space-y-2">
            {visibleClientRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-white/5 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-foreground truncate">{row.label}</span>
                    <span className="font-mono text-2xs uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent shrink-0">
                      {clientNames[row.client_id as string] || "Client"}
                    </span>
                  </div>
                  <div className="font-mono text-2xs text-foreground-muted mt-0.5">
                    Updated {formatDate(row.updated_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button type="button" variant="outline" size="sm" className="border-border/60" asChild>
                    <a
                      href={`/api/agency/library-documents/file?id=${encodeURIComponent(row.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download / Open
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void remove(row.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </BidFormCollapsibleSection>
      )}
    </div>
  )
}
