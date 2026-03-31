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
  const [fullName, setFullName] = useState("")
  const [workEmail, setWorkEmail] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [companySize, setCompanySize] = useState("")
  const [role, setRole] = useState("")
  const [plan, setPlan] = useState(
    selectedPlan === "core" || selectedPlan === "studio" || selectedPlan === "network" ? selectedPlan : "not_sure"
  )
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planLabel = useMemo(() => {
    if (plan === "not_sure") return "Plan interest: Not sure yet"
    return `Plan interest: ${plan}`
  }, [plan])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          workEmail,
          companyName,
          companySize,
          role,
          plan,
          message: notes || null,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Failed to send message")
      setSubmitted(true)
      setFullName("")
      setWorkEmail("")
      setCompanyName("")
      setCompanySize("")
      setRole("")
      setPlan("not_sure")
      setNotes("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-card border border-border rounded-2xl p-8">
        <h1 className="font-display font-black text-3xl text-foreground mb-2">Talk to the Ligament Team</h1>
        <p className="text-foreground-muted mb-6">
          Tell us about your team and what plan you are considering. We will follow up with next steps.
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
                <p className="text-sm text-foreground-muted mt-1">Thanks! We&apos;ll be in touch within 1 business day.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Full name</label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Work email</label>
                <Input
                  type="email"
                  value={workEmail}
                  onChange={(e) => setWorkEmail(e.target.value)}
                  required
                  className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Company name</label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Company size</label>
                  <select
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    required
                    className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
                  >
                    <option value="">Select...</option>
                    <option value="1-5">1-5</option>
                    <option value="6-15">6-15</option>
                    <option value="16-30">16-30</option>
                    <option value="30+">30+</option>
                  </select>
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    required
                    className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
                  >
                    <option value="">Select...</option>
                    <option value="Founder/Owner">Founder/Owner</option>
                    <option value="Operations">Operations</option>
                    <option value="Strategy">Strategy</option>
                    <option value="Creative">Creative</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">
                  Which plan are you interested in?
                </label>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
                >
                  <option value="core">Core</option>
                  <option value="studio">Studio</option>
                  <option value="network">Network</option>
                  <option value="not_sure">Not sure yet</option>
                </select>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted block mb-2">
                  Message / anything else you&apos;d like to share
                </label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[120px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
                  placeholder="Optional details..."
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
