import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/cancellation/cancellation.dart';
import '../data/passenger_parcel_models.dart';
import '../data/passenger_parcel_repository.dart';

final passengerParcelsProvider =
    AsyncNotifierProvider<PassengerParcelsNotifier, List<PassengerParcel>>(
      PassengerParcelsNotifier.new,
    );

class PassengerParcelsNotifier extends AsyncNotifier<List<PassengerParcel>> {
  @override
  Future<List<PassengerParcel>> build() {
    return ref.read(passengerParcelRepositoryProvider).list();
  }

  /// [background] reads (the periodic foreground sync) never replace the last
  /// good list with an error; explicit refreshes still surface failures.
  Future<void> refresh({bool background = false}) async {
    final previous = state.value;
    final next = await AsyncValue.guard(
      () => ref.read(passengerParcelRepositoryProvider).list(),
    );
    state = background && next.hasError && previous != null
        ? AsyncData(previous)
        : next;
  }

  /// Cancels, then reloads so the list always reflects what the server holds
  /// (a lost response can leave the cancellation committed).
  Future<PassengerParcel> cancel(
    PassengerParcel parcel,
    CancelChoice choice,
  ) async {
    try {
      return await ref
          .read(passengerParcelRepositoryProvider)
          .cancel(parcel.id, choice);
    } finally {
      await refresh();
    }
  }
}

/// Parcels still in flight; the home entry card badges this.
int openParcelCount(List<PassengerParcel> parcels) =>
    parcels.where((parcel) => !parcel.state.isFinal).length;
