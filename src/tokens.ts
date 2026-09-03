/**
 * Approximate token accounting.
 *
 * We intentionally avoid a heavy tokenizer dependency: the runner only needs to
 * *size* synthetic contexts into buckets (32k, 128k, ...), not to reproduce a
 * specific vendor's exact tokenization. The heuristic below (~4 chars/token,
 * with a small per-line overhead for newlines) is stable and offline. A real
 * tokenizer can be swapped in later without touching callers.
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const newlines = countNewlines(text);
  // Whitespace/newlines tokenize slightly denser than average prose; add a small
  // correction so long, line-heavy "logs" don't under-count too badly.
  return Math.max(1, Math.round(text.length / CHARS_PER_TOKEN + newlines * 0.3));
}

function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

/** Roughly how many characters are needed to reach a target token count. */
export function charsForTokens(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}
