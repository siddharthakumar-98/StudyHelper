/**
 * A readable label for a slide: its printed number exactly as printed, or, when
 * the photo has none, its page and position so unnumbered photos stay distinct.
 */
export function slideLabel(s: {
  printed_slide_no: string | null;
  page_no: number;
  position_on_page: number;
}): string {
  const printed = s.printed_slide_no?.trim();
  if (printed) return `Slide ${printed}`;
  return `Page ${s.page_no}, photo ${s.position_on_page}`;
}

/** The label shown in the UI: printed numbers get their page, since they can repeat. */
export function slideHeading(s: {
  printed_slide_no: string | null;
  page_no: number;
  position_on_page: number;
}): string {
  const label = slideLabel(s);
  return s.printed_slide_no?.trim() ? `${label} · page ${s.page_no}` : label;
}
