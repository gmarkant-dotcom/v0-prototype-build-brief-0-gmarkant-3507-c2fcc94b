"use client"

import { useEffect, useState } from "react"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { formatDateTime, cn } from "@/lib/utils"
import { Loader2, Send } from "lucide-react"
import {
  buildCardInviteRequest,
  describeInviteOutcome,
  hasExistingInvitation,
  type InviteCheck,
  type InviteMode,
  type InviteOutcome,
} from "@/lib/agency-invite-request"

type MagicTokenRow = {
  id: string
  vendor_email: string
  vendor_name: string | null
  status: string
  created_at: string
  expires_at: string
  is_existing_partner: boolean
}

function statusPill(status: string) {
  if (status === "submitted") return { label: "Submitted", className: "bg-success/15 text-success" }
  if (status === "expired") return { label: "Expired", className: "bg-red-500/15 text-red-300" }
  return { label: "Pending", className: "bg-amber-500/15 text-amber-300" }
}

export function AgencyRfpMagicLinkInvite({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [requireTermsDisclosure, setRequireTermsDisclosure] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<
    { is_existing_partner: boolean; has_pending_invite: boolean; has_expired_invite: boolean } | null
  >(null)
  const [sending, setSending] = useState(false)
  const [sendMessage, setSendMessage] = useState<InviteOutcome | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [invites, setInvites] = useState<MagicTokenRow[]>([])
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [rowOutcome, setRowOutcome] = useState<({ id: string } & InviteOutcome) | null>(null)

  const loadInvites = async () => {
    setInvitesLoading(true)
    try {
      const res = await fetch(`/api/agency/rfp/magic-link?project_id=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setInvites(data.invites || [])
    } finally {
      setInvitesLoading(false)
    }
  }

  useEffect(() => {
    if (!projectId) return
    void loadInvites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setCheckResult(null)
      return
    }
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/agency/rfp/magic-link?check_email=${encodeURIComponent(trimmed)}&project_id=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        )
        const data = await res.json().catch(() => ({}))
        if (res.ok) setCheckResult(data)
      } finally {
        setChecking(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [email, projectId])

  const postInvite = async (mode: InviteMode, body: Record<string, unknown>): Promise<InviteOutcome> => {
    try {
      const res = await fetch("/api/agency/rfp/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      return describeInviteOutcome({ mode, status: res.status, data })
    } catch {
      return describeInviteOutcome({ mode, status: 0, data: null })
    }
  }

  const sendInvite = async () => {
    setSending(true)
    setSendError(null)
    setSendMessage(null)
    try {
      // G1: checked again at click time, not taken from the debounced hint, so an address typed and
      // sent within the debounce window is never sent as a first send over an existing invitation.
      // This form carries no RFP content, so a first send there would blank the stored invitation.
      // If the check fails nothing is sent.
      const trimmed = email.trim().toLowerCase()
      let check: InviteCheck | null = null
      try {
        const res = await fetch(
          `/api/agency/rfp/magic-link?check_email=${encodeURIComponent(trimmed)}&project_id=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        )
        if (!res.ok) throw new Error("check failed")
        check = (await res.json()) as InviteCheck
      } catch {
        setSendError("Could not check for an existing invitation, so nothing was sent. Please try again.")
        return
      }
      const request = buildCardInviteRequest({ email, name, projectId, requireTermsDisclosure, check })
      const outcome = await postInvite(request.mode, request.body)
      if (outcome.tone === "error") {
        setSendError(outcome.message)
        return
      }
      setSendMessage(outcome)
      setEmail("")
      setName("")
      setCheckResult(null)
      void loadInvites()
    } finally {
      setSending(false)
    }
  }

  const resendInvite = async (row: MagicTokenRow) => {
    setResendingId(row.id)
    setRowOutcome(null)
    try {
      // F7: renews the link only. Without `resend: true` the route treats the call as a first send
      // and overwrites the invitation's criteria, categories and materials with this empty body.
      const outcome = await postInvite("resend", {
        vendor_email: row.vendor_email,
        vendor_name: row.vendor_name || undefined,
        project_id: projectId,
        resend: true,
      })
      // G3: every result is shown on the row, including 404 "no invitation to resend".
      setRowOutcome({ id: row.id, ...outcome })
      // Not reloaded on an error: the row, and its message, stay where the agency clicked.
      if (outcome.tone !== "error") void loadInvites()
    } finally {
      setResendingId(null)
    }
  }

  const existingInvite = hasExistingInvitation(checkResult)

  return (
    <GlassCard>
      <GlassCardHeader
        label="Guest Invitation"
        title="Invite by email"
        description="Send a no-signup invitation link so a vendor can submit a bid directly, without creating a Ligament account."
      />
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Input
            type="email"
            placeholder="vendor@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
          />
          {(checking || checkResult) && (
            <p className="font-mono text-2xs text-foreground-muted mt-1.5">
              {checking
                ? "Checking…"
                : checkResult?.has_pending_invite
                  ? "An active invitation already exists. Resending delivers the same link with a refreshed expiry and keeps the RFP content it was sent with."
                  : checkResult?.has_expired_invite
                    ? "The previous link expired. Resending sends a new link and keeps the RFP content it was sent with."
                    : checkResult?.is_existing_partner
                      ? "Already in your vendor pool"
                      : "New vendor - will receive a guest invitation"}
            </p>
          )}
        </div>
        <Input
          placeholder="Vendor name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
        />
      </div>
      <label className={cn("mt-3 flex items-center gap-2", existingInvite ? "opacity-60" : "cursor-pointer")}>
        <Checkbox
          checked={requireTermsDisclosure}
          disabled={existingInvite}
          onCheckedChange={(v) => setRequireTermsDisclosure(v === true)}
          className="border-border"
        />
        <span className="font-mono text-xs text-foreground">Require term disclosures with bids</span>
      </label>
      <p className="font-mono text-2xs text-foreground-muted mt-1">
        {existingInvite
          ? "A resend keeps the existing invitation's term disclosure setting."
          : "Vendors state payment, cancellation, IP, and rate-validity terms up front."}
      </p>
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <Button
          type="button"
          onClick={() => void sendInvite()}
          disabled={sending || !email.trim()}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          {sending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Sending…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Send className="w-4 h-4" /> {existingInvite ? "Resend Invitation" : "Send Invitation"}
            </span>
          )}
        </Button>
        {sendMessage && (
          <span
            role="status"
            className={cn("font-mono text-xs", sendMessage.tone === "warning" ? "text-amber-300" : "text-accent")}
          >
            {sendMessage.message}
          </span>
        )}
        {sendError && (
          <span role="alert" className="font-mono text-xs text-red-400">
            {sendError}
          </span>
        )}
      </div>

      <div className="mt-6 pt-6 border-t border-border/30">
        <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider mb-3">
          Pending Invitations
        </div>
        {invitesLoading ? (
          <p className="text-sm text-foreground-muted">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-foreground-muted">No guest invitations sent yet for this project.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((row) => {
              const pill = statusPill(row.status)
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-border/40 bg-white/5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-bold text-sm text-foreground truncate">
                        {row.vendor_name || row.vendor_email}
                      </span>
                      {row.is_existing_partner && (
                        <span className="font-mono text-2xs px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                          In partner pool
                        </span>
                      )}
                    </div>
                    {row.vendor_name && (
                      <div className="font-mono text-2xs text-foreground-muted truncate">{row.vendor_email}</div>
                    )}
                    <div className="font-mono text-2xs text-foreground-muted">
                      Sent {formatDateTime(row.created_at)} · Expires {formatDateTime(row.expires_at)}
                    </div>
                  </div>
                  <span className={cn("font-mono text-2xs px-2 py-0.5 rounded-full uppercase shrink-0", pill.className)}>
                    {pill.label}
                  </span>
                  {row.status === "pending" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-border/60 shrink-0"
                      disabled={resendingId === row.id}
                      onClick={() => void resendInvite(row)}
                    >
                      {resendingId === row.id ? "Resending…" : "Resend"}
                    </Button>
                  )}
                  {row.status === "submitted" && (
                    <a
                      href="/agency/bids"
                      className="font-mono text-2xs text-accent border border-accent/30 hover:bg-accent/10 rounded-md px-2 py-1 transition-colors shrink-0"
                    >
                      View Bid
                    </a>
                  )}
                  {rowOutcome?.id === row.id && (
                    <p
                      role={rowOutcome.tone === "error" ? "alert" : "status"}
                      className={cn(
                        "basis-full font-mono text-2xs",
                        rowOutcome.tone === "error"
                          ? "text-red-400"
                          : rowOutcome.tone === "warning"
                            ? "text-amber-300"
                            : "text-accent"
                      )}
                    >
                      {rowOutcome.message}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </GlassCard>
  )
}
