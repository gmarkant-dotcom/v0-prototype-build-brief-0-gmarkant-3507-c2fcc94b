"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Mail, ArrowLeft } from "lucide-react"

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-card border border-border rounded-2xl p-8">
        <h1 className="font-display font-black text-3xl text-foreground mb-2">Contact Support</h1>
        <p className="text-foreground-muted mb-6">
          Need help with your account, billing, or onboarding? Reach out and we will get back to you.
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
