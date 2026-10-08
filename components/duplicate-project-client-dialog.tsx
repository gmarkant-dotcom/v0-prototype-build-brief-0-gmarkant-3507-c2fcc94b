"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ClientSelector, type ClientSelection } from "@/components/client-selector"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"

/**
 * A PROJECT REQUIRES A CLIENT PROFILE (ruling 2026-10-08), and a duplicate is a new project.
 * Every project that predates the ruling is unfiled, so duplicating one has no client to copy.
 * The server answers that case with code "client_required"; this is where the producer supplies
 * one, picking a profile or creating it inline, without losing the duplicate they asked for.
 *
 * It never assigns a client to the SOURCE project. Only the copy is filed.
 */
export function DuplicateProjectClientDialog({
  open,
  onOpenChange,
  submitting,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitting: boolean
  onConfirm: (clientId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-background border-border">
        <DialogHeader>
          <DialogTitle className="font-display font-black text-xl text-foreground">Choose a client for the copy</DialogTitle>
          <DialogDescription className="text-foreground-muted">
            Every project belongs to a client profile. This project has none to copy, so choose one for the new project.
            The original is left as it is.
          </DialogDescription>
        </DialogHeader>
        <ClientChoice submitting={submitting} onConfirm={onConfirm} />
      </DialogContent>
    </Dialog>
  )
}

/** Holds the selection. It lives inside DialogContent, which unmounts on close, so a reopened
 *  dialog always starts empty without an effect to reset it. */
function ClientChoice({ submitting, onConfirm }: { submitting: boolean; onConfirm: (clientId: string) => void }) {
  const [selection, setSelection] = useState<ClientSelection>({ clientId: null, clientName: "" })
  return (
    <>
      <div className="py-4">
        <ClientSelector id="duplicate-project-client" label="Client" requireProfile value={selection} onChange={setSelection} />
      </div>
      <DialogFooter className="flex gap-3">
        <DialogClose asChild>
          <Button variant="outline" className="border-border text-foreground hover:bg-white/5">
            Cancel
          </Button>
        </DialogClose>
        <Button
          className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
          disabled={!selection.clientId || submitting}
          onClick={() => selection.clientId && onConfirm(selection.clientId)}
        >
          {submitting ? "Duplicating..." : "Duplicate project"}
        </Button>
      </DialogFooter>
    </>
  )
}
