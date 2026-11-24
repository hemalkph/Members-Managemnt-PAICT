import { MAX_TUTE_COVER_BYTES } from "@/lib/core/validation";
import { createClient } from "@/lib/supabase/client";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_DIMENSION = 720;

/**
 * Downscale large phone photos to a crisp max 720px cover thumbnail before upload
 * so uploads stay fast (~40–90 KB) while keeping booklet covers sharp on Retina displays.
 */
async function compressCoverFile(file: File): Promise<{ blob: Blob; contentType: string; ext: string }> {
  const fallbackExt = ALLOWED_TYPES[file.type] ?? "jpg";
  if (typeof window === "undefined" || typeof createImageBitmap === "undefined") {
    return { blob: file, contentType: file.type, ext: fallbackExt };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { blob: file, contentType: file.type, ext: fallbackExt };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (webp && webp.size > 0 && webp.size < file.size) {
      return { blob: webp, contentType: "image/webp", ext: "webp" };
    }
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (jpeg && jpeg.size > 0 && jpeg.size < file.size) {
      return { blob: jpeg, contentType: "image/jpeg", ext: "jpg" };
    }
  } catch {
    // Fall back to the original validated image if Canvas encoding fails.
  }
  return { blob: file, contentType: file.type, ext: fallbackExt };
}

/** Validate a selected cover image file before staging or uploading. */
export function validateCoverFile(file: File): string | null {
  if (!ALLOWED_TYPES[file.type]) {
    return "Please choose a JPG, PNG, or WebP image.";
  }
  if (file.size > MAX_TUTE_COVER_BYTES) {
    return "Cover photo must be 5 MB or smaller.";
  }
  return null;
}

/** Validate, compress, and upload a tute cover photo to private Supabase Storage. */
export async function uploadTuteCover(
  tuteId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const err = validateCoverFile(file);
  if (err) return { ok: false, error: err };

  const { blob, contentType, ext } = await compressCoverFile(file);
  const path = `${tuteId}/cover-${Date.now()}.${ext}`;
  const { error } = await createClient()
    .storage.from("tute-covers")
    .upload(path, blob, { contentType, upsert: false });

  if (error) {
    return { ok: false, error: "Cover upload failed. Please try again." };
  }
  return { ok: true, path };
}
