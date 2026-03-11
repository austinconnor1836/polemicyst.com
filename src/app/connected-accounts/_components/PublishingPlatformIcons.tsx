'use client';

import React from 'react';

export function SubstackIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" />
    </svg>
  );
}

export function MediumIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M13.54 12a6.8 6.8 0 01-6.77 6.82A6.8 6.8 0 010 12a6.8 6.8 0 016.77-6.82A6.8 6.8 0 0113.54 12zM20.96 12c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z" />
    </svg>
  );
}

export function GhostIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0C6.615 0 2.241 4.024 2.241 8.986V24c1.313-.934 2.625-1.867 3.938-1.867S8.804 24 10.116 24c1.313 0 2.626-.934 3.938-.934S16.68 24 17.991 24c1.313 0 2.625-.934 3.938-1.867 1.312-.934 2.625-1.867 3.937-1.867h.001V8.986C25.868 4.024 17.386 0 12 0zm-3.6 12.6a2.4 2.4 0 110-4.8 2.4 2.4 0 010 4.8zm7.2 0a2.4 2.4 0 110-4.8 2.4 2.4 0 010 4.8z" />
    </svg>
  );
}

export function WordPressIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.397-.026-.765-.07-1.109m-7.981.105c.647-.034 1.229-.1 1.229-.1.579-.068.51-.921-.069-.888 0 0-1.74.137-2.862.137-1.055 0-2.829-.137-2.829-.137-.579-.033-.647.854-.068.888 0 0 .549.063 1.134.1l1.685 4.616-2.368 7.1L6.243 6.93c.648-.034 1.23-.1 1.23-.1.58-.068.511-.921-.068-.888 0 0-1.74.138-2.863.138-.201 0-.438-.006-.688-.015C5.744 3.072 8.644 1.213 12 1.213c2.498 0 4.774.956 6.48 2.52-.041-.003-.082-.008-.124-.008-1.055 0-1.803.92-1.803 1.907 0 .888.51 1.639 1.055 2.527.408.714.883 1.63.883 2.953 0 .916-.354 1.98-.82 3.461l-1.075 3.59-3.888-11.555zM12 22.787c-1.436 0-2.81-.279-4.07-.785l4.325-12.561 4.43 12.138c.03.072.065.137.102.197a10.764 10.764 0 01-4.787 1.011M1.213 12c0-1.61.357-3.135.998-4.504l5.49 15.041C3.757 20.542 1.213 16.604 1.213 12M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0" />
    </svg>
  );
}

export const PUBLISHING_PLATFORM_ICONS: Record<string, React.FC<{ className?: string }>> = {
  substack: SubstackIcon,
  medium: MediumIcon,
  ghost: GhostIcon,
  wordpress: WordPressIcon,
};

export const PUBLISHING_PLATFORM_COLORS: Record<string, string> = {
  substack: 'text-orange-500',
  medium: 'text-foreground',
  ghost: 'text-blue-500',
  wordpress: 'text-blue-600',
};
