export enum THEME_MODE {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system',
}

export interface SideNavItem {
  label: string;
  element: React.ReactNode;
  href: string;
  /** Optional badge text shown next to the label (e.g. "3/6" for connection count) */
  badge?: string;
  /** Badge variant — changes color. Default: neutral gray */
  badgeVariant?: 'neutral' | 'success' | 'warning';
}
