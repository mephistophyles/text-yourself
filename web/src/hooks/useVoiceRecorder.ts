import { useState, useCallback, useRef } from 'react'

export interface VoiceRecorderResult {
  audioBase64: string | null
  blob: Blob | null
  isRecording: boolean
  start: () => Promise<void>
  stop: () => Promise<Blob | null>
  cancel: () => void
}

export function useVoiceRecorder(): VoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' })

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      mediaRecorderRef.current.onstop = () => {
        const finalBlob = new Blob(chunks, { type: 'audio/webm' })
        setBlob(finalBlob)
        // Create base64 string
        const reader = new FileReader()
        reader.readAsDataURL(finalBlob)
        reader.onload = () => {
          setIsRecording(false)
        }
        reader.onerror = () => {
          setIsRecording(false)
        }
      }

      mediaRecorderRef.current.start()
      setIsRecording(true)
      audioChunksRef.current = []
    } catch (err) {
      console.error('Voice recorder error:', err)
      setIsRecording(false)
    }
  }, [])

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      // Wait for ondataavailable and onstop to fire
      return new Promise<Blob | null>((resolve) => {
        const checkDone = setInterval(() => {
          if (blob) {
            clearInterval(checkDone)
            resolve(blob)
          }
        }, 100)
        setTimeout(() => {
          clearInterval(checkDone)
          resolve(null)
        }, 5000)
      })
    }
    return Promise.resolve(null)
  }, [isRecording, blob])

  const cancel = useCallback(() => {
    setIsRecording(false)
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      setBlob(null)
    }
  }, [])

  return {
    audioBase64: blob ? await blobToBase64(blob) : null,
    blob,
    isRecording,
    start,
    stop,
    cancel,
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(blob)
    reader.onload = () => {
      const base64 = reader.result?.toString().split(',')[1]
      if (base64) resolve(base64)
      else reject(new Error('No base64 data'))
    }
    reader.onerror = reject
  })
}