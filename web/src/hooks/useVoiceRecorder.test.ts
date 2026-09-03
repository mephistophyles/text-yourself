import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceRecorder, type VoiceRecording } from './useVoiceRecorder'
import { FakeMediaRecorder, RECORDED_CHUNK, installFakeMediaStack, type MediaStack } from '../test/fakeMediaRecorder'

let media: MediaStack

beforeEach(() => {
  media = installFakeMediaStack()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useVoiceRecorder', () => {
  it('resolves stop() with the recorded audio and releases the microphone', async () => {
    const { result } = renderHook(() => useVoiceRecorder())
    expect(result.current.supported).toBe(true)

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.isRecording).toBe(true)

    let recording: VoiceRecording | null = null
    await act(async () => {
      recording = await result.current.stop()
    })

    expect(recording).not.toBeNull()
    expect(recording!.blob.size).toBe(RECORDED_CHUNK.length)
    // The container type is normalised to what the server accepts.
    expect(recording!.mimeType).toBe('audio/webm')
    expect(result.current.isRecording).toBe(false)
    // Leaving a track running keeps the browser's recording indicator on.
    expect(media.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('resolves stop() rather than hanging when nothing is recording', async () => {
    const { result } = renderHook(() => useVoiceRecorder())
    await expect(result.current.stop()).resolves.toBeNull()
  })

  it('discards a cancelled recording and still frees the microphone', async () => {
    const { result } = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await result.current.start()
    })

    await act(async () => {
      result.current.cancel()
    })

    expect(result.current.isRecording).toBe(false)
    expect(media.tracks[0]!.stop).toHaveBeenCalled()

    // Nothing is left behind for a later stop() to hand back.
    await expect(result.current.stop()).resolves.toBeNull()
  })

  it('yields nothing when the recorder produced no audio', async () => {
    // An unplayable zero-byte clip must never reach the composer.
    FakeMediaRecorder.emitData = false
    const { result } = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await result.current.start()
    })

    let recording: VoiceRecording | null | 'unset' = 'unset'
    await act(async () => {
      recording = await result.current.stop()
    })

    expect(recording).toBeNull()
  })

  it('reports a declined microphone instead of failing silently', async () => {
    media.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))
    const { result } = renderHook(() => useVoiceRecorder())

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.isRecording).toBe(false)
    expect(result.current.error).toBe('Microphone access was declined.')
  })

  it('reports a browser that cannot produce a supported container', async () => {
    FakeMediaRecorder.failToConstruct = true
    const { result } = renderHook(() => useVoiceRecorder())

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.error).toBe('This browser cannot record a supported audio format.')
    expect(media.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('reports an unsupported browser without throwing', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const { result } = renderHook(() => useVoiceRecorder())
    expect(result.current.supported).toBe(false)

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toBe('This browser cannot record audio.')
  })

  it('stops the microphone when the component unmounts mid-recording', async () => {
    const { result, unmount } = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await result.current.start()
    })
    unmount()
    expect(media.tracks[0]!.stop).toHaveBeenCalled()
  })
})
