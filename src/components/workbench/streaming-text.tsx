'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Fake streaming typewriter effect for assistant messages.
 *
 * Reveals the text progressively with a blinking caret to give the perception
 * of token-by-token streaming without requiring backend SSE support.
 *
 * Behavior:
 * - Reveals ~3 chars per 16ms frame (~180 chars/sec) — feels natural
 * - Blinking caret at the end while streaming
 * - Click anywhere on the text to reveal instantly (skip)
 * - Calls `onComplete` callback when finished
 * - The outer wrapper uses `key={text}` to remount on text change, so the inner
 *   component can use clean initial state without setState-in-effect.
 */
export function StreamingText({
  text,
  speed = 16,
  charsPerTick = 3,
  className,
  onComplete,
}: {
  text: string
  speed?: number
  charsPerTick?: number
  className?: string
  onComplete?: () => void
}) {
  // key forces remount on text change → no setState in effect needed
  return (
    <StreamingTextInner
      key={text}
      text={text}
      speed={speed}
      charsPerTick={charsPerTick}
      className={className}
      onComplete={onComplete}
    />
  )
}

function StreamingTextInner({
  text,
  speed,
  charsPerTick,
  className,
  onComplete,
}: {
  text: string
  speed: number
  charsPerTick: number
  className?: string
  onComplete?: () => void
}) {
  // Initial state: if text is empty, we're already done; otherwise start streaming.
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(text.length === 0)
  const indexRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completedRef = useRef(text.length === 0)

  // Fire onComplete immediately if text is empty
  useEffect(() => {
    if (text.length === 0 && !completedRef.current) {
      completedRef.current = true
      onComplete?.()
    }
  }, [text, onComplete])

  // Start interval on mount (only if there's text to stream)
  useEffect(() => {
    if (text.length === 0) return

    intervalRef.current = setInterval(() => {
      indexRef.current = Math.min(indexRef.current + charsPerTick, text.length)
      setDisplayed(text.slice(0, indexRef.current))
      if (indexRef.current >= text.length) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
        setDone(true)
        if (!completedRef.current) {
          completedRef.current = true
          onComplete?.()
        }
      }
    }, speed)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [text, speed, charsPerTick, onComplete])

  const revealAll = () => {
    if (done) return
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    indexRef.current = text.length
    setDisplayed(text)
    setDone(true)
    if (!completedRef.current) {
      completedRef.current = true
      onComplete?.()
    }
  }

  return (
    <p
      className={cn('text-sm leading-relaxed whitespace-pre-wrap break-words cursor-text', className)}
      onClick={revealAll}
      title={!done ? 'Click per mostrare tutto' : undefined}
    >
      {displayed}
      {!done && <span className="streaming-caret text-primary">▋</span>}
    </p>
  )
}
