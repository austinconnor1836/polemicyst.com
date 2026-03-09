'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Brand } from '@/app/connected-accounts/types';

interface BrandSectionProps {
  brand: Brand;
  feedCount: number;
  onEdit: (brand: Brand) => void;
  onDelete: (brand: Brand) => void;
  children: React.ReactNode;
}

export function BrandSection({ brand, feedCount, onEdit, onDelete, children }: BrandSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-900/40 glass:hover:bg-white/8"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {brand.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.imageUrl} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
        )}
        <span className="font-semibold text-sm truncate">{brand.name}</span>
        <Badge variant="secondary" className="ml-1 shrink-0">
          {feedCount}
        </Badge>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(brand);
            }}
            title="Edit brand"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7 text-muted-foreground hover:text-red-600 dark:hover:text-red-400'
            )}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(brand);
            }}
            title="Delete brand"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </button>
      {!isCollapsed && <div className="space-y-2 pl-6">{children}</div>}
    </div>
  );
}
