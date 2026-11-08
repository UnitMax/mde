/** Text search shared by the conversation's find bar (renderer) and the search over all threads (main). */

/** Where `query` occurs in `text`, ignoring case, as start offsets of matches that do not overlap. */
export function findOffsets(text: string, query: string): number[] {
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  // A letter that changes length when lowercased (a dotted capital I) would put the offsets out of step with the text.
  if (haystack.length !== text.length || needle.length !== query.length) return exactOffsets(text, query)
  return exactOffsets(haystack, needle)
}

function exactOffsets(text: string, query: string): number[] {
  const offsets: number[] = []
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) offsets.push(at)
  return offsets
}
