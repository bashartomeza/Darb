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
/// a predefined route, the village or town where the driver collects the
/// parcel (of the route's origin city) and where it goes (of its destination
/// city), optional extra details for each, the size and the receiver.
class PassengerParcelDraft {
  const PassengerParcelDraft({
    this.serviceRouteId,
    this.pickupPlaceId,
    this.dropoffPlaceId,
    this.pickupDetails = '',
    this.dropoffDetails = '',
    this.size = 'S',
    this.receiverName = '',
    this.receiverPhone = '',
    this.note = '',
    this.acknowledged = false,
    this.restoredFreeText = false,
  });

  final String? serviceRouteId;
  final String? pickupPlaceId;
  final String? dropoffPlaceId;

  /// Optional extra text for each end; a form from an older build, restored
  /// from a pending create, may carry it instead of a place.
  final String pickupDetails;
  final String dropoffDetails;
  final String size;
  final String receiverName;
  final String receiverPhone;
  final String note;
  final bool acknowledged;

  /// True for a form restored from a create an older build left pending: it
  /// names its ends by text only, and is replayed exactly as it was sent.
  /// Every new form needs a chosen place at each end.
  final bool restoredFreeText;

  ParcelFormIssue? get firstIssue {
    if (serviceRouteId == null) return ParcelFormIssue.route;
    if (!_endValid(pickupPlaceId, pickupDetails, restoredFreeText)) {
      return ParcelFormIssue.pickup;
    }
    if (!_endValid(dropoffPlaceId, dropoffDetails, restoredFreeText)) {
      return ParcelFormIssue.dropoff;
    }
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

  /// The same entries on [routeId]. Places belong to a route's cities, so
  /// they are cleared when the route changes.
  PassengerParcelDraft withRoute(String routeId) => routeId == serviceRouteId
      ? this
      : PassengerParcelDraft(
          serviceRouteId: routeId,
          pickupDetails: pickupDetails,
          dropoffDetails: dropoffDetails,
          size: size,
          receiverName: receiverName,
          receiverPhone: receiverPhone,
          note: note,
          acknowledged: acknowledged,
          restoredFreeText: restoredFreeText,
        );

  PassengerParcelDraft copyWith({
    String? serviceRouteId,
    String? pickupPlaceId,
    String? dropoffPlaceId,
    String? pickupDetails,
    String? dropoffDetails,
    String? size,
    String? receiverName,
    String? receiverPhone,
    String? note,
    bool? acknowledged,
  }) => PassengerParcelDraft(
    serviceRouteId: serviceRouteId ?? this.serviceRouteId,
    pickupPlaceId: pickupPlaceId ?? this.pickupPlaceId,
    dropoffPlaceId: dropoffPlaceId ?? this.dropoffPlaceId,
    pickupDetails: pickupDetails ?? this.pickupDetails,
    dropoffDetails: dropoffDetails ?? this.dropoffDetails,
    size: size ?? this.size,
    receiverName: receiverName ?? this.receiverName,
    receiverPhone: receiverPhone ?? this.receiverPhone,
    note: note ?? this.note,
    acknowledged: acknowledged ?? this.acknowledged,
    restoredFreeText: restoredFreeText,
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
      'pickup_place_id': ?pickupPlaceId,
      'dropoff_place_id': ?dropoffPlaceId,
      if (pickupDetails.trim().isNotEmpty)
        'pickup_details': pickupDetails.trim(),
      if (dropoffDetails.trim().isNotEmpty)
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
        pickupPlaceId: payload['pickup_place_id'] as String?,
        dropoffPlaceId: payload['dropoff_place_id'] as String?,
        pickupDetails: payload['pickup_details'] as String? ?? '',
        dropoffDetails: payload['dropoff_details'] as String? ?? '',
        size: payload['size'] as String? ?? 'S',
        receiverName: payload['receiver_name'] as String? ?? '',
        receiverPhone: payload['receiver_phone'] as String? ?? '',
        note: payload['note'] as String? ?? '',
        acknowledged: payload['forbidden_items_acknowledged'] == true,
        restoredFreeText:
            payload['pickup_place_id'] == null &&
            payload['dropoff_place_id'] == null,
      );
}

/// One end is valid with a chosen place (details optional, at most 300
/// characters) or, for a form restored from an older build, with text of 3 to
/// 300 characters.
bool _endValid(String? placeId, String details, bool restoredFreeText) {
  final length = details.trim().length;
  if (length > routeDetailsMaxLength) return false;
  return placeId != null || (restoredFreeText && length >= 3);
}

/// A light client-side check; the server normalises and has the final say.
bool looksLikePhone(String value) {
  final cleaned = value.trim();
  if (!RegExp(r'^\+?[0-9()\- ]+$').hasMatch(cleaned)) return false;
  final digits = cleaned.replaceAll(RegExp(r'[^0-9]'), '');
  return digits.length >= 8 && digits.length <= 15;
}
