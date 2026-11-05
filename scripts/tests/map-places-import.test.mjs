import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BBOX, BOUNDARY_QUERY, CITIES, UNNAMED_OK, boundaryRings, insideRings, loadCategories, nearestCity, overpassQuery, reduceOverpass, summarize } from '../places/fetch-osm-places.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const categories = loadCategories();
const cafe = categories.find((category) => category.key === 'cafe');
const mosque = categories.find((category) => category.key === 'mosque');

test('every category in the shared list has OSM filters and a stable key', () => {
  for (const category of categories) {
    assert.match(category.key, /^[a-z][a-z0-9_]{1,39}$/);
    assert.ok(category.osm.length > 0 && category.osm.every((alternative) => alternative.length > 0));
  }
  for (const key of ['cafe', 'restaurant', 'hospital', 'clinic', 'pharmacy', 'fuel']) {
    assert.ok(categories.some((category) => category.key === key), `${key} is required`);
  }
  assert.equal(new Set(categories.map((category) => category.key)).size, categories.length);
});

test('the Overpass query ANDs tags inside an alternative and ORs the alternatives', () => {
  const box = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  assert.ok(overpassQuery(cafe).includes(`nwr["amenity"="cafe"](${box});`));
  assert.ok(overpassQuery(mosque).includes(`nwr["amenity"="place_of_worship"]["religion"="muslim"](${box});`));
  assert.match(overpassQuery(categories.find((category) => category.key === 'restaurant')), /fast_food/);
});

test('the importer keeps only fields the app uses, drops unnamed and out-of-area features, and dedupes', () => {
  const nablus = CITIES.find((city) => city.slug === 'nablus');
  const elements = [
    { type: 'node', id: 1, lat: nablus.lat, lon: nablus.lng, tags: { amenity: 'cafe', name: 'مقهى النصر', 'name:en': 'Victory Cafe', phone: '+970 9 238 1234; +970 9 111', opening_hours: 'Mo-Su 08:00-23:00', operator: 'drop me' } },
    { type: 'way', id: 2, center: { lat: nablus.lat + 0.01, lon: nablus.lng }, tags: { amenity: 'cafe', name: 'Latin Name' } },
    { type: 'node', id: 3, lat: nablus.lat, lon: nablus.lng, tags: { amenity: 'cafe' } },
    { type: 'node', id: 4, lat: 33.0, lon: 35.5, tags: { amenity: 'cafe', name: 'too far north' } },
    { type: 'node', id: 5, tags: { amenity: 'cafe', name: 'no position' } },
    { type: 'node', id: 6, lat: nablus.lat, lon: nablus.lng, tags: { amenity: 'cafe', name: 'closed down', disused: 'yes' } },
    { type: 'node', id: 1, lat: nablus.lat, lon: nablus.lng, tags: { amenity: 'cafe', name: 'duplicate' } }
  ];
  const places = reduceOverpass({ elements }, 'cafe');
  assert.deepEqual(places.map((place) => place.id), ['node/1', 'way/2']);
  assert.deepEqual(places[0], {
    id: 'node/1', c: 'cafe', ar: 'مقهى النصر', en: 'Victory Cafe',
    lat: nablus.lat, lng: nablus.lng, ph: '+970 9 238 1234', oh: 'Mo-Su 08:00-23:00', city: 'nablus'
  });
  assert.equal(places[1].ar, null);
  assert.equal(places[1].en, 'Latin Name');
  assert.deepEqual(Object.keys(places[0]).sort(), ['ar', 'c', 'city', 'en', 'id', 'lat', 'lng', 'oh', 'ph']);
});

test('the boundary is assembled from way members and points in an enclave are outside', () => {
  const way = (role, pts) => ({ type: 'way', role, geometry: pts.map(([lon, lat]) => ({ lat, lon })) });
  // A square 0..10 split over two ways, with a square hole 4..6.
  const payload = { elements: [{ type: 'relation', members: [
    way('outer', [[0, 0], [10, 0], [10, 10]]),
    way('outer', [[0, 0], [0, 10], [10, 10]]),
    way('inner', [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]])
  ] }] };
  const rings = boundaryRings(payload);
  assert.equal(rings.length, 2);
  assert.equal(insideRings(rings, 2, 2), true);
  assert.equal(insideRings(rings, 5, 5), false);
  assert.equal(insideRings(rings, 11, 5), false);
  assert.throws(() => boundaryRings({ elements: [{ type: 'relation', members: [way('outer', [[0, 0], [1, 1]])] }] }), /does not close/);
  assert.match(BOUNDARY_QUERY, /rel\(1613659\)/);
});

test('features outside the boundary are dropped', () => {
  const nablus = CITIES.find((city) => city.slug === 'nablus');
  const around = [[nablus.lng - 0.5, nablus.lat - 0.5], [nablus.lng + 0.5, nablus.lat - 0.5], [nablus.lng + 0.5, nablus.lat + 0.5], [nablus.lng - 0.5, nablus.lat + 0.5], [nablus.lng - 0.5, nablus.lat - 0.5]];
  const outside = [[34.0, 33.0], [34.1, 33.0], [34.1, 33.1], [34.0, 33.1], [34.0, 33.0]];
  const elements = [{ type: 'node', id: 1, lat: nablus.lat, lon: nablus.lng, tags: { name: 'x' } }];
  assert.equal(reduceOverpass({ elements }, 'cafe', { rings: [around] }).length, 1);
  assert.equal(reduceOverpass({ elements }, 'cafe', { rings: [outside] }).length, 0);
});

test('a fuel station without a name is kept, a cafe without one is not', () => {
  const nablus = CITIES.find((city) => city.slug === 'nablus');
  const unnamed = { elements: [{ type: 'node', id: 9, lat: nablus.lat, lon: nablus.lng, tags: { amenity: 'fuel' } }] };
  assert.ok(UNNAMED_OK.has('fuel'));
  assert.equal(reduceOverpass(unnamed, 'fuel').length, 1);
  assert.equal(reduceOverpass(unnamed, 'cafe').length, 0);
});

test('nearestCity names the closest of the ten route cities', () => {
  assert.equal(CITIES.length, 10);
  assert.equal(nearestCity(31.9, 35.2).city.slug, 'ramallah');
  assert.equal(nearestCity(32.46, 35.29).city.slug, 'jenin');
});

test('the committed extract is ODbL, attributed, unique and within the categories', () => {
  const file = JSON.parse(readFileSync(join(root, 'apps/api/data/osm-places.json'), 'utf8'));
  assert.equal(file.licence, 'ODbL-1.0');
  assert.match(file.attribution, /OpenStreetMap/);
  assert.ok(Date.parse(file.fetched_at));
  assert.equal(file.count, file.places.length);
  const keys = new Set(categories.map((category) => category.key));
  const cities = new Set(CITIES.map((city) => city.slug));
  const ids = new Set();
  for (const place of file.places) {
    assert.ok(keys.has(place.c), `unknown category ${place.c}`);
    assert.ok(cities.has(place.city), `unknown city ${place.city}`);
    assert.ok(!ids.has(place.id), `duplicate ${place.id}`);
    ids.add(place.id);
    assert.ok(place.lat > 31 && place.lat < 33 && place.lng > 34.8 && place.lng < 35.7);
  }
  assert.deepEqual(file.by_category, summarize(file.places).by_category);
  for (const key of ['cafe', 'restaurant', 'hospital', 'clinic', 'pharmacy', 'fuel']) {
    assert.ok((file.by_category[key] ?? 0) > 0, `${key} has places`);
  }
});

test('the places data files ship in the API image', () => {
  const docker = readFileSync(join(root, 'apps/api/Dockerfile'), 'utf8');
  const ignore = readFileSync(join(root, '.dockerignore'), 'utf8').split(/\r?\n/);
  for (const name of ['map-place-categories.json', 'osm-places.json']) {
    assert.ok(docker.includes(`COPY apps/api/data/${name} apps/api/data/${name}`));
    assert.ok(docker.includes(`/workspace/apps/api/data/${name} /app/apps/api/data/${name}`));
    assert.ok(ignore.includes(`!apps/api/data/${name}`));
  }
});
