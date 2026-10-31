import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import '../../trips/data/trip_models.dart';
import 'merchant_bulk_models.dart';
import 'merchant_models.dart';
import 'merchant_report_models.dart';

final merchantRepositoryProvider = Provider<MerchantRepository>((ref) {
  return MerchantRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class MerchantRepository {
  const MerchantRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<List<MerchantOrder>> listOrders() async {
    final json = await apiClient.getJson('/merchant/orders');
    return _list<MerchantOrder>(json, 'orders', MerchantOrder.fromJson);
  }

  Future<MerchantReportSummary> reportSummary() async {
    final json = await apiClient.getJson('/merchant/reports/summary');
    return MerchantReportSummary.fromJson(json);
  }

  Future<MerchantOrder> orderDetail(String id) async {
    final json = await apiClient.getJson('/merchant/orders/$id');
    return MerchantOrder.fromJson(json['order'] as Map<String, dynamic>);
  }

  static Map<String, dynamic> createOrderBody(List<ParcelDraft> parcels) => {
    'pickup_label': merchantPickupLabel,
    'pickup_lat': merchantPickupLat,
    'pickup_lng': merchantPickupLng,
    'parcels': parcels.map((parcel) => parcel.toJson()).toList(),
  };

  Future<MerchantOrder> createOrder(
    List<ParcelDraft> parcels, {
    String? idempotencyKey,
  }) => createOrderPayload(
    createOrderBody(parcels),
    idempotencyKey: idempotencyKey,
  );

  Future<MerchantOrder> createOrderPayload(
    Map<String, dynamic> payload, {
    String? idempotencyKey,
    void Function()? beforeSend,
  }) async {
    final json = await apiClient.postJson(
      '/merchant/orders',
      body: payload,
      beforeSend: beforeSend,
      headers: idempotencyKey == null
          ? const {}
          : {'idempotency-key': idempotencyKey},
    );
    return MerchantOrder.fromJson({
      ...(json['order'] as Map<String, dynamic>),
      'parcel_batches':
          (json['order'] as Map<String, dynamic>)['parcel_batches'] ?? const [],
    });
  }

  Future<MerchantOrder> recoverOrder(
    String key, {
    void Function()? beforeSend,
  }) async {
    final json = await apiClient.getJson(
      '/merchant/order-operation',
      headers: {'idempotency-key': key},
      beforeSend: beforeSend,
    );
    return MerchantOrder.fromJson(json['order'] as Map<String, dynamic>);
  }

  /// Validates a pasted CSV and previews how the orders would be grouped.
  /// Writes nothing on the server.
  Future<BulkPreview> previewBulkOrders(String csv) async {
    final json = await apiClient.postJson(
      '/merchant/orders/bulk/preview',
      body: {'csv': csv},
    );
    return BulkPreview.fromJson(json);
  }

  /// Creates the previewed orders. The same [idempotencyKey] must be reused on
  /// every retry of one upload so no order is created twice.
  Future<BulkSubmitResult> submitBulkOrders(
    String csv, {
    required String idempotencyKey,
    bool skipInvalid = false,
  }) async {
    final json = await apiClient.postJson(
      '/merchant/orders/bulk',
      body: {'csv': csv, 'skip_invalid': skipInvalid},
      headers: {'idempotency-key': idempotencyKey},
    );
    return BulkSubmitResult.fromJson(json);
  }

  Future<MerchantBatch> createBatch(String orderId) async {
    final json = await apiClient.postJson(
      '/merchant/orders/$orderId/batch',
      body: const {},
    );
    return MerchantBatch.fromJson(json['batch'] as Map<String, dynamic>);
  }

  Future<MerchantOrder> cancelOrder(String orderId) async {
    final json = await apiClient.patchJson('/merchant/orders/$orderId/cancel');
    return MerchantOrder.fromJson(json['order'] as Map<String, dynamic>);
  }

  Future<MerchantMatch> runMatch(String orderId) async {
    final json = await apiClient.postJson(
      '/matches/run',
      body: {'merchantOrderId': orderId},
    );
    final match = json['match'] as Map<String, dynamic>;
    return MerchantMatch.fromJson({
      ...match,
      'scoring_breakdown':
          json['scoringBreakdown'] ?? match['scoring_breakdown'],
    });
  }

  Future<List<MerchantMatch>> listMatches({String? status}) async {
    final suffix = status == null
        ? ''
        : '?status=${Uri.encodeQueryComponent(status)}';
    final json = await apiClient.getJson('/matches$suffix');
    return _list<MerchantMatch>(json, 'matches', MerchantMatch.fromJson);
  }

  Future<MerchantMatch> matchDetail(String id) async {
    final json = await apiClient.getJson('/matches/$id');
    return MerchantMatch.fromJson(json['match'] as Map<String, dynamic>);
  }

  Future<List<MerchantTrip>> listTrips() async {
    final json = await apiClient.getJson('/trips');
    return _list<MerchantTrip>(json, 'trips', MerchantTrip.fromJson);
  }

  Future<MerchantTrip> tripDetail(String id) async {
    final json = await apiClient.getJson('/trips/$id');
    return MerchantTrip.fromJson(json['trip'] as Map<String, dynamic>);
  }

  Future<TripLocation?> latestLocation(String id) async {
    final json = await apiClient.getJson('/trips/$id/location');
    final location = json['location'];
    return location is Map<String, dynamic>
        ? TripLocation.fromJson(location)
        : null;
  }

  List<T> _list<T>(
    Map<String, dynamic> json,
    String key,
    T Function(Map<String, dynamic>) parse,
  ) {
    final values = json[key];
    if (values is! List) throw FormatException('Missing $key');
    return values.cast<Map<String, dynamic>>().map(parse).toList();
  }
}
