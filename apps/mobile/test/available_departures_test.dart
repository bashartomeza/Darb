import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/passenger/data/passenger_repository.dart';
import 'package:darb_mobile/features/passenger/data/trip_offer_source.dart';

import 'support/auth_test_support.dart';

void main() {
  test('available departures map onto the offer cards', () async {
    final repo = PassengerRepository(
      apiClient: _client((request) async {
        expect(request.url.path, endsWith('/passenger/available-departures'));
        // Bytes, not a String: the payload carries Arabic route names and
        // http.Response's default latin1 encoding cannot represent them.
        return http.Response.bytes(utf8.encode(_departuresJson), 200);
      }),
    );

    final offers = await ApiTripOfferSource(repo).availableOffers();

    expect(offers, hasLength(1));
    final offer = offers.single;
    expect(offer.id, 'availability_1');
    expect(offer.driverName, 'Demo Driver Hebron Route');
    expect(offer.fromLabel, 'Bab Al-Zawiya');
    expect(offer.toLabel, 'Bethlehem Center');
    expect(offer.vehicleLabel, 'sedan');
    expect(offer.trustScore, 86);
    expect(offer.remainingSeats, 3);
    expect(offer.departureAt, isNotNull);

    // The schema backs none of these, so they must stay absent rather than
    // being filled with invented values.
    expect(offer.priceLabel, isNull);
    expect(offer.ratingOutOfFive, isNull);
    expect(offer.completedTrips, isNull);
    expect(offer.photoUrl, isNull);
    expect(offer.isSample, isFalse);
  });

  test(
    'a disabled canonical entry reads as "nothing to show", not an error',
    () async {
      final repo = PassengerRepository(
        apiClient: _client(
          (request) async => http.Response('{"error":"not_found"}', 404),
        ),
      );

      expect(await ApiTripOfferSource(repo).availableOffers(), isEmpty);
    },
  );

  test(
    'a real failure still surfaces so the screen can offer a retry',
    () async {
      final repo = PassengerRepository(
        apiClient: _client(
          (request) async => http.Response('{"error":"server_error"}', 500),
        ),
      );

      expect(
        () => ApiTripOfferSource(repo).availableOffers(),
        throwsA(isA<ApiException>()),
      );
    },
  );
}

AuthenticatedApiClient _client(
  Future<http.Response> Function(http.Request request) handler,
) {
  return TestAuthenticatedClient(handler: handler).client;
}

const _departuresJson =
    '{"departures":[{"id":"availability_1","route_version_id":"version_1","origin_label":"Bab Al-Zawiya","destination_label":"Bethlehem Center","departure_at":"2026-08-01T17:00:00.000Z","availability_window_end":"2026-08-01T17:30:00.000Z","remaining_seats":3,"remaining_parcel_capacity":5,"driver":{"name":"Demo Driver Hebron Route","vehicle_type":"sedan","trust_score":86,"verified":true},"route":{"id":"version_1","name_ar":"الخليل","name_en":"Hebron -> Bethlehem","direction":"outbound","stops":[]}}],"server_now":"2026-08-01T12:00:00.000Z"}';
