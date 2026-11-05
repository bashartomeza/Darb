import { describe, expect, it, vi } from "vitest";
import { consumeAbuseCounter } from "../lib/abuseCounters.js";

function fakeDb(failures: number, code = "P2034") {
  let calls = 0;
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    abuseCounter: { findUniqueOrThrow: vi.fn(async () => ({ id: "counter_1", count: 1 })) },
    auditEvent: { create: vi.fn() }
  };
  const db = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => {
      calls += 1;
      if (calls <= failures) throw Object.assign(new Error("deadlock"), { code });
      return callback(tx);
    })
  };
  return { db, tx };
}

const input = { bucketType: "open_start_ip", subjectDigest: "a".repeat(64), digestVersion: 1, windowSeconds: 3_600, limit: 5 };

describe("consumeAbuseCounter", () => {
  it("retries a deadlock victim and counts the request once", async () => {
    const { db, tx } = fakeDb(2);
    const result = await consumeAbuseCounter(db as never, input);
    expect(result).toMatchObject({ allowed: true, count: 1, remaining: 4 });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of conflicts", async () => {
    const { db } = fakeDb(10);
    await expect(consumeAbuseCounter(db as never, input)).rejects.toMatchObject({ code: "P2034" });
    expect(db.$transaction).toHaveBeenCalledTimes(4);
  });

  it("does not retry other errors", async () => {
    const { db } = fakeDb(1, "P1001");
    await expect(consumeAbuseCounter(db as never, input)).rejects.toMatchObject({ code: "P1001" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
