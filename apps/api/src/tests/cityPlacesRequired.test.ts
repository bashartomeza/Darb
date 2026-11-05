import { describe, expect, it, vi } from "vitest";

/** ROUTE_PLACES_REQUIRED: with it on, free text alone is refused (docs/routes/city-places.md). */

vi.mock("../config.js", () => ({ config: { routePlacesRequired: true } }));

const { resolveOrderPlace } = await import("../services/cityPlaces.js");

const row = {
  id: "cp_hebron_11", city_key: "city-hebron", name_ar: "حلحول", name_en: "Halhul",
  latitude: "31.577547", longitude: "35.099316", active: true
};
const db = { cityPlace: { findUnique: vi.fn(async () => row) } } as never;

describe("resolveOrderPlace with places required", () => {
  it("refuses an end that names no place", async () => {
    await expect(resolveOrderPlace(db, "pickup", "city-hebron", { details: "near the gate" })).rejects.toMatchObject({
      statusCode: 400, message: "pickup_place_required"
    });
    await expect(resolveOrderPlace(db, "dropoff", "city-hebron", {})).rejects.toMatchObject({ message: "dropoff_place_required" });
  });

  it("accepts a place of the right city with no details", async () => {
    await expect(resolveOrderPlace(db, "pickup", "city-hebron", { placeId: "cp_hebron_11" })).resolves.toMatchObject({
      place: { id: "cp_hebron_11", nameEn: "Halhul", latitude: "31.577547" }, details: null
    });
  });

  it("still refuses a place of another city", async () => {
    await expect(resolveOrderPlace(db, "dropoff", "city-ramallah", { placeId: "cp_hebron_11" })).rejects.toMatchObject({
      message: "dropoff_place_wrong_city"
    });
  });

  it("lets the bulk file keep its text-only shape", async () => {
    await expect(resolveOrderPlace(db, "pickup", "city-hebron", { details: "store on Ein Sarah street" }, true)).resolves.toMatchObject({
      place: null, details: "store on Ein Sarah street"
    });
  });
});
