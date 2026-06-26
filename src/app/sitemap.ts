import type { MetadataRoute } from 'next';

const baseUrl = process.env.NEXTAUTH_URL ?? 'https://polemicyst.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-06-12');
  return [
    { url: `${baseUrl}/`, lastModified, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/pricing`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/status`, lastModified, changeFrequency: 'always', priority: 0.4 },
    { url: `${baseUrl}/changelog`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${baseUrl}/privacy-policy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/terms-of-service`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/legal/dmca`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
