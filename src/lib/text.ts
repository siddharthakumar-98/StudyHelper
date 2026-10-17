/**
 * Normalizes text for forgiving substring checks: NFKC, lowercase, curly quotes
 * to straight, en/em dashes and the minus sign (U+2212) to "-", bullets at the start of a line removed and
 * whitespace collapsed.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/^[ \t]*(?:[•▪]|[*-](?=\s))[ \t]*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `needle` occurs in `haystack` after both are normalized. */
export function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeForMatch(haystack).includes(normalizeForMatch(needle));
}
