import { prisma } from "../lib/prisma.js";
import { runDriverDocumentExpiryCheck } from "../services/driverDocumentExpiry.js";

const result = await runDriverDocumentExpiryCheck(prisma);
console.log(
  `Checked ${result.checked} driver(s): sent ${result.reminded} reminder(s), restricted ${result.restricted} driver(s) with expired documents.`
);
await prisma.$disconnect();
