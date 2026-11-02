import { prisma } from "../lib/prisma.js";
import { purgeExpiredPassengerParcelReceivers } from "../services/passengerParcels.js";

const result = await purgeExpiredPassengerParcelReceivers(prisma);
console.log(`Erased receiver details from ${result.purged} passenger parcel(s) past retention.`);
await prisma.$disconnect();
