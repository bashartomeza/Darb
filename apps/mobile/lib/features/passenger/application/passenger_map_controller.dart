import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../canonical_assignments/application/canonical_assignment_controller.dart';
import '../../canonical_assignments/domain/canonical_assignment_models.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../trips/application/passenger_trip_controller.dart';
import '../../trips/data/trip_models.dart';

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

  /// Latest known location of the driver/trip.
  ///
  /// This is optional because the location API may be unavailable
  /// or the trip may not have started reporting locations yet.
  final TripLocation? location;

  /// The actual trip ID serving this passenger.
  ///
  /// This is used to load the driver's latest location.
  String? get tripId => assignment?.trip?.id;

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

    // ----------------------------------------------------------
    // OPTIONAL DRIVER / TRIP LOCATION
    // ----------------------------------------------------------
    //
    // Once an assignment has a serving trip, use its trip ID
    // to load the latest known driver location.
    //
    // If the location API fails, the route/map still works.
    // ----------------------------------------------------------

    final tripId = assignment?.trip?.id;

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
  } catch (_) {
    // Route/assignment data is OPTIONAL.
    //
    // If these APIs fail, keep everything null.
    // The base map must still be available.
    route = null;
    pickup = null;
    dropoff = null;
    assignment = null;
    location = null;
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
    location: location,
  );
});
