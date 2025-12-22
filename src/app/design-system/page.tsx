'use client';

import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import AspectRatioSelect, { type AspectRatio } from '@/components/AspectRatioSelect';
import ViralitySettings, { type ViralitySettingsValue } from '@/components/ViralitySettings';
import { ActionHeader } from '@/components/ActionHeader';
import { cn } from '@/lib/utils';

const surfaceTokens = [
  {
    label: 'Background',
    description: 'Page canvas / neutral surface',
    className: 'bg-[#F9F9F9] text-[#2E2E2E] dark:bg-[#121212] dark:text-[#E0E0E0]',
  },
  {
    label: 'Card',
    description: 'Raised containers',
    className: 'bg-white text-slate-900 dark:bg-zinc-950 dark:text-zinc-50',
  },
  {
    label: 'Muted',
    description: 'Subtle fills for controls',
    className: 'bg-muted text-muted-foreground',
  },
  {
    label: 'Border',
    description: 'Hairlines + outlines',
    className:
      'border border-gray-200 bg-white text-gray-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
  },
];

const buttonShowcase = [
  { variant: 'default' as const, label: 'Primary' },
  { variant: 'secondary' as const, label: 'Secondary' },
  { variant: 'outline' as const, label: 'Outline' },
  { variant: 'ghost' as const, label: 'Ghost' },
  { variant: 'link' as const, label: 'Link' },
  { variant: 'destructive' as const, label: 'Destructive' },
];

const badgeShowcase = [
  { variant: 'secondary' as const, label: 'Secondary' },
  { variant: 'outline' as const, label: 'Outline' },
  { variant: 'default' as const, label: 'Default' },
];

export default function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [viralitySettings, setViralitySettings] = useState<ViralitySettingsValue>({
    scoringMode: 'hybrid',
    strictnessPreset: 'balanced',
    includeAudio: false,
    saferClips: true,
    targetPlatform: 'reels',
    contentStyle: 'auto',
    showAdvanced: false,
  });
  const [notifications, setNotifications] = useState(true);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
      <header className="rounded-2xl border bg-gradient-to-br from-white to-gray-50 p-8 shadow-sm dark:from-[#181818] dark:to-[#121212]">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            System
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Polemicyst Design System</h1>
          <p className="text-muted-foreground max-w-2xl">
            Shared primitives for the clips + feeds experiences. Use these reference patterns before
            creating new UI so pages stay visually consistent.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Badge variant="secondary">Dark-ready</Badge>
          <Badge variant="outline">Tailwind-first</Badge>
          <Badge>Dialog spacing pattern</Badge>
        </div>
      </header>

      <Section
        title="Surfaces & tokens"
        description="Core backgrounds, borders, and text pairings."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {surfaceTokens.map((token) => (
            <div key={token.label} className="space-y-3 rounded-xl border border-dashed p-4">
              <div
                className={cn(
                  'flex h-24 items-center justify-center rounded-lg border text-sm font-medium',
                  token.className
                )}
              >
                {token.label}
              </div>
              <p className="text-sm text-muted-foreground">{token.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Buttons & badges"
        description="All CTAs come from the shared Button + Badge primitives."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium text-muted-foreground">Buttons</p>
            <div className="flex flex-wrap gap-3">
              {buttonShowcase.map((button) => (
                <Button key={button.variant} variant={button.variant} size="default">
                  {button.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium text-muted-foreground">Badges</p>
            <div className="flex flex-wrap gap-3">
              {badgeShowcase.map((badge) => (
                <Badge key={badge.variant} variant={badge.variant}>
                  {badge.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">Button sizing</p>
          <div className="flex flex-wrap items-center gap-4">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Example icon button">
              <span className="text-lg leading-none">⌘</span>
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Form controls"
        description="Inputs, selects, and switches with consistent label spacing."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label htmlFor="sourceName">Source name</Label>
              <Input id="sourceName" placeholder="Longform podcast feed" />
              <p className="text-xs text-muted-foreground">
                Use descriptive names to scan feeds in the list quickly.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="interval">Polling interval</Label>
              <Input id="interval" type="number" min={5} defaultValue={60} />
            </div>
          </div>
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>Destination</Label>
              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="Select destination" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All feeds</SelectItem>
                  <SelectItem value="clips">Clip-ready</SelectItem>
                  <SelectItem value="manual">Manual uploads</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Notifications</p>
                <p className="text-xs text-muted-foreground">
                  Alert me when a clip finishes rendering.
                </p>
              </div>
              <Switch checked={notifications} onCheckedChange={setNotifications} />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Cards & headers"
        description="Use Card + ActionHeader for dense, high-signal modules."
      >
        <Card className="border border-dashed">
          <CardHeader>
            <ActionHeader
              title="Ingested videos"
              actionLabel="Refresh"
              loadingLabel="Refreshing"
              loading={false}
              onAction={() => {}}
            />
            <CardDescription className="mt-2">
              Quick summary block: pair{' '}
              <code
                className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'px-1 py-0 text-xs')}
              >
                ActionHeader
              </code>{' '}
              with Card subtext to align with the Feeds page hero.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {['Clips queued', 'Segments scored', 'Manual uploads'].map((metric) => (
              <div
                key={metric}
                className="rounded-lg border border-gray-200 p-4 dark:border-zinc-800"
              >
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{metric}</p>
                <p className="mt-2 text-3xl font-semibold">24</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Dialog blueprint"
        description="Standard spacing: header → space-y body wrapper → footer."
      >
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>Open clip settings</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="leading-snug">Selected video</DialogTitle>
              <DialogDescription>
                Demonstrates the same structure powering the feeds modal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 py-1.5">
                <Badge variant="secondary">Manual upload</Badge>
                <Badge variant="outline">Added 5m ago</Badge>
              </div>
              <div className="flex aspect-video w-full flex-col items-center justify-center rounded bg-black/5 p-4">
                <img
                  src="https://placehold.co/640x360/png"
                  alt="Thumbnail fallback"
                  className="max-h-[35vh] w-full rounded object-contain"
                />
                <div className="mt-2 text-xs text-muted-foreground">
                  Use thumbnails for remote sources without preview.
                </div>
              </div>
              <AspectRatioSelect value={aspectRatio} onChange={setAspectRatio} />
              <ViralitySettings value={viralitySettings} onChange={setViralitySettings} />
            </div>
            <DialogFooter className="gap-2 pt-4 sm:gap-2">
              <Button>Generate clip</Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-1">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
