import type { LLMCostMeta } from '../scoring/llm-types';

// ── Publication ─────────────────────────────────────────────────────────

export type PublicationConfig = {
  id: string;
  userId: string;
  name: string;
  tagline?: string | null;
  configMarkdown: string;
  configJson?: Record<string, unknown> | null;
  substackUrl?: string | null;
  substackConnected: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ── Article ─────────────────────────────────────────────────────────────

export type ArticleStatus = 'draft' | 'generating' | 'review' | 'published';
export type ArticleSourceType = 'feedVideo' | 'url' | 'manual';

export type ArticleData = {
  id: string;
  publicationId: string;
  userId: string;
  title: string;
  subtitle?: string | null;
  bodyMarkdown?: string | null;
  bodyHtml?: string | null;
  sourceType?: ArticleSourceType | null;
  sourceId?: string | null;
  sourceContext?: Record<string, unknown> | null;
  generationModel?: string | null;
  status: ArticleStatus;
  substackPostId?: string | null;
  publishedAt?: Date | null;
  tags?: string[] | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── Article Graphic ─────────────────────────────────────────────────────

export type GraphicType = 'hero' | 'pull-quote' | 'masthead' | 'divider';

export type ArticleGraphicData = {
  id: string;
  articleId: string;
  type: GraphicType;
  label?: string | null;
  htmlContent?: string | null;
  s3Key?: string | null;
  s3Url?: string | null;
  config?: Record<string, unknown> | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

// ── Generation params ───────────────────────────────────────────────────

export type GenerateArticleParams = {
  publicationConfigMarkdown: string;
  topic: string;
  sourceContent?: string;
  sourceType?: ArticleSourceType;
  instructions?: string;
};

export type GenerateArticleResult = {
  title: string;
  subtitle?: string;
  bodyMarkdown: string;
  bodyHtml: string;
  tags?: string[];
  _cost: LLMCostMeta;
};

export type GenerateGraphicsParams = {
  publicationConfigMarkdown: string;
  articleTitle: string;
  articleBody: string;
  types?: GraphicType[];
};

export type GraphicResult = {
  type: GraphicType;
  label: string;
  htmlContent: string;
};

export type GenerateGraphicsResult = {
  graphics: GraphicResult[];
  _cost: LLMCostMeta;
};
