import '../../delivery_handover/data/delivery_handover_models.dart';
import '../../matching/data/matching_models.dart';
import '../../trips/data/trip_models.dart';

const merchantPickupLabel = 'Hebron Merchant Pickup';
const merchantPickupLat = 31.5326;
const merchantPickupLng = 35.0998;
const merchantDestinationLat = 31.7054;
const merchantDestinationLng = 35.2024;
const merchantDestinations = [
  'Bethlehem Market',
  'Bethlehem University Area',
  'Manger Street',
  'Beit Jala Junction',
  'Bethlehem Center',
];
const merchantTripTimeline = [
  'accepted',
  'pickup_started',
  'picked_up',
  'in_transit',
  'delivered',
  'completed',
];

class ParcelDraft {
  const ParcelDraft({
    this.destinationLabel = 'Bethlehem Market',
    this.size = 'S',
    this.priority = 'normal',
  });

  final String destinationLabel;
  final String size;
  final String priority;

  ParcelDraft copyWith({
    String? destinationLabel,
    String? size,
    String? priority,
  }) => ParcelDraft(
    destinationLabel: destinationLabel ?? this.destinationLabel,
    size: size ?? this.size,
    priority: priority ?? this.priority,
  );

  Map<String, dynamic> toJson() => {
    'destination_label': destinationLabel,
    'destination_lat': merchantDestinationLat,
    'destination_lng': merchantDestinationLng,
    'size': size,
    'priority': priority,
  };
}

class MerchantParcel {
  const MerchantParcel({
    required this.id,
    required this.destinationLabel,
    required this.size,
    required this.priority,
    required this.status,
  });

  final String id;
  final String destinationLabel;
  final String size;
  final String priority;
  final String status;

  factory MerchantParcel.fromJson(Map<String, dynamic> json) => MerchantParcel(
    id: _string(json, 'id'),
    destinationLabel: _string(json, 'destination_label'),
    size: _string(json, 'size'),
    priority: _string(json, 'priority'),
    status: _string(json, 'status'),
  );
}

class MerchantRouteSummary {
  const MerchantRouteSummary({
    required this.id,
    required this.originLabel,
    required this.destinationLabel,
    required this.status,
    required this.parcelCapacity,
  });

  final String id;
  final String originLabel;
  final String destinationLabel;
  final String status;
  final int parcelCapacity;

  factory MerchantRouteSummary.fromJson(Map<String, dynamic> json) =>
      MerchantRouteSummary(
        id: _string(json, 'id'),
        originLabel: _string(json, 'origin_label'),
        destinationLabel: _string(json, 'destination_label'),
        status: _string(json, 'status'),
        parcelCapacity: _intOrZero(json['parcel_capacity_available']),
      );
}

class MerchantBatch {
  const MerchantBatch({
    required this.id,
    required this.status,
    required this.estimatedDistanceSaved,
    required this.explanation,
    required this.createdAt,
    required this.route,
  });

  final String id;
  final String status;
  final double estimatedDistanceSaved;
  final String explanation;
  final DateTime? createdAt;
  final MerchantRouteSummary? route;

  factory MerchantBatch.fromJson(Map<String, dynamic> json) {
    final route = json['driver_route'];
    return MerchantBatch(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      estimatedDistanceSaved: _double(json, 'estimated_distance_saved'),
      explanation: _string(json, 'explanation'),
      createdAt: _dateOrNull(json['created_at']),
      route: route is Map<String, dynamic>
          ? MerchantRouteSummary.fromJson(route)
          : null,
    );
  }
}

class MerchantOrder {
  const MerchantOrder({
    required this.id,
    required this.pickupLabel,
    required this.status,
    required this.createdAt,
    required this.parcels,
    required this.batches,
    this.handover,
  });

  final String id;
  final String pickupLabel;
  final String status;
  final DateTime createdAt;
  final List<MerchantParcel> parcels;
  final List<MerchantBatch> batches;

  /// Receiver hand-over state; its `code` is set only on the creating response.
  final HandoverStatus? handover;

  bool get canBatch => status == 'submitted' && batches.isEmpty;
  bool get canCancel =>
      const {'submitted', 'batched', 'matched'}.contains(status);
  MerchantBatch? get latestBatch => batches.isEmpty ? null : batches.first;

  factory MerchantOrder.fromJson(Map<String, dynamic> json) {
    final parcels = json['parcels'];
    final batches = json['parcel_batches'];
    return MerchantOrder(
      id: _string(json, 'id'),
      pickupLabel: _string(json, 'pickup_label'),
      status: _string(json, 'status'),
      createdAt: DateTime.parse(_string(json, 'created_at')).toLocal(),
      parcels: parcels is List
          ? parcels
                .cast<Map<String, dynamic>>()
                .map(MerchantParcel.fromJson)
                .toList()
          : const [],
      batches: batches is List
          ? batches
                .cast<Map<String, dynamic>>()
                .map(MerchantBatch.fromJson)
                .toList()
          : const [],
      handover: json['handover'] is Map<String, dynamic>
          ? HandoverStatus.fromJson(json['handover'] as Map<String, dynamic>)
          : null,
    );
  }
}

class MerchantOrderSummary {
  const MerchantOrderSummary({
    required this.id,
    required this.pickupLabel,
    required this.status,
    required this.parcelCount,
  });

  final String id;
  final String pickupLabel;
  final String status;
  final int parcelCount;

  factory MerchantOrderSummary.fromJson(Map<String, dynamic> json) =>
      MerchantOrderSummary(
        id: _string(json, 'id'),
        pickupLabel: _string(json, 'pickup_label'),
        status: _string(json, 'status'),
        parcelCount: _intOrZero(json['parcel_count']),
      );
}

class MerchantMatch {
  const MerchantMatch({
    required this.id,
    required this.status,
    required this.score,
    required this.method,
    required this.explanation,
    required this.breakdown,
    required this.createdAt,
    required this.route,
    required this.order,
    required this.batch,
  });

  final String id;
  final String status;
  final double score;
  final String method;
  final String explanation;
  final ScoringBreakdown breakdown;
  final DateTime createdAt;
  final MerchantRouteSummary route;
  final MerchantOrderSummary order;
  final MerchantBatch? batch;

  bool get waitingForDriver =>
      status == 'proposed' || status == 'sent_to_driver';

  factory MerchantMatch.fromJson(Map<String, dynamic> json) {
    final order = json['merchant_order'];
    if (order is! Map<String, dynamic>) {
      throw const FormatException('Missing merchant_order');
    }
    final batch = json['parcel_batch'];
    return MerchantMatch(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      score: _double(json, 'score'),
      method: _string(json, 'method'),
      explanation: _string(json, 'explanation'),
      breakdown: ScoringBreakdown.fromJson(
        json['scoring_breakdown'] as Map<String, dynamic>,
      ),
      createdAt: DateTime.parse(_string(json, 'created_at')).toLocal(),
      route: MerchantRouteSummary.fromJson(
        json['driver_route'] as Map<String, dynamic>,
      ),
      order: MerchantOrderSummary.fromJson(order),
      batch: batch is Map<String, dynamic>
          ? MerchantBatch.fromJson(batch)
          : null,
    );
  }
}

class MerchantTrip {
  const MerchantTrip({
    required this.id,
    required this.status,
    required this.createdAt,
    required this.route,
    required this.order,
    required this.batch,
  });

  final String id;
  final String status;
  final DateTime createdAt;
  final MerchantRouteSummary route;
  final MerchantOrder order;
  final MerchantBatch? batch;

  bool get isActive =>
      status != 'completed' && status != 'cancelled' && status != 'failed';

  factory MerchantTrip.fromJson(Map<String, dynamic> json) {
    final orderJson = json['merchant_order'];
    if (orderJson is! Map<String, dynamic>) {
      throw const FormatException('Missing merchant_order');
    }
    final batch = json['parcel_batch'];
    return MerchantTrip(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      createdAt: DateTime.parse(_string(json, 'created_at')).toLocal(),
      route: MerchantRouteSummary.fromJson(
        json['driver_route'] as Map<String, dynamic>,
      ),
      order: MerchantOrder.fromJson({
        ...orderJson,
        'created_at': orderJson['created_at'] ?? json['created_at'],
        'parcels': orderJson['parcels'] ?? const [],
        'parcel_batches': const [],
      }),
      batch: batch is Map<String, dynamic>
          ? MerchantBatch.fromJson(batch)
          : null,
    );
  }
}

class MerchantTripViewState {
  const MerchantTripViewState({
    required this.trip,
    required this.order,
    required this.location,
  });

  final MerchantTrip trip;
  final MerchantOrder order;
  final TripLocation? location;
}

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Missing $key');
}

double _double(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toDouble();
  if (value is String) return double.parse(value);
  throw FormatException('Missing $key');
}

int _intOrZero(Object? value) => value is num ? value.toInt() : 0;

DateTime? _dateOrNull(Object? value) =>
    value is String ? DateTime.parse(value).toLocal() : null;
