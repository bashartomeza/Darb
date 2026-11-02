import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_controller.dart';
import '../data/merchant_report_models.dart';
import '../data/merchant_repository.dart';

/// The merchant's report summary.
///
/// Watches the signed-in user so a different account never sees a previous
/// merchant's figures, and is auto-disposed so it re-reads when the tab reopens.
final merchantReportSummaryProvider =
    FutureProvider.autoDispose<MerchantReportSummary>((ref) {
      ref.watch(authControllerProvider.select((auth) => auth.value?.user?.id));
      return ref.read(merchantRepositoryProvider).reportSummary();
    });
