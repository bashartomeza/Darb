# M7D1B provider storage-rights matrix

Evidence date: 2026-08-07. This is a conservative engineering reading of current public official sources, not legal advice. No provider-derived result is persisted by M7D1B.

| Proposed canonical field | Mapbox | Google | HERE | Stadia | OSM self-hosted |
|---|---|---|---|---|---|
| normalized latitude | CONDITIONAL | RESTRICTED | RESTRICTED | CONDITIONAL | ALLOWED / CONDITIONAL on non-substantial geocoding use |
| normalized longitude | CONDITIONAL | RESTRICTED | RESTRICTED | CONDITIONAL | ALLOWED / CONDITIONAL on non-substantial geocoding use |
| normalized display label | CONDITIONAL | RESTRICTED | RESTRICTED | CONDITIONAL | ALLOWED / CONDITIONAL on non-substantial geocoding use |
| encoded route geometry/polyline | UNRESOLVED | RESTRICTED | RESTRICTED | UNRESOLVED | UNRESOLVED / LEGAL_REVIEW_REQUIRED |
| route distance | UNRESOLVED | RESTRICTED | RESTRICTED | UNRESOLVED | CONDITIONAL / LEGAL_REVIEW_REQUIRED for systematic canonical use |
| route duration | UNRESOLVED | RESTRICTED | RESTRICTED | UNRESOLVED | CONDITIONAL / LEGAL_REVIEW_REQUIRED for systematic canonical use |
| provider route/reference ID | UNRESOLVED | UNRESOLVED | RESTRICTED | UNRESOLVED | not returned in tested contract |
| provider geocode/reference ID | CONDITIONAL | ALLOWED only when it is a place ID | RESTRICTED | CONDITIONAL | CONDITIONAL / OSM object reference |
| attribution/provenance metadata | CONDITIONAL | CONDITIONAL | CONDITIONAL | CONDITIONAL | REQUIRED |

## Provider findings

### Mapbox

[Geocoding API v6](https://docs.mapbox.com/api/search/geocoding/) prohibits caching Temporary results and permits Permanent results to be stored indefinitely when `permanent=true`; Permanent use requires a valid credit card or enterprise contract. Accordingly, coordinates, labels, and geocode IDs are conditional on Darb deliberately using and paying for Permanent Geocoding. [Directions API v5](https://docs.mapbox.com/api/navigation/directions/) documents returned geometry, distance, duration, and operational limits, but the reviewed public documentation does not expressly approve indefinite storage of those route fields or route references. Those cells remain unresolved rather than inferred.

The geocoding response carries Mapbox attribution. A future renderer must also implement the applicable Mapbox and underlying map-data attribution; [Static Images documentation](https://docs.mapbox.com/api/maps/static-images/) confirms that OpenStreetMap attribution remains the customer's responsibility when OSM-derived maps are used.

### Google Maps Platform

Current [service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) allow Geocoding and Routes content without a corresponding Google map but prohibit using it with a non-Google map. They permit only 30-day latitude/longitude caching by default. The Geocoding exception for indefinite latitude, longitude, formatted address, and structured address storage applies solely to direct end-user-facing functionality, logically isolated to the initiating end user, and not as a substitute for calls. Darb's proposed shared immutable canonical route record does not fit that published exception, so the related cells are restricted for this design.

[Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies) and [Routes policies](https://developers.google.com/maps/documentation/routes/policies) generally restrict content caching while permitting place IDs to be stored indefinitely. A geocode reference is allowed only if it is such a place ID; a general route token is not assumed equivalent. Published terms do not grant indefinite shared storage of route polyline, distance, or duration.

### HERE

The [HERE Platform Terms](https://legal.here.com/us-en/terms/here-platform/terms-november-2021) prohibit storing Location Services Results outside the platform for more than 30 days, absent a subscription-plan or separately agreed exception, and additionally prohibit prefetch/cache/storage except as allowed by returned caching headers. That does not support Darb's proposed multi-year immutable canonical record. Every provider-result field is therefore restricted under the public standard terms; attribution metadata is conditional because applicable HERE and supplier notices still require implementation. Separate written rights could change this classification but are not presently evidence.

### Stadia Maps

[Stadia terms](https://stadiamaps.com/terms-of-service/) prohibit server-side caching and permanent Geocoding API storage without an active Standard, Professional, or Enterprise subscription with appropriate permissions. [Current pricing](https://stadiamaps.com/pricing) marks geocoding persistence as available on Standard and Professional plans. Coordinates, labels, and geocode IDs are therefore conditional on an eligible active plan and its permissions.

The same public terms do not expressly approve long-term database persistence of routing geometry, distance, duration, or route references. They remain unresolved. [Stadia attribution guidance](https://docs.stadiamaps.com/attribution/) requires credit to Stadia Maps and applicable original sources for geocoding/routing, and additional Stadia/OpenMapTiles/OpenStreetMap attribution for its usual map styles.

### OSM self-hosted

Raw OpenStreetMap data is ODbL-licensed. A Valhalla graph is an OSM-derived database; public use requires applicable attribution and share-alike/source-availability obligations. The [OSMF attribution guideline](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) says dynamically generated routing instructions need not carry attribution per record if they do not form a Derivative Database, while the engine and incorporating application must credit OpenStreetMap. The [June](https://osmfoundation.org/wiki/Licensing_Working_Group/Minutes/2024-06-10) and [July 2024](https://osmfoundation.org/wiki/Licensing_Working_Group/Minutes/2024-07-08) LWG minutes distinguish transient dynamically generated routes from durable/comprehensive geometry and record concern that accumulated actual geometries may be a Derivative Database. Those minutes are not a formal legal ruling for Darb's exact design. Systematic indefinite canonical geometry is therefore `UNRESOLVED / LEGAL_REVIEW_REQUIRED`, not proprietary/unrestricted.

The [OSMF geocoding guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline) permits ordinary individual name/address/latitude/longitude results to be stored with proprietary data when the collection is not a systematic reconstruction of all or a substantial part of OSM. Public geocoder/application use still requires OpenStreetMap attribution. Darb must keep OSM-derived and proprietary feature types/layers separable enough to preserve a defensible Collective Database boundary; the [OSMF Collective Database guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline) does not bless arbitrary deduplicated merging.

## Decision

No candidate has unconditional approval for every required field. Storage gate G6/G7 (rubric-dependent naming) is not satisfied. Formal approval requires provider/account-specific confirmation where applicable, ODbL legal review for the self-hosted path, and a later independently reviewed persistence design. M7D1B creates no schema change, migration, cache, or canonical provider record.
