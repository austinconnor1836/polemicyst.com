/**
 * Starter config markdown template for new publications.
 * This document is passed directly to Claude as system context
 * to drive article generation and graphics creation.
 */
export function getStarterConfigMarkdown(name: string): string {
  return `# ${name}

## Identity
- name: ${name}
- tagline: [Your tagline]

## Voice
- tone: [e.g. analytical, sardonic, measured]
- perspective: [e.g. first-person singular]
- style notes: [Describe your writing voice in detail]

## Design System
- backgroundColor: #080808
- textColor: #f0e8d8
- accentColor: #8b1a1a
- headerFont: Playfair Display
- bodyFont: Libre Baskerville
- displayFont: [optional — for masthead/logos]

## Analytical Frameworks
[Define reusable frameworks for your writing]

### Framework: [Name]
1. Step one
2. Step two

## Author Context
- bio: [Brief author bio]
- expertise: [Your areas of expertise]
`;
}
