'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const videoCardVariants = cva('group overflow-hidden', {
  variants: {
    size: {
      sm: 'max-w-[200px]',
      md: 'max-w-xs',
      lg: 'max-w-sm',
      xl: 'max-w-md',
    },
  },
  defaultVariants: {
    size: 'lg',
  },
});

const thumbVariants = cva('relative w-full bg-black/5 dark:bg-black/20', {
  variants: {
    size: {
      sm: 'h-28',
      md: 'h-36',
      lg: 'h-48',
      xl: 'h-56',
    },
  },
  defaultVariants: {
    size: 'lg',
  },
});

export interface VideoCardProps extends VariantProps<typeof videoCardVariants> {
  src?: string;
  poster?: string;
  label: string;
  badge?: React.ReactNode;
  sublabel?: React.ReactNode;
  onClick?: () => void;
  overlay?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  videoRef?: React.Ref<HTMLVideoElement>;
  onTimeUpdate?: (currentTime: number) => void;
  controls?: boolean;
}

function VideoCard({
  size,
  src,
  poster,
  label,
  badge,
  sublabel,
  onClick,
  overlay,
  children,
  className,
  videoRef,
  onTimeUpdate,
  controls,
}: VideoCardProps) {
  return (
    <Card
      className={cn(videoCardVariants({ size }), onClick && 'cursor-pointer', className)}
      onClick={onClick}
    >
      <div className={thumbVariants({ size })}>
        {src ? (
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            preload="metadata"
            muted={!controls}
            playsInline
            tabIndex={-1}
            controls={controls}
            className="h-full w-full object-contain bg-black"
            onTimeUpdate={
              onTimeUpdate ? (e) => onTimeUpdate(e.currentTarget.currentTime) : undefined
            }
          />
        ) : (
          children
        )}
        {overlay}
      </div>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium line-clamp-1">{label}</span>
          {badge}
        </div>
        {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}

export { VideoCard, videoCardVariants };
