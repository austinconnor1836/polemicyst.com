import { Metadata } from "next";

export const metadata: Metadata = {
  title: 'Posts Section',
  description: 'Explore our posts',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
      <div className="flex h-screen">
        <div className="flex-1 p-4 mt-8 overflow-y-auto">{children}</div>
      </div>
  );
}