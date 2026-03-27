import { cn } from "@/lib/utils"

interface GlassCardProps {
  children: React.ReactNode
  className?: string
  highlight?: boolean
  onClick?: (e: React.MouseEvent) => void
}

export function GlassCard({ children, className, highlight = false, onClick }: GlassCardProps) {
  return (
    <div 
      className={cn(
        "glass-card rounded-xl p-5",
        highlight && "border-accent/40 bg-accent/5",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

interface GlassCardHeaderProps {
  label?: string
  title: string
  description?: string
  badge?: string
  className?: string
}

export function GlassCardHeader({ label, title, description, badge, className }: GlassCardHeaderProps) {
  return (
    <div className={cn("mb-4", className)}>
      {label && (
        <div className="font-mono text-[10px] text-accent tracking-wider uppercase mb-2">
          {label}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display font-bold text-xl text-foreground">
          {title}
        </h3>
        {badge && (
          <span className="font-mono text-[10px] text-foreground-muted bg-white/10 px-2 py-0.5 rounded-full shrink-0">
            {badge}
          </span>
        )}
      </div>
      {description && (
        <p className="text-sm text-foreground-muted mt-2 leading-relaxed">
          {description}
        </p>
      )}
    </div>
  )
}
