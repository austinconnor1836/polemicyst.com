'use client';

import { Toaster, type ToasterProps } from 'react-hot-toast';

/**
 * Theme-aware Toaster that uses design-token CSS custom properties.
 * Automatically adapts to light / dark / glass themes.
 */
export function ThemedToaster({ position = 'top-right' }: { position?: ToasterProps['position'] }) {
  return (
    <Toaster
      position={position}
      toastOptions={{
        style: {
          background: 'rgb(var(--color-surface))',
          color: 'rgb(var(--color-text))',
          border: '1px solid rgb(var(--color-border))',
        },
        success: {
          iconTheme: {
            primary: 'rgb(var(--color-success))',
            secondary: 'rgb(var(--color-surface))',
          },
        },
        error: {
          iconTheme: {
            primary: 'rgb(var(--color-destructive))',
            secondary: 'rgb(var(--color-surface))',
          },
        },
      }}
    />
  );
}
