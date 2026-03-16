'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Plus, BookOpen, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface Publication {
  id: string;
  name: string;
  tagline?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { articles: number };
}

export default function PublicationsPage() {
  const { data: session } = useSession();
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPublications = useCallback(async () => {
    try {
      const res = await fetch('/api/publications');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setPublications(data);
    } catch {
      toast.error('Failed to load publications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPublications();
  }, [fetchPublications]);

  const handleDelete = async (pub: Publication) => {
    if (!confirm(`Delete "${pub.name}"? This will also delete all articles.`)) return;
    setDeletingId(pub.id);
    try {
      const res = await fetch(`/api/publications/${pub.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Publication deleted');
      fetchPublications();
    } catch {
      toast.error('Failed to delete publication');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Publications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your publication configs and articles
          </p>
        </div>
        <Link href="/publications/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Publication
          </Button>
        </Link>
      </div>

      {publications.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <BookOpen className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="mb-4 text-muted-foreground">No publications yet</p>
          <Link href="/publications/new">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Create your first publication
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {publications.map((pub) => (
            <div
              key={pub.id}
              className="relative rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              {deletingId === pub.id && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm dark:bg-black/60">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground dark:text-white">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Deleting...
                  </div>
                </div>
              )}
              <Link href={`/publications/${pub.id}`} className="block">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="font-semibold">{pub.name}</h2>
                  {pub.isDefault && (
                    <Badge variant="secondary" className="text-xs">
                      Default
                    </Badge>
                  )}
                </div>
                {pub.tagline && <p className="mb-2 text-sm text-muted-foreground">{pub.tagline}</p>}
                <p className="text-xs text-muted-foreground">
                  {pub._count.articles} article{pub._count.articles !== 1 ? 's' : ''}
                </p>
              </Link>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(pub)}
                  disabled={deletingId === pub.id}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
