import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/siteUrl';

// Read the site URL when served, not when built.
export const dynamic = 'force-dynamic';

const PAGES = ['', '/patients', '/patients/p-beatrice', '/inbox', '/team', '/check', '/ehr', '/checkup', '/population', '/graph', '/evaluation', '/how'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  return PAGES.map((p) => ({ url: `${base}${p}`, changeFrequency: 'weekly', priority: p === '' ? 1 : 0.6 }));
}
