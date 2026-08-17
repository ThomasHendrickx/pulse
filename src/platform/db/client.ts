import { PrismaClient } from "@prisma/client";
import { isProduction } from "../config";

// One PrismaClient per process. The dev server hot-reloads modules, so the
// instance is cached on globalThis outside production to avoid exhausting
// database connections.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (!isProduction()) {
  globalForPrisma.prisma = prisma;
}
