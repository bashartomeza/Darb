import { describe, expect, it } from "vitest";
import { normalizeEmailForAbuse } from "../lib/contactEmail.js";

describe("normalizeEmailForAbuse", () => {
  it("drops plus tags and lowercases for any provider but keeps dots outside gmail", () => {
    expect(normalizeEmailForAbuse(" Owner+Tag@Example.COM ")).toBe("owner@example.com");
    expect(normalizeEmailForAbuse("first.last+x@example.com")).toBe("first.last@example.com");
  });
  it("also drops dots and unifies the domain for gmail and googlemail", () => {
    expect(normalizeEmailForAbuse("First.Last+a@gmail.com")).toBe("firstlast@gmail.com");
    expect(normalizeEmailForAbuse("firstlast@googlemail.com")).toBe("firstlast@gmail.com");
  });
  it("leaves malformed input usable as a key", () => {
    expect(normalizeEmailForAbuse("+@x.com")).toBe("+@x.com");
    expect(normalizeEmailForAbuse("nope")).toBe("nope");
  });
});
