import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_actor_binding.dart';
import '../../../core/api/api_error.dart';
import '../data/driver_renewal_repository.dart';

/// The signed-in driver's renewal state, or null when there is nothing to
/// renew (no verification, uploads switched off, or the driver is approved).
///
/// Failures that are not a clear "nothing to do" answer rethrow so the screen
/// can offer a retry; the home banner simply ignores errors.
final driverRenewalProvider = FutureProvider.autoDispose<DriverRenewalState?>((
  ref,
) async {
  final binding = ref.watch(authenticatedActorBindingProvider);
  final actorId = binding.actorId;
  if (actorId == null) return null;
  try {
    final state = await ref.watch(driverRenewalRepositoryProvider).state();
    if (binding.actorId != actorId) return null;
    return state;
  } on ApiException catch (error) {
    if (error.statusCode == 404 || error.statusCode == 409) return null;
    if (binding.actorId != actorId) return null;
    rethrow;
  }
});

/// Whether the home screen should point the driver at the renewal screen.
final driverRenewalNeededProvider = Provider.autoDispose<DriverRenewalState?>((
  ref,
) {
  final state = ref.watch(driverRenewalProvider).value;
  return state != null && state.needsAttention ? state : null;
});
