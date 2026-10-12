"use client"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/**
 * The budget screens' one dialog shape. Agency portal: `bg-card border border-border rounded-xl`
 * over the dialog's own black/80 overlay (CLAUDE.md, modal backgrounds).
 */
export function BudgetDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  confirmDisabled,
  destructive,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  confirmDisabled?: boolean
  destructive?: boolean
  busy?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border border-border rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display font-bold text-xl text-foreground">{title}</DialogTitle>
          {description ? <DialogDescription className="text-sm text-foreground-muted">{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" className="border-border" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className={destructive ? undefined : "bg-accent text-accent-foreground hover:bg-accent/90 font-mono"}
            onClick={onConfirm}
            disabled={confirmDisabled || busy}
          >
            {busy ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
