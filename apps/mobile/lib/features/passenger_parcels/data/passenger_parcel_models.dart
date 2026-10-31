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

  factory PassengerParcel.fromJson(
    Map<String, dynamic> json, {
    bool replayed = false,
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
    final pickup = optionalString('pickup_label');
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
    );
  }
}
