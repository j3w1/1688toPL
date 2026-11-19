self.addEventListener(
  'message',
  async ({ data: bitmap }) => {
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas
        .getContext('bitmaprenderer', { alpha: false })
        .transferFromImageBitmap(bitmap)
      self.postMessage(await canvas.convertToBlob({ type: 'image/png' }))
    } catch {
      self.postMessage(null)
    } finally {
      bitmap.close()
    }
  },
  { once: true }
)
