'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Loader2, Save } from 'lucide-react';

interface PublicationConfigEditorProps {
  publicationId: string;
  initialName: string;
  initialTagline: string;
  initialConfigMarkdown: string;
  onSave?: () => void;
}

export default function PublicationConfigEditor({
  publicationId,
  initialName,
  initialTagline,
  initialConfigMarkdown,
  onSave,
}: PublicationConfigEditorProps) {
  const [name, setName] = useState(initialName);
  const [tagline, setTagline] = useState(initialTagline);
  const [configMarkdown, setConfigMarkdown] = useState(initialConfigMarkdown);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const hasChanges =
      name !== initialName ||
      tagline !== initialTagline ||
      configMarkdown !== initialConfigMarkdown;
    setDirty(hasChanges);
  }, [name, tagline, configMarkdown, initialName, initialTagline, initialConfigMarkdown]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/publications/${publicationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tagline, configMarkdown }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setDirty(false);
      onSave?.();
    } catch (err) {
      console.error('Save failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [publicationId, name, tagline, configMarkdown, onSave]);

  // Parse some preview info from the config
  const previewLines = configMarkdown.split('\n');
  const voiceLine = previewLines.find((l) => l.match(/^-\s*tone:/i));
  const accentLine = previewLines.find((l) => l.match(/^-\s*accentColor:/i));
  const headerFontLine = previewLines.find((l) => l.match(/^-\s*headerFont:/i));
  const frameworkCount = previewLines.filter((l) => l.match(/^###\s*Framework:/i)).length;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Editor */}
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pub-name">Publication Name</Label>
            <Input
              id="pub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Publication"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pub-tagline">Tagline</Label>
            <Input
              id="pub-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Your tagline"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pub-config">Publication Config (Markdown)</Label>
          <Textarea
            id="pub-config"
            value={configMarkdown}
            onChange={(e) => setConfigMarkdown(e.target.value)}
            className="min-h-[500px] font-mono text-sm"
            placeholder="Enter your publication config markdown..."
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Config
          </Button>
          {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        </div>
      </div>

      {/* Preview sidebar */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/50 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Config Preview
          </h3>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium">Name</dt>
              <dd className="text-muted-foreground">{name || '—'}</dd>
            </div>
            <div>
              <dt className="font-medium">Tagline</dt>
              <dd className="text-muted-foreground">{tagline || '—'}</dd>
            </div>
            {voiceLine && (
              <div>
                <dt className="font-medium">Voice</dt>
                <dd className="text-muted-foreground">{voiceLine.replace(/^-\s*tone:\s*/i, '')}</dd>
              </div>
            )}
            {accentLine && (
              <div>
                <dt className="font-medium">Accent Color</dt>
                <dd className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className="inline-block h-4 w-4 rounded border"
                    style={{
                      backgroundColor: accentLine.replace(/^-\s*accentColor:\s*/i, '').trim(),
                    }}
                    aria-hidden="true"
                  />
                  {accentLine.replace(/^-\s*accentColor:\s*/i, '').trim()}
                </dd>
              </div>
            )}
            {headerFontLine && (
              <div>
                <dt className="font-medium">Header Font</dt>
                <dd className="text-muted-foreground">
                  {headerFontLine.replace(/^-\s*headerFont:\s*/i, '').trim()}
                </dd>
              </div>
            )}
            <div>
              <dt className="font-medium">Frameworks</dt>
              <dd className="text-muted-foreground">
                {frameworkCount > 0 ? `${frameworkCount} defined` : 'None'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
