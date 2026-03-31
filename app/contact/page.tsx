"use client"

import { FormEvent, Suspense, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react"

function ContactFormContent() {
  const params = useSearchParams()
  const selectedPlan = (params.get("plan") || "").trim().toLowerCase()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planLabel = useMemo(() => {
    if (!selectedPlan) return "General inquiry"
    return `Plan interest: ${selectedPlan}`
  }, [selectedPlan])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          message,
          plan: selectedPlan || null,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Failed to send message")
      setSubmitted(true)
      setName("")
      setEmail("")
      setMessage("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-card border border-border rounded-2xl p-8">
        <h1 className="font-display font-black text-3xl text-foreground mb-2">Contact Support</h1>
        <p className="text-foreground-muted mb-6">
          Need help with your account, billing, or onboarding? Reach out and we will get back to you.
        </p>

        <div className="rounded-xl border border-border p-4 bg-white/5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Mail className="w-5 h-5 text-accent shrink-0" />
            <a href="mailto:support@withligament.com" className="text-foreground hover:underline truncate">
              support@withligament.com
            </a>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <a href="mailto:support@withligament.com">Email support</a>
          </Button>
        </div>

        <div className="mt-6 rounded-xl border border-border p-4 bg-white/5">
          {submitted ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
              <div>
                <p className="text-foreground font-medium">Message sent successfully.</p>
                <p className="text-sm text-foreground-muted mt-1">We will reach out to you shortly at the email provided.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <input type="hidden" name="plan" value={selectedPlan} />
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Message</label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  className="min-h-[120px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
                  placeholder="Tell us what you need and we will get right back to you."
                />
              </div>
              <div className="text-xs text-foreground-muted">{planLabel}</div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={submitting} className="bg-accent text-accent-foreground hover:bg-accent/90">
                {submitting ? "Sending..." : "Send Message"}
              </Button>
            </form>
          )}
        </div>

        <div className="mt-6">
          <Button asChild variant="ghost" className="text-foreground-muted">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function ContactFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-card border border-border rounded-2xl p-8 text-foreground-muted">Loading contact form...</div>
    </div>
  )
}

export default function ContactPage() {
  return (
    <Suspense fallback={<ContactFallback />}>
      <ContactFormContent />
    </Suspense>
  )
}
