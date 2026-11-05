# Places of interest on the map

Every map in the app (rider map tab, rider trip, driver trip and home, merchant delivery map and order route) has a
row of filter chips: **Checkpoints, Cafe, Restaurant, Fuel station, Rest stop, Pharmacy, Hospital, Clinic,
Supermarket, ATM / bank, Mosque, Car repair, EV charging**. While a rider or driver is on a running trip the app can
also quietly point out a cafe or fuel station on the road (see "Suggestions").

API: `docs/api/map-places.md`. Admin page: **Map places**.

## Decisions

- **One filter at a time.** Pressing a chip shows only that layer; pressing it again (or another chip) changes or clears
  it. Multi-select would need a legend and an answer to "what is hidden"; one chip is the simplest reading of "press a
  chip, see only that". The choice is shared by all maps for the session and is not stored.
- **"Only that layer" means the background layers.** Checkpoints, community reports and other places are hidden. The
  trip's own route, stops, the driver and "you are here" stay, because they are the context the map is for. The
  merchant's delivery map has no checkpoint layer, so its row has no Checkpoints chip.
- **Places are loaded only while a place chip is active**, for the visible area (snapped to a 0.05-degree grid, at most
  0.9 degree wide), at most 200 per request. The normal map costs no extra request.
- **Clustering.** At most 80 pins are drawn. Beyond that, places of the same category on a grid merge into one numbered
  pin whose callout asks the user to zoom in (the grid coarsens until the count fits). The server also reports
  `truncated`, shown as "Showing the nearest only".
- **Attribution.** The map's existing credit "© OpenStreetMap contributors" covers the tiles and the places (same
  licence, same organisation); the place sheet repeats "Place data © OpenStreetMap contributors".
- **Open now** is read on the phone from the OpenStreetMap `opening_hours` text for the common forms (`24/7`,
  `Mo-Fr 08:00-17:00; Sa 09:00-13:00`, `off`, ranges past midnight, `PH` rules ignored). Anything else is shown as the
  original text and never guessed. It uses the phone's local time.

## Data

`apps/api/data/osm-places.json` is built from OpenStreetMap (ODbL) by `scripts/places/fetch-osm-places.mjs`, the same
pattern as `osm-checkpoints.json`:

- Overpass is used offline by the person refreshing the data. The phones and the API never call it.
- Area: Overpass is asked for each category inside the West Bank bounding box (fast), and the answer is cut to the OSM
  `West Bank` boundary (relation 1613659, fetched once with its geometry and tested locally, enclaves as holes; a
  server-side area filter times out on the public servers). Places further than 30 km from every one of the ten cities
  the 20 predefined routes join (Hebron, Bethlehem, Ramallah, Nablus, Jenin, Tulkarm, Qalqilya, Jericho, Salfit, Tubas)
  are dropped, and each place carries the slug of its nearest city. Israeli towns next to the Green Line are outside the
  boundary and are not included.
- Unnamed features are dropped, except fuel stations, ATMs, rest stops and charging stations. Features tagged
  `disused`, `abandoned` or `access=private` are dropped.
- Categories and their OSM tags are in `apps/api/data/map-place-categories.json`. A category is one or more
  alternatives; each alternative is a list of tags that must all match.

The extract is loaded into `map_places` by `npm run places:import -w @darb/api` (after `npm run build`):

```
node apps/api/dist/scripts/importMapPlaces.js [--dry-run] [--deactivate-missing] [--file path]
```

It is repeatable: rows are keyed by OSM id, new places are added, places whose OSM data changed are updated, and rows an
admin edited (`admin_edited`) are never overwritten. Places missing from a newer extract are switched off only with
`--deactivate-missing`, so a partial extract cannot empty the map. The migration creates the empty table; run the import
once after deploying it.

### Current extract (fetched 2026-11-05, 7,319 places)

| Category | Bethlehem | Hebron | Jenin | Jericho | Nablus | Qalqilya | Ramallah | Salfit | Tubas | Tulkarm | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cafe | 29 | 27 | 16 | 12 | 52 | 2 | 90 | 14 | 13 | 28 | 283 |
| Restaurant | 102 | 70 | 31 | 36 | 120 | 21 | 272 | 38 | 44 | 56 | 790 |
| Fuel | 15 | 28 | 20 | 7 | 29 | 9 | 44 | 25 | 11 | 20 | 208 |
| Pharmacy | 30 | 76 | 38 | 9 | 99 | 41 | 116 | 39 | 26 | 88 | 562 |
| Hospital | 29 | 21 | 19 | 1 | 14 | 7 | 64 | 24 | 14 | 12 | 205 |
| Clinic | 24 | 50 | 23 | 9 | 76 | 16 | 56 | 34 | 33 | 37 | 358 |
| Supermarket / grocery | 160 | 372 | 285 | 62 | 548 | 152 | 653 | 473 | 206 | 436 | 3,347 |
| ATM / bank | 42 | 58 | 12 | 15 | 49 | 15 | 89 | 20 | 9 | 20 | 329 |
| Mosque | 109 | 188 | 101 | 20 | 139 | 41 | 151 | 116 | 37 | 110 | 1,012 |
| Car repair | 9 | 35 | 15 | 1 | 24 | 13 | 24 | 6 | 18 | 20 | 165 |
| Rest stop / toilets | 7 | 7 | 5 | 6 | 10 | 5 | 6 | 3 | 6 | 1 | 56 |
| EV charging | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 4 |
| **Total** | 556 | 932 | 566 | 178 | 1,161 | 322 | 1,565 | 792 | 417 | 830 | 7,319 |

Of these, 6,636 have an Arabic name, 5,319 an English name, 408 a phone number and 424 opening hours. These are what
OpenStreetMap contributors have mapped: low counts (two cafes in Qalqilya, one hospital in Jericho) are gaps in the map,
not a filter, and are fixed by adding the place in OpenStreetMap or on the admin page.

### Refresh

1. `node scripts/places/fetch-osm-places.mjs --cache-dir <scratch dir>` (several minutes; public Overpass servers are often busy,
   each query is retried across mirrors, an empty or "remark" answer counts as a failure, and `--cache-dir` keeps finished
   categories so a re-run resumes).
2. Review the diff of `apps/api/data/osm-places.json` (one place per line) and the counts it prints.
3. Commit it, deploy, run `places:import` (use `--dry-run` first to see created, updated and unchanged counts).
4. Check the counts on the admin Map places page.

### Adding a category

1. Add it to `map-place-categories.json`.
2. Add an entry (icon, colour, whether it may be suggested) to `apps/mobile/lib/features/places/domain/place_category.dart`
   and its label to both ARB files and `placeCategoryLabel`.
3. Add its labels to the admin `MAP_PLACE_CATEGORIES` list and translations.
4. Re-run the importer and the import.

No migration is needed.

## Suggestions on the road

A quiet banner at the top of the app, for riders and drivers with a running trip (`accepted` to `in_transit`):
"There is a cafe on your road, want a coffee?", "There is a fuel station on your road" (drivers only), rest stops,
restaurants.

- **Foreground only.** The position stream is cancelled whenever the app is not resumed. No push notifications.
- **Existing permission only.** It never asks for location permission; without it there are no suggestions. Places come
  from `GET /map/places` for a box of about 3 km around the phone, once per 2 km cell.
- **No new storage.** The engine keeps the places shown for the current trip in memory and forgets them when the trip
  ends. Nothing about the position or the suggestions is stored on the phone or the server. The only stored values are the
  user's own switches (below).
- **Limits** (`SuggestionConfig`): within 1.5 km, once per place per trip, at most 3 per trip, at least 15 minutes between
  two, never for a place the opening hours say is closed, banner fades after 12 seconds.
- **Which places.** Cafe, restaurant, rest stop (riders and drivers, on by default); fuel (drivers, on by default);
  supermarket, ATM, mosque (both) and car repair, EV charging (drivers), all off by default. **Pharmacy, hospital and clinic
  are never suggested**: the app cannot know whether one is relevant and a suggestion must never appear in an emergency.
  They remain map filters. There is no fuel level data, so fuel suggestions do not depend on the tank.
- **Drivers moving fast** (6 m/s, about 22 km/h, or more) get a passive banner: text only, no buttons, nothing to tap.
  Below that speed, and for riders, the banner has "Dismiss" and "Don't suggest this again".
- **Settings.** Settings has "Suggestions on your road": a master switch and a switch per category (for riders, drivers;
  hidden for merchants). "Don't suggest this again" turns that category off. Stored in the app's preferences on the
  device, like the language.

## Also included

- **Report a problem** in the place sheet (closed, wrong location, wrong information, does not exist): one report per user
  per place, listed on the admin page where an admin can resolve it, dismiss it, or disable the place.
- **Call** from the place sheet when the place has a phone number, and **Navigate** (opens the phone's maps app).

## Proposed, not built

- Favourites (needs a stored list per account).
- A "near me" list sorted by distance from the filter row.
- Using the route line to suggest only places along the road ahead rather than within a radius.
- Refreshing the extract on a schedule.
