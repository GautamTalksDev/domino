import { headers } from 'next/headers';

/**
 * The public URL of this deployment: DOMINO_SITE_URL, else Vercel's production URL, else the host the request came to
 * (so a self-hosted deployment's sitemap and robots.txt point at itself, not at localhost).
 */
export async function siteUrl(): Promise<string> {
  if (process.env.DOMINO_SITE_URL) return process.env.DOMINO_SITE_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000').split(',')[0].trim();
  // Only a plain host name (and port) is used; anything else falls back to localhost.
  const safe = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host : 'localhost:3000';
  const proto = h.get('x-forwarded-proto')?.split(',')[0].trim() === 'https' || !/^(localhost|127\.|\[::1\])/.test(safe) ? 'https' : 'http';
  return `${proto}://${safe}`;
}
