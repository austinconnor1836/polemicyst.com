'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { VideoCard } from '@/components/ui/video-card';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Sparkles,
  Video,
  Type,
  Settings,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PlatformInfo {
  platform: string;
  displayName: string;
  connected: boolean;
  supportsVideo: boolean;
  supportsText: boolean;
}

interface PublishResult {
  platform: string;
  success: boolean;
  platformUrl?: string;
  error?: string;
}

interface OutputItem {
  id: string;
  layout: string;
  s3Url: string;
  hasS3Key: boolean;
}

export interface VideoPublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compositionId: string;
  compositionTitle?: string;
  outputs: OutputItem[];
  trackLabels?: string[];
  generationContext?: {
    title?: string;
    trackLabels?: string[];
    layouts?: string[];
    transcript?: string;
  };
  /** Called to trigger S3 upload for a local-only output. */
  onRequestUpload?: (layout: string) => void;
  /** Layout currently being uploaded to S3 (shows progress in the modal). */
  uploadingLayout?: string | null;
}

type Phase = 'compose' | 'publishing' | 'results';
type DescMode = 'generate' | 'template';

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'X / Twitter',
  bluesky: 'Bluesky',
  threads: 'Threads',
};

export function VideoPublishModal({
  open,
  onOpenChange,
  compositionId,
  compositionTitle,
  outputs,
  trackLabels,
  generationContext,
  onRequestUpload,
  uploadingLayout,
}: VideoPublishModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('compose');
  const [results, setResults] = useState<PublishResult[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [descMode, setDescMode] = useState<DescMode>('generate');
  const [generatedDescription, setGeneratedDescription] = useState('');
  // Per-platform template descriptions (keyed by platform name)
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [activeTemplatePlatform, setActiveTemplatePlatform] = useState<string | null>(null);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [editingTemplates, setEditingTemplates] = useState<Record<string, string>>({});
  const [savingTemplates, setSavingTemplates] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase('compose');
    setResults([]);
    setTitle(compositionTitle || '');
    setActiveTemplatePlatform(null);

    // Pick default output — prefer mobile
    const mobileOutput = outputs.find((o) => o.layout === 'mobile');
    setSelectedOutputId(mobileOutput?.id || outputs[0]?.id || '');

    // Auto-generate description (only in generate mode)
    if (generationContext && descMode === 'generate') {
      setGenerating(true);
      fetch('/api/social-posts/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generationContext.title,
          trackLabels: generationContext.trackLabels,
          layouts: generationContext.layouts,
          transcript: generationContext.transcript,
        }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => {
          const desc = data.description || '';
          setDescription(desc);
          setGeneratedDescription(desc);
        })
        .catch(() => {
          setDescription('');
          setGeneratedDescription('');
        })
        .finally(() => setGenerating(false));
    }

    // Fetch saved templates
    fetch('/api/templates')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        setTemplates({
          youtube: data.youtubeTemplate || '',
          facebook: data.facebookTemplate || '',
          instagram: data.instagramTemplate || '',
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchPlatforms = async () => {
      setLoadingPlatforms(true);
      try {
        const res = await fetch(`/api/compositions/${compositionId}/publish/platforms`);
        if (!res.ok) throw new Error('Failed to load platforms');
        const data = await res.json();
        if (cancelled) return;
        setPlatforms(data.platforms ?? []);

        const connected = (data.platforms as PlatformInfo[])
          .filter((p) => p.connected)
          .map((p) => p.platform);
        const defaults = (data.defaults as string[]).filter((d) => connected.includes(d));
        setSelectedPlatforms(new Set(defaults.length > 0 ? defaults : connected));
      } catch {
        toast.error('Failed to load publishing platforms');
      } finally {
        if (!cancelled) setLoadingPlatforms(false);
      }
    };

    fetchPlatforms();
    return () => {
      cancelled = true;
    };
  }, [open, compositionId]);

  // Auto-trigger S3 upload for the selected output when modal opens
  const uploadTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      uploadTriggeredRef.current = null;
      return;
    }
    if (!onRequestUpload || !selectedOutputId) return;
    const output = outputs.find((o) => o.id === selectedOutputId);
    if (!output || output.hasS3Key) return;
    // Avoid re-triggering for the same output
    if (uploadTriggeredRef.current === output.layout) return;
    uploadTriggeredRef.current = output.layout;
    onRequestUpload(output.layout);
  }, [open, selectedOutputId, outputs, onRequestUpload]);

  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/social-posts/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generationContext?.title,
          trackLabels: generationContext?.trackLabels,
          layouts: generationContext?.layouts,
          transcript: generationContext?.transcript,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const desc = data.description || '';
        setDescription(desc);
        setGeneratedDescription(desc);
      } else {
        toast.error('Failed to generate description');
      }
    } catch {
      toast.error('Failed to connect to AI service');
    } finally {
      setGenerating(false);
    }
  }, [generationContext]);

  const switchTemplatePlatform = useCallback(
    (platform: string) => {
      setActiveTemplatePlatform(platform);
      setDescription(templates[platform] || '');
    },
    [templates]
  );

  const openTemplateEditor = useCallback(() => {
    // Sync current textarea edits before opening
    const synced = { ...templates };
    if (activeTemplatePlatform) synced[activeTemplatePlatform] = description;
    setEditingTemplates(synced);
    setTemplateEditorOpen(true);
  }, [templates, activeTemplatePlatform, description]);

  const saveTemplateEdits = useCallback(async () => {
    setSavingTemplates(true);
    try {
      const res = await fetch('/api/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeTemplate: editingTemplates.youtube || '',
          facebookTemplate: editingTemplates.facebook || '',
          instagramTemplate: editingTemplates.instagram || '',
        }),
      });
      if (!res.ok) throw new Error();
      setTemplates({ ...editingTemplates });
      // Refresh textarea if viewing a platform that changed
      if (activeTemplatePlatform) {
        setDescription(editingTemplates[activeTemplatePlatform] || '');
      }
      setTemplateEditorOpen(false);
      toast.success('Templates saved');
    } catch {
      toast.error('Failed to save templates');
    } finally {
      setSavingTemplates(false);
    }
  }, [editingTemplates, activeTemplatePlatform]);

  const connectedSelected = platforms.filter(
    (p) => p.connected && selectedPlatforms.has(p.platform)
  );

  const selectedOutput = outputs.find((o) => o.id === selectedOutputId);
  const needsCloudUpload =
    connectedSelected.some((p) => p.supportsVideo) && selectedOutput && !selectedOutput.hasS3Key;

  const canPublish =
    description.trim().length > 0 &&
    connectedSelected.length > 0 &&
    phase === 'compose' &&
    !needsCloudUpload;

  const handlePublish = async () => {
    setPhase('publishing');
    setResults(
      connectedSelected.map((p) => ({
        platform: p.platform,
        success: false,
      }))
    );

    // In template mode, save edits to current platform before building final map
    const finalTemplates = { ...templates };
    if (descMode === 'template' && activeTemplatePlatform) {
      finalTemplates[activeTemplatePlatform] = description.trim();
    }

    // Build per-platform descriptions when in template mode
    let descriptions: Record<string, string> | undefined;
    if (descMode === 'template') {
      descriptions = {};
      for (const p of connectedSelected) {
        descriptions[p.platform] = (finalTemplates[p.platform] || '').trim();
      }
    }

    try {
      const res = await fetch(`/api/compositions/${compositionId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platforms: connectedSelected.map((p) => p.platform),
          title: title.trim() || compositionTitle || 'Reaction Video',
          description: description.trim(),
          ...(descriptions && { descriptions }),
          outputId: selectedOutputId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Publish failed');
        setPhase('compose');
        return;
      }

      const data = await res.json();
      setResults(data.results ?? []);
      setPhase('results');

      const allSuccess = (data.results ?? []).every((r: PublishResult) => r.success);
      const anySuccess = (data.results ?? []).some((r: PublishResult) => r.success);
      if (allSuccess) {
        toast.success('Published to all platforms!');
      } else if (anySuccess) {
        toast.success('Published to some platforms (see details)');
      } else {
        toast.error('Publishing failed');
      }
    } catch {
      toast.error('Network error while publishing');
      setPhase('compose');
    }
  };

  const platformDisplayName = (platform: string) =>
    platforms.find((p) => p.platform === platform)?.displayName ?? platform;

  const LAYOUT_LABELS: Record<string, string> = {
    mobile: '9:16 Portrait',
    landscape: '16:9 Landscape',
  };

  const isGenerating = generating && descMode === 'generate';

  return (
    <Dialog open={open} onOpenChange={phase === 'publishing' ? undefined : onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Publish Video</DialogTitle>
          <DialogDescription className="sr-only">
            Publish your rendered reaction videos to connected social accounts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {phase === 'compose' && (
            <>
              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Video title"
                />
              </div>

              {/* Description mode toggle + content */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Description</label>
                  <div className="flex rounded-md border">
                    <button
                      type="button"
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 text-xs transition-colors',
                        descMode === 'generate'
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                      onClick={() => {
                        // Save current template edits before switching
                        if (descMode === 'template' && activeTemplatePlatform) {
                          setTemplates((prev) => ({
                            ...prev,
                            [activeTemplatePlatform]: description,
                          }));
                        }
                        setDescMode('generate');
                        setDescription(generatedDescription);
                      }}
                    >
                      <Sparkles className="h-3 w-3" />
                      Generate
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'px-2.5 py-1 text-xs transition-colors',
                        descMode === 'template'
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                      onClick={() => {
                        // Save current generated description before switching
                        if (descMode === 'generate') {
                          setGeneratedDescription(description);
                        }
                        setDescMode('template');
                        setGenerating(false);
                        // Default to youtube, or first connected platform
                        const defaultPlatform =
                          connectedSelected.find((p) => p.platform === 'youtube')?.platform ||
                          connectedSelected[0]?.platform ||
                          null;
                        if (defaultPlatform) {
                          setActiveTemplatePlatform(defaultPlatform);
                          setDescription(templates[defaultPlatform] || '');
                        }
                      }}
                    >
                      Template
                    </button>
                  </div>
                </div>

                {/* Template mode: platform pills */}
                {descMode === 'template' && connectedSelected.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {connectedSelected.map((p) => (
                      <button
                        key={p.platform}
                        type="button"
                        onClick={() => {
                          // Save current edits before switching
                          if (activeTemplatePlatform) {
                            setTemplates((prev) => ({
                              ...prev,
                              [activeTemplatePlatform]: description,
                            }));
                          }
                          switchTemplatePlatform(p.platform);
                        }}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          activeTemplatePlatform === p.platform
                            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300'
                            : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {PLATFORM_LABELS[p.platform] || p.displayName}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={openTemplateEditor}
                      className="rounded-full border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      title="Edit default templates"
                    >
                      <Settings className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Description textarea */}
                <div className="relative">
                  <Textarea
                    value={isGenerating ? '' : description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={
                      isGenerating
                        ? ' '
                        : descMode === 'template' && activeTemplatePlatform
                          ? `${PLATFORM_LABELS[activeTemplatePlatform] || activeTemplatePlatform} description...`
                          : 'Video description...'
                    }
                    rows={4}
                    disabled={isGenerating}
                    className={isGenerating ? 'opacity-50' : ''}
                  />
                  {isGenerating && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Sparkles className="h-4 w-4 animate-pulse" />
                        Generating description...
                      </div>
                    </div>
                  )}
                  {!isGenerating && generationContext && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1.5 top-1.5 h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={handleGenerate}
                      title="Generate description with AI"
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Output selector */}
              {outputs.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Video output</label>
                  <div className="grid grid-cols-2 gap-2">
                    {outputs.map((output) => (
                      <button
                        key={output.id}
                        type="button"
                        onClick={() => setSelectedOutputId(output.id)}
                        className={`rounded-lg border p-2 text-left transition-colors ${
                          selectedOutputId === output.id
                            ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950'
                            : 'border-border hover:bg-muted'
                        }`}
                      >
                        <VideoCard
                          size="sm"
                          src={output.s3Url}
                          label={LAYOUT_LABELS[output.layout] || output.layout}
                          controls={false}
                          className="max-w-none pointer-events-none"
                          badge={
                            output.hasS3Key ? (
                              <Badge variant="secondary" className="text-[10px] h-4 gap-0.5">
                                <Video className="h-2.5 w-2.5" />
                                Cloud
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] h-4 gap-0.5">
                                Local
                              </Badge>
                            )
                          }
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Cloud upload status */}
              {needsCloudUpload && (
                <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200">
                  {uploadingLayout ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Uploading render to cloud… Configure your post while it uploads.
                    </span>
                  ) : (
                    'Waiting to upload render to cloud…'
                  )}
                </div>
              )}

              {/* Platform toggles */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Platforms</p>
                {loadingPlatforms ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading platforms...
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {platforms.map((p) => (
                      <button
                        key={p.platform}
                        type="button"
                        disabled={!p.connected}
                        onClick={() => togglePlatform(p.platform)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          !p.connected
                            ? 'cursor-not-allowed border-border text-muted-foreground opacity-50'
                            : selectedPlatforms.has(p.platform)
                              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300'
                              : 'border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        {p.supportsVideo ? (
                          <Video className="h-3 w-3" />
                        ) : (
                          <Type className="h-3 w-3" />
                        )}
                        {p.displayName}
                        {!p.connected && (
                          <span className="text-xs text-muted-foreground">(not connected)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  <Video className="inline h-3 w-3 mr-0.5" /> = video upload &middot;{' '}
                  <Type className="inline h-3 w-3 mr-0.5" /> = text post
                </p>
              </div>
            </>
          )}

          {/* Publishing */}
          {phase === 'publishing' && (
            <div className="space-y-3 py-4">
              {connectedSelected.map((p) => (
                <div key={p.platform} className="flex items-center gap-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span>
                    {p.supportsVideo ? 'Uploading video to' : 'Posting to'} {p.displayName}...
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Video uploads may take a few minutes. Please don&apos;t close this dialog.
              </p>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <div className="space-y-3 py-2">
              {results.map((r) => (
                <div key={r.platform} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    {r.success ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    )}
                    <span>{platformDisplayName(r.platform)}</span>
                  </div>
                  {r.success && r.platformUrl ? (
                    <a
                      href={r.platformUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : !r.success ? (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                      {r.error || 'Failed'}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 gap-2 sm:gap-2">
          {phase === 'compose' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handlePublish} disabled={!canPublish}>
                Publish
              </Button>
            </>
          )}
          {phase === 'results' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>

      {/* Template editor dialog */}
      <Dialog open={templateEditorOpen} onOpenChange={setTemplateEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Default Templates</DialogTitle>
            <DialogDescription className="sr-only">
              Configure default description templates for each platform
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(['youtube', 'facebook', 'instagram'] as const).map((platform) => (
              <div key={platform} className="space-y-1.5">
                <label className="text-sm font-medium">{PLATFORM_LABELS[platform]}</label>
                <Textarea
                  value={editingTemplates[platform] || ''}
                  onChange={(e) =>
                    setEditingTemplates((prev) => ({ ...prev, [platform]: e.target.value }))
                  }
                  placeholder={`Default ${PLATFORM_LABELS[platform]} description...`}
                  rows={3}
                />
              </div>
            ))}
          </div>
          <DialogFooter className="pt-4 gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setTemplateEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveTemplateEdits} disabled={savingTemplates}>
              {savingTemplates ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
