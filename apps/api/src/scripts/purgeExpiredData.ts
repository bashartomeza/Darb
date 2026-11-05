import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { purgeExpiredData } from "../services/expiredDataRetention.js";

const result = await purgeExpiredData(prisma, config.retention, { pauseMs: 50 });
for (const [name, count] of Object.entries(result.deleted)) console.log(`${name}: deleted ${count}`);
for (const error of result.errors) console.error(`failed ${error}`);
await prisma.$disconnect();
if (result.errors.length > 0) process.exitCode = 1;
