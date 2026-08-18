"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"

export type CreatedClient = { id: string; name: string }

/**
 * The single "create a client profile" flow (A1), shared by the nav affordance and by the
 * inline create inside every client selector (A2) - same contract as
 * components/new-project-dialog.tsx, which is the pattern this deliberately mirrors.
 *
 * Two things it deliberately does NOT copy from NewProjectDialog: the usage-limit wiring
 * (guardAction / handleUsageLimitError) and the paid-feature gate. Client profiles are not a
 * metered resource - checkUsageLimit knows only `projects` and `ai_analyses` - so guarding here
 * would invent a limit that does not exist.
 *
 * Duplicate names WARN and link, they never block. Two genuinely different clients can share a
 * name, and an agency mid-rename should not be stopped by a uniqueness rule; migration 077's
 * index on (org_id, lower(name)) is deliberately not UNIQUE for the same reason.
 */
export function NewClientDialog({
  trigger,
  onCreated,
  navigateOnCreate = true,
}: {
  trigger: ReactNode
  /** Lets a selector adopt the new profile immediately instead of navigating away. */
  onCreated?: (client: CreatedClient) => void
  navigateOnCreate?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<CreatedClient | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName("")
    setNotes("")
    setError(null)
    setDuplicate(null)
  }

  const submit = async (force: boolean) => {
    if (submitting) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Give this client a name.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/agency/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: trimmed, notes: notes.trim() || null, force }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data?.duplicate) {
        setDuplicate(data.duplicate as CreatedClient)
        return
      }
      if (!res.ok) {
        setError((data?.error as string) || "Could not create this client profile.")
        return
      }
      const created = data.client as CreatedClient
      setOpen(false)
      reset()
      onCreated?.(created)
      if (navigateOnCreate) router.push(`/agency/clients/${created.id}`)
    } catch {
      setError("Could not create this client profile.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-card border border-border rounded-xl">
        <DialogHeader>
          <DialogTitle>New client profile</DialogTitle>
          <DialogDescription>
            Set a client up once and reuse it on every RFP. You can add documents and standing
            requirements after this.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="client-name">Client name</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setDuplicate(null)
              }}
              placeholder="Samsung"
              className="mt-1.5 bg-background border-border text-foreground"
            />
          </div>
          <div>
            <Label htmlFor="client-notes">Internal notes (optional)</Label>
            <Textarea
              id="client-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How this client works, who to talk to, anything worth remembering"
              className="mt-1.5 bg-background border-border text-foreground"
            />
            <p className="font-mono text-2xs text-foreground-muted mt-1.5">
              Internal to your agency. Vendors never see notes - only documents and criteria you
              put into an RFP reach them.
            </p>
          </div>

          {duplicate && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2">
              <p className="text-sm text-foreground">
                You already have a client profile called{" "}
                <span className="font-medium">{duplicate.name}</span>.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/agency/clients/${duplicate.id}`}
                  onClick={() => setOpen(false)}
                  className="font-mono text-2xs text-accent underline underline-offset-4"
                >
                  Open that profile instead
                </Link>
                <button
                  type="button"
                  onClick={() => void submit(true)}
                  disabled={submitting}
                  className="font-mono text-2xs text-foreground-muted underline underline-offset-4 hover:text-foreground"
                >
                  Create a second one anyway
                </button>
              </div>
            </div>
          )}

          {error && <p className="font-mono text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" className="border-border text-foreground hover:bg-white/5">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void submit(false)} disabled={submitting || !name.trim()}>
            {submitting ? "Creating..." : "Create client profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
