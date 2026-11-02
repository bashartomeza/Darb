import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../features/canonical_routes/domain/canonical_route_models.dart';

/// Why the map has no blue dot.
///
/// Each case reads differently to a rider — a disabled radio is fixed in
/// settings, a denied prompt can be re-asked — so the UI distinguishes them
/// instead of showing one generic failure.
enum LocationFailure {
  serviceDisabled,
  permissionDenied,
  permanentlyDenied,
  unavailable,
}

class LocationException implements Exception {
  const LocationException(this.failure);
  final LocationFailure failure;
}

final locationServiceProvider = Provider<LocationService>((ref) {
  return const LocationService();
});

class LocationService {
  const LocationService();

  /// The device's current position, or a [LocationException] naming why not.
  ///
  /// Never returns a fallback coordinate: the passenger map draws the route's
  /// own bounds when this fails rather than pretending the rider is somewhere.
  Future<GeoPoint> currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationException(LocationFailure.serviceDisabled);
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      throw const LocationException(LocationFailure.permanentlyDenied);
    }
    if (permission == LocationPermission.denied) {
      throw const LocationException(LocationFailure.permissionDenied);
    }
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          // Coarse accuracy is enough to place a rider on a corridor, and it
          // returns faster on the low-end devices this app targets.
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 12),
        ),
      );
      return GeoPoint(position.latitude, position.longitude);
    } on Exception {
      throw const LocationException(LocationFailure.unavailable);
    }
  }
}

/// The rider's position for the map layer.
///
/// Kept separate from the route providers so a refused permission never blocks
/// the route, the stops, or the barriers from drawing.
final currentPositionProvider =
    AsyncNotifierProvider<CurrentPositionNotifier, GeoPoint?>(
      CurrentPositionNotifier.new,
    );

class CurrentPositionNotifier extends AsyncNotifier<GeoPoint?> {
  @override
  Future<GeoPoint?> build() =>
      ref.read(locationServiceProvider).currentPosition();

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(locationServiceProvider).currentPosition(),
    );
  }
}
