# Production map providers (routing and tiles)

The free public servers Darb used while building (`router.project-osrm.org` for road routes and
`tile.openstreetmap.org` for map tiles) forbid production or heavy use. Darb now refuses them outside
local, test and demo builds, and has no default provider in production. Until a provider is configured the
app still works: maps draw a dashed straight line labelled "Route preview unavailable", and a production
build with no tile URL shows a note instead of tiles.

Prices below are list prices as best known in late 2026 and change often. Check each provider's pricing and
terms page before committing, and keep the receipts with the owner's account, not in the repository.

## How it fits together

```
Mobile app ──(Bearer token)──► GET /api/v1/maps/route ──► routing provider (OSRM / ORS / GraphHopper / Mapbox)
     │                           caching, per-user + global rate limits, 4 s timeout, size caps, West Bank bounds
     └──────── tiles (build-time URL) ──────────────────► tile provider
```

* **Routing keys live on the server only** (cPanel environment variables). The app asks the Darb API, which
  validates the waypoints (inside 29.4-33.4 N, 34.2-35.95 E, 2-25 points), applies limits, calls the provider and returns
  an OSRM-shaped answer plus the provider's attribution.
* **Tile URLs are compiled into the app.** A key inside a tile URL can be extracted from an APK, so use a key
  restricted to the app (package `ps.darb.mobile` and its signing certificate, or the provider's URL
  allow-list) with a spending cap, or self-host tiles. The repository never contains a key.

## Option 1 - Hosted free-tier APIs (fastest, about 0 USD)

* **Routing: openrouteservice.org.** Free plan about 2,000 directions requests per day and 40 per minute,
  attribution required (`MAPS_ROUTING_ATTRIBUTION` is pre-filled). Paid plans exist if the quota is outgrown.
  OSM-based, so West Bank roads are good; it does not model checkpoints.
* **Tiles: MapTiler Cloud (free about 100,000 tile requests per month, non-commercial wording - confirm it allows
  Darb's use, otherwise the Flex plan is about 25 USD per month) or Stadia Maps (free for non-commercial,
  paid from about 20 USD per month).** Restrict the key to the app and set a request cap.
* Best for: a pilot with a few hundred riders. Risk: free quotas can run out and commercial-use terms vary.

cPanel variables:
`MAPS_ROUTING_PROVIDER=openrouteservice`, `MAPS_ROUTING_API_KEY=<set in cPanel only>`.
Build: `TILE_URL_TEMPLATE=https://<tile host>/<style>/{z}/{x}/{y}.png?key=<restricted key>`,
`TILE_ATTRIBUTION="© OpenStreetMap contributors © <tile provider>"`.

## Option 2 - Mapbox (one vendor for routes and tiles, pay as you go)

* Directions API: about 100,000 requests per month free, then about 2 USD per 1,000.
* Raster/vector tiles: free tier (about 200,000 raster tile requests, or 25,000 monthly active users on the mobile
  SDK), then roughly 0.5 USD per 1,000 tile requests; billing needs a card on file.
* Public (`pk.`) tokens can be restricted by URL or app bundle; use a secret-free restricted token for tiles and
  a separate server token for routing.
* Terms limit caching and storing results: keep `MAPS_ROUTING_CACHE_TTL_SECONDS` short (default 600) or `0`, and
  check the current terms. Attribution "© Mapbox © OpenStreetMap" is mandatory.
* Best for: lowest engineering effort and strong tiles. Risk: cost grows with usage; West Bank data is OSM-derived
  like the others.

cPanel variables: `MAPS_ROUTING_PROVIDER=mapbox`, `MAPS_ROUTING_API_KEY=<server token>`,
`MAPS_ROUTING_CACHE_TTL_SECONDS=0`.
Build: `TILE_URL_TEMPLATE=https://api.mapbox.com/styles/v1/<user>/<style>/tiles/256/{z}/{x}/{y}@2x?access_token=<restricted pk token>`,
`TILE_ATTRIBUTION="© Mapbox © OpenStreetMap contributors"`.

## Option 3 - Self-hosted on a small VPS (cheapest at scale, most work)

The shared cPanel account has no Docker and little memory, so this runs on a separate small VPS
(about 5-10 USD per month for 2 vCPU / 4 GB, for example Hetzner or DigitalOcean) with HTTPS in front.

* **Routing:** OSRM (or Valhalla) built from the free Geofabrik "Israel and Palestine" extract
  (about 150 MB; preparing it needs about 4 GB RAM, serving needs far less). Point the API at it:
  `MAPS_ROUTING_PROVIDER=osrm`, `MAPS_ROUTING_BASE_URL=https://<your routing host>`. No key, no per-request fee.
  Protect the VPS so only the Darb API host can call it (firewall or an allow-listed header in nginx).
* **Tiles:** a Protomaps/PMTiles or OpenMapTiles extract of the same region served by nginx or a small tile
  server, about 1-2 GB of disk. Free apart from bandwidth.
  `TILE_URL_TEMPLATE=https://<your tile host>/tiles/{z}/{x}/{y}.png`.
* Best for: predictable cost and no vendor quota. Risk: the owner (or a helper) must patch the server, rebuild
  the extract now and then, and monitor it. OSM licence attribution is still required.

## Comparison

| | 1. Hosted free tiers | 2. Mapbox | 3. Self-hosted VPS |
| --- | --- | --- | --- |
| Monthly cost for a pilot | about 0 USD | about 0 USD inside free tier | about 5-10 USD |
| Cost if usage grows 20x | paid plans, about 25-50 USD | grows per 1,000 requests | same VPS |
| Setup effort | low | low | high |
| Secrets to keep | routing key (server), tile key (in app, restricted) | server token + restricted tile token | none |
| Quota/terms risk | high (free tiers) | medium (caching limits) | low |

A sensible path: start with Option 1 for the pilot, move to Option 3 when usage or terms make it worthwhile.
All three need only configuration, not code changes.

## API environment variables (cPanel > Setup Node.js App > Environment variables)

| Variable | Meaning | Default |
| --- | --- | --- |
| `MAPS_ROUTING_PROVIDER` | `disabled`, `osrm`, `openrouteservice`, `graphhopper`, `mapbox` | `disabled` |
| `MAPS_ROUTING_BASE_URL` | required for `osrm` (https); optional override for the others | provider default |
| `MAPS_ROUTING_API_KEY` | key for the keyed providers (set in cPanel, never in git or the app) | none |
| `MAPS_ROUTING_ATTRIBUTION` | credit shown on maps, up to 200 characters | provider default |
| `MAPS_ROUTING_TIMEOUT_MS` | provider timeout, 250-20000 | 4000 |
| `MAPS_ROUTING_CACHE_TTL_SECONDS` | in-memory cache, 0-86400 (0 = off) | 600 |
| `MAPS_ROUTING_MAX_WAYPOINTS` | 2-25 | 25 |
| `MAPS_ROUTING_MAX_RESPONSE_BYTES` | provider response cap | 1000000 |
| `MAPS_ROUTING_USER_RATE_PER_MINUTE` | per signed-in user | 20 |
| `MAPS_ROUTING_GLOBAL_RATE_PER_MINUTE` | provider calls for everyone (cache hits are free) | 120 |

In staging and production the API refuses to start if `MAPS_ROUTING_BASE_URL` is a public demo server, is not
HTTPS, or a keyed provider has no (or a placeholder) key. Errors name variables, never values.

Answers: `200` OSRM-shaped route, `400 invalid_waypoints`, `401`, `429 route_rate_limited` or
`route_provider_busy`, `502 route_provider_failed`, `503 route_provider_unavailable` (nothing configured),
`504 route_provider_timeout`. The app treats every failure as "show a straight line".

## App build variables (`--dart-define`, or GitHub repository variables for the release workflow)

| Define | Meaning |
| --- | --- |
| `TILE_URL_TEMPLATE` | `https://.../{z}/{x}/{y}.png` (required in production for tiles) |
| `TILE_ATTRIBUTION` | credit text for the map corner, up to 200 characters; default is the OpenStreetMap credit |
| `ROUTING_BASE_URL` | optional: talk to your own OSRM directly instead of the API proxy (https in production) |

`APP_ENV` local, test and demo may use the public servers; staging and production never do.

## Checking

`node scripts/deploy/preflight.mjs --env-file <env file>` fails on an unusable `MAPS_ROUTING_*` setup and warns
while routing is off or any routing/tile setting still names a public demo server.
See also `provider-commercial-evaluation.md`, `provider-palestine-route-review.md` and
`osm-self-hosted-operational-evaluation.md` in this folder for the earlier provider research.
