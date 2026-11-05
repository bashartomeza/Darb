import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/cancellation/cancellation.dart';
import '../../auth/data/authenticated_api_client.dart';
import 'passenger_parcel_models.dart';

final passengerParcelRepositoryProvider = Provider<PassengerParcelRepository>((
  ref,
) {
  return PassengerParcelRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class PassengerParcelRepository {
  const PassengerParcelRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<List<PassengerParcel>> list() async {
    final json = await apiClient.getJson('/passenger/parcels');
    final raw = json['parcels'];
    if (raw is! List) throw const FormatException('Invalid parcels');
    return raw
        .map((value) => PassengerParcel.fromJson(_map(value)))
        .toList(growable: false);
  }

  Future<PassengerParcel> create({
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async {
    final json = await apiClient.postJson(
      '/passenger/parcels',
      body: payload,
      headers: {'Idempotency-Key': idempotencyKey},
    );
    final code = json['handover_code'];
    return PassengerParcel.fromJson(
      _map(json['parcel']),
      replayed: json['replayed'] == true,
      // Returned once, on the first create; a replay comes back without it.
      handoverCode: code is String && code.isNotEmpty ? code : null,
    );
  }

  Future<PassengerParcel> cancel(String id, CancelChoice choice) async {
    final json = await apiClient.patchJson(
      '/passenger/parcels/${Uri.encodeComponent(id)}/cancel',
      body: choice.toBody(),
    );
    return PassengerParcel.fromJson(_map(json['parcel']));
  }
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  throw const FormatException('Expected object');
}
