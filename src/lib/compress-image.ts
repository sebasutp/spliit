import imageCompression from 'browser-image-compression'
import 'client-only'

/**
 * Longest edge, in pixels, that an uploaded image is scaled down to. Phone
 * cameras shoot many megapixels more than a receipt needs, and the vision model
 * used for scanning scales images down to at most 2048 px anyway.
 */
export const IMAGE_MAX_DIMENSION = 1600

/** Highest original file size, in bytes, accepted from the file picker. */
export const MAX_INPUT_FILE_SIZE = 20 * 1024 ** 2

/** Target ceiling for the compressed image, in megabytes. */
export const IMAGE_MAX_SIZE_MB = 0.5

/** JPEG quality used when the image is first re-encoded. */
export const IMAGE_QUALITY = 0.8

/**
 * Resizes and re-encodes an image in the browser, before it is uploaded.
 *
 * Receipt photos come out of phones at several megabytes, which is far more
 * than either the on-screen viewer or the vision model needs. Downscaling to
 * {@link IMAGE_MAX_DIMENSION} and re-encoding as JPEG keeps the text readable
 * while cutting stored size and bandwidth.
 *
 * EXIF orientation is applied by the underlying library, so photos do not come
 * out rotated, and the remaining EXIF metadata is dropped.
 */
export async function compressImage(file: File): Promise<File> {
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: IMAGE_MAX_DIMENSION,
    maxSizeMB: IMAGE_MAX_SIZE_MB,
    initialQuality: IMAGE_QUALITY,
    fileType: 'image/jpeg',
    // The library's web worker loads its own script from a CDN by default,
    // which a self-hosted instance should not depend on. On the main thread,
    // decoding and encoding are still asynchronous; only the draw is blocking.
    useWebWorker: false,
    // Reduce quality, not resolution, if the target size is not met, so text
    // stays as sharp as possible.
    alwaysKeepResolution: true,
    // EXIF is not needed downstream and only adds bytes.
    preserveExif: false,
  })

  // The library keeps the original file name, so a PNG original would be stored
  // as JPEG bytes under a `.png` name. Give the output a name that matches what
  // it actually is.
  return new File([compressed], toJpgFileName(compressed.name), {
    type: compressed.type,
    lastModified: compressed.lastModified,
  })
}

function toJpgFileName(name: string): string {
  return `${name.replace(/\.[^./\\]+$/, '')}.jpg`
}
