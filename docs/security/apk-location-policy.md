# Release APK location policy

Foreground `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` are allowed for
active map/location functionality. A `geolocator` string or class is not evidence
of background tracking.

This release prohibits:

- `ACCESS_BACKGROUND_LOCATION` permission declarations;
- `FOREGROUND_SERVICE_LOCATION` permission declarations;
- exported location services, including implicit export through intent filters;
- application-controlled continuous/background location tracking.

`scripts/scan-production-artifacts.mjs --apk <path>` decodes the **compiled APK
manifest** with Android SDK `aapt dump xmltree`. It resolves `aapt` from `AAPT`,
`ANDROID_SDK_ROOT`/`ANDROID_HOME` build-tools, or PATH. Missing tooling, failed
decoding, or unresolved security-relevant manifest values fail the scan. Android
attribute resource IDs handle namespace aliases. Foreground-service type bit 8
identifies location services even when their class names do not mention location.

The artifact scan still blocks demo reset endpoints/headers, simulation mutations,
demo credential labels, route-provider server-secret labels, and the existing
background-location package markers. UTF-8 and UTF-16 strings are inspected.
Permission capability strings in DEX are not permission declarations; the compiled
manifest is authoritative. The scanner is an artifact regression gate, not proof
that arbitrary code cannot track location: source/behavior review is also required.

## Current Mobile behavior

- `lib/core/location/location_service.dart` requests one current position at medium
  accuracy with a 12-second timeout. Medium accuracy is a requested preference,
  not a promise that returned coordinates are imprecise.
- `currentPositionProvider` is watched by the available passenger map body. The
  error action can explicitly retry. There is no application position stream,
  recurring location timer, work scheduler, or foreground-notification setup.
- The result remains an in-memory `GeoPoint`, consumed as the map's rider marker
  and camera bounds. The inspected call chain does not serialize that coordinate
  into API requests, persist it, or log it.
- `DarbMap` fetches OpenStreetMap tiles for the viewport. Those tile requests
  reveal the viewed geographic area and network metadata to the tile provider;
  this is not a zero-network-disclosure map. No raw GPS latitude/longitude upload
  was found in the application path.
- The locked Android geolocator plugin (5.0.3) contains a non-exported bound
  `GeolocatorLocationService` with location service type. Its presence is allowed.
  The current-position method stops native updates after success/error and cancels
  on timeout. Binding the plugin service does not start foreground tracking.
- A pending one-shot request is not explicitly canceled by application lifecycle
  transitions and may finish during its bounded timeout after leaving the screen.
  No application-controlled continuing background collection was found. Lifecycle
  cancellation would be a separate behavior change, not part of this stabilization.

The release APK must independently show neither prohibited permission and no
exported location service. Mobile CI tests real compiled fixture APKs for allowed
foreground usage, prohibited permissions, explicit/implicit exported services,
secret/demo artifacts, background-package markers, and corrupt APK rejection.
Pure policy tests run in Security CI as well.
