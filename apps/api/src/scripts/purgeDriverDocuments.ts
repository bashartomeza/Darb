import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { createDocumentStorage } from "../services/driverDocumentStorage.js";
import { purgeDecidedDriverDocuments } from "../services/driverDocumentRetention.js";

const settings = config.driverDocuments;
if (!settings) {
  console.log("Driver documents are not enabled; nothing to purge.");
} else {
  const result = await purgeDecidedDriverDocuments(prisma, createDocumentStorage(settings.dir), {
    retentionDays: settings.retentionDays
  });
  console.log(`Purged ${result.purged} driver document(s) older than ${settings.retentionDays} days after decision.`);
}
await prisma.$disconnect();
