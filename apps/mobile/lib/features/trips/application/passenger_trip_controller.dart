import '../../../core/api/authoritative_refresh.dart';
import '../../auth/application/auth_actor_binding.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/trip_models.dart';
import '../data/trip_repository.dart';

class PassengerTripState {
  const PassengerTripState({required this.trip, required this.location});

  final PassengerTrip trip;
  final TripLocation? location;

  bool get locationIsStale {
    final current = location;
    if (current == null) {
      return false;
    }
    return DateTime.now().difference(current.recordedAt) >
        const Duration(minutes: 5);
  }
}

final passengerTripControllerProvider = AsyncNotifierProvider.autoDispose
    .family<PassengerTripController, PassengerTripState, String>(
      PassengerTripController.new,
    );

class PassengerTripController extends AsyncNotifier<PassengerTripState> {
  PassengerTripController(this._tripId);

  final String _tripId;
  late AuthoritativeRefresh<PassengerTripState> _reads;

  @override
  Future<PassengerTripState> build() {
    _reads = AuthoritativeRefresh<PassengerTripState>();
    ref.onDispose(_reads.dispose);
    return _read();
  }

  Future<void> refresh() async => await _read();

  Future<PassengerTripState> _read() {
    if (!ref.mounted) throw StateError('session_changed');
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    if (binding.actorId == null) throw StateError('session_changed');
    void requireCurrent() {
      if (!ref.mounted || binding.revision != revision) {
        throw StateError('session_changed');
      }
    }

    return _reads.run(
      load: () async {
        requireCurrent();
        final repo = ref.read(tripRepositoryProvider);
        final trip = await repo.tripDetail(_tripId);
        requireCurrent();
        final location = await repo.latestLocation(_tripId);
        requireCurrent();
        return PassengerTripState(trip: trip, location: location);
      },
      publish: (next) => state = AsyncData(
        PassengerTripState(
          trip: next.trip,
          location: latestTripLocation(state.value?.location, next.location),
        ),
      ),
      isCurrent: () => ref.mounted && binding.revision == revision,
    );
  }
}
