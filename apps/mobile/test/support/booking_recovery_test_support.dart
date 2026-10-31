import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:masari_mobile/features/canonical_routes/data/canonical_operation_storage.dart';
import 'package:masari_mobile/features/passenger/application/legacy_passenger_request_mutation.dart';
import 'package:masari_mobile/features/passenger/data/passenger_request_selection_storage.dart';

class MemoryRequestSelectionStorage extends PassengerRequestSelectionStorage {
  MemoryRequestSelectionStorage() : super(const FlutterSecureStorage());
  final values = <(String, String), String>{};
  Object? readFailure;
  Object? saveFailure;
  Future<void> Function()? beforeRead;
  Future<void> Function()? beforeSave;
  @override
  Future<String?> read(String actorId, String requestId) async {
    await beforeRead?.call();
    if (readFailure != null) throw readFailure!;
    return values[(actorId, requestId)];
  }

  @override
  Future<void> save(String actorId, String requestId, String routeId) async {
    await beforeSave?.call();
    if (saveFailure != null) throw saveFailure!;
    values[(actorId, requestId)] = routeId;
  }
}

class MemoryBookingStorage extends CanonicalOperationStorage {
  MemoryBookingStorage() : super(const FlutterSecureStorage());
  CanonicalOperationBundle? bundle;
  Object? saveFailure;
  final selections = MemoryRequestSelectionStorage();
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
    selectionStorage: pending.selections,
  );
}
