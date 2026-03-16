import { z } from 'zod';

export const ConnectSubstackSchema = z.object({
  cookie: z.string().min(1, 'Session cookie is required'),
  subdomain: z
    .string()
    .min(1, 'Subdomain is required')
    .regex(/^[a-z0-9-]+$/, 'Invalid subdomain format'),
});

export const ConnectPublishingAccountSchema = z.object({
  platform: z.enum(['substack', 'medium', 'ghost', 'wordpress']),
  cookie: z.string().min(1, 'Session cookie is required'),
  subdomain: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Invalid subdomain format')
    .optional(),
});

export const PublishArticleSchema = z.object({
  publishingAccountId: z.string().min(1).optional(),
  publishLive: z.boolean().optional().default(false),
});

export type ConnectSubstackInput = z.infer<typeof ConnectSubstackSchema>;
export type ConnectPublishingAccountInput = z.infer<typeof ConnectPublishingAccountSchema>;
export type PublishArticleInput = z.infer<typeof PublishArticleSchema>;
