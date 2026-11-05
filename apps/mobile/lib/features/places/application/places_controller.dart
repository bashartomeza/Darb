import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/maps/service_area.dart';
import '../../../core/widgets/darb_map.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../data/places_repository.dart';
import '../domain/map_place.dart';
import '../domain/place_category.dart';

/// Which single layer the map shows, or null for the normal view.
///
/// One filter at a time, on purpose: "press a chip, see only that" is the
/// whole interaction. Pressing the active chip again clears it. The id is a
/// place category key or [checkpointsFilterId]. The choice is shared by every
/// map in the app and lasts for the session (it is not stored).
final mapFilterProvider = NotifierProvider<MapFilterController, String?>(
  MapFilterController.new,
);

class MapFilterController extends Notifier<String?> {
  @override
  String? build() => null;

  /// Selects [id], or clears the filter when it is already selected.
  void toggle(String id) => state = state == id ? null : id;

  void select(String id) => state = id;

  void clear() => state = null;
}

/// The area the visible map covers, as last reported by a map. Places are
/// loaded for it (snapped to a coarse grid, so small pans reuse the answer).
final placesViewportProvider = NotifierProvider<PlacesViewport, GeoBox?>(
  PlacesViewport.new,
);

class PlacesViewport extends Notifier<GeoBox?> {
  @override
  GeoBox? build() => null;

  void report(GeoBox box) {
    final snapped = box.snapped();
    if (snapped != state) state = snapped;
  }
}

/// The place whose sheet is open (set by tapping its pin).
final selectedPlaceProvider = NotifierProvider<SelectedPlace, MapPlace?>(
  SelectedPlace.new,
);

class SelectedPlace extends Notifier<MapPlace?> {
  @override
  MapPlace? build() => null;

  void select(MapPlace place) => state = place;

  void clear() => state = null;
}

/// Asks the visible map to centre on a place ("Show on map" in its sheet).
/// Maps pass the value to [DarbMap.focus].
final placeFocusProvider = NotifierProvider<PlaceFocus, DarbMapFocus?>(
  PlaceFocus.new,
);

class PlaceFocus extends Notifier<DarbMapFocus?> {
  @override
  DarbMapFocus? build() => null;

  void focusOn(GeoPoint point) =>
      state = DarbMapFocus(point, (state?.request ?? 0) + 1);
}

/// Where a map with nothing reported yet looks for places: around the default
/// view, never around a device position (this must not ask for location).
GeoBox get defaultPlacesBox => GeoBox.around(
  GeoPoint(
    DarbServiceArea.fallbackCenter.latitude,
    DarbServiceArea.fallbackCenter.longitude,
  ),
  0.2,
).snapped();

/// The places of the active category filter in the current view; null data
/// when no place category is selected. Loaded only while a category is the
/// active filter, so the normal map costs no extra request. While a new view
/// loads, the previous places stay on the map instead of flickering away.
final activePlacesProvider = AsyncNotifierProvider<ActivePlaces, PlacesResult>(
  ActivePlaces.new,
);

class ActivePlaces extends AsyncNotifier<PlacesResult> {
  @override
  Future<PlacesResult> build() async {
    final filter = ref.watch(mapFilterProvider);
    final box = ref.watch(placesViewportProvider) ?? defaultPlacesBox;
    if (filter == null ||
        filter == checkpointsFilterId ||
        placeCategoryFor(filter) == null) {
      return PlacesResult.empty;
    }
    return ref
        .watch(placesRepositoryProvider)
        .places(box, categories: [filter]);
  }
}
