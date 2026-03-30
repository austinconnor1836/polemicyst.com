'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ViralitySettings from '@/components/ViralitySettings';
import {
  DEFAULT_VIRALITY_SETTINGS,
  mergeViralitySettings,
  type LLMProvider,
  type ViralitySettingsValue,
} from '@shared/virality';
import { ThemedToaster } from '@/components/themed-toaster';
import toast from 'react-hot-toast';
import {
  DEFAULT_AUTO_EDIT_SETTINGS,
  mergeAutoEditSettings,
  getAggressivenessConfig,
  type AutoEditSettings,
  type Aggressiveness,
} from '@shared/auto-edit';
import { Zap, Captions, Crop, Send, Share2, Loader2, Save, Info, Wand2 } from 'lucide-react';

type AutomationState = {
  enabled: boolean;
  autoGenerateClips: boolean;
  viralitySettings: ViralitySettingsValue;
  captionsEnabled: boolean;
  captionStyle: string;
  aspectRatio: string;
  cropTemplateId: string | null;
  autoPublish: boolean;
  publishPlatforms: string[];
  autoEditSettings: AutoEditSettings;
};

const INITIAL_STATE: AutomationState = {
  enabled: false,
  autoGenerateClips: true,
  viralitySettings: DEFAULT_VIRALITY_SETTINGS,
  captionsEnabled: true,
  captionStyle: 'default',
  aspectRatio: '9:16',
  cropTemplateId: null,
  autoPublish: false,
  publishPlatforms: [],
  autoEditSettings: DEFAULT_AUTO_EDIT_SETTINGS,
};

type SocialPlatformInfo = {
  platform: string;
  displayName: string;
  connected: boolean;
};

export default function AutomationSettingsPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [state, setState] = useState<AutomationState>(INITIAL_STATE);
  const [serverState, setServerState] = useState<AutomationState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultLLMProvider, setDefaultLLMProvider] = useState<LLMProvider>('ollama');
  const [socialPlatforms, setSocialPlatforms] = useState<SocialPlatformInfo[]>([]);
  const [defaultPublishPlatforms, setDefaultPublishPlatforms] = useState<string[]>([]);
  const [serverDefaultPublishPlatforms, setServerDefaultPublishPlatforms] = useState<string[]>([]);

  const isDirty =
    JSON.stringify(state) !== JSON.stringify(serverState) ||
    JSON.stringify(defaultPublishPlatforms) !== JSON.stringify(serverDefaultPublishPlatforms);

  const fetchSettings = useCallback(async () => {
    try {
      const [automationRes, providerRes, platformsRes] = await Promise.all([
        fetch('/api/user/automation'),
        fetch('/api/user/llm-provider'),
        fetch('/api/social-posts/platforms'),
      ]);

      if (automationRes.ok) {
        const data = await automationRes.json();
        const merged: AutomationState = {
          enabled: data.enabled ?? false,
          autoGenerateClips: data.autoGenerateClips ?? true,
          viralitySettings: mergeViralitySettings(data.viralitySettings),
          captionsEnabled: data.captionsEnabled ?? true,
          captionStyle: data.captionStyle ?? 'default',
          aspectRatio: data.aspectRatio ?? '9:16',
          cropTemplateId: data.cropTemplateId ?? null,
          autoPublish: data.autoPublish ?? false,
          publishPlatforms: data.publishPlatforms ?? [],
          autoEditSettings: mergeAutoEditSettings(data.autoEditSettings),
        };
        setState(merged);
        setServerState(merged);
      }

      if (providerRes.ok) {
        const providerData = await providerRes.json();
        setDefaultLLMProvider(providerData.llmProvider === 'ollama' ? 'ollama' : 'gemini');
      }

      if (platformsRes.ok) {
        const platformData = await platformsRes.json();
        setSocialPlatforms(platformData.platforms ?? []);
        const defaults = platformData.defaults ?? [];
        setDefaultPublishPlatforms(defaults);
        setServerDefaultPublishPlatforms(defaults);
      }
    } catch {
      toast.error('Failed to load automation settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (sessionStatus === 'authenticated') {
      fetchSettings();
    }
  }, [sessionStatus, router, fetchSettings]);

  async function handleSave() {
    setSaving(true);
    try {
      const [res, defaultsRes] = await Promise.all([
        fetch('/api/user/automation', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
        }),
        fetch('/api/user/publish-defaults', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platforms: defaultPublishPlatforms }),
        }),
      ]);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Save failed' }));
        toast.error(err.error || 'Failed to save');
        return;
      }

      const data = await res.json();
      const saved: AutomationState = {
        enabled: data.enabled,
        autoGenerateClips: data.autoGenerateClips,
        viralitySettings: mergeViralitySettings(data.viralitySettings),
        captionsEnabled: data.captionsEnabled,
        captionStyle: data.captionStyle,
        aspectRatio: data.aspectRatio,
        cropTemplateId: data.cropTemplateId,
        autoPublish: data.autoPublish,
        publishPlatforms: data.publishPlatforms ?? [],
        autoEditSettings: mergeAutoEditSettings(data.autoEditSettings),
      };
      setState(saved);
      setServerState(saved);

      if (defaultsRes.ok) {
        const defaultsData = await defaultsRes.json();
        const savedDefaults = defaultsData.platforms ?? [];
        setDefaultPublishPlatforms(savedDefaults);
        setServerDefaultPublishPlatforms(savedDefaults);
      }

      toast.success('Automation settings saved');
    } catch {
      toast.error('Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(platform: string) {
    setState((prev) => {
      const platforms = prev.publishPlatforms.includes(platform)
        ? prev.publishPlatforms.filter((p) => p !== platform)
        : [...prev.publishPlatforms, platform];
      return { ...prev, publishPlatforms: platforms };
    });
  }

  function toggleDefaultPublishPlatform(platform: string) {
    setDefaultPublishPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  }

  if (sessionStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center glass:bg-transparent">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-16 glass:bg-transparent">
      <ThemedToaster position="top-center" />
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Automation</h1>
            <p className="mt-1 text-sm text-muted">
              Configure what happens when new videos appear on your monitored sources.
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save
              </>
            )}
          </Button>
        </div>

        {/* Master toggle */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary glass:bg-white/10 glass:text-white">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Full Automation
                    {state.enabled && <Badge>Active</Badge>}
                  </CardTitle>
                  <CardDescription>
                    Automatically process every new video from all monitored sources
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={state.enabled}
                onCheckedChange={(checked) => setState((p) => ({ ...p, enabled: !!checked }))}
              />
            </div>
          </CardHeader>
          {state.enabled && (
            <CardContent>
              <div className="flex items-start gap-2 rounded-md border border-border bg-surface/50 p-3 text-sm text-muted glass:bg-white/[0.04] glass:border-white/10">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  When a new video is detected on any of your feeds, the settings below will be
                  applied automatically. Individual feeds can override these defaults via their
                  source settings.
                </span>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Clip Generation */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary glass:bg-white/10 glass:text-white">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle>Clip Generation</CardTitle>
                  <CardDescription>
                    Default scoring and selection settings for new clips
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={state.autoGenerateClips}
                onCheckedChange={(checked) =>
                  setState((p) => ({ ...p, autoGenerateClips: !!checked }))
                }
              />
            </div>
          </CardHeader>
          {state.autoGenerateClips && (
            <CardContent>
              <ViralitySettings
                value={state.viralitySettings}
                onChange={(next) => setState((p) => ({ ...p, viralitySettings: next }))}
                defaultLLMProvider={defaultLLMProvider}
              />
            </CardContent>
          )}
        </Card>

        {/* Captions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary glass:bg-white/10 glass:text-white">
                  <Captions className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle>Captions</CardTitle>
                  <CardDescription>Auto-apply captions to generated clips</CardDescription>
                </div>
              </div>
              <Switch
                checked={state.captionsEnabled}
                onCheckedChange={(checked) =>
                  setState((p) => ({ ...p, captionsEnabled: !!checked }))
                }
              />
            </div>
          </CardHeader>
          {state.captionsEnabled && (
            <CardContent>
              <div className="space-y-2">
                <Label>Caption style</Label>
                <Select
                  value={state.captionStyle}
                  onValueChange={(v) => setState((p) => ({ ...p, captionStyle: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a style" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="bold">Bold</SelectItem>
                    <SelectItem value="minimal">Minimal</SelectItem>
                    <SelectItem value="none">None (transcript only)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted">
                  Controls the visual style of burned-in captions on generated clips.
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Aspect Ratio */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary glass:bg-white/10 glass:text-white">
                <Crop className="h-4 w-4" />
              </div>
              <div>
                <CardTitle>Aspect Ratio</CardTitle>
                <CardDescription>Default crop format for generated clips</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Output aspect ratio</Label>
              <Select
                value={state.aspectRatio}
                onValueChange={(v) => setState((p) => ({ ...p, aspectRatio: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select aspect ratio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 (Reels / Shorts / TikTok)</SelectItem>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  <SelectItem value="4:5">4:5 (Instagram Feed)</SelectItem>
                  <SelectItem value="16:9">16:9 (Landscape / YouTube)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted">
                Clips will be cropped to this ratio. You can override per-clip after generation.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Auto-Edit Defaults */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary glass:bg-white/10 glass:text-white">
                <Wand2 className="h-4 w-4" />
              </div>
              <div>
                <CardTitle>Auto-Edit Defaults</CardTitle>
                <CardDescription>
                  Default settings when using Auto-Edit on reaction compositions
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Aggressiveness</Label>
                <Select
                  value={state.autoEditSettings.aggressiveness}
                  onValueChange={(v) => {
                    const aggressiveness = v as Aggressiveness;
                    const config = getAggressivenessConfig(aggressiveness);
                    setState((p) => ({
                      ...p,
                      autoEditSettings: {
                        ...p.autoEditSettings,
                        aggressiveness,
                        minSilenceToKeepS: config.minSilenceToKeepS,
                      },
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative (keep more pauses)</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="aggressive">Aggressive (tighter cuts)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted">
                  Controls how aggressively silence and dead space are removed.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Minimum pause to keep</Label>
                  <span className="text-xs text-muted tabular-nums">
                    {state.autoEditSettings.minSilenceToKeepS.toFixed(2)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.25}
                  value={state.autoEditSettings.minSilenceToKeepS}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      autoEditSettings: {
                        ...p.autoEditSettings,
                        minSilenceToKeepS: parseFloat(e.target.value),
                      },
                    }))
                  }
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted">
                  Buffer kept on each side of a silence cut for natural pacing.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Bad take detection</Label>
                  <p className="text-xs text-muted">
                    Detect and remove repeated phrases and false starts
                  </p>
                </div>
                <Switch
                  checked={state.autoEditSettings.badTakeDetection}
                  onCheckedChange={(checked) =>
                    setState((p) => ({
                      ...p,
                      autoEditSettings: { ...p.autoEditSettings, badTakeDetection: !!checked },
                    }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Auto-publish */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary glass:bg-white/10 glass:text-white">
                  <Send className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle>Auto-Publish</CardTitle>
                  <CardDescription>
                    Automatically publish top clips to connected platforms
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={state.autoPublish}
                onCheckedChange={(checked) => setState((p) => ({ ...p, autoPublish: !!checked }))}
              />
            </div>
          </CardHeader>
          {state.autoPublish && (
            <CardContent>
              <div className="space-y-3">
                <Label>Publish to</Label>
                <div className="flex flex-wrap gap-2">
                  {(['youtube', 'reels', 'shorts', 'tiktok', 'twitter'] as const).map(
                    (platform) => {
                      const active = state.publishPlatforms.includes(platform);
                      return (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => togglePlatform(platform)}
                          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                            active
                              ? 'border-primary bg-primary/10 text-primary glass:border-white/30 glass:bg-white/15 glass:text-white'
                              : 'border-border text-muted hover:border-primary/50 hover:text-foreground glass:border-white/10 glass:text-zinc-400 glass:hover:border-white/25 glass:hover:text-zinc-200'
                          }`}
                        >
                          {platform === 'youtube'
                            ? 'YouTube'
                            : platform === 'reels'
                              ? 'IG/FB Reels'
                              : platform === 'shorts'
                                ? 'YouTube Shorts'
                                : platform === 'tiktok'
                                  ? 'TikTok'
                                  : 'Twitter/X'}
                        </button>
                      );
                    }
                  )}
                </div>
                <p className="text-xs text-muted">
                  Selected platforms must have a connected account. Clips scoring above the
                  strictness threshold will be queued for publishing.
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Default Publish Platforms */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary glass:bg-white/10 glass:text-white">
                <Share2 className="h-4 w-4" />
              </div>
              <div>
                <CardTitle>Default Publish Platforms</CardTitle>
                <CardDescription>
                  Pre-selected platforms when sharing videos to social accounts
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Label>Pre-select when publishing</Label>
              <div className="flex flex-wrap gap-2">
                {socialPlatforms.map((p) => {
                  const active = defaultPublishPlatforms.includes(p.platform);
                  return (
                    <button
                      key={p.platform}
                      type="button"
                      onClick={() => toggleDefaultPublishPlatform(p.platform)}
                      disabled={!p.connected}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        !p.connected
                          ? 'cursor-not-allowed border-border/50 text-muted/50 glass:border-white/5 glass:text-zinc-600'
                          : active
                            ? 'border-primary bg-primary/10 text-primary glass:border-white/30 glass:bg-white/15 glass:text-white'
                            : 'border-border text-muted hover:border-primary/50 hover:text-foreground glass:border-white/10 glass:text-zinc-400 glass:hover:border-white/25 glass:hover:text-zinc-200'
                      }`}
                    >
                      {p.displayName}
                      {!p.connected && (
                        <span className="ml-1 text-xs opacity-60">(not connected)</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted">
                These platforms will be pre-selected in the publish dialog. You can still change the
                selection before publishing.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sticky save bar for mobile */}
        {isDirty && (
          <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/80 p-4 backdrop-blur-lg glass:bg-black/60 glass:border-white/10 sm:hidden">
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
