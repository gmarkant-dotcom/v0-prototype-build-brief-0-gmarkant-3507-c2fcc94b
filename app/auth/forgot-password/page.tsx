"use client"

import { useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { ArrowRight, ArrowLeft, Mail, CheckCircle } from "lucide-react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      })

      if (resetError) {
        setError(resetError.message)
        setLoading(false)
        return
      }

      setSuccess(true)
    } catch (err) {
      setError("An unexpected error occurred. Please try again.")
    } finally {
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

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          {success ? (
            // Success state
            <div className="text-center">
              <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-8 h-8 text-accent" />
              </div>
              <h1 className="font-display font-black text-2xl text-foreground mb-2">
                Check Your Email
              </h1>
              <p className="text-foreground-muted text-sm mb-6">
                We've sent a password reset link to <span className="text-foreground font-medium">{email}</span>. 
                Click the link in the email to reset your password.
              </p>
              <p className="text-foreground-muted/60 text-xs mb-6">
                Didn't receive the email? Check your spam folder or try again.
              </p>
              <div className="space-y-3">
                <Button
                  onClick={() => {
                    setSuccess(false)
                    setEmail("")
                  }}
                  variant="outline"
                  className="w-full border-border/30 text-foreground hover:bg-white/5"
                >
                  Try a different email
                </Button>
                <Link href="/auth/login">
                  <Button className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Sign In
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            // Form state
            <>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Mail className="w-8 h-8 text-accent" />
                </div>
                <h1 className="font-display font-black text-2xl text-foreground mb-2">
                  Forgot Password?
                </h1>
                <p className="text-foreground-muted text-sm">
                  No worries. Enter your email and we'll send you a reset link.
                </p>
              </div>

              <form onSubmit={handleResetRequest} className="space-y-4" autoComplete="off">
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
                    autoComplete="off"
                    className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                  />
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
                  {loading ? "Sending..." : "Send Reset Link"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link 
                  href="/auth/login" 
                  className="inline-flex items-center text-sm text-foreground/90 hover:text-accent transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Sign In
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Footer links */}
        <div className="mt-6 text-center space-y-3">
          <Link href="/" className="text-sm text-foreground/90 hover:text-foreground">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
