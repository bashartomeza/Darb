import 'passenger_parcel_models.dart';

/// The first thing wrong with a parcel form, or null when it can be sent.
enum ParcelFormIssue {
  route,
  pickup,
  dropoff,
  size,
  receiverName,
  receiverPhone,
  note,
  acknowledgement,
}

/// Everything the sender enters, validated the same way the API validates it.
class PassengerParcelDraft {
  const PassengerParcelDraft({
    this.routeVersionId,
    this.pickupStopId,
    this.dropoffStopId,
    this.size = 'S',
    this.receiverName = '',
    this.receiverPhone = '',
    this.note = '',
    this.acknowledged = false,
  });

  final String? routeVersionId;
  final String? pickupStopId;
  final String? dropoffStopId;
  final String size;
  final String receiverName;
  final String receiverPhone;
  final String note;
  final bool acknowledged;

  ParcelFormIssue? get firstIssue {
    if (routeVersionId == null) return ParcelFormIssue.route;
    if (pickupStopId == null) return ParcelFormIssue.pickup;
    if (dropoffStopId == null) return ParcelFormIssue.dropoff;
    if (!PassengerParcelLimits.sizes.contains(size)) {
      return ParcelFormIssue.size;
    }
    final name = receiverName.trim();
    if (name.length < 2 ||
        name.length > PassengerParcelLimits.receiverNameMaxLength) {
      return ParcelFormIssue.receiverName;
    }
    if (!looksLikePhone(receiverPhone)) return ParcelFormIssue.receiverPhone;
    if (note.trim().length > PassengerParcelLimits.noteMaxLength) {
      return ParcelFormIssue.note;
    }
    if (!acknowledged) return ParcelFormIssue.acknowledgement;
    return null;
  }

  bool get isValid => firstIssue == null;

  Map<String, dynamic> toPayload({
    required DateTime departureFrom,
    required DateTime departureUntil,
  }) {
    final trimmedNote = note.trim();
    return {
      'route_version_id': routeVersionId,
      'pickup_stop_id': pickupStopId,
      'dropoff_stop_id': dropoffStopId,
      'requested_departure_from': departureFrom.toUtc().toIso8601String(),
      'requested_departure_until': departureUntil.toUtc().toIso8601String(),
      'size': size,
      'receiver_name': receiverName.trim(),
      'receiver_phone': receiverPhone.trim(),
      if (trimmedNote.isNotEmpty) 'note': trimmedNote,
      'forbidden_items_acknowledged': true,
    };
  }
}

/// A light client-side check; the server normalises and has the final say.
bool looksLikePhone(String value) {
  final cleaned = value.trim();
  if (!RegExp(r'^\+?[0-9()\- ]+$').hasMatch(cleaned)) return false;
  final digits = cleaned.replaceAll(RegExp(r'[^0-9]'), '');
  return digits.length >= 8 && digits.length <= 15;
}
