import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_controller.dart';
import '../data/community_report_models.dart';
import '../data/community_report_repository.dart';

final communityReportsProvider =
    AsyncNotifierProvider<CommunityReportsNotifier, List<CommunityReport>>(
      CommunityReportsNotifier.new,
    );

class CommunityReportsNotifier extends AsyncNotifier<List<CommunityReport>> {
  @override
  Future<List<CommunityReport>> build() {
    // A different signed-in user must never see the previous user's votes.
    ref.watch(authControllerProvider.select((a) => a.value?.user?.id));
    return ref.read(communityReportRepositoryProvider).list();
  }

  /// Quiet re-read for auto-refresh: keeps the current list on a failure.
  Future<void> refresh() async {
    try {
      final next = await ref.read(communityReportRepositoryProvider).list();
      state = AsyncData(next);
    } catch (error, stack) {
      if (!state.hasValue) state = AsyncError(error, stack);
    }
  }

  Future<void> submit({
    required CommunityReportCategory category,
    required String description,
    required String locationName,
    double? latitude,
    double? longitude,
  }) async {
    final created = await ref
        .read(communityReportRepositoryProvider)
        .create(
          category: category,
          description: description,
          locationName: locationName,
          latitude: latitude,
          longitude: longitude,
        );
    state = AsyncData([created, ...?state.value]);
  }

  /// Tapping the active vote withdraws it; tapping the other one changes it.
  /// Shown at once and rolled back if the server refuses.
  Future<void> vote(CommunityReport report, int tapped) async {
    final next = report.myVote == tapped ? 0 : tapped;
    _replace(report.id, (r) => r.withVote(next));
    try {
      final confirmed = await ref
          .read(communityReportRepositoryProvider)
          .vote(report.id, next);
      _replace(report.id, (_) => confirmed);
    } catch (_) {
      _replace(report.id, (_) => report);
      rethrow;
    }
  }

  Future<void> flag(CommunityReport report) =>
      ref.read(communityReportRepositoryProvider).flag(report.id);

  void _replace(String id, CommunityReport Function(CommunityReport) change) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData([for (final r in current) r.id == id ? change(r) : r]);
  }
}
