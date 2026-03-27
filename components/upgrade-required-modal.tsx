"use client"

import { Button } from "@/components/ui/button"
import { X, Lock, ArrowRight, Sparkles } from "lucide-react"
import Link from "next/link"

interface UpgradeRequiredModalProps {
  isOpen: boolean
  onClose: () => void
  featureName?: string
}

export function UpgradeRequiredModal({ isOpen, onClose, featureName }: UpgradeRequiredModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="w-full max-w-md bg-background/95 backdrop-blur-xl border border-border/30 rounded-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg text-foreground">
                Premium Feature
              </h2>
              <p className="text-xs text-foreground-muted">
                Upgrade to unlock
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-center py-4">
          <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-accent" />
          </div>
          
          <h3 className="font-display font-bold text-xl text-foreground mb-2">
            Full Features Available to Paid Users
          </h3>
          
          <p className="text-foreground-muted mb-6">
            {featureName 
              ? `Access ${featureName} and all other premium features with a paid subscription.`
              : "Unlock all features including file uploads, project management, partner collaboration, and more."
            }
          </p>

          <div className="bg-white/5 border border-border/30 rounded-lg p-4 mb-6 text-left">
            <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
              What you get with Pro
            </div>
            <ul className="space-y-2 text-sm text-foreground-secondary">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                Unlimited file uploads & storage
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                Full project management suite
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                Partner collaboration tools
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                RFP creation & bid management
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                Advanced analytics & reporting
              </li>
            </ul>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-border/50 text-foreground-muted"
            >
              Maybe Later
            </Button>
            <Button
              asChild
              className="flex-1 bg-accent text-background hover:bg-accent/90"
            >
              <Link href="/pricing">
                View Pricing
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
