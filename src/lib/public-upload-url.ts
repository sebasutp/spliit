/**
 * Client-side helpers for the public URL of uploaded documents.
 *
 * `next-s3-upload` derives the stored URL from `S3_UPLOAD_ENDPOINT`, which
 * assumes one host serves both the S3 API (presigned PUTs) and public reads.
 * Providers that split those roles — Cloudflare R2 custom domains and r2.dev,
 * for instance — cannot be described by a single value, so when a public base
 * URL (`S3_PUBLIC_URL`) is configured we build the read URL ourselves from the
 * object key. It is resolved on the server and passed down as a prop.
 */

function normalizeBase(publicBase: string | null | undefined): string | null {
  const base = publicBase?.trim().replace(/\/+$/, '')
  return base ? base : null
}

/**
 * Whether uploaded documents are served from a dedicated public host. When
 * true, images should also bypass `next/image` optimization so the browser
 * loads them straight from storage rather than through the app server.
 */
export function isPublicUploadUrlConfigured(
  publicBase: string | null | undefined,
): boolean {
  return normalizeBase(publicBase) !== null
}

/**
 * Builds the publicly readable URL for an uploaded object.
 *
 * @param publicBase - Public base URL resolved on the server and passed down.
 * @param key - Object key returned by `uploadToS3`.
 * @param fallbackUrl - URL returned by `uploadToS3`, used when no public base
 *   is configured (AWS and single-endpoint providers such as MinIO).
 */
export function getPublicUploadUrl(
  publicBase: string | null | undefined,
  key: string,
  fallbackUrl: string,
): string {
  const base = normalizeBase(publicBase)
  return base ? `${base}/${key}` : fallbackUrl
}
