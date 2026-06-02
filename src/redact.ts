/**
 * Redact secrets from a trace BEFORE it is rendered, recorded, and uploaded to a
 * public host. The clip is published — anyone with the link can view it — so a
 * key or token sitting in a tool-call argument would leak. This strips the
 * high-confidence secret shapes from every string leaf of every span.
 *
 * Fail-closed bias: we redact on match. It is acceptable to over-redact a
 * key-shaped string; it is NOT acceptable to publish a live credential. Data
 * URIs (screenshots) are left intact — they carry no secrets and are the whole
 * point of the screen capsule.
 */

import type { Span } from '@tangle-network/agent-eval'

const MASK = '«redacted»'

// High-precision patterns — each matches a credential shape, not arbitrary text.
const PATTERNS: Array<{ re: RegExp; replace: (m: string, ...g: string[]) => string }> = [
  // PEM private key blocks
  { re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, replace: () => MASK },
  // key = "value" / "token": "value" — keep the key, mask the value
  {
    re: /\b(api[_-]?key|secret|token|password|passwd|auth|authorization|bearer|client[_-]?secret|access[_-]?key|private[_-]?key|session)\b(\s*[:=]\s*)(['"]?)([^\s'"]{6,})\3/gi,
    replace: (_m, key, sep, q) => `${key}${sep}${q}${MASK}${q}`,
  },
  // Provider-prefixed tokens
  { re: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, replace: () => MASK }, // OpenAI/Stripe-style
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace: () => MASK }, // GitHub
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: () => MASK }, // Slack
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => MASK }, // AWS access key id
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => MASK }, // Google API key
  // JWT (three dotted base64url segments) — base64 image data has no dots, so it's safe
  { re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replace: () => MASK },
]

function redactString(s: string): string {
  if (s.startsWith('data:')) return s // screenshots / data URIs — never secrets, leave intact
  let out = s
  for (const { re, replace } of PATTERNS) out = out.replace(re, replace as (...a: string[]) => string)
  return out
}

function redactValue(v: unknown): unknown {
  if (typeof v === 'string') return redactString(v)
  if (Array.isArray(v)) return v.map(redactValue)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = redactValue(val)
    return out
  }
  return v
}

/** Return a deep copy of the spans with secret-shaped strings masked. Pure —
 *  the input is not mutated. Call this once before rendering anything that will
 *  be published. */
export function redactSpans(spans: readonly Span[]): Span[] {
  return spans.map((s) => redactValue(s) as Span)
}
