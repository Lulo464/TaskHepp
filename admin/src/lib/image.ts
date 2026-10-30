const MAX_SIDE = 2000;
const QUALITY = 0.85;
const KEEP = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Makes a phone photo upload-friendly: at most 2000 px on the long side as JPEG, turned the right way up. GIFs stay
 * as they are (animation); a format the browser cannot draw is sent unchanged when the server accepts it.
 */
export async function shrinkImage(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  if (file.type === 'image/gif') return { blob: file, type: file.type, name: file.name };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('toBlob');
    return { blob, type: 'image/jpeg', name: file.name.replace(/\.[^.]*$/, '') + '.jpg' };
  } catch {
    if (KEEP.includes(file.type)) return { blob: file, type: file.type, name: file.name };
    throw new Error('unsupported');
  }
}
