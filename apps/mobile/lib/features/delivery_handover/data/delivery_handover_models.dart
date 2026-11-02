/// How a parcel order is handed to its receiver. The sender holds a six-digit
/// code and gives it to the receiver; the driver enters what the receiver reads
/// out. These models carry state only, never the stored digest.
class HandoverStatus {
  const HandoverStatus({
    required this.issued,
    required this.confirmed,
    required this.locked,
    required this.expired,
    required this.attemptsRemaining,
    this.expiresAt,
    this.confirmedAt,
    this.method,
    this.unavailableReason,
    this.code,
  });

  final bool issued;
  final bool confirmed;
  final bool locked;
  final bool expired;
  final int attemptsRemaining;
  final DateTime? expiresAt;
  final DateTime? confirmedAt;

  /// receiver_code, receiver_unavailable or admin_override once confirmed.
  final String? method;
  final String? unavailableReason;

  /// Present only in the response that issued it; the server cannot show it again.
  final String? code;

  bool get needsNewCode => !confirmed && (!issued || locked || expired);

  HandoverStatus withCode(String? value) => HandoverStatus(
    issued: issued,
    confirmed: confirmed,
    locked: locked,
    expired: expired,
    attemptsRemaining: attemptsRemaining,
    expiresAt: expiresAt,
    confirmedAt: confirmedAt,
    method: method,
    unavailableReason: unavailableReason,
    code: value,
  );

  factory HandoverStatus.fromJson(Map<String, dynamic> json) => HandoverStatus(
    issued: json['issued'] == true,
    confirmed: json['confirmed'] == true,
    locked: json['locked'] == true,
    expired: json['expired'] == true,
    attemptsRemaining: json['attempts_remaining'] is num
        ? (json['attempts_remaining'] as num).toInt()
        : 0,
    expiresAt: _date(json['expires_at']),
    confirmedAt: _date(json['confirmed_at']),
    method: json['confirmation_method'] as String?,
    unavailableReason: json['unavailable_reason'] as String?,
    code: json['code'] is String ? json['code'] as String : null,
  );
}

/// One parcel order on a trip and whether its receiver has confirmed.
class OrderDeliveryConfirmation {
  const OrderDeliveryConfirmation({
    required this.orderId,
    required this.status,
  });

  final String orderId;
  final HandoverStatus status;
}

class TripDeliveryConfirmation {
  const TripDeliveryConfirmation({
    required this.required,
    required this.allConfirmed,
    required this.orders,
  });

  final bool required;
  final bool allConfirmed;
  final List<OrderDeliveryConfirmation> orders;

  /// The driver must collect a receiver confirmation before the trip can be delivered.
  bool get needsReceiverConfirmation => required && !allConfirmed;

  List<OrderDeliveryConfirmation> get pending =>
      orders.where((order) => !order.status.confirmed).toList();

  factory TripDeliveryConfirmation.fromJson(Map<String, dynamic> json) {
    final orders = json['orders'];
    return TripDeliveryConfirmation(
      required: json['required'] == true,
      allConfirmed: json['all_confirmed'] == true,
      orders: orders is List
          ? orders
                .whereType<Map<String, dynamic>>()
                .map(
                  (order) => OrderDeliveryConfirmation(
                    orderId: order['order_id'] as String,
                    status: HandoverStatus.fromJson(order),
                  ),
                )
                .toList()
          : const [],
    );
  }
}

/// Keeps a freshly issued code in memory for the rest of the session so the
/// sender can read it again after leaving the order-created screen. It is never
/// written to disk; a lost code is replaced from the order screen.
class HandoverCodeVault {
  HandoverCodeVault._();

  static final Map<String, String> _codes = {};

  static void remember(String orderId, String? code) {
    if (code != null && code.isNotEmpty) _codes[orderId] = code;
  }

  static String? recall(String orderId) => _codes[orderId];

  static void forget(String orderId) => _codes.remove(orderId);

  static void clear() => _codes.clear();
}

DateTime? _date(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;
