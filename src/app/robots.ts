import type { MetadataRoute } from 'next';

const baseUrl = process.env.NEXTAUTH_URL ?? 'https://polemicyst.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/billing',
          '/connected-accounts',
          '/reactions',
          '/details',
          '/clips',
          '/auth/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
