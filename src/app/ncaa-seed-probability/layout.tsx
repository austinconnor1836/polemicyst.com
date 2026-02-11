import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'NCAA Tournament 2-Seed Win Probability',
  description:
    'Historical win probabilities for 2-seeds in the NCAA March Madness tournament (1985-2024).',
}

export default function NcaaSeedProbabilityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen">
      <div
        className="flex-1 p-4 overflow-y-auto"
        style={{ marginTop: 'var(--navbar-height)' }}
      >
        {children}
      </div>
    </div>
  )
}
