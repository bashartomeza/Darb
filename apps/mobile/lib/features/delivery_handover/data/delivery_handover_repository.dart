import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import 'delivery_handover_models.dart';

final deliveryHandoverRepositoryProvider = Provider<DeliveryHandoverRepository>(
  (ref) => DeliveryHandoverRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  ),
);

class DeliveryHandoverRepository {
  const DeliveryHandoverRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  /// Sender: the state of the order's handover code (never the code itself).
  Future<HandoverStatus> status(String orderId) async {
    final json = await apiClient.getJson('/parcel-orders/$orderId/handover');
    return HandoverStatus.fromJson(json['handover'] as Map<String, dynamic>);
  }

  /// Sender: issues a code, or replaces the current one. The code comes back once.
  Future<HandoverStatus> regenerate(String orderId) async {
    final json = await apiClient.postJson(
      '/parcel-orders/$orderId/handover/regenerate',
      body: const {},
    );
    final status = HandoverStatus.fromJson(
      json['handover'] as Map<String, dynamic>,
    );
    HandoverCodeVault.remember(orderId, status.code);
    return status;
  }

  /// Driver: confirms the listed orders with the codes the receivers read out.
  Future<void> confirmWithCodes(
    String tripId,
    Map<String, String> codesByOrderId,
  ) async {
    await apiClient.postJson(
      '/trips/$tripId/delivery-confirmation',
      body: {
        'method': 'receiver_code',
        'codes': [
          for (final entry in codesByOrderId.entries)
            {'order_id': entry.key, 'code': entry.value},
        ],
      },
    );
  }

  /// Driver: closes the delivery without the receiver, with a reason that is audited.
  Future<void> confirmReceiverUnavailable(
    String tripId,
    String reason, {
    List<String>? orderIds,
  }) async {
    await apiClient.postJson(
      '/trips/$tripId/delivery-confirmation',
      body: {
        'method': 'receiver_unavailable',
        'reason': reason,
        'order_ids': ?orderIds,
      },
    );
  }
}
