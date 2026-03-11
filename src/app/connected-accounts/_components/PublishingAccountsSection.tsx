'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Trash2, Loader2, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { PUBLISHING_PLATFORM_ICONS, PUBLISHING_PLATFORM_COLORS } from './PublishingPlatformIcons';
import { ConnectPublishingAccountDialog } from './ConnectPublishingAccountDialog';

interface PublishingAccount {
  id: string;
  platform: string;
  displayName: string;
  platformUrl: string | null;
  connected: boolean;
}

export function PublishingAccountsSection() {
  const [accounts, setAccounts] = useState<PublishingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/publishing-accounts');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setAccounts(data);
    } catch (err) {
      console.error('Failed to load publishing accounts', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleDelete = async (account: PublishingAccount) => {
    if (!confirm(`Disconnect "${account.displayName}"? You can reconnect later.`)) return;

    setDeletingId(account.id);
    try {
      const res = await fetch(`/api/publishing-accounts/${account.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success('Publishing account disconnected');
      await fetchAccounts();
    } catch {
      toast.error('Failed to disconnect account');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Publishing Platforms</h2>
        <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Connect
        </Button>
      </div>

      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : accounts.length === 0 ? (
        <Card
          className="cursor-pointer border-dashed transition-colors hover:border-accent hover:bg-accent/5"
          onClick={() => setIsDialogOpen(true)}
        >
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Plus className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Connect a publishing platform</p>
            <p className="text-xs text-muted-foreground">Substack, Medium, Ghost, WordPress</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => {
            const IconComponent = PUBLISHING_PLATFORM_ICONS[account.platform];
            const colorClass = PUBLISHING_PLATFORM_COLORS[account.platform] || 'text-accent';

            return (
              <Card key={account.id} className="relative">
                {deletingId === account.id && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm dark:bg-black/60">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground dark:text-white">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Deleting…
                    </div>
                  </div>
                )}
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={cn('flex-shrink-0', colorClass)}>
                    {IconComponent && <IconComponent className="h-8 w-8" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{account.displayName}</p>
                      <Badge
                        variant={account.connected ? 'default' : 'destructive'}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {account.connected ? 'Connected' : 'Expired'}
                      </Badge>
                    </div>
                    {account.platformUrl && (
                      <a
                        href={account.platformUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {account.platformUrl.replace(/^https?:\/\//, '')}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(account)}
                    disabled={deletingId === account.id}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          {/* Add card */}
          <Card
            className="cursor-pointer border-dashed transition-colors hover:border-accent hover:bg-accent/5"
            onClick={() => setIsDialogOpen(true)}
          >
            <CardContent className="flex items-center justify-center p-4">
              <Plus className="mr-2 h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Add Platform</span>
            </CardContent>
          </Card>
        </div>
      )}

      <ConnectPublishingAccountDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onConnected={fetchAccounts}
      />
    </div>
  );
}
