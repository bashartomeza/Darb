import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  PUSH_PLATFORMS,
  PUSH_TOKEN_PATTERN,
  pushPreference,
  registerPushDevice,
  setPushPreference,
  unregisterPushDevice
} from "../services/pushDevices.js";

const tokenSchema = z.string().regex(PUSH_TOKEN_PATTERN);

const registerSchema = z.strictObject({
  token: tokenSchema,
  platform: z.enum(PUSH_PLATFORMS),
  app_version: z.string().trim().regex(/^[0-9A-Za-z.+_-]{1,40}$/).nullable().optional(),
  // A language tag such as "ar" or "en-US"; push text uses its language part.
  locale: z.string().trim().regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/).nullable().optional()
});

const unregisterSchema = z.strictObject({ token: tokenSchema });
const preferenceSchema = z.strictObject({ push_enabled: z.boolean() });

/**
 * Push registration for the signed-in account. Tokens are write-only: no
 * endpoint lists or returns them, and nothing here reveals whether a token is
 * known for another account. Works the same whether or not the server sends
 * pushes yet (`push_available`), so apps can register ahead of the switch-on.
 */
export function createPushNotificationsRouter(appConfig: Pick<AppConfig, "push">) {
  const router = Router();
  router.use("/push", requireAuth);
  const available = appConfig.push.enabled;

  router.put("/push/devices", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = registerSchema.parse(req.body);
      const device = await registerPushDevice(prisma, {
        userId: req.user!.id,
        sessionId: req.user!.sessionId,
        token: input.token,
        platform: input.platform,
        appVersion: input.app_version ?? null,
        locale: input.locale ? input.locale.replace("_", "-") : null
      });
      res.json({ device: { platform: device.platform, locale: device.locale, registered: true }, push_available: available });
    } catch (error) {
      next(error);
    }
  });

  router.post("/push/devices/unregister", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = unregisterSchema.parse(req.body);
      await unregisterPushDevice(prisma, { userId: req.user!.id, token: input.token });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/push/preferences", async (req: AuthenticatedRequest, res, next) => {
    try {
      const preference = await pushPreference(prisma, req.user!.id);
      res.json({ push_enabled: preference.pushEnabled, push_available: available });
    } catch (error) {
      next(error);
    }
  });

  router.put("/push/preferences", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = preferenceSchema.parse(req.body);
      const preference = await setPushPreference(prisma, req.user!.id, input.push_enabled);
      res.json({ push_enabled: preference.pushEnabled, push_available: available });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
