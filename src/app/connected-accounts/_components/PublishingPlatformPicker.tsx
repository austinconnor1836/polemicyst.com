'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SubstackIcon, MediumIcon, GhostIcon, WordPressIcon } from './PublishingPlatformIcons';

export type PublishingPlatform = 'substack' | 'medium' | 'ghost' | 'wordpress';

interface PublishingPlatformOption {
  id: PublishingPlatform;
  name: string;
  icon: React.ReactNode;
  available: boolean;
}

const PUBLISHING_PLATFORMS: PublishingPlatformOption[] = [
  {
    id: 'substack',
    name: 'Substack',
    icon: <SubstackIcon />,
    available: true,
  },
  {
    id: 'medium',
    name: 'Medium',
    icon: <MediumIcon />,
    available: false,
  },
  {
    id: 'ghost',
    name: 'Ghost',
    icon: <GhostIcon />,
    available: false,
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    icon: <WordPressIcon />,
    available: false,
  },
];

interface PublishingPlatformPickerProps {
  onSelect: (platform: PublishingPlatform) => void;
}

export function PublishingPlatformPicker({ onSelect }: PublishingPlatformPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {PUBLISHING_PLATFORMS.map((platform) => (
        <button
          key={platform.id}
          onClick={() => platform.available && onSelect(platform.id)}
          disabled={!platform.available}
          className={cn(
            'relative flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors',
            platform.available
              ? 'border-border hover:border-accent hover:bg-accent/5 cursor-pointer'
              : 'border-border/50 opacity-50 cursor-not-allowed'
          )}
        >
          <div
            className={cn(
              platform.available
                ? platform.id === 'substack'
                  ? 'text-orange-500'
                  : 'text-accent'
                : 'text-muted-foreground'
            )}
          >
            {platform.icon}
          </div>
          <span className="text-xs font-medium">{platform.name}</span>
          {!platform.available && (
            <Badge
              variant="secondary"
              className="absolute -top-1.5 -right-1.5 text-[9px] px-1 py-0"
            >
              Soon
            </Badge>
          )}
        </button>
      ))}
    </div>
  );
}
