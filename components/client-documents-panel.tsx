"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Upload, ExternalLink, Trash2, FileText } from "lucide-react"
import { MOMENTARY_ACTION_DARK } from "@/lib/interactive-styles"
import { cn } from "@/lib/utils"

export type ClientDocument = {
  id: string
  kind: string
  label: string
  source_type: string
  external_url: string | null
  blob_url: string | null
  file_name: string | null
  updated_at: string
}

/** The URL a flow actually attaches. One helper so the panel, the selector's attach step, and
 *  any future reader all resolve it the same way. */
export function clientDocumentUrl(doc: ClientDocument): string | null {
  return doc.source_type === "url" ? doc.external_url : doc.blob_url
}

/**
 * A client profile's documents (A1). Deliberately thin: it drives the EXISTING
 * agency_library_documents API rather than a new one, because that table is already
 * agency-scoped, already handles both a Vercel Blob file and an external URL, and already has
 * upload, list and delete routes. Client documents are the same rows with client_id set.
 *
 * Unlike Master Documents this has no fixed slot list. A client's documents are an open set - a
 * brand book, a legal addendum, a rate card - so they are stored under kind 'other' and
 * identified by their label.
 */
export function ClientDocumentsPanel({ clientId }: { clientId: string }) {
  const [docs, setDocs] = useState<ClientDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkLabel, setLinkLabel] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const fileRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agency/library-documents?client_id=${encodeURIComponent(clientId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      // A failure here is nearly always "migration 077 is not applied yet", which is an honest
      // empty list rather than an error the agency can act on.
      setDocs(res.ok ? ((data.documents || []) as ClientDocument[]) : [])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addLink = async () => {
    const url = linkUrl.trim()
    if (!url || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/agency/library-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          section: "client",
          kind: "other",
          client_id: clientId,
          label: linkLabel.trim() || url,
          source_type: "url",
          external_url: url,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data?.error as string) || "Could not save that link.")
        return
      }
      setLinkLabel("")
      setLinkUrl("")
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const uploadFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("folder", "agency-library")
      const upload = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" })
      const uploaded = await upload.json().catch(() => ({}))
      if (!upload.ok || !uploaded?.url) {
        setError((uploaded?.error as string) || "Upload failed.")
        return
      }
      const res = await fetch("/api/agency/library-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          section: "client",
          kind: "other",
          client_id: clientId,
          label: file.name,
          source_type: "file",
          blob_url: uploaded.url,
          blob_path: uploaded.pathname ?? null,
          file_name: file.name,
          file_type: file.type || null,
          file_size: file.size ?? null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data?.error as string) || "Could not save that document.")
        return
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (docId: string) => {
    setBusy(true)
    try {
      await fetch(`/api/agency/library-documents/${docId}`, { method: "DELETE", credentials: "same-origin" })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center gap-2 text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="font-mono text-2xs">Loading documents...</span>
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No documents on this client yet. Anything you add here can be attached to an RFP for
          this client without uploading it again.
        </p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => {
            const url = clientDocumentUrl(doc)
            return (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-white/5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {doc.source_type === "url" ? (
                    <ExternalLink className="w-4 h-4 text-foreground-muted shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-foreground-muted shrink-0" />
                  )}
                  <span className="text-sm text-foreground truncate">{doc.label}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className={cn("p-1.5 rounded-md text-foreground-muted", MOMENTARY_ACTION_DARK)}
                      aria-label={`Open ${doc.label}`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(doc.id)}
                    disabled={busy}
                    aria-label={`Remove ${doc.label}`}
                    className="p-1.5 rounded-md text-destructive transition-colors [@media(hover:hover)]:hover:bg-destructive/10 active:bg-destructive/20 outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted block mb-1">
            Label
          </label>
          <Input
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="Brand guidelines"
            className="bg-background border-border text-foreground"
          />
        </div>
        <div className="flex-[2] min-w-[200px]">
          <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted block mb-1">
            Link
          </label>
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            className="bg-background border-border text-foreground"
          />
        </div>
        <Button type="button" onClick={() => void addLink()} disabled={busy || !linkUrl.trim()}>
          Add link
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-border text-foreground"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-4 h-4 mr-1" />
          Upload
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void uploadFile(file)
            e.target.value = ""
          }}
        />
      </div>

      {error && <p className="font-mono text-2xs text-destructive">{error}</p>}
    </div>
  )
}
