import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/core/widgets/darb_section.dart';
import 'package:darb_mobile/core/widgets/status_chip.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/language_switch.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../application/passenger_history_controller.dart';
import '../data/passenger_models.dart';
import 'passenger_home_screen.dart' show passengerStatusLabel;
import 'passenger_request_labels.dart';
import 'settings/passenger_settings_screen.dart'
    show showPassengerLanguagePicker;

/// Passenger "My Trips" screen.
///
/// Glassmorphism visual redesign.
/// Logic, providers, navigation and filtering remain unchanged.
class PassengerTripsScreen extends ConsumerStatefulWidget {
  const PassengerTripsScreen({super.key});

  @override
  ConsumerState<PassengerTripsScreen> createState() =>
      _PassengerTripsScreenState();
}

class _PassengerTripsScreenState extends ConsumerState<PassengerTripsScreen> {
  _TripFilter _selectedFilter = _TripFilter.all;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final history = ref.watch(passengerHistoryProvider);
    final capabilities = ref.watch(mobileCapabilitiesProvider).value;

    final canonicalStatus =
        capabilities?.canonicalAssignmentStatusAvailable == true;

    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: scheme.surface,
      body: SafeArea(
        child: Stack(
          children: [
            const _GlassBackground(),

            RefreshIndicator(
              color: scheme.primary,
              backgroundColor: scheme.surface.withValues(alpha: 0.92),
              onRefresh: () =>
                  ref.read(passengerHistoryProvider.notifier).refresh(),
              child: history.when(
                loading: () => ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: _pagePadding,
                  children: const [
                    _HeaderSkeleton(),
                    SizedBox(height: AppTokens.spaceMedium),
                    _StatsSkeleton(),
                    SizedBox(height: AppTokens.spaceMedium),
                    _TripSkeleton(),
                  ],
                ),

                error: (error, _) => ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: _pagePadding,
                  children: [
                    _TopHeader(
                      onLanguageTap: () => _showLanguagePicker(context),
                    ),
                    const SizedBox(height: AppTokens.spaceLarge),
                    _GlassCard(
                      padding: const EdgeInsets.all(AppTokens.spaceMedium),
                      child: ErrorStateView(
                        title: l10n.tripHistoryFailed,
                        retryLabel: l10n.retry,
                        onRetry: () => ref
                            .read(passengerHistoryProvider.notifier)
                            .refresh(),
                      ),
                    ),
                  ],
                ),

                data: (state) {
                  final filteredRequests = _filteredRequests(state);

                  return ListView(
                    key: const ValueKey('passengerTripsList'),
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: _pagePadding,
                    children: [
                      // ------------------------------------------------------
                      // HEADER
                      // ------------------------------------------------------
                      _TopHeader(
                        onLanguageTap: () => _showLanguagePicker(context),
                      ),

                      const SizedBox(height: AppTokens.spaceMedium),

                      // ------------------------------------------------------
                      // STATS
                      // ------------------------------------------------------
                      _TripStats(
                        total:
                            state.active.length +
                            state.upcoming.length +
                            state.past.length +
                            state.cancelled.length,
                        active: state.active.length,
                        upcoming: state.upcoming.length,
                        past: state.past.length,
                        cancelled: state.cancelled.length,
                      ),

                      const SizedBox(height: AppTokens.spaceMedium),

                      // ------------------------------------------------------
                      // FILTERS
                      // ------------------------------------------------------
                      _FilterBar(
                        selectedFilter: _selectedFilter,
                        onChanged: (filter) {
                          setState(() {
                            _selectedFilter = filter;
                          });
                        },
                        activeCount: state.active.length,
                        upcomingCount: state.upcoming.length,
                        pastCount: state.past.length,
                        cancelledCount: state.cancelled.length,
                      ),

                      const SizedBox(height: AppTokens.spaceLarge),

                      // ------------------------------------------------------
                      // EMPTY
                      // ------------------------------------------------------
                      if (state.isEmpty)
                        _ModernEmptyState(
                          title: l10n.noTripsYet,
                          message: l10n.noTripsYetBody,
                          actionLabel: l10n.createRequest,
                          onAction: () => context.go('/passenger/request/new'),
                        )
                      // ------------------------------------------------------
                      // FILTER EMPTY
                      // ------------------------------------------------------
                      else if (filteredRequests.isEmpty)
                        _FilterEmptyState(
                          onReset: () {
                            setState(() {
                              _selectedFilter = _TripFilter.all;
                            });
                          },
                        )
                      // ------------------------------------------------------
                      // TRIPS
                      // ------------------------------------------------------
                      else ...[
                        _TripsTitle(
                          filter: _selectedFilter,
                          count: filteredRequests.length,
                        ),

                        const SizedBox(height: AppTokens.spaceSmall),

                        for (final (index, item)
                            in filteredRequests.indexed) ...[
                          if (index > 0)
                            const SizedBox(height: AppTokens.spaceSmall),

                          _TripCard(
                            key: ValueKey('passengerTrip-${item.request.id}'),
                            request: item.request,
                            tripId: item.tripId,
                            active: item.isActive,
                          ),
                        ],
                      ],

                      // ------------------------------------------------------
                      // CANONICAL ASSIGNMENTS
                      // ------------------------------------------------------
                      if (canonicalStatus) ...[
                        const SizedBox(height: AppTokens.spaceLarge),
                        _CanonicalCard(
                          title: l10n.canonicalAssignments,
                          sectionTitle: l10n.canonicalRoutes,
                          onPressed: () =>
                              context.go('/passenger/canonical-assignments'),
                        ),
                      ],

                      const SizedBox(height: AppTokens.spaceLarge),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // FILTER TRIPS
  // --------------------------------------------------------------------------

  List<_TripItem> _filteredRequests(dynamic state) {
    final List<_TripItem> result = [];

    switch (_selectedFilter) {
      case _TripFilter.all:
        result.addAll(
          state.active.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: true,
            ),
          ),
        );

        result.addAll(
          state.upcoming.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: false,
            ),
          ),
        );

        result.addAll(
          state.past.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: false,
            ),
          ),
        );

        result.addAll(
          state.cancelled.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: false,
            ),
          ),
        );

        break;

      case _TripFilter.active:
        result.addAll(
          state.active.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: true,
            ),
          ),
        );
        break;

      case _TripFilter.upcoming:
        result.addAll(
          state.upcoming.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: false,
            ),
          ),
        );
        break;

      case _TripFilter.past:
        result.addAll(
          state.past.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: false,
            ),
          ),
        );
        break;

      case _TripFilter.cancelled:
        result.addAll(
          state.cancelled.map<_TripItem>(
            (PassengerRequest request) => _TripItem(
              request: request,
              tripId: state.tripForRequest(request.id)?.id,
              isActive: false,
            ),
          ),
        );
        break;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // LANGUAGE PICKER
  // --------------------------------------------------------------------------

  Future<void> _showLanguagePicker(BuildContext context) =>
      showPassengerLanguagePicker(
        context,
        ref,
        Localizations.localeOf(context),
      );

  static const _pagePadding = EdgeInsets.fromLTRB(
    AppTokens.marginMobile,
    AppTokens.spaceSmall,
    AppTokens.marginMobile,
    AppTokens.spaceExtraLarge,
  );
}

// =============================================================================
// GLASS BACKGROUND
// =============================================================================

class _GlassBackground extends StatelessWidget {
  const _GlassBackground();
  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

class _GlassCard extends StatelessWidget {
  const _GlassCard({
    required this.child,
    this.padding = EdgeInsets.zero,
    this.borderRadius = const BorderRadius.all(Radius.circular(24)),
    this.highlighted = false,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final BorderRadius borderRadius;
  final bool highlighted;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    final borderColor = highlighted
        ? scheme.primary.withValues(alpha: 0.32)
        : scheme.onSurface.withValues(alpha: 0.08);

    final decoration = BoxDecoration(
      color: scheme.surface,
      borderRadius: borderRadius,
      border: Border.all(color: borderColor),
    );

    Widget content = Container(
      padding: padding,
      decoration: decoration,
      child: child,
    );

    if (onTap != null) {
      content = Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: borderRadius,
          child: content,
        ),
      );
    }

    return ClipRRect(
      borderRadius: borderRadius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: content,
      ),
    );
  }
}

// =============================================================================
// FILTER ENUM
// =============================================================================

enum _TripFilter { all, active, upcoming, past, cancelled }

// =============================================================================
// TRIP ITEM
// =============================================================================

class _TripItem {
  const _TripItem({
    required this.request,
    required this.tripId,
    required this.isActive,
  });

  final PassengerRequest request;
  final String? tripId;
  final bool isActive;
}

// =============================================================================
// TOP HEADER
// =============================================================================

class _TopHeader extends StatelessWidget {
  const _TopHeader({required this.onLanguageTap});

  final VoidCallback onLanguageTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: scheme.primary.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: scheme.primary.withValues(alpha: 0.12)),
          ),
          child: Icon(Icons.route_rounded, color: scheme.primary, size: 23),
        ),

        const SizedBox(width: 12),

        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                AppLocalizations.of(context).myTrips,
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                  letterSpacing: -0.7,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                AppLocalizations.of(context).myTripsSubtitle,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(width: 8),

        if (!ShellLanguageControl.isProvided(context))
          _GlassIconButton(
            icon: Icons.language_rounded,
            label: Localizations.localeOf(context).languageCode == 'ar'
                ? 'عربي'
                : 'EN',
            onTap: onLanguageTap,
          ),
      ],
    );
  }
}

class _GlassIconButton extends StatelessWidget {
  const _GlassIconButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return ClipRRect(
      borderRadius: BorderRadius.circular(15),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Material(
          color: scheme.surface.withValues(alpha: 0.52),
          child: InkWell(
            onTap: onTap,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(15),
                border: Border.all(
                  color: scheme.onSurface.withValues(alpha: 0.08),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 16, color: scheme.onSurfaceVariant),
                  const SizedBox(width: 5),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w900,
                      color: scheme.onSurface,
                    ),
                  ),
                  const SizedBox(width: 2),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 15,
                    color: scheme.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// STATS
// =============================================================================

class _TripStats extends StatelessWidget {
  const _TripStats({
    required this.total,
    required this.active,
    required this.upcoming,
    required this.past,
    required this.cancelled,
  });

  final int total;
  final int active;
  final int upcoming;
  final int past;
  final int cancelled;

  @override
  Widget build(BuildContext context) {
    return _GlassCard(
      padding: const EdgeInsets.all(7),
      borderRadius: BorderRadius.circular(23),
      child: Row(
        children: [
          Expanded(
            child: _StatItem(
              value: total,
              label: AppLocalizations.of(context).tripsStatTotal,
              icon: Icons.route_rounded,
            ),
          ),
          const _StatDivider(),
          Expanded(
            child: _StatItem(
              value: active,
              label: AppLocalizations.of(context).tripsStatActive,
              icon: Icons.navigation_rounded,
            ),
          ),
          const _StatDivider(),
          Expanded(
            child: _StatItem(
              value: upcoming,
              label: AppLocalizations.of(context).tripsStatUpcoming,
              icon: Icons.schedule_rounded,
            ),
          ),
          const _StatDivider(),
          Expanded(
            child: _StatItem(
              value: past,
              label: AppLocalizations.of(context).tripsStatPast,
              icon: Icons.check_circle_outline_rounded,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({
    required this.value,
    required this.label,
    required this.icon,
  });

  final int value;
  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 1),
      child: Column(
        children: [
          Container(
            width: 31,
            height: 31,
            decoration: BoxDecoration(
              color: scheme.primary.withValues(alpha: 0.09),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 15, color: scheme.primary),
          ),

          const SizedBox(height: 5),

          Text(
            '$value',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w900,
            ),
          ),

          const SizedBox(height: 1),

          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatDivider extends StatelessWidget {
  const _StatDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 45,
      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.07),
    );
  }
}

// =============================================================================
// FILTER BAR
// =============================================================================

class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.selectedFilter,
    required this.onChanged,
    required this.activeCount,
    required this.upcomingCount,
    required this.pastCount,
    required this.cancelledCount,
  });

  final _TripFilter selectedFilter;
  final ValueChanged<_TripFilter> onChanged;
  final int activeCount;
  final int upcomingCount;
  final int pastCount;
  final int cancelledCount;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        children: [
          _FilterChip(
            label: AppLocalizations.of(context).tripsFilterAll,
            count: activeCount + upcomingCount + pastCount + cancelledCount,
            selected: selectedFilter == _TripFilter.all,
            onTap: () => onChanged(_TripFilter.all),
          ),
          const SizedBox(width: 7),
          _FilterChip(
            label: AppLocalizations.of(context).tripsActiveSection,
            count: activeCount,
            selected: selectedFilter == _TripFilter.active,
            onTap: () => onChanged(_TripFilter.active),
          ),
          const SizedBox(width: 7),
          _FilterChip(
            label: AppLocalizations.of(context).tripsUpcomingSection,
            count: upcomingCount,
            selected: selectedFilter == _TripFilter.upcoming,
            onTap: () => onChanged(_TripFilter.upcoming),
          ),
          const SizedBox(width: 7),
          _FilterChip(
            label: AppLocalizations.of(context).tripsPastSection,
            count: pastCount,
            selected: selectedFilter == _TripFilter.past,
            onTap: () => onChanged(_TripFilter.past),
          ),
          const SizedBox(width: 7),
          _FilterChip(
            label: AppLocalizations.of(context).tripsCancelledSection,
            count: cancelledCount,
            selected: selectedFilter == _TripFilter.cancelled,
            onTap: () => onChanged(_TripFilter.cancelled),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: Material(
          color: selected
              ? scheme.primary.withValues(alpha: 0.88)
              : scheme.surface.withValues(alpha: 0.48),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(999),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: selected
                      ? scheme.primary.withValues(alpha: 0.38)
                      : scheme.onSurface.withValues(alpha: 0.07),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: selected ? scheme.onPrimary : scheme.onSurface,
                    ),
                  ),

                  const SizedBox(width: 6),

                  Container(
                    constraints: const BoxConstraints(minWidth: 19),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 5,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: selected
                          ? scheme.onPrimary.withValues(alpha: 0.18)
                          : scheme.onSurface.withValues(alpha: 0.07),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '$count',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        color: selected
                            ? scheme.onPrimary
                            : scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// TRIPS TITLE
// =============================================================================

class _TripsTitle extends StatelessWidget {
  const _TripsTitle({required this.filter, required this.count});

  final _TripFilter filter;
  final int count;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;

    final title = switch (filter) {
      _TripFilter.all => l10n.myTrips,
      _TripFilter.active => l10n.tripsActiveSection,
      _TripFilter.upcoming => l10n.tripsUpcomingSection,
      _TripFilter.past => l10n.tripsPastSection,
      _TripFilter.cancelled => l10n.tripsCancelledSection,
    };

    return Row(
      children: [
        Expanded(
          child: Row(
            children: [
              Container(
                width: 5,
                height: 21,
                decoration: BoxDecoration(
                  color: scheme.primary,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                title,
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
              ),
            ],
          ),
        ),

        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: scheme.surface.withValues(alpha: 0.50),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: scheme.onSurface.withValues(alpha: 0.07)),
          ),
          child: Text(
            '$count',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

// =============================================================================
// TRIP CARD
// =============================================================================

class _TripCard extends StatelessWidget {
  const _TripCard({
    required this.request,
    required this.tripId,
    required this.active,
    super.key,
  });

  final PassengerRequest request;
  final String? tripId;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final material = MaterialLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    final statusColor = _statusColor(context, request.status);

    return _GlassCard(
      highlighted: active,
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      borderRadius: BorderRadius.circular(24),
      onTap: () => _openTrip(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ------------------------------------------------------------------
          // TOP ROW
          // ------------------------------------------------------------------
          Row(
            children: [
              Container(
                width: 43,
                height: 43,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      active
                          ? scheme.primary.withValues(alpha: 0.18)
                          : scheme.surfaceContainerHighest.withValues(
                              alpha: 0.65,
                            ),
                      active
                          ? scheme.primary.withValues(alpha: 0.07)
                          : scheme.surface.withValues(alpha: 0.35),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: active
                        ? scheme.primary.withValues(alpha: 0.15)
                        : scheme.onSurface.withValues(alpha: 0.06),
                  ),
                ),
                child: Icon(
                  active
                      ? Icons.directions_car_filled_rounded
                      : Icons.route_rounded,
                  size: 21,
                  color: active ? scheme.primary : scheme.onSurfaceVariant,
                ),
              ),

              const SizedBox(width: AppTokens.spaceSmall),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      request.routeTitle(context),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                    ),

                    const SizedBox(height: 3),

                    Text(
                      active
                          ? AppLocalizations.of(context).myTripsCurrentTrip
                          : request.pickupText(context),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(width: 8),

              _StatusPill(
                label: passengerStatusLabel(l10n, request.status),
                color: statusColor,
              ),
            ],
          ),

          const SizedBox(height: AppTokens.spaceMedium),

          // ------------------------------------------------------------------
          // ROUTE
          // ------------------------------------------------------------------
          _RoutePreview(
            from: request.pickupText(context),
            to: request.dropoffText(context),
            active: active,
          ),

          const SizedBox(height: AppTokens.spaceMedium),

          // ------------------------------------------------------------------
          // BOTTOM INFORMATION
          // ------------------------------------------------------------------
          Row(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _SmallInfo(
                        icon: Icons.schedule_rounded,
                        text: material.formatCompactDate(request.preferredTime),
                      ),
                      const SizedBox(width: 7),
                      _SmallInfo(
                        icon: Icons.people_outline_rounded,
                        text: '${request.passengerCount}',
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(width: 8),

              TextButton(
                onPressed: () => _openTrip(context),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 7,
                  ),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  backgroundColor: scheme.primary.withValues(alpha: 0.07),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(11),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      tripId == null ? l10n.requestDetails : l10n.openTrip,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                        color: scheme.primary,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      Icons.arrow_forward_rounded,
                      size: 16,
                      color: scheme.primary,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _openTrip(BuildContext context) {
    context.go(
      tripId == null
          ? '/passenger/request/${request.id}'
          : '/passenger/trip/$tripId',
    );
  }

  Color _statusColor(BuildContext context, dynamic status) {
    final tone = statusToneFor(status);
    final scheme = Theme.of(context).colorScheme;

    switch (tone) {
      case StatusTone.success:
        return scheme.primary;

      case StatusTone.warning:
        return scheme.tertiary;

      default:
        return scheme.onSurfaceVariant;
    }
  }
}

// =============================================================================
// ROUTE PREVIEW
// =============================================================================

class _RoutePreview extends StatelessWidget {
  const _RoutePreview({
    required this.from,
    required this.to,
    required this.active,
  });

  final String from;
  final String to;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: scheme.surface.withValues(alpha: 0.27),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: scheme.onSurface.withValues(alpha: 0.055)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 22,
            child: Column(
              children: [
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: active ? scheme.primary : scheme.onSurfaceVariant,
                    boxShadow: active
                        ? [
                            BoxShadow(
                              color: scheme.primary.withValues(alpha: 0.25),
                              blurRadius: 7,
                            ),
                          ]
                        : null,
                  ),
                ),

                Container(
                  width: 1.5,
                  height: 25,
                  margin: const EdgeInsets.symmetric(vertical: 2),
                  color: scheme.outlineVariant.withValues(alpha: 0.7),
                ),

                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: scheme.primary,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(width: 9),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  from,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w600,
                  ),
                ),

                const SizedBox(height: 15),

                Text(
                  to,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// STATUS
// =============================================================================

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color,
              boxShadow: [
                BoxShadow(color: color.withValues(alpha: 0.30), blurRadius: 5),
              ],
            ),
          ),

          const SizedBox(width: 5),

          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// SMALL INFO
// =============================================================================

class _SmallInfo extends StatelessWidget {
  const _SmallInfo({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: scheme.surface.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.onSurface.withValues(alpha: 0.06)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: scheme.onSurfaceVariant),
          const SizedBox(width: 5),
          Text(
            text,
            style: TextStyle(
              fontSize: 11,
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// CANONICAL CARD
// =============================================================================

class _CanonicalCard extends StatelessWidget {
  const _CanonicalCard({
    required this.title,
    required this.sectionTitle,
    required this.onPressed,
  });

  final String title;
  final String sectionTitle;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.09),
                borderRadius: BorderRadius.circular(11),
                border: Border.all(
                  color: scheme.primary.withValues(alpha: 0.10),
                ),
              ),
              child: Icon(
                Icons.alt_route_rounded,
                size: 17,
                color: scheme.primary,
              ),
            ),

            const SizedBox(width: 9),

            Text(
              sectionTitle,
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),

        const SizedBox(height: AppTokens.spaceSmall),

        _GlassCard(
          padding: const EdgeInsets.all(AppTokens.spaceMedium),
          borderRadius: BorderRadius.circular(21),
          onTap: onPressed,
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      scheme.primary.withValues(alpha: 0.16),
                      scheme.primary.withValues(alpha: 0.06),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(Icons.alt_route_rounded, color: scheme.primary),
              ),

              const SizedBox(width: 12),

              Expanded(
                child: Text(
                  title,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),

              Container(
                width: 31,
                height: 31,
                decoration: BoxDecoration(
                  color: scheme.surface.withValues(alpha: 0.45),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.arrow_forward_rounded,
                  size: 16,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// =============================================================================
// LANGUAGE
// =============================================================================

// =============================================================================
// EMPTY
// =============================================================================

class _ModernEmptyState extends StatelessWidget {
  const _ModernEmptyState({
    required this.title,
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final String title;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return _GlassCard(
      padding: const EdgeInsets.all(AppTokens.spaceLarge),
      borderRadius: BorderRadius.circular(27),
      highlighted: true,
      child: Column(
        children: [
          Container(
            width: 78,
            height: 78,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  scheme.primary.withValues(alpha: 0.16),
                  scheme.primary.withValues(alpha: 0.06),
                ],
              ),
              shape: BoxShape.circle,
              border: Border.all(color: scheme.primary.withValues(alpha: 0.12)),
            ),
            child: Icon(Icons.route_rounded, size: 34, color: scheme.primary),
          ),

          const SizedBox(height: AppTokens.spaceMedium),

          Text(
            title,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w900,
            ),
          ),

          const SizedBox(height: 7),

          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.45,
            ),
          ),

          const SizedBox(height: AppTokens.spaceLarge),

          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.add_rounded),
              label: Text(actionLabel),
              style: FilledButton.styleFrom(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// FILTER EMPTY
// =============================================================================

class _FilterEmptyState extends StatelessWidget {
  const _FilterEmptyState({required this.onReset});

  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return _GlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      borderRadius: BorderRadius.circular(24),
      child: Column(
        children: [
          Container(
            width: 62,
            height: 62,
            decoration: BoxDecoration(
              color: scheme.surface.withValues(alpha: 0.40),
              shape: BoxShape.circle,
              border: Border.all(
                color: scheme.onSurface.withValues(alpha: 0.07),
              ),
            ),
            child: Icon(
              Icons.inbox_outlined,
              size: 30,
              color: scheme.onSurfaceVariant,
            ),
          ),

          const SizedBox(height: 12),

          Text(
            AppLocalizations.of(context).myTripsFilterEmptyTitle,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w900,
            ),
          ),

          const SizedBox(height: 5),

          Text(
            AppLocalizations.of(context).myTripsFilterEmptyBody,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),

          const SizedBox(height: 14),

          TextButton(
            onPressed: onReset,
            style: TextButton.styleFrom(
              backgroundColor: scheme.primary.withValues(alpha: 0.07),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: Text(
              AppLocalizations.of(context).myTripsShowAll,
              style: TextStyle(
                fontWeight: FontWeight.w900,
                color: scheme.primary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// SKELETONS
// =============================================================================

class _HeaderSkeleton extends StatelessWidget {
  const _HeaderSkeleton();

  @override
  Widget build(BuildContext context) {
    return _GlassSkeleton(height: 62, borderRadius: 19);
  }
}

class _StatsSkeleton extends StatelessWidget {
  const _StatsSkeleton();

  @override
  Widget build(BuildContext context) {
    return _GlassSkeleton(height: 90, borderRadius: 23);
  }
}

class _TripSkeleton extends StatelessWidget {
  const _TripSkeleton();

  @override
  Widget build(BuildContext context) {
    return _GlassSkeleton(
      height: 235,
      borderRadius: 24,
      child: const Center(child: CircularProgressIndicator(strokeWidth: 2.5)),
    );
  }
}

class _GlassSkeleton extends StatelessWidget {
  const _GlassSkeleton({
    required this.height,
    required this.borderRadius,
    this.child,
  });

  final double height;
  final double borderRadius;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          height: height,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                scheme.surface.withValues(alpha: 0.55),
                scheme.surfaceContainerHighest.withValues(alpha: 0.25),
              ],
            ),
            borderRadius: BorderRadius.circular(borderRadius),
            border: Border.all(color: scheme.onSurface.withValues(alpha: 0.07)),
          ),
          child: child,
        ),
      ),
    );
  }
}
