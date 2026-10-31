import 'package:flutter_riverpod/flutter_riverpod.dart';

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

  Future<void> refresh() async {
    state = await AsyncValue.guard(
      () => ref.read(passengerParcelRepositoryProvider).list(),
    );
  }

  /// Cancels, then reloads so the list always reflects what the server holds
  /// (a lost response can leave the cancellation committed).
  Future<PassengerParcel> cancel(PassengerParcel parcel) async {
    try {
      return await ref
          .read(passengerParcelRepositoryProvider)
          .cancel(parcel.id);
    } finally {
      await refresh();
    }
  }
}

/// Parcels still in flight; the home entry card badges this.
int openParcelCount(List<PassengerParcel> parcels) =>
    parcels.where((parcel) => !parcel.state.isFinal).length;
