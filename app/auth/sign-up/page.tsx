"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { Eye, EyeOff, ArrowRight, Building2, Users } from "lucide-react"
import { cn } from "@/lib/utils"

type UserRole = "agency" | "partner"

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-pulse text-foreground-muted">Loading...</div>
        </div>
      }
    >
      <SignUpContent />
    </Suspense>
  )
}

function SignUpContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken = (searchParams.get("invite") || "").trim()
  const inviteType = (searchParams.get("invite_type") || "").trim().toLowerCase()
  const nextPath = (searchParams.get("next") || "").trim()
  const prefillEmail = (searchParams.get("email") || "").trim().toLowerCase()
  const ndaRequired = searchParams.get("nda") === "required"
  const scopeName = (searchParams.get("scope") || "").trim()
  const agencyName = (searchParams.get("agency") || "").trim()
  const hasRfpInviteContext = inviteToken.length > 0
  const hasPartnershipInviteContext = inviteType === "partnership"
  const hasInviteContext = hasRfpInviteContext || hasPartnershipInviteContext
  
  const [step, setStep] = useState<1 | 2>(1)
  const [role, setRole] = useState<UserRole | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)

  useEffect(() => {
    if (!hasInviteContext) return
    setRole("partner")
    setStep(2)
  }, [hasInviteContext])

  useEffect(() => {
    if (prefillEmail) setEmail(prefillEmail)
  }, [prefillEmail])

  const inviteBannerText = useMemo(() => {
    if (!hasInviteContext) return ""
    if (hasPartnershipInviteContext) {
      return "A lead agency has invited you to join their partner network on Ligament."
    }
    if (agencyName && scopeName) {
      return `${agencyName} has invited you to respond to an RFP for ${scopeName} on Ligament.`
    }
    return "You've been invited to respond to an RFP on Ligament."
  }, [agencyName, hasInviteContext, hasPartnershipInviteContext, scopeName])

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!acceptedTerms || !acceptedPrivacy) {
      setError("You must accept the Terms of Service and Privacy Policy to create an account")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    
    // Use the current origin for redirect - this ensures it always points to the live deployment
    const redirectUrlObj = new URL(`${window.location.origin}/auth/callback`)
    if (inviteToken) {
      redirectUrlObj.searchParams.set("invite", inviteToken)
      if (ndaRequired) redirectUrlObj.searchParams.set("nda", "required")
      if (scopeName) redirectUrlObj.searchParams.set("scope", scopeName)
      if (agencyName) redirectUrlObj.searchParams.set("agency", agencyName)
    }
    if (hasPartnershipInviteContext) {
      redirectUrlObj.searchParams.set("invite_type", "partnership")
    }
    if (nextPath) {
      redirectUrlObj.searchParams.set("next", nextPath)
    }
    const redirectUrl = redirectUrlObj.toString()
    
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          company_name: companyName,
          role: role,
          terms_accepted_at: new Date().toISOString(),
          privacy_accepted_at: new Date().toISOString(),
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (!inviteToken) {
      router.push("/auth/sign-up-success")
      return
    }

    try {
      const claimRes = await fetch("/api/partner/rfps/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      })
      const claimData = await claimRes.json().catch(() => ({}))
      if (!claimRes.ok) {
        router.push("/partner/rfps?invite_status=failed")
        return
      }

      const inboxItemId = (claimData?.inboxItemId as string) || ""
      if (!inboxItemId) {
        router.push("/partner/rfps?invite_status=failed")
        return
      }
      const nextPath = claimData?.ndaGateEnforced
        ? `/partner/rfps/${encodeURIComponent(inboxItemId)}?nda=required`
        : `/partner/rfps/${encodeURIComponent(inboxItemId)}`
      router.push(nextPath)
    } catch {
      router.push("/partner/rfps?invite_status=failed")
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <HolographicBlobs />
      
      <div className="w-full max-w-md mx-4 relative z-10">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/">
            <LigamentLogo size="md" variant="primary" />
          </Link>
        </div>

        {/* Sign Up Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          {step === 1 ? (
            <>
              <div className="text-center mb-8">
                <h1 className="font-display font-black text-2xl text-foreground mb-2">
                  Create Account
                </h1>
                <p className="text-foreground-muted text-sm">
                  Choose your account type to get started
                </p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => {
                    setRole("agency")
                    setStep(2)
                  }}
                  className={cn(
                    "w-full p-4 rounded-xl border text-left transition-all",
                    "bg-white/5 border-border/30 hover:border-accent/50 hover:bg-accent/5"
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
                      <Building2 className="w-6 h-6 text-accent" />
                    </div>
                    <div>
                      <div className="font-display font-bold text-foreground mb-1">
                        Lead Agency
                      </div>
                      <p className="text-sm text-foreground-muted">
                        I manage projects and orchestrate external partners to deliver client work.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setRole("partner")
                    setStep(2)
                  }}
                  className={cn(
                    "w-full p-4 rounded-xl border text-left transition-all",
                    "bg-white/5 border-border/30 hover:border-purple-500/50 hover:bg-purple-500/5"
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                      <Users className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                      <div className="font-display font-bold text-foreground mb-1">
                        Partner / Freelancer
                      </div>
                      <p className="text-sm text-foreground-muted">
                        I provide services to agencies and respond to project opportunities.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className={cn(
                    "font-mono text-[10px] px-2 py-0.5 rounded-full border capitalize",
                    role === "agency" 
                      ? "bg-accent/10 text-accent border-accent/30" 
                      : "bg-purple-500/10 text-purple-400 border-purple-500/30"
                  )}>
                    {role}
                  </span>
                </div>
                <h1 className="font-display font-black text-2xl text-foreground mb-2">
                  Your Details
                </h1>
                <p className="text-foreground-muted text-sm">
                  Complete your account setup
                </p>
              </div>

              {hasInviteContext && (
                <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 p-3">
                  <p className="text-sm text-foreground">{inviteBannerText}</p>
                  {ndaRequired && (
                    <p className="mt-2 text-xs text-foreground-muted">
                      This RFP requires a signed NDA. You&apos;ll be guided through the NDA process after creating your account.
                    </p>
                  )}
                </div>
              )}
              <form onSubmit={handleSignUp} className="space-y-4">
                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Full Name
                  </label>
                  <Input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Smith"
                    required
                    className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Company Name
                  </label>
                  <Input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Your organization"
                    required
                    className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Email Address
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    readOnly={Boolean(prefillEmail)}
                    className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      required
                      className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/90 hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Confirm Password
                  </label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>

                {/* Legal Agreements */}
                <div className="space-y-3 pt-2">
                  <div className="p-4 bg-white/5 rounded-lg border border-border/30">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      {role === "agency" ? "Lead Agency Agreement" : "Partner Agreement"}
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="terms"
                          checked={acceptedTerms}
                          onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                          className="mt-1 border-border/50 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                        />
                        <label htmlFor="terms" className="text-sm text-foreground-secondary leading-relaxed cursor-pointer">
                          I have read and agree to the{" "}
                          <Link 
                            href="/legal/terms" 
                            target="_blank" 
                            className="text-accent hover:underline"
                          >
                            Terms of Service
                          </Link>
                          {role === "agency" ? (
                            <span className="text-foreground-muted">
                              , including my responsibilities as a Lead Agency for managing partner relationships, 
                              payment obligations, and compliance with applicable contractor laws.
                            </span>
                          ) : (
                            <span className="text-foreground-muted">
                              , including my responsibilities as an independent contractor, confidentiality obligations, 
                              and delivery commitments.
                            </span>
                          )}
                        </label>
                      </div>

                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="privacy"
                          checked={acceptedPrivacy}
                          onCheckedChange={(checked) => setAcceptedPrivacy(checked === true)}
                          className="mt-1 border-border/50 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                        />
                        <label htmlFor="privacy" className="text-sm text-foreground-secondary leading-relaxed cursor-pointer">
                          I have read and agree to the{" "}
                          <Link 
                            href="/legal/privacy" 
                            target="_blank" 
                            className="text-accent hover:underline"
                          >
                            Privacy Policy
                          </Link>
                          {role === "agency" ? (
                            <span className="text-foreground-muted">
                              , including how my company and partner data will be collected, used, and shared 
                              to facilitate vendor orchestration.
                            </span>
                          ) : (
                            <span className="text-foreground-muted">
                              , including how my profile, capabilities, and project data will be shared with 
                              Lead Agencies I engage with.
                            </span>
                          )}
                        </label>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-foreground-muted text-center leading-relaxed">
                    By creating an account, you acknowledge that you are authorized to accept these terms 
                    on behalf of your organization.
                  </p>
                </div>

                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                    {error}
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="border-border/50 text-foreground hover:text-foreground"
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
                  >
                    {loading ? "Creating account..." : "Create Account"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </form>
            </>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-foreground-muted">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-accent hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        {/* Footer links */}
        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-foreground/90 hover:text-foreground">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
