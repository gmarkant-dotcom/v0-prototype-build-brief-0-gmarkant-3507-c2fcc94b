"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LigamentLogo } from "@/components/ligament-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Lock, Eye, EyeOff } from "lucide-react"

export default function PasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        router.push("/")
        router.refresh()
      } else {
        setError("Incorrect password")
      }
    } catch {
      setError("Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <LigamentLogo size="md" variant="primary" />
        </div>
        
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8">
          <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-6">
            <Lock className="w-6 h-6 text-accent" />
          </div>
          
          <h1 className="font-display font-black text-xl text-foreground text-center mb-2">
            Protected Site
          </h1>
          <p className="text-foreground-muted text-sm text-center mb-6">
            Enter the password to continue
          </p>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/90 hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            
            <Button 
              type="submit" 
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
              disabled={loading || !password}
            >
              {loading ? "Verifying..." : "Continue"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
