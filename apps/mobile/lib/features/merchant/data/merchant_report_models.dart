/// The merchant's own order and delivery counts, as computed by the server.
class MerchantReportSummary {
  const MerchantReportSummary({
    required this.ordersTotal,
    required this.ordersByStatus,
    required this.parcels,
    required this.tripsTotal,
    required this.tripsByStatus,
  });

  factory MerchantReportSummary.fromJson(Map<String, dynamic> json) {
    final orders = json['orders'] as Map<String, dynamic>;
    final trips = json['trips'] as Map<String, dynamic>;
    return MerchantReportSummary(
      ordersTotal: (orders['total'] as num).toInt(),
      ordersByStatus: _counts(orders['by_status']),
      parcels: (orders['parcels'] as num).toInt(),
      tripsTotal: (trips['total'] as num).toInt(),
      tripsByStatus: _counts(trips['by_status']),
    );
  }

  final int ordersTotal;
  final Map<String, int> ordersByStatus;
  final int parcels;
  final int tripsTotal;
  final Map<String, int> tripsByStatus;

  static Map<String, int> _counts(Object? value) {
    if (value is! Map) return const {};
    return {
      for (final entry in value.entries)
        entry.key as String: (entry.value as num).toInt(),
    };
  }
}
