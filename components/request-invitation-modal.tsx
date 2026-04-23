"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { X, Send, CheckCircle, Building2 } from "lucide-react"

interface RequestInvitationModalProps {
  isOpen: boolean
  onClose: () => void
  partnerName?: string
}

export function RequestInvitationModal({ isOpen, onClose, partnerName }: RequestInvitationModalProps) {
  const [agencyName, setAgencyName] = useState("")
  const [agencyEmail, setAgencyEmail] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setError("You must be logged in to request an invitation")
        setLoading(false)
        return
      }

      // Insert invitation request
      const { error: insertError } = await supabase
        .from('invitation_requests')
        .insert({
          partner_id: user.id,
          agency_email: agencyEmail.toLowerCase().trim(),
          agency_name: agencyName.trim(),
          message: message.trim() || null,
          status: 'pending',
        })

      if (insertError) {
        if (insertError.code === '23505') {
          setError("You have already sent a request to this agency")
        } else {
          setError(insertError.message)
        }
        setLoading(false)
        return
      }

      // TODO: Send email notification to agency
      // For now, just show success

      setSuccess(true)
    } catch (err) {
      setError("Failed to send request. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setAgencyName("")
    setAgencyEmail("")
    setMessage("")
    setSuccess(false)
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div 
        className="w-full max-w-md bg-background/95 backdrop-blur-xl border border-border/30 rounded-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        {success ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="font-display font-bold text-xl text-foreground mb-2">
              Request Sent!
            </h2>
            <p className="text-foreground-muted mb-6">
              We&apos;ve notified {agencyName || "the agency"} about your request. You&apos;ll receive an email when they respond.
            </p>
            <Button onClick={handleClose} className="bg-accent text-background hover:bg-accent/90">
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-lg text-foreground">
                    Request Agency Invitation
                  </h2>
                  <p className="text-xs text-foreground-muted">
                    Connect with a Lead Agency to access projects
                  </p>
                </div>
              </div>
              <button onClick={handleClose} className="text-foreground hover:text-accent">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-6">
              <p className="text-sm text-amber-200">
                <strong>Partner accounts require an agency connection.</strong> Enter the details of a Lead Agency you&apos;d like to work with, and we&apos;ll send them your request.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  Lead Agency Name
                </label>
                <Input
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  placeholder="e.g., Creative Partners Inc."
                  required
                  className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  Agency Contact Email
                </label>
                <Input
                  type="email"
                  value={agencyEmail}
                  onChange={(e) => setAgencyEmail(e.target.value)}
                  placeholder="contact@agency.com"
                  required
                  className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  Message (Optional)
                </label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Introduce yourself and explain why you'd like to work together..."
                  rows={3}
                  className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50 resize-none"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  className="flex-1 border-border/50 text-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-accent text-background hover:bg-accent/90"
                >
                  {loading ? "Sending..." : "Send Request"}
                  <Send className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
