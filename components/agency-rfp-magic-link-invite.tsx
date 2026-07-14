"use client"

import { useEffect, useState } from "react"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDateTime, cn } from "@/lib/utils"
import { Loader2, Send } from "lucide-react"

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
  if (status === "submitted") return { label: "Submitted", className: "bg-emerald-500/15 text-emerald-300" }
  if (status === "expired") return { label: "Expired", className: "bg-red-500/15 text-red-300" }
  return { label: "Pending", className: "bg-amber-500/15 text-amber-300" }
}

export function AgencyRfpMagicLinkInvite({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ is_existing_partner: boolean; has_pending_invite: boolean } | null>(
    null
  )
  const [sending, setSending] = useState(false)
  const [sendMessage, setSendMessage] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [invites, setInvites] = useState<MagicTokenRow[]>([])
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [resendingId, setResendingId] = useState<string | null>(null)

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

  const sendInvite = async () => {
    setSending(true)
    setSendError(null)
    setSendMessage(null)
    try {
      const res = await fetch("/api/agency/rfp/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_email: email.trim(),
          vendor_name: name.trim() || undefined,
          project_id: projectId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to send invitation")
      setSendMessage("Invitation sent. Link expires in 72 hours.")
      setEmail("")
      setName("")
      setCheckResult(null)
      void loadInvites()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send invitation")
    } finally {
      setSending(false)
    }
  }

  const resendInvite = async (row: MagicTokenRow) => {
    setResendingId(row.id)
    try {
      const res = await fetch("/api/agency/rfp/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_email: row.vendor_email,
          vendor_name: row.vendor_name || undefined,
          project_id: projectId,
        }),
      })
      if (res.ok) void loadInvites()
    } finally {
      setResendingId(null)
    }
  }

  return (
    <GlassCard>
      <GlassCardHeader
        label="Guest Invitation"
        title="Invite by Email"
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
            <p className="font-mono text-[10px] text-foreground-muted mt-1.5">
              {checking
                ? "Checking…"
                : checkResult?.is_existing_partner
                  ? "Already in your partner pool"
                  : checkResult?.has_pending_invite
                    ? "Pending invitation already sent to this email"
                    : "New vendor — will receive a guest invitation"}
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
              <Send className="w-4 h-4" /> Send Invitation
            </span>
          )}
        </Button>
        {sendMessage && <span className="font-mono text-xs text-accent">{sendMessage}</span>}
        {sendError && <span className="font-mono text-xs text-red-400">{sendError}</span>}
      </div>

      <div className="mt-6 pt-6 border-t border-border/30">
        <div className="font-mono text-[10px] uppercase text-foreground-muted tracking-wider mb-3">
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
                        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                          In partner pool
                        </span>
                      )}
                    </div>
                    {row.vendor_name && (
                      <div className="font-mono text-[10px] text-foreground-muted truncate">{row.vendor_email}</div>
                    )}
                    <div className="font-mono text-[10px] text-foreground-muted">
                      Sent {formatDateTime(row.created_at)} · Expires {formatDateTime(row.expires_at)}
                    </div>
                  </div>
                  <span className={cn("font-mono text-[10px] px-2 py-0.5 rounded-full uppercase shrink-0", pill.className)}>
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
                      className="font-mono text-[10px] text-accent border border-accent/30 hover:bg-accent/10 rounded-md px-2 py-1 transition-colors shrink-0"
                    >
                      View Bid
                    </a>
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
