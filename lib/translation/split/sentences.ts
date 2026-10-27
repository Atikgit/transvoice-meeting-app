/** Longest a sentence may grow before it is cut at a space. */
export const MAX_SENTENCE_CHARS = 120

const TERMINATORS = new Set(['.', '?', '!', '।', '॥'])
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'

/**
 * Cuts a streamed translation into sentences at . ? ! । and line breaks, and at a space once a
 * sentence reaches MAX_SENTENCE_CHARS. A "." between digits ("3.5") is not an end, and a terminator at
 * the very end of the buffer waits for the next character (it may be a digit or a closing quote).
 * push() returns the sentences that completed; flush() returns the rest at the end of the stream.
 */
export class SentenceSplitter {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    return this.drain(false)
  }

  flush(): string[] {
    return this.drain(true)
  }

  private drain(final: boolean): string[] {
    const out: string[] = []
    for (;;) {
      const cut = this.findCut(final)
      if (cut === -1) break
      const sentence = this.buffer.slice(0, cut).trim()
      this.buffer = this.buffer.slice(cut)
      if (sentence) out.push(sentence)
    }
    if (final) {
      const rest = this.buffer.trim()
      this.buffer = ''
      if (rest) out.push(rest)
    }
    return out
  }

  /** Index just after the first complete sentence in the buffer, or -1. */
  private findCut(final: boolean): number {
    const b = this.buffer
    for (let i = 0; i < b.length; i++) {
      const c = b[i]!
      if (c === '\n') return i + 1
      if (!TERMINATORS.has(c)) continue
      // "।" is unambiguous; "." between digits is a decimal point.
      if (c === '.' && isDigit(b[i - 1]) && isDigit(b[i + 1])) continue
      let end = i + 1
      while (end < b.length && TERMINATORS.has(b[end]!)) end++ // "?!" "..."
      if (end >= b.length && !final && c !== '।' && c !== '॥') return -1 // may continue: wait
      // closing quotes/brackets belong to the sentence
      while (end < b.length && '"\'”’)]»'.includes(b[end]!)) end++
      return end
    }
    if (b.length > MAX_SENTENCE_CHARS) {
      const space = b.lastIndexOf(' ', MAX_SENTENCE_CHARS)
      if (space > 0) return space + 1
    }
    return -1
  }
}
