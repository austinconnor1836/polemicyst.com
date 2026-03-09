'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type Platform = 'youtube' | 'cspan' | 'upload' | 'tiktok' | 'instagram' | 'twitter';

interface PlatformOption {
  id: Platform;
  name: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
}

const PLATFORMS: PlatformOption[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Connect a YouTube channel',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
    available: true,
  },
  {
    id: 'cspan',
    name: 'C-SPAN',
    description: 'Monitor C-SPAN feeds',
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
        />
      </svg>
    ),
    available: true,
  },
  {
    id: 'upload',
    name: 'Upload',
    description: 'Upload videos directly',
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
        />
      </svg>
    ),
    available: true,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Connect a TikTok account',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.38a8.16 8.16 0 004.76 1.52V7.45a4.83 4.83 0 01-1-.76z" />
      </svg>
    ),
    available: false,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect an Instagram account',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
    available: false,
  },
  {
    id: 'twitter',
    name: 'X / Twitter',
    description: 'Connect an X / Twitter account',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    available: false,
  },
];

interface PlatformPickerProps {
  onSelect: (platform: Platform) => void;
}

export function PlatformPicker({ onSelect }: PlatformPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {PLATFORMS.map((platform) => (
        <button
          key={platform.id}
          onClick={() => platform.available && onSelect(platform.id)}
          disabled={!platform.available}
          className={cn(
            'relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
            platform.available
              ? 'border-border hover:border-accent hover:bg-accent/5 cursor-pointer'
              : 'border-border/50 opacity-50 cursor-not-allowed'
          )}
        >
          <div className={cn(platform.available ? 'text-accent' : 'text-muted-foreground')}>
            {platform.icon}
          </div>
          <span className="text-sm font-medium">{platform.name}</span>
          <span className="text-xs text-muted-foreground">{platform.description}</span>
          {!platform.available && (
            <Badge variant="secondary" className="absolute right-2 top-2 text-[10px]">
              Soon
            </Badge>
          )}
        </button>
      ))}
    </div>
  );
}
