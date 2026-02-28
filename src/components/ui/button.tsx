'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-surface hover:bg-primary/90 glass:!bg-white/[0.15] glass:!text-white glass:hover:!bg-white/25 glass:backdrop-blur-md glass:!border glass:!border-white/[0.12]',
        secondary:
          'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-50 dark:hover:bg-zinc-700 glass:!bg-white/[0.08] glass:!text-zinc-200 glass:hover:!bg-white/[0.16] glass:!border glass:!border-white/[0.1]',
        outline:
          'border border-border bg-transparent hover:bg-gray-100 dark:hover:bg-zinc-800 glass:!border-white/[0.15] glass:hover:!bg-white/[0.1]',
        ghost: 'hover:bg-gray-100 dark:hover:bg-zinc-800 glass:hover:!bg-white/[0.1]',
        link: 'px-0 underline-offset-4 hover:underline text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 glass:!text-blue-300 glass:hover:!text-blue-200',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 glass:!bg-red-500/40 glass:hover:!bg-red-500/60 glass:!border glass:!border-red-400/20',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
