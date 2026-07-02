/**
 * LLM JSON Parsing Helper
 *
 * C3 FIX: risolve il problema fragile di parsing JSON da output LLM.
 * PRIMA: ogni route faceva `raw.match(/\{[\s\S]*\}/)` + `JSON.parse()`
 * senza strip markdown, senza retry, senza fallback.
 *
 * ORA: helper centralizzato con:
 *  1. Strip markdown code blocks (```json ... ``` o ``` ... ```)
 *  2. Estrazione JSON bilanciata (first { to matching })
 *  3. JSON.parse con error recovery (trailing comma removal)
 *  4. Fallback deterministico opzionale
 */

/**
 * Strip markdown code blocks from LLM output.
 * Handles: ```json\n{...}\n``` and ```\n{...}\n```
 */
export function stripMarkdownCodeBlocks(raw: string): string {
  let cleaned = raw
  if (cleaned.includes('```')) {
    // Remove opening fence (```json or ```)
    cleaned = cleaned.replace(/```(?:json|javascript|js)?\s*\n?/g, '')
    // Remove closing fence
    cleaned = cleaned.replace(/```\s*$/g, '')
    cleaned = cleaned.trim()
  }
  return cleaned
}

/**
 * Extract first balanced JSON object from text.
 * Uses brace counting to handle nested objects correctly.
 */
export function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\') {
      escape = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  // Unbalanced braces — return everything from first { to last }
  const lastBrace = text.lastIndexOf('}')
  if (lastBrace > start) {
    return text.slice(start, lastBrace + 1)
  }

  return null
}

/**
 * Attempt JSON.parse with error recovery.
 * - Removes trailing commas (common LLM mistake)
 * - Converts single quotes to double quotes
 */
function parseWithRecovery(jsonStr: string): any {
  // First try strict parse
  try {
    return JSON.parse(jsonStr)
  } catch {
    // Try with trailing comma removal
    const noTrailingCommas = jsonStr.replace(/,(\s*[}\]])/g, '$1')
    try {
      return JSON.parse(noTrailingCommas)
    } catch {
      // Try with single→double quote conversion (careful not to break strings)
      const singleToDouble = noTrailingCommas.replace(/(\w)'(\w)/g, "$1\\'$2").replace(/'/g, '"')
      try {
        return JSON.parse(singleToDouble)
      } catch {
        throw new Error('JSON parse failed even with recovery')
      }
    }
  }
}

/**
 * Parse LLM output as JSON with robust handling.
 *
 * @param raw - Raw LLM output text
 * @param fallback - Optional fallback object if parsing fails
 * @returns Parsed JSON or fallback
 */
export function parseLlmJson<T>(raw: string, fallback?: T): T {
  // 1. Strip markdown code blocks
  const cleaned = stripMarkdownCodeBlocks(raw)

  // 2. Try direct parse first (clean JSON without prose)
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // Continue to extraction
  }

  // 3. Extract balanced JSON — try from each `{` position
  // (handles prose with braces before the actual JSON)
  let pos = 0
  while (pos < cleaned.length) {
    const start = cleaned.indexOf('{', pos)
    if (start === -1) break

    const jsonStr = extractBalancedJson(cleaned.slice(start))
    if (jsonStr) {
      try {
        const parsed = parseWithRecovery(jsonStr) as T
        // Skip empty objects — they're likely from prose braces like "{ } for objects"
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0) {
          pos = start + 1
          continue
        }
        return parsed
      } catch {
        // Try next `{` position
        pos = start + 1
      }
    } else {
      break
    }
  }

  // 4. Fallback
  if (fallback !== undefined) return fallback
  throw new Error(`LLM non ha prodotto JSON valido. Risposta: ${raw.slice(0, 200)}`)
}

/**
 * Parse LLM output as JSON with retry.
 * If first parse fails, calls retryFn to get a new response.
 *
 * @param raw - First LLM output
 * @param retryFn - Async function to get a second LLM response
 * @param fallback - Optional fallback
 */
export async function parseLlmJsonWithRetry<T>(
  raw: string,
  retryFn: () => Promise<string>,
  fallback?: T,
): Promise<T> {
  try {
    return parseLlmJson<T>(raw, undefined as T)
  } catch {
    // Retry
    try {
      const retryRaw = await retryFn()
      return parseLlmJson<T>(retryRaw, fallback)
    } catch {
      if (fallback !== undefined) return fallback
      throw new Error('JSON parse failed after retry')
    }
  }
}
