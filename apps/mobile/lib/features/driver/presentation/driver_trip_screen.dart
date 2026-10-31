import '../../delivery_handover/delivery_handover_strings.dart';
import '../../delivery_handover/presentation/receiver_confirmation_dialog.dart';
import '../../../core/widgets/foreground_refresh.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/maps/checkpoint_map_markers.dart';
import 'package:latlong2/latlong.dart';
import 'package:masari_mobile/core/widgets/masari_section.dart';
import 'package:masari_mobile/core/widgets/state_views.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import '../../../core/widgets/status_chip.dart';
import 'package:masari_mobile/features/driver/presentation/driver_ui.dart';
import 'package:masari_mobile/features/trips/data/trip_models.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/maps/osrm_route_service.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_map.dart';
import '../../checkpoints/application/checkpoint_controller.dart';
import '../../checkpoints/domain/checkpoint_models.dart';
import '../../checkpoints/presentation/checkpoint_sheet.dart';
import '../../checkpoint_directory/presentation/checkpoint_directory_screen.dart';
import '../../incidents/presentation/report_incident_sheet.dart';
import '../application/driver_controller.dart';
import '../data/driver_models.dart';

// ============================================================
// MASARI DRIVER MAP COLORS
// ============================================================

const Color navy = Color(0xFF2F4A3A);
const Color orange = Color(0xFFC66A3D);
const Color orangeDark = Color(0xFF8A3F2A);
const Color orangeSoft = Color(0xFFF2DED1);

const Color success = Color(0xFF2F4A3A);
const Color successSoft = Color(0xFFE7EFE1);

const Color warning = Color(0xFFA36B22);
const Color error = Color(0xFF8A3F2A);

const Color white = Color(0xFFFFFFFF);
const Color background = Color(0xFFF9F5EE);

const Color textDark = Color(0xFF243129);
const Color textSecondary = Color(0xFF5B625D);
const Color textMuted = Color(0xFF8B867D);

const Color border = Color(0xFFD7CEC1);
const Color driverBlue = Color(0xFF7A8F5A);

// ============================================================
// DRIVER TRIP SCREEN
// ============================================================

class DriverTripScreen extends ConsumerStatefulWidget {
  const DriverTripScreen({
    required this.tripId,
    this.showAppBar = true,
    super.key,
  });

  final String tripId;
  final bool showAppBar;

  @override
  ConsumerState<DriverTripScreen> createState() => _DriverTripScreenState();
}

class _DriverTripScreenState extends ConsumerState<DriverTripScreen> {
  String? _error;

  // ============================================================
  // LIFECYCLE
  // ============================================================

  // ============================================================
  // BUILD
  // ============================================================

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    final tripState = ref.watch(driverTripControllerProvider(widget.tripId));

    return ForegroundRefresh(
      refresh: () => ref
          .read(driverTripControllerProvider(widget.tripId).notifier)
          .refresh(),
      child: Scaffold(
        key: const ValueKey('driverTrip'),
        backgroundColor: background,
        body: tripState.when(
          loading: () => const Center(
            child: CircularProgressIndicator(color: orange, strokeWidth: 2.5),
          ),
          error: (error, _) => _buildErrorState(context, l10n),
          data: (state) => _buildImmersiveContent(context, l10n, state),
        ),
      ),
    );
  }

  // ============================================================
  // MAIN IMMERSIVE CONTENT
  // ============================================================

  Widget _buildImmersiveContent(
    BuildContext context,
    AppLocalizations l10n,
    DriverTripState state,
  ) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    final checkpoints = ref.watch(checkpointsProvider);

    final checkpointSnapshot = checkpoints.value ?? CheckpointSnapshot.empty;

    return Stack(
      fit: StackFit.expand,
      children: [
        // ========================================================
        // FULL SCREEN MAP
        // ========================================================
        Positioned.fill(
          child: _DriverMapSection(
            l10n: l10n,
            trip: state.trip,
            location: state.location,
            snapshot: checkpointSnapshot,
            checkpointsLoading: checkpoints.isLoading,
            checkpointsError: checkpoints.hasError,
          ),
        ),

        // ========================================================
        // TOP CONTROLS
        // ========================================================
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
                    context.go('/driver');
                  }
                },
              ),

              const Spacer(),

              _buildLanguageButton(),
              const CheckpointDirectoryAction(),

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
                        driverTripControllerProvider(widget.tripId).notifier,
                      )
                      .refresh();

                  ref.read(checkpointsProvider.notifier).refresh();
                },
              ),
            ],
          ),
        ),

        // ========================================================
        // LIVE BADGE
        // ========================================================
        Positioned(
          top: MediaQuery.of(context).padding.top + 68,
          left: 14,
          right: 14,
          child: Row(
            children: [_buildLiveBadge(context, state), const Spacer()],
          ),
        ),

        // ========================================================
        // ERROR
        // ========================================================
        if (_error != null)
          Positioned(
            top: MediaQuery.of(context).padding.top + 122,
            left: 14,
            right: 14,
            child: OfflineBanner(message: _error!, tone: BannerTone.error),
          ),

        // ========================================================
        // BOTTOM INFO PANEL
        // ========================================================
        Positioned.fill(
          child: _buildBottomSheet(
            context,
            l10n,
            state,
            checkpointSnapshot,
            checkpoints.isLoading,
            checkpoints.hasError,
            isArabic,
          ),
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
            color: white.withValues(alpha: 0.96),
            borderRadius: BorderRadius.circular(15),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.12),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Icon(icon, color: textDark, size: 21),
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
        color: white.withValues(alpha: 0.96),
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

  Widget _buildLiveBadge(BuildContext context, DriverTripState state) {
    final status = state.trip.status.toLowerCase();

    final isActive =
        status == 'active' ||
        status == 'ongoing' ||
        status == 'in_transit' ||
        status == 'picked_up';

    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: white.withValues(alpha: 0.95),
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
              color: isActive ? success : orange,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 7),
          Text(
            isActive
                ? (isArabic ? 'الرحلة جارية' : 'TRIP IN PROGRESS')
                : driverStatusLabel(
                    AppLocalizations.of(context),
                    state.trip.status,
                  ),
            style: TextStyle(
              color: isActive ? success : orangeDark,
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
  // BOTTOM SHEET
  // ============================================================

  Widget _buildBottomSheet(
    BuildContext context,
    AppLocalizations l10n,
    DriverTripState state,
    CheckpointSnapshot checkpointSnapshot,
    bool checkpointsLoading,
    bool checkpointsError,
    bool isArabic,
  ) {
    final trip = state.trip;
    final location = state.location;

    return DraggableScrollableSheet(
      initialChildSize: 0.29,
      minChildSize: 0.14,
      maxChildSize: 0.68,
      snap: true,
      snapSizes: const [0.29, 0.50, 0.68],
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: white,
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
                // ==================================================
                // DRAG HANDLE
                // ==================================================
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
                            '${localizedOrigin(context, trip.mapOriginLabel)}  →  ${trip.mapDestinationLabel}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: isArabic
                                ? TextAlign.right
                                : TextAlign.left,
                            style: const TextStyle(
                              color: textDark,
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
                                color: location != null ? success : orange,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                location != null
                                    ? (isArabic
                                          ? 'تتبع مباشر'
                                          : 'Live tracking')
                                    : (isArabic
                                          ? 'بانتظار الموقع'
                                          : 'Waiting for location'),
                                style: TextStyle(
                                  color: location != null ? success : orange,
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
                    _buildStatusPill(context, trip.status),
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
                        icon: Icons.people_alt_rounded,
                        value: '${trip.passengerRequest?.passengerCount ?? 0}',
                        label: l10n.passengerCount,
                      ),
                    ),

                    // Parcel card is intentionally hidden when the
                    // trip has no parcels.
                    if ((trip.merchantOrder?.parcelCount ?? 0) > 0) ...[
                      const SizedBox(width: 8),
                      Expanded(
                        child: _quickInfoItem(
                          icon: Icons.inventory_2_rounded,
                          value: '${trip.merchantOrder?.parcelCount ?? 0}',
                          label: l10n.parcelCount,
                        ),
                      ),
                    ],

                    const SizedBox(width: 8),

                    Expanded(
                      child: _quickInfoItem(
                        icon: Icons.traffic_rounded,
                        value: '${checkpointSnapshot.checkpoints.length}',
                        label: l10n.checkpoints,
                        onTap: () {
                          _showCheckpointCities(
                            context,
                            l10n,
                            checkpointSnapshot,
                            checkpointsLoading,
                            checkpointsError,
                          );
                        },
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 10),

                _buildEtaCard(context, state),

                const SizedBox(height: 9),

                _buildCurrentLocationCard(context, l10n, location),

                const SizedBox(height: 9),

                _buildTripActions(context, l10n, state),

                ReportIncidentButton(tripId: widget.tripId),
              ],
            ),
          ),
        );
      },
    );
  }

  // ============================================================
  // STATUS PILL
  // ============================================================

  Widget _buildStatusPill(BuildContext context, String status) {
    final tone = statusToneFor(status);

    final color = switch (tone) {
      StatusTone.success => SemanticColors.success,
      StatusTone.warning => SemanticColors.warning,
      StatusTone.error => SemanticColors.error,
      _ => Theme.of(context).colorScheme.primary,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        driverStatusLabel(AppLocalizations.of(context), status),
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
  // QUICK INFO ITEM
  // ============================================================
  Widget _quickInfoItem({
    required IconData icon,
    required String value,
    required String label,
    VoidCallback? onTap,
  }) {
    final content = Container(
      constraints: const BoxConstraints(minHeight: 72),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: onTap != null ? orangeSoft.withValues(alpha: 0.45) : background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: onTap != null ? orange.withValues(alpha: 0.15) : border,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 20, color: orange),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: textDark,
              fontSize: 17,
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
              color: textSecondary,
              fontSize: 9,
              height: 1,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );

    // إذا ما في onTap، رجّعي الـcontent مباشرة
    if (onTap == null) {
      return content;
    }

    // إذا في onTap، خلي الكرت قابل للضغط
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: content,
      ),
    );
  }
  // ============================================================
  // CHECKPOINT CITIES
  // ============================================================

  Future<void> _showCheckpointCities(
    BuildContext context,
    AppLocalizations l10n,
    CheckpointSnapshot snapshot,
    bool loading,
    bool hasError,
  ) async {
    if (loading) {
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        builder: (_) => const SafeArea(
          child: Padding(
            padding: EdgeInsets.all(30),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(color: orange, strokeWidth: 2.5),
                SizedBox(height: 14),
                Text(
                  'جاري تحديث الحواجز...',
                  style: TextStyle(
                    color: textDark,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ),
      );

      return;
    }

    if (hasError || snapshot.checkpoints.isEmpty) {
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        builder: (_) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 14, 22, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const _BottomSheetHandle(),

                const SizedBox(height: 20),

                Icon(
                  hasError
                      ? Icons.cloud_off_rounded
                      : Icons.location_off_rounded,
                  size: 42,
                  color: textMuted,
                ),

                const SizedBox(height: 12),

                Text(
                  hasError
                      ? l10n.checkpointsUnavailable
                      : l10n.checkpointsEmpty,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: textDark,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),

                const SizedBox(height: 6),

                Text(
                  hasError
                      ? l10n.checkpointsUnavailableBody
                      : 'لا توجد بيانات حواجز متاحة حالياً.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),

                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
      );

      return;
    }

    final grouped = <String, List<Checkpoint>>{};

    for (final checkpoint in snapshot.checkpoints) {
      final city = checkpoint.city.trim().isEmpty
          ? 'مدينة غير محددة'
          : checkpoint.city.trim();

      grouped.putIfAbsent(city, () => <Checkpoint>[]);

      grouped[city]!.add(checkpoint);
    }

    final cities = grouped.keys.toList()..sort();

    await showCheckpointSheet<void>(
      context: context,
      checkpoints: snapshot.checkpoints,
      isScrollControlled: true,
      backgroundColor: white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.72,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _BottomSheetHandle(),

                  const SizedBox(height: 18),

                  Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: orangeSoft,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Icon(
                          Icons.traffic_rounded,
                          color: orange,
                          size: 23,
                        ),
                      ),

                      const SizedBox(width: 11),

                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'الحواجز',
                              style: TextStyle(
                                color: textDark,
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'اختر المدينة لعرض حواجزها',
                              style: TextStyle(
                                color: textSecondary,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),

                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: background,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '${snapshot.checkpoints.length}',
                          style: const TextStyle(
                            color: textDark,
                            fontSize: 13,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 18),

                  Expanded(
                    child: ListView.separated(
                      physics: const BouncingScrollPhysics(),
                      itemCount: cities.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (_, index) {
                        final city = cities[index];
                        final cityCheckpoints = grouped[city]!;

                        final hasTrafficIssue = cityCheckpoints.any(
                          (checkpoint) =>
                              checkpoint.status == CheckpointStatus.congested ||
                              checkpoint.status == CheckpointStatus.closed,
                        );

                        return _CityCheckpointTile(
                          city: city,
                          count: cityCheckpoints.length,
                          hasTrafficIssue: hasTrafficIssue,
                          hasClosedRoad: cityCheckpoints.any(
                            (checkpoint) =>
                                checkpoint.status == CheckpointStatus.closed,
                          ),
                          onTap: () {
                            Navigator.of(sheetContext).pop();

                            Future.microtask(() {
                              if (!context.mounted) return;

                              _showCityCheckpoints(
                                context,
                                city,
                                cityCheckpoints,
                              );
                            });
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
      },
    );
  }

  // ============================================================
  // CITY CHECKPOINTS
  // ============================================================

  Future<void> _showCityCheckpoints(
    BuildContext context,
    String city,
    List<Checkpoint> checkpoints,
  ) async {
    await showCheckpointSheet<void>(
      context: context,
      checkpoints: checkpoints,
      isScrollControlled: true,
      backgroundColor: white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      builder: (_) {
        return SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.75,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _BottomSheetHandle(),

                  const SizedBox(height: 18),

                  Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: orangeSoft,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Icon(
                          Icons.location_city_rounded,
                          color: orange,
                          size: 23,
                        ),
                      ),

                      const SizedBox(width: 11),

                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              city,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: textDark,
                                fontSize: 19,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${checkpoints.length} حواجز',
                              style: const TextStyle(
                                color: textSecondary,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 18),

                  Expanded(
                    child: ListView.separated(
                      physics: const BouncingScrollPhysics(),
                      itemCount: checkpoints.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (_, index) {
                        return _CheckpointCard(checkpoint: checkpoints[index]);
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // ============================================================
  // CURRENT LOCATION
  // ============================================================

  Widget _buildCurrentLocationCard(
    BuildContext context,
    AppLocalizations l10n,
    TripLocation? location,
  ) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: border),
      ),
      child: Row(
        textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
        children: [
          Container(
            width: 35,
            height: 35,
            decoration: BoxDecoration(
              color: location == null ? white : successSoft,
              shape: BoxShape.circle,
            ),
            child: Icon(
              location == null
                  ? Icons.location_searching_rounded
                  : Icons.location_on_rounded,
              color: location == null ? textMuted : success,
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
                    color: textSecondary,
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
                    color: textDark,
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
                color: successSoft,
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Text(
                'LIVE',
                style: TextStyle(
                  color: success,
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
  // ETA
  // ============================================================

  Widget _buildEtaCard(BuildContext context, DriverTripState state) {
    return _DriverEtaCard(trip: state.trip, location: state.location);
  }

  // ============================================================
  // TRIP ACTIONS
  // ============================================================

  Widget _buildTripActions(
    BuildContext context,
    AppLocalizations l10n,
    DriverTripState state,
  ) {
    final nextStatus = state.trip.nextStatus;

    // ----------------------------------------------------------
    // SIMULATION HAS BEEN REMOVED.
    // The driver can only use the real trip action.
    // ----------------------------------------------------------

    final canCancel = {
      'accepted',
      'pickup_started',
      'picked_up',
      'in_transit',
    }.contains(state.trip.status);
    final canFail = state.trip.status == 'in_transit';

    if (nextStatus == null && !canCancel && !canFail) {
      return _buildRefreshButton(context, l10n);
    }

    return Column(
      children: [
        if (nextStatus != null)
          SizedBox(
            width: double.infinity,
            height: 45,
            child: ElevatedButton(
              key: ValueKey('tripAction-$nextStatus'),
              onPressed: state.actionInProgress ? null : _advance,
              style: ElevatedButton.styleFrom(
                backgroundColor: textDark,
                foregroundColor: white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: state.actionInProgress
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        color: white,
                        strokeWidth: 2,
                      ),
                    )
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          nextTripActionLabel(l10n, nextStatus),
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(width: 7),
                        const Icon(Icons.arrow_forward_rounded, size: 17),
                      ],
                    ),
            ),
          ),

        if (canCancel) ...[
          const SizedBox(height: 7),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: OutlinedButton.icon(
              onPressed: state.actionInProgress ? null : _cancelTrip,
              icon: const Icon(Icons.cancel_outlined, size: 17),
              label: Text(
                l10n.cancelRequest,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: error,
                side: BorderSide(color: error.withValues(alpha: 0.45)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(13),
                ),
              ),
            ),
          ),
        ],

        if (canFail) ...[
          const SizedBox(height: 7),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: OutlinedButton.icon(
              onPressed: state.actionInProgress ? null : _failDelivery,
              icon: const Icon(Icons.report_problem_outlined, size: 17),
              label: Text(
                l10nFailDelivery(context),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: error,
                side: BorderSide(color: error.withValues(alpha: 0.45)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(13),
                ),
              ),
            ),
          ),
        ],

        const SizedBox(height: 7),

        _buildRefreshButton(context, l10n),
      ],
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
              .read(driverTripControllerProvider(widget.tripId).notifier)
              .refresh();

          ref.read(checkpointsProvider.notifier).refresh();
        },
        icon: const Icon(Icons.refresh_rounded, size: 16),
        label: Text(
          l10n.refresh,
          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800),
        ),
        style: OutlinedButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(13),
          ),
        ),
      ),
    );
  }

  // ============================================================
  // ACTION
  // ============================================================

  Future<void> _advance() async {
    final trip = ref
        .read(driverTripControllerProvider(widget.tripId))
        .value
        ?.trip;
    // Delivering a parcel needs the receiver: their code, or a recorded reason.
    if (trip != null && trip.needsReceiverConfirmation) {
      final result = await showReceiverConfirmationDialog(
        context,
        pending: trip.deliveryConfirmation!.pending,
      );
      if (result == null || !mounted) return;
      await _action(
        () => ref
            .read(driverTripControllerProvider(widget.tripId).notifier)
            .confirmDelivery(
              codesByOrderId: result is ReceiverCodes
                  ? result.codesByOrderId
                  : null,
              unavailableReason: result is ReceiverUnavailable
                  ? result.reason
                  : null,
            ),
      );
      return;
    }
    await _action(
      () => ref
          .read(driverTripControllerProvider(widget.tripId).notifier)
          .advanceStatus(),
    );
  }

  Future<void> _failDelivery() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10nFailDeliveryTitle(context)),
        content: Text(l10nFailDeliveryMessage(context)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10nFailDelivery(context)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _action(
      () => ref
          .read(driverTripControllerProvider(widget.tripId).notifier)
          .failDelivery(),
    );
  }

  String l10nFailDelivery(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar'
      ? 'تسجيل فشل التوصيل'
      : 'Mark delivery failed';

  String l10nFailDeliveryTitle(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar'
      ? 'فشل التوصيل'
      : 'Delivery failed';

  String l10nFailDeliveryMessage(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar'
      ? 'هل تريد تسجيل الرحلة كتوصيل فاشل'
      : 'Are you sure you want to mark this delivery as failed';

  Future<void> _cancelTrip() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10nCancelTripTitle(context)),
        content: Text(l10nCancelTripMessage(context)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(AppLocalizations.of(context).cancelRequest),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _action(
      () => ref
          .read(driverTripControllerProvider(widget.tripId).notifier)
          .cancelTrip(),
    );
  }

  String l10nCancelTripTitle(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar'
      ? 'إلغاء الرحلة'
      : 'Cancel trip';

  String l10nCancelTripMessage(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar'
      ? 'هل أنت متأكد من إلغاء الرحلة الحالية'
      : 'Are you sure you want to cancel this trip';

  Future<void> _action(Future<void> Function() action) async {
    if (!mounted) return;

    setState(() => _error = null);

    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(
          () => _error =
              _handoverError(error) ??
              driverErrorLabel(AppLocalizations.of(context), error),
        );

        await ref
            .read(driverTripControllerProvider(widget.tripId).notifier)
            .refresh();
      }
    }
  }

  String? _handoverError(Object error) {
    if (error is! ApiException) return null;
    const known = {
      'invalid_handover_code',
      'handover_locked',
      'handover_expired',
      'handover_not_issued',
      'delivery_confirmation_required',
    };
    return known.contains(error.message)
        ? HandoverStrings.of(context).errorFor(error)
        : null;
  }

  // ============================================================
  // ERROR
  // ============================================================

  Widget _buildErrorState(BuildContext context, AppLocalizations l10n) {
    return Container(
      color: background,
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
                  color: orangeSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.cloud_off_rounded,
                  color: orange,
                  size: 34,
                ),
              ),

              const SizedBox(height: 20),

              Text(
                driverErrorLabel(l10n, 'driver_trip_error'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: textDark,
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
                          driverTripControllerProvider(widget.tripId).notifier,
                        )
                        .refresh();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: textDark,
                    foregroundColor: white,
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
}

// ============================================================================
// DRIVER MAP
// ============================================================================

class _DriverMapSection extends ConsumerStatefulWidget {
  const _DriverMapSection({
    required this.l10n,
    required this.trip,
    required this.location,
    required this.snapshot,
    required this.checkpointsLoading,
    required this.checkpointsError,
  });

  final AppLocalizations l10n;
  final DriverTrip trip;
  final TripLocation? location;
  final CheckpointSnapshot snapshot;
  final bool checkpointsLoading;
  final bool checkpointsError;

  @override
  ConsumerState<_DriverMapSection> createState() => _DriverMapSectionState();
}

class _DriverMapSectionState extends ConsumerState<_DriverMapSection> {
  late Future<OsrmRouteResult> _routeFuture;

  Future<OsrmRouteResult>? _remainingRouteFuture;

  @override
  void initState() {
    super.initState();
    _routeFuture = _loadRoute();
    _remainingRouteFuture = _loadRemainingRoute();
  }

  @override
  void didUpdateWidget(covariant _DriverMapSection oldWidget) {
    super.didUpdateWidget(oldWidget);

    final routeChanged =
        oldWidget.trip.id != widget.trip.id ||
        oldWidget.trip.mapOrigin != widget.trip.mapOrigin ||
        oldWidget.trip.mapDestination != widget.trip.mapDestination;

    final oldLocation = oldWidget.location;
    final newLocation = widget.location;

    final locationChanged =
        oldLocation?.lat != newLocation?.lat ||
        oldLocation?.lng != newLocation?.lng;

    if (routeChanged) {
      _routeFuture = _loadRoute();
    }

    if (routeChanged || locationChanged) {
      _remainingRouteFuture = _loadRemainingRoute();
    }
  }

  // ----------------------------------------------------------
  // VALIDATE CHECKPOINT COORDINATES
  // ----------------------------------------------------------

  bool _hasValidCheckpointPosition(Checkpoint checkpoint) {
    final lat = checkpoint.position.latitude;
    final lng = checkpoint.position.longitude;

    return lat.isFinite &&
        lng.isFinite &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180 &&
        !(lat == 0 && lng == 0);
  }

  // ----------------------------------------------------------
  // FULL ROUTE
  // ----------------------------------------------------------

  Future<OsrmRouteResult> _loadRoute() async {
    final start = widget.trip.mapOrigin;
    final end = widget.trip.mapDestination;
    if (start == null || end == null) return _emptyRoute;
    return _requestRoute(
      start: LatLng(start.latitude, start.longitude),
      end: LatLng(end.latitude, end.longitude),
    );
  }

  Future<OsrmRouteResult>? _loadRemainingRoute() {
    final location = widget.location;
    final destination = widget.trip.mapDestination;
    if (location == null || destination == null) return null;
    return _requestRoute(
      start: LatLng(location.lat, location.lng),
      end: LatLng(destination.latitude, destination.longitude),
    );
  }

  Future<OsrmRouteResult> _requestRoute({
    required LatLng start,
    required LatLng end,
  }) async {
    try {
      return await ref
          .read(osrmRouteServiceProvider)
          .getRoute(start: start, end: end);
    } catch (_) {
      return _emptyRoute;
    }
  }

  // ----------------------------------------------------------
  // BUILD MAP
  // ----------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final origin = widget.trip.mapOrigin;
    final destination = widget.trip.mapDestination;
    final markers = <MasariMapMarker>[
      // --------------------------------------------------------
      // CHECKPOINTS
      // --------------------------------------------------------
      for (final checkpoint in widget.snapshot.checkpoints)
        if (_hasValidCheckpointPosition(checkpoint))
          checkpointTrafficMarker(checkpoint),

      // --------------------------------------------------------
      // ORIGIN
      // ----------------------------------------------------------
      if (origin != null)
        MasariMapMarker(
          position: origin,
          icon: Icons.trip_origin_rounded,
          color: SemanticColors.upcomingRoute,
          label: widget.l10n.mapOriginLabel(
            localizedOrigin(context, widget.trip.mapOriginLabel),
          ),
          size: 42,
        ),

      // --------------------------------------------------------
      // DESTINATION
      // ----------------------------------------------------------
      if (destination != null)
        MasariMapMarker(
          position: destination,
          icon: Icons.flag_rounded,
          color: SemanticColors.completedRoute,
          label: widget.l10n.mapDestinationLabel(
            widget.trip.mapDestinationLabel,
          ),
          size: 42,
        ),

      // --------------------------------------------------------
      // DRIVER / VEHICLE
      // ----------------------------------------------------------
      if (widget.location != null)
        MasariMapMarker(
          position: GeoPoint(widget.location!.lat, widget.location!.lng),
          icon: Icons.local_shipping_rounded,
          color: orange,
          label: widget.l10n.mapYourLocation,
          size: 50,
        ),
    ];

    return FutureBuilder<OsrmRouteResult>(
      key: ObjectKey(_routeFuture),
      future: _routeFuture,
      builder: (context, snapshot) {
        final routedPoints = snapshot.data?.points
            .map((point) => GeoPoint(point.latitude, point.longitude))
            .toList(growable: false);

        final pathPoints = routedPoints != null && routedPoints.length >= 2
            ? routedPoints
            : const <GeoPoint>[];

        return LayoutBuilder(
          builder: (context, constraints) {
            return SizedBox(
              width: constraints.maxWidth,
              height: constraints.maxHeight,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  // ------------------------------------------------
                  // MAP
                  // ------------------------------------------------
                  Positioned.fill(
                    child: MasariMap(
                      height: constraints.maxHeight,
                      emptyLabel: widget.l10n.mapRouteMissingCoordinates,
                      attributionLabel: widget.l10n.mapAttribution,
                      // Keep the zoom buttons clear of this screen's top buttons.
                      controlsTop: 100,
                      paths: [
                        if (pathPoints.length >= 2)
                          MasariMapPath(
                            points: pathPoints,
                            color: orange,
                            width: 7,
                          ),
                      ],
                      markers: markers,
                      // Checkpoints appear on the map and in the bottom panel.
                      banner: origin == null || destination == null
                          ? Text(widget.l10n.mapRouteMissingCoordinates)
                          : snapshot.connectionState == ConnectionState.done &&
                                pathPoints.isEmpty
                          ? Text(widget.l10n.requestFailed)
                          : null,
                    ),
                  ),

                  // ------------------------------------------------
                  // MAP LEGEND
                  // ------------------------------------------------
                  Positioned(
                    left: 14,
                    bottom: 255,
                    child: _MapLegend(
                      l10n: widget.l10n,
                      hasDriverLocation: widget.location != null,
                    ),
                  ),

                  // ------------------------------------------------
                  // REMAINING ROUTE
                  // ------------------------------------------------
                  if (_remainingRouteFuture != null)
                    Positioned(
                      left: 14,
                      right: 14,
                      bottom: 192,
                      child: FutureBuilder<OsrmRouteResult>(
                        key: ObjectKey(_remainingRouteFuture),
                        future: _remainingRouteFuture,
                        builder: (context, routeSnapshot) {
                          final result = routeSnapshot.data;

                          if (result == null ||
                              result.durationSeconds <= 0 ||
                              result.distanceMeters <= 0) {
                            return const SizedBox.shrink();
                          }

                          return _RemainingRouteCard(result: result);
                        },
                      ),
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

// ============================================================================
// DRIVER ETA
// ============================================================================

class _DriverEtaCard extends ConsumerStatefulWidget {
  const _DriverEtaCard({required this.trip, required this.location});

  final DriverTrip trip;
  final TripLocation? location;

  @override
  ConsumerState<_DriverEtaCard> createState() => _DriverEtaCardState();
}

class _DriverEtaCardState extends ConsumerState<_DriverEtaCard> {
  Future<OsrmRouteResult>? _future;
  String? _key;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _ensureRoute();
  }

  @override
  void didUpdateWidget(covariant _DriverEtaCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    _ensureRoute();
  }

  void _ensureRoute() {
    final origin = widget.trip.mapOrigin;
    final destination = widget.trip.mapDestination;
    final startLat = widget.location?.lat ?? origin?.latitude;
    final startLng = widget.location?.lng ?? origin?.longitude;
    if (startLat == null || startLng == null || destination == null) {
      _future = null;
      _key = null;
      return;
    }
    final destinationLat = destination.latitude;
    final destinationLng = destination.longitude;
    final key =
        '${widget.trip.id}|$startLat,$startLng|$destinationLat,$destinationLng';

    if (_future != null && _key == key) {
      return;
    }

    _key = key;

    _future = _request(
      start: LatLng(startLat, startLng),
      end: LatLng(destinationLat, destinationLng),
    );
  }

  Future<OsrmRouteResult> _request({
    required LatLng start,
    required LatLng end,
  }) async {
    try {
      final result = await ref
          .read(osrmRouteServiceProvider)
          .getRoute(start: start, end: end);

      if (result.points.length >= 2) {
        return result;
      }
    } catch (_) {}

    return const OsrmRouteResult(
      points: [],
      durationSeconds: 0,
      distanceMeters: 0,
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<OsrmRouteResult>(
      key: ObjectKey(_future),
      future: _future,
      builder: (context, snapshot) {
        final result = snapshot.data;

        if (result == null ||
            result.durationSeconds <= 0 ||
            result.distanceMeters <= 0) {
          return const SizedBox.shrink();
        }

        final isArabic = Localizations.localeOf(context).languageCode == 'ar';

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(
            color: orangeSoft,
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: orange.withValues(alpha: 0.12)),
          ),
          child: Row(
            textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
            children: [
              Container(
                width: 35,
                height: 35,
                decoration: const BoxDecoration(
                  color: white,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.access_time_rounded,
                  color: orange,
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
                      isArabic ? 'الوقت المتبقي' : 'Remaining time',
                      style: const TextStyle(
                        color: textSecondary,
                        fontSize: 8,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      result.formattedDuration,
                      style: const TextStyle(
                        color: textDark,
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
                color: orange.withValues(alpha: 0.16),
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
                      color: textSecondary,
                      fontSize: 8,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${result.distanceKilometers.toStringAsFixed(1)} km',
                    style: const TextStyle(
                      color: textDark,
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
}

// ============================================================================
// REMAINING ROUTE CARD
// ============================================================================

class _RemainingRouteCard extends StatelessWidget {
  const _RemainingRouteCard({required this.result});

  final OsrmRouteResult result;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: navy,
        borderRadius: BorderRadius.circular(15),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 15,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 35,
            height: 35,
            decoration: BoxDecoration(
              color: orange.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.access_time_rounded,
              color: orange,
              size: 18,
            ),
          ),

          const SizedBox(width: 9),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'الوقت المتبقي',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 8,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  result.formattedDuration,
                  style: const TextStyle(
                    color: white,
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),

          Container(width: 1, height: 28, color: Colors.white24),

          const SizedBox(width: 10),

          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text(
                'المسافة',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 8,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${result.distanceKilometers.toStringAsFixed(1)} km',
                style: const TextStyle(
                  color: white,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// MAP LEGEND
// ============================================================================

class _MapLegend extends StatelessWidget {
  const _MapLegend({required this.l10n, required this.hasDriverLocation});

  final AppLocalizations l10n;
  final bool hasDriverLocation;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: white.withValues(alpha: 0.94),
      borderRadius: BorderRadius.circular(15),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        child: Wrap(
          spacing: 10,
          runSpacing: 5,
          children: [
            if (hasDriverLocation)
              _LegendItem(
                icon: Icons.local_shipping_rounded,
                color: orange,
                label: l10n.mapYourLocation,
              ),

            _LegendItem(
              icon: Icons.trip_origin_rounded,
              color: SemanticColors.upcomingRoute,
              label: l10n.mapLegendStart,
            ),

            _LegendItem(
              icon: Icons.flag_rounded,
              color: SemanticColors.completedRoute,
              label: l10n.mapLegendDestination,
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// LEGEND ITEM
// ============================================================================

class _LegendItem extends StatelessWidget {
  const _LegendItem({
    required this.icon,
    required this.color,
    required this.label,
  });

  final IconData icon;
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          label,
          style: Theme.of(
            context,
          ).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

// ============================================================================
// MAP NOTICE
// ============================================================================

class _CityCheckpointTile extends StatelessWidget {
  const _CityCheckpointTile({
    required this.city,
    required this.count,
    required this.hasTrafficIssue,
    required this.hasClosedRoad,
    required this.onTap,
  });

  final String city;
  final int count;
  final bool hasTrafficIssue;
  final bool hasClosedRoad;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: border),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: hasTrafficIssue ? orangeSoft : successSoft,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  Icons.location_city_rounded,
                  color: hasTrafficIssue ? orange : success,
                  size: 21,
                ),
              ),

              const SizedBox(width: 11),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      city,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: textDark,
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '$count حواجز',
                      style: const TextStyle(
                        color: textSecondary,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),

              if (hasTrafficIssue)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: orangeSoft,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Text(
                    hasClosedRoad ? 'مغلق' : 'ازدحام',
                    style: const TextStyle(
                      color: orangeDark,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),

              const SizedBox(width: 5),

              const Icon(
                Icons.chevron_right_rounded,
                color: textSecondary,
                size: 21,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================================================================
// CHECKPOINT CARD
// ============================================================================

class _CheckpointCard extends StatelessWidget {
  const _CheckpointCard({required this.checkpoint});

  final Checkpoint checkpoint;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // --------------------------------------------------------
          // HEADER
          // --------------------------------------------------------
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: orangeSoft,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.location_on_rounded,
                  color: orange,
                  size: 22,
                ),
              ),

              const SizedBox(width: 10),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      checkpoint.displayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: textDark,
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),

                    if (checkpoint.city.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        checkpoint.city,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: textSecondary,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // --------------------------------------------------------
          // ENTERING
          // --------------------------------------------------------
          _CheckpointDirectionCard(
            icon: Icons.traffic_rounded,
            title: 'الحالة',
            status: checkpointStatusLabel(checkpoint.status),
            updatedAt: checkpoint.updatedAt,
          ),
          const SizedBox(height: 8),
          _CheckpointDirectionCard(
            icon: Icons.login_rounded,
            title: 'الدخول',
            status: _checkpointStatusLabel(checkpoint.enteringStatus),
            updatedAt: checkpoint.enteringStatusLastUpdated,
          ),

          const SizedBox(height: 8),

          // --------------------------------------------------------
          // LEAVING
          // --------------------------------------------------------
          _CheckpointDirectionCard(
            icon: Icons.logout_rounded,
            title: 'الخروج',
            status: _checkpointStatusLabel(checkpoint.leavingStatus),
            updatedAt: checkpoint.leavingStatusLastUpdated,
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// CHECKPOINT DIRECTION
// ============================================================================

class _CheckpointDirectionCard extends StatelessWidget {
  const _CheckpointDirectionCard({
    required this.icon,
    required this.title,
    required this.status,
    required this.updatedAt,
  });

  final IconData icon;
  final String title;
  final String status;
  final DateTime? updatedAt;

  @override
  Widget build(BuildContext context) {
    final style = _checkpointStatusStyle(context, status);

    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: style.color.withValues(alpha: 0.045),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: style.color.withValues(alpha: 0.14)),
      ),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: style.color.withValues(alpha: 0.11),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 17, color: style.color),
          ),

          const SizedBox(width: 8),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),

                const SizedBox(height: 2),

                Text(
                  status,
                  style: TextStyle(
                    color: style.color,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),

                const SizedBox(height: 3),

                Text(
                  updatedAt == null
                      ? 'آخر تحديث غير متوفر'
                      : 'آخر تحديث: ${_formatCheckpointTime(context, updatedAt!)}',
                  style: const TextStyle(
                    color: textSecondary,
                    fontSize: 8,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),

          _CheckpointStatusIcon(style: style),
        ],
      ),
    );
  }
}

// ============================================================================
// CHECKPOINT STATUS ICON
// ============================================================================

class _CheckpointStatusIcon extends StatelessWidget {
  const _CheckpointStatusIcon({required this.style});

  final _CheckpointStatusStyle style;

  @override
  Widget build(BuildContext context) {
    return Icon(style.icon, size: 20, color: style.color);
  }
}

// ============================================================================
// CHECKPOINT STATUS STYLE
// ============================================================================

class _CheckpointStatusStyle {
  const _CheckpointStatusStyle({required this.color, required this.icon});

  final Color color;
  final IconData icon;
}

_CheckpointStatusStyle _checkpointStatusStyle(
  BuildContext context,
  String status,
) {
  final theme = Theme.of(context);
  switch (parseCheckpointStatus(status)) {
    case CheckpointStatus.open:
      return const _CheckpointStatusStyle(
        color: Color(0xFF16A34A),
        icon: Icons.check_circle_rounded,
      );
    case CheckpointStatus.congested:
      return const _CheckpointStatusStyle(
        color: Color(0xFFF59E0B),
        icon: Icons.traffic_rounded,
      );
    case CheckpointStatus.closed:
      return const _CheckpointStatusStyle(
        color: Color(0xFFDC2626),
        icon: Icons.block_rounded,
      );
    case CheckpointStatus.unknown:
      return _CheckpointStatusStyle(
        color: theme.colorScheme.onSurfaceVariant,
        icon: Icons.help_outline_rounded,
      );
  }
}

String _checkpointStatusLabel(String? status) =>
    checkpointStatusLabel(parseCheckpointStatus(status));

// ============================================================================
// CHECKPOINT TIME
// ============================================================================

String _formatCheckpointTime(BuildContext context, DateTime value) {
  final material = MaterialLocalizations.of(context);

  final local = value.toLocal();

  return '${material.formatCompactDate(local)} '
      '${material.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
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
          color: border,
          borderRadius: BorderRadius.circular(10),
        ),
      ),
    );
  }
}

const _emptyRoute = OsrmRouteResult(
  points: [],
  durationSeconds: 0,
  distanceMeters: 0,
);
