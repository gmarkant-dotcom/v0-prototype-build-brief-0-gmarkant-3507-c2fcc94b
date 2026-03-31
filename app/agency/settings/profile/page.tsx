"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { createClient } from "@/lib/supabase/client"
import { Camera, Loader2 } from "lucide-react"
import { isDemoMode } from "@/lib/demo-data"

type ProfileState = {
  id: string
  company_name: string
  bio: string
  location: string
  website: string
  agency_type: string
  avatar_url: string
  is_discoverable: boolean
}

export default function AgencyProfileSettingsPage() {
  const router = useRouter()
  const isDemo = isDemoMode()
  const fileRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileState>({
    id: "",
    company_name: "",
    bio: "",
    location: "",
    website: "",
    agency_type: "",
    avatar_url: "",
    is_discoverable: false,
  })

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fagency%2Fsettings%2Fprofile")
        return
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role, company_name, bio, location, website, agency_type, avatar_url, is_discoverable")
        .eq("id", user.id)
        .maybeSingle()
      if (profile?.role !== "agency") {
        router.push("/agency")
        return
      }
      setForm({
        id: profile.id,
        company_name: profile.company_name || "",
        bio: profile.bio || "",
        location: profile.location || "",
        website: profile.website || "",
        agency_type: profile.agency_type || "",
        avatar_url: profile.avatar_url || "",
        is_discoverable: !!profile.is_discoverable,
      })
      setLoading(false)
    }
    load()
  }, [router])

  const saveProfile = async () => {
    setSaving(true)
    setMessage(null)
    if (isDemo) {
      setMessage("Demo mode - profile changes are not persisted.")
      setSaving(false)
      return
    }
    const supabase = createClient()
    const { error } = await supabase
      .from("profiles")
      .update({
        company_name: form.company_name,
        bio: form.bio,
        location: form.location,
        website: form.website,
        agency_type: form.agency_type,
        avatar_url: form.avatar_url || null,
        is_discoverable: form.is_discoverable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", form.id)
    setMessage(error ? error.message : "Agency profile updated.")
    setSaving(false)
  }

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true)
    setMessage(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("folder", "agency-logos")
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Failed to upload logo")
      setForm((prev) => ({ ...prev, avatar_url: payload.url || prev.avatar_url }))
      setMessage("Logo uploaded.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload logo.")
    } finally {
      setUploadingLogo(false)
    }
  }

  if (loading) {
    return (
      <AgencyLayout>
        <div className="p-8 flex items-center justify-center text-foreground-muted">Loading profile...</div>
      </AgencyLayout>
    )
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-4xl space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">Agency Profile</h1>
          <p className="text-foreground-muted mt-1">
            Manage your public marketplace profile and company information.
          </p>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6">
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-accent/15 overflow-hidden flex items-center justify-center">
              {form.avatar_url ? (
                <img src={form.avatar_url} alt="Agency logo" className="w-full h-full object-cover" />
              ) : (
                <span className="font-display font-bold text-xl text-accent">
                  {(form.company_name || "A")
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="file"
                ref={fileRef}
                className="sr-only"
                accept=".png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadLogo(file)
                }}
              />
              <Button variant="outline" className="border-border text-foreground" onClick={() => fileRef.current?.click()}>
                {uploadingLogo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                Upload Logo
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6 space-y-5">
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company Name</label>
            <Input
              value={form.company_name}
              onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Agency Type / Specialization</label>
            <Input
              value={form.agency_type}
              onChange={(e) => setForm((p) => ({ ...p, agency_type: e.target.value }))}
              placeholder="e.g. Sports Marketing, Production, Brand Strategy"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company Description / Bio</label>
            <Textarea
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              className="min-h-[120px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Location</label>
              <Input
                value={form.location}
                onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Website URL</label>
              <Input
                value={form.website}
                onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))}
                placeholder="https://example.com"
                className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={form.is_discoverable}
              onCheckedChange={(checked) => setForm((p) => ({ ...p, is_discoverable: !!checked }))}
            />
            <div>
              <div className="text-foreground font-medium">Make my agency discoverable on the Ligament Marketplace</div>
              <p className="text-xs text-foreground-muted mt-1">
                Discoverable agencies can be found by partner agencies and other lead agencies on the platform.
              </p>
            </div>
          </label>
          {message && <p className="text-sm text-foreground-muted">{message}</p>}
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>
      </div>
    </AgencyLayout>
  )
}
