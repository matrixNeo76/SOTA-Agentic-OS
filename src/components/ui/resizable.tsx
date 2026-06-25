'use client'

import * as React from 'react'
import { GripVerticalIcon } from 'lucide-react'
import {
 Group as ResizableGroup,
 Panel as ResizablePanelPrimitive,
 Separator as ResizableSeparator,
 type GroupProps,
 type PanelProps,
 type SeparatorProps,
} from 'react-resizable-panels'
import { cn } from '@/lib/utils'

// === ResizablePanelGroup (wraps Group) ===
function ResizablePanelGroup({
 className,
 direction,
 ...props
}: GroupProps & { direction?: 'horizontal' | 'vertical' }) {
 return (
 <ResizableGroup
 data-slot="resizable-panel-group"
 orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
 className={cn(
 'flex h-full w-full',
 direction === 'vertical' && 'flex-col',
 className
 )}
 {...props}
 />
 )
}

// === ResizablePanel (wraps Panel) ===
function ResizablePanel({
 className,
 ...props
}: PanelProps) {
 return (
 <ResizablePanelPrimitive
 data-slot="resizable-panel"
 className={cn('h-full w-full', className)}
 {...props}
 />
 )
}

// === ResizableHandle (wraps Separator) ===
function ResizableHandle({
 withHandle,
 className,
 ...props
}: SeparatorProps & {
 withHandle?: boolean
}) {
 return (
 <ResizableSeparator
 data-slot="resizable-handle"
 className={cn(
 'bg-border focus-visible:ring-ring relative flex w-px items-center justify-center',
 'hover:bg-primary/30 transition-colors',
 'after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
 'focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden',
 className
 )}
 {...props}
 >
 {withHandle && (
 <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
 <GripVerticalIcon className="size-2.5" />
 </div>
 )}
 </ResizableSeparator>
 )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
