'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Output {
  id: string;
  layout: string;
  status: string;
  s3Url?: string | null;
}

interface CompositionCardProps {
  composition: {
    id: string;
    title: string;
    mode: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    tracks: { id: string }[];
    outputs: Output[];
  };
  deletingId: string | null;
  onDelete: (id: string) => void;
}

export function CompositionCard({ composition, deletingId, onDelete }: CompositionCardProps) {
  const statusBadge = () => {
    switch (composition.status) {
      case 'completed':
        return (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
            Completed
          </Badge>
        );
      case 'rendering':
        return (
          <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
            Rendering
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
  };

  const completedOutputs = composition.outputs.filter((o) => o.status === 'completed' && o.s3Url);
  const isDeleting = deletingId === composition.id;

  return (
    <Card className="relative overflow-hidden">
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm dark:bg-black/60">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground dark:text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
            Deleting...
          </div>
        </div>
      )}

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <Link href={`/reactions/${composition.id}`} className="hover:underline">
            <CardTitle className="text-base">{composition.title}</CardTitle>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(composition.id)}
            disabled={isDeleting}
            className="text-destructive hover:text-destructive -mt-1"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {statusBadge()}
          <Badge variant="outline" className="capitalize">
            {composition.mode}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {composition.tracks.length} track{composition.tracks.length !== 1 ? 's' : ''}
          </span>
        </div>

        {completedOutputs.length > 0 && (
          <div className="flex gap-2">
            {completedOutputs.map((output) => (
              <a
                key={output.id}
                href={output.s3Url!}
                download
                className="text-xs text-blue-500 hover:underline capitalize"
              >
                {output.layout}
              </a>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Updated {new Date(composition.updatedAt).toLocaleDateString()}
        </p>
      </CardContent>
    </Card>
  );
}
