import '../../../core/fares/fare.dart';

/// Where a parcel sent by a passenger is, from the sender's point of view.
///
/// Mirrors `tracking_state` in the API. Unknown values from a newer server fall
/// back to [searching] so the app never shows a blank or crashes.
enum ParcelTrackingState {
  searching,
  assigned,
  pickedUp,
  inTransit,
  delivered,
  cancelled,
  failed,
  expired;

  static ParcelTrackingState parse(Object? value) => switch (value) {
    'assigned' => assigned,
    'picked_up' => pickedUp,
    'in_transit' => inTransit,
    'delivered' => delivered,
    'cancelled' => cancelled,
    'failed' => failed,
    'expired' => expired,
    _ => searching,
  };

  /// The parcel is finished one way or another.
  bool get isFinal => switch (this) {
    delivered || cancelled || failed || expired => true,
    _ => false,
  };

  /// Ordered happy-path steps shown as a progress tracker.
  static const List<ParcelTrackingState> progression = [
    searching,
    assigned,
    pickedUp,
    inTransit,
    delivered,
  ];
}

/// Limits the sender is held to, so the form can explain them up front.
class PassengerParcelLimits {
  const PassengerParcelLimits._();
  static const int noteMaxLength = 200;
  static const int receiverNameMaxLength = 80;
  static const List<String> sizes = ['S', 'M'];
}

class PassengerParcel {
  const PassengerParcel({
    required this.id,
    required this.state,
    required this.size,
    required this.pickupLabel,
    required this.dropoffLabel,
    required this.receiverName,
    required this.receiverPhoneMasked,
    required this.receiverDetailsRemoved,
    required this.note,
    required this.canCancel,
    required this.createdAt,
    this.departureFrom,
    this.departureUntil,
    this.replayed = false,
    this.handoverCode,
    this.serviceRouteId,
    this.routeNameAr,
    this.routeNameEn,
    this.pickupDetails,
    this.dropoffDetails,
    this.preferredTime,
    this.fare,
  });

  final String id;
  final ParcelTrackingState state;
  final String size;
  final String pickupLabel;
  final String? dropoffLabel;

  /// Only ever the sender's own entry; null once the retention period passed.
  final String? receiverName;
  final String? receiverPhoneMasked;
  final bool receiverDetailsRemoved;
  final String? note;
  final bool canCancel;
  final DateTime createdAt;
  final DateTime? departureFrom;
  final DateTime? departureUntil;
  final bool replayed;

  /// The receiver's six-digit handover code. Only the create response carries
  /// it, once; an idempotent replay, the list and the detail never do. It lives
  /// in the screen's state only and is never saved on the device.
  final String? handoverCode;

  /// The predefined route and the exact places typed by the sender; null for
  /// parcels sent before routes existed, which keep their stop labels.
  final String? serviceRouteId;
  final String? routeNameAr;
  final String? routeNameEn;
  final String? pickupDetails;
  final String? dropoffDetails;
  final DateTime? preferredTime;

  /// The route's fare for this parcel size, frozen when it was sent; null
  /// when the route had no fare.
  final FareSnapshot? fare;

  /// The route's name in the reading language, or null for older parcels.
  String? routeName({required bool arabic}) {
    final ar = routeNameAr;
    final en = routeNameEn;
    if (arabic && ar != null) return ar;
    return en ?? ar;
  }

  /// When the sender wants the parcel collected: the preferred time, or the
  /// start of the window older parcels were sent with.
  DateTime? get collectionTime => preferredTime ?? departureFrom;

  factory PassengerParcel.fromJson(
    Map<String, dynamic> json, {
    bool replayed = false,
    String? handoverCode,
  }) {
    String? optionalString(String key) {
      final value = json[key];
      return value is String && value.isNotEmpty ? value : null;
    }

    DateTime? optionalDate(String key) {
      final value = json[key];
      return value is String ? DateTime.tryParse(value)?.toUtc() : null;
    }

    final id = optionalString('id');
    final size = optionalString('size');
    final pickupDetails = optionalString('pickup_details');
    final pickup = optionalString('pickup_label') ?? pickupDetails;
    final created = optionalDate('created_at');
    if (id == null || size == null || pickup == null || created == null) {
      throw const FormatException('Invalid parcel');
    }
    return PassengerParcel(
      id: id,
      state: ParcelTrackingState.parse(json['tracking_state']),
      size: size,
      pickupLabel: pickup,
      dropoffLabel: optionalString('dropoff_label'),
      receiverName: optionalString('receiver_name'),
      receiverPhoneMasked: optionalString('receiver_phone_masked'),
      receiverDetailsRemoved: json['receiver_details_removed'] == true,
      note: optionalString('note'),
      canCancel: json['can_cancel'] == true,
      createdAt: created,
      departureFrom: optionalDate('requested_departure_from'),
      departureUntil: optionalDate('requested_departure_until'),
      replayed: replayed,
      handoverCode: handoverCode,
      serviceRouteId: optionalString('service_route_id'),
      routeNameAr: optionalString('route_name_ar'),
      routeNameEn: optionalString('route_name_en'),
      pickupDetails: pickupDetails,
      dropoffDetails: optionalString('dropoff_details'),
      preferredTime: optionalDate('preferred_time'),
      fare: FareSnapshot.tryParse(json['fare']),
    );
  }
}
