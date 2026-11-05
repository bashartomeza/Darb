import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const data = JSON.parse(readFileSync(resolve(root, "apps/api/data/city-places.json"), "utf8"));
const migration = readFileSync(resolve(root, "apps/api/prisma/migrations/20261114120000_city_places/migration.sql"), "utf8").replaceAll("\r\n", "\n");

// The ten cities of the 20 predefined routes (apps/api/src/services/operatingRoutes.ts).
const CITY_SLUGS = ["hebron", "bethlehem", "ramallah", "nablus", "jenin", "tulkarm", "qalqilya", "jericho", "salfit", "tubas"];

test("every city of the predefined routes has places, starting with its centre", () => {
  assert.deepEqual(data.cities.map((city) => city.city_key).sort(), CITY_SLUGS.map((slug) => `city-${slug}`).sort());
  for (const slug of CITY_SLUGS) {
    const places = data.places.filter((place) => place.city_key === `city-${slug}`);
    assert.ok(places.length >= 5, `${slug} has ${places.length} places`);
    assert.equal(places[0].centre, true, `${slug} starts with the city centre`);
    assert.equal(places[0].sort_order, 0);
    assert.equal(data.cities.find((city) => city.city_key === `city-${slug}`).count, places.length);
  }
});

test("places are unique per city, inside the West Bank and flagged approximate with a source", () => {
  const ids = new Set();
  const names = new Set();
  for (const place of data.places) {
    assert.ok(!ids.has(place.id), `duplicate id ${place.id}`);
    ids.add(place.id);
    const key = `${place.city_key}|${place.name_ar}`;
    assert.ok(!names.has(key), `duplicate place ${key}`);
    names.add(key);
    assert.match(place.name_ar, /[؀-ۿ]/);
    assert.match(place.name_en, /[A-Za-z]/);
    assert.ok(place.latitude > 31.3 && place.latitude < 32.6, `${place.name_en} latitude`);
    assert.ok(place.longitude > 34.85 && place.longitude < 35.6, `${place.name_en} longitude`);
    assert.equal(place.approximate, true);
    assert.ok(place.source.length > 0 && place.source.length <= 100);
    assert.ok(place.id.length <= 191 && place.name_ar.length <= 160 && place.name_en.length <= 160);
  }
});

test("the migration seeds exactly the committed data file", () => {
  const result = spawnSync(process.execPath, ["scripts/places/build-city-places.mjs", "sql"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(migration.includes(result.stdout.trim()), "migration INSERT differs from `build-city-places.mjs sql`; regenerate the seed");
});
