"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { Eye, EyeOff, ArrowRight, Lock, CheckCircle, AlertCircle } from "lucide-react"

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [validSession, setValidSession] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let mounted = true

    const handleAuth = async () => {
      // Get params from URL
      const code = searchParams.get('code')
      const token_hash = searchParams.get('token_hash')
      const type = searchParams.get('type')
      
      // Also check hash fragment (some Supabase configs use this)
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const hashType = hashParams.get('type')

      // Method 1: Handle hash fragment tokens (implicit flow)
      if (accessToken && hashType === 'recovery') {
        const refreshToken = hashParams.get('refresh_token') || ''
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        })
        if (!error && mounted) {
          setValidSession(true)
          window.history.replaceState(null, '', window.location.pathname)
          return
        }
      }

      // Method 2: Handle token_hash (OTP/magic link flow)
      if (token_hash && type === 'recovery') {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type: 'recovery'
        })
        if (!error && mounted) {
          setValidSession(true)
          window.history.replaceState(null, '', window.location.pathname)
          return
        }
      }

      // Method 3: Handle PKCE code
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error && mounted) {
          setValidSession(true)
          window.history.replaceState(null, '', window.location.pathname)
          return
        }
      }

      // Method 4: Check existing session
      const { data: { session } } = await supabase.auth.getSession()
      if (session && mounted) {
        setValidSession(true)
        return
      }

      // No valid method found
      if (mounted) {
        setValidSession(false)
      }
    }

    // Listen for auth state changes (Supabase client may auto-detect recovery)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && mounted) {
        setValidSession(true)
      } else if (event === 'SIGNED_IN' && session && mounted) {
        setValidSession(true)
      }
    })

    // Small delay to let Supabase client initialize
    setTimeout(handleAuth, 100)

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [searchParams])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long")
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      
      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      })

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }

      setSuccess(true)
      
      setTimeout(() => {
        router.push("/auth/login")
      }, 3000)
    } catch {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  // Loading state
  if (validSession === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground-muted">Verifying reset link...</div>
      </div>
    )
  }

  // Invalid or expired session
  if (!validSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
        <HolographicBlobs />
        
        <div className="w-full max-w-md mx-4 relative z-10">
          <div className="flex justify-center mb-8">
            <Link href="/">
              <LigamentLogo size="md" variant="primary" />
            </Link>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <h1 className="font-display font-black text-2xl text-foreground mb-2">
                Link Expired
              </h1>
              <p className="text-foreground-muted text-sm mb-6">
                This password reset link has expired or is invalid. Please request a new one.
              </p>
              <Link href="/auth/forgot-password">
                <Button className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
                  Request New Link
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <HolographicBlobs />
      
      <div className="w-full max-w-md mx-4 relative z-10">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <LigamentLogo size="md" variant="primary" />
          </Link>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-8 h-8 text-accent" />
              </div>
              <h1 className="font-display font-black text-2xl text-foreground mb-2">
                Password Updated
              </h1>
              <p className="text-foreground-muted text-sm mb-6">
                Your password has been successfully reset. You'll be redirected to sign in shortly.
              </p>
              <Link href="/auth/login">
                <Button className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
                  Sign In Now
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Lock className="w-8 h-8 text-accent" />
                </div>
                <h1 className="font-display font-black text-2xl text-foreground mb-2">
                  Set New Password
                </h1>
                <p className="text-foreground-muted text-sm">
                  Enter your new password below. Make sure it's at least 8 characters.
                </p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter new password"
                      required
                      minLength={8}
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

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      required
                      minLength={8}
                      className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="text-xs text-foreground-muted/60">
                  Password must be at least 8 characters long
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
                  {loading ? "Updating..." : "Reset Password"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </form>
            </>
          )}
        </div>

        <div className="mt-6 text-center space-y-3">
          <Link href="/" className="text-sm text-foreground-muted hover:text-foreground">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground-muted">Loading...</div>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}
