import { isHeic } from "./validateUpload";

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

function jpegName(name: string): string {
  return name.replace(/\.[^.]*$/, "") + ".jpg";
}

/**
 * Browser only. Turns a phone photo into a JPEG that is upright and at most
 * 2000 px on its long edge: HEIC/HEIF is converted first, EXIF rotation is baked
 * in, and large photos are shrunk. Files that are not images (PDFs) are returned unchanged.
 */
export async function prepareImage(file: File): Promise<File> {
  const heic = isHeic(file);
  if (!heic && !file.type.startsWith("image/")) return file;

  let source: Blob = file;
  if (heic) {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
    source = Array.isArray(converted) ? converted[0] : converted;
  }

  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare photos");
    context.fillStyle = "#ffffff"; // PNGs with transparency would otherwise turn black
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("Could not prepare the photo");
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
