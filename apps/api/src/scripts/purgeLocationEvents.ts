import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { purgeLocationEvents } from "../services/dataRetention.js";

const days = config.retention.locationDays;
const result = await purgeLocationEvents(prisma, { retentionDays: days, pauseMs: 50 });
console.log(`Deleted ${result.deleted} live-location point(s) older than ${days} days from finished trips.`);
await prisma.$disconnect();
