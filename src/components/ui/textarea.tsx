import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
 return <textarea data-slot="textarea" className={cn("border-input placeholder:text-muted-foreground/60 flex field-sizing-content min-h-16 w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-all outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:shadow-md aria-invalid:ring-destructive/15 aria-invalid:border-destructive", className)} {...props} />
}

export { Textarea }
