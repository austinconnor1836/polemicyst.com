'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link2, Unlink, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

interface SubstackConnectionProps {
  publicationId: string;
  substackConnected: boolean;
  substackUrl: string | null;
  onUpdate: () => void;
}

export default function SubstackConnection({
  publicationId,
  substackConnected,
  substackUrl,
  onUpdate,
}: SubstackConnectionProps) {
  const [cookie, setCookie] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);

  // Extract subdomain from URL if connected
  useEffect(() => {
    if (substackUrl) {
      try {
        const hostname = new URL(substackUrl).hostname;
        setSubdomain(hostname.split('.')[0]);
      } catch {
        // ignore
      }
    }
  }, [substackUrl]);

  // Auto-verify on mount if connected
  useEffect(() => {
    if (substackConnected) {
      handleVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    if (!cookie.trim() || !subdomain.trim()) {
      toast.error('Both session cookie and subdomain are required');
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch(`/api/publications/${publicationId}/substack/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: cookie.trim(), subdomain: subdomain.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Connection failed');
      }
      toast.success(`Connected to ${data.publicationName}`);
      setCookie('');
      setVerified(true);
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect from Substack? You can reconnect later.')) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/publications/${publicationId}/substack/disconnect`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Disconnect failed');
      toast.success('Disconnected from Substack');
      setVerified(null);
      onUpdate();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch(`/api/publications/${publicationId}/substack/verify`);
      const data = await res.json();
      if (data.expired) {
        toast.error('Substack session expired — please reconnect');
        setVerified(false);
        onUpdate();
      } else {
        setVerified(data.connected);
      }
    } catch {
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Substack Connection
        </h3>
        {substackConnected && verified !== null && (
          <Badge variant={verified ? 'default' : 'destructive'} className="text-xs">
            {verified ? (
              <>
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Connected
              </>
            ) : (
              <>
                <AlertCircle className="mr-1 h-3 w-3" />
                Expired
              </>
            )}
          </Badge>
        )}
      </div>

      {substackConnected ? (
        <div className="space-y-3">
          {substackUrl && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Publication:</span>
              <a
                href={substackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
              >
                {substackUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleVerify} disabled={verifying}>
              {verifying ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-3 w-3" />
              )}
              Verify
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-destructive hover:text-destructive"
            >
              {disconnecting ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Unlink className="mr-2 h-3 w-3" />
              )}
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Connect your Substack to publish articles directly. You&apos;ll need your{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">connect.sid</code> session
            cookie from Substack.
          </p>
          <div className="space-y-2">
            <Label htmlFor="substack-subdomain">Subdomain</Label>
            <Input
              id="substack-subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              placeholder="e.g. yourpublication"
            />
            <p className="text-xs text-muted-foreground">
              The part before .substack.com in your URL
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="substack-cookie">Session Cookie</Label>
            <Input
              id="substack-cookie"
              type="password"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="Paste your connect.sid cookie value"
            />
            <p className="text-xs text-muted-foreground">
              Open Substack &rarr; DevTools &rarr; Application &rarr; Cookies &rarr; copy{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">connect.sid</code>
            </p>
          </div>
          <Button
            onClick={handleConnect}
            disabled={connecting || !cookie.trim() || !subdomain.trim()}
          >
            {connecting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            Connect Substack
          </Button>
        </div>
      )}
    </div>
  );
}
