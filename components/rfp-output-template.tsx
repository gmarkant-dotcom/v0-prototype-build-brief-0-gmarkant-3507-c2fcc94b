"use client"

import { useEffect, useRef, useState } from "react"
import { Upload, Sparkles, FileText, Plus, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

export type OutputTemplateMode = "upload" | "ai"
export type TemplateStyle = "formal" | "lean" | "creative"
export type OutputFormat = "section" | "modular"

export type SensitivityOptions = {
  scrubBrand: boolean
  scrubBudget: boolean
  scrubStrategy: boolean
  scrubTimeline: boolean
}

export type UploadedTemplate = { name: string; url: string } | null

export type LibraryTemplateOption = { id: string; name: string }

interface RfpOutputTemplateProps {
  mode: OutputTemplateMode
  onModeChange: (mode: OutputTemplateMode) => void

  /** Pre-existing templates from the agency's Documents Library (optional — omit if N/A). */
  libraryTemplates?: LibraryTemplateOption[]
  selectedLibraryTemplateId?: string | null
  onSelectLibraryTemplate?: (id: string) => void

  uploadedTemplate: UploadedTemplate
  onFileSelect: (file: File) => void
  onRemoveUploadedTemplate: () => void
  isUploadingTemplate: boolean
  uploadError: string | null
  extractWarning: string | null

  templateStyle: TemplateStyle
  onTemplateStyleChange: (style: TemplateStyle) => void
  sensitivity: SensitivityOptions
  onSensitivityChange: (key: keyof SensitivityOptions, value: boolean) => void
  outputFormat: OutputFormat
  onOutputFormatChange: (format: OutputFormat) => void
  isGenerating: boolean
  onGenerate: () => void
  generateError: string | null
  /** The extracted (upload) or streamed (AI) template text, used to show the "ready" status. */
  generatedTemplateText: string
  /** True once AI generation has completed successfully; controls the status box styling. */
  isTemplateReady: boolean
}

const TEMPLATE_STYLE_OPTIONS: { id: TemplateStyle; label: string }[] = [
  { id: "formal", label: "Formal / structured" },
  { id: "lean", label: "Lean / conversational" },
  { id: "creative", label: "Creative agency style" },
]

export function RfpOutputTemplate({
  mode,
  onModeChange,
  libraryTemplates = [],
  selectedLibraryTemplateId = null,
  onSelectLibraryTemplate,
  uploadedTemplate,
  onFileSelect,
  onRemoveUploadedTemplate,
  isUploadingTemplate,
  uploadError,
  extractWarning,
  templateStyle,
  onTemplateStyleChange,
  sensitivity,
  onSensitivityChange,
  outputFormat,
  onOutputFormatChange,
  isGenerating,
  onGenerate,
  generateError,
  generatedTemplateText,
  isTemplateReady,
}: RfpOutputTemplateProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showSlowMessage, setShowSlowMessage] = useState(false)

  // Generation can legitimately take 30-90s+ — surface a visible "still working" message
  // instead of leaving the user staring at a spinner with no signal it hasn't stalled.
  useEffect(() => {
    if (!isGenerating) {
      setShowSlowMessage(false)
      return
    }
    const timer = setTimeout(() => setShowSlowMessage(true), 30_000)
    return () => clearTimeout(timer)
  }, [isGenerating])

  const triggerFilePicker = () => {
    onModeChange("upload")
    fileInputRef.current?.click()
  }

  const sensitivityRows: { key: keyof SensitivityOptions; label: string }[] = [
    { key: "scrubBrand", label: "Scrub client brand name → industry category" },
    { key: "scrubBudget", label: "Scrub budget figures → tier description" },
    { key: "scrubStrategy", label: "Scrub campaign-specific strategy → generic workstreams" },
    { key: "scrubTimeline", label: "Scrub timeline dates → relative phases" },
  ]

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) onFileSelect(file)
        }}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={triggerFilePicker}
          className={cn(
            "font-mono text-xs px-3 py-2 rounded-lg border transition-colors flex items-center gap-2",
            mode === "upload"
              ? "border-accent bg-accent/10 text-foreground"
              : "border-border text-foreground-muted hover:border-white/30"
          )}
        >
          <Upload className="w-3.5 h-3.5" />
          Upload file
        </button>
        <button
          type="button"
          onClick={() => onModeChange("ai")}
          className={cn(
            "font-mono text-xs px-3 py-2 rounded-lg border transition-colors flex items-center gap-2",
            mode === "ai"
              ? "border-accent bg-accent/10 text-foreground"
              : "border-border text-foreground-muted hover:border-white/30"
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Generate with AI
        </button>
      </div>

      <div className="mt-4">
        {mode === "upload" ? (
          <div className="space-y-2">
            {libraryTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelectLibraryTemplate?.(template.id)}
                className={cn(
                  "w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3",
                  selectedLibraryTemplateId === template.id
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-white/30"
                )}
              >
                <FileText className="w-5 h-5 text-blue-400" />
                <div className="flex-1">
                  <div className="font-display font-bold text-sm text-foreground">{template.name}</div>
                  <div className="font-mono text-[10px] text-foreground-muted">From Documents Library</div>
                </div>
                {selectedLibraryTemplateId === template.id && <Check className="w-4 h-4 text-accent" />}
              </button>
            ))}

            {uploadedTemplate && (
              <div className="space-y-2">
                <div className="w-full text-left p-3 rounded-lg border border-accent bg-accent/10 flex items-center gap-3">
                  <FileText className="w-5 h-5 text-green-400" />
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-sm text-foreground truncate">{uploadedTemplate.name}</div>
                    <div className="font-mono text-[10px] text-foreground-muted">
                      {generatedTemplateText
                        ? `Format loaded — ${generatedTemplateText.length.toLocaleString()} characters`
                        : "No readable format text"}
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-accent shrink-0" />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-foreground-muted hover:text-foreground h-8"
                  onClick={onRemoveUploadedTemplate}
                >
                  Remove template
                </Button>
              </div>
            )}

            <label
              onClick={triggerFilePicker}
              className="w-full text-left p-3 rounded-lg border border-dashed border-border hover:border-accent/50 transition-colors flex items-center gap-3 cursor-pointer"
            >
              {isUploadingTemplate ? (
                <>
                  <Loader2 className="w-5 h-5 text-accent animate-spin" />
                  <span className="font-mono text-xs text-accent">Reading template…</span>
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5 text-foreground-muted" />
                  <span className="font-mono text-xs text-foreground-muted">Upload output template</span>
                </>
              )}
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-border/60 text-foreground-muted"
              disabled={isUploadingTemplate}
              onClick={triggerFilePicker}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Choose file…
            </Button>
            {uploadError && (
              <div role="alert" className="rounded-lg border border-red-400/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {uploadError}
              </div>
            )}
            {extractWarning && !uploadError && <p className="text-xs text-amber-300 px-1">{extractWarning}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="font-mono text-[10px] text-foreground-muted uppercase block">Template style</span>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onTemplateStyleChange(opt.id)}
                    className={cn(
                      "font-mono text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors",
                      templateStyle === opt.id
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border text-foreground-muted hover:border-white/30"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-mono text-[10px] text-foreground-muted uppercase block">Sensitivity (optional)</span>
              <div className="space-y-2">
                {sensitivityRows.map((row) => (
                  <label
                    key={row.key}
                    className="flex items-start gap-2 cursor-pointer font-mono text-[11px] text-foreground/90 leading-snug"
                  >
                    <Checkbox
                      checked={sensitivity[row.key]}
                      onCheckedChange={(v) => onSensitivityChange(row.key, v === true)}
                      className="mt-0.5 border-border"
                    />
                    <span>{row.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-mono text-[10px] text-foreground-muted uppercase block">Output format</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOutputFormatChange("section")}
                  className={cn(
                    "font-mono text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors",
                    outputFormat === "section"
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border text-foreground-muted hover:border-white/30"
                  )}
                >
                  Section-based RFP
                </button>
                <button
                  type="button"
                  onClick={() => onOutputFormatChange("modular")}
                  className={cn(
                    "font-mono text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors",
                    outputFormat === "modular"
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border text-foreground-muted hover:border-white/30"
                  )}
                >
                  Modular workstreams
                </button>
              </div>
            </div>

            <Button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="bg-accent text-accent-foreground hover:bg-accent/90 w-full sm:w-auto"
            >
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Generate template
                </span>
              )}
            </Button>
            {isGenerating && showSlowMessage && (
              <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                <p className="font-mono text-[10px] text-foreground-muted">
                  Still generating — this may take a moment…
                </p>
              </div>
            )}
            {generateError && (
              <div role="alert" className="rounded-lg border border-red-400/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {generateError}
              </div>
            )}
            {generatedTemplateText.trim() && (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 flex items-center gap-2",
                  isTemplateReady ? "border-success/40 bg-success/10" : "border-border bg-white/5"
                )}
              >
                {isTemplateReady && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
                <p className="font-mono text-[10px] text-foreground-muted">
                  {isTemplateReady
                    ? `Template ready — ${generatedTemplateText.length.toLocaleString()} characters loaded`
                    : `AI format loading — ${generatedTemplateText.length.toLocaleString()} characters so far`}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
