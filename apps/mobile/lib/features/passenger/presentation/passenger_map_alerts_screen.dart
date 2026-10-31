import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/driver/presentation/driver_trip_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/location/location_service.dart';
import '../../../core/maps/osrm_route_service.dart';
import '../../../core/maps/checkpoint_map_markers.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/masari_map.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/state_views.dart';
import '../../checkpoints/application/checkpoint_controller.dart';
import '../../checkpoints/domain/checkpoint_models.dart';
import '../../checkpoints/presentation/checkpoint_sheet.dart';
import '../../checkpoint_directory/presentation/checkpoint_directory_screen.dart';
import '../../security/presentation/session_status_banner.dart';
import '../../trips/application/passenger_trip_controller.dart';
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
      backgroundColor: const Color(0xFFFFF8F4),
      appBar: _buildAppBar(context, l10n),
      body: SafeArea(
        child: view.when(
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
    const orange = Color(0xFFF97316);

    return AppBar(
      backgroundColor: navy,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: true,
      toolbarHeight: 76,
      leading: IconButton(
        tooltip: 'Back',
        icon: const Icon(Icons.arrow_back_rounded, size: 26),
        onPressed: () => context.go('/passenger'),
      ),
      title: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            l10n.navMapAlerts,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.4,
            ),
          ),
          const SizedBox(height: 7),
          Container(
            width: 34,
            height: 3,
            decoration: BoxDecoration(
              color: orange,
              borderRadius: BorderRadius.circular(10),
            ),
          ),
        ],
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
  static const Color _navy = Color(0xFF292524);
  static const Color _navyLight = Color(0xFFF97316);
  static const Color _orange = Color(0xFFF97316);
  static const Color _mutedText = Color(0xFF64748B);
  static const Color _border = Color(0xFFE2E8F0);

  Future<OsrmRouteResult>? _routeFuture;
  String? _routeKey;

  @override
  void initState() {
    super.initState();
    _loadRoute();
  }

  @override
  void didUpdateWidget(covariant _MapBody oldWidget) {
    super.didUpdateWidget(oldWidget);

    final oldRoute = oldWidget.view.route;
    final newRoute = widget.view.route;

    final oldStart = _routeStart(oldRoute);
    final oldEnd = _routeEnd(oldRoute);

    final newStart = _routeStart(newRoute);
    final newEnd = _routeEnd(newRoute);

    final routeChanged =
        oldStart?.latitude != newStart?.latitude ||
        oldStart?.longitude != newStart?.longitude ||
        oldEnd?.latitude != newEnd?.latitude ||
        oldEnd?.longitude != newEnd?.longitude;

    if (routeChanged) {
      _loadRoute();
    }
  }

  LatLng? _routeStart(CanonicalRoute? route) {
    if (route == null || route.path.length < 2) {
      return null;
    }

    final point = route.path.first;

    return LatLng(point.latitude, point.longitude);
  }

  LatLng? _routeEnd(CanonicalRoute? route) {
    if (route == null || route.path.length < 2) {
      return null;
    }

    final point = route.path.last;

    return LatLng(point.latitude, point.longitude);
  }

  /// Loads the original application route through OSRM.
  Future<void> _loadRoute() async {
    final route = widget.view.route;

    if (route == null || route.path.length < 2) {
      _routeFuture = Future.value(
        const OsrmRouteResult(
          points: [],
          durationSeconds: 0,
          distanceMeters: 0,
        ),
      );
      return;
    }

    final start = _routeStart(route);
    final end = _routeEnd(route);

    if (start == null || end == null) {
      _routeFuture = Future.value(
        const OsrmRouteResult(
          points: [],
          durationSeconds: 0,
          distanceMeters: 0,
        ),
      );
      return;
    }

    _routeKey =
        '${start.latitude},${start.longitude}|'
        '${end.latitude},${end.longitude}';

    _routeFuture = _loadOsrmRoute(start: start, end: end);
  }

  Future<OsrmRouteResult> _loadOsrmRoute({
    required LatLng start,
    required LatLng end,
  }) async {
    try {
      final result = await const OsrmRouteService().getRoute(
        start: start,
        end: end,
      );

      if (result.points.length >= 2) {
        return result;
      }
    } catch (_) {
      // Fall back to the original application route.
    }

    return const OsrmRouteResult(
      points: [],
      durationSeconds: 0,
      distanceMeters: 0,
    );
  }

  /// Creates a fallback route from the application's route definition.
  List<GeoPoint> _fallbackRoutePoints(CanonicalRoute? route) {
    if (route == null || route.path.length < 2) {
      return const [];
    }

    return route.path
        .map((point) => GeoPoint(point.latitude, point.longitude))
        .toList(growable: false);
  }

  /// Same driver -> destination route logic used by PassengerTripScreen.
  Future<OsrmRouteResult> _loadDriverRoute(
    double driverLat,
    double driverLng,
    double destinationLat,
    double destinationLng,
  ) async {
    try {
      final result = await const OsrmRouteService().getRoute(
        start: LatLng(driverLat, driverLng),
        end: LatLng(destinationLat, destinationLng),
      );

      if (result.points.length >= 2) {
        return result;
      }
    } catch (_) {
      // Fall back to a direct driver -> destination line.
    }

    return const OsrmRouteResult(
      points: [],
      durationSeconds: 0,
      distanceMeters: 0,
    );
  }

  /// Builds the route:
  ///
  /// Driver location -> destination when driver location exists.
  /// Otherwise original trip route.
  Future<OsrmRouteResult> _buildRouteFuture({
    required CanonicalRoute? route,
    required dynamic driverLocation,
  }) async {
    if (route == null || route.path.length < 2) {
      return _routeFuture ??
          const OsrmRouteResult(
            points: [],
            durationSeconds: 0,
            distanceMeters: 0,
          );
    }

    final destination = _routeEnd(route);

    if (destination == null) {
      return const OsrmRouteResult(
        points: [],
        durationSeconds: 0,
        distanceMeters: 0,
      );
    }

    // Driver -> destination.
    if (driverLocation != null) {
      final key =
          '${driverLocation.lat},'
          '${driverLocation.lng}|'
          '${destination.latitude},'
          '${destination.longitude}';

      if (_routeFuture == null || _routeKey != key) {
        _routeKey = key;

        _routeFuture = _loadDriverRoute(
          driverLocation.lat,
          driverLocation.lng,
          destination.latitude,
          destination.longitude,
        );
      }

      return _routeFuture!;
    }

    // Original route.
    if (_routeFuture == null) {
      await _loadRoute();
    }

    return _routeFuture ??
        const OsrmRouteResult(
          points: [],
          durationSeconds: 0,
          distanceMeters: 0,
        );
  }

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

    final checkpointSnapshot = checkpoints.value ?? CheckpointSnapshot.empty;

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

    final fallbackRoutePoints = _fallbackRoutePoints(route);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(passengerMapViewProvider);

        await ref.read(checkpointsProvider.notifier).refresh();

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
            checkpointSnapshot: checkpointSnapshot,
            fallbackRoutePoints: fallbackRoutePoints,
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

          MasariSection(
            title: l10n.checkpoints,
            child: _CheckpointsPanel(
              available: true,
              state: checkpoints,
              arabic: arabic,
            ),
          ),
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
              const _RoutePoint(
                icon: Icons.trip_origin_rounded,
                label: 'Hebron',
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
              const _RoutePoint(icon: Icons.flag_rounded, label: 'Bethlehem'),
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
    required dynamic driverLocation,
    required AsyncValue<dynamic> position,
    required CheckpointSnapshot checkpointSnapshot,
    required List<GeoPoint> fallbackRoutePoints,
    required bool arabic,
    required String Function(CanonicalStop) stopName,
  }) {
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
            child: FutureBuilder<OsrmRouteResult>(
              future: _buildRouteFuture(
                route: route,
                driverLocation: driverLocation,
              ),
              builder: (context, routeSnapshot) {
                final routeResult = routeSnapshot.data;

                final routedPoints = routeResult?.points
                    .map((point) => GeoPoint(point.latitude, point.longitude))
                    .toList(growable: false);

                final pathPoints =
                    routedPoints != null && routedPoints.length >= 2
                    ? routedPoints
                    : fallbackRoutePoints;

                final origin = route != null && route.path.isNotEmpty
                    ? GeoPoint(
                        route.path.first.latitude,
                        route.path.first.longitude,
                      )
                    : null;

                final destination = route != null && route.path.isNotEmpty
                    ? GeoPoint(
                        route.path.last.latitude,
                        route.path.last.longitude,
                      )
                    : null;

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    MasariMap(
                      emptyLabel: route == null
                          ? l10n.mapSelectRoute
                          : l10n.noLocationYet,
                      attributionLabel: l10n.mapAttribution,
                      height: 390,

                      banner: checkpointSnapshot.stale
                          ? Text(l10n.checkpointsStale)
                          : null,

                      paths: [
                        if (pathPoints.length >= 2)
                          MasariMapPath(
                            points: pathPoints,
                            color: _navyLight,
                            width: 6,
                          ),
                      ],

                      markers: [
                        // --------------------------------------------------
                        // ORIGINAL START
                        // --------------------------------------------------
                        if (origin != null)
                          MasariMapMarker(
                            position: origin,
                            icon: Icons.trip_origin_rounded,
                            color: SemanticColors.upcomingRoute,
                            label: l10n.mapOriginLabel('Hebron'),
                            size: 42,
                          ),

                        // --------------------------------------------------
                        // DESTINATION
                        // --------------------------------------------------
                        if (destination != null)
                          MasariMapMarker(
                            position: destination,
                            icon: Icons.flag_rounded,
                            color: SemanticColors.completedRoute,
                            label: l10n.mapDestinationLabel('Bethlehem'),
                            size: 42,
                          ),

                        // --------------------------------------------------
                        // PASSENGER CURRENT LOCATION
                        // --------------------------------------------------
                        if (position.value != null)
                          MasariMapMarker(
                            position: GeoPoint(
                              position.value!.latitude,
                              position.value!.longitude,
                            ),
                            icon: Icons.my_location_rounded,
                            color: SemanticColors.passenger,
                            label: l10n.mapYourLocation,
                            size: 40,
                          ),

                        // --------------------------------------------------
                        // CURRENT DRIVER LOCATION
                        // --------------------------------------------------
                        if (driverLocation != null)
                          MasariMapMarker(
                            position: GeoPoint(
                              driverLocation.lat,
                              driverLocation.lng,
                            ),
                            icon: Icons.local_shipping_rounded,
                            color: _orange,
                            label:
                                '${l10n.latestLocation} — '
                                '${l10n.recordedTime}: '
                                '${driverLocation.recordedAt}',
                            size: 50,
                          ),

                        // --------------------------------------------------
                        // ROUTE STOPS
                        // --------------------------------------------------
                        if (route != null)
                          for (final stop in route.stops)
                            if (stop.position != null)
                              _stopMarker(l10n, stop, stopName(stop), route),

                        // --------------------------------------------------
                        for (final checkpoint in checkpointSnapshot.checkpoints)
                          checkpointTrafficMarker(checkpoint),
                        // CHECKPOINTS
                        //
                        // Invalid or absent coordinates are omitted at parsing.
                        // --------------------------------------------------
                      ],
                    ),

                    // --------------------------------------------------------
                    // REMAINING ROUTE INFORMATION
                    // --------------------------------------------------------
                    if (routeResult != null &&
                        routeResult.durationSeconds > 0) ...[
                      const SizedBox(height: 8),
                      Container(
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
                                '${routeResult.formattedDuration}',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Text(
                              '${routeResult.distanceKilometers.toStringAsFixed(1)} km',
                              style: const TextStyle(
                                color: Colors.white70,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 8),

                    // --------------------------------------------------------
                    // MAP HELP
                    // --------------------------------------------------------
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
                            color: Theme.of(
                              context,
                            ).colorScheme.onSurfaceVariant,
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
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  MasariMapMarker _stopMarker(
    AppLocalizations l10n,
    CanonicalStop stop,
    String name,
    CanonicalRoute route,
  ) {
    final isOrigin = stop.id == route.originStop?.id;

    final isDestination = stop.id == route.destinationStop?.id;

    return MasariMapMarker(
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

    return MasariCard(
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

    return MasariCard(
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
// ROAD REPORTS
// ============================================================================

class _RoadReport {
  const _RoadReport({
    required this.category,
    required this.issue,
    required this.location,
    required this.details,
    required this.createdAt,
  });

  final String category;
  final String issue;
  final String location;
  final String details;
  final DateTime createdAt;
}

/// Reports UI. The current project screen has no report submission provider/API,
/// so newly created reports are kept in this widget's state only. Connect this
/// panel to the reports repository/provider when the backend endpoint exists.
class _ReportsPanel extends StatefulWidget {
  const _ReportsPanel();

  @override
  State<_ReportsPanel> createState() => _ReportsPanelState();
}

class _ReportsPanelState extends State<_ReportsPanel> {
  static const _orange = Color(0xFFF97316);
  static const _ink = Color(0xFF292524);
  static const _muted = Color(0xFF78716C);
  static const _border = Color(0xFFF0E4DB);
  final List<_RoadReport> _reports = [];

  Future<void> _createReport() async {
    final report = await showModalBottomSheet<_RoadReport>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _CreateRoadReportSheet(),
    );

    if (!mounted || report == null) return;
    setState(() => _reports.insert(0, report));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('تمت إضافة البلاغ للعرض في هذه الجلسة.'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: _border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 16,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF0E5),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.campaign_rounded,
                  color: _orange,
                  size: 25,
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'ساهم في تحديث حالة الطريق',
                      style: TextStyle(
                        color: _ink,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'أبلغ الركاب عن مشكلة قد تؤثر على رحلتهم',
                      style: TextStyle(
                        color: _muted,
                        fontSize: 11.5,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 48,
            child: FilledButton.icon(
              onPressed: _createReport,
              style: FilledButton.styleFrom(
                backgroundColor: _orange,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
                textStyle: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                ),
              ),
              icon: const Icon(Icons.add_rounded, size: 21),
              label: const Text('إضافة بلاغ جديد'),
            ),
          ),
          const SizedBox(height: 15),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'البلاغات الأخيرة',
                  style: TextStyle(
                    color: _ink,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF0E5),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${_reports.length} بلاغ',
                  style: const TextStyle(
                    color: _orange,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (_reports.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 18),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFAF7),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: _border),
              ),
              child: const Column(
                children: [
                  Icon(
                    Icons.mark_chat_unread_outlined,
                    color: Color(0xFFB8A69A),
                    size: 28,
                  ),
                  SizedBox(height: 8),
                  Text(
                    'ما في بلاغات مضافة لحد الآن',
                    style: TextStyle(
                      color: _ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'إذا لاحظت مشكلة بالطريق، أضف بلاغًا ليساعد الركاب الآخرين.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: _muted, fontSize: 11, height: 1.5),
                  ),
                ],
              ),
            )
          else
            ..._reports
                .take(5)
                .map(
                  (report) => Padding(
                    padding: const EdgeInsets.only(bottom: 9),
                    child: _RoadReportTile(report: report),
                  ),
                ),
          const SizedBox(height: 4),
          const Text(
            'ملاحظة: البلاغات المضافة هنا تجريبية ومحفوظة مؤقتًا على الشاشة فقط.',
            style: TextStyle(color: _muted, fontSize: 10, height: 1.4),
          ),
        ],
      ),
    );
  }
}

class _RoadReportTile extends StatelessWidget {
  const _RoadReportTile({required this.report});

  final _RoadReport report;

  @override
  Widget build(BuildContext context) {
    const orange = Color(0xFFF97316);
    const ink = Color(0xFF292524);
    const muted = Color(0xFF78716C);
    final icon = switch (report.category) {
      'الحواجز' => Icons.shield_outlined,
      'الرحلة والمواصلات' => Icons.directions_bus_rounded,
      'السلامة' => Icons.warning_amber_rounded,
      _ => Icons.traffic_rounded,
    };

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: const Color(0xFFF0E4DB)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: const Color(0xFFFFF0E5),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: orange, size: 20),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  report.issue,
                  style: const TextStyle(
                    color: ink,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                if (report.location.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(
                        Icons.location_on_outlined,
                        size: 13,
                        color: muted,
                      ),
                      const SizedBox(width: 3),
                      Expanded(
                        child: Text(
                          report.location,
                          style: const TextStyle(color: muted, fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ],
                if (report.details.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Text(
                    report.details,
                    style: const TextStyle(
                      color: muted,
                      fontSize: 11.5,
                      height: 1.4,
                    ),
                  ),
                ],
                const SizedBox(height: 7),
                Row(
                  children: [
                    Text(
                      report.category,
                      style: const TextStyle(
                        color: orange,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Text(
                      '• بانتظار التحقق',
                      style: TextStyle(color: muted, fontSize: 10.5),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CreateRoadReportSheet extends StatefulWidget {
  const _CreateRoadReportSheet();

  @override
  State<_CreateRoadReportSheet> createState() => _CreateRoadReportSheetState();
}

class _CreateRoadReportSheetState extends State<_CreateRoadReportSheet> {
  static const _orange = Color(0xFFF97316);
  static const _ink = Color(0xFF292524);
  static const _muted = Color(0xFF78716C);
  static const _categories = <String>[
    'الطريق',
    'الحواجز',
    'الرحلة والمواصلات',
    'السلامة',
  ];
  static const Map<String, List<String>> _issues = {
    'الطريق': [
      'ازدحام شديد',
      'حادث على الطريق',
      'إغلاق طريق',
      'أعمال صيانة',
      'عائق على الطريق',
    ],
    'الحواجز': [
      'تغيّر حالة الحاجز',
      'انتظار طويل',
      'الحاجز مغلق',
      'معلومات الحاجز غير دقيقة',
    ],
    'الرحلة والمواصلات': [
      'تأخر المركبة',
      'السائق لم يصل',
      'مشكلة في نقطة الالتقاء',
      'اختلاف مسار الرحلة',
    ],
    'السلامة': [
      'خطر على الطريق',
      'عائق يهدد السلامة',
      'حالة طارئة أثناء الرحلة',
    ],
  };

  final _locationController = TextEditingController();
  final _detailsController = TextEditingController();
  String _category = _categories.first;
  String _issue = _issues[_categories.first]!.first;

  @override
  void dispose() {
    _locationController.dispose();
    _detailsController.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.of(context).pop(
      _RoadReport(
        category: _category,
        issue: _issue,
        location: _locationController.text.trim(),
        details: _detailsController.text.trim(),
        createdAt: DateTime.now(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 22),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE7DDD6),
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                'إضافة بلاغ جديد',
                style: TextStyle(
                  color: _ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'اختاري نوع المشكلة وأضيفي التفاصيل المتوفرة.',
                style: TextStyle(color: _muted, fontSize: 12, height: 1.5),
              ),
              const SizedBox(height: 20),
              const Text(
                'تصنيف البلاغ',
                style: TextStyle(
                  color: _ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _categories.map((category) {
                  final selected = _category == category;
                  return ChoiceChip(
                    label: Text(category),
                    selected: selected,
                    showCheckmark: false,
                    selectedColor: const Color(0xFFFFE8D8),
                    backgroundColor: const Color(0xFFFFFAF7),
                    side: BorderSide(
                      color: selected ? _orange : const Color(0xFFEDE2DA),
                    ),
                    labelStyle: TextStyle(
                      color: selected ? _orange : _ink,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                    ),
                    onSelected: (_) => setState(() {
                      _category = category;
                      _issue = _issues[category]!.first;
                    }),
                  );
                }).toList(),
              ),
              const SizedBox(height: 17),
              const Text(
                'ما المشكلة؟',
                style: TextStyle(
                  color: _ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _issue,
                isExpanded: true,
                decoration: InputDecoration(
                  filled: true,
                  fillColor: const Color(0xFFFFFAF7),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 13,
                    vertical: 13,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xFFEDE2DA)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xFFEDE2DA)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: _orange, width: 1.5),
                  ),
                ),
                items: _issues[_category]!
                    .map(
                      (issue) => DropdownMenuItem(
                        value: issue,
                        child: Text(
                          issue,
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null) setState(() => _issue = value);
                },
              ),
              const SizedBox(height: 17),
              const Text(
                'الموقع أو اسم المنطقة (اختياري)',
                style: TextStyle(
                  color: _ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _locationController,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(
                  hintText: 'مثال: مدخل الخليل أو شارع الجامعة',
                  hintStyle: const TextStyle(
                    fontSize: 11.5,
                    color: Color(0xFFB2A39A),
                  ),
                  prefixIcon: const Icon(
                    Icons.location_on_outlined,
                    color: _orange,
                    size: 20,
                  ),
                  filled: true,
                  fillColor: const Color(0xFFFFFAF7),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xFFEDE2DA)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xFFEDE2DA)),
                  ),
                ),
              ),
              const SizedBox(height: 17),
              const Text(
                'تفاصيل إضافية (اختياري)',
                style: TextStyle(
                  color: _ink,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _detailsController,
                minLines: 2,
                maxLines: 4,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  hintText:
                      'اكتبي وصفًا مختصرًا يساعد الآخرين على فهم الحالة...',
                  hintStyle: const TextStyle(
                    fontSize: 11.5,
                    color: Color(0xFFB2A39A),
                  ),
                  alignLabelWithHint: true,
                  filled: true,
                  fillColor: const Color(0xFFFFFAF7),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xFFEDE2DA)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xFFEDE2DA)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: _orange, width: 1.5),
                  ),
                ),
              ),
              const SizedBox(height: 21),
              SizedBox(
                height: 49,
                child: FilledButton.icon(
                  onPressed: _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: _orange,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                  icon: const Icon(Icons.send_rounded, size: 18),
                  label: const Text(
                    'إضافة البلاغ',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'لا تضيفي معلومات شخصية أو تفاصيل حساسة.',
                textAlign: TextAlign.center,
                style: TextStyle(color: _muted, fontSize: 10.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================================================================
// CHECKPOINTS — GROUPED BY CITY
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

  static const _navy = Color(0xFF102A43);
  static const _orange = Color(0xFFF97316);
  static const _orangeSoft = Color(0xFFFFF3EA);
  static const _textMuted = Color(0xFF64748B);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);

    if (!available) {
      return MasariInfoCard(
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
          return MasariInfoCard(
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
            border: Border.all(color: const Color(0xFFE9E2DE)),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF3EA),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.location_city_rounded,
                  color: Color(0xFFF97316),
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
                        color: Color(0xFF102A43),
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
                            color: Color(0xFF64748B),
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
                color: const Color(0xFF94A3B8),
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
        border: Border.all(color: const Color(0xFFE9E2DE)),
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
                  color: const Color(0xFFFFF3EA),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.local_police_rounded,
                  color: Color(0xFFF97316),
                  size: 21,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  name,
                  style: const TextStyle(
                    color: Color(0xFF102A43),
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
                  color: Color(0xFF64748B),
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
              color: Color(0xFF64748B),
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
        color: Color(0xFF64748B),
        background: Color(0xFFF8FAFC),
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
      color: const Color(0xFFCBD5E1),
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
        border: Border.all(color: const Color(0xFFE2E8F0)),
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
        : const Color(0xFFF97316);

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
        Icon(icon, color: const Color(0xFFF97316), size: 27),
        const SizedBox(height: 5),
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF102A43),
            fontSize: 12,
            fontWeight: FontWeight.w800,
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
        Icon(icon, size: 18, color: const Color(0xFFF97316)),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
              ),
              const SizedBox(height: 3),
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF102A43),
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
    final color = isStale ? const Color(0xFFF97316) : const Color(0xFF16A34A);

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
