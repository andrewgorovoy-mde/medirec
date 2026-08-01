const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.8;

function canvasToBase64Jpeg(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

function drawScaledToCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Downscales a photo File to a JPEG data URL capped at MAX_DIMENSION on its longest edge,
 * then returns the base64 payload (no "data:image/jpeg;base64," prefix). Raw phone photos
 * are 3-12MB and base64 adds ~33% overhead, so this keeps the upload small and fast.
 */
export async function downscaleToBase64Jpeg(file: File): Promise<string> {
  // iOS photos commonly carry a non-default EXIF orientation (e.g. portrait shots tagged
  // orientation 6); without this, a sideways label crops in wrong and wrecks OCR.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = drawScaledToCanvas(bitmap, bitmap.width, bitmap.height);
  return canvasToBase64Jpeg(canvas);
}

/**
 * Snapshots the current frame of a live <video> (from getUserMedia) to a downscaled
 * JPEG base64 payload, same shape as downscaleToBase64Jpeg.
 */
export function captureVideoFrameToBase64Jpeg(video: HTMLVideoElement): string {
  const canvas = drawScaledToCanvas(video, video.videoWidth, video.videoHeight);
  return canvasToBase64Jpeg(canvas);
}
