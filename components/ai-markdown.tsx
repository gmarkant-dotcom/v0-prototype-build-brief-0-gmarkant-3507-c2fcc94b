"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

/** Renders AI-generated markdown (headers, bold, lists, tables) styled against this
 *  app's dark theme tokens - used for bid analysis narratives (summaries, cost
 *  breakdown notes, comparison narratives) instead of dumping raw markdown text. */
export function AiMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="font-display font-bold text-base text-foreground mt-3 first:mt-0">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="font-display font-bold text-sm text-foreground mt-3 first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="font-display font-bold text-sm text-foreground mt-2 first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="text-sm text-foreground/90 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 text-sm text-foreground/90 pl-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 text-sm text-foreground/90 pl-1">{children}</ol>
          ),
          li: ({ children }) => <li className="text-sm text-foreground/90">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="font-mono text-xs bg-white/10 text-foreground px-1 py-0.5 rounded">{children}</code>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/5 border-b border-border/40">{children}</thead>,
          th: ({ children }) => (
            <th className="text-left font-mono text-[10px] uppercase tracking-wider text-foreground-muted px-3 py-2">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-foreground border-t border-border/20 align-top">{children}</td>
          ),
          hr: () => <hr className="border-border/30 my-2" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
