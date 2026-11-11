const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'because', 'before', 'being', 'below', 'between',
  'could', 'does', 'doing', 'down', 'during', 'each', 'from', 'further', 'have', 'having', 'here',
  'into', 'itself', 'just', 'more', 'most', 'only', 'other', 'over', 'same', 'should', 'some',
  'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'under', 'until', 'very', 'were', 'what', 'when', 'where', 'which', 'while', 'with',
  'would', 'your', 'yours', 'will', 'can', 'not', 'all', 'any', 'but', 'for', 'and', 'the', 'are',
  'was', 'been', 'has', 'had', 'did', 'you', 'our', 'out', 'who', 'how', 'why', 'too', 'use',
  'using', 'used', 'than', 'them', 'made', 'make', 'into', 'onto', 'like',
])

export function words(text) {
  if (typeof text !== 'string') return []
  return text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []
}

export function truncate(value, max) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Most frequent meaningful terms, as plain JSON for the tool card. */
export function topTerms(text, limit = 6) {
  const counts = new Map()

  for (const raw of words(text)) {
    const term = raw.toLowerCase()
    if (term.length < 4 || STOPWORDS.has(term)) continue
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

export function sentences(text) {
  if (typeof text !== 'string') return []
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35)
}

/** Extractive ranking: score each sentence by the term weights it contains. */
export function rankSentences(text, terms, limit = 5) {
  const weights = new Map(terms.map(({ term, count }) => [term, count]))

  const ranked = sentences(text).map((sentence, index) => {
    const tokens = words(sentence)
    const score =
      tokens.reduce((sum, token) => sum + (weights.get(token.toLowerCase()) ?? 0), 0) /
      Math.sqrt(tokens.length || 1)
    return { index, score, sentence }
  })

  const chosen = ranked
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const selection = chosen.length > 0 ? chosen : ranked.slice(0, limit)

  return selection
    .sort((a, b) => a.index - b.index)
    .map((item) => truncate(item.sentence, 320))
}

/** Every fenced block in the transcript, with its declared language. */
export function codeBlocks(text) {
  if (typeof text !== 'string') return []

  const blocks = []
  const pattern = /```([A-Za-z0-9+#._-]*)[ \t]*\r?\n([\s\S]*?)```/g

  for (const match of text.matchAll(pattern)) {
    const code = match[2].trimEnd()
    if (code.trim().length === 0) continue
    blocks.push({
      language: (match[1] || 'text').toLowerCase(),
      code,
      lines: code.split('\n').length,
    })
  }

  return blocks
}
