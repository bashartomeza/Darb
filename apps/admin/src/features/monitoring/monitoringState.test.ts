import { describe, expect, it } from "vitest";
import { createObservationGate } from "./monitoringState";

describe("createObservationGate", () => {
  it("accepts only the newest generation and invalidates outstanding work", () => {
    const gate = createObservationGate();
    const old = gate.begin();
    const current = gate.begin();

    expect(gate.isCurrent(old)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(current)).toBe(false);
  });
});
