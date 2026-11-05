import 'package:flutter/foundation.dart';

import '../../canonical_routes/domain/canonical_route_models.dart';
import 'map_place.dart';
import 'opening_hours.dart';
import 'place_category.dart';

/// The limits on "there is a cafe on your road" suggestions.
@immutable
class SuggestionConfig {
  const SuggestionConfig({
    this.radiusMetres = 1500,
    this.maxPerTrip = 3,
    this.cooldown = const Duration(minutes: 15),
    this.fastSpeedMetresPerSecond = 6,
  });

  /// How close a place must be to be suggested.
  final double radiusMetres;

  /// Suggestions shown during one trip, in total.
  final int maxPerTrip;

  /// Minimum time between two suggestions.
  final Duration cooldown;

  /// At or above this speed (about 22 km/h) a driver is treated as driving.
  final double fastSpeedMetresPerSecond;
}

/// One suggestion to show.
@immutable
class PlaceSuggestion {
  const PlaceSuggestion({
    required this.place,
    required this.distanceMetres,
    required this.passive,
  });

  final MapPlace place;
  final double distanceMetres;

  /// Shown as a plain banner with no buttons, because the driver is moving
  /// fast and must not be asked to tap anything.
  final bool passive;
}

/// Decides when a place near the trip is worth mentioning.
///
/// Pure logic with no clock, location or network of its own. Everything it
/// remembers is in memory for the current trip and is forgotten when the trip
/// changes: nothing about where the user was or what was suggested is stored.
///
/// A suggestion needs all of: a running trip; the category suggestible for the
/// role and switched on; a place within the radius that is not known to be
/// closed; none shown for this place before in this trip; fewer than the
/// per-trip maximum; and the cool-down since the last one over.
class PlaceSuggestionEngine {
  PlaceSuggestionEngine({this.config = const SuggestionConfig()});

  final SuggestionConfig config;

  String? _tripId;
  final Set<String> _shown = {};
  int _count = 0;
  DateTime? _lastAt;

  int get shownThisTrip => _count;

  void reset() {
    _tripId = null;
    _shown.clear();
    _count = 0;
    _lastAt = null;
  }

  /// The suggestion to show now, or null. Calling it records the suggestion it
  /// returns, so the same place is not offered twice.
  PlaceSuggestion? next({
    required String tripId,
    required SuggestionAudience audience,
    required GeoPoint position,
    required double? speedMetresPerSecond,
    required Iterable<MapPlace> places,
    required Set<String> enabledCategories,
    required DateTime now,
    bool suppress = false,
  }) {
    if (_tripId != tripId) {
      reset();
      _tripId = tripId;
    }
    if (suppress) return null;
    if (_count >= config.maxPerTrip) return null;
    final last = _lastAt;
    if (last != null && now.difference(last) < config.cooldown) return null;

    MapPlace? best;
    var bestDistance = double.infinity;
    for (final place in places) {
      if (_shown.contains(place.id)) continue;
      if (!enabledCategories.contains(place.category)) continue;
      final category = placeCategoryFor(place.category);
      if (category == null || !category.suggestFor.contains(audience)) continue;
      if (OpeningHours.parse(place.openingHours)?.isOpenAt(now) == false) {
        continue;
      }
      final distance = distanceMetres(position, place.position);
      if (distance > config.radiusMetres) continue;
      if (distance < bestDistance) {
        best = place;
        bestDistance = distance;
      }
    }
    if (best == null) return null;

    _shown.add(best.id);
    _count++;
    _lastAt = now;
    final fast =
        audience == SuggestionAudience.driver &&
        speedMetresPerSecond != null &&
        speedMetresPerSecond >= config.fastSpeedMetresPerSecond;
    return PlaceSuggestion(
      place: best,
      distanceMetres: bestDistance,
      passive: fast,
    );
  }
}
