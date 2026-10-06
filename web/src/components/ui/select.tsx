import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}

export { Select };
