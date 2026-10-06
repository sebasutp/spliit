import { env } from './env'
import { isAllowedUploadUrl } from './uploaded-image-url'

// The helper derives its allow-list from the S3 upload configuration in `env`.
// Mock it with a mutable object so each test can set the relevant variables;
// `getAllowedUploadHosts` reads these properties live on every call.
jest.mock('./env', () => ({ env: {} }))

const mockEnv = env as {
  S3_UPLOAD_ENDPOINT?: string
  S3_UPLOAD_BUCKET?: string
  S3_UPLOAD_REGION?: string
  S3_PUBLIC_URL?: string
}

describe('isAllowedUploadUrl', () => {
  afterEach(() => {
    delete mockEnv.S3_UPLOAD_ENDPOINT
    delete mockEnv.S3_UPLOAD_BUCKET
    delete mockEnv.S3_UPLOAD_REGION
    delete mockEnv.S3_PUBLIC_URL
  })

  describe('with a dedicated public URL configured', () => {
    beforeEach(() => {
      // e.g. Cloudflare R2: a private S3 API endpoint plus a public custom
      // domain that serves objects at the root.
      mockEnv.S3_UPLOAD_ENDPOINT = 'https://accountid.r2.cloudflarestorage.com'
      mockEnv.S3_PUBLIC_URL = 'https://files.example.com'
    })

    it('allows a URL on the public host', () => {
      expect(
        isAllowedUploadUrl('https://files.example.com/document-1.jpg'),
      ).toBe(true)
    })

    it('does not trust the S3 API endpoint host', () => {
      expect(
        isAllowedUploadUrl(
          'https://accountid.r2.cloudflarestorage.com/bucket/document-1.jpg',
        ),
      ).toBe(false)
    })

    it('rejects an unrelated host', () => {
      expect(
        isAllowedUploadUrl('https://evil.example.com/document-1.jpg'),
      ).toBe(false)
    })
  })

  describe('with a custom S3 endpoint configured', () => {
    beforeEach(() => {
      mockEnv.S3_UPLOAD_ENDPOINT = 'https://minio.example.com'
    })

    it('allows a URL on the configured endpoint host', () => {
      expect(
        isAllowedUploadUrl('https://minio.example.com/bucket/receipt.jpg'),
      ).toBe(true)
    })

    it('allows the endpoint host regardless of port', () => {
      mockEnv.S3_UPLOAD_ENDPOINT = 'https://minio.example.com:9000'
      expect(
        isAllowedUploadUrl('https://minio.example.com:9000/bucket/receipt.jpg'),
      ).toBe(true)
    })

    it('rejects a different host (SSRF / denial-of-wallet attempt)', () => {
      expect(isAllowedUploadUrl('https://evil.example.com/receipt.jpg')).toBe(
        false,
      )
    })

    it('rejects a subdomain of the allowed host', () => {
      expect(
        isAllowedUploadUrl('https://minio.example.com.evil.com/receipt.jpg'),
      ).toBe(false)
    })

    it('allows http as well as https', () => {
      expect(
        isAllowedUploadUrl('http://minio.example.com/bucket/receipt.jpg'),
      ).toBe(true)
    })

    it('rejects non-http(s) schemes even when the host matches', () => {
      expect(isAllowedUploadUrl('ftp://minio.example.com/receipt.jpg')).toBe(
        false,
      )
      expect(isAllowedUploadUrl('gopher://minio.example.com/x')).toBe(false)
    })
  })

  describe('with the AWS bucket/region fallback', () => {
    beforeEach(() => {
      mockEnv.S3_UPLOAD_BUCKET = 'my-bucket'
      mockEnv.S3_UPLOAD_REGION = 'eu-central-1'
    })

    it('allows the derived bucket.s3.region.amazonaws.com host', () => {
      expect(
        isAllowedUploadUrl(
          'https://my-bucket.s3.eu-central-1.amazonaws.com/receipts/1.png',
        ),
      ).toBe(true)
    })

    it('rejects the same bucket in a different region', () => {
      expect(
        isAllowedUploadUrl(
          'https://my-bucket.s3.us-east-1.amazonaws.com/receipts/1.png',
        ),
      ).toBe(false)
    })

    it('rejects an unrelated host', () => {
      expect(isAllowedUploadUrl('https://attacker.com/receipts/1.png')).toBe(
        false,
      )
    })
  })

  describe('precedence of endpoint over bucket/region', () => {
    it('uses only the endpoint host when both are configured', () => {
      mockEnv.S3_UPLOAD_ENDPOINT = 'https://minio.example.com'
      mockEnv.S3_UPLOAD_BUCKET = 'my-bucket'
      mockEnv.S3_UPLOAD_REGION = 'eu-central-1'

      expect(
        isAllowedUploadUrl('https://minio.example.com/bucket/receipt.jpg'),
      ).toBe(true)
      // The AWS-derived host is not trusted because the endpoint branch wins.
      expect(
        isAllowedUploadUrl(
          'https://my-bucket.s3.eu-central-1.amazonaws.com/receipts/1.png',
        ),
      ).toBe(false)
    })
  })

  describe('malformed input', () => {
    beforeEach(() => {
      mockEnv.S3_UPLOAD_ENDPOINT = 'https://minio.example.com'
    })

    it('rejects strings that are not URLs', () => {
      expect(isAllowedUploadUrl('not a url')).toBe(false)
      expect(isAllowedUploadUrl('')).toBe(false)
      expect(isAllowedUploadUrl('/relative/path.jpg')).toBe(false)
    })

    it('rejects javascript: and data: URLs', () => {
      expect(isAllowedUploadUrl('javascript:alert(1)')).toBe(false)
      expect(isAllowedUploadUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(
        false,
      )
    })
  })

  describe('with no S3 configuration', () => {
    it('rejects every URL because the allow-list is empty', () => {
      expect(
        isAllowedUploadUrl('https://minio.example.com/bucket/receipt.jpg'),
      ).toBe(false)
      expect(
        isAllowedUploadUrl(
          'https://my-bucket.s3.eu-central-1.amazonaws.com/receipts/1.png',
        ),
      ).toBe(false)
    })
  })

  describe('with an unparseable endpoint', () => {
    it('contributes no allowed host and rejects everything', () => {
      mockEnv.S3_UPLOAD_ENDPOINT = 'http://[not a valid url'
      expect(
        isAllowedUploadUrl('https://minio.example.com/bucket/receipt.jpg'),
      ).toBe(false)
    })
  })
})
