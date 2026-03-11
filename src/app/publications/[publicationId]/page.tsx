'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import PublicationConfigEditor from './_components/PublicationConfigEditor';

interface Publication {
  id: string;
  name: string;
  tagline: string | null;
  configMarkdown: string;
  substackConnected: boolean;
  substackUrl: string | null;
  articles: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export default function EditPublicationPage() {
  const params = useParams();
  const publicationId = params.publicationId as string;
  const [publication, setPublication] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPublication = useCallback(async () => {
    try {
      const res = await fetch(`/api/publications/${publicationId}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setPublication(data);
    } catch {
      toast.error('Failed to load publication');
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  useEffect(() => {
    fetchPublication();
  }, [fetchPublication]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!publication) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Publication not found</p>
        <Link href="/publications" className="text-sm underline">
          Back to Publications
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/publications"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Publications
          </Link>
          <h1 className="text-2xl font-bold">{publication.name}</h1>
          {publication.tagline && (
            <p className="mt-1 text-sm text-muted-foreground">{publication.tagline}</p>
          )}
        </div>
        <Link
          href={`/publications/${publicationId}/articles`}
          className="text-sm font-medium underline"
        >
          View Articles ({publication.articles.length})
        </Link>
      </div>

      <PublicationConfigEditor
        publicationId={publicationId}
        initialName={publication.name}
        initialTagline={publication.tagline || ''}
        initialConfigMarkdown={publication.configMarkdown}
        onSave={fetchPublication}
      />
    </div>
  );
}
