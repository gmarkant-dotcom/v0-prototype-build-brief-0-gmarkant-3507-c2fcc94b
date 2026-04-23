"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { Eye, EyeOff, ArrowRight } from "lucide-react"

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get("redirect") || searchParams.get("next") || ""
  const inviteToken = (searchParams.get("invite") || "").trim()
  const inviteScope = (searchParams.get("scope") || "").trim()
  const inviteAgency = (searchParams.get("agency") || "").trim()
  const inviteNdaRequired = searchParams.get("nda") === "required"
  const signUpHref = (() => {
    if (!inviteToken) return "/auth/sign-up"
    const qp = new URLSearchParams()
    qp.set("invite", inviteToken)
    const email = searchParams.get("email")
    const nda = searchParams.get("nda")
    const scope = searchParams.get("scope")
    const agency = searchParams.get("agency")
    if (email) qp.set("email", email)
    if (nda) qp.set("nda", nda)
    if (scope) qp.set("scope", scope)
    if (agency) qp.set("agency", agency)
    return `/auth/sign-up?${qp.toString()}`
  })()
  
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(signInError.message)
        setLoading(false)
        return
      }

      // Check if user has MFA enabled
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const hasVerifiedMfa = factors?.totp?.some(f => f.status === "verified")
      
      if (hasVerifiedMfa) {
        // Redirect to MFA verification page
        const mfaRedirect = redirect ? `/auth/mfa-verify?redirect=${encodeURIComponent(redirect)}` : "/auth/mfa-verify"
        router.push(mfaRedirect)
        return
      }

      // No MFA - continue with normal login flow
      // Try to get user profile to determine role, but don't block on failure
      let userRole = "partner" // Default to partner if no profile
      
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user?.id)
          .single()

        if (profile?.role) {
          userRole = profile.role
        }
      } catch (profileErr) {
        // Profile table might not exist yet, continue with default role
      }

      if (inviteToken) {
        const claimRes = await fetch("/api/partner/rfps/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken }),
        })
        const claimData = await claimRes.json().catch(() => ({}))
        if (claimRes.ok && claimData?.inboxItemId) {
          const nextPath = claimData?.ndaGateEnforced || inviteNdaRequired
            ? `/partner/rfps/${encodeURIComponent(claimData.inboxItemId)}?nda=required`
            : `/partner/rfps/${encodeURIComponent(claimData.inboxItemId)}`
          router.push(nextPath)
          router.refresh()
          return
        }
      }

      // Redirect based on role or original destination
      if (redirect) {
        router.push(redirect)
      } else if (userRole === "agency") {
        router.push("/agency")
      } else {
        router.push("/partner")
      }
      
      router.refresh()
    } catch (err) {
      setError("An unexpected error occurred. Please try again.")
      setLoading(false)
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

        {/* Login Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          <div className="text-center mb-8">
            <h1 className="font-display font-black text-2xl text-foreground mb-2">
              Welcome Back
            </h1>
            <p className="text-foreground-muted text-sm">
              Sign in to your LIGAMENT account
            </p>
          </div>
          {inviteToken && (
            <div className="mb-5 rounded-lg border border-accent/30 bg-accent/10 p-3">
              <p className="text-sm text-foreground">
                {(inviteAgency && inviteScope)
                  ? `${inviteAgency} has sent you an RFP for ${inviteScope}. Log in to view it.`
                  : "You have an RFP invite waiting. Log in to view it."}
              </p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
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
                className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                  Password
                </label>
                <Link 
                  href="/auth/forgot-password" 
                  className="font-mono text-[10px] text-accent hover:text-accent/80 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
            >
              {loading ? "Signing in..." : "Sign In"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-foreground-muted">
              Don't have an account?{" "}
              <Link href={signUpHref} className="text-accent hover:underline">
                Create one
              </Link>
            </p>
          </div>
        </div>

        {/* Footer links */}
        <div className="mt-6 text-center space-y-3">
          <Link href="/" className="text-sm text-foreground-muted hover:text-foreground">
            Back to Home
          </Link>
          <div className="flex items-center justify-center gap-3">
            <Link 
              href="/legal/terms" 
              className="text-[11px] text-foreground-muted/60 hover:text-foreground-muted transition-colors"
            >
              Terms of Service
            </Link>
            <span className="text-foreground-muted/30">|</span>
            <Link 
              href="/legal/privacy" 
              className="text-[11px] text-foreground-muted/60 hover:text-foreground-muted transition-colors"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground-muted">Loading...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
