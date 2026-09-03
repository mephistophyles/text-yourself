import { vi } from 'vitest'

export const RECORDED_CHUNK = 'opus-bytes'

/** A minimal MediaRecorder that jsdom does not provide. */
export class FakeMediaRecorder {
  static supportedTypes = ['audio/webm;codecs=opus']
  static isTypeSupported = (type: string) => FakeMediaRecorder.supportedTypes.includes(type)
  static failToConstruct = false
  static emitData = true

  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly stream: MediaStream, options?: { mimeType?: string }) {
    if (FakeMediaRecorder.failToConstruct) throw new Error('unsupported')
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    if (FakeMediaRecorder.emitData) {
      this.ondataavailable?.({ data: new Blob([RECORDED_CHUNK], { type: 'audio/webm' }) })
    }
    this.onstop?.()
  }
}

export interface MediaStack {
  tracks: { stop: ReturnType<typeof vi.fn>; kind: string }[]
  getUserMedia: ReturnType<typeof vi.fn>
}

export function installFakeMediaStack(): MediaStack {
  FakeMediaRecorder.failToConstruct = false
  FakeMediaRecorder.emitData = true
  FakeMediaRecorder.supportedTypes = ['audio/webm;codecs=opus']

  const tracks = [{ stop: vi.fn(), kind: 'audio' }]
  const getUserMedia = vi.fn(async () => ({ getTracks: () => tracks }) as unknown as MediaStream)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true
  })
  return { tracks, getUserMedia }
}
