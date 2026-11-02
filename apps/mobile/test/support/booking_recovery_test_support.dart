import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:darb_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:darb_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';

class MemoryBookingStorage extends CanonicalOperationStorage {
  MemoryBookingStorage() : super(const FlutterSecureStorage());
  CanonicalOperationBundle? bundle;
  Object? saveFailure;
  @override
  Future<CanonicalOperationBundle?> read() async => bundle;
  @override
  Future<void> save(CanonicalOperationBundle value) async {
    if (saveFailure != null) throw saveFailure!;
    bundle = value;
  }

  @override
  Future<void> clear() async {
    bundle = null;
  }
}

LegacyPassengerRequestMutation testBookingMutation({
  MemoryBookingStorage? storage,
  String? Function()? actor,
}) {
  final pending = storage ?? MemoryBookingStorage();
  return LegacyPassengerRequestMutation(
    storage: pending,
    currentActor: actor ?? () => 'test-passenger',
  );
}
