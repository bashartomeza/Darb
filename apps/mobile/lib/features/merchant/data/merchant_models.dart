import '../../../core/fares/fare.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../delivery_handover/data/delivery_handover_models.dart';
import '../../matching/data/matching_models.dart';
import '../../operating_routes/data/operating_route_models.dart';
import '../../trips/data/trip_models.dart';

const merchantTripTimeline = [
  'accepted',
  'pickup_started',
  'picked_up',
  'in_transit',
  'delivered',
  'completed',
];

/// One parcel of an order being written: where it goes, as free text the
/// driver reads, plus its size, priority and an optional receiver.
class ParcelDraft {
  const ParcelDraft({
    this.id = 0,
    this.dropoffDetails = '',
    this.size = 'S',
    this.priority = 'normal',
    this.receiverName = '',
    this.receiverPhone = '',
  });

  /// Stable within one form, so a parcel's text fields follow it when an
  /// earlier parcel is removed. Never sent.
  final int id;
  final String dropoffDetails;
  final String size;
  final String priority;
  final String receiverName;
  final String receiverPhone;

  ParcelDraft copyWith({
    String? dropoffDetails,
    String? size,
    String? priority,
    String? receiverName,
    String? receiverPhone,
  }) => ParcelDraft(
    id: id,
    dropoffDetails: dropoffDetails ?? this.dropoffDetails,
    size: size ?? this.size,
    priority: priority ?? this.priority,
    receiverName: receiverName ?? this.receiverName,
    receiverPhone: receiverPhone ?? this.receiverPhone,
  );

  /// The parcel as `POST /merchant/orders` takes it. Blank receiver fields are
  /// left out.
  Map<String, dynamic> toJson() {
    final name = receiverName.trim();
    final phone = receiverPhone.trim();
    return {
      'dropoff_details': dropoffDetails.trim(),
      'size': size,
      'priority': priority,
      if (name.isNotEmpty) 'receiver_name': name,
      if (phone.isNotEmpty) 'receiver_phone': phone,
    };
  }
}

/// Shortest pickup or drop-off text the server accepts.
const routeDetailsMinLength = 3;

/// Longest receiver name sent with a parcel.
const receiverNameMaxLength = 100;

/// True when a pickup or drop-off text can be sent (3-300 characters once
/// trimmed).
bool routeDetailsValid(String value) {
  final length = value.trim().length;
  return length >= routeDetailsMinLength && length <= routeDetailsMaxLength;
}

/// A receiver phone the server can normalise: digits with an optional leading
/// +, spaces or dashes. Blank means none and is valid.
bool receiverPhoneValid(String value) {
  final phone = value.trim();
  if (phone.isEmpty) return true;
  return phone.length >= 5 &&
      phone.length <= 32 &&
      RegExp(r'^\+?[0-9][0-9 \-]*[0-9]$').hasMatch(phone);
}

/// A route name stored with an order or a driver route, in the reader's
/// language; null for rows created before routes existed.
String? storedRouteName(
  String? nameAr,
  String? nameEn, {
  required bool arabic,
}) {
  final ar = nameAr?.trim() ?? '';
  final en = nameEn?.trim() ?? '';
  if (arabic && ar.isNotEmpty) return ar;
  if (en.isNotEmpty) return en;
  return ar.isNotEmpty ? ar : null;
}

/// A saved, not-yet-confirmed order read back for display, exactly as it
/// will be resent. Orders saved by older app builds name corridor places
/// (`pickup_label`, `destination_label`); newer ones name a route and typed
/// details.
class PendingOrderPreview {
  const PendingOrderPreview({
    required this.pickup,
    required this.parcels,
    this.serviceRouteId,
  });

  /// Null for an order saved before routes existed.
  final String? serviceRouteId;

  /// The typed pickup details, or the older corridor place label.
  final String pickup;
  final List<PendingParcelPreview> parcels;

  bool get legacy => serviceRouteId == null;

  factory PendingOrderPreview.fromPayload(Map<String, dynamic> payload) {
    final routeId = payload['service_route_id'];
    final pickup = routeId is String
        ? payload['pickup_details']
        : payload['pickup_label'];
    final parcels = payload['parcels'];
    if (pickup is! String || parcels is! List || parcels.isEmpty) {
      throw const FormatException('Unreadable pending order');
    }
    return PendingOrderPreview(
      serviceRouteId: routeId is String ? routeId : null,
      pickup: pickup,
      parcels: [
        for (final parcel in parcels)
          if (parcel is Map<String, dynamic>)
            PendingParcelPreview.fromJson(parcel, legacy: routeId is! String)
          else
            throw const FormatException('Unreadable pending parcel'),
      ],
    );
  }
}

class PendingParcelPreview {
  const PendingParcelPreview({
    required this.dropoff,
    required this.size,
    required this.priority,
    this.receiverName,
  });

  /// The typed drop-off details, or the older corridor place label.
  final String dropoff;
  final String size;
  final String priority;
  final String? receiverName;

  factory PendingParcelPreview.fromJson(
    Map<String, dynamic> json, {
    required bool legacy,
  }) {
    final dropoff = json[legacy ? 'destination_label' : 'dropoff_details'];
    final size = json['size'];
    final priority = json['priority'];
    if (dropoff is! String || size is! String || priority is! String) {
      throw const FormatException('Unreadable pending parcel');
    }
    return PendingParcelPreview(
      dropoff: dropoff,
      size: size,
      priority: priority,
      receiverName: _text(json['receiver_name']),
    );
  }
}

class MerchantParcel {
  const MerchantParcel({
    required this.id,
    required this.destinationLabel,
    required this.size,
    required this.priority,
    required this.status,
    this.destinationPosition,
    this.dropoffDetails,
    this.receiverName,
  });

  final String id;
  final String destinationLabel;
  final String size;
  final String priority;
  final String status;

  /// The drop-off stored with the parcel; null when the record has none.
  final GeoPoint? destinationPosition;

  /// Where exactly the parcel goes, as typed; null for parcels created before
  /// routes existed.
  final String? dropoffDetails;
  final String? receiverName;

  factory MerchantParcel.fromJson(Map<String, dynamic> json) => MerchantParcel(
    id: _string(json, 'id'),
    destinationLabel: _string(json, 'destination_label'),
    size: _string(json, 'size'),
    priority: _string(json, 'priority'),
    status: _string(json, 'status'),
    destinationPosition: _point(json, 'destination_lat', 'destination_lng'),
    dropoffDetails: _text(json['dropoff_details']),
    receiverName: _text(json['receiver_name']),
  );
}

class MerchantRouteSummary {
  const MerchantRouteSummary({
    required this.id,
    required this.originLabel,
    required this.destinationLabel,
    required this.status,
    required this.parcelCapacity,
    this.routeNameAr,
    this.routeNameEn,
  });

  final String id;
  final String originLabel;
  final String destinationLabel;
  final String status;
  final int parcelCapacity;

  /// The predefined route the driver chose; null for older routes.
  final String? routeNameAr;
  final String? routeNameEn;

  String? routeName({required bool arabic}) =>
      storedRouteName(routeNameAr, routeNameEn, arabic: arabic);

  factory MerchantRouteSummary.fromJson(Map<String, dynamic> json) =>
      MerchantRouteSummary(
        id: _string(json, 'id'),
        originLabel: _string(json, 'origin_label'),
        destinationLabel: _string(json, 'destination_label'),
        status: _string(json, 'status'),
        parcelCapacity: _intOrZero(json['parcel_capacity_available']),
        routeNameAr: _text(json['route_name_ar']),
        routeNameEn: _text(json['route_name_en']),
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
    this.orderCount = 1,
    this.orderIds = const [],
  });

  final String id;
  final String status;
  final double estimatedDistanceSaved;
  final String explanation;
  final DateTime? createdAt;
  final MerchantRouteSummary? route;

  /// How many orders ride in this batch (this one included).
  final int orderCount;

  /// The batch's orders, when the payload lists them.
  final List<String> orderIds;

  /// Still waiting for a driver to accept it.
  bool get isOpen => status == 'created' || status == 'proposed';

  factory MerchantBatch.fromJson(Map<String, dynamic> json) {
    final route = json['driver_route'];
    final members = json['member_orders'];
    final listed = json['order_ids'];
    final orderIds = [
      if (members is List)
        for (final member in members)
          if (member is Map && member['id'] is String) member['id'] as String,
      if (listed is List) ...listed.whereType<String>(),
    ];
    return MerchantBatch(
      id: _string(json, 'id'),
      status: _string(json, 'status'),
      estimatedDistanceSaved: _double(json, 'estimated_distance_saved'),
      explanation: _string(json, 'explanation'),
      createdAt: _dateOrNull(json['created_at']),
      route: route is Map<String, dynamic>
          ? MerchantRouteSummary.fromJson(route)
          : null,
      orderCount: json['order_count'] is num
          ? (json['order_count'] as num).toInt()
          : orderIds.isEmpty
          ? 1
          : orderIds.length,
      orderIds: orderIds,
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
    this.pickupPosition,
    this.serviceRouteId,
    this.routeNameAr,
    this.routeNameEn,
    this.pickupDetails,
    this.fare,
  });

  final String id;
  final String pickupLabel;

  /// The order's fare frozen at creation (the sum of its parcels' size
  /// fares); null when the route had no fare for every parcel.
  final FareSnapshot? fare;

  /// The pickup stored with the order; null when the record has none.
  final GeoPoint? pickupPosition;

  /// The predefined route and the exact pickup as typed; all null for orders
  /// created before routes existed.
  final String? serviceRouteId;
  final String? routeNameAr;
  final String? routeNameEn;
  final String? pickupDetails;

  String? routeName({required bool arabic}) =>
      storedRouteName(routeNameAr, routeNameEn, arabic: arabic);
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

  /// The order's route from its own record: pickup, then each distinct parcel
  /// drop-off in order. Empty when the pickup or every drop-off is unknown.
  List<GeoPoint> get routeWaypoints {
    final pickup = pickupPosition;
    if (pickup == null) return const [];
    final drops = <GeoPoint>[];
    for (final parcel in parcels) {
      final drop = parcel.destinationPosition;
      if (drop != null && !drops.contains(drop) && drop != pickup) {
        drops.add(drop);
      }
    }
    return drops.isEmpty ? const [] : List.unmodifiable([pickup, ...drops]);
  }

  /// Drop-off labels matching the stops of [routeWaypoints] after the pickup.
  List<String> get routeDropLabels {
    final seen = <GeoPoint>{};
    return [
      for (final parcel in parcels)
        if (parcel.destinationPosition != null &&
            parcel.destinationPosition != pickupPosition &&
            seen.add(parcel.destinationPosition!))
          parcel.destinationLabel,
    ];
  }

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
      pickupPosition: _point(json, 'pickup_lat', 'pickup_lng'),
      serviceRouteId: _text(json['service_route_id']),
      routeNameAr: _text(json['route_name_ar']),
      routeNameEn: _text(json['route_name_en']),
      pickupDetails: _text(json['pickup_details']),
      fare: FareSnapshot.tryParse(json['fare']),
    );
  }
}

class MerchantOrderSummary {
  const MerchantOrderSummary({
    required this.id,
    required this.pickupLabel,
    required this.status,
    required this.parcelCount,
    this.routeNameAr,
    this.routeNameEn,
    this.pickupDetails,
    this.dropoffs = const [],
  });

  final String id;
  final String pickupLabel;
  final String status;
  final int parcelCount;
  final String? routeNameAr;
  final String? routeNameEn;
  final String? pickupDetails;

  /// Each parcel's drop-off as typed (or the older place label), in order and
  /// without repeats; empty when the payload has no parcels.
  final List<String> dropoffs;

  String? routeName({required bool arabic}) =>
      storedRouteName(routeNameAr, routeNameEn, arabic: arabic);

  factory MerchantOrderSummary.fromJson(Map<String, dynamic> json) {
    final parcels = json['parcels'];
    return MerchantOrderSummary(
      id: _string(json, 'id'),
      pickupLabel: _string(json, 'pickup_label'),
      status: _string(json, 'status'),
      parcelCount: _intOrZero(json['parcel_count']),
      routeNameAr: _text(json['route_name_ar']),
      routeNameEn: _text(json['route_name_en']),
      pickupDetails: _text(json['pickup_details']),
      dropoffs: parcels is List
          ? {
              for (final parcel in parcels)
                if (parcel is Map<String, dynamic>)
                  ?(_text(parcel['dropoff_details']) ??
                      _text(parcel['destination_label'])),
            }.toList()
          : const [],
    );
  }
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
    this.driverPhone,
    this.batchOrders = const [],
  });

  final String id;
  final String status;
  final DateTime createdAt;
  final MerchantRouteSummary route;
  final MerchantOrder order;
  final MerchantBatch? batch;

  /// The driver's phone, sent only from the driver's acceptance until drop-off.
  final String? driverPhone;

  /// This merchant's own orders on the trip when it carries a batch, each with
  /// its pickup, drop-offs and receivers (the trip detail lists them).
  final List<MerchantOrder> batchOrders;

  bool get isActive =>
      status != 'completed' && status != 'cancelled' && status != 'failed';

  /// Whether [orderId] rides on this trip: its lead order or any batch order.
  bool carriesOrder(String orderId) =>
      order.id == orderId ||
      (batch?.orderIds.contains(orderId) ?? false) ||
      batchOrders.any((item) => item.id == orderId);

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
      driverPhone: tripDriverPhone(json),
      batchOrders: batch is Map<String, dynamic> && batch['orders'] is List
          ? [
              for (final item in batch['orders'] as List)
                if (item is Map<String, dynamic>)
                  MerchantOrder.fromJson({
                    ...item,
                    'created_at': item['created_at'] ?? json['created_at'],
                    'parcels': item['parcels'] ?? const [],
                    'parcel_batches': const [],
                  }),
            ]
          : const [],
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

/// A stored coordinate pair (numbers or decimal strings), or null when either
/// part is missing or invalid. Never filled in with a default place.
GeoPoint? _point(Map<String, dynamic> json, String latKey, String lngKey) {
  double? read(Object? value, double limit) {
    final number = value is num
        ? value.toDouble()
        : value is String
        ? double.tryParse(value.trim())
        : null;
    return number != null && number.isFinite && number.abs() <= limit
        ? number
        : null;
  }

  final lat = read(json[latKey], 90);
  final lng = read(json[lngKey], 180);
  return lat == null || lng == null ? null : GeoPoint(lat, lng);
}

int _intOrZero(Object? value) => value is num ? value.toInt() : 0;

/// An optional text field: trimmed, or null when absent or blank.
String? _text(Object? value) {
  if (value is! String) return null;
  final text = value.trim();
  return text.isEmpty ? null : text;
}

DateTime? _dateOrNull(Object? value) =>
    value is String ? DateTime.parse(value).toLocal() : null;
