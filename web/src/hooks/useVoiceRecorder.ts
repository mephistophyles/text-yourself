import { useCallback, useEffect, useRef, useState } from 'react'

export interface VoiceRecording {
  blob: Blob
  mimeType: string
  durationMs: number
}

export interface VoiceRecorder {
  isRecording: boolean
  elapsedMs: number
  error: string | null
  supported: boolean
  start(): Promise<void>
  stop(): Promise<VoiceRecording | null>
  cancel(): void
}

// The server stores these three container types. Browsers disagree on what
// they can record — Chrome and Firefox produce webm/ogg, Safari produces mp4 —
// so ask before choosing rather than assuming webm.
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4'
]

const ACCEPTED_CONTAINERS = ['audio/webm', 'audio/ogg', 'audio/mp4']

export function baseMimeType(mimeType: string): string {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase()
}

function isRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

function preferredMimeType(): string | null {
  const supported = CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type))
  return supported ?? null
}

export function useVoiceRecorder(): VoiceRecorder {
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [supported] = useState(isRecordingSupported)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const resolveRef = useRef<((recording: VoiceRecording | null) => void) | null>(null)
  const discardRef = useRef(false)

  // Releasing the tracks is what turns off the browser's recording indicator.
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  useEffect(() => releaseStream, [releaseStream])

  useEffect(() => {
    if (!isRecording) return
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200)
    return () => window.clearInterval(timer)
  }, [isRecording])

  const start = useCallback(async () => {
    if (recorderRef.current) return
    setError(null)
    if (!isRecordingSupported()) {
      setError('This browser cannot record audio.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access was declined.')
      return
    }
    const mimeType = preferredMimeType()
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      setError('This browser cannot record a supported audio format.')
      return
    }
    if (!ACCEPTED_CONTAINERS.includes(baseMimeType(recorder.mimeType || mimeType || ''))) {
      stream.getTracks().forEach((track) => track.stop())
      setError('This browser cannot record a supported audio format.')
      return
    }

    chunksRef.current = []
    discardRef.current = false
    recorderRef.current = recorder
    streamRef.current = stream

    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunksRef.current.push(event.data)
    }
    recorder.onerror = () => {
      setError('Recording stopped unexpectedly.')
    }
    recorder.onstop = () => {
      const type = baseMimeType(recorder.mimeType || mimeType || 'audio/webm')
      const blob = new Blob(chunksRef.current, { type })
      const durationMs = Date.now() - startedAtRef.current
      chunksRef.current = []
      releaseStream()
      setIsRecording(false)
      const resolve = resolveRef.current
      resolveRef.current = null
      // A cancelled or silent recording resolves to nothing rather than
      // handing the caller an unplayable zero-byte clip.
      resolve?.(discardRef.current || blob.size === 0 ? null : { blob, mimeType: type, durationMs })
    }

    startedAtRef.current = Date.now()
    setElapsedMs(0)
    recorder.start()
    setIsRecording(true)
  }, [releaseStream])

  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return null
    // onstop is the only place the final blob exists, so resolve from there.
    return new Promise<VoiceRecording | null>((resolve) => {
      resolveRef.current = resolve
      recorder.stop()
    })
  }, [])

  const cancel = useCallback(() => {
    discardRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    releaseStream()
    setIsRecording(false)
  }, [releaseStream])

  return { isRecording, elapsedMs, error, supported, start, stop, cancel }
}
