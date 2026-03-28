import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Posts Section',
  description: 'Explore our posts',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen max-w-full overflow-x-hidden">
      <div
        className="flex-1 p-4 overflow-y-auto overflow-x-hidden"
        style={{ marginTop: 'var(--navbar-height)' }}
      >
        {children}
      </div>
    </div>
  );
}
