'use client'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'

export function useConsoleAttachments(input: string, setInput: (v: string) => void, focusInput: () => void) {
  const [isDragging, setIsDragging] = useState(false)
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true) }, [isDragging])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragging(false) }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const refs = files.map(f => f.type.startsWith('image/') ? `[image: ${f.name}]` : `[file: ${f.name}]`)
    const newText = input ? `${input}\n${refs.join('\n')}` : refs.join('\n')
    setInput(newText); toast.success(`${files.length} file aggiunti`); setTimeout(focusInput, 0)
  }, [input, setInput, focusInput])
  return { isDragging, handleDragOver, handleDragLeave, handleDrop }
}
