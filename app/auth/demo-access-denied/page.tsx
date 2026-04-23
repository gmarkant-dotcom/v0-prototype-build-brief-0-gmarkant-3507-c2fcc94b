"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { Lock, ArrowRight, Mail } from "lucide-react"

export default function DemoAccessDeniedPage() {
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

        {/* Access Denied Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-8 h-8 text-amber-400" />
          </div>
          
          <h1 className="font-display font-black text-2xl text-foreground mb-3">
            Demo Access Required
          </h1>
          
          <p className="text-foreground-muted mb-6">
            The demo environment is currently invite-only. Contact us to request access and see Ligament in action.
          </p>

          <div className="space-y-3">
            <Button asChild className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
              <a href="mailto:greg@withligament.com?subject=Demo Access Request">
                <Mail className="w-4 h-4 mr-2" />
                Request Demo Access
              </a>
            </Button>
            
            <Button asChild variant="outline" className="w-full border-border/50 text-foreground hover:text-foreground">
              <Link href="https://withligament.com">
                Go to Production Site
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-foreground-muted">
            Already have access?{" "}
            <Link href="/auth/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
