import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_error.dart';

import '../../auth/data/authenticated_api_client.dart';
import '../../auth/application/auth_controller.dart';
import '../../operating_routes/data/operating_route_models.dart';
import '../../passenger/application/legacy_passenger_request_mutation.dart';
import '../../passenger/data/passenger_models.dart';
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
  /// The account's saved chat, ready for a new question. It is stored on the
  /// server, so it is the same after a reinstall or on another device.
  Future<PassengerAssistantState> loadConversation();

  /// Deletes the account's saved chat; the next message starts a new one.
  Future<void> clearConversation();

  /// Records on the chat the request the passenger saved from it.
  Future<void> linkSavedRequest({
    required String conversationId,
    required String requestId,
  });

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
  Future<PassengerAssistantState> loadConversation() async {
    final json = await apiClient.getJson('/passenger/assistant/conversation');
    final conversation = json['conversation'];
    if (conversation == null) return const PassengerAssistantState();
    if (conversation is! Map || conversation['messages'] is! List) {
      throw const FormatException('Invalid assistant conversation');
    }
    final messages = (conversation['messages'] as List)
        .map((item) {
          if (item is! Map || item['text'] is! String) {
            throw const FormatException('Invalid assistant message');
          }
          return PassengerAssistantMessage(
            role: switch (item['role']) {
              'user' => PassengerAssistantMessageRole.passenger,
              'assistant' => PassengerAssistantMessageRole.assistant,
              _ => throw const FormatException('Invalid assistant role'),
            },
            text: item['text'] as String,
          );
        })
        .toList(growable: false);
    final id = conversation['id'];
    final savedRequestId = conversation['saved_request_id'];
    final last = _openReply(conversation['messages'] as List);
    return PassengerAssistantState(
      phase: switch (last?.type) {
        PassengerAssistantReplyType.clarification =>
          PassengerAssistantPhase.clarification,
        PassengerAssistantReplyType.requestReview =>
          PassengerAssistantPhase.requestReview,
        _ => PassengerAssistantPhase.ready,
      },
      messages: messages,
      suggestions: last?.suggestions ?? const [],
      draft: last?.draft,
      conversationId: id is String ? id : null,
      savedRequestId: savedRequestId is String ? savedRequestId : null,
    );
  }

  /// The chat's last reply when it still waits on the passenger (a question
  /// with suggestions, or a trip to review), rebuilt from its saved payload so
  /// reopening the chat shows the same choices. Anything else, or a payload
  /// this build cannot read, reopens as plain text.
  PassengerAssistantReply? _openReply(List<dynamic> raw) {
    if (raw.isEmpty) return null;
    final item = raw.last;
    if (item is! Map || item['role'] != 'assistant') return null;
    final payload = item['payload'];
    if (payload is! Map) return null;
    try {
      final reply = PassengerAssistantReply.fromJson({
        ...payload.map((key, value) => MapEntry(key.toString(), value)),
        'message': item['text'],
        'question': item['text'],
      });
      return reply.type == PassengerAssistantReplyType.result ? null : reply;
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> clearConversation() =>
      apiClient.deleteJson('/passenger/assistant/conversation');

  @override
  Future<void> linkSavedRequest({
    required String conversationId,
    required String requestId,
  }) => apiClient.patchJson(
    '/passenger/assistant/conversation',
    body: {'conversation_id': conversationId, 'saved_request_id': requestId},
  );

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
    // Driver routes on the same predefined route; the exact places only
    // matter to the request itself.
    final json = await apiClient.postJson(
      '/matches/search',
      body: {
        'service_route_id': draft.serviceRouteId,
        'preferred_time': draft.preferredTime.toUtc().toIso8601String(),
        'passenger_count': draft.passengerCount,
      },
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
    _validateBooking(draft);
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
        // The route and the typed places travel with the pending booking, so
        // a restored chat shows and replays exactly what was confirmed.
        'draft': draft.toJson(),
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

  /// A draft is searchable once the passenger confirmed a route and typed
  /// both places (3–300 characters, as the API checks).
  void _validateDraft(PassengerAssistantTripDraft draft) {
    final routeId = draft.serviceRouteId;
    if (routeId == null || routeId.isEmpty) {
      throw const FormatException('Missing route');
    }
    if (!_detailsValid(draft.pickupDetails) ||
        !_detailsValid(draft.dropoffDetails)) {
      throw const FormatException('Invalid pickup or drop-off details');
    }
    if (draft.passengerCount < 1 || draft.passengerCount > 4) {
      throw const FormatException('Invalid passenger count');
    }
  }

  /// Booking also accepts a draft restored from a booking an older build left
  /// pending: it names places with coordinates instead of a route, and is
  /// replayed exactly as it was first sent (the server still accepts it).
  void _validateBooking(PassengerAssistantTripDraft draft) {
    if (draft.serviceRouteId == null && _legacyPlaces(draft)) {
      if (draft.passengerCount < 1 || draft.passengerCount > 4) {
        throw const FormatException('Invalid passenger count');
      }
      return;
    }
    _validateDraft(draft);
  }

  Map<String, dynamic> _requestBody(PassengerAssistantTripDraft draft) {
    final routeId = draft.serviceRouteId;
    if (routeId == null) {
      return {
        'pickup_label': draft.pickupLabel,
        'pickup_lat': draft.pickupLat,
        'pickup_lng': draft.pickupLng,
        'destination_label': draft.destinationLabel,
        'destination_lat': draft.destinationLat,
        'destination_lng': draft.destinationLng,
        'preferred_time': draft.preferredTime.toUtc().toIso8601String(),
        'passenger_count': draft.passengerCount,
      };
    }
    return passengerRouteRequestBody(
      serviceRouteId: routeId,
      pickupDetails: draft.pickupDetails!,
      dropoffDetails: draft.dropoffDetails!,
      preferredTime: draft.preferredTime,
      passengerCount: draft.passengerCount,
    );
  }
}

bool _legacyPlaces(PassengerAssistantTripDraft draft) =>
    draft.pickupLat != null &&
    draft.pickupLng != null &&
    draft.destinationLat != null &&
    draft.destinationLng != null;

bool _detailsValid(String? value) {
  final length = value?.trim().length ?? 0;
  return length >= 3 && length <= routeDetailsMaxLength;
}

bool _definitiveMatchingRejection(Object error) =>
    error is ApiException &&
    error.message != 'invalid_response' &&
    error.message != 'passenger_request_already_matched' &&
    [400, 404, 409, 422].contains(error.statusCode);

extension<T> on List<T> {
  Iterable<T> takeLast(int count) => skip(length > count ? length - count : 0);
}
