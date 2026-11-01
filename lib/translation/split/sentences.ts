/**
 * Longest a piece may grow before it is cut. About 2 s of speech (55-70 characters), so each TTS
 * clip is short enough to travel inline in one LiveKit packet instead of being fetched by URL.
 */
export const MAX_SENTENCE_CHARS = 65
/** A cut at a comma/semicolon/colon is only taken when the piece is at least this long. */
export const MIN_CLAUSE_CHARS = 25

/** Clause marks: , ; : and their Arabic, CJK and Devanagari/Bengali relatives. */
const CLAUSE_MARKS = new Set([',', ';', ':', '،', '؛', '，', '；', '：', '、'])

const TERMINATORS = new Set(['.', '?', '!', '।', '॥'])
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'

/**
 * Cuts a streamed translation into sentences at . ? ! । and line breaks, and at a space once a
 * piece reaches MAX_SENTENCE_CHARS (at a clause mark , ; : when there is one, else a space). A "." between digits ("3.5") is not an end, and a terminator at
 * the very end of the buffer waits for the next character (it may be a digit or a closing quote).
 * push() returns the sentences that completed; flush() returns the rest at the end of the stream.
 */
export class SentenceSplitter {
  private buffer = ''
  private emitted = 0

  /**
   * `eagerFirst`: the first piece is cut at the first clause mark once MIN_CLAUSE_CHARS characters
   * are there, so its speech starts before the rest of the sentence has been translated.
   */
  constructor(private readonly options: { eagerFirst?: boolean } = {}) {}

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
      if (sentence) {
        out.push(sentence)
        this.emitted++
      }
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
      // a sentence longer than one clip is cut like any overlong text
      return end > MAX_SENTENCE_CHARS ? this.findOverflowCut() : end
    }
    if (b.length > MAX_SENTENCE_CHARS) return this.findOverflowCut()
    if (this.options.eagerFirst && this.emitted === 0) return this.findFirstClause()
    return -1
  }

  /** First clause mark at least MIN_CLAUSE_CHARS in (not a decimal comma), or -1. */
  private findFirstClause(): number {
    const b = this.buffer
    for (let i = MIN_CLAUSE_CHARS - 1; i < b.length; i++) {
      if (CLAUSE_MARKS.has(b[i]!) && !(isDigit(b[i - 1]) && isDigit(b[i + 1]))) return i + 1
    }
    return -1
  }

  /** The buffer is too long for one clip: cut at the last clause mark, else the last space. */
  private findOverflowCut(): number {
    const b = this.buffer
    for (let i = MAX_SENTENCE_CHARS - 1; i >= MIN_CLAUSE_CHARS - 1; i--) {
      if (CLAUSE_MARKS.has(b[i]!) && !(isDigit(b[i - 1]) && isDigit(b[i + 1]))) return i + 1
    }
    const space = b.lastIndexOf(' ', MAX_SENTENCE_CHARS)
    if (space > 0) return space + 1
    // No space at all (Chinese, Japanese): cut at the limit, never inside a surrogate pair.
    const high = b.charCodeAt(MAX_SENTENCE_CHARS - 1)
    return high >= 0xd800 && high <= 0xdbff ? MAX_SENTENCE_CHARS - 1 : MAX_SENTENCE_CHARS
  }
}
