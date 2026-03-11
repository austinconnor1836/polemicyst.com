'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function NewArticlePage() {
  const params = useParams();
  const publicationId = params.publicationId as string;
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicationId,
          title: title.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create article');
      }

      const article = await res.json();
      toast.success('Article created');
      router.push(`/publications/${publicationId}/articles/${article.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-md px-4 py-6 sm:px-6">
      <Link
        href={`/publications/${publicationId}/articles`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Articles
      </Link>

      <h1 className="mb-6 text-2xl font-bold">New Article</h1>

      <form onSubmit={handleCreate} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Working Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. The Constitutional Crisis Nobody Saw Coming"
            required
          />
          <p className="text-xs text-muted-foreground">
            You can change this later. AI generation can also suggest a better title.
          </p>
        </div>

        <Button type="submit" disabled={creating || !title.trim()}>
          {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Article
        </Button>
      </form>
    </div>
  );
}
