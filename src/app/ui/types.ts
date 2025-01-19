export enum THEME_MODE {
    LIGHT = 'light',
    DARK = 'dark',
    SYSTEM = 'system',
}

export interface SideNavItem {
    label: string;
    element: React.ReactNode;
}