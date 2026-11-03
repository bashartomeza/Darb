import 'package:darb_mobile/core/fares/fare.dart';
import 'package:darb_mobile/features/ai_directives/ai_ui_directives.dart';

enum PassengerAssistantReplyType { clarification, requestReview, result }

class PassengerAssistantTripDraft {
  const PassengerAssistantTripDraft({
    required this.pickupKey,
    required this.pickupLabel,
    required this.destinationKey,
    required this.destinationLabel,
    required this.preferredTime,
    required this.passengerCount,
    this.pickupLat,
    this.pickupLng,
    this.destinationLat,
    this.destinationLng,
    this.serviceRouteId,
    this.pickupDetails,
    this.dropoffDetails,
  });

  factory PassengerAssistantTripDraft.fromJson(Map<String, dynamic> json) {
    final preferredTime = json['preferred_time'];
    final passengerCount = json['passenger_count'];
    if (preferredTime is! String || passengerCount is! num) {
      throw const FormatException('Invalid extracted trip data');
    }
    return PassengerAssistantTripDraft(
      pickupKey: _requiredString(json, 'pickup_key'),
      pickupLabel: _requiredString(json, 'pickup_label'),
      destinationKey: _requiredString(json, 'destination_key'),
      destinationLabel: _requiredString(json, 'destination_label'),
      preferredTime: DateTime.parse(preferredTime).toLocal(),
      passengerCount: passengerCount.toInt(),
      pickupLat: _optionalDouble(json['pickup_lat']),
      pickupLng: _optionalDouble(json['pickup_lng']),
      destinationLat: _optionalDouble(json['destination_lat']),
      destinationLng: _optionalDouble(json['destination_lng']),
      serviceRouteId: _optionalString(json['service_route_id']),
      pickupDetails: _optionalString(json['pickup_details']),
      dropoffDetails: _optionalString(json['dropoff_details']),
    );
  }

  final String pickupKey;
  final String pickupLabel;
  final String destinationKey;
  final String destinationLabel;
  final DateTime preferredTime;
  final int passengerCount;

  /// Coordinates of the matched stops. Absent for the legacy preset corridor.
  final double? pickupLat;
  final double? pickupLng;
  final double? destinationLat;
  final double? destinationLng;

  /// The predefined route and the exact places the passenger confirmed in the
  /// review card. Set before searching; the assistant itself only extracts
  /// places, which preselect the route and prefill the details.
  final String? serviceRouteId;
  final String? pickupDetails;
  final String? dropoffDetails;

  /// What a booking from this chat sends, also kept with a pending booking so
  /// a restored chat carries the same route and details.
  Map<String, dynamic> toJson() => {
    'pickup_key': pickupKey,
    'pickup_label': pickupLabel,
    'pickup_lat': pickupLat,
    'pickup_lng': pickupLng,
    'destination_key': destinationKey,
    'destination_label': destinationLabel,
    'destination_lat': destinationLat,
    'destination_lng': destinationLng,
    'preferred_time': preferredTime.toUtc().toIso8601String(),
    'passenger_count': passengerCount,
    'service_route_id': ?serviceRouteId,
    'pickup_details': ?pickupDetails,
    'dropoff_details': ?dropoffDetails,
  };

  PassengerAssistantTripDraft copyWith({
    String? pickupKey,
    String? pickupLabel,
    String? destinationKey,
    String? destinationLabel,
    DateTime? preferredTime,
    int? passengerCount,
    double? pickupLat,
    double? pickupLng,
    double? destinationLat,
    double? destinationLng,
    String? serviceRouteId,
    String? pickupDetails,
    String? dropoffDetails,
  }) => PassengerAssistantTripDraft(
    pickupKey: pickupKey ?? this.pickupKey,
    pickupLabel: pickupLabel ?? this.pickupLabel,
    destinationKey: destinationKey ?? this.destinationKey,
    destinationLabel: destinationLabel ?? this.destinationLabel,
    preferredTime: preferredTime ?? this.preferredTime,
    passengerCount: passengerCount ?? this.passengerCount,
    pickupLat: pickupLat ?? this.pickupLat,
    pickupLng: pickupLng ?? this.pickupLng,
    destinationLat: destinationLat ?? this.destinationLat,
    destinationLng: destinationLng ?? this.destinationLng,
    serviceRouteId: serviceRouteId ?? this.serviceRouteId,
    pickupDetails: pickupDetails ?? this.pickupDetails,
    dropoffDetails: dropoffDetails ?? this.dropoffDetails,
  );
}

class PassengerAssistantTripOption {
  const PassengerAssistantTripOption({
    required this.id,
    required this.driverName,
    required this.fromLabel,
    required this.toLabel,
    required this.seatsAvailable,
    required this.score,
    this.departureAt,
    this.availabilityWindowEnd,
    this.vehicleType,
    this.trustScore,
    this.fare,
  });

  factory PassengerAssistantTripOption.fromJson(Map<String, dynamic> json) {
    final rawDriver = json['driver'];
    if (rawDriver is! Map) {
      throw const FormatException('Missing trip driver');
    }
    final driver = rawDriver.map(
      (key, value) => MapEntry(key.toString(), value),
    );
    final rawDeparture = json['departure_at'];
    final rawWindowEnd = json['availability_window_end'];
    final rawSeats = json['seats_available'];
    final rawScore = json['score'];
    if (rawSeats is! num || rawScore is! num) {
      throw const FormatException('Invalid trip result');
    }

    return PassengerAssistantTripOption(
      id: _requiredString(json, 'id'),
      driverName: _requiredString(driver, 'name'),
      fromLabel: _requiredString(json, 'origin_label'),
      toLabel: _requiredString(json, 'destination_label'),
      departureAt: rawDeparture is String
          ? DateTime.parse(rawDeparture).toLocal()
          : null,
      availabilityWindowEnd: rawWindowEnd is String
          ? DateTime.parse(rawWindowEnd).toLocal()
          : null,
      seatsAvailable: rawSeats.toInt(),
      vehicleType: driver['vehicle_type'] as String?,
      trustScore: (driver['trust_score'] as num?)?.toInt(),
      score: rawScore.toDouble(),
      fare: FareSnapshot.tryParse(json['fare']),
    );
  }

  final String id;
  final String driverName;
  final String fromLabel;
  final String toLabel;
  final DateTime? departureAt;
  final DateTime? availabilityWindowEnd;
  final int seatsAvailable;
  final String? vehicleType;
  final int? trustScore;
  final double score;

  /// This driver's seat price (their own, else the route default); null when
  /// the route has no fare.
  final FareSnapshot? fare;
}

class PassengerAssistantReply {
  const PassengerAssistantReply({
    required this.type,
    required this.message,
    this.conversationId,
    this.suggestions = const [],
    this.draft,
    this.transcript,
    this.uiDirectives,
  });

  factory PassengerAssistantReply.fromJson(Map<String, dynamic> json) {
    final nested = json['reply'];
    final payload = nested is Map<String, dynamic> ? nested : json;
    final status = payload['status'];
    final type = switch (status) {
      'clarification' => PassengerAssistantReplyType.clarification,
      'request_review' => PassengerAssistantReplyType.requestReview,
      'result' => PassengerAssistantReplyType.result,
      _ => throw const FormatException('Unsupported assistant reply status'),
    };
    final rawMessage = switch (type) {
      PassengerAssistantReplyType.clarification =>
        payload['question'] ?? payload['message'],
      PassengerAssistantReplyType.requestReview => payload['message'],
      PassengerAssistantReplyType.result =>
        payload['answer'] ?? payload['message'],
    };
    if (rawMessage is! String || rawMessage.trim().isEmpty) {
      throw const FormatException('Missing assistant reply message');
    }

    final rawSuggestions = payload['suggestions'];
    final suggestions = rawSuggestions is List
        ? rawSuggestions
              .whereType<String>()
              .map((value) => value.trim())
              .where((value) => value.isNotEmpty)
              .toList(growable: false)
        : const <String>[];
    final rawConversationId =
        payload['conversation_id'] ?? json['conversation_id'];
    final rawTranscript = payload['transcript'];
    final rawDraft = payload['extracted'];
    final draft =
        type == PassengerAssistantReplyType.requestReview && rawDraft is Map
        ? PassengerAssistantTripDraft.fromJson(
            rawDraft.map((key, value) => MapEntry(key.toString(), value)),
          )
        : null;
    if (type == PassengerAssistantReplyType.requestReview && draft == null) {
      throw const FormatException('Missing extracted trip data');
    }

    return PassengerAssistantReply(
      type: type,
      message: rawMessage.trim(),
      conversationId:
          rawConversationId is String && rawConversationId.trim().isNotEmpty
          ? rawConversationId.trim()
          : null,
      suggestions: suggestions,
      draft: draft,
      transcript: rawTranscript is String && rawTranscript.trim().isNotEmpty
          ? rawTranscript.trim()
          : null,
      uiDirectives: AiUiDirectives.tryParse(
        payload['frontend_ai_ui_directives'],
      ),
    );
  }

  final PassengerAssistantReplyType type;
  final String message;
  final String? conversationId;
  final List<String> suggestions;
  final PassengerAssistantTripDraft? draft;

  /// Whisper transcript; only present on voice replies.
  final String? transcript;

  /// Validated UI directives from the AI service; null when absent or invalid.
  final AiUiDirectives? uiDirectives;
}

enum PassengerAssistantMessageRole { passenger, assistant }

class PassengerAssistantMessage {
  const PassengerAssistantMessage({required this.role, required this.text});

  const PassengerAssistantMessage.passenger(String text)
    : this(role: PassengerAssistantMessageRole.passenger, text: text);

  const PassengerAssistantMessage.assistant(String text)
    : this(role: PassengerAssistantMessageRole.assistant, text: text);

  final PassengerAssistantMessageRole role;
  final String text;
}

enum PassengerAssistantPhase {
  ready,
  processing,
  clarification,
  requestReview,
  searching,
  result,
  error,
}

enum PassengerAssistantFailure {
  unavailable,
  selectedDriverUnavailable,
  network,
  expired,
  unknownBooking,
  savedBooking,
  generic,
}

class PassengerAssistantState {
  const PassengerAssistantState({
    this.phase = PassengerAssistantPhase.ready,
    this.messages = const [],
    this.suggestions = const [],
    this.conversationId,
    this.lastQuery,
    this.lastLocale = 'ar',
    this.failure,
    this.draft,
    this.searchFailure,
    this.tripOptions = const [],
    this.selectingTripId,
    this.selectionFailure,
    this.savedRequestId,
    this.selectionRequestId,
  });

  final PassengerAssistantPhase phase;
  final List<PassengerAssistantMessage> messages;
  final List<String> suggestions;
  final String? conversationId;
  final String? lastQuery;
  final String lastLocale;
  final PassengerAssistantFailure? failure;
  final PassengerAssistantTripDraft? draft;
  final PassengerAssistantFailure? searchFailure;
  final List<PassengerAssistantTripOption> tripOptions;
  final String? selectingTripId;
  final PassengerAssistantFailure? selectionFailure;
  final String? savedRequestId;

  /// Saved request resolved by this selection attempt, never a previous search.
  final String? selectionRequestId;
}

String? _optionalString(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;

double? _optionalDouble(Object? value) =>
    value is num ? value.toDouble() : null;

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.trim().isNotEmpty) return value.trim();
  throw FormatException('Missing $key');
}
