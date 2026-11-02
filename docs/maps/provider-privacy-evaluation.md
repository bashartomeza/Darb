# M7D1B provider privacy and DPA evaluation

Evidence date: 2026-08-07. Scope is Darb's server-side HTTP adapters using public canonical fixture queries and coordinates. No mobile provider SDK, device location, advertising identifier, GPS, background service, or client telemetry is introduced. Provider documentation alone cannot establish GDPR, Palestinian-law, or general legal compliance.

| Provider | Published evidence | Engineering classification |
|---|---|---|
| Mapbox | DPA/SCC path; US primary processing; global CDN; IP log retention generally 30 days | CONDITIONAL |
| Google | Maps terms describe Google collection/use of queries, IP and coordinates; controller-controller terms are relevant; generic Cloud DPA applicability is not assumed | UNRESOLVED |
| HERE | public privacy material and essential-data-processing option exist; applicable processor/DPA and region/account configuration are not established | UNRESOLVED |
| Stadia | DPA incorporated into terms; processor role for Customer Data; US/international transfers; API logs approximately 7–14 days | CONDITIONAL |
| OSM self-hosted | evidence traffic stayed on localhost; production logging/hosting/retention remain Darb's responsibility | PASS for local evidence / CONDITIONAL for production |

## Mapbox

[Mapbox privacy material](https://www.mapbox.com/legal/privacy) states that IP addresses are generally retained for 30 days, with possible longer security/fraud/legal investigation retention. Its [subprocessor/legal FAQ material](https://www.mapbox.com/legal/subprocessors) states that primary processing is in AWS in the United States with CDN caching in other regions and points to its DPA and Standard Contractual Clauses. This is useful evidence, but Darb still needs the actual account DPA, transfer assessment, request-field minimization, subprocessor review, and confirmation of how server-side geocoding/routing requests are logged. Classification: `CONDITIONAL`.

## Google Maps Platform

[Google Maps Platform terms](https://cloud.google.com/maps-platform/terms) describe collection and receipt of search terms, IP addresses, and latitude/longitude coordinates and their use to provide and improve services, subject to Google's privacy terms. Maps Platform uses controller-controller data-protection terms in published terms; the separate [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) describes a processor relationship for covered Cloud services, but this review does not assume that it changes Maps Platform's role or applies to the intended SKU/account. Exact retention, region, controller obligations, consent/privacy-notice requirements, and contractual applicability require specialist and account review. Classification: `UNRESOLVED`.

## HERE

[HERE privacy information](https://www.here.com/privacy) explains that routing, navigation, and location search transmit location data. HERE also publishes [Essential Data Processing guidance](https://docs.here.com/policies/docs/location-services-essential-data-processing), under which designated domains limit use of anonymized/aggregated request data for product improvement. The approved adapter currently uses the standard provider endpoint, and this milestone does not change it. Whether EDP is available for the intended plan, which DPA/role applies to Location Services, regional processing, precise request-log retention, and subprocessor terms remain unresolved. Classification: `UNRESOLVED`.

## Stadia Maps

The [Stadia DPA](https://stadiamaps.com/legal/data-processing-addendum/) is incorporated into its terms and states that Stadia acts as processor/subprocessor for Customer Data, restricts use to service provision, lists subprocessors, and uses transfer safeguards. Its annex says API request/access logs are retained approximately 7–14 days, with longer security/audit/backup or legal retention where applicable. The [privacy policy](https://stadiamaps.com/privacy/privacy-policy/) states that API endpoints use no cookies, Stadia is US-based, and international transfers may occur. Darb still needs executed account terms, subprocessor/transfer review, minimization, and legal assessment. Classification: `CONDITIONAL`.

## SDK and production boundary

This review does not approve any client SDK. A later renderer or provider SDK could add client IP exposure, SDK telemetry, identifiers, crash analytics, map-load events, or device-location processing and must receive a separate review. No provider is `APPROVED_FOR_NEXT_DESIGN` yet.

The self-hosted evidence sent only public fixtures to localhost-bound Valhalla and Nominatim and introduced no third-party request processor. That passes the narrow evidence privacy gate. Production self-hosting still needs access control, log minimization/retention, backup and regional-hosting review; it is not automatic legal approval.
