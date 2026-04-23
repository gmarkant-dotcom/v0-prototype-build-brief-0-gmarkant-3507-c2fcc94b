"use client"

import { useState, Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { Shield, ArrowRight, Loader2 } from "lucide-react"

function MfaVerifyContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get("redirect") || ""
  
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    const checkMfaStatus = async () => {
      const supabase = createClient()
      
      // Get MFA factors
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
      
      if (factorsError || !factors?.totp || factors.totp.length === 0) {
        // No MFA factors, redirect to login
        router.push("/auth/login")
        return
      }
      
      const verifiedFactor = factors.totp.find(f => f.status === "verified")
      if (!verifiedFactor) {
        router.push("/auth/login")
        return
      }
      
      setFactorId(verifiedFactor.id)
      setInitializing(false)
    }
    
    checkMfaStatus()
  }, [router])

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!factorId || code.length !== 6) return
    
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      
      // Create a challenge
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      })
      
      if (challengeError) {
        setError(challengeError.message)
        setLoading(false)
        return
      }
      
      // Verify the challenge
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code
      })
      
      if (verifyError) {
        setError("Invalid verification code. Please try again.")
        setCode("")
        setLoading(false)
        return
      }

      // Get user role for redirect
      const { data: { user } } = await supabase.auth.getUser()
      let userRole = "partner"
      
      if (user) {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single()

          if (profile?.role) {
            userRole = profile.role
          }
        } catch {
          // Profile might not exist
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

  if (initializing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
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

        {/* Verify Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-accent" />
            </div>
            <h1 className="font-display font-black text-2xl text-foreground mb-2">
              Two-Factor Verification
            </h1>
            <p className="text-foreground-muted text-sm">
              Enter the 6-digit code from your authenticator app
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                required
                autoFocus
                className="bg-white/5 border-border/30 text-foreground text-center text-3xl tracking-[0.5em] font-mono py-6"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 text-center">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  Verify & Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-foreground-muted">
              Having trouble?{" "}
              <Link href="/auth/login" className="text-accent hover:underline">
                Try signing in again
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

export default function MfaVerifyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    }>
      <MfaVerifyContent />
    </Suspense>
  )
}
