import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils.ts'

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
