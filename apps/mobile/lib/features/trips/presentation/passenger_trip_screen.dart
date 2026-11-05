import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:darb_mobile/features/trips/data/trip_models.dart';

import '../../../core/location/locate_device.dart';
import '../../../core/maps/darb_route_map.dart';
import '../../../core/maps/map_overlays.dart';
import '../../../core/maps/osrm_route_service.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_map.dart';
import '../../../core/widgets/state_views.dart';
import '../../checkpoints/application/checkpoint_controller.dart';
import '../../community_reports/application/community_reports_controller.dart';
import '../../incidents/presentation/report_incident_sheet.dart';
import '../application/passenger_trip_controller.dart';
import 'driver_call_card.dart';
import 'passenger_cancel_trip_section.dart';
import 'trip_rating_prompt.dart';

class PassengerTripScreen extends ConsumerStatefulWidget {
  const PassengerTripScreen({required this.tripId, super.key});

  final String tripId;

  @override
  ConsumerState<PassengerTripScreen> createState() =>
      _PassengerTripScreenState();
}

class _PassengerTripScreenState extends ConsumerState<PassengerTripScreen> {
  /// The device's own position once "my location" was tapped, and the camera
  /// request that centres the map on it.
  GeoPoint? _devicePosition;
  DarbMapFocus? _focus;

  Future<void> _centreOnDevice() async {
    final point = await locateDeviceForMap(context, ref);
    if (point == null || !mounted) return;
    setState(() {
      _devicePosition = point;
      _focus = DarbMapFocus(point, (_focus?.request ?? 0) + 1);
    });
  }

  // ============================================================
  // DARB DESIGN SYSTEM
  // ============================================================

  static const Color _orange = Color(0xFFFA5F12);
  static const Color _orangeDark = Color(0xFFC2410C);
  static const Color _orangeSoft = Color(0xFFFFE8DC);

  static const Color _background = Color(0xFFFFFFFF);
  static const Color _white = Colors.white;

  static const Color _text = Color(0xFF1C1A1A);
  static const Color _secondary = Color(0xFF707070);
  static const Color _muted = Color(0xFF707070);

  static const Color _line = Color(0xFFE0E0E0);

  static const Color _success = Color(0xFF3A7C07);
  static const Color _successSoft = Color(0xFFE8F2DF);

  static const Color _blue = Color(0xFF2F6690);

  // ============================================================
  // LIFECYCLE
  // ============================================================

  // ============================================================
  // ROUTE
  // ============================================================

  /// The trip's own points for the route line: the vehicle (or the trip's
  /// origin before a position is known) to the trip's destination.
  List<GeoPoint> _routeWaypoints(PassengerTripState data) {
    final trip = data.trip;

    if (!trip.hasRouteCoordinates) {
      return const [];
    }

    final startLat = data.location?.lat ?? trip.originLat!;
    final startLng = data.location?.lng ?? trip.originLng!;

    return [
      GeoPoint(startLat, startLng),
      GeoPoint(trip.destinationLat!, trip.destinationLng!),
    ];
  }

  // ============================================================
  // LOCALIZATION
  // ============================================================

  // Trips always carry their endpoint labels as stored; an empty one (a trip
  // without a driver route) falls back to the generic word.
  String _originCity(BuildContext context, PassengerTripState data) {
    final label = data.trip.originDisplayLabel;
    return label.trim().isEmpty ? AppLocalizations.of(context).origin : label;
  }

  String _destinationCity(BuildContext context, PassengerTripState data) {
    final label = data.trip.destinationDisplayLabel;
    return label.trim().isEmpty
        ? AppLocalizations.of(context).destination
        : label;
  }

  String _displayOrigin(BuildContext context, PassengerTripState data) =>
      _originCity(context, data);

  String _displayDestination(BuildContext context, PassengerTripState data) =>
      _destinationCity(context, data);

  // ============================================================
  // BUILD
  // ============================================================

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    final state = ref.watch(passengerTripControllerProvider(widget.tripId));

    // ==========================================================
    // CHECKPOINTS
    // ==========================================================

    final checkpoints = ref.watch(checkpointsProvider);

    final checkpointSnapshot = checkpoints.value ?? CheckpointSnapshot.empty;

    return ForegroundRefresh(
      refresh: () {
        // Other users' new reports reach this map while it is open; a slow
        // reports call never holds back the trip itself.
        final trip = ref
            .read(passengerTripControllerProvider(widget.tripId).notifier)
            .refresh();
        pollCommunityReports(ref);
        return trip;
      },
      child: Scaffold(
        backgroundColor: _background,
        body: state.when(
          loading: () => const Center(
            child: CircularProgressIndicator(color: _orange, strokeWidth: 2.5),
          ),
          error: (_, _) => _buildErrorState(context, l10n),
          data: (data) =>
              _buildImmersiveContent(context, l10n, data, checkpointSnapshot),
        ),
      ),
    );
  }

  // ============================================================
  // MAIN SCREEN
  // ============================================================

  Widget _buildImmersiveContent(
    BuildContext context,
    AppLocalizations l10n,
    PassengerTripState data,
    CheckpointSnapshot checkpointSnapshot,
  ) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Stack(
      fit: StackFit.expand,
      children: [
        // ======================================================
        // FULL SCREEN MAP
        // ======================================================
        Positioned.fill(
          child: _buildMap(context, l10n, data, checkpointSnapshot),
        ),

        // ======================================================
        // TOP CONTROLS
        // ======================================================
        Positioned(
          top: MediaQuery.of(context).padding.top + 10,
          left: 14,
          right: 14,
          child: Row(
            textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
            children: [
              _buildFloatingButton(
                icon: Icons.arrow_back_rounded,
                onPressed: () {
                  if (context.canPop()) {
                    context.pop();
                  } else {
                    context.go('/passenger');
                  }
                },
              ),
              const Spacer(),
              _buildLanguageButton(),
              const SizedBox(width: 8),
              _buildFloatingButton(
                key: const ValueKey('tripMyLocation'),
                icon: Icons.my_location_rounded,
                tooltip: l10n.mapMyLocation,
                onPressed: _centreOnDevice,
              ),
              const SizedBox(width: 8),
              _buildFloatingButton(
                icon: Icons.refresh_rounded,
                onPressed: () {
                  ref
                      .read(
                        passengerTripControllerProvider(widget.tripId).notifier,
                      )
                      .refresh();

                  ref.invalidate(checkpointsProvider);
                },
              ),
            ],
          ),
        ),

        // ======================================================
        // LIVE BADGE
        // ======================================================
        Positioned(
          top: MediaQuery.of(context).padding.top + 68,
          left: 14,
          right: 14,
          child: Row(
            children: [_buildLiveBadge(context, data), const Spacer()],
          ),
        ),

        // ======================================================
        // BOTTOM DRAGGABLE SHEET
        // ======================================================
        Positioned.fill(
          child: _buildBottomSheet(context, l10n, data, isArabic),
        ),
      ],
    );
  }

  // ============================================================
  // FLOATING BUTTON
  // ============================================================

  Widget _buildFloatingButton({
    Key? key,
    required IconData icon,
    required VoidCallback onPressed,
    String? tooltip,
  }) {
    final button = Material(
      key: key,
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: _white.withValues(alpha: 0.96),
            borderRadius: BorderRadius.circular(15),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.12),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Icon(icon, color: _text, size: 21),
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip, child: button);
  }

  // ============================================================
  // LANGUAGE BUTTON
  // ============================================================

  Widget _buildLanguageButton() {
    // Inside the shell the app bar already carries the language control, and the
    // switch renders nothing; skip its pill so no empty white sliver is left.
    if (ShellLanguageControl.isProvided(context)) {
      return const SizedBox.shrink();
    }
    return Container(
      height: 46,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: _white.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(15),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: const Center(child: LanguageSwitch()),
    );
  }

  // ============================================================
  // LIVE BADGE
  // ============================================================

  Widget _buildLiveBadge(BuildContext context, PassengerTripState data) {
    final status = data.trip.status.toLowerCase();

    final isActive =
        status == 'active' ||
        status == 'ongoing' ||
        status == 'pickup_started' ||
        status == 'in_transit' ||
        status == 'picked_up' ||
        status == 'delivered';

    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: _white.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(30),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.10),
            blurRadius: 16,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: isActive ? _success : _orange,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 7),
          Text(
            isActive
                ? AppLocalizations.of(context).tripInProgress
                : _statusLabel(AppLocalizations.of(context), data.trip.status),
            style: TextStyle(
              color: isActive ? _success : _orangeDark,
              fontSize: 11,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }

  // ============================================================
  // DRAGGABLE BOTTOM SHEET
  // ============================================================

  Widget _buildBottomSheet(
    BuildContext context,
    AppLocalizations l10n,
    PassengerTripState data,
    bool isArabic,
  ) {
    return DraggableScrollableSheet(
      initialChildSize: 0.29,
      minChildSize: 0.14,
      maxChildSize: 0.68,
      snap: true,
      snapSizes: const [0.29, 0.50, 0.68],
      expand: false,
      builder: (BuildContext context, ScrollController scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: _white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            boxShadow: [
              BoxShadow(
                color: Colors.black12,
                blurRadius: 24,
                offset: Offset(0, -8),
              ),
            ],
          ),
          child: SafeArea(
            top: false,
            child: ListView(
              controller: scrollController,
              physics: const ClampingScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 9, 16, 18),
              children: [
                const _BottomSheetHandle(),

                const SizedBox(height: 12),

                // ==================================================
                // ROUTE HEADER
                // ==================================================
                Row(
                  textDirection: isArabic
                      ? TextDirection.rtl
                      : TextDirection.ltr,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            data.trip.routeName(arabic: isArabic) ??
                                '${_displayOrigin(context, data)}  →  ${_displayDestination(context, data)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.start,
                            style: const TextStyle(
                              color: _text,
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -0.4,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            textDirection: isArabic
                                ? TextDirection.rtl
                                : TextDirection.ltr,
                            children: [
                              Icon(
                                Icons.circle,
                                size: 7,
                                color: data.hasLiveLocation
                                    ? _success
                                    : _orange,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                data.hasLiveLocation
                                    ? l10n.tripLiveTracking
                                    : l10n.tripWaitingForLocation,
                                style: TextStyle(
                                  color: data.hasLiveLocation
                                      ? _success
                                      : _orange,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    _buildStatusPill(context, data.trip.status),
                  ],
                ),

                const SizedBox(height: 12),

                // ==================================================
                // QUICK INFO
                // ==================================================
                Row(
                  children: [
                    Expanded(
                      child: _quickInfoItem(
                        icon: Icons.route_rounded,
                        value: _displayOrigin(context, data),
                        label: l10n.tripStartLabel,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _quickInfoItem(
                        icon: Icons.flag_rounded,
                        value: _displayDestination(context, data),
                        label: l10n.tripArrivalLabel,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      // Live only for a recent point; an older one says
                      // how long ago the driver was last seen.
                      child: _quickInfoItem(
                        key: const ValueKey('tripLocationQuickInfo'),
                        icon: Icons.location_on_rounded,
                        value: data.location == null
                            ? '--'
                            : data.hasLiveLocation
                            ? l10n.tripLive
                            : _lastSeen(l10n, data.location!),
                        label: l10n.tripLocationLabel,
                        iconColor: data.hasLiveLocation
                            ? _success
                            : data.location != null
                            ? _orange
                            : _muted,
                      ),
                    ),
                  ],
                ),

                // ==================================================
                // EXACT PLACES (requests booked on a route)
                // ==================================================
                if (data.trip.pickupSummary(arabic: _isArabic(context)) !=
                        null ||
                    data.trip.dropoffSummary(arabic: _isArabic(context)) !=
                        null) ...[
                  const SizedBox(height: 10),
                  _placeDetails(
                    key: const ValueKey('tripPlaceDetails'),
                    rows: [
                      if (data.trip.pickupSummary(arabic: _isArabic(context)) !=
                          null)
                        (
                          icon: Icons.trip_origin_rounded,
                          label: l10n.passengerPickupPoint,
                          value: data.trip.pickupSummary(
                            arabic: _isArabic(context),
                          )!,
                        ),
                      if (data.trip.dropoffSummary(
                            arabic: _isArabic(context),
                          ) !=
                          null)
                        (
                          icon: Icons.location_on_rounded,
                          label: l10n.passengerDropoffPoint,
                          value: data.trip.dropoffSummary(
                            arabic: _isArabic(context),
                          )!,
                        ),
                    ],
                  ),
                ],

                // ==================================================
                // DRIVER PHONE (only while the accepted trip runs)
                // ==================================================
                if (data.trip.driverPhone case final phone?) ...[
                  const SizedBox(height: 10),
                  DriverCallCard(
                    phone: phone,
                    accent: _orange,
                    background: _background,
                    border: _line,
                  ),
                ],

                const SizedBox(height: 10),

                // ==================================================
                // ETA
                // ==================================================
                _buildEtaCard(context, l10n, data),

                const SizedBox(height: 9),

                // ==================================================
                // CURRENT LOCATION
                // ==================================================
                _buildCurrentLocationCard(context, l10n, data),

                const SizedBox(height: 9),

                // ==================================================
                // REFRESH
                // ==================================================
                _buildRefreshButton(context, l10n),

                // Cancel before pickup, and why a cancelled trip was cancelled.
                PassengerCancelTripSection(trip: data.trip),

                if (data.trip.status.toLowerCase() == 'completed')
                  TripRatingPrompt(tripId: widget.tripId),

                ReportIncidentButton(tripId: widget.tripId),
              ],
            ),
          ),
        );
      },
    );
  }

  // ============================================================
  // PLACE DETAILS
  // ============================================================

  Widget _placeDetails({
    required Key key,
    required List<({IconData icon, String label, String value})> rows,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: _background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (index, row) in rows.indexed) ...[
            if (index > 0) const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(row.icon, size: 18, color: _orange),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        row.label,
                        style: const TextStyle(
                          color: _secondary,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        row.value,
                        style: const TextStyle(
                          color: _text,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // ============================================================
  // QUICK INFO ITEM
  // ============================================================

  /// "Seen N min ago" for a point too old to call live.
  String _lastSeen(AppLocalizations l10n, TripLocation location) {
    final age = location.ageAt(DateTime.now());
    return l10n.locationLastSeenMinutes(age.inMinutes < 1 ? 1 : age.inMinutes);
  }

  Widget _quickInfoItem({
    Key? key,
    required IconData icon,
    required String value,
    required String label,
    Color? iconColor,
  }) {
    return Container(
      key: key,
      height: 66,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: _background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _line),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 19, color: iconColor ?? _orange),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: _text,
              fontSize: 11,
              height: 1,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: _secondary,
              fontSize: 8,
              height: 1,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }

  // ============================================================
  // STATUS PILL
  // ============================================================

  Widget _buildStatusPill(BuildContext context, String status) {
    final color = _statusColor(status);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        _statusLabel(AppLocalizations.of(context), status),
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w900,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  // ============================================================
  // ETA CARD
  // ============================================================

  Widget _buildEtaCard(
    BuildContext context,
    AppLocalizations l10n,
    PassengerTripState data,
  ) {
    final road = watchRoadRoute(ref, _routeWaypoints(data));
    return Builder(
      builder: (context) {
        final route =
            road != null && road.routed && (road.durationSeconds ?? 0) > 0
            ? OsrmRouteResult(
                points: const [],
                durationSeconds: road.durationSeconds!,
                distanceMeters: road.distanceMeters ?? 0,
              )
            : null;

        final isArabic = Localizations.localeOf(context).languageCode == 'ar';

        if (route == null) {
          // No road route: no travel time is invented.
          return road == null
              ? _buildLoadingEta(context, isArabic)
              : const SizedBox.shrink();
        }

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(
            color: _orangeSoft,
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: _orange.withValues(alpha: 0.12)),
          ),
          child: Row(
            textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
            children: [
              Container(
                width: 35,
                height: 35,
                decoration: const BoxDecoration(
                  color: _white,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.access_time_rounded,
                  color: _orange,
                  size: 18,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.tripEstimatedArrival,
                      style: const TextStyle(
                        color: _secondary,
                        fontSize: 8,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      formatRouteDuration(l10n, route.durationMinutes),
                      style: const TextStyle(
                        color: _text,
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 1,
                height: 28,
                color: _orange.withValues(alpha: 0.16),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    l10n.tripDistance,
                    style: const TextStyle(
                      color: _secondary,
                      fontSize: 8,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    l10n.distanceKmValue(
                      route.distanceKilometers.toStringAsFixed(1),
                    ),
                    style: const TextStyle(
                      color: _text,
                      fontSize: 12,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  // ============================================================
  // ETA LOADING
  // ============================================================

  Widget _buildLoadingEta(BuildContext context, bool isArabic) {
    return Container(
      width: double.infinity,
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: _background,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: _line),
      ),
      child: Row(
        textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
        children: [
          const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2, color: _orange),
          ),
          const SizedBox(width: 10),
          Text(
            AppLocalizations.of(context).tripCalculatingRoute,
            style: const TextStyle(
              color: _secondary,
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  // ============================================================
  // CURRENT LOCATION
  // ============================================================

  Widget _buildCurrentLocationCard(
    BuildContext context,
    AppLocalizations l10n,
    PassengerTripState data,
  ) {
    final location = data.location;

    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: _background,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: _line),
      ),
      child: Row(
        textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
        children: [
          Container(
            width: 35,
            height: 35,
            decoration: BoxDecoration(
              color: location == null ? _white : _successSoft,
              shape: BoxShape.circle,
            ),
            child: Icon(
              location == null
                  ? Icons.location_searching_rounded
                  : Icons.location_on_rounded,
              color: location == null ? _muted : _success,
              size: 18,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.tripVehicleLocation,
                  style: const TextStyle(
                    color: _secondary,
                    fontSize: 8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  location == null
                      ? l10n.noLocationYet
                      : localizedLocationSource(l10n, location.source),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _text,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          // Only a recent point is live; an old one is the last known place.
          if (data.hasLiveLocation)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
              decoration: BoxDecoration(
                color: _successSoft,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text(
                l10n.tripLive,
                style: const TextStyle(
                  color: _success,
                  fontSize: 7,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ============================================================
  // REFRESH
  // ============================================================

  Widget _buildRefreshButton(BuildContext context, AppLocalizations l10n) {
    return SizedBox(
      width: double.infinity,
      height: 40,
      child: OutlinedButton.icon(
        onPressed: () {
          ref
              .read(passengerTripControllerProvider(widget.tripId).notifier)
              .refresh();

          ref.invalidate(checkpointsProvider);
        },
        icon: const Icon(Icons.refresh_rounded, size: 16),
        label: Text(
          l10n.tripRefreshLocation,
          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800),
        ),
        style: OutlinedButton.styleFrom(
          foregroundColor: _text,
          side: const BorderSide(color: _line),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(13),
          ),
        ),
      ),
    );
  }

  // ============================================================
  // MAP
  // ============================================================

  Widget _buildMap(
    BuildContext context,
    AppLocalizations l10n,
    PassengerTripState data,
    CheckpointSnapshot checkpointSnapshot,
  ) {
    final road = watchRoadRoute(ref, _routeWaypoints(data));
    final overlay = watchMapOverlay(ref, l10n);
    return Builder(
      builder: (context) {
        final trip = data.trip;

        final origin = trip.hasRouteCoordinates
            ? GeoPoint(trip.originLat!, trip.originLng!)
            : null;

        final destination = trip.hasRouteCoordinates
            ? GeoPoint(trip.destinationLat!, trip.destinationLng!)
            : null;

        return DarbMap(
          emptyLabel: l10n.noLocationYet,
          attributionLabel: l10n.mapAttribution,
          focus: _focus,

          banner: data.locationIsStale
              ? OfflineBanner(message: l10n.locationIsStale)
              : null,

          // Real roads when available; otherwise a dashed, labelled straight
          // line between the trip's own points.
          paths: roadRoutePaths(road, color: _orange, width: 7),
          notes: [...roadRouteNotes(l10n, road), ...overlay.notes],

          markers: [
            // ==========================================================
            // CHECKPOINT TRAFFIC MARKERS
            // ==========================================================
            //
            // Put checkpoints first so the trip's
            // origin/destination/current location stay
            // visually on top when markers overlap.
            //
            ...overlay.markers,

            // ==========================================================
            // ORIGIN
            // ==========================================================
            if (origin != null)
              DarbMapMarker(
                position: origin,
                icon: Icons.trip_origin_rounded,
                color: _orange,
                label: l10n.mapOriginLabel(_originCity(context, data)),
                size: 42,
              ),

            // ==========================================================
            // DESTINATION
            // ==========================================================
            if (destination != null)
              DarbMapMarker(
                position: destination,
                icon: Icons.flag_rounded,
                color: _orangeDark,
                label: l10n.mapDestinationLabel(
                  _destinationCity(context, data),
                ),
                size: 42,
                type: DarbMapMarkerType.destination,
              ),

            // ==========================================================
            // CURRENT LOCATION
            // ==========================================================
            if (data.location != null)
              DarbMapMarker(
                position: GeoPoint(data.location!.lat, data.location!.lng),
                icon: Icons.local_shipping_rounded,
                color: _orange,
                label: data.locationIsStale
                    ? '${localizedLocationSource(l10n, data.location!.source)}'
                          ' · ${_lastSeen(l10n, data.location!)}'
                    : localizedLocationSource(l10n, data.location!.source),
                size: 50,
                type: DarbMapMarkerType.driver,
              ),

            // ==========================================================
            // THIS DEVICE (after "my location")
            // ==========================================================
            if (_devicePosition case final device?)
              DarbMapMarker(
                position: device,
                icon: Icons.person_pin_circle_rounded,
                color: _blue,
                label: l10n.mapYouAreHere,
                size: 34,
                type: DarbMapMarkerType.location,
                fit: false,
              ),
          ],
        );
      },
    );
  }

  // ============================================================
  // ERROR STATE
  // ============================================================

  Widget _buildErrorState(BuildContext context, AppLocalizations l10n) {
    return Container(
      color: _background,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 76,
                height: 76,
                decoration: const BoxDecoration(
                  color: _orangeSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.cloud_off_rounded,
                  color: _orange,
                  size: 34,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                l10n.retry,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _text,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: 180,
                height: 46,
                child: ElevatedButton(
                  onPressed: () {
                    ref
                        .read(
                          passengerTripControllerProvider(
                            widget.tripId,
                          ).notifier,
                        )
                        .refresh();

                    ref.invalidate(checkpointsProvider);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _text,
                    foregroundColor: _white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: Text(
                    l10n.retry,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ============================================================
  // HELPERS
  // ============================================================

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'active':
      case 'ongoing':
      case 'in_transit':
      case 'picked_up':
        return _success;

      case 'completed':
        return _blue;

      default:
        return _orange;
    }
  }

  String _statusLabel(AppLocalizations l10n, String status) =>
      tripStatusLabel(l10n, status);
}

// ============================================================================
// BOTTOM SHEET HANDLE
// ============================================================================

class _BottomSheetHandle extends StatelessWidget {
  const _BottomSheetHandle();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 38,
        height: 4,
        decoration: BoxDecoration(
          color: _PassengerTripScreenState._line,
          borderRadius: BorderRadius.circular(10),
        ),
      ),
    );
  }
}

bool _isArabic(BuildContext context) =>
    Localizations.localeOf(context).languageCode == 'ar';
