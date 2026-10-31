import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/trip_offer.dart';
import 'passenger_models.dart';
import 'passenger_repository.dart';

/// Where the passenger home screen gets its bookable trips.
abstract interface class TripOfferSource {
  Future<List<TripOffer>> availableOffers();
}

/// Real driver supply, from `GET /passenger/available-departures`.
///
/// This replaces the sample cards the screen used to show in demo builds. Every
/// value here comes from the API: the driver name, vehicle type and trust score
/// are the driver's own record, and the departure time and remaining seats are
/// the live availability the canonical matcher would actually consider.
///
/// The fare is the route's display-only estimate (null until an admin sets
/// one). The fields the schema genuinely cannot supply — star rating, completed
/// trips, photo — are left null, and [TripOfferCard] omits those rows rather
/// than inventing them.
class ApiTripOfferSource implements TripOfferSource {
  const ApiTripOfferSource(this._repository);

  final PassengerRepository _repository;

  @override
  Future<List<TripOffer>> availableOffers() async {
    final departures = await _repository.availableDepartures();
    return departures.map(_toOffer).toList(growable: false);
  }

  TripOffer _toOffer(AvailableDeparture departure) {
    return TripOffer(
      id: departure.id,
      driverName: departure.driverName,
      fromLabel: departure.originLabel,
      toLabel: departure.destinationLabel,
      vehicleLabel: departure.vehicleType,
      trustScore: departure.trustScore,
      departureAt: departure.departureAt,
      remainingSeats: departure.remainingSeats,
      fareSeatMinor: departure.fares?.passengerSeatMinor,
      fareCurrency: departure.fares?.currency,
    );
  }
}

final tripOfferSourceProvider = Provider<TripOfferSource>((ref) {
  return ApiTripOfferSource(ref.watch(passengerRepositoryProvider));
});

final availableTripOffersProvider = FutureProvider<List<TripOffer>>((ref) {
  return ref.watch(tripOfferSourceProvider).availableOffers();
});
