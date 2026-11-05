import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../canonical_assignments/application/canonical_assignment_controller.dart';
import '../../canonical_assignments/domain/canonical_assignment_models.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../trips/application/passenger_trip_controller.dart';
import '../../trips/data/trip_models.dart';
import '../../trips/data/trip_repository.dart';

/// What the passenger map has to draw, resolved from the passenger's own data.
///
/// The passenger can always access the map.
/// Route, assignment, and driver location data are optional.
class PassengerMapView {
  const PassengerMapView({
    required this.mapsAvailable,
    required this.checkpointsAvailable,
    this.route,
    this.pickup,
    this.dropoff,
    this.assignment,
    this.activeTrip,
    this.location,
  });

  /// The passenger map is always available.
  final bool mapsAvailable;

  /// Kept for compatibility with the existing checkpoint layer.
  ///
  /// Checkpoints are independent from the base map.
  final bool checkpointsAvailable;

  /// The route version the passenger asked for,
  /// with coordinates and geometry.
  final CanonicalRoute? route;

  /// Where this passenger boards and alights.
  final CanonicalStop? pickup;
  final CanonicalStop? dropoff;

  /// Present once a driver route is serving the request.
  final CanonicalAssignment? assignment;

  /// The passenger's running normal (route or legacy) trip, when no canonical
  /// assignment is serving them.
  final PassengerTrip? activeTrip;

  /// Latest known location of the driver/trip.
  ///
  /// This is optional because the location API may be unavailable
  /// or the trip may not have started reporting locations yet.
  final TripLocation? location;

  /// The actual trip ID serving this passenger.
  ///
  /// This is used to load the driver's latest location.
  String? get tripId => assignment?.trip?.id ?? activeTrip?.id;

  /// Where the passenger is heading: the canonical route's last stop, else
  /// the normal trip's destination.
  GeoPoint? get destination =>
      route?.destinationStop?.position ?? _tripPoint(activeTrip, end: true);

  /// The normal trip's start, drawn when there is no canonical route.
  GeoPoint? get tripOrigin => _tripPoint(activeTrip, end: false);

  static GeoPoint? _tripPoint(PassengerTrip? trip, {required bool end}) {
    if (trip == null || !trip.hasRouteCoordinates) return null;
    return end
        ? GeoPoint(trip.destinationLat!, trip.destinationLng!)
        : GeoPoint(trip.originLat!, trip.originLng!);
  }

  /// Whether a driver location is currently available.
  bool get hasDriverLocation => location != null;

  /// The passenger's own leg, which is what they actually travel.
  ///
  /// Empty when either end is missing or there are not enough
  /// coordinates to draw the leg.
  List<GeoPoint> get leg {
    final current = route;
    final start = pickup;
    final end = dropoff;

    if (current == null || start == null || end == null) {
      return const [];
    }

    final within = current.stops
        .where(
          (stop) =>
              stop.sequence >= start.sequence &&
              stop.sequence <= end.sequence &&
              stop.position != null,
        )
        .map((stop) => stop.position!)
        .toList(growable: false);

    return within.length >= 2 ? List.unmodifiable(within) : const [];
  }

  /// Whether the route has enough points to be drawn on the map.
  bool get hasDrawableRoute => (route?.path.length ?? 0) >= 2;
}

/// Passenger map provider.
///
/// IMPORTANT:
/// The base map must NOT depend on:
/// - mobile capabilities
/// - passenger active state
/// - route availability
/// - assignment availability
/// - driver location availability
/// - checkpoint availability
///
/// Route, assignment, and driver location are optional layers.
/// If their APIs fail, the map itself must still open.
final passengerMapViewProvider = FutureProvider<PassengerMapView>((ref) async {
  CanonicalRoute? route;
  CanonicalStop? pickup;
  CanonicalStop? dropoff;
  CanonicalAssignment? assignment;
  PassengerTrip? activeTrip;
  TripLocation? location;

  // ------------------------------------------------------------
  // OPTIONAL ROUTE + ASSIGNMENT DATA
  // ------------------------------------------------------------
  //
  // These are needed to resolve:
  // - passenger route
  // - pickup
  // - dropoff
  // - serving trip ID
  //
  // If these APIs fail, the map itself must still open.
  // ------------------------------------------------------------

  try {
    final routes = await ref.watch(canonicalRouteCatalogProvider.future);

    final assignments = await ref.watch(
      passengerCanonicalAssignmentsProvider.future,
    );

    // Assignments that still represent a trip the passenger
    // can travel on.
    const travelling = {
      CanonicalAssignmentStatus.pending,
      CanonicalAssignmentStatus.offered,
      CanonicalAssignmentStatus.assigned,
    };

    final active = assignments
        .where((item) => travelling.contains(item.status))
        .toList(growable: false);

    // Use the newest active assignment.
    assignment = active.isEmpty ? null : active.last;

    // Resolve the route belonging to the assignment.
    final currentAssignment = assignment;
    if (currentAssignment != null) {
      route = routes
          .where((value) => value.versionId == currentAssignment.routeVersionId)
          .firstOrNull;

      // Resolve pickup and dropoff stops.
      final currentRoute = route;
      if (currentRoute != null) {
        pickup = currentRoute.stops
            .where((stop) => stop.id == currentAssignment.pickupStopId)
            .firstOrNull;

        dropoff = currentRoute.stops
            .where((stop) => stop.id == currentAssignment.dropoffStopId)
            .firstOrNull;
      }
    }
  } catch (_) {
    // Route/assignment data is OPTIONAL.
    //
    // If these APIs fail, keep everything null.
    // The base map must still be available.
    route = null;
    pickup = null;
    dropoff = null;
    assignment = null;
  }

  // ------------------------------------------------------------
  // OPTIONAL NORMAL TRIP
  // ------------------------------------------------------------
  //
  // Route and legacy bookings run as normal trips, which canonical
  // assignments never list. Without a canonical trip, show the newest
  // running one. Independent of the canonical catalog, which is off
  // where only normal trips run.
  // ------------------------------------------------------------

  if (assignment?.trip?.id == null) {
    try {
      activeTrip = activePassengerTrip(
        await ref.watch(passengerActiveTripsProvider.future),
      );
    } catch (_) {
      activeTrip = null;
    }
  }

  // ------------------------------------------------------------
  // OPTIONAL DRIVER / TRIP LOCATION
  // ------------------------------------------------------------
  //
  // Once a trip serves the passenger, use its ID to load the latest
  // known driver location.
  //
  // If the location API fails, the route/map still works.
  // ------------------------------------------------------------

  final tripId = assignment?.trip?.id ?? activeTrip?.id;

  if (tripId != null && tripId.isNotEmpty) {
    try {
      final tripState = await ref.watch(
        passengerTripControllerProvider(tripId).future,
      );

      location = tripState.location;
    } catch (_) {
      // Driver location is optional.
      location = null;
    }
  }

  // ------------------------------------------------------------
  // ALWAYS RETURN A MAP VIEW
  // ------------------------------------------------------------
  //
  // The map itself does not depend on route, assignment,
  // driver location, or checkpoints.
  //
  return PassengerMapView(
    mapsAvailable: true,
    checkpointsAvailable: true,
    route: route,
    pickup: pickup,
    dropoff: dropoff,
    assignment: assignment,
    activeTrip: activeTrip,
    location: location,
  );
});

/// Trip statuses a passenger is travelling in, from acceptance to drop-off.
const _runningTripStatuses = {
  'accepted',
  'pickup_started',
  'picked_up',
  'in_transit',
};

/// The passenger's trips, read for the map. Refreshed with the map.
final passengerActiveTripsProvider = FutureProvider<List<PassengerTrip>>(
  (ref) => ref.watch(tripRepositoryProvider).listTrips(),
);

/// The newest running trip, or null when none is running.
PassengerTrip? activePassengerTrip(List<PassengerTrip> trips) {
  PassengerTrip? newest;
  for (final trip in trips) {
    if (!_runningTripStatuses.contains(trip.status)) continue;
    if (newest == null || trip.createdAt.isAfter(newest.createdAt)) {
      newest = trip;
    }
  }
  return newest;
}
