'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

const CONSENT_KEY = 'clipfire-cookie-consent';

type ConsentValue = 'accepted' | 'rejected';

export default function CookieBanner() {
  // Start hidden so SSR + initial client render match. We only reveal the
  // banner after reading localStorage in the mount-only effect below — this
  // avoids a hydration mismatch and any layout shift during hydration.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CONSENT_KEY);
      if (stored !== 'accepted' && stored !== 'rejected') {
        setVisible(true);
      }
    } catch {
      // localStorage may be unavailable (private mode, SSR fallback). Default
      // to showing the banner so the user still gets the disclosure.
      setVisible(true);
    }
  }, []);

  const persistConsent = (value: ConsentValue) => {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // No-op: if storage is blocked we still dismiss the banner for this
      // session so the user isn't trapped behind it.
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 text-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-sm leading-relaxed text-muted-foreground">
          We use cookies for sign-in (OAuth sessions) and anonymous analytics to improve Clipfire.
          See our{' '}
          <Link
            href="/privacy-policy"
            className="underline underline-offset-4 hover:text-foreground"
          >
            privacy policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => persistConsent('rejected')}
            aria-label="Reject non-essential cookies"
          >
            Reject
          </Button>
          <Button size="sm" onClick={() => persistConsent('accepted')} aria-label="Accept cookies">
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
