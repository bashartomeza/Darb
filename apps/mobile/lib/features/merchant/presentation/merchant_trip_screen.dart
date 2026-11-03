import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/maps/osrm_route_service.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/merchant_theme.dart';
import '../../../core/widgets/darb_map.dart';
import '../../../core/widgets/state_views.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../delivery_handover/presentation/handover_code_card.dart';
import '../../incidents/presentation/report_incident_sheet.dart';
import '../../security/presentation/session_status_banner.dart';
import '../../trips/data/trip_models.dart';
import '../../trips/data/trip_repository.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import 'merchant_order_route_map.dart';
import 'merchant_ui.dart';
import 'widgets/merchant_design.dart';

typedef _RouteEndpoints = ({
  double lat1,
  double lng1,
  double lat2,
  double lng2,
});

// Reuse the existing trip projection for the map's display coordinates, so
// the merchant redesign does not change shared data models or API contracts.
final _trackingRouteProvider = FutureProvider.autoDispose
    .family<PassengerTrip, String>(
      (ref, tripId) => ref.watch(tripRepositoryProvider).tripDetail(tripId),
    );

final _routeGeometryProvider = FutureProvider.autoDispose
    .family<OsrmRouteResult?, _RouteEndpoints>((ref, points) async {
      try {
        return await ref
            .read(osrmRouteServiceProvider)
            .getRoute(
              start: LatLng(points.lat1, points.lng1),
              end: LatLng(points.lat2, points.lng2),
            );
      } catch (_) {
        return null;
      }
    });

class MerchantTripScreen extends ConsumerStatefulWidget {
  const MerchantTripScreen({required this.tripId, super.key});
  final String tripId;

  @override
  ConsumerState<MerchantTripScreen> createState() => _MerchantTripScreenState();
}

class _MerchantTripScreenState extends ConsumerState<MerchantTripScreen>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = ref.read(merchantTripProvider(widget.tripId).notifier);
    if (state == AppLifecycleState.resumed) controller.resumePolling();
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.detached) {
      controller.pausePolling();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final trip = ref.watch(merchantTripProvider(widget.tripId));
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            MerchantHeader(
              title: merchantText(
                context,
                'متابعة التوصيل',
                'Delivery tracking',
              ),
              titleKey: const ValueKey('merchantTripTitle'),
              fallback: '/merchant/shipments',
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref
                    .read(merchantTripProvider(widget.tripId).notifier)
                    .refresh(),
                child: trip.when(
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (error, _) => ErrorStateView(
                    title: merchantErrorLabel(l10n, error),
                    onRetry: () => ref
                        .read(merchantTripProvider(widget.tripId).notifier)
                        .refresh(),
                  ),
                  data: (state) => ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                    children: [_content(l10n, state)],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _content(AppLocalizations l10n, MerchantTripViewState state) {
    final route = state.trip.route;
    final location = state.location;
    final currentIndex = merchantTripTimeline.indexOf(state.trip.status);
    final progress = location == null
        ? 0.0
        : ((location.sequence + 1) / 7).clamp(0.0, 1.0);
    final material = MaterialLocalizations.of(context);
    final time = location == null
        ? l10n.noLocationYet
        : material.formatTimeOfDay(TimeOfDay.fromDateTime(location.recordedAt));
    final mapHeight = (MediaQuery.sizeOf(context).height * .48).clamp(
      280.0,
      440.0,
    );
    final banner = Center(
      child: Container(
        constraints: const BoxConstraints(maxWidth: 260),
        margin: const EdgeInsets.all(14),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 20),
        decoration: BoxDecoration(
          color: MerchantStyle.card.withValues(alpha: .97),
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: MerchantStyle.border),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              merchantStatusLabel(l10n, state.trip.status),
              key: const ValueKey('merchantTripStatus'),
              style: MerchantStyle.text(size: 14, weight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              location == null
                  ? l10n.noLocationYet
                  : '${l10n.latestLocation} · $time',
              style: MerchantStyle.text(size: 11, color: MerchantStyle.muted),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SessionStatusBanner(),
        ClipRRect(
          borderRadius: BorderRadius.circular(18),
          // A route order draws its own pickup and drop-offs on the road, with
          // checkpoints; an older order falls back to the driver route's ends.
          child: state.order.routeWaypoints.length >= 2
              ? MerchantOrderRouteMap(
                  key: const ValueKey('merchantDeliveryMap'),
                  order: state.order,
                  vehicle: location == null
                      ? null
                      : GeoPoint(location.lat, location.lng),
                  height: mapHeight,
                  banner: banner,
                  bannerElevation: 0,
                  controlsTop: 112,
                  routeColor: MerchantStyle.orange,
                )
              : _CorridorTripMap(
                  tripId: widget.tripId,
                  route: route,
                  location: location,
                  height: mapHeight,
                  banner: banner,
                ),
        ),
        const SizedBox(height: 12),
        MerchantCard(
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: MerchantStyle.orangeSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.local_shipping_outlined,
                  color: MerchantStyle.orange,
                  size: 25,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      merchantText(
                        context,
                        'تفاصيل التوصيل',
                        'Delivery details',
                      ),
                      style: MerchantStyle.text(
                        size: 14,
                        weight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      merchantOrderRouteLabel(context, state.order),
                      key: const ValueKey('merchantTripRoute'),
                      style: MerchantStyle.text(
                        size: 12,
                        weight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      '${l10n.pickup}: ${merchantPickupText(context, state.order)}',
                      key: const ValueKey('merchantTripPickup'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: MerchantStyle.text(
                        size: 11,
                        color: MerchantStyle.muted,
                      ),
                    ),
                    Text(
                      merchantOrderDestination(context, state.order),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: MerchantStyle.text(
                        size: 11,
                        color: MerchantStyle.muted,
                      ),
                    ),
                    Text(
                      merchantReference(state.order.id),
                      style: MerchantStyle.text(
                        size: 11,
                        color: MerchantStyle.muted,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: l10n.orderDetails,
                onPressed: () =>
                    context.push('/merchant/order/${state.order.id}'),
                icon: const Icon(
                  Icons.receipt_long_outlined,
                  color: MerchantStyle.orange,
                  size: 22,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: () =>
              ref.read(merchantTripProvider(widget.tripId).notifier).refresh(),
          icon: const Icon(Icons.refresh_rounded, size: 20),
          label: Text(
            merchantText(
              context,
              'تحديث موقع التوصيل',
              'Refresh delivery location',
            ),
          ),
        ),
        const SizedBox(height: 24),
        MerchantCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${l10n.orderStatus}: ${merchantStatusLabel(l10n, state.order.status)}',
                key: const ValueKey('merchantTripOrderStatus'),
                style: MerchantStyle.text(size: 14, weight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              Text(
                l10n.statusTimeline,
                style: MerchantStyle.text(size: 14, weight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              for (final entry in merchantTripTimeline.indexed)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      Icon(
                        currentIndex >= entry.$1 && currentIndex >= 0
                            ? Icons.check_circle_rounded
                            : Icons.radio_button_unchecked_rounded,
                        size: 18,
                        color: currentIndex >= entry.$1 && currentIndex >= 0
                            ? MerchantStyle.green
                            : MerchantStyle.muted,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          merchantStatusLabel(l10n, entry.$2),
                          style: MerchantStyle.text(size: 12),
                        ),
                      ),
                    ],
                  ),
                ),
              LinearProgressIndicator(
                key: const ValueKey('merchantRouteProgress'),
                value: progress,
                color: MerchantStyle.orange,
                backgroundColor: MerchantStyle.orangeSoft,
              ),
            ],
          ),
        ),
        if (state.trip.isActive && state.trip.status != 'delivered') ...[
          const SizedBox(height: 16),
          HandoverCodeCard(orderId: state.order.id),
        ],
        const SizedBox(height: 16),
        MerchantInfoTile(
          icon: Icons.location_on_outlined,
          title: l10n.latestLocation,
          value: location == null
              ? l10n.noLocationYet
              : '${location.lat}, ${location.lng} · ${localizedLocationSource(l10n, location.source)}',
        ),
        const SizedBox(height: 12),
        ReportIncidentButton(tripId: widget.tripId),
      ],
    );
  }
}

/// Map for orders created before routes, which have no pickup or drop-off
/// coordinates of their own: the driver route's two ends on the road.
class _CorridorTripMap extends ConsumerWidget {
  const _CorridorTripMap({
    required this.tripId,
    required this.route,
    required this.location,
    required this.height,
    required this.banner,
  });

  final String tripId;
  final MerchantRouteSummary route;
  final TripLocation? location;
  final double height;
  final Widget banner;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final routeCoordinates = ref.watch(_trackingRouteProvider(tripId)).value;
    final origin = _point(
      routeCoordinates?.originLat,
      routeCoordinates?.originLng,
    );
    final destination = _point(
      routeCoordinates?.destinationLat,
      routeCoordinates?.destinationLng,
    );
    final geometry = origin != null && destination != null
        ? ref
              .watch(
                _routeGeometryProvider((
                  lat1: origin.latitude,
                  lng1: origin.longitude,
                  lat2: destination.latitude,
                  lng2: destination.longitude,
                )),
              )
              .value
        : null;
    final location = this.location;
    return DarbMap(
      key: const ValueKey('merchantDeliveryMap'),
      emptyLabel: l10n.noLocationYet,
      attributionLabel: l10n.mapAttribution,
      height: height,
      controlsTop: 112,
      bannerElevation: 0,
      paths: [
        if (geometry != null)
          DarbMapPath(
            points: geometry.points
                .map((p) => GeoPoint(p.latitude, p.longitude))
                .toList(),
            color: MerchantStyle.orange,
            width: 4,
          ),
      ],
      markers: [
        if (origin != null)
          DarbMapMarker(
            position: origin,
            icon: Icons.trip_origin_rounded,
            color: MerchantStyle.green,
            label: localizedCorridorPlace(context, route.originLabel),
            size: 28,
          ),
        if (destination != null)
          DarbMapMarker(
            position: destination,
            icon: Icons.location_on_rounded,
            color: const Color(0xFFF26356),
            label: localizedCorridorPlace(context, route.destinationLabel),
            type: DarbMapMarkerType.destination,
            size: 30,
          ),
        if (location != null)
          DarbMapMarker(
            position: GeoPoint(location.lat, location.lng),
            icon: Icons.local_shipping_rounded,
            color: MerchantStyle.orange,
            label: l10n.latestLocation,
            type: DarbMapMarkerType.driver,
            size: 34,
          ),
      ],
      banner: banner,
    );
  }

  static GeoPoint? _point(double? lat, double? lng) =>
      lat == null ||
          lng == null ||
          !lat.isFinite ||
          !lng.isFinite ||
          lat.abs() > 90 ||
          lng.abs() > 180
      ? null
      : GeoPoint(lat, lng);
}
