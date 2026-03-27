"use client"

import Link from "next/link"
import { CheckCircle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LigamentLogo } from "@/components/ligament-logo"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function ConfirmedContent() {
  const searchParams = useSearchParams()
  const role = searchParams.get("role") || "partner"
  const isAgency = role === "agency"

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/">
            <LigamentLogo variant="primary" size="md" />
          </Link>
        </div>

        {/* Success Card */}
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          {/* Success Icon */}
          <div className="w-16 h-16 rounded-full bg-[#C8F53C]/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-[#C8F53C]" />
          </div>

          <h1 className="font-display font-black text-2xl text-foreground mb-3">
            Email Confirmed!
          </h1>
          
          <p className="text-foreground-muted mb-6">
            Your email has been successfully verified. Your {isAgency ? "Lead Agency" : "Partner Agency"} account is now active.
          </p>

          <p className="text-foreground-muted text-sm mb-8">
            Please log in to access your {isAgency ? "agency dashboard" : "partner portal"}.
          </p>

          <Button asChild className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
            <Link href="/auth/login">
              Log In to Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        </div>

        {/* Footer */}
        <p className="text-center text-foreground-muted text-xs mt-6">
          Having trouble?{" "}
          <Link href="/contact" className="text-accent hover:underline">
            Contact support
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function EmailConfirmedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground-muted">Loading...</div>
      </div>
    }>
      <ConfirmedContent />
    </Suspense>
  )
}
