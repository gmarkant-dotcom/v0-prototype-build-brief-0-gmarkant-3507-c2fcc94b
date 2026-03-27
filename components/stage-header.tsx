import { cn } from "@/lib/utils"

interface StageHeaderProps {
  stageNumber: string
  totalStages?: string
  title: string
  subtitle?: string
  aiPowered?: boolean
  className?: string
}

export function StageHeader({ 
  stageNumber, 
  totalStages = "06",
  title, 
  subtitle,
  aiPowered = false,
  className 
}: StageHeaderProps) {
  return (
    <div className={cn("mb-8", className)}>
      <div className="flex items-center gap-4 mb-3">
        <span className="font-mono text-xs text-foreground-muted">
          {stageNumber} / {totalStages}
        </span>
        {aiPowered && (
          <span className="font-mono text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/30 flex items-center gap-1">
            <span className="ai-badge">✦</span> AI-powered
          </span>
        )}
      </div>
      <h1 className="font-display font-black text-4xl md:text-5xl text-foreground leading-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-3 font-sans text-sm text-foreground-muted max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  )
}
