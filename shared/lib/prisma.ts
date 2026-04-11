// shared/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Opt-in query logging via PRISMA_LOG_QUERIES env var.
// Query logging is *very* expensive in long dev sessions with polling —
// thousands of large SQL logs block the Node event loop on stdout writes.
const enableQueryLog = process.env.PRISMA_LOG_QUERIES === 'true';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: enableQueryLog ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
