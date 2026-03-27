"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { DashboardLayout } from "@/components/dashboard-layout"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type AITool = "rfp" | "scorer" | "onboarding" | "update"

interface Tool {
  id: AITool
  name: string
  description: string
  quickChips: string[]
  placeholder: string
}

const tools: Tool[] = [
  {
    id: "rfp",
    name: "RFP Drafter",
    description: "Generate sanitized professional RFPs. Client identity and budget masked.",
    quickChips: ["Video Production Partner", "Social Media Agency", "Event Production Company"],
    placeholder: "Describe the discipline you need, the type of work, timeline expectations, and any specific requirements..."
  },
  {
    id: "scorer",
    name: "Bid Scorer",
    description: "Evaluate vendor bids using weighted criteria: Experience (25%), Team (20%), Approach (20%), Timeline (20%), Budget (15%).",
    quickChips: ["Paste full bid response", "Include proposed team", "Include timeline and budget"],
    placeholder: "Paste the vendor's bid response here. Include their proposed approach, team, timeline, and budget...\n\nScoring Criteria:\n• Relevant Experience: 25 points (25%)\n• Team Quality: 20 points (20%)\n• Creative Approach: 20 points (20%)\n• Timeline Realism: 20 points (20%)\n• Value for Budget: 15 points (15%)"
  },
  {
    id: "onboarding",
    name: "Onboarding Generator",
    description: "Create vendor onboarding packets with brand rules and ways of working.",
    quickChips: ["Video Production Vendor", "Social Media Partner", "Talent Agency"],
    placeholder: "Vendor name, discipline, engagement details, project context, and any specific requirements..."
  },
  {
    id: "update",
    name: "Client Update Generator",
    description: "Transform raw internal status into polished client-facing updates.",
    quickChips: ["Weekly status", "Milestone completion", "Issue resolution"],
    placeholder: "What actually happened this week — raw and unfiltered. Include any issues, delays, or challenges..."
  },
]

function AIToolPanel({ tool }: { tool: Tool }) {
  const [input, setInput] = useState("")
  
  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ 
      api: "/api/ai",
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages, tool: tool.id }
      })
    }),
    id: tool.id,
  })
  
  const isLoading = status === "streaming" || status === "submitted"
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput("")
  }
  
  const handleChipClick = (chip: string) => {
    setInput(prev => prev ? `${prev}\n\n${chip}` : chip)
  }
  
  const handleClear = () => {
    setMessages([])
    setInput("")
  }
  
  const lastAssistantMessage = messages
    .filter(m => m.role === "assistant")
    .pop()
  
  const responseText = lastAssistantMessage?.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map(p => p.text)
    .join("") || ""
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
      {/* Input Panel */}
      <GlassCard className="flex flex-col h-[600px]">
        <GlassCardHeader
          label="Input"
          title={tool.name}
          description={tool.description}
        />
        
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tool.placeholder}
            className="flex-1 min-h-[200px] bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 resize-none"
          />
          
          <div className="flex flex-wrap gap-2 mt-3">
            {tool.quickChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => handleChipClick(chip)}
                className="font-mono text-[10px] px-3 py-1 rounded-full border border-border text-foreground-muted hover:border-accent hover:text-accent transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
          
          <div className="flex gap-2 mt-4">
            <Button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="ai-badge">✦</span> Processing...
                </span>
              ) : (
                <>
                  <span className="mr-2">✦</span> Generate
                </>
              )}
            </Button>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleClear}
                className="border-border text-foreground-muted hover:text-foreground bg-transparent"
              >
                Clear
              </Button>
            )}
          </div>
        </form>
      </GlassCard>
      
      {/* Output Panel */}
      <GlassCard className="flex flex-col h-[600px]">
        <GlassCardHeader
          label="AI Output"
          title="Generated Content"
          badge={isLoading ? "Streaming" : responseText ? "Complete" : "Waiting"}
        />
        
        <div className="flex-1 overflow-y-auto">
          {isLoading && !responseText ? (
            <div className="flex items-center gap-2 text-foreground-muted">
              <span className="ai-badge text-accent">✦</span>
              <span className="font-mono text-sm streaming-cursor">LIGAMENT AI is working</span>
            </div>
          ) : responseText ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <div className="font-mono text-xs text-foreground-secondary whitespace-pre-wrap leading-relaxed">
                {responseText}
                {isLoading && <span className="streaming-cursor" />}
              </div>
            </div>
          ) : (
            <div className="text-sm text-foreground-muted/50 italic">
              Enter your input and click Generate to create content with LIGAMENT AI.
            </div>
          )}
        </div>
        
        {responseText && !isLoading && (
          <div className="flex gap-2 mt-4 pt-4 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(responseText)}
              className="font-mono text-xs border-border text-foreground-muted hover:text-foreground bg-transparent"
            >
              Copy to Clipboard
            </Button>
          </div>
        )}
      </GlassCard>
    </div>
  )
}

export default function AIEnginePage() {
  const [activeTool, setActiveTool] = useState<AITool>("rfp")
  
  const currentTool = tools.find(t => t.id === activeTool)!
  
  return (
    <DashboardLayout>
      <div className="p-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-3">
            <span className="font-mono text-xs text-foreground-muted">
              AI Engine
            </span>
            <span className="font-mono text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/30 flex items-center gap-1">
              <span className="ai-badge">✦</span> Powered by Claude
            </span>
          </div>
          <h1 className="font-display font-black text-4xl md:text-5xl text-foreground leading-tight">
            AI Tool Suite
          </h1>
          <p className="mt-3 font-sans text-sm text-foreground-muted max-w-2xl leading-relaxed">
            Four specialized AI tools to streamline your vendor orchestration workflow. Each tool is trained on best practices for agency operations.
          </p>
        </div>
        
        {/* Tool Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={cn(
                "px-4 py-2 rounded-lg font-mono text-xs transition-all border flex items-center gap-2",
                activeTool === tool.id
                  ? "bg-accent/10 text-accent border-accent/30"
                  : "bg-white/5 text-foreground-muted border-border hover:border-white/30 hover:text-foreground"
              )}
            >
              <span className={activeTool === tool.id ? "text-accent" : "text-foreground-muted"}>✦</span>
              {tool.name}
            </button>
          ))}
        </div>
        
        {/* Tool Panel */}
        <AIToolPanel key={activeTool} tool={currentTool} />
      </div>
    </DashboardLayout>
  )
}
