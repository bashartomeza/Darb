import { prisma } from "../lib/prisma.js";
import { recomputeAllDriverTrust } from "../services/driverTrust.js";

const result = await recomputeAllDriverTrust(prisma);
console.log(`Recomputed trust score for ${result.recomputed} driver(s); ${result.failed} failed.`);
await prisma.$disconnect();
if (result.failed > 0) process.exitCode = 1;
