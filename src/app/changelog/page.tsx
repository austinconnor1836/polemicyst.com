import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import versionJson from '../../../version.json';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Recent Clipfire releases — what shipped, when, and why it matters.',
};

interface Release {
  version: string;
  date?: string;
  blurb: string;
  bullets: string[];
}

// Single source of truth for the current release notes. The version number is
// read from version.json at build time. Earlier release notes live in git
// history + the GitHub Releases page.
const currentVersion =
  typeof (versionJson as { version?: string }).version === 'string'
    ? (versionJson as { version: string }).version
    : 'unreleased';

const releases: Release[] = [
  {
    version: currentVersion,
    date: '2026-06-12',
    blurb: 'Investor-readiness fleet — public ops + velocity surfaces.',
    bullets: [
      'Investor-readiness fleet (W001–W019, +W027 prep, +W011 alarms)',
      'PostHog analytics + 5 conversion events',
      'Sentry on web + workers + Firebase Crashlytics on iOS',
      'GDPR delete + export endpoints',
      'Cookie consent + privacy + DMCA pages',
      '/admin/metrics MRR/ARR/cohort dashboard',
      '/admin/costs margin projector now minute-based',
      'Real /api/health with DB + Redis + S3 checks',
      'Rate limiting on auth + expensive endpoints',
      'Age gate (COPPA) at signup',
    ],
  },
];

function formatDate(d?: string): string | null {
  if (!d) return null;
  // Render ISO yyyy-mm-dd as a human date without relying on locale-day arithmetic.
  const parsed = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function ChangelogPage() {
  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <h1 className="sr-only">Changelog</h1>

      <Card>
        <CardHeader>
          <CardTitle>What we shipped</CardTitle>
          <CardDescription>Recent versioned releases. Newest first.</CardDescription>
        </CardHeader>
      </Card>

      {releases.map((release) => {
        const dateLabel = formatDate(release.date);
        return (
          <Card key={release.version}>
            <CardHeader>
              <CardTitle>v{release.version}</CardTitle>
              <CardDescription>
                {dateLabel ? <span>{dateLabel} — </span> : null}
                {release.blurb}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1.5 text-sm">
                {release.bullets.map((b, idx) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Older releases:{' '}
            <a
              href="https://github.com/austinconnor1836/polemicyst.com/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Full history on GitHub
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
