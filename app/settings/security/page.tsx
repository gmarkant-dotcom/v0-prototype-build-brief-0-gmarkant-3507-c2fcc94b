"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { SettingsLayout } from "@/components/settings-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Shield, Key, LogOut, Eye, EyeOff, Smartphone, Check, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import Image from "next/image"

export default function SecuritySettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<"agency" | "partner">("agency")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPasswords, setShowPasswords] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  
  // MFA State
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [showMfaSetup, setShowMfaSetup] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState("")
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaMessage, setMfaMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()

      if (data?.role) setUserRole(data.role)
      
      // Check if MFA is already enabled
      const { data: factors } = await supabase.auth.mfa.listFactors()
      if (factors?.totp && factors.totp.length > 0) {
        const verifiedFactor = factors.totp.find(f => f.status === "verified")
        if (verifiedFactor) {
          setMfaEnabled(true)
          setFactorId(verifiedFactor.id)
        }
      }
      
      setLoading(false)
    }

    loadUser()
  }, [router])

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match" })
      return
    }

    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "Password must be at least 8 characters" })
      return
    }

    setSaving(true)
    setMessage(null)

    const supabase = createClient()
    
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      setMessage({ type: "error", text: error.message })
    } else {
      setMessage({ type: "success", text: "Password updated successfully" })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    }

    setSaving(false)
  }

  const handleEnrollMfa = async () => {
    setMfaLoading(true)
    setMfaMessage(null)
    
    const supabase = createClient()
    
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator App"
    })
    
    if (error) {
      setMfaMessage({ type: "error", text: error.message })
      setMfaLoading(false)
      return
    }
    
    if (data) {
      setQrCode(data.totp.qr_code)
      setSecret(data.totp.secret)
      setFactorId(data.id)
      setShowMfaSetup(true)
    }
    
    setMfaLoading(false)
  }

  const handleVerifyMfa = async () => {
    if (!factorId || verifyCode.length !== 6) return
    
    setMfaLoading(true)
    setMfaMessage(null)
    
    const supabase = createClient()
    
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId
    })
    
    if (challengeError) {
      setMfaMessage({ type: "error", text: challengeError.message })
      setMfaLoading(false)
      return
    }
    
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: verifyCode
    })
    
    if (verifyError) {
      setMfaMessage({ type: "error", text: "Invalid code. Please try again." })
      setMfaLoading(false)
      return
    }
    
    setMfaEnabled(true)
    setShowMfaSetup(false)
    setQrCode(null)
    setSecret(null)
    setVerifyCode("")
    setMfaMessage({ type: "success", text: "Two-factor authentication enabled successfully!" })
    setMfaLoading(false)
  }

  const handleDisableMfa = async () => {
    if (!factorId) return
    
    setMfaLoading(true)
    setMfaMessage(null)
    
    const supabase = createClient()
    
    const { error } = await supabase.auth.mfa.unenroll({
      factorId
    })
    
    if (error) {
      setMfaMessage({ type: "error", text: error.message })
      setMfaLoading(false)
      return
    }
    
    setMfaEnabled(false)
    setFactorId(null)
    setMfaMessage({ type: "success", text: "Two-factor authentication disabled." })
    setMfaLoading(false)
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
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
    <SettingsLayout userRole={userRole}>
      <div className="space-y-8">
        <div>
          <h2 className="font-display font-black text-2xl text-foreground mb-2">Security</h2>
          <p className="text-foreground-muted">Manage your password and security settings.</p>
        </div>

        {/* Two-Factor Authentication */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-border/30">
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-accent" />
            </div>
            <div className="flex-1">
              <div className="font-display font-bold text-foreground">Two-Factor Authentication</div>
              <div className="text-foreground-muted text-sm">Add an extra layer of security to your account</div>
            </div>
            {mfaEnabled && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30">
                <Check className="w-4 h-4 text-green-400" />
                <span className="font-mono text-xs text-green-400">Enabled</span>
              </div>
            )}
          </div>

          {mfaMessage && (
            <div className={cn(
              "p-3 rounded-lg text-sm",
              mfaMessage.type === "success" 
                ? "bg-green-500/10 border border-green-500/30 text-green-400"
                : "bg-red-500/10 border border-red-500/30 text-red-400"
            )}>
              {mfaMessage.text}
            </div>
          )}

          {!mfaEnabled && !showMfaSetup && (
            <div className="space-y-4">
              <p className="text-foreground-secondary text-sm">
                Two-factor authentication adds an extra layer of security by requiring a code from your 
                authenticator app in addition to your password when signing in.
              </p>
              <Button 
                onClick={handleEnrollMfa}
                disabled={mfaLoading}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {mfaLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Smartphone className="w-4 h-4 mr-2" />
                    Enable Two-Factor Authentication
                  </>
                )}
              </Button>
            </div>
          )}

          {showMfaSetup && qrCode && (
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-display font-bold text-foreground">Step 1: Scan QR Code</h4>
                  <p className="text-foreground-muted text-sm">
                    Open your authenticator app (Google Authenticator, Authy, 1Password, etc.) and scan this QR code.
                  </p>
                  <div className="bg-white p-4 rounded-xl w-fit">
                    <Image 
                      src={qrCode} 
                      alt="MFA QR Code" 
                      width={200} 
                      height={200}
                      className="w-48 h-48"
                    />
                  </div>
                  {secret && (
                    <div className="space-y-2">
                      <p className="text-foreground-muted text-xs">Can&apos;t scan? Enter this code manually:</p>
                      <code className="block p-2 bg-white/5 rounded-lg font-mono text-xs text-foreground break-all">
                        {secret}
                      </code>
                    </div>
                  )}
                </div>
                
                <div className="space-y-4">
                  <h4 className="font-display font-bold text-foreground">Step 2: Enter Verification Code</h4>
                  <p className="text-foreground-muted text-sm">
                    Enter the 6-digit code from your authenticator app to verify setup.
                  </p>
                  <div>
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="bg-white/5 border-border/30 text-foreground text-center text-2xl tracking-[0.5em] font-mono"
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowMfaSetup(false)
                        setQrCode(null)
                        setSecret(null)
                        setVerifyCode("")
                      }}
                      className="flex-1 border-border/30 text-foreground hover:bg-white/10"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancel
                    </Button>
                    <Button
                      onClick={handleVerifyMfa}
                      disabled={mfaLoading || verifyCode.length !== 6}
                      className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      {mfaLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Verify & Enable
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mfaEnabled && !showMfaSetup && (
            <div className="space-y-4">
              <p className="text-foreground-secondary text-sm">
                Two-factor authentication is enabled. You&apos;ll need to enter a code from your authenticator 
                app each time you sign in.
              </p>
              <Button 
                variant="outline"
                onClick={handleDisableMfa}
                disabled={mfaLoading}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                {mfaLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Disabling...
                  </>
                ) : (
                  "Disable Two-Factor Authentication"
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Change Password */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-border/30">
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <Key className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="font-display font-bold text-foreground">Change Password</div>
              <div className="text-foreground-muted text-sm">Update your account password</div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Current Password
              </label>
              <div className="relative">
                <Input
                  type={showPasswords ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="bg-white/5 border-border/30 text-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(!showPasswords)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
                >
                  {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  New Password
                </label>
                <Input
                  type={showPasswords ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  Confirm New Password
                </label>
                <Input
                  type={showPasswords ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-white/5 border-border/30 text-foreground"
                />
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
                onClick={handleChangePassword}
                disabled={saving || !newPassword || !confirmPassword}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {saving ? "Updating..." : "Update Password"}
              </Button>
            </div>
          </div>
        </div>

        {/* Sign Out */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="font-display font-bold text-foreground">Sign Out</div>
                <div className="text-foreground-muted text-sm">Sign out of your account on this device</div>
              </div>
            </div>
            <Button 
              variant="outline"
              onClick={handleSignOut}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </SettingsLayout>
  )
}
