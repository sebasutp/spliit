import { env } from './env'

/**
 * Hosts that uploaded receipt/document images can legitimately live on, derived
 * from the configured S3 storage. A dedicated public read host
 * (`S3_PUBLIC_URL`) takes precedence over the S3 API endpoint, matching where
 * uploaded documents are actually read from.
 */
function getAllowedUploadHosts(): string[] {
  const hosts: string[] = []
  const publicUrl = env.S3_PUBLIC_URL
  if (publicUrl) {
    // Providers that serve objects from a dedicated public host (e.g.
    // Cloudflare R2 custom domains / r2.dev) have their stored URLs point at
    // this host rather than the S3 API endpoint, so it is the one to trust.
    try {
      hosts.push(new URL(publicUrl).hostname)
    } catch {
      // ignore an unparseable URL; it contributes no allowed host
    }
  } else if (env.S3_UPLOAD_ENDPOINT) {
    // custom endpoint for providers other than AWS
    try {
      hosts.push(new URL(env.S3_UPLOAD_ENDPOINT).hostname)
    } catch {
      // ignore an unparseable endpoint; it simply contributes no allowed host
    }
  } else if (env.S3_UPLOAD_BUCKET && env.S3_UPLOAD_REGION) {
    // default AWS provider
    hosts.push(
      `${env.S3_UPLOAD_BUCKET}.s3.${env.S3_UPLOAD_REGION}.amazonaws.com`,
    )
  }
  return hosts
}

/**
 * Returns true only for http(s) URLs whose host is one of the app's own
 * configured upload hosts. Used to ensure AI extraction is performed against
 * images the app itself produced, rather than an arbitrary attacker-supplied
 * URL (which would otherwise enable SSRF-via-OpenAI and unbounded API spend).
 */
export function isAllowedUploadUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  return getAllowedUploadHosts().includes(url.hostname)
}
