"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePaidUser } from "@/contexts/paid-user-context"
import { Loader2, Upload, ExternalLink, Trash2 } from "lucide-react"

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
}

const AGENCY_SLOTS = [
  { kind: "nda", title: "NDA" },
  { kind: "msa", title: "MSA" },
  { kind: "sow", title: "SOW" },
] as const

const TEMPLATE_SLOTS = [
  { kind: "client_brief", title: "Client Brief" },
  { kind: "master_brief", title: "Master Brief" },
  { kind: "partner_brief", title: "Partner Brief" },
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
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const bySectionKind = useMemo(() => {
    const m = new Map<string, LibraryRow[]>()
    for (const r of rows) {
      const k = `${r.section}:${r.kind}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    }
    return m
  }, [rows])

  const latest = (section: string, kind: string) => bySectionKind.get(`${section}:${kind}`)?.[0]

  const setForm = (key: string, patch: Partial<{ label: string; url: string }>) => {
    setForms((prev) => ({
      ...prev,
      [key]: { label: "", url: "", ...prev[key], ...patch },
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

      <GlassCard className="p-6">
        <GlassCardHeader
          title="Agency documents"
          description="NDA, MSA, and SOW — upload, replace, or link. Used when building onboarding packages."
        />
        <div className="grid md:grid-cols-3 gap-4 mt-4">
          {AGENCY_SLOTS.map((s) => renderSlot("agency", s))}
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <GlassCardHeader
          title="Key templates"
          description="Client Brief, Master Brief, Partner Brief, Budget, Timeline, and Other. Store files or external links."
        />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {TEMPLATE_SLOTS.map((s) => renderSlot("templates", s))}
        </div>
      </GlassCard>
    </div>
  )
}
