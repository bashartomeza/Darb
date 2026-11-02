import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/location/location_service.dart';
import '../../../core/maps/osrm_route_service.dart';
import '../../../core/maps/darb_route_map.dart';
import '../../../core/maps/map_overlays.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/darb_map.dart';
import '../../../core/widgets/darb_section.dart';
import '../../../core/widgets/state_views.dart';
import '../../community_reports/application/community_reports_controller.dart';
import '../../community_reports/presentation/community_reports_section.dart';
import '../../checkpoints/application/checkpoint_controller.dart';
import '../../checkpoints/domain/checkpoint_models.dart';
import '../../checkpoints/presentation/checkpoint_sheet.dart';
import '../../checkpoints/presentation/unplaced_checkpoints_list.dart';
import '../../checkpoint_directory/presentation/checkpoint_directory_screen.dart';
import '../../security/presentation/session_status_banner.dart';
import '../../trips/application/passenger_trip_controller.dart';
import '../../trips/data/trip_models.dart';
import '../application/passenger_map_controller.dart';

/// Passenger's main Map + Alerts screen.
///
/// Passenger map and alerts screen with a custom orange header, route-first
/// layout, and an interactive checkpoint browser.
class PassengerMapAlertsScreen extends ConsumerWidget {
  const PassengerMapAlertsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final view = ref.watch(passengerMapViewProvider);

    return Scaffold(
      backgroundColor: const Color(0xFFFFFFFF),
      appBar: _buildAppBar(context, l10n),
      body: SafeArea(
        child: view.when(
          // A dependency refresh (e.g. the 5-second trip poll) keeps the map
          // on screen instead of rebuilding it empty.
          skipLoadingOnReload: true,
          loading: () => const _MapBody(
            view: PassengerMapView(
              mapsAvailable: true,
              checkpointsAvailable: true,
            ),
          ),
          error: (_, _) => ErrorStateView(
            title: l10n.mapLoadFailed,
            message: l10n.mapLoadFailedBody,
            retryLabel: l10n.retry,
            onRetry: () => ref.invalidate(passengerMapViewProvider),
          ),
          data: (data) => _MapBody(view: data),
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(
    BuildContext context,
    AppLocalizations l10n,
  ) {
    return AppBar(
      toolbarHeight: 64,
      automaticallyImplyLeading: false,
      title: Text(
        l10n.navMapAlerts,
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: AppTheme.onSurface,
        ),
      ),
      actions: const [
        CheckpointDirectoryAction(),
        Padding(
          padding: EdgeInsetsDirectional.only(end: 8),
          child: LanguageSwitch(),
        ),
      ],
    );
  }
}

/// Main body of the Map Alerts page.
class _MapBody extends ConsumerStatefulWidget {
  const _MapBody({required this.view});

  final PassengerMapView view;

  @override
  ConsumerState<_MapBody> createState() => _MapBodyState();
}

class _MapBodyState extends ConsumerState<_MapBody> {
  static const Color _navy = Color(0xFF1C1A1A);
  static const Color _navyLight = Color(0xFFFA5F12);
  static const Color _orange = Color(0xFFFA5F12);
  static const Color _mutedText = Color(0xFF707070);
  static const Color _border = Color(0xFFE0E0E0);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    // ----------------------------------------------------------------------
    // Passenger location.
    // ----------------------------------------------------------------------

    final position = ref.watch(currentPositionProvider);

    // ----------------------------------------------------------------------
    // Checkpoints.
    // ----------------------------------------------------------------------

    final checkpoints = ref.watch(checkpointsProvider);

    final overlay = watchMapOverlay(ref, l10n);

    // ----------------------------------------------------------------------
    // Passenger route.
    // ----------------------------------------------------------------------

    final route = widget.view.route;

    // ----------------------------------------------------------------------
    // Accepted trip / driver location.
    // ----------------------------------------------------------------------

    final tripId = widget.view.assignment?.trip?.id;

    final tripState = tripId == null
        ? null
        : ref.watch(passengerTripControllerProvider(tripId));

    final tripData = tripState?.value;

    final driverLocation = tripData?.location;

    // ----------------------------------------------------------------------
    // Driver -> passenger pickup distance.
    // ----------------------------------------------------------------------

    final driverToPickupDistanceKm =
        driverLocation == null || widget.view.pickup?.position == null
        ? null
        : const Distance().as(
            LengthUnit.Kilometer,
            LatLng(driverLocation.lat, driverLocation.lng),
            LatLng(
              widget.view.pickup!.position!.latitude,
              widget.view.pickup!.position!.longitude,
            ),
          );

    // ----------------------------------------------------------------------
    // Estimated ETA.
    // ----------------------------------------------------------------------

    const estimatedSpeedKmh = 30.0;

    final estimatedEtaMinutes = driverToPickupDistanceKm == null
        ? null
        : (driverToPickupDistanceKm / estimatedSpeedKmh * 60).ceil();

    // ----------------------------------------------------------------------
    // Localization.
    // ----------------------------------------------------------------------

    final arabic = Localizations.localeOf(context).languageCode == 'ar';

    String stopName(CanonicalStop stop) {
      return arabic ? stop.nameAr : stop.nameEn;
    }

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(passengerMapViewProvider);

        await Future.wait([
          ref.read(checkpointsProvider.notifier).refresh(),
          ref.read(communityReportsProvider.notifier).refresh(),
        ]);

        if (tripId != null) {
          await ref
              .read(passengerTripControllerProvider(tripId).notifier)
              .refresh();
        }
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
        children: [
          // ==================================================================
          // TRIP SUMMARY
          // ==================================================================
          if (tripData != null) ...[
            const SessionStatusBanner(),
            const SizedBox(height: 18),

            _buildTripSummary(context, l10n, tripData),

            const SizedBox(height: 18),
          ],

          // ==================================================================
          // MAP
          // ==================================================================
          _buildMapSection(
            context: context,
            l10n: l10n,
            route: route,
            driverLocation: driverLocation,
            position: position,
            overlay: overlay,
            arabic: arabic,
            stopName: stopName,
          ),

          // ==================================================================
          // DRIVER ARRIVAL
          // ==================================================================
          if (driverLocation != null && driverToPickupDistanceKm != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            _DriverArrivalCard(
              distanceKm: driverToPickupDistanceKm,
              etaMinutes: estimatedEtaMinutes,
            ),
          ],

          // ==================================================================
          // LOCATION DETAILS
          // ==================================================================
          if (tripData != null) ...[
            const SizedBox(height: 18),
            _buildLocationDetails(context, l10n, tripData),
          ],

          // ==================================================================
          // DRIVER LOCATION WARNINGS
          // ==================================================================
          const SizedBox(height: AppTokens.spaceMedium),

          if (tripId != null && tripState != null && tripState.hasError)
            _Notice(
              icon: Icons.location_disabled_outlined,
              message: 'تعذر تحديث موقع السائق حاليًا.',
              actionLabel: l10n.retry,
              onAction: () => ref
                  .read(passengerTripControllerProvider(tripId).notifier)
                  .refresh(),
            ),

          if (tripId != null &&
              tripState?.value?.location == null &&
              !tripState!.isLoading)
            const _Notice(
              icon: Icons.location_searching_rounded,
              message: 'بانتظار آخر موقع مسجل للسائق.',
            ),

          // ==================================================================
          // PASSENGER LOCATION WARNING
          // ==================================================================
          if (position.hasError)
            _Notice(
              icon: Icons.location_disabled_outlined,
              message: _locationMessage(l10n, position.error),
              actionLabel: l10n.locationEnable,
              onAction: () =>
                  ref.read(currentPositionProvider.notifier).refresh(),
            ),

          // ==================================================================
          // ROUTE WARNING
          // ==================================================================
          if (route != null && !widget.view.hasDrawableRoute)
            _Notice(
              icon: Icons.wrong_location_outlined,
              message: l10n.mapRouteMissingCoordinates,
            ),

          // ==================================================================
          // PASSENGER ROUTE SUMMARY
          // ==================================================================
          if (widget.view.pickup != null || widget.view.dropoff != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            _PassengerRouteSummary(
              l10n: l10n,
              view: widget.view,
              arabic: arabic,
            ),
          ],

          // ==================================================================
          // CHECKPOINTS / ALERTS
          // ==================================================================
          const SizedBox(height: AppTokens.spaceMedium),

          DarbSection(
            title: l10n.checkpoints,
            child: _CheckpointsPanel(
              available: overlay.checkpointsAvailable != false,
              state: checkpoints,
              arabic: arabic,
            ),
          ),

          // ==================================================================
          // COMMUNITY REPORTS
          // ==================================================================
          const SizedBox(height: AppTokens.spaceMedium),
          const CommunityReportsSection(),
        ],
      ),
    );
  }

  // ==========================================================================
  // TRIP SUMMARY
  // ==========================================================================

  Widget _buildTripSummary(
    BuildContext context,
    AppLocalizations l10n,
    PassengerTripState data,
  ) {
    final trip = data.trip;

    return _ModernCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  l10n.selectedRoute,
                  style: const TextStyle(
                    color: _mutedText,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              _StatusBadge(
                label: _statusLabel(l10n, trip.status),
                status: trip.status,
              ),
            ],
          ),

          const SizedBox(height: 10),

          Text(
            // The predefined route's name when the trip's request has one.
            trip.routeName(
                  arabic: Localizations.localeOf(context).languageCode == 'ar',
                ) ??
                trip.routeLabel,
            style: const TextStyle(
              color: _navy,
              fontSize: 21,
              height: 1.3,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.4,
            ),
          ),

          const SizedBox(height: 18),

          Row(
            children: [
              _RoutePoint(
                icon: Icons.trip_origin_rounded,
                label: localizedCorridorPlace(context, trip.originDisplayLabel),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Column(
                    children: [
                      const Icon(
                        Icons.directions_car_rounded,
                        color: _orange,
                        size: 27,
                      ),
                      const SizedBox(height: 5),
                      Container(
                        height: 2,
                        decoration: BoxDecoration(
                          color: _border,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              _RoutePoint(
                icon: Icons.flag_rounded,
                label: localizedCorridorPlace(
                  context,
                  trip.destinationDisplayLabel,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // MAP SECTION
  // ==========================================================================

  Widget _buildMapSection({
    required BuildContext context,
    required AppLocalizations l10n,
    required CanonicalRoute? route,
    required TripLocation? driverLocation,
    required AsyncValue<GeoPoint?> position,
    required MapOverlay overlay,
    required bool arabic,
    required String Function(CanonicalStop) stopName,
  }) {
    final destination = route?.destinationStop?.position;
    // With a vehicle position: the road from it to the destination. Otherwise
    // the selected route itself, through its own stops.
    final road = driverLocation != null && destination != null
        ? watchRoadRoute(ref, [
            GeoPoint(driverLocation.lat, driverLocation.lng),
            destination,
          ])
        : route == null
        ? null
        : watchCanonicalRoute(ref, route);
    final here = position.value;

    return _ModernCard(
      padding: const EdgeInsets.all(10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 12),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _orange.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.map_rounded,
                    color: _orange,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.latestLocation,
                        style: const TextStyle(
                          color: _navy,
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        l10n.selectedRoute,
                        style: const TextStyle(color: _mutedText, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DarbMap(
                  emptyLabel: route == null
                      ? l10n.mapSelectRoute
                      : l10n.noLocationYet,
                  attributionLabel: l10n.mapAttribution,
                  height: 390,
                  paths: roadRoutePaths(road, color: _navyLight, width: 6),
                  notes: [...roadRouteNotes(l10n, road), ...overlay.notes],
                  markers: [
                    // Background layers first so the trip's own pins stay
                    // on top where they overlap.
                    ...overlay.markers,

                    // Route stops, named from the selected route's own data.
                    if (route != null)
                      for (final stop in route.stops)
                        if (stop.position != null)
                          _stopMarker(l10n, stop, stopName(stop), route),

                    if (here != null)
                      DarbMapMarker(
                        position: here,
                        icon: Icons.my_location_rounded,
                        color: SemanticColors.passenger,
                        type: DarbMapMarkerType.location,
                        label: l10n.mapYourLocation,
                        size: 40,
                      ),

                    if (driverLocation != null)
                      DarbMapMarker(
                        position: GeoPoint(
                          driverLocation.lat,
                          driverLocation.lng,
                        ),
                        icon: Icons.local_shipping_rounded,
                        color: _orange,
                        type: DarbMapMarkerType.driver,
                        label:
                            '${l10n.latestLocation} — '
                            '${l10n.recordedTime}: '
                            '${driverLocation.recordedAt}',
                        size: 50,
                      ),
                  ],
                ),

                // ------------------------------------------------------------
                // REMAINING ROUTE INFORMATION
                // ------------------------------------------------------------
                if (road != null &&
                    road.routed &&
                    (road.durationSeconds ?? 0) > 0) ...[
                  const SizedBox(height: 8),
                  Builder(
                    builder: (context) {
                      final result = OsrmRouteResult(
                        points: const [],
                        durationSeconds: road.durationSeconds!,
                        distanceMeters: road.distanceMeters ?? 0,
                      );
                      return Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: _navy,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.access_time_rounded,
                              color: _orange,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'الوقت المتبقي: '
                                '${result.formattedDuration}',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Text(
                              '${result.distanceKilometers.toStringAsFixed(1)} km',
                              style: const TextStyle(
                                color: Colors.white70,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ],

                const SizedBox(height: 8),

                // ------------------------------------------------------------
                // MAP HELP
                // ------------------------------------------------------------
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 3,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.touch_app_outlined,
                        size: 18,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          driverLocation != null
                              ? 'المسار يتحدث حسب موقع السائق الحالي'
                              : 'المسار المعروض هو المسار المحدد للرحلة',
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  DarbMapMarker _stopMarker(
    AppLocalizations l10n,
    CanonicalStop stop,
    String name,
    CanonicalRoute route,
  ) {
    final isOrigin = stop.id == route.originStop?.id;

    final isDestination = stop.id == route.destinationStop?.id;

    return DarbMapMarker(
      position: stop.position!,
      icon: isOrigin
          ? Icons.trip_origin_rounded
          : isDestination
          ? Icons.flag_rounded
          : Icons.circle,
      color: isDestination
          ? SemanticColors.completedRoute
          : SemanticColors.parcel,
      label: isOrigin
          ? l10n.mapOriginLabel(name)
          : isDestination
          ? l10n.mapDestinationLabel(name)
          : l10n.mapStopLabel(name),
      size: isOrigin || isDestination ? 34 : 22,
    );
  }

  // ==========================================================================
  // LOCATION DETAILS
  // ==========================================================================

  Widget _buildLocationDetails(
    BuildContext context,
    AppLocalizations l10n,
    PassengerTripState data,
  ) {
    final location = data.location;

    return _ModernCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.latestLocation,
            style: const TextStyle(
              color: _navy,
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),

          const SizedBox(height: 16),

          if (location == null)
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: _border.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: const Icon(
                    Icons.location_searching_rounded,
                    color: _mutedText,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    l10n.noLocationYet,
                    style: const TextStyle(
                      color: _mutedText,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            )
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: _orange.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: const Icon(
                    Icons.local_shipping_rounded,
                    color: _orange,
                    size: 23,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        localizedLocationSource(l10n, location.source),
                        style: const TextStyle(
                          color: _navy,
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${l10n.recordedTime}: '
                        '${location.recordedAt}',
                        style: const TextStyle(color: _mutedText, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                _LocationStatus(isStale: data.locationIsStale, l10n: l10n),
              ],
            ),

          if (location != null) ...[
            const SizedBox(height: 16),
            const Divider(height: 1, color: _border),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _InfoItem(
                    icon: Icons.route_rounded,
                    label: l10n.sequence,
                    value: '${location.sequence}',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _InfoItem(
                    icon: Icons.source_rounded,
                    label: l10n.source,
                    value: localizedLocationSource(l10n, location.source),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  String _statusLabel(AppLocalizations l10n, String status) => switch (status) {
    'pending' => l10n.statusPending,
    'matched' => l10n.statusMatched,
    'accepted' => l10n.statusAccepted,
    'picked_up' => l10n.statusPickedUp,
    'in_transit' => l10n.statusInTransit,
    'delivered' => l10n.statusDelivered,
    'cancelled' => l10n.statusCancelled,
    'completed' => l10n.statusCompleted,
    'pickup_started' => l10n.statusPickupStarted,
    _ => status,
  };
}

// ============================================================================
// DRIVER ARRIVAL CARD
// ============================================================================

class _DriverArrivalCard extends StatelessWidget {
  const _DriverArrivalCard({
    required this.distanceKm,
    required this.etaMinutes,
  });

  final double distanceKm;
  final int? etaMinutes;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final distanceLabel = distanceKm < 1
        ? '${(distanceKm * 1000).round()} م'
        : '${distanceKm.toStringAsFixed(1)} كم';

    final etaLabel = etaMinutes == null ? '—' : '$etaMinutes د';

    return DarbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(
                  Icons.local_shipping_rounded,
                  color: theme.colorScheme.onPrimaryContainer,
                  size: 28,
                ),
              ),
              const SizedBox(width: AppTokens.spaceMedium),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'السائق في الطريق إليك',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: AppTokens.spaceExtraSmall),
                    Text(
                      'المسافة والوقت المتبقي للوصول إلى نقطة الالتقاء',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: AppTokens.spaceMedium),

          Row(
            children: [
              Expanded(
                child: _DriverArrivalMetric(
                  icon: Icons.route_rounded,
                  value: distanceLabel,
                  label: 'المسافة المتبقية',
                ),
              ),
              const SizedBox(width: AppTokens.spaceSmall),
              Expanded(
                child: _DriverArrivalMetric(
                  icon: Icons.access_time_rounded,
                  value: etaLabel,
                  label: 'وقت الوصول التقريبي',
                ),
              ),
            ],
          ),

          const SizedBox(height: AppTokens.spaceSmall),

          Text(
            'الوقت تقديري وقد يتغير حسب حركة الطريق.',
            textAlign: TextAlign.center,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _DriverArrivalMetric extends StatelessWidget {
  const _DriverArrivalMetric({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.spaceSmall,
        vertical: AppTokens.spaceMedium,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
      ),
      child: Column(
        children: [
          Icon(icon, color: theme.colorScheme.primary, size: 25),
          const SizedBox(height: AppTokens.spaceExtraSmall),
          Text(
            value,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            textAlign: TextAlign.center,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// PASSENGER ROUTE SUMMARY
// ============================================================================

class _PassengerRouteSummary extends StatelessWidget {
  const _PassengerRouteSummary({
    required this.l10n,
    required this.view,
    required this.arabic,
  });

  final AppLocalizations l10n;
  final PassengerMapView view;
  final bool arabic;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    String stopName(CanonicalStop stop) {
      return arabic ? stop.nameAr : stop.nameEn;
    }

    return DarbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'مسار رحلتك',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),

          const SizedBox(height: AppTokens.spaceMedium),

          if (view.pickup != null)
            _PassengerRoutePoint(
              icon: Icons.location_on_rounded,
              color: SemanticColors.upcomingRoute,
              title: 'نقطة الالتقاء',
              value: stopName(view.pickup!),
            ),

          if (view.pickup != null && view.dropoff != null)
            Padding(
              padding: const EdgeInsetsDirectional.only(start: 12),
              child: Container(
                width: 2,
                height: 25,
                color: theme.colorScheme.outlineVariant,
              ),
            ),

          if (view.dropoff != null)
            _PassengerRoutePoint(
              icon: Icons.flag_rounded,
              color: SemanticColors.completedRoute,
              title: 'الوجهة',
              value: stopName(view.dropoff!),
            ),
        ],
      ),
    );
  }
}

class _PassengerRoutePoint extends StatelessWidget {
  const _PassengerRoutePoint({
    required this.icon,
    required this.color,
    required this.title,
    required this.value,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      children: [
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.14),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 18, color: color),
        ),
        const SizedBox(width: AppTokens.spaceSmall),
        Text(
          '$title: ',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: theme.textTheme.bodyLarge?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

// ============================================================================
// CHECKPOINTS PANEL
// ============================================================================

class _CheckpointsPanel extends ConsumerWidget {
  const _CheckpointsPanel({
    required this.available,
    required this.state,
    required this.arabic,
  });

  final bool available;
  final AsyncValue<CheckpointSnapshot> state;
  final bool arabic;

  static const _navy = Color(0xFF1C1A1A);
  static const _orange = Color(0xFFFA5F12);
  static const _orangeSoft = Color(0xFFFFE8DC);
  static const _textMuted = Color(0xFF707070);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    if (!available) {
      return DarbInfoCard(
        title: l10n.checkpointsUnavailable,
        subtitle: l10n.checkpointsDisabled,
        icon: Icons.block_outlined,
      );
    }

    return state.when(
      loading: () => const LoadingSkeleton.card(),
      error: (_, _) => ErrorStateView(
        title: l10n.checkpointsUnavailable,
        message: l10n.checkpointsUnavailableBody,
        retryLabel: l10n.retry,
        onRetry: () => ref.read(checkpointsProvider.notifier).refresh(),
      ),
      data: (snapshot) {
        if (snapshot.checkpoints.isEmpty) {
          if (snapshot.unplaced.isNotEmpty) {
            return UnplacedCheckpointsList(unplaced: snapshot.unplaced);
          }
          return DarbInfoCard(
            title: l10n.checkpointsEmpty,
            subtitle: l10n.checkpointCount(0),
            icon: Icons.check_circle_outline,
          );
        }

        final grouped = <String, List<Checkpoint>>{};
        for (final checkpoint in snapshot.checkpoints) {
          final city = checkpoint.city.trim().isEmpty
              ? 'مدينة غير محددة'
              : checkpoint.city.trim();
          grouped.putIfAbsent(city, () => <Checkpoint>[]).add(checkpoint);
        }
        final cities = grouped.keys.toList()..sort();

        final congestedCount = snapshot.checkpoints
            .where(
              (checkpoint) => checkpoint.status == CheckpointStatus.congested,
            )
            .length;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // One clear action: open the checkpoint browser instead of
            // duplicating every city as a long static list on this screen.
            Material(
              color: _navy,
              borderRadius: BorderRadius.circular(22),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => _showCitiesSheet(
                  context: context,
                  ref: ref,
                  snapshot: snapshot,
                  grouped: grouped,
                ),
                child: Stack(
                  children: [
                    PositionedDirectional(
                      end: -18,
                      top: -24,
                      child: Container(
                        width: 112,
                        height: 112,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.08),
                            width: 18,
                          ),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 50,
                                height: 50,
                                decoration: BoxDecoration(
                                  color: _orange,
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                child: const Icon(
                                  Icons.route_rounded,
                                  color: Colors.white,
                                  size: 26,
                                ),
                              ),
                              const SizedBox(width: 13),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'الحواجز على الطريق',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 16,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    const SizedBox(height: 5),
                                    Text(
                                      '${snapshot.checkpoints.length} حاجز · ${cities.length} مدينة',
                                      style: TextStyle(
                                        color: Colors.white.withValues(
                                          alpha: 0.72,
                                        ),
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Icon(
                                Icons.arrow_forward_ios_rounded,
                                color: Colors.white,
                                size: 17,
                              ),
                            ],
                          ),
                          const SizedBox(height: 17),
                          Row(
                            children: [
                              Expanded(
                                child: _CheckpointMiniMetric(
                                  label: 'المدن',
                                  value: '${cities.length}',
                                  icon: Icons.location_city_rounded,
                                ),
                              ),
                              const SizedBox(width: 9),
                              Expanded(
                                child: _CheckpointMiniMetric(
                                  label: 'حواجز عليها ازدحام',
                                  value: '$congestedCount',
                                  icon: Icons.traffic_rounded,
                                  accent: congestedCount > 0,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 15),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              vertical: 12,
                              horizontal: 14,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.visibility_rounded,
                                  color: _navy,
                                  size: 18,
                                ),
                                SizedBox(width: 8),
                                Text(
                                  'عرض تفاصيل الحواجز وحالتها',
                                  style: TextStyle(
                                    color: _navy,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (snapshot.fetchedAt != null) ...[
              const SizedBox(height: 10),
              Text(
                'آخر تحديث للبيانات: ${_formatCheckpointTime(snapshot.fetchedAt)}',
                textAlign: TextAlign.end,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppTheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                onPressed: () =>
                    ref.read(checkpointsProvider.notifier).refresh(),
                icon: const Icon(Icons.refresh_rounded, size: 17),
                label: const Text('تحديث بيانات الحواجز'),
                style: TextButton.styleFrom(
                  foregroundColor: _navy,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 8,
                  ),
                ),
              ),
            ),
            if (snapshot.unplaced.isNotEmpty) ...[
              const SizedBox(height: 8),
              UnplacedCheckpointsList(unplaced: snapshot.unplaced),
            ],
          ],
        );
      },
    );
  }

  Future<void> _showCitiesSheet({
    required BuildContext context,
    required WidgetRef ref,
    required CheckpointSnapshot snapshot,
    required Map<String, List<Checkpoint>> grouped,
  }) async {
    final cities = grouped.keys.toList()..sort();
    await showCheckpointSheet<void>(
      context: context,
      checkpoints: snapshot.checkpoints,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => SafeArea(
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.68,
          minChildSize: 0.35,
          maxChildSize: 0.92,
          builder: (context, scrollController) => Column(
            children: [
              const _CheckpointSheetHandle(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
                child: Row(
                  children: [
                    const Icon(Icons.location_city_rounded, color: _orange),
                    const SizedBox(width: 9),
                    const Expanded(
                      child: Text(
                        'الحواجز حسب المدينة',
                        style: TextStyle(
                          color: _navy,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    Text(
                      '${snapshot.checkpoints.length}',
                      style: const TextStyle(
                        color: _orange,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.separated(
                  controller: scrollController,
                  padding: const EdgeInsets.all(16),
                  itemCount: cities.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final city = cities[index];
                    final items = grouped[city]!;
                    final congested = items.any(
                      (checkpoint) =>
                          checkpoint.status == CheckpointStatus.congested,
                    );
                    return _CheckpointCityTile(
                      city: city,
                      checkpoints: items,
                      showChevron: true,
                      congested: congested,
                      onTap: () {
                        Navigator.of(sheetContext).pop();
                        _showCityCheckpointsSheet(
                          context: context,
                          city: city,
                          checkpoints: items,
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showCityCheckpointsSheet({
    required BuildContext context,
    required String city,
    required List<Checkpoint> checkpoints,
  }) async {
    await showCheckpointSheet<void>(
      context: context,
      checkpoints: checkpoints,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => SafeArea(
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.72,
          minChildSize: 0.35,
          maxChildSize: 0.94,
          builder: (context, scrollController) => Column(
            children: [
              const _CheckpointSheetHandle(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
                child: Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: _orangeSoft,
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: const Icon(
                        Icons.location_on_rounded,
                        color: _orange,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        city,
                        style: const TextStyle(
                          color: _navy,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    Text(
                      '${checkpoints.length} حاجز',
                      style: const TextStyle(
                        color: _textMuted,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.separated(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                  itemCount: checkpoints.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, index) =>
                      _CheckpointDetailCard(checkpoint: checkpoints[index]),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CheckpointMiniMetric extends StatelessWidget {
  const _CheckpointMiniMetric({
    required this.label,
    required this.value,
    required this.icon,
    this.accent = false,
  });

  final String label;
  final String value;
  final IconData icon;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 11),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: 0.09)),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            color: accent ? const Color(0xFFFFB37A) : Colors.white70,
            size: 19,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: TextStyle(
                    color: accent ? const Color(0xFFFFB37A) : Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
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

class _CheckpointCityTile extends StatelessWidget {
  const _CheckpointCityTile({
    required this.city,
    required this.checkpoints,
    required this.onTap,
    this.showChevron = false,
    this.congested,
  });

  final String city;
  final List<Checkpoint> checkpoints;
  final VoidCallback onTap;
  final bool showChevron;
  final bool? congested;

  @override
  Widget build(BuildContext context) {
    final hasCongestion =
        congested ??
        checkpoints.any(
          (checkpoint) => checkpoint.status == CheckpointStatus.congested,
        );

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFFE0E0E0)),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFE8DC),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.location_city_rounded,
                  color: Color(0xFFFA5F12),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      city,
                      style: const TextStyle(
                        color: Color(0xFF1C1A1A),
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        Text(
                          '${checkpoints.length} حاجز',
                          style: const TextStyle(
                            color: Color(0xFF707070),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (hasCongestion) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 7,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFEE2E2),
                              borderRadius: BorderRadius.circular(7),
                            ),
                            child: const Text(
                              'يوجد أزمة',
                              style: TextStyle(
                                color: Color(0xFFDC2626),
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              Icon(
                showChevron
                    ? Icons.chevron_left_rounded
                    : Icons.arrow_forward_ios_rounded,
                size: 17,
                color: const Color(0xFFAEAEAE),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CheckpointDetailCard extends StatelessWidget {
  const _CheckpointDetailCard({required this.checkpoint});

  final Checkpoint checkpoint;

  @override
  Widget build(BuildContext context) {
    final name = checkpoint.displayName;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE0E0E0)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFE8DC),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.local_police_rounded,
                  color: Color(0xFFFA5F12),
                  size: 21,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  name,
                  style: const TextStyle(
                    color: Color(0xFF1C1A1A),
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 13),
          Text(checkpointStatusLabel(checkpoint.status)),
          Row(
            children: [
              Expanded(
                child: _CheckpointDirectionStatus(
                  label: 'الدخول',
                  status: checkpoint.enteringStatus,
                  updatedAt: checkpoint.enteringStatusLastUpdated,
                  icon: Icons.login_rounded,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: _CheckpointDirectionStatus(
                  label: 'الخروج',
                  status: checkpoint.leavingStatus,
                  updatedAt: checkpoint.leavingStatusLastUpdated,
                  icon: Icons.logout_rounded,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CheckpointDirectionStatus extends StatelessWidget {
  const _CheckpointDirectionStatus({
    required this.label,
    required this.status,
    required this.updatedAt,
    required this.icon,
  });

  final String? label;
  final String? status;
  final DateTime? updatedAt;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final style = _checkpointStatusStyle(status);
    final statusLabel = _checkpointStatusLabel(status);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: style.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: style.color.withValues(alpha: 0.20)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: style.color),
              const SizedBox(width: 5),
              Text(
                label ?? '',
                style: const TextStyle(
                  color: Color(0xFF707070),
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(style.icon, size: 15, color: style.color),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  statusLabel,
                  style: TextStyle(
                    color: style.color,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            updatedAt == null
                ? 'التحديث: غير متوفر'
                : 'التحديث: ${_formatCheckpointTime(updatedAt)}',
            style: const TextStyle(
              color: Color(0xFF707070),
              fontSize: 9,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckpointStatusStyle {
  const _CheckpointStatusStyle({
    required this.color,
    required this.background,
    required this.icon,
  });
  final Color color;
  final Color background;
  final IconData icon;
}

_CheckpointStatusStyle _checkpointStatusStyle(String? status) {
  switch (parseCheckpointStatus(status)) {
    case CheckpointStatus.open:
      return const _CheckpointStatusStyle(
        color: Color(0xFF16A34A),
        background: Color(0xFFF0FDF4),
        icon: Icons.check_circle_rounded,
      );
    case CheckpointStatus.congested:
      return const _CheckpointStatusStyle(
        color: Color(0xFFF59E0B),
        background: Color(0xFFFFFBEB),
        icon: Icons.traffic_rounded,
      );
    case CheckpointStatus.closed:
      return const _CheckpointStatusStyle(
        color: Color(0xFFDC2626),
        background: Color(0xFFFEF2F2),
        icon: Icons.warning_amber_rounded,
      );
    default:
      return const _CheckpointStatusStyle(
        color: Color(0xFF707070),
        background: Color(0xFFF6F6F6),
        icon: Icons.help_outline_rounded,
      );
  }
}

String _checkpointStatusLabel(String? status) {
  final value = status?.trim();
  return value == null || value.isEmpty ? 'الحالة غير متوفرة' : value;
}

class _CheckpointSheetHandle extends StatelessWidget {
  const _CheckpointSheetHandle();

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 10, bottom: 6),
    width: 38,
    height: 4,
    decoration: BoxDecoration(
      color: const Color(0xFFE0E0E0),
      borderRadius: BorderRadius.circular(10),
    ),
  );
}

// ============================================================================
// CHECKPOINT DATE / TIME
// ============================================================================

/// Converts the API timestamp from UTC to Palestine time (UTC+3).
String _formatCheckpointTime(DateTime? value) {
  if (value == null) return 'غير متوفر';
  final palestineTime = value.toUtc().add(const Duration(hours: 3));
  final year = palestineTime.year.toString().padLeft(4, '0');
  final month = palestineTime.month.toString().padLeft(2, '0');
  final day = palestineTime.day.toString().padLeft(2, '0');
  final hour = palestineTime.hour.toString().padLeft(2, '0');
  final minute = palestineTime.minute.toString().padLeft(2, '0');
  return '$year-$month-$day $hour:$minute';
}

// ============================================================================
// NOTICE
// ============================================================================

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.only(bottom: AppTokens.spaceMedium),
      padding: const EdgeInsets.all(AppTokens.gutterMobile),
      decoration: BoxDecoration(
        color: SemanticColors.warningContainer,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: SemanticColors.onWarningContainer),
          const SizedBox(width: AppTokens.spaceSmall),
          Expanded(
            child: Text(
              message,
              style: theme.textTheme.bodySmall?.copyWith(
                color: SemanticColors.onWarningContainer,
              ),
            ),
          ),
          if (actionLabel != null && onAction != null)
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
        ],
      ),
    );
  }
}

// ============================================================================
// LOCATION HELPERS
// ============================================================================

String _locationMessage(AppLocalizations l10n, Object? error) {
  if (error is! LocationException) {
    return l10n.locationUnavailable;
  }

  return switch (error.failure) {
    LocationFailure.serviceDisabled => l10n.locationServiceDisabled,
    LocationFailure.permissionDenied => l10n.locationPermissionDenied,
    LocationFailure.permanentlyDenied => l10n.locationPermanentlyDenied,
    LocationFailure.unavailable => l10n.locationUnavailable,
  };
}

// ============================================================================
// MODERN CARD
// ============================================================================

class _ModernCard extends StatelessWidget {
  const _ModernCard({
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE0E0E0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.035),
            blurRadius: 18,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: child,
    );
  }
}

// ============================================================================
// STATUS BADGE
// ============================================================================

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.label, required this.status});

  final String label;
  final String status;

  @override
  Widget build(BuildContext context) {
    final isCompleted = status == 'completed' || status == 'delivered';

    final isCancelled = status == 'cancelled';

    final color = isCancelled
        ? const Color(0xFFDC2626)
        : isCompleted
        ? const Color(0xFF16A34A)
        : const Color(0xFFFA5F12);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 7),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// ROUTE POINT
// ============================================================================

class _RoutePoint extends StatelessWidget {
  const _RoutePoint({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 2),
        Icon(icon, color: const Color(0xFFFA5F12), size: 27),
        const SizedBox(height: 5),
        // Real stop names can be long; keep both ends and the car visible.
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 120),
          child: Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF1C1A1A),
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

// ============================================================================
// INFO ITEM
// ============================================================================

class _InfoItem extends StatelessWidget {
  const _InfoItem({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: const Color(0xFFFA5F12)),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(color: Color(0xFF707070), fontSize: 11),
              ),
              const SizedBox(height: 3),
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF1C1A1A),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ============================================================================
// LOCATION STATUS
// ============================================================================

class _LocationStatus extends StatelessWidget {
  const _LocationStatus({required this.isStale, required this.l10n});

  final bool isStale;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final color = isStale ? const Color(0xFFFA5F12) : const Color(0xFF16A34A);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Container(
          width: 9,
          height: 9,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(height: 5),
        Text(
          isStale ? l10n.locationIsStale : l10n.latestLocation,
          style: TextStyle(
            color: color,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
