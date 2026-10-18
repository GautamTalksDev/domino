import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '@fontsource-variable/fraunces/full.css';
import './globals.css';
import { Nav } from '@/components/Nav';
import { UnlockDialog } from '@/components/UnlockDialog';
import { Toaster } from '@/components/Toaster';
import { JudgeTour } from '@/components/JudgeTour';
import { CLINICS, USERS, clinicById, currentScope, userById } from '@/lib/tenant';
import { siteUrl } from '@/lib/siteUrl';

const META: Metadata = {
  title: { default: 'Domino: find the pill that is treating another pill', template: '%s · Domino' },
  description:
    'Domino is a team of AI agents that walk a FalkorDB medication graph to find prescribing cascades in older adults, prove every link, and draft the review for a pharmacist.',
  applicationName: 'Domino',
  openGraph: {
    type: 'website',
    siteName: 'Domino',
    title: 'Domino: some pills are treating other pills',
    description:
      'AI agents walk a FalkorDB medication graph to find prescribing cascades in older adults, prove every link, remember what the care team decides, and stop the next cascade before it is written.',
  },
  twitter: { card: 'summary_large_image', title: 'Domino: some pills are treating other pills' },
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }], apple: '/apple-icon.png' },
};

// The share card and icons resolve against this deployment's own URL (see src/lib/siteUrl.ts), not localhost.
export async function generateMetadata(): Promise<Metadata> {
  return { ...META, metadataBase: new URL(await siteUrl()) };
}

export const viewport: Viewport = { themeColor: '#0d0c10', colorScheme: 'dark' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes every page render per request, so Next.js can stamp
  // its scripts with the CSP nonce set in proxy.ts.
  await headers();
  const s = await currentScope();
  const clinic = clinicById(s.clinic)!;
  const user = userById(s.user)!;
  const scope = {
    clinic: { id: clinic.id, name: clinic.name, short: clinic.short },
    user: { id: user.id, name: user.name, role: user.role, title: user.title },
    clinics: CLINICS.map((c) => ({ id: c.id, name: c.name, short: c.short, blurb: c.blurb })),
    users: USERS,
  };
  return (
    // data-scroll-behavior: smooth scrolling for in-page links, but an instant jump to the top on page navigation.
    <html lang="en" data-scroll-behavior="smooth" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 btn btn-primary">
          Skip to content
        </a>
        <Nav scope={scope} />
        <main id="main" className="rise mx-auto w-full max-w-[1360px] flex-1 px-4 pb-24 sm:px-6">
          {children}
        </main>
        <UnlockDialog />
        <Toaster />
        <JudgeTour />
        <div aria-hidden className="grain" />
        <footer className="no-print border-t hairline">
          <div className="mx-auto flex max-w-[1360px] flex-col gap-2 px-4 py-8 text-xs text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              Synthetic data only. Domino is decision support for clinicians to review, not medical advice. It never tells anyone to stop or change a medicine.
            </p>
            <p className="mono">Built on FalkorDB · Graph Hacks 2026</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
