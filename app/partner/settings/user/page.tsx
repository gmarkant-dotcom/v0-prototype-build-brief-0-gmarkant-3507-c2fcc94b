"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { createClient } from "@/lib/supabase/client"
import { FileUpload } from "@/components/file-upload"

export default function PartnerUserProfilePage() {
  const router = useRouter()
  const hasUploaded = useRef(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [userId, setUserId] = useState("")
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [initialFullName, setInitialFullName] = useState("")
  const [initialDisplayName, setInitialDisplayName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [initialAvatarUrl, setInitialAvatarUrl] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [notificationPrefs, setNotificationPrefs] = useState({
    newBidReceived: true,
    partnerInvitationAccepted: true,
    projectUpdate: true,
    platformAnnouncements: true,
  })

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fpartner%2Fsettings%2Fuser")
        return
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role, full_name, display_name, avatar_url, notification_preferences")
        .eq("id", user.id)
        .maybeSingle()
      setUserId(user.id)
      setEmail(user.email || "")
      setFullName(profile?.full_name || (user.user_metadata?.full_name as string) || "")
      setDisplayName((profile as any)?.display_name || profile?.full_name || (user.user_metadata?.full_name as string) || "")
      setInitialFullName(profile?.full_name || (user.user_metadata?.full_name as string) || "")
      setInitialDisplayName((profile as any)?.display_name || profile?.full_name || (user.user_metadata?.full_name as string) || "")
      const loadedAvatarUrl = (profile as any)?.avatar_url || ""
      if (!hasUploaded.current) {
        setAvatarUrl(loadedAvatarUrl)
      }
      setInitialAvatarUrl(loadedAvatarUrl)
      const storedPrefs = localStorage.getItem(`notification-prefs-${user.id}`)
      const dbPrefs = (profile as any)?.notification_preferences
      if (dbPrefs && typeof dbPrefs === "object") {
        setNotificationPrefs((prev) => ({ ...prev, ...dbPrefs }))
      } else if (storedPrefs) {
        setNotificationPrefs((prev) => ({ ...prev, ...JSON.parse(storedPrefs) }))
      }
      setLoading(false)
    }
    load()
  }, [router])

  const saveAccountInformation = async () => {
    setSaving(true)
    setErrorMessage(null)
    setMessage(null)
    const supabase = createClient()
    const payload = {
      full_name: fullName,
      display_name: displayName,
      notification_preferences: notificationPrefs,
      updated_at: new Date().toISOString(),
    }
    const { error: profileErr } = await supabase.from("profiles").update(payload as any).eq("id", userId)
    if (profileErr) {
      const { error: fallbackErr } = await supabase
        .from("profiles")
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq("id", userId)
      if (fallbackErr) {
        setErrorMessage(fallbackErr.message)
        setSaving(false)
        return
      }
    }
    localStorage.setItem(`notification-prefs-${userId}`, JSON.stringify(notificationPrefs))
    setMessage("Account information and notification preferences saved.")
    setSaving(false)
  }

  const savePassword = async () => {
    setPasswordSaving(true)
    setErrorMessage(null)
    setMessage(null)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setErrorMessage("Please complete all password fields.")
      setPasswordSaving(false)
      return
    }
    if (newPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters.")
      setPasswordSaving(false)
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("New password and confirmation must match.")
      setPasswordSaving(false)
      return
    }
    const supabase = createClient()
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (authErr) {
      setErrorMessage("Current password is incorrect.")
      setPasswordSaving(false)
      return
    }
    const { error: passErr } = await supabase.auth.updateUser({ password: newPassword })
    if (passErr) {
      setErrorMessage(passErr.message)
      setPasswordSaving(false)
      return
    }
    setMessage("Password updated successfully.")
    setCurrentPassword("")
    setPasswordSaving(false)
    setNewPassword("")
    setConfirmPassword("")
  }

  const saveProfileSettings = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setErrorMessage(null)
    setMessage(null)
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          display_name: displayName.trim(),
          avatar_url: avatarUrl.trim() || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update settings.")
      }
      const nextProfile = payload?.profile
      const nextFullName = String(nextProfile?.full_name || fullName).trim()
      const nextDisplayName = String(nextProfile?.display_name || displayName).trim()
      setFullName(nextFullName)
      setDisplayName(nextDisplayName)
      setInitialFullName(nextFullName)
      setInitialDisplayName(nextDisplayName)
      setInitialAvatarUrl(avatarUrl.trim())
      if (typeof window !== "undefined" && (window as any).__ligamentRefreshAvatar) {
        ;(window as any).__ligamentRefreshAvatar()
      }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update settings.")
    } finally {
      setSaving(false)
    }
  }

  const hasSettingsChanges =
    fullName.trim() !== initialFullName.trim() ||
    displayName.trim() !== initialDisplayName.trim() ||
    avatarUrl.trim() !== initialAvatarUrl.trim()

  if (loading) {
    return (
      <PartnerLayout>
        <div className="max-w-3xl mx-auto p-8 text-gray-600">Loading user profile...</div>
      </PartnerLayout>
    )
  }

  return (
    <PartnerLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-[#0C3535]">User Profile</h1>
          <p className="text-gray-600 mt-1">Manage your personal account information.</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-[#0C3535]">Account Information</h2>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Full Name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-white border-gray-200 text-gray-900" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Display Name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-white border-gray-200 text-gray-900"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Email</label>
            <Input value={email} readOnly className="bg-gray-100 border-gray-200 text-gray-700" />
            <p className="mt-1 text-xs text-gray-600">Read-only, email changes are managed through account auth.</p>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Profile Photo</label>
            <FileUpload
              currentUrl={avatarUrl}
              allowedTypes={["image/jpeg", "image/png", "image/webp", "image/gif"]}
              accept="image/jpeg,image/png,image/webp,image/gif"
              maxSizeMB={5}
              onUploadComplete={(file) => {
                console.log("[avatar upload] response:", file)
                const nextUrl = file?.url || ""
                if (nextUrl) {
                  hasUploaded.current = true
                  setAvatarUrl(nextUrl)
                  setMessage(null)
                  setErrorMessage(null)
                }
              }}
              folder="avatars"
            />
            {avatarUrl ? (
              <div className="mt-3 flex items-center gap-3">
                <div style={{
                  width: 64, height: 64, borderRadius: "50%",
                  background: "#1a2e26", border: "2px solid #639922",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0
                }}>
                  <span style={{ color: "#639922", fontSize: 22, fontWeight: 600 }}>
                    {(fullName || displayName || "U").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p style={{ color: "#639922", fontSize: 13, fontWeight: 500, margin: 0 }}>
                    Photo uploaded
                  </p>
                  <p style={{ color: "var(--foreground-muted)", fontSize: 11, margin: "2px 0 0" }}>
                    Save Changes to apply
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-end">
            <Button onClick={saveProfileSettings} disabled={saving || !hasSettingsChanges} className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            {saveSuccess && (
              <p style={{ color: "#639922", fontSize: "14px", marginTop: "8px" }}>
                Settings saved
              </p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-[#0C3535]">Password & Security</h2>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Current Password</label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase text-gray-500 block mb-2">Confirm New Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={savePassword} disabled={passwordSaving} className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
              {passwordSaving ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-[#0C3535]">Notification Preferences</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Email me when a new bid is received</span>
              <Switch
                checked={notificationPrefs.newBidReceived}
                onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, newBidReceived: checked }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Email me when a partner invitation is accepted</span>
              <Switch
                checked={notificationPrefs.partnerInvitationAccepted}
                onCheckedChange={(checked) =>
                  setNotificationPrefs((prev) => ({ ...prev, partnerInvitationAccepted: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Email me on project updates</span>
              <Switch
                checked={notificationPrefs.projectUpdate}
                onCheckedChange={(checked) => setNotificationPrefs((prev) => ({ ...prev, projectUpdate: checked }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Email me platform announcements</span>
              <Switch
                checked={notificationPrefs.platformAnnouncements}
                onCheckedChange={(checked) =>
                  setNotificationPrefs((prev) => ({ ...prev, platformAnnouncements: checked }))
                }
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveAccountInformation} disabled={saving} className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
              {saving ? "Saving..." : "Save Preferences"}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-red-200 p-6 space-y-4">
          <h2 className="font-display font-bold text-lg text-[#0C3535]">Danger Zone</h2>
          <p className="text-sm text-gray-600">Account deletion is handled manually by support for security purposes.</p>
          <Button disabled variant="outline" title="Contact support to delete your account">
            Delete Account
          </Button>
        </div>

        {message && <p className="text-sm text-green-700">{message}</p>}
        {errorMessage && <p className="text-sm text-red-700">{errorMessage}</p>}
      </div>
    </PartnerLayout>
  )
}
