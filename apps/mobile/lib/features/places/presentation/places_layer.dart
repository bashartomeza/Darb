import 'package:flutter_map/flutter_map.dart' show LatLngBounds;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/widgets/darb_map.dart';
import '../application/places_controller.dart';
import '../domain/map_place.dart';
import '../domain/place_category.dart';
import 'place_markers.dart';

/// What the map's chip filter means for one map.
class PlacesLayer {
  const PlacesLayer({
    required this.filter,
    this.markers = const [],
    this.notes = const [],
  });

  /// The active filter: a place category key, [checkpointsFilterId], or null.
  final String? filter;

  /// Pins of the active place category (empty for the other filters).
  final List<DarbMapMarker> markers;

  /// Honest status lines: loading, failed, none here, showing the nearest.
  final List<String> notes;

  /// Normal view: checkpoints and community reports are drawn.
  bool get showsDefaultLayers => filter == null;

  /// The checkpoint layer is drawn: normal view, or the "Checkpoints" chip.
  bool get showsCheckpoints => filter == null || filter == checkpointsFilterId;

  /// Community reports are drawn only in the normal view.
  bool get showsReports => filter == null;

  bool get showsPlaces => filter != null && filter != checkpointsFilterId;
}

/// Reads the filter and, when a place category is selected, its places.
PlacesLayer watchPlacesLayer(WidgetRef ref, AppLocalizations l10n) {
  final filter = ref.watch(mapFilterProvider);
  if (filter == null || filter == checkpointsFilterId) {
    return PlacesLayer(filter: filter);
  }
  final places = ref.watch(activePlacesProvider);
  final result = places.value;
  return PlacesLayer(
    filter: filter,
    markers: placeMapMarkers(
      l10n,
      result?.places ?? const <MapPlace>[],
      onSelect: (place) =>
          ref.read(selectedPlaceProvider.notifier).select(place),
    ),
    notes: [
      if (places.isLoading && result == null) l10n.placesLoading,
      if (places.hasError && result == null) l10n.placesLoadFailed,
      if (result != null && result.places.isEmpty && !places.isLoading)
        l10n.placesNoneHere(placeCategoryLabel(l10n, filter)),
      if (result != null && result.truncated) l10n.placesTruncated,
    ],
  );
}

/// Reports the visible area of a map so the places of that view are loaded.
void reportPlacesViewport(WidgetRef ref, LatLngBounds bounds) {
  ref.read(placesViewportProvider.notifier).report(GeoBox.fromBounds(bounds));
}
