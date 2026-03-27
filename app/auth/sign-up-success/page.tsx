import Link from "next/link"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { Mail, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function SignUpSuccessPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <HolographicBlobs />
      
      <div className="w-full max-w-md mx-4 relative z-10 text-center">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/">
            <LigamentLogo size="md" variant="primary" />
          </Link>
        </div>

        {/* Success Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-accent" />
          </div>
          
          <h1 className="font-display font-black text-2xl text-foreground mb-3">
            Check Your Email
          </h1>
          
          <p className="text-foreground-muted mb-6">
            We've sent you a confirmation link. Click the link in your email to activate your account and get started.
          </p>

          <div className="p-4 bg-white/5 rounded-lg border border-border/30 mb-6">
            <p className="text-sm text-foreground-secondary">
              Didn't receive the email? Check your spam folder or{" "}
              <Link href="/auth/sign-up" className="text-accent hover:underline">
                try signing up again
              </Link>
            </p>
          </div>

          <Button asChild className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
            <Link href="/auth/login">
              Go to Login
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
