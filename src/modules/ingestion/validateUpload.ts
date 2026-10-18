export const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type UploadFileInfo = { name: string; type: string; size: number };

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export function isHeic(file: { name: string; type: string }): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * User-facing problems with a chosen set of files; an empty array means they are fine.
 * HEIC/HEIF is allowed here because the browser converts it to JPEG before upload.
 */
export function validateUploadFiles(files: UploadFileInfo[]): string[] {
  if (files.length === 0) return ["Choose at least one file"];
  const errors: string[] = [];
  for (const file of files) {
    const accepted =
      (ACCEPTED_TYPES as readonly string[]).includes(file.type) || isHeic(file);
    if (!accepted) {
      errors.push(`${file.name}: only PDF, JPG, PNG or HEIC files can be added`);
    } else if (file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name}: file is larger than 50 MB`);
    }
  }
  return errors;
}
