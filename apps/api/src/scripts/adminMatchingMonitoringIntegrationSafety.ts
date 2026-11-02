/** Pure pre-connection guard; errors deliberately contain no connection input. */
export function assertMonitoringIntegrationTarget(
  appEnv: string | undefined,
  databaseUrl: string | undefined,
  allowed: string | undefined,
): void {
  const refuse = () => { throw new Error("Monitoring integration requires an explicitly allowed disposable MySQL *_ci database in demo/test"); };
  if (appEnv !== "demo" && appEnv !== "test") refuse();
  let database: string;
  try {
    const url = new URL(databaseUrl ?? "");
    if (url.protocol !== "mysql:" || !url.hostname) return refuse();
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { return refuse(); }
  if (!/^[A-Za-z0-9_]+$/.test(database) || database.toLowerCase() === "darb" || !database.endsWith("_ci")) refuse();
  const allowlist = (allowed ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowlist.includes(database)) refuse();
}
