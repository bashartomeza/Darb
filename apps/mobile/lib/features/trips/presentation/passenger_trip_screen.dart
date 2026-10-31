import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/maps/checkpoint_map_markers.dart';
import '../../../core/maps/osrm_route_service.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_map.dart';
import '../../../core/widgets/state_views.dart';
import '../../checkpoints/application/checkpoint_controller.dart';
import '../../incidents/presentation/report_incident_sheet.dart';
import '../application/passenger_trip_controller.dart';
import 'trip_rating_prompt.dart';

class PassengerTripScreen extends ConsumerStatefulWidget {
  const PassengerTripScreen({required this.tripId, super.key});

  final String tripId;

  @override
  ConsumerState<PassengerTripScreen> createState() =>
      _PassengerTripScreenState();
}

class _PassengerTripScreenState extends ConsumerState<PassengerTripScreen> {
  Future<OsrmRouteResult>? _routeFuture;
  String? _routeKey;

  // ============================================================
  // MASARI DESIGN SYSTEM
  // ============================================================

  static const Color _orange = Color(0xFFC66A3D);
  static const Color _orangeDark = Color(0xFF8A3F2A);
  static const Color _orangeSoft = Color(0xFFF2DED1);

  static const Color _background = Color(0xFFF9F5EE);
  static const Color _white = Colors.white;

  static const Color _text = Color(0xFF243129);
  static const Color _secondary = Color(0xFF5B625D);
  static const Color _muted = Color(0xFF8B867D);

  static const Color _line = Color(0xFFD7CEC1);

  static const Color _success = Color(0xFF2F4A3A);
  static const Color _successSoft = Color(0xFFE7EFE1);

  static const Color _blue = Color(0xFF7A8F5A);

  // ============================================================
  // LIFECYCLE
  // ============================================================

  // ============================================================
  // ROUTE
  // ============================================================

  Future<OsrmRouteResult> _loadRoute(
    double originLat,
    double originLng,
    double destinationLat,
    double destinationLng,
  ) async {
    try {
      final result = await const OsrmRouteService().getRoute(
        start: LatLng(originLat, originLng),
        end: LatLng(destinationLat, destinationLng),
      );

      if (result.points.length >= 2) {
        return result;
      }
    } catch (_) {
      // Keep the fallback route available if OSRM fails.
    }

    return const OsrmRouteResult(
      points: [],
      durationSeconds: 0,
      distanceMeters: 0,
    );
  }

  Future<OsrmRouteResult> _getRouteFuture(PassengerTripState data) {
    final trip = data.trip;

    if (!trip.hasRouteCoordinates) {
      return Future.value(
        const OsrmRouteResult(
          points: [],
          durationSeconds: 0,
          distanceMeters: 0,
        ),
      );
    }

    final startLat = data.location?.lat ?? trip.originLat!;
    final startLng = data.location?.lng ?? trip.originLng!;

    final destinationLat = trip.destinationLat!;
    final destinationLng = trip.destinationLng!;

    final key = '$startLat,$startLng|$destinationLat,$destinationLng';

    if (_routeFuture == null || _routeKey != key) {
      _routeKey = key;

      _routeFuture = _loadRoute(
        startLat,
        startLng,
        destinationLat,
        destinationLng,
      );
    }

    return _routeFuture!;
  }

  List<GeoPoint> _fallbackRoutePoints(PassengerTripState data) {
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

  String _originCity(PassengerTripState data) {
    final label = data.trip.originDisplayLabel;
    return label.trim().isEmpty ? 'Origin' : label;
  }

  String _destinationCity(PassengerTripState data) {
    final label = data.trip.destinationDisplayLabel;
    return label.trim().isEmpty ? 'Destination' : label;
  }

  String _localizedPlace(String value, String languageCode) {
    if (languageCode != 'ar') {
      return value;
    }

    final normalized = value.trim();

    const translations = {
      'Hebron': 'الخليل',
      'Bethlehem': 'بيت لحم',
      'Ramallah': 'رام الله',
      'Nablus': 'نابلس',
      'Jenin': 'جنين',
      'Tulkarm': 'طولكرم',
      'Qalqilya': 'قلقيلية',
      'Jericho': 'أريحا',
      'Jerusalem': 'القدس',
      'PPU': 'PPU',
      'Bab Al-Zawiya': 'باب الزاوية',
    };

    return translations[normalized] ?? normalized;
  }

  String _displayOrigin(BuildContext context, PassengerTripState data) {
    if (data.trip.originLabel != null) return _originCity(data);
    final language = Localizations.localeOf(context).languageCode;

    return _localizedPlace(_originCity(data), language);
  }

  String _displayDestination(BuildContext context, PassengerTripState data) {
    if (data.trip.destinationLabel != null) return _destinationCity(data);
    final language = Localizations.localeOf(context).languageCode;

    return _localizedPlace(_destinationCity(data), language);
  }

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
      refresh: () => ref
          .read(passengerTripControllerProvider(widget.tripId).notifier)
          .refresh(),
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
                icon: Icons.my_location_rounded,
                onPressed: () {
                  setState(() {});
                },
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
    required IconData icon,
    required VoidCallback onPressed,
  }) {
    return Material(
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
                ? (isArabic ? 'الرحلة جارية' : 'TRIP IN PROGRESS')
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
                        crossAxisAlignment: isArabic
                            ? CrossAxisAlignment.end
                            : CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${_displayOrigin(context, data)}  →  ${_displayDestination(context, data)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: isArabic
                                ? TextAlign.right
                                : TextAlign.left,
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
                              const Icon(
                                Icons.circle,
                                size: 7,
                                color: _success,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                data.location != null
                                    ? (isArabic
                                          ? 'تتبع مباشر'
                                          : 'Live tracking')
                                    : (isArabic
                                          ? 'بانتظار الموقع'
                                          : 'Waiting for location'),
                                style: TextStyle(
                                  color: data.location != null
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
                        label: isArabic ? 'البداية' : 'Origin',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _quickInfoItem(
                        icon: Icons.flag_rounded,
                        value: _displayDestination(context, data),
                        label: isArabic ? 'الوصول' : 'Destination',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _quickInfoItem(
                        icon: Icons.location_on_rounded,
                        value: data.location != null
                            ? (isArabic ? 'مباشر' : 'Live')
                            : '--',
                        label: isArabic ? 'الموقع' : 'Location',
                        iconColor: data.location != null ? _success : _muted,
                      ),
                    ),
                  ],
                ),

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
  // QUICK INFO ITEM
  // ============================================================

  Widget _quickInfoItem({
    required IconData icon,
    required String value,
    required String label,
    Color? iconColor,
  }) {
    return Container(
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
    return FutureBuilder<OsrmRouteResult>(
      future: _getRouteFuture(data),
      builder: (context, snapshot) {
        final route = snapshot.data;

        final isArabic = Localizations.localeOf(context).languageCode == 'ar';

        if (route == null || route.durationSeconds <= 0) {
          return _buildLoadingEta(context, isArabic);
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
                  crossAxisAlignment: isArabic
                      ? CrossAxisAlignment.end
                      : CrossAxisAlignment.start,
                  children: [
                    Text(
                      isArabic ? 'الوصول المتوقع' : 'Estimated arrival',
                      style: const TextStyle(
                        color: _secondary,
                        fontSize: 8,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      route.formattedDuration,
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
                crossAxisAlignment: isArabic
                    ? CrossAxisAlignment.start
                    : CrossAxisAlignment.end,
                children: [
                  Text(
                    isArabic ? 'المسافة' : 'Distance',
                    style: const TextStyle(
                      color: _secondary,
                      fontSize: 8,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${route.distanceKilometers.toStringAsFixed(1)} km',
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
            isArabic ? 'جاري حساب المسار...' : 'Calculating route...',
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
              crossAxisAlignment: isArabic
                  ? CrossAxisAlignment.end
                  : CrossAxisAlignment.start,
              children: [
                Text(
                  isArabic ? 'موقع المركبة' : 'Vehicle location',
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
          if (location != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
              decoration: BoxDecoration(
                color: _successSoft,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text(
                isArabic ? 'مباشر' : 'LIVE',
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
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

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
          isArabic ? 'تحديث الموقع' : l10n.refresh,
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
    return FutureBuilder<OsrmRouteResult>(
      future: _getRouteFuture(data),
      builder: (context, snapshot) {
        final routeResult = snapshot.data;

        final routedPoints = routeResult?.points
            .map((p) => GeoPoint(p.latitude, p.longitude))
            .toList(growable: false);

        final fallbackPoints = _fallbackRoutePoints(data);

        final pathPoints = routedPoints != null && routedPoints.length >= 2
            ? routedPoints
            : fallbackPoints;

        final trip = data.trip;

        final origin = trip.hasRouteCoordinates
            ? GeoPoint(trip.originLat!, trip.originLng!)
            : null;

        final destination = trip.hasRouteCoordinates
            ? GeoPoint(trip.destinationLat!, trip.destinationLng!)
            : null;

        return MasariMap(
          emptyLabel: l10n.noLocationYet,
          attributionLabel: l10n.mapAttribution,

          banner: data.locationIsStale
              ? OfflineBanner(message: l10n.locationIsStale)
              : null,

          paths: [
            if (pathPoints.length >= 2)
              MasariMapPath(points: pathPoints, color: _orange, width: 7),
          ],

          markers: [
            // ==========================================================
            // CHECKPOINT TRAFFIC MARKERS
            // ==========================================================
            //
            // Put checkpoints first so the trip's
            // origin/destination/current location stay
            // visually on top when markers overlap.
            //
            for (final checkpoint in checkpointSnapshot.checkpoints)
              if (_hasValidCheckpointPosition(checkpoint))
                checkpointTrafficMarker(checkpoint),

            // ==========================================================
            // ORIGIN
            // ==========================================================
            if (origin != null)
              MasariMapMarker(
                position: origin,
                icon: Icons.trip_origin_rounded,
                color: _orange,
                label: l10n.mapOriginLabel(_originCity(data)),
                size: 42,
              ),

            // ==========================================================
            // DESTINATION
            // ==========================================================
            if (destination != null)
              MasariMapMarker(
                position: destination,
                icon: Icons.flag_rounded,
                color: _orangeDark,
                label: l10n.mapDestinationLabel(_destinationCity(data)),
                size: 42,
                type: MasariMapMarkerType.destination,
              ),

            // ==========================================================
            // CURRENT LOCATION
            // ==========================================================
            if (data.location != null)
              MasariMapMarker(
                position: GeoPoint(data.location!.lat, data.location!.lng),
                icon: Icons.local_shipping_rounded,
                color: _orange,
                label: localizedLocationSource(l10n, data.location!.source),
                size: 50,
                type: MasariMapMarkerType.driver,
              ),
          ],
        );
      },
    );
  }

  // ============================================================
  // CHECKPOINT POSITION VALIDATION
  // ============================================================

  bool _hasValidCheckpointPosition(Checkpoint checkpoint) {
    final lat = checkpoint.position.latitude;
    final lng = checkpoint.position.longitude;

    // Prevent an unmapped checkpoint at (0, 0)
    // from moving the map viewport to Africa.
    if (lat == 0 && lng == 0) {
      return false;
    }

    if (!lat.isFinite || !lng.isFinite) {
      return false;
    }

    if (lat < -90 || lat > 90) {
      return false;
    }

    if (lng < -180 || lng > 180) {
      return false;
    }

    return true;
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

  String _statusLabel(AppLocalizations l10n, String status) {
    return status.toUpperCase();
  }
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
