import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_controller.dart';
import '../../auth/domain/auth_models.dart';
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

  Future<void>? _refreshing;

  /// Quiet re-read for auto-refresh: keeps the current list on a failure.
  /// Several screens poll it; overlapping calls share one request.
  Future<void> refresh() => _refreshing ??= _reread().whenComplete(() {
    _refreshing = null;
  });

  Future<void> _reread() async {
    try {
      final next = await ref.read(communityReportRepositoryProvider).list();
      if (ref.mounted) state = AsyncData(next);
    } catch (error, stack) {
      if (ref.mounted && !state.hasValue) state = AsyncError(error, stack);
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

/// Whether this session may read community reports (passengers and drivers).
///
/// Map layers only look at an already running session: they never start the
/// sign-in machinery themselves.
bool _readsReports(WidgetRef ref) {
  if (!ref.exists(authControllerProvider)) return false;
  final role = ref.watch(
    authControllerProvider.select((auth) => auth.value?.user?.role),
  );
  return role == UserRole.passenger || role == UserRole.driver;
}

/// The located community reports a map should draw for this session.
List<CommunityReport> watchCommunityReportsForMap(WidgetRef ref) =>
    _readsReports(ref)
    ? ref.watch(communityReportsProvider).value ?? const <CommunityReport>[]
    : const <CommunityReport>[];

/// Background poll of the reports map layer for screens that poll their own
/// data. Never throws and never delays the caller's own refresh.
void pollCommunityReports(WidgetRef ref) {
  if (!ref.exists(authControllerProvider)) return;
  final role = ref.read(authControllerProvider).value?.user?.role;
  if (role != UserRole.passenger && role != UserRole.driver) return;
  try {
    unawaited(
      ref.read(communityReportsProvider.notifier).refresh().catchError((_) {}),
    );
  } catch (_) {
    // The reports layer is optional; the screen's own data comes first.
  }
}
