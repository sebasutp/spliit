import {
  getPublicUploadUrl,
  isPublicUploadUrlConfigured,
} from './public-upload-url'

const FALLBACK = 'https://bucket.s3.eu-central-1.amazonaws.com/document-1.jpg'

describe('public upload URL', () => {
  describe('getPublicUploadUrl', () => {
    it('falls back to the upload URL when no public base is configured', () => {
      expect(getPublicUploadUrl(null, 'document-1.jpg', FALLBACK)).toBe(
        FALLBACK,
      )
      expect(getPublicUploadUrl(undefined, 'document-1.jpg', FALLBACK)).toBe(
        FALLBACK,
      )
      expect(getPublicUploadUrl('   ', 'document-1.jpg', FALLBACK)).toBe(
        FALLBACK,
      )
    })

    it('builds the read URL from the public base', () => {
      expect(
        getPublicUploadUrl(
          'https://files.example.com',
          'document-1.jpg',
          FALLBACK,
        ),
      ).toBe('https://files.example.com/document-1.jpg')
    })

    it('keeps key path segments and trims a trailing slash', () => {
      expect(
        getPublicUploadUrl(
          'https://files.example.com/',
          'folder/document-1.jpg',
          FALLBACK,
        ),
      ).toBe('https://files.example.com/folder/document-1.jpg')
    })
  })

  describe('isPublicUploadUrlConfigured', () => {
    it('is false when unset or blank', () => {
      expect(isPublicUploadUrlConfigured(undefined)).toBe(false)
      expect(isPublicUploadUrlConfigured(null)).toBe(false)
      expect(isPublicUploadUrlConfigured('  ')).toBe(false)
    })

    it('is true when a public base is set', () => {
      expect(isPublicUploadUrlConfigured('https://files.example.com')).toBe(
        true,
      )
    })
  })
})
