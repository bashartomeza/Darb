import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../auth/data/authenticated_api_client.dart';
import 'passenger_models.dart';

final passengerRepositoryProvider = Provider<PassengerRepository>((ref) {
  return PassengerRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class PassengerRepository {
  const PassengerRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<Map<String, dynamic>> createPayload(
    Map<String, dynamic> payload,
    String key,
    Future<void> Function() beforeRetry,
  ) => apiClient.postJson(
    '/passenger/requests',
    body: payload,
    headers: {'Idempotency-Key': key},
    beforeRetry: beforeRetry,
  );

  // --------------------------------------------------------------------------
  // LIST REQUESTS
  // --------------------------------------------------------------------------

  Future<List<PassengerRequest>> listRequests() async {
    final json = await apiClient.getJson('/passenger/requests');

    return _requests(json);
  }

  // --------------------------------------------------------------------------
  // AVAILABLE DEPARTURES
  // --------------------------------------------------------------------------

  /// Active driver availabilities the passenger could book.
  ///
  /// Returns an empty list when canonical entry is switched off.
  /// The endpoint 404s in that case, which means this build has
  /// no driver supply to show.
  Future<List<AvailableDeparture>> availableDepartures({int limit = 25}) async {
    try {
      final json = await apiClient.getJson(
        '/passenger/available-departures?limit=$limit',
      );

      final list = json['departures'];

      if (list is! List) {
        throw const FormatException('Missing departures');
      }

      return list
          .cast<Map<String, dynamic>>()
          .map(AvailableDeparture.fromJson)
          .toList(growable: false);
    } on ApiException catch (error) {
      if (error.statusCode == 404) {
        return const [];
      }

      rethrow;
    }
  }

  // --------------------------------------------------------------------------
  // ACTIVE REQUESTS
  // --------------------------------------------------------------------------

  Future<List<PassengerRequest>> activeRequests() async {
    final json = await apiClient.getJson('/passenger/requests/active');

    return _requests(json);
  }

  // --------------------------------------------------------------------------
  // REQUEST DETAIL
  // --------------------------------------------------------------------------

  Future<PassengerRequest> requestDetail(
    String id, {
    void Function()? beforeSend,
  }) async {
    final json = await apiClient.getJson(
      '/passenger/requests/$id',
      beforeSend: beforeSend,
    );

    return PassengerRequest.fromJson(json['request'] as Map<String, dynamic>);
  }

  // --------------------------------------------------------------------------
  // CREATE REQUEST
  // --------------------------------------------------------------------------

  /// Creates a passenger request using arbitrary locations selected
  /// by the passenger.
  ///
  /// The backend already supports:
  /// - pickup label
  /// - pickup latitude
  /// - pickup longitude
  /// - destination label
  /// - destination latitude
  /// - destination longitude
  ///
  /// Therefore there is no longer any hardcoded PPU/Bab Al-Zawiya
  /// pickup or Bethlehem destination here.
  Future<PassengerRequest> createRequest({
    required PassengerLocation pickup,
    required PassengerLocation destination,
    required DateTime preferredTime,
    required int passengerCount,
  }) async {
    final json = await apiClient.postJson(
      '/passenger/requests',
      body: {
        // --------------------------------------------------------------
        // PICKUP
        // --------------------------------------------------------------
        'pickup_label': pickup.label,
        'pickup_lat': pickup.latitude,
        'pickup_lng': pickup.longitude,

        // --------------------------------------------------------------
        // DESTINATION
        // --------------------------------------------------------------
        'destination_label': destination.label,
        'destination_lat': destination.latitude,
        'destination_lng': destination.longitude,

        // --------------------------------------------------------------
        // TRIP DETAILS
        // --------------------------------------------------------------
        'preferred_time': preferredTime.toUtc().toIso8601String(),

        'passenger_count': passengerCount,
      },
    );

    return PassengerRequest.fromJson(json['request'] as Map<String, dynamic>);
  }

  // --------------------------------------------------------------------------
  // CANCEL REQUEST
  // --------------------------------------------------------------------------

  Future<PassengerRequest> cancelRequest(
    String id, {
    void Function()? beforeSend,
  }) async {
    final json = await apiClient.patchJson(
      '/passenger/requests/$id/cancel',
      beforeSend: beforeSend,
    );

    return PassengerRequest.fromJson(json['request'] as Map<String, dynamic>);
  }

  // --------------------------------------------------------------------------
  // INTERNAL PARSER
  // --------------------------------------------------------------------------

  List<PassengerRequest> _requests(Map<String, dynamic> json) {
    final list = json['requests'];

    if (list is! List) {
      throw const FormatException('Missing requests');
    }

    return list
        .cast<Map<String, dynamic>>()
        .map(PassengerRequest.fromJson)
        .toList();
  }
}
