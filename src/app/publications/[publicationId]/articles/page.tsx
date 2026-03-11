'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, ArrowLeft, Loader2, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import ArticleCard from '../_components/ArticleCard';

interface Article {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Publication {
  id: string;
  name: string;
}

export default function ArticlesPage() {
  const params = useParams();
  const publicationId = params.publicationId as string;
  const [articles, setArticles] = useState<Article[]>([]);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [pubRes, articlesRes] = await Promise.all([
        fetch(`/api/publications/${publicationId}`),
        fetch(`/api/articles?publicationId=${publicationId}`),
      ]);
      if (pubRes.ok) setPublication(await pubRes.json());
      if (articlesRes.ok) setArticles(await articlesRes.json());
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
          <Link
            href={`/publications/${publicationId}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to {publication?.name || 'Publication'}
          </Link>
          <h1 className="text-2xl font-bold">Articles</h1>
        </div>
        <Link href={`/publications/${publicationId}/articles/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Article
          </Button>
        </Link>
      </div>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <BookOpen className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="mb-4 text-muted-foreground">No articles yet</p>
          <Link href={`/publications/${publicationId}/articles/new`}>
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Create your first article
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} publicationId={publicationId} />
          ))}
        </div>
      )}
    </div>
  );
}
