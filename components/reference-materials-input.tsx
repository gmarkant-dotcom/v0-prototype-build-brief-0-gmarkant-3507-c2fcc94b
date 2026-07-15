"use client"

import { useState } from "react"
import type { ChangeEvent, KeyboardEvent } from "react"
import { Link as LinkIcon, FileText, Plus, X, ChevronUp, ChevronDown, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export type ReferenceMaterial = {
  type: "link" | "file"
  label: string
  url: string
  created_at: string
}

type InternalItem = ReferenceMaterial & { id: string; uploading?: boolean }

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024

function toPublicMaterial({ id, uploading, ...rest }: InternalItem): ReferenceMaterial {
  void id
  void uploading
  return rest
}

function labelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

interface ReferenceMaterialsInputProps {
  projectId: string | null
  agencyId: string
  onChange: (materials: ReferenceMaterial[]) => void
}

export function ReferenceMaterialsInput({ projectId, agencyId, onChange }: ReferenceMaterialsInputProps) {
  const [items, setItems] = useState<InternalItem[]>([])
  const [linkUrl, setLinkUrl] = useState("")
  const [linkLabel, setLinkLabel] = useState("")
  const [uploadError, setUploadError] = useState<string | null>(null)

  const commit = (updater: (prev: InternalItem[]) => InternalItem[]) => {
    setItems((prev) => {
      const next = updater(prev)
      onChange(next.filter((item) => !item.uploading).map(toPublicMaterial))
      return next
    })
  }

  const addLink = () => {
    const url = linkUrl.trim()
    if (!url) return
    commit((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type: "link",
        label: linkLabel.trim() || labelFromUrl(url),
        url,
        created_at: new Date().toISOString(),
      },
    ])
    setLinkUrl("")
    setLinkLabel("")
  }

  const handleLinkKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addLink()
    }
  }

  const removeItem = (id: string) => {
    commit((prev) => prev.filter((item) => item.id !== id))
  }

  const moveItem = (id: string, direction: -1 | 1) => {
    commit((prev) => {
      const index = prev.findIndex((item) => item.id === id)
      const targetIndex = index + direction
      if (index === -1 || targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setUploadError(null)

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadError("File is too large. Maximum size is 20MB.")
      return
    }

    const id = crypto.randomUUID()
    commit((prev) => [
      ...prev,
      { id, type: "file", label: file.name, url: "", created_at: new Date().toISOString(), uploading: true },
    ])

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", `reference-materials/${agencyId}${projectId ? `/${projectId}` : ""}`)
      const res = await fetch("/api/upload", { method: "POST", body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Upload failed")
      commit((prev) => prev.map((item) => (item.id === id ? { ...item, url: data.url, uploading: false } : item)))
    } catch (err) {
      commit((prev) => prev.filter((item) => item.id !== id))
      setUploadError(err instanceof Error ? err.message : "Upload failed")
    }
  }

  return (
    <div className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-4">
      <div>
        <div className="font-display font-bold text-sm text-foreground">Reference Materials</div>
        <p className="font-mono text-[10px] text-foreground-muted mt-0.5">
          Add files or links to share context with vendors.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex gap-2">
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={handleLinkKeyDown}
            placeholder="https://..."
            className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
          />
          <Input
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            onKeyDown={handleLinkKeyDown}
            placeholder="Label (optional)"
            className="w-40 shrink-0 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!linkUrl.trim()}
            onClick={addLink}
            className="border-border text-foreground-muted hover:bg-white/5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add
          </Button>
        </div>

        <label className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border/60 font-mono text-xs text-foreground-muted hover:text-foreground hover:border-accent/50 cursor-pointer transition-colors shrink-0">
          <Upload className="w-3.5 h-3.5" />
          Upload File
          <input
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,image/jpeg,image/png"
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>
      </div>

      {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, index) => {
            const Icon = item.type === "link" ? LinkIcon : FileText
            return (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-white/5">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  {item.uploading ? (
                    <Spinner className="size-3.5 text-accent" />
                  ) : (
                    <Icon className="w-4 h-4 text-accent" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-sm text-foreground truncate">{item.label}</div>
                  <div className="font-mono text-[10px] text-foreground-muted truncate">
                    {item.uploading ? "Uploading…" : item.url}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveItem(item.id, -1)}
                    className={cn(
                      "p-1 rounded text-foreground-muted hover:text-foreground",
                      "disabled:opacity-30 disabled:pointer-events-none"
                    )}
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === items.length - 1}
                    onClick={() => moveItem(item.id, 1)}
                    className={cn(
                      "p-1 rounded text-foreground-muted hover:text-foreground",
                      "disabled:opacity-30 disabled:pointer-events-none"
                    )}
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1 rounded text-foreground-muted hover:text-red-400"
                    aria-label="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
