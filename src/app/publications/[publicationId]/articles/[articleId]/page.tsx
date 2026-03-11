'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import ArticleEditor from '../../_components/ArticleEditor';

interface ArticleGraphic {
  id: string;
  type: string;
  label: string | null;
  htmlContent: string | null;
  s3Url: string | null;
  position: number;
}

interface Article {
  id: string;
  title: string;
  subtitle: string | null;
  bodyMarkdown: string | null;
  bodyHtml: string | null;
  status: string;
  generationModel: string | null;
  substackDraftId: string | null;
  publishError: string | null;
  createdAt: string;
  updatedAt: string;
  graphics: ArticleGraphic[];
  publication: {
    id: string;
    name: string;
    configMarkdown: string;
    substackConnected?: boolean;
    substackUrl?: string | null;
  };
}

export default function ArticleDetailPage() {
  const params = useParams();
  const publicationId = params.publicationId as string;
  const articleId = params.articleId as string;
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchArticle = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${articleId}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setArticle(data);
    } catch {
      toast.error('Failed to load article');
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    fetchArticle();
  }, [fetchArticle]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Article not found</p>
        <Link href={`/publications/${publicationId}/articles`} className="text-sm underline">
          Back to Articles
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          href={`/publications/${publicationId}/articles`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Articles
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{article.title}</h1>
          <Badge variant="secondary">{article.status}</Badge>
        </div>
        {article.subtitle && <p className="mt-1 text-muted-foreground">{article.subtitle}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          {article.publication.name}
          {article.generationModel && ` \u00B7 Generated with ${article.generationModel}`}
        </p>
      </div>

      <ArticleEditor article={article} onUpdate={fetchArticle} />
    </div>
  );
}
