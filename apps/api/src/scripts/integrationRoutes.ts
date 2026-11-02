import type { PrismaClient } from "../generated/prisma/client.js";
import { ensurePredefinedRoutes } from "../services/operatingRoutes.js";

/** Author of the predefined routes on a disposable integration database that has no admin yet. */
const SEEDER_ID = "integration_route_seeder";

/**
 * Integration scripts run on a freshly migrated database where no admin exists,
 * so the start-up step that creates the predefined routes skips. This creates
 * them with an existing admin, or a synthetic one kept for that purpose, and
 * returns the Hebron → Bethlehem route that older request bodies map to.
 */
export async function ensureIntegrationRoutes(db: PrismaClient) {
  const admin =
    (await db.user.findFirst({ where: { role: "admin" }, orderBy: { created_at: "asc" }, select: { id: true } })) ??
    (await db.user.upsert({
      where: { id: SEEDER_ID },
      update: {},
      create: {
        id: SEEDER_ID,
        name: "SYNTHETIC route seeder",
        email: `${SEEDER_ID}@example.invalid`,
        phone: "+12025550999",
        role: "admin",
        // Synthetic, so a later demo reset neither refuses it as real data nor keeps it.
        demo_account: true,
        profile_state: "complete",
        email_verified_at: new Date()
      },
      select: { id: true }
    }));
  await ensurePredefinedRoutes(db, admin.id);
  return db.serviceRoute.findUniqueOrThrow({ where: { route_key: "hebron-to-bethlehem" } });
}
