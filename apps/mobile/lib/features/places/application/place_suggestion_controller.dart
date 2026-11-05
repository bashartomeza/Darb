import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../auth/application/auth_controller.dart';
import '../../auth/domain/auth_models.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../driver/application/driver_controller.dart';
import '../../passenger/application/passenger_map_controller.dart';
import '../domain/place_category.dart';
import '../domain/place_suggestion_engine.dart';

/// The running trip suggestions are made for.
typedef SuggestionTrip = ({String id, SuggestionAudience audience});

/// The signed-in rider's or driver's running trip, or null (no trip, another
/// role, signed out). Reads the same trip lists the rest of the app already
/// loads; it adds no request of its own beyond them.
final placeSuggestionTripProvider = Provider<SuggestionTrip?>((ref) {
  final user = ref.watch(authControllerProvider).value?.user;
  switch (user?.role) {
    case UserRole.passenger:
      final trips = ref.watch(passengerActiveTripsProvider).value;
      final trip = trips == null ? null : activePassengerTrip(trips);
      return trip == null
          ? null
          : (id: trip.id, audience: SuggestionAudience.rider);
    case UserRole.driver:
      final trip = ref.watch(driverDashboardProvider).value?.activeTrip;
      return trip == null
          ? null
          : (id: trip.id, audience: SuggestionAudience.driver);
    default:
      return null;
  }
});

/// One reading of the phone's position while a trip runs.
class SuggestionFix {
  const SuggestionFix(this.point, this.speedMetresPerSecond);

  final GeoPoint point;
  final double? speedMetresPerSecond;
}

/// Where suggestions get the position from. The default reads the phone only
/// when location permission was already granted: it never asks for it, and it
/// only runs in the foreground (the host stops listening in the background).
abstract interface class SuggestionPositionSource {
  Stream<SuggestionFix> fixes();
}

class GeolocatorSuggestionSource implements SuggestionPositionSource {
  const GeolocatorSuggestionSource();

  @override
  Stream<SuggestionFix> fixes() async* {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return;
      final permission = await Geolocator.checkPermission();
      if (permission != LocationPermission.whileInUse &&
          permission != LocationPermission.always) {
        return;
      }
      yield* Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          // A new reading roughly every 200 m: enough to notice a place on
          // the road, and gentle on the battery.
          distanceFilter: 200,
        ),
      ).map(
        (p) => SuggestionFix(
          GeoPoint(p.latitude, p.longitude),
          p.speed >= 0 ? p.speed : null,
        ),
      );
    } on Exception {
      // No suggestions without a position; nothing else depends on this.
      return;
    }
  }
}

final suggestionPositionSourceProvider = Provider<SuggestionPositionSource>(
  (ref) => const GeolocatorSuggestionSource(),
);

/// The suggestion on screen, or null.
final placeSuggestionProvider =
    NotifierProvider<PlaceSuggestionState, PlaceSuggestion?>(
      PlaceSuggestionState.new,
    );

class PlaceSuggestionState extends Notifier<PlaceSuggestion?> {
  @override
  PlaceSuggestion? build() => null;

  void show(PlaceSuggestion suggestion) => state = suggestion;

  void dismiss() => state = null;
}
