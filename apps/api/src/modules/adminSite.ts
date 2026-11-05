import { join } from "node:path";
import express, { Router } from "express";

/**
 * Serves the built Admin site from the API process, for hosts that run one Node app per
 * domain (cPanel / Passenger on darb.aynur.ps). The console and the API then share one
 * origin, which the Admin cookie session needs (ADR-023). `/api` paths never fall
 * through to the site: unknown API paths keep their JSON 404.
 *
 * Hashed files under `assets/` are cached for a year; `index.html` is never cached, so
 * a deploy is picked up on the next page load.
 */
export function createAdminSiteRouter(siteDir: string) {
  const router = Router();
  const indexFile = join(siteDir, "index.html");

  router.use(
    express.static(siteDir, {
      index: false,
      setHeaders(res, path) {
        res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache");
      }
    })
  );

  // Client-side routes (the console uses hash routes, but deep links must still load).
  router.get(/^(?!\/api(?:\/|$)).*/, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile, (error) => {
      if (error) next();
    });
  });

  return router;
}
