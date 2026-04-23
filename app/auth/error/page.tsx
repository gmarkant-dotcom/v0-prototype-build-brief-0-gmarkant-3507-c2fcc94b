"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const errorMessage = searchParams.get("message")
  
  const isExpiredLink = errorMessage?.toLowerCase().includes("expired")
  const isPKCEError = errorMessage?.toLowerCase().includes("code challenge") || errorMessage?.toLowerCase().includes("code verifier")
  
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <HolographicBlobs />
      
      <div className="w-full max-w-md mx-4 relative z-10 text-center">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <LigamentLogo size="md" variant="primary" />
          </Link>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          
          <h1 className="font-display font-black text-2xl text-foreground mb-3">
            {isPKCEError ? "Different Browser Detected" : isExpiredLink ? "Link Expired" : "Authentication Error"}
          </h1>
          
          {errorMessage && !isPKCEError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 mb-4">
              {decodeURIComponent(errorMessage)}
            </div>
          )}
          
          <p className="text-foreground-muted mb-6">
            {isPKCEError 
              ? "You opened the confirmation link in a different browser than where you signed up. Please open the link in the same browser, or sign up again from this browser."
              : isExpiredLink 
                ? "Your email verification link has expired. Please sign up again or request a new verification email."
                : "There was a problem signing you in. This could be due to an invalid link or a temporary issue with our service."
            }
          </p>

          <div className="flex flex-col gap-3">
            {(isExpiredLink || isPKCEError) && (
              <Button asChild className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
                <Link href="/auth/sign-up">
                  Sign Up Again
                  <RefreshCw className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            )}
            
            <Button asChild className={(isExpiredLink || isPKCEError) ? "w-full border-border/50 text-foreground hover:text-foreground" : "w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono"} variant={(isExpiredLink || isPKCEError) ? "outline" : "default"}>
              <Link href="/auth/login">
                {(isExpiredLink || isPKCEError) ? "Go to Login" : "Try Again"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            
            <Button asChild variant="outline" className="w-full border-border/50 text-foreground hover:text-foreground">
              <Link href="/">
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground-muted">Loading...</div>
      </div>
    }>
      <AuthErrorContent />
    </Suspense>
  )
}
