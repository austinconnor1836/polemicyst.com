'use client';

import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';

interface ArticleCardProps {
  article: {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  publicationId: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  generating: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  review: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  published: 'bg-green-500/10 text-green-600 dark:text-green-400',
};

export default function ArticleCard({ article, publicationId }: ArticleCardProps) {
  return (
    <Link href={`/publications/${publicationId}/articles/${article.id}`} className="group block">
      <div className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium group-hover:underline">{article.title}</h3>
            <Badge
              variant="secondary"
              className={cn('shrink-0 text-xs', statusColors[article.status])}
            >
              {article.status}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {new Date(article.updatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </Link>
  );
}
