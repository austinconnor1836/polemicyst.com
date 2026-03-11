'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, ArrowLeft, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PublishingPlatformPicker, type PublishingPlatform } from './PublishingPlatformPicker';

interface ConnectPublishingAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

export function ConnectPublishingAccountDialog({
  open,
  onOpenChange,
  onConnected,
}: ConnectPublishingAccountDialogProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<PublishingPlatform | null>(null);
  const [cookie, setCookie] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [connecting, setConnecting] = useState(false);

  const handleClose = () => {
    setSelectedPlatform(null);
    setCookie('');
    setSubdomain('');
    setConnecting(false);
    onOpenChange(false);
  };

  const handleConnect = async () => {
    if (!selectedPlatform || !cookie.trim() || !subdomain.trim()) return;

    setConnecting(true);
    try {
      const res = await fetch('/api/publishing-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedPlatform,
          cookie: cookie.trim(),
          subdomain: subdomain.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Connection failed');
      }

      toast.success(`Connected to ${data.displayName}`);
      handleClose();
      onConnected();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selectedPlatform ? 'Connect Substack' : 'Connect Publishing Platform'}
          </DialogTitle>
          <DialogDescription>
            {selectedPlatform
              ? 'Enter your Substack credentials to connect.'
              : 'Choose a publishing platform to connect.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!selectedPlatform ? (
            <PublishingPlatformPicker onSelect={setSelectedPlatform} />
          ) : selectedPlatform === 'substack' ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPlatform(null)}
                className="-ml-2"
              >
                <ArrowLeft className="mr-1 h-3 w-3" />
                Back
              </Button>

              <div className="space-y-2">
                <Label htmlFor="pub-subdomain">Subdomain</Label>
                <Input
                  id="pub-subdomain"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  placeholder="e.g. yourpublication"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  The part before .substack.com in your URL
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pub-cookie">Session Cookie</Label>
                <Input
                  id="pub-cookie"
                  type="password"
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder="Paste your connect.sid cookie value"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Open Substack &rarr; DevTools &rarr; Application &rarr; Cookies &rarr; copy{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">connect.sid</code>
                </p>
              </div>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPlatform(null)}
                className="-ml-2"
              >
                <ArrowLeft className="mr-1 h-3 w-3" />
                Back
              </Button>
              <p className="text-sm text-muted-foreground">
                {selectedPlatform.charAt(0).toUpperCase() + selectedPlatform.slice(1)} integration
                is coming soon.
              </p>
            </>
          )}
        </div>

        {selectedPlatform === 'substack' && (
          <DialogFooter className="pt-4 gap-2 sm:gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleConnect}
              disabled={connecting || !cookie.trim() || !subdomain.trim()}
            >
              {connecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Connect
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
