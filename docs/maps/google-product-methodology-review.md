# Google Maps product methodology review

Evidence date: 2026-08-08. This review uses only current official Google documentation and separates product fitness, measured quality, routing behavior, and storage rights.

## Product separation

Google Geocoding API v4 converts addresses, coordinates, and Place IDs between textual and geographic representations. It is the appropriate Google product for address entry, reverse geocoding, and resolving an already-known Place ID. It is not the same capability as discovery of a named public place ([Geocoding API v4 overview](https://developers.google.com/maps/documentation/geocoding/geocoding-v4-overview)). The preserved 60-query result is therefore classified `GOOGLE_ADDRESS_GEOCODING_V4_EVIDENCE`; it remains valid evidence for the method actually tested.

Places API (New) Text Search searches for places from free-form text. Its official endpoint is `POST https://places.googleapis.com/v1/places:searchText`; authentication can use `X-Goog-Api-Key`, and callers must provide a response field mask ([Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)). The Maps Demo Key supports Places API (New), Geocoding API v4, and Compute Routes for bounded prototype use, not production ([Maps Demo Key](https://developers.google.com/maps/demo-key)). The independent result is classified `GOOGLE_PLACES_TEXT_SEARCH_EVIDENCE`.

The practical product fit is:

| Darb purpose | Appropriate Google capability | Evidence qualification |
|---|---|---|
| Address entry | Geocoding API v4 | Designed for address/location conversion; this public-place corpus is not an address benchmark |
| City/area search | Geocoding for a known locality/address; Places Text Search for text discovery | Choose by user intent; neither is universally superior |
| Campus search | Places Text Search | Named-place discovery, subject to ranking, quality, and storage constraints |
| Landmark/public-facility search | Places Text Search | Named-place discovery, subject to ranking, quality, and storage constraints |
| Canonical Darb public stops | Provider-neutral reviewed canonical data | Places can discover a candidate/Place ID, but quality and storage rights do not approve persisting Google content as canonical state |

## Places Text Search method

The unchanged committed 30-concept bilingual fixture produced exactly 60 sequential calls: Arabic rows used `languageCode=ar`, English rows used `languageCode=en`, and all used `regionCode=PS`, `pageSize=5`, normal relevance ranking, no pagination, and one fixed preferential rectangle with southwest `(31.3, 34.85)` and northeast `(32.6, 35.65)`. Query text was exactly the committed query, or the committed city and country context when the query field was absent. No expected coordinate or provider-specific alias was inserted.

The response field mask was limited to `places.id`, `places.displayName`, `places.formattedAddress`, `places.location`, and `places.types`. Reviews, ratings, phone numbers, photos, opening hours, and user-generated content were not requested. Raw responses and Google coordinates were not retained. Normalized candidates contain only the evidence fields needed for human adjudication; no result was written to MySQL or a production cache.

Primary scoring accepts only the correct intended public concept at rank 1. Secondary top-N analysis accepts the correct concept in ranks 1–5 and is reported separately; it cannot replace the primary score. All 60 requests succeeded. Primary top-1 acceptance is Arabic 25/30 (`83.3%`), English 23/30 (`76.7%`), and overall 48/60 (`80.0%`). Secondary top-5 acceptance is Arabic 26/30 (`86.7%`), English 26/30 (`86.7%`), and overall 52/60 (`86.7%`). Failures are `RANKING_ISSUE=4`, `WRONG_AREA=2`, `WRONG_CAMPUS=3`, `WRONG_LANDMARK=1`, and `WRONG_PUBLIC_PLACE=2`.

Places Text Search is substantially better than address Geocoding v4 on this named-public-place corpus, but it still fails all three 95% approval gates. This does not show Places is universally better: the corpus measures discovery of cities, campuses, landmarks, and public facilities rather than user-entered street addresses.

## Corrected Routes audit

Google documents coordinate waypoints using `location.latLng`, and also supports `placeId` waypoint locations ([Waypoint reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/Waypoint)). Intermediate waypoints are stopovers by default unless explicitly marked `via`; the ordered multi-stop control used normal stopovers and no optimization ([Intermediate waypoints](https://developers.google.com/maps/documentation/routes/intermed_waypoints)). Google's coverage table lists driving directions for Palestine (`PS`) ([coverage](https://developers.google.com/maps/coverage)).

The first corrected control used Hebron → Bethlehem with properly nested coordinate waypoints, `DRIVE`, `TRAFFIC_UNAWARE`, no modifiers, heading, side-of-road, optimization, departure time, or via semantics, and the minimal mask `routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline`. It returned HTTP 200 with an empty top-level object and zero routes. A secondary control using independently adjudicated correct Hebron and Bethlehem Place IDs produced the same categorical outcome. The corrected four-route coordinate matrix also returned HTTP 200 with zero routes for all four cases.

These controls rule out the prior leg-oriented field mask, invalid coordinate nesting, and ordinary coordinate snapping as demonstrated root causes. They do not establish whether the remaining behavior is specific to the Demo Key, account/backend configuration, or an undocumented service condition. Because official coverage says driving directions are available but no safe response metadata explains the empty result, `GOOGLE_ROUTING_TEST=INSUFFICIENT_EVIDENCE` and `GOOGLE_ROUTING_EVIDENCE=INSUFFICIENT_EVIDENCE`. There is no proven prior-request defect that changes the outcome. Valhalla remains the conditional routing candidate because it returned all four structurally reviewed routes; network latency is not directly compared with this hosted API.

## Storage boundary

Google's Places policies generally prohibit prefetching, caching, or storing Places content except under stated exceptions. Place IDs are explicitly exempt and may be stored indefinitely; Google recommends refreshing Place IDs older than 12 months ([Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id)). Therefore `GOOGLE_PLACES_STORAGE_COMPATIBILITY=RESTRICTED` and `GOOGLE_PLACE_ID_STORAGE=PERMITTED_WITH_REFRESH_POLICY` are separate findings. Neither finding approves production integration or canonical persistence.

Production remains `ROUTE_MAPS_ENABLED=false` and `ROUTE_PROVIDER=disabled`. No Google result, coordinate, route geometry, distance, duration, or cache was persisted; the Prisma schema and all 18 migrations remain unchanged.
