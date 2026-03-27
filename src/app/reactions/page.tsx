'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Loader2 } from 'lucide-react';
import { CompositionCard } from './_components/CompositionCard';
import toast from 'react-hot-toast';

interface Composition {
  id: string;
  title: string;
  mode: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  tracks: { id: string }[];
  outputs: { id: string; layout: string; status: string; s3Url?: string | null }[];
}

export default function ReactionsPage() {
  const router = useRouter();
  const [compositions, setCompositions] = useState<Composition[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchCompositions = useCallback(async () => {
    try {
      const res = await fetch('/api/compositions');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setCompositions(data);
    } catch (err) {
      console.error('Failed to load compositions:', err);
      toast.error('Failed to load compositions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompositions();
  }, [fetchCompositions]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to create');
      const composition = await res.json();
      router.push(`/reactions/${composition.id}`);
    } catch (err) {
      toast.error('Failed to create composition');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this composition?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/compositions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Composition deleted');
      setCompositions((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast.error('Failed to delete composition');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Reaction Videos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compose reaction videos with your commentary alongside reference clips
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          New Composition
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : compositions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg font-medium text-muted-foreground">No compositions yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create your first reaction video composition to get started
          </p>
          <Button onClick={handleCreate} className="mt-4" disabled={creating}>
            <Plus className="mr-2 h-4 w-4" />
            Create Composition
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {compositions.map((c) => (
            <CompositionCard
              key={c.id}
              composition={c}
              deletingId={deletingId}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
