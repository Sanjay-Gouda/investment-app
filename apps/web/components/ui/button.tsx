import * as React from 'react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline';
}

/** Minimal button primitive — expand as the design system grows. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
          variant === 'primary' && 'bg-corgi text-white hover:bg-corgi/90',
          variant === 'outline' && 'border border-neutral-300 hover:bg-neutral-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export default Button;
