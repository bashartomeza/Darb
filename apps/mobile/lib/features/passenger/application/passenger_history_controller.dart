import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../trips/data/trip_models.dart';
import '../../trips/data/trip_repository.dart';
import '../data/passenger_models.dart';
import '../data/passenger_repository.dart';

/// The passenger's full request history, bucketed the way the "My trips" flow
/// asks for it.
///
/// Built from `GET /passenger/requests` (every request, not just the open one)
/// joined with `GET /trips`. Both endpoints already existed; the request list
/// simply had no screen behind it until now.
class PassengerHistoryState {
  const PassengerHistoryState({required this.requests, required this.trips});

  final List<PassengerRequest> requests;
  final List<PassengerTrip> trips;

  /// Statuses that mean the system is still working on the request.
  static const _openStatuses = {
    'pending',
    'matched',
    'accepted',
    'pickup_started',
    'picked_up',
    'in_transit',
    'delivered',
  };

  /// Open requests whose preferred time has already arrived, newest first.
  /// Expired requests are terminal history and never disappear.
  List<PassengerRequest> get active => _sorted(
    requests.where(
      (request) =>
          _openStatuses.contains(request.status) && !_isUpcoming(request),
    ),
  );

  /// Open requests whose preferred time is still ahead.
  ///
  /// The schema has no separate "scheduled" state, so "upcoming" is derived
  /// from `preferred_time` rather than invented as a status. The two buckets
  /// are mutually exclusive — a request must appear in exactly one, or the same
  /// trip is listed twice on the screen.
  List<PassengerRequest> get upcoming => _sorted(requests.where(_isUpcoming));

  static bool _isUpcoming(PassengerRequest request) =>
      _openStatuses.contains(request.status) &&
      request.preferredTime.isAfter(DateTime.now());

  List<PassengerRequest> get past => _sorted(
    requests.where(
      (request) => request.status == 'completed' || request.status == 'expired',
    ),
  );

  List<PassengerRequest> get cancelled =>
      _sorted(requests.where((request) => request.status == 'cancelled'));

  bool get isEmpty => requests.isEmpty && trips.isEmpty;

  /// The Trip connected to this exact request by persisted relational
  /// provenance. Owner-level ordering must never be used as association.
  PassengerTrip? tripForRequest(String requestId) {
    for (final trip in trips) {
      if (trip.passengerRequestId == requestId) return trip;
    }
    return null;
  }

  static List<PassengerRequest> _sorted(Iterable<PassengerRequest> items) {
    final list = items.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return List.unmodifiable(list);
  }
}

final passengerHistoryProvider =
    AsyncNotifierProvider<PassengerHistoryController, PassengerHistoryState>(
      PassengerHistoryController.new,
    );

class PassengerHistoryController extends AsyncNotifier<PassengerHistoryState> {
  @override
  Future<PassengerHistoryState> build() => _load();

  Future<void> refresh() async {
    state = await AsyncValue.guard(_load);
  }

  Future<PassengerHistoryState> _load() async {
    final requests = await ref.read(passengerRepositoryProvider).listRequests();
    final trips = await ref.read(tripRepositoryProvider).listTrips();
    return PassengerHistoryState(requests: requests, trips: trips);
  }
}
