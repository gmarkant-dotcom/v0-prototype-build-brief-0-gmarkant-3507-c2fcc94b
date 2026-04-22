"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { SettingsLayout } from "@/components/settings-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Globe, Building2 } from "lucide-react"
import { cn } from "@/lib/utils"

export default function CompanySettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<{
    id: string
    company_name: string
    company_website?: string
    role: "agency" | "partner"
  } | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, company_name, company_website, role")
        .eq("id", user.id)
        .single()

      if (data) setProfile(data)
      setLoading(false)
    }

    loadProfile()
  }, [router])

  const handleSave = async () => {
    if (!profile) return
    
    setSaving(true)
    setMessage(null)

    const supabase = createClient()
    
    const { error } = await supabase
      .from("profiles")
      .update({
        company_name: profile.company_name,
        company_website: profile.company_website,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)

    if (error) {
      setMessage({ type: "error", text: error.message })
    } else {
      setMessage({ type: "success", text: "Company info updated successfully" })
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <SettingsLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      </SettingsLayout>
    )
  }

  return (
    <SettingsLayout userRole={profile?.role}>
      <div className="space-y-8">
        <div>
          <h2 className="font-display font-black text-2xl text-foreground mb-2">Company</h2>
          <p className="text-foreground-muted">Manage your company information and branding.</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-4 pb-6 border-b border-border/30">
            <div className="w-16 h-16 rounded-xl bg-accent/20 flex items-center justify-center">
              <Building2 className="w-8 h-8 text-accent" />
            </div>
            <div>
              <div className="font-display font-bold text-lg text-foreground">{profile?.company_name}</div>
              <div className="text-foreground-muted text-sm">Organization Details</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Company Name
              </label>
              <Input
                value={profile?.company_name || ""}
                onChange={(e) => setProfile(p => p ? { ...p, company_name: e.target.value } : null)}
                className="bg-white/5 border-border/30 text-foreground"
              />
            </div>

            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Company Website
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                <Input
                  type="text"
                  value={profile?.company_website || ""}
                  onChange={(e) => setProfile(p => p ? { ...p, company_website: e.target.value } : null)}
                  placeholder="https://youragency.com"
                  className="bg-white/5 border-border/30 text-foreground pl-10 placeholder:text-foreground-muted/50"
                />
              </div>
            </div>
          </div>

          {message && (
            <div className={cn(
              "p-3 rounded-lg text-sm",
              message.type === "success" 
                ? "bg-green-500/10 border border-green-500/30 text-green-400"
                : "bg-red-500/10 border border-red-500/30 text-red-400"
            )}>
              {message.text}
            </div>
          )}

          <div className="flex justify-end">
            <Button 
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </SettingsLayout>
  )
}
