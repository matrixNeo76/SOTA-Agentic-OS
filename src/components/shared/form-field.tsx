import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
export function FormField({ label, htmlFor, required, helperText, error, children, className }: { label: string; htmlFor?: string; required?: boolean; helperText?: string; error?: string; children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-1.5', className)}><Label htmlFor={htmlFor} className="text-xs font-medium flex items-center gap-1">{label}{required && <span className="text-destructive">*</span>}</Label>{children}{helperText && !error && <p className="text-[11px] text-muted-foreground">{helperText}</p>}{error && <p className="text-[11px] text-destructive">{error}</p>}</div>
}
export function FormSection({ title, description, icon: Icon, children, className }: { title: string; description?: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border bg-card shadow-sm overflow-hidden', className)}>{(title || description || Icon) && (<div className="border-b bg-muted/20 px-5 py-3"><div className="flex items-center gap-2">{Icon && <Icon className="size-4 text-primary shrink-0" />}<div>{title && <div className="text-sm font-semibold tracking-tight">{title}</div>}{description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}</div></div></div>)}<div className="px-5 py-4 space-y-3">{children}</div></div>
}
