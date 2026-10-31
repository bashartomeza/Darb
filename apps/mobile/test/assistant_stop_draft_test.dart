import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';

import 'support/auth_test_support.dart';

void main() {
  test('reads stop coordinates and ignores the extra intent block', () {
    final reply = PassengerAssistantReply.fromJson({
      'status': 'request_review',
      'message': 'Review',
      'extracted': {
        'pickup_key': 'hebron-center',
        'pickup_label': 'Hebron Center',
        'destination_key': 'bethlehem-center',
        'destination_label': 'Bethlehem Center',
        'preferred_time': '2030-01-02T12:00:00+02:00',
        'passenger_count': 2,
        'pickup_lat': 31.53,
        'pickup_lng': 35.1,
        'destination_lat': 31.7054,
        'destination_lng': 35.2024,
      },
      'intent': {'type': 'ride', 'confidence': 0.9},
    });
    expect(reply.draft?.pickupLat, 31.53);
    expect(reply.draft?.destinationLng, 35.2024);
  });

  test('a clarification carries the question and suggestions', () {
    final reply = PassengerAssistantReply.fromJson({
      'status': 'clarification',
      'question': 'متى تريد الانطلاق؟',
      'suggestions': ['بعد ساعة'],
      'intent': {'type': 'ride', 'confidence': 0.55},
    });
    expect(reply.type, PassengerAssistantReplyType.clarification);
    expect(reply.suggestions, ['بعد ساعة']);
  });

  test('searches with the matched stops, not the legacy corridor', () async {
    http.Request? search;
    final auth = TestAuthenticatedClient(
      handler: (request) async {
        search = request;
        return http.Response('{"results":[]}', 200);
      },
    );
    final repository = ApiPassengerAssistantRepository(apiClient: auth.client);
    await repository.searchTrips(
      PassengerAssistantTripDraft(
        pickupKey: 'hebron-center',
        pickupLabel: 'Hebron Center',
        destinationKey: 'ppu-main-gate',
        destinationLabel: 'PPU Main Gate',
        preferredTime: DateTime.utc(2030, 1, 2, 12),
        passengerCount: 2,
        pickupLat: 31.53,
        pickupLng: 35.1,
        destinationLat: 31.55,
        destinationLng: 35.1,
      ),
    );
    final body = jsonDecode(search!.body) as Map<String, dynamic>;
    expect(body['pickup_label'], 'Hebron Center');
    expect(body['pickup_lat'], 31.53);
    expect(body['destination_label'], 'PPU Main Gate');
    expect(body['destination_lat'], 31.55);
    expect(body['passenger_count'], 2);
  });

  test('rejects a stop draft that carries no coordinates', () async {
    final auth = TestAuthenticatedClient(
      handler: (request) async => http.Response('{"results":[]}', 200),
    );
    final repository = ApiPassengerAssistantRepository(apiClient: auth.client);
    await expectLater(
      repository.searchTrips(
        PassengerAssistantTripDraft(
          pickupKey: 'hebron-center',
          pickupLabel: 'Hebron Center',
          destinationKey: 'bethlehem',
          destinationLabel: 'Bethlehem Center',
          preferredTime: DateTime.utc(2030, 1, 2, 12),
          passengerCount: 1,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
  });
}
