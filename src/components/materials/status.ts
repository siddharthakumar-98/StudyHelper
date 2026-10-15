const STATUS_LABELS: Record<string, string> = {
  uploading: "Upload not finished",
  splitting: "Preparing pages",
  processing: "Reading slides",
  ready: "Ready",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatClassDate(value: string | null): string {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}
