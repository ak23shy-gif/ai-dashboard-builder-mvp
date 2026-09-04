import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-border bg-card px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
