// Subsequence fuzzy match: every character of needle must appear in
// haystack in order, but not necessarily contiguously (so "ap pwr" style
// typos and abbreviations like "aprpwr" still find "AP Power"). Returns -1
// for no match, else a score where consecutive/early matches score higher
// so tighter matches can be sorted first. Callers are expected to lowercase
// both arguments themselves.
export function fuzzyScore(needle: string, haystack: string): number {
  if (needle.length === 0) return 0
  let score = 0
  let ni = 0
  let consecutive = 0
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
    if (haystack[hi] === needle[ni]) {
      ni++
      consecutive++
      score += consecutive
    } else {
      consecutive = 0
    }
  }
  return ni === needle.length ? score : -1
}
