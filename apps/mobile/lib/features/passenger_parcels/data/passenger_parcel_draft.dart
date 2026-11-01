import '../../operating_routes/data/operating_route_models.dart';
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

/// Everything the sender enters, validated the same way the API validates it:
/// a predefined route, where the driver collects the parcel and where it goes
/// (free text), the size and the receiver.
class PassengerParcelDraft {
  const PassengerParcelDraft({
    this.serviceRouteId,
    this.pickupDetails = '',
    this.dropoffDetails = '',
    this.size = 'S',
    this.receiverName = '',
    this.receiverPhone = '',
    this.note = '',
    this.acknowledged = false,
  });

  final String? serviceRouteId;
  final String pickupDetails;
  final String dropoffDetails;
  final String size;
  final String receiverName;
  final String receiverPhone;
  final String note;
  final bool acknowledged;

  ParcelFormIssue? get firstIssue {
    if (serviceRouteId == null) return ParcelFormIssue.route;
    if (!_detailsValid(pickupDetails)) return ParcelFormIssue.pickup;
    if (!_detailsValid(dropoffDetails)) return ParcelFormIssue.dropoff;
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

  PassengerParcelDraft copyWith({
    String? serviceRouteId,
    String? pickupDetails,
    String? dropoffDetails,
    String? size,
    String? receiverName,
    String? receiverPhone,
    String? note,
    bool? acknowledged,
  }) => PassengerParcelDraft(
    serviceRouteId: serviceRouteId ?? this.serviceRouteId,
    pickupDetails: pickupDetails ?? this.pickupDetails,
    dropoffDetails: dropoffDetails ?? this.dropoffDetails,
    size: size ?? this.size,
    receiverName: receiverName ?? this.receiverName,
    receiverPhone: receiverPhone ?? this.receiverPhone,
    note: note ?? this.note,
    acknowledged: acknowledged ?? this.acknowledged,
  );

  /// The same entries with no route chosen (the chosen one was turned off).
  PassengerParcelDraft withoutRoute() => PassengerParcelDraft(
    pickupDetails: pickupDetails,
    dropoffDetails: dropoffDetails,
    size: size,
    receiverName: receiverName,
    receiverPhone: receiverPhone,
    note: note,
    acknowledged: acknowledged,
  );

  /// The body of `POST /passenger/parcels`.
  Map<String, dynamic> toPayload({required DateTime preferredTime}) {
    final trimmedNote = note.trim();
    return {
      'service_route_id': serviceRouteId,
      'pickup_details': pickupDetails.trim(),
      'dropoff_details': dropoffDetails.trim(),
      'preferred_time': preferredTime.toUtc().toIso8601String(),
      'size': size,
      'receiver_name': receiverName.trim(),
      'receiver_phone': receiverPhone.trim(),
      'forbidden_items_acknowledged': true,
      if (trimmedNote.isNotEmpty) 'note': trimmedNote,
    };
  }

  /// The draft a pending (unconfirmed) create was built from.
  factory PassengerParcelDraft.fromPayload(Map<String, dynamic> payload) =>
      PassengerParcelDraft(
        serviceRouteId: payload['service_route_id'] as String?,
        pickupDetails: payload['pickup_details'] as String? ?? '',
        dropoffDetails: payload['dropoff_details'] as String? ?? '',
        size: payload['size'] as String? ?? 'S',
        receiverName: payload['receiver_name'] as String? ?? '',
        receiverPhone: payload['receiver_phone'] as String? ?? '',
        note: payload['note'] as String? ?? '',
        acknowledged: payload['forbidden_items_acknowledged'] == true,
      );
}

bool _detailsValid(String value) {
  final length = value.trim().length;
  return length >= 3 && length <= routeDetailsMaxLength;
}

/// A light client-side check; the server normalises and has the final say.
bool looksLikePhone(String value) {
  final cleaned = value.trim();
  if (!RegExp(r'^\+?[0-9()\- ]+$').hasMatch(cleaned)) return false;
  final digits = cleaned.replaceAll(RegExp(r'[^0-9]'), '');
  return digits.length >= 8 && digits.length <= 15;
}
