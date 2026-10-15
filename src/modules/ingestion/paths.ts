export const MATERIALS_BUCKET = "materials";

/** Keeps storage keys portable: ASCII letters, digits, dot, dash and underscore only. */
export function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_+/g, "_");
  const base = cleaned.slice(-80);
  return base.length > 0 ? base : "file";
}

export function originalDir(documentId: string): string {
  return `materials/${documentId}/original`;
}

export function originalPath(documentId: string, fileIndex: number, name: string): string {
  return `${originalDir(documentId)}/${fileIndex}-${safeName(name)}`;
}

export type PageExt = "pdf" | "jpg" | "png";

export function pagePath(documentId: string, pageNo: number, ext: PageExt): string {
  return `materials/${documentId}/pages/${String(pageNo).padStart(4, "0")}.${ext}`;
}
