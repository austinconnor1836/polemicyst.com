'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-zinc-600',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-black text-white dark:bg-white dark:text-black glass:!bg-white/[0.15] glass:!text-white glass:!border-white/[0.12]',
        secondary:
          'border-transparent bg-gray-100 text-gray-900 dark:bg-zinc-800 dark:text-zinc-50 glass:!bg-white/[0.08] glass:!text-zinc-200 glass:!border-white/[0.1]',
        outline: 'text-gray-950 dark:text-zinc-50 glass:!text-zinc-300 glass:!border-white/[0.18]',
        destructive: 'border-transparent bg-red-600 text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
