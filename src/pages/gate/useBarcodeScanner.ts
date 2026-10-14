import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Camera barcode scanning via @zxing/browser.
 *
 * Returns a stable `onDecoded` callback and an explicit start/stop lifecycle.
 * Duplicate reads of the same code are suppressed for `dedupeMs` so a single
 * physical scan produces a single lookup.
 */
export interface ScannerControls {
  supported: boolean
  active: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
  resetDedupe: () => void
}

export function useBarcodeScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onDecoded: (text: string) => void,
  dedupeMs = 2500,
): ScannerControls {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readerRef = useRef<{ reset: () => void } | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const callbackRef = useRef(onDecoded)

  useEffect(() => {
    callbackRef.current = onDecoded
  }, [onDecoded])

  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    readerRef.current = null
    setActive(false)
  }, [])

  const resetDedupe = useCallback(() => {
    lastRef.current = { text: '', at: 0 }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!supported) {
      setError('Camera access is not available in this browser.')
      return
    }
    if (!videoRef.current) {
      setError('Camera preview is not ready yet.')
      return
    }

    try {
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] =
        await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])

      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_93,
        BarcodeFormat.ITF,
      ])
      hints.set(DecodeHintType.TRY_HARDER, true)

      const reader = new BrowserMultiFormatReader(hints)
      readerRef.current = reader as unknown as { reset: () => void }

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (!result) return
          const text = result.getText().trim()
          if (!text) return
          const now = Date.now()
          if (
            lastRef.current.text === text &&
            now - lastRef.current.at < dedupeMs
          ) {
            return
          }
          lastRef.current = { text, at: now }
          callbackRef.current(text)
        },
      )
      controlsRef.current = controls as unknown as { stop: () => void }
      setActive(true)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to start the camera.'
      setError(
        /permission|denied|notallowed/i.test(message)
          ? 'Camera permission was denied. Enable it in your browser settings or use manual lookup.'
          : message,
      )
      setActive(false)
    }
  }, [videoRef, supported, dedupeMs])

  useEffect(() => stop, [stop])

  return { supported, active, error, start, stop, resetDedupe }
}
