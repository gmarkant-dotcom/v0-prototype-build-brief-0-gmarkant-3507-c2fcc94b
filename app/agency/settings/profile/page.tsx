"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyShell } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { createClient } from "@/lib/supabase/client"
import { Camera, Loader2 } from "lucide-react"
import { isDemoMode } from "@/lib/demo-data"

const disciplines = [
  "Video Production",
  "Photography",
  "Motion Design",
  "Social Media",
  "Copywriting",
  "Public Relations",
  "Event Production",
  "Audio Production",
  "Brand Design",
  "Talent Relations",
  "Media Planning",
  "Strategy",
]

const capabilities = [
  "Documentary",
  "Commercial",
  "Sports Content",
  "Creator Content",
  "Social First",
  "Long Form",
  "Short Form",
  "Live Events",
  "Podcasts",
  "Editorial",
  "Branded Content",
  "UGC",
]

type ProfileState = {
  id: string
  full_name: string
  email: string
  company_name: string
  company_website: string
  company_linkedin_url: string
  bio: string
  location: string
  agency_type: string
  avatar_url: string
  company_logo_url: string
  meeting_url: string
  is_discoverable: boolean
  payment_terms: string
  payment_terms_custom: string
}

export default function AgencyProfileSettingsPage() {
  const router = useRouter()
  const isDemo = isDemoMode()
  const fileRef = useRef<HTMLInputElement>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [primaryDiscipline, setPrimaryDiscipline] = useState(disciplines[0])
  const [showCustomDiscipline, setShowCustomDiscipline] = useState(false)
  const [customDisciplineInput, setCustomDisciplineInput] = useState("")
  const [customDisciplines, setCustomDisciplines] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("agencyCustomDisciplines")
      return saved ? JSON.parse(saved) : []
    }
    return []
  })
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([])
  const [customCapability, setCustomCapability] = useState("")
  const [customCapabilities, setCustomCapabilities] = useState<string[]>([])
  const allDisciplines = [...disciplines, ...customDisciplines]
  const [form, setForm] = useState<ProfileState>({
    id: "",
    full_name: "",
    email: "",
    company_name: "",
    company_website: "",
    company_linkedin_url: "",
    bio: "",
    location: "",
    agency_type: "",
    avatar_url: "",
    company_logo_url: "",
    meeting_url: "",
    is_discoverable: false,
    payment_terms: "net_30",
    payment_terms_custom: "",
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
        .select(
          "id, role, email, full_name, company_name, company_website, company_linkedin_url, is_discoverable, bio, location, agency_type, avatar_url, company_logo_url, meeting_url, payment_terms, payment_terms_custom"
        )
        .eq("id", user.id)
        .maybeSingle()
      if (!profile) {
        setLoading(false)
        return
      }
      setForm({
        id: profile.id,
        full_name: profile.full_name || "",
        email: user.email || "",
        company_name: profile.company_name || profile.full_name || "",
        company_website: (profile as { company_website?: string | null }).company_website || "",
        company_linkedin_url: (profile as any).company_linkedin_url || "",
        bio: profile.bio || "",
        location: profile.location || "",
        agency_type: profile.agency_type || "",
        avatar_url: profile.avatar_url || "",
        company_logo_url: (profile as { company_logo_url?: string | null }).company_logo_url || "",
        meeting_url: profile.meeting_url || "",
        is_discoverable: !!profile.is_discoverable,
        payment_terms: (profile as { payment_terms?: string | null }).payment_terms || "net_30",
        payment_terms_custom: (profile as { payment_terms_custom?: string | null }).payment_terms_custom || "",
      })
      if (typeof window !== "undefined") {
        const savedDiscipline = localStorage.getItem("agencyPrimaryDiscipline")
        const savedCaps = localStorage.getItem("agencySelectedCapabilities")
        const savedCustomCaps = localStorage.getItem("agencyCustomCapabilities")
        if (savedDiscipline) setPrimaryDiscipline(savedDiscipline)
        if (savedCaps) setSelectedCapabilities(JSON.parse(savedCaps))
        if (savedCustomCaps) setCustomCapabilities(JSON.parse(savedCustomCaps))
      }
      setLoading(false)
    }
    load()
  }, [router])

  const initAutocomplete = () => {
    if (!locationInputRef.current || autocompleteRef.current) return
    if (!window.google?.maps?.places) return

    const autocomplete = new window.google.maps.places.Autocomplete(locationInputRef.current, {
      types: ["(cities)"],
    })
    autocompleteRef.current = autocomplete

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace()
      const components = place.address_components || []
      const city =
        components.find((c: any) => c.types.includes("locality"))?.long_name?.trim() || ""
      const state =
        components.find((c: any) => c.types.includes("administrative_area_level_1"))?.long_name?.trim() || ""
      const country = components.find((c: any) => c.types.includes("country"))?.long_name?.trim() || ""
      const parts = [city, state, country].filter(Boolean)
      const formatted = parts.join(", ")
      if (formatted) {
        setForm((p) => ({ ...p, location: formatted }))
        if (locationInputRef.current) {
          locationInputRef.current.value = formatted
        }
      }
    })
  }

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return

    if (document.getElementById("google-maps-script")) {
      initAutocomplete()
      setTimeout(initAutocomplete, 500)
      return
    }

    const script = document.createElement("script")
    script.id = "google-maps-script"
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => {
      initAutocomplete()
      setTimeout(initAutocomplete, 500)
    }
    document.head.appendChild(script)

    return () => {
      const ac = autocompleteRef.current
      if (ac && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(ac)
      }
      autocompleteRef.current = null
    }
  }, [loading])

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
        company_name: form.company_name || form.full_name || null,
        company_website: form.company_website || null,
        company_linkedin_url: form.company_linkedin_url || null,
        bio: form.bio,
        location: form.location,
        agency_type: form.agency_type,
        company_logo_url: form.company_logo_url || null,
        meeting_url: form.meeting_url || null,
        is_discoverable: form.is_discoverable,
        payment_terms: form.payment_terms || "net_30",
        payment_terms_custom:
          form.payment_terms === "custom" ? form.payment_terms_custom.trim() || null : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", form.id)
    if (!error && typeof window !== "undefined") {
      localStorage.setItem("agencyPrimaryDiscipline", primaryDiscipline)
      localStorage.setItem("agencySelectedCapabilities", JSON.stringify(selectedCapabilities))
      localStorage.setItem("agencyCustomCapabilities", JSON.stringify(customCapabilities))
    }
    setMessage(error ? error.message : "Agency profile updated.")
    setSaving(false)
  }

  const toggleDiscoverable = async (checked: boolean) => {
    setForm((prev) => ({ ...prev, is_discoverable: checked }))
    if (isDemo || !form.id) return
    const supabase = createClient()
    const { error } = await supabase
      .from("profiles")
      .update({ is_discoverable: checked, updated_at: new Date().toISOString() })
      .eq("id", form.id)
    if (error) {
      setMessage(error.message)
      setForm((prev) => ({ ...prev, is_discoverable: !checked }))
      return
    }
    setMessage("Marketplace discoverability updated.")
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
      setForm((prev) => ({ ...prev, company_logo_url: payload.url || prev.company_logo_url }))
      setMessage("Logo uploaded.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload logo.")
    } finally {
      setUploadingLogo(false)
    }
  }

  if (loading) {
    return (
      <AgencyShell>
        <div className="p-8 flex items-center justify-center text-foreground-muted">Loading profile...</div>
      </AgencyShell>
    )
  }

  const toggleCapability = (cap: string) => {
    setSelectedCapabilities((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]))
  }

  const addCustomCapability = () => {
    const value = customCapability.trim()
    if (!value || capabilities.includes(value) || customCapabilities.includes(value)) return
    setCustomCapabilities((prev) => [...prev, value])
    setSelectedCapabilities((prev) => [...prev, value])
    setCustomCapability("")
  }

  const addCustomDiscipline = () => {
    const value = customDisciplineInput.trim()
    if (!value || allDisciplines.includes(value)) return
    const updated = [...customDisciplines, value]
    setCustomDisciplines(updated)
    if (typeof window !== "undefined") {
      localStorage.setItem("agencyCustomDisciplines", JSON.stringify(updated))
    }
    setPrimaryDiscipline(value)
    setCustomDisciplineInput("")
    setShowCustomDiscipline(false)
  }

  const removeCustomCapability = (cap: string) => {
    setCustomCapabilities((prev) => prev.filter((c) => c !== cap))
    setSelectedCapabilities((prev) => prev.filter((c) => c !== cap))
  }

  return (
    <AgencyShell>
      <div className="p-8 max-w-4xl space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">Agency Profile</h1>
          <p className="text-foreground-muted mt-1">
            Manage your public marketplace profile and company information.
          </p>
        </div>

        <div className="bg-white/5 border border-border/40 rounded-xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Account Full Name</label>
              <Input value={form.full_name} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Account Email</label>
              <Input value={form.email} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-accent/15 overflow-hidden flex items-center justify-center">
              {form.company_logo_url ? (
                <img src={form.company_logo_url} alt="Agency logo" className="w-full h-full object-cover" />
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
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company Website</label>
            <Input
              type="text"
              value={form.company_website}
              onChange={(e) => setForm((p) => ({ ...p, company_website: e.target.value }))}
              placeholder="https://youragency.com"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company LinkedIn URL</label>
            <Input
              type="url"
              value={form.company_linkedin_url}
              onChange={(e) => setForm((p) => ({ ...p, company_linkedin_url: e.target.value }))}
              placeholder="https://linkedin.com/company/your-company"
              className="bg-white/5 border-border text-foreground"
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
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Primary Discipline</label>
            {showCustomDiscipline ? (
              <div className="flex gap-2">
                <Input
                  value={customDisciplineInput}
                  onChange={(e) => setCustomDisciplineInput(e.target.value)}
                  placeholder="Enter custom discipline"
                  className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addCustomDiscipline()
                    }
                  }}
                  autoFocus
                />
                <Button type="button" size="sm" onClick={addCustomDiscipline} className="bg-accent text-accent-foreground hover:bg-accent/90">
                  Add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowCustomDiscipline(false)
                    setCustomDisciplineInput("")
                  }}
                  className="border-border text-foreground hover:bg-white/10"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <select
                value={primaryDiscipline}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setShowCustomDiscipline(true)
                    return
                  }
                  setPrimaryDiscipline(e.target.value)
                }}
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
              >
                {allDisciplines.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value="__custom__">+ Add Custom Discipline</option>
              </select>
            )}
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Company Description / Bio</label>
            <Textarea
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              className="min-h-[120px] bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Capabilities</label>
            <div className="flex flex-wrap gap-2">
              {capabilities.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCapability(cap)}
                  className={
                    selectedCapabilities.includes(cap)
                      ? "px-3 py-1.5 rounded-full text-xs border bg-[#0C3535] text-white border-[#0C3535]"
                      : "px-3 py-1.5 rounded-full text-xs border bg-white text-gray-700 border-gray-200 hover:border-[#0C3535]/40"
                  }
                >
                  {selectedCapabilities.includes(cap) ? "✓ " : ""}
                  {cap}
                </button>
              ))}
              {customCapabilities.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => removeCustomCapability(cap)}
                  className="px-3 py-1.5 rounded-full text-xs border bg-purple-600 text-white border-purple-600"
                >
                  ✓ {cap} ×
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Input
                value={customCapability}
                onChange={(e) => setCustomCapability(e.target.value)}
                placeholder="Add custom capability"
                className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
              <Button type="button" variant="outline" className="border-border text-foreground" onClick={addCustomCapability}>
                Add
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Location</label>
              <input
                ref={locationInputRef}
                defaultValue={form.location || ""}
                onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                placeholder="Start typing a city..."
                autoComplete="off"
                className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">
              Preferred payment terms
            </label>
            <p className="text-xs text-foreground-muted mb-2">
              Used when generating MSA payment schedules (e.g. Net 30 = payment due 30 days after invoice).
            </p>
            <select
              value={form.payment_terms}
              onChange={(e) => setForm((p) => ({ ...p, payment_terms: e.target.value }))}
              className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
            >
              <option value="net_15">Net 15</option>
              <option value="net_30">Net 30</option>
              <option value="net_45">Net 45</option>
              <option value="custom">Custom</option>
            </select>
            {form.payment_terms === "custom" ? (
              <Input
                value={form.payment_terms_custom}
                onChange={(e) => setForm((p) => ({ ...p, payment_terms_custom: e.target.value }))}
                placeholder="Describe your standard payment terms"
                className="mt-2 bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            ) : null}
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-foreground-muted block mb-2">Scheduling Link</label>
            <Input
              value={form.meeting_url}
              onChange={(e) => setForm((p) => ({ ...p, meeting_url: e.target.value }))}
              placeholder="https://calendly.com/your-team/intro"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Paste your Calendly or scheduling link here — partners will see this when you request a meeting.
            </p>
          </div>
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div>
              <div className="text-foreground font-medium">Make my agency discoverable on the Ligament Marketplace</div>
              <p className="text-xs text-foreground-muted mt-1">
                Discoverable agencies can be found by partner agencies and other lead agencies on the platform.
              </p>
            </div>
            <Switch checked={form.is_discoverable} onCheckedChange={toggleDiscoverable} />
          </label>
          {message && <p className="text-sm text-foreground-muted">{message}</p>}
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>
      </div>
    </AgencyShell>
  )
}
