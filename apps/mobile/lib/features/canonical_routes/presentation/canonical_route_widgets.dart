import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/fares/fare.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/fare_estimate.dart';
import '../../../core/widgets/masari_card.dart';
import '../application/canonical_route_controller.dart';
import '../domain/canonical_route_models.dart';

class CanonicalFeatureGate extends ConsumerWidget {
  const CanonicalFeatureGate({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return ref
        .watch(mobileCapabilitiesProvider)
        .when(
          loading: () =>
              const Scaffold(body: Center(child: CircularProgressIndicator())),
          error: (_, _) => _Unavailable(
            message: l10n.routeCatalogUnavailable,
            onRetry: () =>
                ref.read(mobileCapabilitiesProvider.notifier).refresh(),
          ),
          data: (capabilities) {
            if (!capabilities.routeCatalogAvailable ||
                !capabilities.multiRouteEntryAvailable) {
              return _Unavailable(message: l10n.featureUnavailable);
            }
            return child;
          },
        );
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(),
    body: SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          child: MasariCard(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.route_outlined, size: 48),
                const SizedBox(height: AppTokens.spaceMedium),
                Text(message, textAlign: TextAlign.center),
                const SizedBox(height: AppTokens.spaceMedium),
                if (onRetry != null)
                  FilledButton(
                    onPressed: onRetry,
                    child: Text(AppLocalizations.of(context).retry),
                  )
                else
                  FilledButton(
                    onPressed: context.pop,
                    child: Text(AppLocalizations.of(context).returnToDashboard),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class RouteCard extends StatelessWidget {
  const RouteCard({
    required this.route,
    this.selected = false,
    this.onTap,
    super.key,
  });
  final CanonicalRoute route;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).languageCode;
    final l10n = AppLocalizations.of(context);
    final name = locale == 'ar' ? route.nameAr : route.nameEn;
    return Semantics(
      button: onTap != null,
      selected: selected,
      label: '$name, ${directionLabel(l10n, route.direction)}',
      child: Card(
        color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(AppTokens.spaceMedium),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: AppTokens.spaceSmall),
                DirectionBadge(direction: route.direction),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class DirectionBadge extends StatelessWidget {
  const DirectionBadge({required this.direction, super.key});
  final CanonicalRouteDirection direction;

  @override
  Widget build(BuildContext context) {
    final label = directionLabel(AppLocalizations.of(context), direction);
    return Chip(
      avatar: Icon(
        direction == CanonicalRouteDirection.inbound
            ? Icons.arrow_back
            : direction == CanonicalRouteDirection.outbound
            ? Icons.arrow_forward
            : Icons.sync,
        semanticLabel: label,
      ),
      label: Text(label),
    );
  }
}

class OrderedStopTimeline extends StatelessWidget {
  const OrderedStopTimeline({
    required this.stops,
    this.selectedIds = const {},
    super.key,
  });
  final List<CanonicalStop> stops;
  final Set<String> selectedIds;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).languageCode;
    final l10n = AppLocalizations.of(context);
    return Semantics(
      container: true,
      label: l10n.orderedStops,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.orderedStops,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          for (final stop in stops)
            ListTile(
              minTileHeight: 48,
              leading: CircleAvatar(child: Text('${stop.sequence}')),
              title: Text(locale == 'ar' ? stop.nameAr : stop.nameEn),
              subtitle: Text(l10n.stopSequence(stop.sequence)),
              selected: selectedIds.contains(stop.id),
            ),
        ],
      ),
    );
  }
}

/// Estimated seat fare for the chosen route and party size, shown before the
/// passenger submits. Falls back to an explicit note when no tariff exists.
Widget passengerFareEstimate(
  BuildContext context,
  RouteFares? fares,
  int passengers,
) {
  final lines = fares == null
      ? const <FareLine>[]
      : seatFareLines(AppLocalizations.of(context), fares, passengers);
  if (fares == null || lines.isEmpty) return const FareNotSetNote();
  return FareEstimateBox(currency: fares.currency, lines: lines);
}

/// Estimated parcel fares for the order being built; unpriced sizes are not
/// invented, a note says so instead.
Widget parcelFareEstimate(
  BuildContext context,
  RouteFares? fares,
  List<String> sizes,
) {
  final lines = fares == null
      ? const <FareLine>[]
      : parcelFareLines(AppLocalizations.of(context), fares, sizes);
  if (fares == null || lines.isEmpty) return const FareNotSetNote();
  final allPriced = sizes.every((size) => fares.parcelFor(size) != null);
  return Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      FareEstimateBox(currency: fares.currency, lines: lines),
      if (!allPriced) const FareNotSetNote(),
    ],
  );
}

/// The fare frozen on a created request, shown on result and status screens.
Widget fareSnapshotBox(
  BuildContext context,
  FareSnapshot? snapshot, {
  int? passengers,
}) {
  if (snapshot == null) return const SizedBox.shrink();
  final l10n = AppLocalizations.of(context);
  final unit = snapshot.unitMinor;
  final seats = passengers;
  return FareEstimateBox(
    booked: true,
    currency: snapshot.currency,
    lines: [
      if (unit != null && seats != null && seats > 1)
        FareLine(label: l10n.farePerSeat, minor: unit),
      FareLine(
        label: seats != null && seats > 1
            ? l10n.fareSeatsLine(seats)
            : l10n.fareTotal,
        minor: snapshot.totalMinor,
        emphasis: true,
      ),
    ],
  );
}

class OperationStatusCard extends StatelessWidget {
  const OperationStatusCard({
    required this.title,
    required this.body,
    super.key,
  });
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(
            Icons.check_circle_outline,
            color: Theme.of(context).colorScheme.primary,
            size: 48,
          ),
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(body),
        ],
      ),
    ),
  );
}

String directionLabel(
  AppLocalizations l10n,
  CanonicalRouteDirection direction,
) => switch (direction) {
  CanonicalRouteDirection.outbound => l10n.directionOutbound,
  CanonicalRouteDirection.inbound => l10n.directionInbound,
  CanonicalRouteDirection.loop => l10n.directionLoop,
};

Future<DateTime?> pickFutureDateTime(
  BuildContext context,
  DateTime initial,
) async {
  final now = DateTime.now();
  final date = await showDatePicker(
    context: context,
    initialDate: initial.isAfter(now) ? initial : now,
    firstDate: now,
    lastDate: now.add(const Duration(days: 90)),
  );
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.fromDateTime(initial),
  );
  if (time == null) return null;
  return DateTime(date.year, date.month, date.day, time.hour, time.minute);
}

String dateTimeLabel(BuildContext context, DateTime value) {
  final local = value.toLocal();
  final material = MaterialLocalizations.of(context);
  return '${material.formatMediumDate(local)} ${material.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
}
