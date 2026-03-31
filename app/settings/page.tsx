"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { SettingsLayout } from "@/components/settings-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { User, Save, Camera } from "lucide-react"
import { cn } from "@/lib/utils"

interface Profile {
  id: string
  email: string
  full_name: string
  company_name: string
  role: "agency" | "partner"
  phone: string
  avatar_url: string
  timezone: string
  is_discoverable: boolean
}

export default function ProfileSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createClient()
      
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single()

      if (profileData) {
        setProfile({
          ...profileData,
          email: user.email || "",
        })
      }
      
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
        full_name: profile.full_name,
        phone: profile.phone,
        timezone: profile.timezone,
        is_discoverable: profile.is_discoverable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)

    if (error) {
      setMessage({ type: "error", text: error.message })
    } else {
      setMessage({ type: "success", text: "Profile updated successfully" })
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <SettingsLayout userRole={profile?.role}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      </SettingsLayout>
    )
  }

  return (
    <SettingsLayout userRole={profile?.role}>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h2 className="font-display font-black text-2xl text-foreground mb-2">Profile</h2>
          <p className="text-foreground-muted">Manage your personal information and preferences.</p>
        </div>

        {/* Avatar Section */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
          <div className="flex items-center gap-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-accent/20 flex items-center justify-center">
                {profile?.avatar_url ? (
                  <img 
                    src={profile.avatar_url} 
                    alt={profile.full_name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span className="font-display font-bold text-2xl text-accent">
                    {profile?.full_name?.split(" ").map(n => n[0]).join("") || "?"}
                  </span>
                )}
              </div>
              <button className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center hover:bg-accent/90 transition-colors">
                <Camera className="w-4 h-4" />
              </button>
            </div>
            <div>
              <div className="font-display font-bold text-lg text-foreground">{profile?.full_name}</div>
              <div className="text-foreground-muted">{profile?.email}</div>
              <div className={cn(
                "mt-2 font-mono text-[10px] px-2 py-0.5 rounded-full border inline-block capitalize",
                profile?.role === "agency" 
                  ? "bg-accent/10 text-accent border-accent/30"
                  : "bg-purple-500/10 text-purple-400 border-purple-500/30"
              )}>
                {profile?.role}
              </div>
            </div>
          </div>
        </div>

        {/* Profile Form */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Full Name
              </label>
              <Input
                value={profile?.full_name || ""}
                onChange={(e) => setProfile(p => p ? { ...p, full_name: e.target.value } : null)}
                className="bg-white/5 border-border/30 text-foreground"
              />
            </div>

            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Email Address
              </label>
              <Input
                value={profile?.email || ""}
                disabled
                className="bg-white/5 border-border/30 text-foreground-muted"
              />
              <p className="text-[10px] text-foreground-muted mt-1">Contact support to change email</p>
            </div>

            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Phone Number
              </label>
              <Input
                type="tel"
                value={profile?.phone || ""}
                onChange={(e) => setProfile(p => p ? { ...p, phone: e.target.value } : null)}
                placeholder="+1 (555) 123-4567"
                className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
              />
            </div>

            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Timezone
              </label>
              <select
                value={profile?.timezone || "America/New_York"}
                onChange={(e) => setProfile(p => p ? { ...p, timezone: e.target.value } : null)}
                className="w-full h-10 px-3 bg-white/5 border border-border/30 rounded-md text-foreground"
              >
                <option value="America/New_York">Eastern Time (ET)</option>
                <option value="America/Chicago">Central Time (CT)</option>
                <option value="America/Denver">Mountain Time (MT)</option>
                <option value="America/Los_Angeles">Pacific Time (PT)</option>
                <option value="Europe/London">London (GMT)</option>
                <option value="Europe/Paris">Central European (CET)</option>
              </select>
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
