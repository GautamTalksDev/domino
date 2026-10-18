import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/siteUrl';

// Read the site URL when served, not when built.
export const dynamic = 'force-dynamic';

// Synthetic demo data only, so the pages may be indexed; the API is not content.
export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/api/' }],
    sitemap: `${await siteUrl()}/sitemap.xml`,
  };
}
