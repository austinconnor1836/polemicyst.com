'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  Sparkles,
  ImageIcon,
  Copy,
  Save,
  Send,
  FileUp,
  ExternalLink,
  AlertCircle,
  Plus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PUBLISHING_PLATFORM_ICONS,
  PUBLISHING_PLATFORM_COLORS,
} from '@/app/connected-accounts/_components/PublishingPlatformIcons';
import { cn } from '@/lib/utils';

interface ArticleGraphic {
  id: string;
  type: string;
  label?: string | null;
  htmlContent?: string | null;
  s3Url?: string | null;
  position: number;
}

interface ArticlePublishRecord {
  id: string;
  publishingAccountId: string;
  platform: string;
  displayName: string;
  accountPlatformUrl: string | null;
  status: string;
  platformUrl: string | null;
  platformDraftId: string | null;
  publishedAt: string | null;
  publishError: string | null;
  createdAt: string;
}

interface PublishingAccount {
  id: string;
  platform: string;
  displayName: string;
  platformUrl: string | null;
  connected: boolean;
}

interface ArticleEditorProps {
  article: {
    id: string;
    title: string;
    subtitle?: string | null;
    bodyMarkdown?: string | null;
    bodyHtml?: string | null;
    status: string;
    generationModel?: string | null;
    substackDraftId?: string | null;
    publishError?: string | null;
    graphics: ArticleGraphic[];
    publication: {
      id: string;
      name: string;
      configMarkdown: string;
      substackConnected?: boolean;
      substackUrl?: string | null;
    };
  };
  onUpdate: () => void;
}

export default function ArticleEditor({ article, onUpdate }: ArticleEditorProps) {
  const [title, setTitle] = useState(article.title);
  const [bodyMarkdown, setBodyMarkdown] = useState(article.bodyMarkdown || '');
  const [topic, setTopic] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [instructions, setInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingGraphics, setGeneratingGraphics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rasterizing, setRasterizing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Publish history
  const [publishes, setPublishes] = useState<ArticlePublishRecord[]>([]);
  const [publishingAccounts, setPublishingAccounts] = useState<PublishingAccount[]>([]);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const fetchPublishes = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${article.id}/publishes`);
      if (res.ok) {
        const data = await res.json();
        setPublishes(data);
      }
    } catch {
      // Non-critical
    }
  }, [article.id]);

  const fetchPublishingAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/publishing-accounts');
      if (res.ok) {
        const data = await res.json();
        setPublishingAccounts(data);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchPublishes();
    fetchPublishingAccounts();
  }, [fetchPublishes, fetchPublishingAccounts]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error('Enter a topic to generate the article');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/articles/${article.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          sourceContent: sourceContent.trim() || undefined,
          instructions: instructions.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Generation failed');
      }
      toast.success('Article generated!');
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateGraphics = async () => {
    setGeneratingGraphics(true);
    try {
      const res = await fetch(`/api/articles/${article.id}/generate-graphics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Graphics generation failed');
      }
      toast.success('Graphics generated!');
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Graphics generation failed');
    } finally {
      setGeneratingGraphics(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, bodyMarkdown }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Saved');
      onUpdate();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleRasterize = async () => {
    setRasterizing(true);
    try {
      const res = await fetch(`/api/articles/${article.id}/rasterize-graphics`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Rasterization failed');
      }
      toast.success('Graphics rasterized');
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rasterization failed');
    } finally {
      setRasterizing(false);
    }
  };

  const handlePublishToAccount = async (accountId: string, publishLive: boolean) => {
    const action = publishLive ? 'publish live' : 'save as draft';
    if (publishLive && !confirm('Publish this article live?')) return;

    setPublishing(true);
    try {
      const res = await fetch(`/api/articles/${article.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishingAccountId: accountId, publishLive }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action}`);
      }
      toast.success(publishLive ? 'Published!' : 'Draft saved');
      setIsPublishDialogOpen(false);
      setSelectedAccountId(null);
      await fetchPublishes();
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setPublishing(false);
    }
  };

  // Legacy publish (via publication Substack connection)
  const handlePublish = async (publishLive: boolean) => {
    const action = publishLive ? 'publish live' : 'save as draft';
    if (publishLive && !confirm('Publish this article live on Substack?')) return;

    setPublishing(true);
    try {
      const res = await fetch(`/api/articles/${article.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishLive }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action}`);
      }
      toast.success(publishLive ? 'Published to Substack!' : 'Draft saved to Substack');
      await fetchPublishes();
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setPublishing(false);
    }
  };

  const handleCopyHtml = () => {
    if (article.bodyHtml) {
      navigator.clipboard.writeText(article.bodyHtml);
      toast.success('HTML copied to clipboard');
    }
  };

  const hasContent = !!article.bodyMarkdown;
  const hasUnrasteredGraphics = article.graphics.some((g) => g.htmlContent && !g.s3Url);
  const isSubstackConnected = !!article.publication.substackConnected;

  // Accounts not already published to
  const availableAccounts = publishingAccounts.filter(
    (a) => a.connected && !publishes.some((p) => p.publishingAccountId === a.id)
  );

  return (
    <div className="space-y-6">
      {/* Generation controls */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          AI Generation
        </h3>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="topic">Topic / Prompt</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Analysis of the latest Supreme Court ruling on..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source">Source Material (optional)</Label>
            <Textarea
              id="source"
              value={sourceContent}
              onChange={(e) => setSourceContent(e.target.value)}
              placeholder="Paste transcript, article text, or other source material..."
              className="min-h-[80px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instructions">Additional Instructions (optional)</Label>
            <Input
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Focus on the constitutional implications..."
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleGenerate} disabled={generating || !topic.trim()}>
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {hasContent ? 'Regenerate Article' : 'Generate Article'}
            </Button>
            {hasContent && (
              <Button
                variant="outline"
                onClick={handleGenerateGraphics}
                disabled={generatingGraphics}
              >
                {generatingGraphics ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="mr-2 h-4 w-4" />
                )}
                Generate Graphics
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Publish error banner */}
      {article.publishError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">Publish Error</p>
            <p className="text-xs">{article.publishError}</p>
          </div>
        </div>
      )}

      {/* Publish History + Controls */}
      {hasContent && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Publishing
            </h3>
            <div className="flex items-center gap-2">
              {availableAccounts.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setIsPublishDialogOpen(true)}>
                  <Plus className="mr-1 h-3 w-3" />
                  Publish
                </Button>
              )}
              {hasUnrasteredGraphics && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRasterize}
                  disabled={rasterizing}
                >
                  {rasterizing ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-1 h-3 w-3" />
                  )}
                  Rasterize
                </Button>
              )}
            </div>
          </div>

          {/* Publish history */}
          {publishes.length > 0 ? (
            <div className="space-y-2">
              {publishes.map((pub) => {
                const IconComponent = PUBLISHING_PLATFORM_ICONS[pub.platform];
                const colorClass = PUBLISHING_PLATFORM_COLORS[pub.platform] || 'text-accent';
                return (
                  <div
                    key={pub.id}
                    className="flex items-center gap-3 rounded-md border bg-background/50 p-2.5"
                  >
                    <div className={cn('flex-shrink-0', colorClass)}>
                      {IconComponent && <IconComponent className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{pub.displayName}</span>
                        <Badge
                          variant={
                            pub.status === 'published'
                              ? 'default'
                              : pub.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                          }
                          className="text-[10px] px-1.5 py-0"
                        >
                          {pub.status}
                        </Badge>
                      </div>
                      {pub.publishError && (
                        <p className="text-xs text-destructive mt-0.5">{pub.publishError}</p>
                      )}
                      {pub.publishedAt && (
                        <p className="text-xs text-muted-foreground">
                          Published {new Date(pub.publishedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    {pub.platformDraftId && pub.accountPlatformUrl && (
                      <a
                        href={`${pub.accountPlatformUrl}/publish/post/${pub.platformDraftId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not published yet.{' '}
              {availableAccounts.length > 0
                ? 'Click "Publish" to send to a connected platform.'
                : 'Connect a publishing account from the Connected Accounts page.'}
            </p>
          )}

          {/* Legacy Substack publish buttons (for publications with direct connection) */}
          {isSubstackConnected && publishes.length === 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePublish(false)}
                disabled={publishing}
              >
                {publishing ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <FileUp className="mr-2 h-3 w-3" />
                )}
                Save as Draft (Legacy)
              </Button>
              <Button size="sm" onClick={() => handlePublish(true)} disabled={publishing}>
                {publishing ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Send className="mr-2 h-3 w-3" />
                )}
                Publish Live (Legacy)
              </Button>
              {article.substackDraftId && article.publication.substackUrl && (
                <a
                  href={`${article.publication.substackUrl}/publish/post/${article.substackDraftId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                  View on Substack
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Article editor */}
      {hasContent && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Article Content</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCopyHtml}>
                <Copy className="mr-2 h-3 w-3" />
                Copy HTML
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Save className="mr-2 h-3 w-3" />
                )}
                Save
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="article-title">Title</Label>
            <Input id="article-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="article-body">Body (Markdown)</Label>
            <Textarea
              id="article-body"
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              className="min-h-[400px] font-mono text-sm"
            />
          </div>

          {/* HTML Preview */}
          {article.bodyHtml && (
            <div className="space-y-2">
              <Label>Preview</Label>
              <div
                className="prose prose-sm dark:prose-invert max-w-none rounded-lg border p-4"
                dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
              />
            </div>
          )}
        </div>
      )}

      {/* Graphics */}
      {article.graphics.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Generated Graphics</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {article.graphics.map((graphic) => (
              <div key={graphic.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {graphic.type}
                  </Badge>
                  {graphic.label && (
                    <span className="text-xs text-muted-foreground">{graphic.label}</span>
                  )}
                </div>
                {graphic.htmlContent && (
                  <div
                    className="overflow-hidden rounded-lg border"
                    dangerouslySetInnerHTML={{ __html: graphic.htmlContent }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Publish to account dialog */}
      <Dialog open={isPublishDialogOpen} onOpenChange={setIsPublishDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish Article</DialogTitle>
            <DialogDescription>
              Choose a connected publishing account to publish to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {availableAccounts.map((account) => {
              const IconComponent = PUBLISHING_PLATFORM_ICONS[account.platform];
              const colorClass = PUBLISHING_PLATFORM_COLORS[account.platform] || 'text-accent';
              return (
                <button
                  key={account.id}
                  onClick={() => setSelectedAccountId(account.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors',
                    selectedAccountId === account.id
                      ? 'border-accent bg-accent/5'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <div className={cn('flex-shrink-0', colorClass)}>
                    {IconComponent && <IconComponent className="h-6 w-6" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{account.displayName}</p>
                    {account.platformUrl && (
                      <p className="text-xs text-muted-foreground">
                        {account.platformUrl.replace(/^https?:\/\//, '')}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            {availableAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No available accounts. All connected accounts have already been published to, or no
                accounts are connected.
              </p>
            )}
          </div>
          {selectedAccountId && (
            <DialogFooter className="pt-4 gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => handlePublishToAccount(selectedAccountId, false)}
                disabled={publishing}
              >
                {publishing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="mr-2 h-4 w-4" />
                )}
                Save as Draft
              </Button>
              <Button
                onClick={() => handlePublishToAccount(selectedAccountId, true)}
                disabled={publishing}
              >
                {publishing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Publish Live
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
