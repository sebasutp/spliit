import imageCompression from 'browser-image-compression'
import {
  IMAGE_MAX_DIMENSION,
  IMAGE_MAX_SIZE_MB,
  IMAGE_QUALITY,
  compressImage,
} from './compress-image'

// The real library needs canvas APIs that jsdom does not implement. Only the
// wiring around it is under test here.
jest.mock('browser-image-compression', () => ({
  __esModule: true,
  default: jest.fn(),
}))

const mockImageCompression = jest.mocked(imageCompression)

function file(name: string, type: string) {
  return new File(['contents'], name, { type })
}

describe('compressImage', () => {
  beforeEach(() => {
    mockImageCompression.mockReset()
  })

  it('re-encodes with the configured size and quality limits', async () => {
    const input = file('receipt.png', 'image/png')
    mockImageCompression.mockResolvedValue(file('receipt.png', 'image/jpeg'))

    await compressImage(input)

    expect(mockImageCompression).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        maxWidthOrHeight: IMAGE_MAX_DIMENSION,
        maxSizeMB: IMAGE_MAX_SIZE_MB,
        initialQuality: IMAGE_QUALITY,
        fileType: 'image/jpeg',
      }),
    )
  })

  it('renames a JPEG output so its extension matches its bytes', async () => {
    mockImageCompression.mockResolvedValue(file('receipt.png', 'image/jpeg'))

    const result = await compressImage(file('receipt.png', 'image/png'))

    expect(result.name).toBe('receipt.jpg')
    expect(result.type).toBe('image/jpeg')
  })

  it('handles a name without an extension', async () => {
    mockImageCompression.mockResolvedValue(file('receipt', 'image/jpeg'))

    const result = await compressImage(file('receipt', 'image/jpeg'))

    expect(result.name).toBe('receipt.jpg')
  })
})
