'use client';

import { useCallback, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type CopyableUrlProps = {
  url: string;
  label?: string;
  className?: string;
  showExternalLink?: boolean;
};

export default function CopyableUrl({
  url,
  label,
  className,
  showExternalLink = true,
}: CopyableUrlProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        toast.success('URL copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [url]
  );

  const handleExternalLink = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [url]
  );

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {label && <span className="shrink-0 font-medium text-muted-foreground">{label}</span>}
      <span className="min-w-0 truncate font-mono text-muted-foreground" title={url}>
        {url}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy URL'}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
      {showExternalLink && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleExternalLink}
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
