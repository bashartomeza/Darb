import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BBOX, overpassQuery, reduceOverpass } from '../checkpoints/fetch-osm-checkpoints.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('OSM import keeps only id, names and a real in-area position', () => {
  const reduced = reduceOverpass({
    elements: [
      { type: 'node', id: 1, lat: 31.5, lon: 35.1, tags: { barrier: 'checkpoint', name: 'X', 'name:ar': 'حاجز س', operator: 'drop me' } },
      { type: 'way', id: 2, center: { lat: 32.1, lon: 35.2 }, tags: {} },
      { type: 'node', id: 3, tags: { name: 'no position' } },
      { type: 'node', id: 4, lat: 37.39, lon: -122.08, tags: { name: 'outside the box' } },
      { type: 'node', id: 1, lat: 31.5, lon: 35.1, tags: {} }
    ]
  });
  assert.deepEqual(reduced, [
    { id: 'node/1', name: 'X', name_ar: 'حاجز س', lat: 31.5, lng: 35.1 },
    { id: 'way/2', name: null, name_ar: null, lat: 32.1, lng: 35.2 }
  ]);
  assert.match(overpassQuery(), /barrier"="checkpoint/);
  assert.match(overpassQuery(), /military"="checkpoint/);
  assert.ok(overpassQuery().includes(`${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`));
});

test('committed OSM extract carries source, date and licence', () => {
  const file = JSON.parse(readFileSync(join(root, 'apps/api/data/osm-checkpoints.json'), 'utf8'));
  assert.equal(file.licence, 'ODbL-1.0');
  assert.match(file.attribution, /OpenStreetMap/);
  assert.ok(Date.parse(file.fetched_at));
  assert.equal(file.count, file.checkpoints.length);
  for (const entry of file.checkpoints) {
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'lat', 'lng', 'name', 'name_ar']);
  }
});

test('test environment enables checkpoint sources only when present and never prints the key', () => {
  const script = readFileSync(join(root, 'scripts/test-env/start.ps1'), 'utf8');
  assert.match(script, /if \(Test-PartnerKey\) \{/);
  assert.match(script, /if \(\$values\["CHECKPOINTS_URL"\] -and \$values\["CHECKPOINTS_API_KEY"\]\)/);
  assert.match(script, /Test-Path -LiteralPath \$directoryFile/);
  // The key is removed from this shell right after the API child starts.
  assert.match(script, /finally \{[\s\S]*Remove-Item Env:AWEENRAYEH_PARTNER_API_KEY/);
  for (const line of script.split(/\r?\n/)) {
    if (/Write-(Output|Host)/.test(line)) assert.doesNotMatch(line, /partnerKey|PARTNER_API_KEY|CHECKPOINTS_API_KEY/);
  }
});
