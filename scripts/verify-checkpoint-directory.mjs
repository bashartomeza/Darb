import assert from 'node:assert/strict';
import { readResearchDirectory } from '../apps/api/dist/services/checkpointDirectory.js';

// Explicit local input only. Never downloads data or prints source records.
const input = process.argv[2];
if (!input) throw new Error('Pass the ignored local research JSON after building the API.');
const data = readResearchDirectory(input);
assert.equal(data.count, 173); assert.equal(data.city_count, 11);
assert.equal(new Set(data.checkpoints.map(row => row.research_row_key)).size, 173);
const names = new Map();
for (const row of data.checkpoints) {
  const cities = names.get(row.checkpoint_name_ar) ?? new Set();
  cities.add(row.city_ar); names.set(row.checkpoint_name_ar, cities);
  assert.equal(row.provider_checkpoint_id, null); assert.equal(row.latitude, null); assert.equal(row.longitude, null);
  assert.equal(row.coordinate_verified, false); assert.equal(row.provider_id_verified, false);
  assert.equal(row.ready_for_map, false); assert.equal(row.approved_for_publication, false);
  assert.equal(row.traffic_status, 'unknown');
}
assert.equal([...names.values()].filter(cities => cities.size > 1).length, 1);
assert.equal(data.default_publish_state, 'BLOCKED');
console.log(JSON.stringify({ result: 'PASS', records: 173, cities: 11, city_totals_match: true,
  unique_research_keys: 173, cross_city_duplicate_names_preserved: 1,
  verified_coordinates: 0, verified_provider_ids: 0, published_records: 0,
  provider_dataset_completeness: 'UNVERIFIED', distribution: 'LOCAL_ONLY' }));
