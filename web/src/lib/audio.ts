/**
 * Reads a recording into a plain ArrayBuffer.
 *
 * Recordings are held in IndexedDB until they are uploaded. Blob support in
 * IndexedDB varies, and an ArrayBuffer is structured-cloneable everywhere, so
 * the bytes are stored rather than the Blob wrapper.
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'))
    reader.readAsArrayBuffer(blob)
  })
}

export function toBlob(audio: ArrayBuffer, mimeType: string): Blob {
  return new Blob([audio], { type: mimeType })
}
