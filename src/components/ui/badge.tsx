import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-xs border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-primary/20 bg-primary/10 text-primary [a&]:hover:bg-primary/15",
        secondary: "border-border bg-muted text-muted-foreground [a&]:hover:bg-muted/80",
        destructive: "border-destructive/20 bg-destructive/10 text-destructive [a&]:hover:bg-destructive/15",
        success: "border-status-ok/20 bg-status-ok/10 text-status-ok",
        warning: "border-status-warn/20 bg-status-warn/10 text-status-warn",
        danger: "border-status-danger/20 bg-status-danger/10 text-status-danger",
        info: "border-status-info/20 bg-status-info/10 text-status-info",
        outline: "text-foreground border-border [a&]:hover:bg-accent",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({ className, variant, asChild = false, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
