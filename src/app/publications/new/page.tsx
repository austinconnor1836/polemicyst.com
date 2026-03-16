'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function NewPublicationPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), tagline: tagline.trim() || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create publication');
      }

      const publication = await res.json();
      toast.success('Publication created');
      router.push(`/publications/${publication.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-md px-4 py-6 sm:px-6">
      <Link
        href="/publications"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Publications
      </Link>

      <h1 className="mb-6 text-2xl font-bold">Create Publication</h1>

      <form onSubmit={handleCreate} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Publication Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dead Reckoning"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tagline">Tagline (optional)</Label>
          <Input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Navigating political chaos with sharp analysis"
          />
        </div>

        <p className="text-sm text-muted-foreground">
          A starter config document will be generated. You can customize it on the next page.
        </p>

        <Button type="submit" disabled={creating || !name.trim()}>
          {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Publication
        </Button>
      </form>
    </div>
  );
}
