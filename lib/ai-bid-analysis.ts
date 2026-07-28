import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"

const DEFAULT_TIMEOUT_MS = 25_000

export type AnalysisResult =
  | { success: true; text: string }
  | { success: false; error: string }

/**
 * Shared Anthropic call for all bid-analysis AI features (summaries, decomposition,
 * comparison). Never throws - callers can always branch on `success` instead of
 * wrapping every call site in try/catch.
 */
export async function callAnthropicAnalysis({
  systemPrompt,
  userContent,
  maxTokens = 1024,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  systemPrompt: string
  userContent: string
  maxTokens?: number
  timeoutMs?: number
}): Promise<AnalysisResult> {
  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      system: systemPrompt,
      prompt: userContent,
      maxOutputTokens: maxTokens,
      abortSignal: AbortSignal.timeout(timeoutMs),
    })
    return { success: true, text: result.text }
  } catch (error) {
    console.error("[ai-bid-analysis] call failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI analysis failed",
    }
  }
}

const BOM_PATTERN = new RegExp("^\\uFEFF")

function stripMarkdownFence(raw: string): string {
  const s = raw.trim().replace(BOM_PATTERN, "")
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im.exec(s)
  return fence ? fence[1].trim() : s
}

/** First top-level `{ ... }` in the text, using string-aware brace matching. */
function extractBalancedJsonObject(input: string): string | null {
  const s = stripMarkdownFence(input)
  const start = s.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === "\\" && inString) {
      escape = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (!inString) {
      if (c === "{") depth++
      else if (c === "}") {
        depth--
        if (depth === 0) return s.slice(start, i + 1)
      }
    }
  }
  return null
}

/** Parses AI JSON output tolerantly (handles markdown fences and surrounding prose). */
export function tryParseJsonObject<T = unknown>(input: string): T | null {
  const cleaned = stripMarkdownFence(input)
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const extracted = extractBalancedJsonObject(cleaned)
    if (!extracted) return null
    try {
      return JSON.parse(extracted) as T
    } catch {
      return null
    }
  }
}
