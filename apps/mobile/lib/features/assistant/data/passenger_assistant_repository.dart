import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_error.dart';

import '../../auth/data/authenticated_api_client.dart';
import '../../auth/application/auth_controller.dart';
import '../../passenger/data/passenger_models.dart';
import '../../passenger/application/legacy_passenger_request_mutation.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../domain/passenger_assistant_models.dart';

final passengerAssistantRepositoryProvider =
    Provider<PassengerAssistantRepository>((ref) {
      // Pending bookings belong to this account and must not survive logout.
      ref.watch(
        authControllerProvider.select((value) => value.value?.user?.id),
      );
      return ApiPassengerAssistantRepository(
        apiClient: ref.watch(authenticatedApiClientProvider),
        mutation: ref.watch(legacyPassengerRequestMutationProvider),
      );
    });

abstract interface class PassengerAssistantRepository {
  Future<PassengerAssistantReply> ask({
    required String message,
    required String locale,
    required List<PassengerAssistantMessage> history,
    String? conversationId,
  });

  Future<List<PassengerAssistantTripOption>> searchTrips(
    PassengerAssistantTripDraft draft,
  );

  Future<String> selectTrip({
    required PassengerAssistantTripDraft draft,
    required PassengerAssistantTripOption option,
  });
}

/// The create is confirmed even when matching is rejected or remains uncertain.
class AssistantSavedRequestException extends ApiException {
  const AssistantSavedRequestException(
    super.type,
    super.message, {
    required this.requestId,
    super.statusCode,
  });

  final String requestId;
}

class ApiPassengerAssistantRepository implements PassengerAssistantRepository {
  ApiPassengerAssistantRepository({required this.apiClient, this.mutation});

  final AuthenticatedApiClient apiClient;
  final LegacyPassengerRequestMutation? mutation;
  final Map<String, Future<CanonicalMutationReceipt<String>>> _createdRequests =
      {};

  @override
  Future<PassengerAssistantReply> ask({
    required String message,
    required String locale,
    required List<PassengerAssistantMessage> history,
    String? conversationId,
  }) async {
    final json = await apiClient.postJson(
      '/passenger/assistant/messages',
      body: {
        'message': message,
        'locale': locale,
        'conversation_id': ?conversationId,
        'history': history
            .takeLast(8)
            .map(
              (item) => {
                'role': item.role == PassengerAssistantMessageRole.passenger
                    ? 'user'
                    : 'assistant',
                'text': item.text,
              },
            )
            .toList(growable: false),
      },
    );
    return PassengerAssistantReply.fromJson(json);
  }

  @override
  Future<List<PassengerAssistantTripOption>> searchTrips(
    PassengerAssistantTripDraft draft,
  ) async {
    _validateDraft(draft);
    final json = await apiClient.postJson(
      '/matches/search',
      body: _requestBody(draft),
    );
    final rawResults = json['results'];
    if (rawResults is! List) {
      throw const FormatException('Missing match search results');
    }
    return rawResults
        .map((value) {
          if (value is! Map) {
            throw const FormatException('Invalid match search result');
          }
          return PassengerAssistantTripOption.fromJson(
            value.map((key, value) => MapEntry(key.toString(), value)),
          );
        })
        .toList(growable: false);
  }

  @override
  Future<String> selectTrip({
    required PassengerAssistantTripDraft draft,
    required PassengerAssistantTripOption option,
  }) async {
    _validateDraft(draft);
    final body = _requestBody(draft);
    final recovery = mutation;
    if (recovery == null) {
      // Booking callers must supply the actor-bound durable service. Read-only
      // assistant calls can still construct this repository without it.
      throw const ApiException(
        ApiErrorType.validation,
        'booking_recovery_unavailable',
      );
    }
    final actor = recovery.actorId;
    final receipt = await _requestForDraft(body, option, draft);
    final requestId = receipt.value;
    recovery.requireActor(actor);
    final context = receipt.bundle.payload['client_recovery'];
    final savedOption = context is Map ? context['option'] : null;
    final selectedRouteId = savedOption is Map ? savedOption['id'] : null;
    if (selectedRouteId is! String || selectedRouteId != option.id) {
      throw AssistantSavedRequestException(
        ApiErrorType.validation,
        'booking_saved_matching_unavailable',
        requestId: requestId,
      );
    }

    Map<String, dynamic> matched;
    try {
      matched = await apiClient.postJson(
        '/matches/run',
        body: {
          'passengerRequestId': requestId,
          'driverRouteId': selectedRouteId,
        },
      );
      final match = matched['match'];
      if (match is! Map ||
          match['id'] is! String ||
          (match['id'] as String).isEmpty) {
        throw const FormatException('Missing match result');
      }
    } catch (error) {
      // The request is known saved. A lost match response must recover that
      // request's existing active match rather than create another request.
      Map? recovered;
      var confirmedNoActiveMatch = false;
      try {
        final existing = await apiClient.getJson('/matches');
        final matches = existing['matches'];
        if (matches is! List) throw const FormatException('Missing matches');
        final active = matches
            .whereType<Map>()
            .where(
              (match) =>
                  match['passenger_request'] is Map &&
                  (match['passenger_request'] as Map)['id'] == requestId &&
                  [
                    'proposed',
                    'sent_to_driver',
                    'accepted',
                  ].contains(match['status']) &&
                  match['id'] is String,
            )
            .toList(growable: false);
        confirmedNoActiveMatch = active.isEmpty;
        recovered = active
            .where(
              (match) =>
                  match['driver_route'] is Map &&
                  (match['driver_route'] as Map)['id'] == selectedRouteId,
            )
            .firstOrNull;
      } catch (_) {
        recovery.requireActor(actor);
      }
      recovery.requireActor(actor);
      if (recovered != null) {
        matched = {'match': recovered};
      } else if (confirmedNoActiveMatch &&
          _definitiveMatchingRejection(error)) {
        await recovery.acknowledge(receipt);
        _createdRequests.remove('$actor:${jsonEncode(body)}');
        final rejection = error as ApiException;
        throw AssistantSavedRequestException(
          rejection.type,
          rejection.message,
          requestId: requestId,
          statusCode: rejection.statusCode,
        );
      } else {
        throw AssistantSavedRequestException(
          error is ApiException ? error.type : ApiErrorType.unknown,
          'booking_saved_matching_unavailable',
          requestId: requestId,
          statusCode: error is ApiException ? error.statusCode : null,
        );
      }
    }
    recovery.requireActor(actor);
    final match = matched['match'];
    if (match is! Map || match['id'] is! String) {
      throw const FormatException('Missing match result');
    }
    await recovery.acknowledge(receipt);
    return match['id'] as String;
  }

  Future<CanonicalMutationReceipt<String>> _requestForDraft(
    Map<String, dynamic> body,
    PassengerAssistantTripOption option,
    PassengerAssistantTripDraft draft,
  ) async {
    final key = '${mutation!.actorId}:${jsonEncode(body)}';
    final existing = _createdRequests[key];
    if (existing != null) return existing;

    final creation = _createRequest(body, option, draft);
    _createdRequests[key] = creation;
    try {
      return await creation;
    } catch (_) {
      _createdRequests.remove(key);
      if (await mutation!.pending() != null) {
        throw const ApiException(
          ApiErrorType.network,
          'booking_outcome_unknown',
        );
      }
      rethrow;
    }
  }

  Future<CanonicalMutationReceipt<String>> _createRequest(
    Map<String, dynamic> body,
    PassengerAssistantTripOption option,
    PassengerAssistantTripDraft draft,
  ) {
    return mutation!.create(
      payload: body,
      recoveryContext: {
        'draft': {
          'pickup_key': draft.pickupKey,
          'pickup_label': draft.pickupLabel,
          'destination_key': draft.destinationKey,
          'destination_label': draft.destinationLabel,
          'preferred_time': draft.preferredTime.toUtc().toIso8601String(),
          'passenger_count': draft.passengerCount,
        },
        'option': {
          'id': option.id,
          'origin_label': option.fromLabel,
          'destination_label': option.toLabel,
          'departure_at': option.departureAt?.toUtc().toIso8601String(),
          'availability_window_end': option.availabilityWindowEnd
              ?.toUtc()
              .toIso8601String(),
          'seats_available': option.seatsAvailable,
          'score': option.score,
          'driver': {
            'name': option.driverName,
            'vehicle_type': option.vehicleType,
            'trust_score': option.trustScore,
          },
        },
      },
      preflight: () async {
        final now = DateTime.now();
        if ((option.departureAt != null && !option.departureAt!.isAfter(now)) ||
            (option.availabilityWindowEnd != null &&
                !option.availabilityWindowEnd!.isAfter(now))) {
          throw const ApiException(
            ApiErrorType.validation,
            'booking_time_passed',
            statusCode: 400,
          );
        }
      },
      send: (payload, key, beforeRetry) => apiClient.postJson(
        '/passenger/requests',
        body: payload,
        headers: {'Idempotency-Key': key},
        beforeRetry: beforeRetry,
      ),
    );
  }

  /// A draft is bookable when each end is either a matched stop (carries its
  /// own coordinates) or one of the legacy preset places.
  void _validateDraft(PassengerAssistantTripDraft draft) {
    final pickupKnown =
        (draft.pickupLat != null && draft.pickupLng != null) ||
        lockedPickupPresets.any((value) => value.key == draft.pickupKey);
    final destinationKnown =
        (draft.destinationLat != null && draft.destinationLng != null) ||
        draft.destinationKey == 'bethlehem';
    if (!pickupKnown || !destinationKnown) {
      throw const FormatException('Unsupported extracted trip data');
    }
    if (draft.passengerCount < 1 || draft.passengerCount > 4) {
      throw const FormatException('Invalid passenger count');
    }
  }

  Map<String, dynamic> _requestBody(PassengerAssistantTripDraft draft) {
    final preset = lockedPickupPresets
        .where((value) => value.key == draft.pickupKey)
        .firstOrNull;
    final hasPickupCoordinates =
        draft.pickupLat != null && draft.pickupLng != null;
    final hasDestinationCoordinates =
        draft.destinationLat != null && draft.destinationLng != null;
    return {
      'pickup_label': hasPickupCoordinates ? draft.pickupLabel : preset!.label,
      'pickup_lat': hasPickupCoordinates ? draft.pickupLat : preset!.lat,
      'pickup_lng': hasPickupCoordinates ? draft.pickupLng : preset!.lng,
      'destination_label': hasDestinationCoordinates
          ? draft.destinationLabel
          : lockedDestinationLabel,
      'destination_lat': hasDestinationCoordinates
          ? draft.destinationLat
          : lockedDestinationLat,
      'destination_lng': hasDestinationCoordinates
          ? draft.destinationLng
          : lockedDestinationLng,
      'preferred_time': draft.preferredTime.toUtc().toIso8601String(),
      'passenger_count': draft.passengerCount,
    };
  }
}

bool _definitiveMatchingRejection(Object error) =>
    error is ApiException &&
    error.message != 'invalid_response' &&
    error.message != 'passenger_request_already_matched' &&
    [400, 404, 409, 422].contains(error.statusCode);

extension<T> on List<T> {
  Iterable<T> takeLast(int count) => skip(length > count ? length - count : 0);
}
