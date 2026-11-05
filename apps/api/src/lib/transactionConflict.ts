/**
 * True when MySQL rolled the transaction back as a deadlock victim, so running it again is safe.
 * Prisma reports that as P2034 for model queries, but a raw query ($queryRaw / $executeRaw)
 * surfaces the same driver error as P2010 "Raw query failed", with the adapter's
 * TransactionWriteConflict (MySQL errno 1213) inside.
 */
export function isTransactionConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } })
    .meta?.driverAdapterError?.cause;
  return cause?.kind === "TransactionWriteConflict" || cause?.originalCode === "1213";
}
