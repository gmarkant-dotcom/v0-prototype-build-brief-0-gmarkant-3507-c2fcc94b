"use client"

import { useState, useRef } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Upload, X, FileText, Loader2, CheckCircle, AlertCircle } from "lucide-react"

interface UploadedFile {
  url: string
  pathname: string
  filename: string
  size: number
  contentType: string
}

interface FileUploadProps {
  currentUrl?: string
  onUploadComplete?: (file: UploadedFile) => void
  onUploadError?: (error: string) => void
  folder?: string
  accept?: string
  maxSize?: number // in MB
  maxSizeMB?: number
  allowedTypes?: string[]
  className?: string
  variant?: "default" | "compact" | "dropzone"
  label?: string
  description?: string
}

export function FileUpload({
  currentUrl,
  onUploadComplete,
  onUploadError,
  folder = "documents",
  accept = ".pdf,.docx,.pptx",
  maxSize = 10,
  maxSizeMB,
  allowedTypes,
  className,
  variant = "default",
  label = "Upload File",
  description = "Drag and drop or click to browse",
}: FileUploadProps) {
  void currentUrl
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<"idle" | "uploading" | "success" | "error">("idle")
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const effectiveMaxSizeMB = maxSizeMB ?? maxSize

  const formatAllowedTypesLabel = (types: string[]) => {
    const labels = types.map((type) => {
      if (type === "image/jpeg") return "JPEG"
      if (type === "image/png") return "PNG"
      if (type === "image/webp") return "WebP"
      if (type === "image/gif") return "GIF"
      return type
    })
    if (labels.length <= 1) return labels[0] || "specified file types"
    if (labels.length === 2) return `${labels[0]} or ${labels[1]}`
    return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFile(files[0])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFile(files[0])
    }
  }

  const handleFile = async (file: File) => {
    if (Array.isArray(allowedTypes) && allowedTypes.length > 0) {
      const isAllowed = allowedTypes.includes(file.type)
      if (!isAllowed) {
        const msg =
          allowedTypes.every((type) => type.startsWith("image/"))
            ? `Only ${formatAllowedTypesLabel(allowedTypes)} images are allowed`
            : `Only ${formatAllowedTypesLabel(allowedTypes)} files are allowed`
        setErrorMessage(msg)
        setUploadProgress("error")
        onUploadError?.(msg)
        return
      }
    }

    // Validate file size
    if (file.size > effectiveMaxSizeMB * 1024 * 1024) {
      setErrorMessage(`File size must be less than ${effectiveMaxSizeMB}MB`)
      setUploadProgress("error")
      onUploadError?.(`File size must be less than ${effectiveMaxSizeMB}MB`)
      return
    }

    setIsUploading(true)
    setUploadProgress("uploading")
    setUploadedFileName(file.name)
    setErrorMessage(null)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", folder)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Upload failed")
      }

      const result = await response.json()
      setUploadProgress("success")
      onUploadComplete?.(result)
      
      // Reset after success
      setTimeout(() => {
        setUploadProgress("idle")
        setUploadedFileName(null)
      }, 2000)
    } catch (error) {
      console.error("Upload error:", error)
      setUploadProgress("error")
      const msg = error instanceof Error ? error.message : "Upload failed. Please try again."
      setErrorMessage(msg)
      onUploadError?.(msg)
    } finally {
      setIsUploading(false)
      // Reset input
      if (inputRef.current) {
        inputRef.current.value = ""
      }
    }
  }

  const resetUpload = () => {
    setUploadProgress("idle")
    setUploadedFileName(null)
    setErrorMessage(null)
  }

  if (variant === "compact") {
    return (
      <div className={cn("relative", className)}>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          disabled={isUploading}
        />
        <Button
          type="button"
          variant="outline"
          className="border-border text-foreground hover:bg-white/5"
          disabled={isUploading}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              {label}
            </>
          )}
        </Button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative border-2 border-dashed rounded-xl p-6 transition-colors",
        isDragging
          ? "border-accent bg-accent/10"
          : "border-border hover:border-accent/50",
        uploadProgress === "success" && "border-success bg-success/10",
        uploadProgress === "error" && "border-red-500 bg-red-500/10",
        className
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        disabled={isUploading}
      />

      <div className="flex flex-col items-center justify-center text-center">
        {uploadProgress === "idle" && (
          <>
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mb-3">
              <Upload className="w-6 h-6 text-accent" />
            </div>
            <div className="font-display font-bold text-foreground mb-1">{label}</div>
            <div className="font-mono text-xs text-foreground-muted mb-2">{description}</div>
            <div className="font-mono text-[10px] text-foreground-muted">
              Max {effectiveMaxSizeMB}MB
            </div>
          </>
        )}

        {uploadProgress === "uploading" && (
          <>
            <Loader2 className="w-10 h-10 text-accent animate-spin mb-3" />
            <div className="font-display font-bold text-foreground mb-1">Uploading...</div>
            <div className="font-mono text-xs text-foreground-muted truncate max-w-full">
              {uploadedFileName}
            </div>
          </>
        )}

        {uploadProgress === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-3">
              <CheckCircle className="w-6 h-6 text-success" />
            </div>
            <div className="font-display font-bold text-success mb-1">Upload Complete</div>
            <div className="font-mono text-xs text-foreground-muted truncate max-w-full">
              {uploadedFileName}
            </div>
          </>
        )}

        {uploadProgress === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <div className="font-display font-bold text-red-400 mb-1">Upload Failed</div>
            <div className="font-mono text-xs text-red-400 mb-2">{errorMessage}</div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="relative z-20 border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={(e) => {
                e.stopPropagation()
                resetUpload()
              }}
            >
              Try Again
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// Simple inline upload for lists
export function InlineFileUpload({
  onUploadComplete,
  folder = "documents",
  accept = ".pdf,.docx,.pptx",
  className,
}: {
  onUploadComplete?: (file: UploadedFile) => void
  folder?: string
  accept?: string
  className?: string
}) {
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    const file = files[0]

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", folder)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Upload failed")
      }

      const result = await response.json()
      onUploadComplete?.(result)
    } catch (error) {
      console.error("Upload error:", error)
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <label className={cn("relative cursor-pointer", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        className="sr-only"
        disabled={isUploading}
      />
      <span className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-colors",
        isUploading 
          ? "bg-accent/20 text-accent" 
          : "bg-white/5 text-foreground/90 hover:text-foreground hover:bg-white/10"
      )}>
        {isUploading ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="w-3 h-3" />
            Upload
          </>
        )}
      </span>
    </label>
  )
}
