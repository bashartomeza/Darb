import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' show TileProvider;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../features/canonical_routes/domain/canonical_route_models.dart';
import '../theme/semantic_colors.dart';
import '../widgets/darb_map.dart';
import 'map_overlays.dart';
import 'osrm_route_service.dart';

/// The line for [road]: solid along real roads, dashed for the straight
/// fallback (which the map labels with [straightLineNote]).
List<DarbMapPath> roadRoutePaths(
  RoadRoute? road, {
  Color color = SemanticColors.activeRoute,
  double width = 6,
}) => [
  if (road != null && road.points.length >= 2)
    DarbMapPath(
      points: road.points,
      color: color,
      width: road.routed ? width : width - 2,
      dashed: !road.routed,
    ),
];

/// Notes for a route line: says so when the line is the straight fallback.
List<String> roadRouteNotes(AppLocalizations l10n, RoadRoute? road) => [
  if (road != null && !road.routed && road.points.length >= 2)
    road.routingDisabled
        ? l10n.mapRoutingNotConfiguredNote
        : l10n.mapStraightLineNote,
];

/// Watches the road route through [waypoints] (the record's own points, in
/// travel order). Null while it loads or when there are fewer than two points.
RoadRoute? watchRoadRoute(WidgetRef ref, List<GeoPoint> waypoints) {
  if (waypoints.length < 2 ||
      !waypoints.every((p) => p.latitude.isFinite && p.longitude.isFinite)) {
    return null;
  }
  return ref.watch(roadRouteProvider(RoadRouteRequest(waypoints))).value;
}

/// The line for a catalogue route: the server's published road geometry when
/// it has one, otherwise the road route through the route's own stops in
/// order (straight dashed segments between them when routing fails).
RoadRoute? watchCanonicalRoute(WidgetRef ref, CanonicalRoute route) {
  if (route.geometry.hasPoints) {
    return RoadRoute(points: route.geometry.points, routed: true);
  }
  final stops = [
    for (final stop in route.stops)
      if (stop.position != null) stop.position!,
  ];
  // OSRM accepts a bounded number of waypoints; longer routes keep the
  // straight line through every stop rather than dropping stops.
  if (stops.length > 25) return RoadRoute.straight(stops);
  return watchRoadRoute(ref, stops);
}

/// A map for one record (trip, order, parcel, catalogue route): its road route
/// from the first to the last waypoint, start/stop/destination pins, and the
/// shared checkpoint and community layers.
class DarbRouteMap extends ConsumerWidget {
  const DarbRouteMap({
    required this.waypoints,
    required this.emptyLabel,
    this.originLabel,
    this.destinationLabel,
    this.stopLabels = const [],
    this.extraMarkers = const [],
    this.height = 260,
    this.routeColor = SemanticColors.activeRoute,
    this.showOverlay = true,
    this.banner,
    this.bannerElevation = 3,
    this.controlsTop,
    this.onTap,
    this.tileProvider,
    super.key,
  });

  /// Origin, optional intermediate stops, destination.
  final List<GeoPoint> waypoints;
  final String emptyLabel;
  final String? originLabel;
  final String? destinationLabel;

  /// Labels for the intermediate waypoints, in order.
  final List<String> stopLabels;
  final List<DarbMapMarker> extraMarkers;
  final double height;
  final Color routeColor;

  /// Draw checkpoints and community reports too.
  final bool showOverlay;
  final Widget? banner;
  final double bannerElevation;

  /// Distance of the zoom controls from the top, to clear a tall [banner].
  final double? controlsTop;
  final ValueChanged<LatLng>? onTap;
  final TileProvider? tileProvider;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final overlay = showOverlay ? watchMapOverlay(ref, l10n) : null;
    final road = watchRoadRoute(ref, waypoints);
    final origin = waypoints.isEmpty ? null : waypoints.first;
    final destination = waypoints.length < 2 ? null : waypoints.last;
    final stops = waypoints.length > 2
        ? waypoints.sublist(1, waypoints.length - 1)
        : const <GeoPoint>[];

    return DarbMap(
      height: height,
      emptyLabel: emptyLabel,
      attributionLabel: l10n.mapAttribution,
      banner: banner,
      bannerElevation: bannerElevation,
      controlsTop: controlsTop,
      onTap: onTap,
      tileProvider: tileProvider,
      paths: roadRoutePaths(road, color: routeColor),
      notes: [...roadRouteNotes(l10n, road), ...?overlay?.notes],
      markers: [
        ...?overlay?.markers,
        for (var i = 0; i < stops.length; i++)
          DarbMapMarker(
            position: stops[i],
            icon: Icons.circle,
            color: SemanticColors.parcel,
            label: l10n.mapStopLabel(
              i < stopLabels.length ? stopLabels[i] : '${i + 1}',
            ),
            size: 22,
          ),
        if (origin != null)
          DarbMapMarker(
            position: origin,
            icon: Icons.trip_origin_rounded,
            color: SemanticColors.upcomingRoute,
            label: l10n.mapOriginLabel(originLabel ?? ''),
            size: 36,
          ),
        if (destination != null)
          DarbMapMarker(
            position: destination,
            icon: Icons.flag_rounded,
            color: SemanticColors.completedRoute,
            type: DarbMapMarkerType.destination,
            label: l10n.mapDestinationLabel(destinationLabel ?? ''),
            size: 36,
          ),
        ...extraMarkers,
      ],
    );
  }
}

/// A catalogue route on the map: its road (published geometry, or routed
/// through its stops), every stop named from the route's own data, and the
/// shared checkpoint and community layers. [highlightIds] marks chosen stops.
class CanonicalRouteMap extends ConsumerWidget {
  const CanonicalRouteMap({
    required this.route,
    this.highlightIds = const {},
    this.height = 240,
    super.key,
  });

  final CanonicalRoute route;
  final Set<String> highlightIds;
  final double height;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final overlay = watchMapOverlay(ref, l10n);
    final road = watchCanonicalRoute(ref, route);
    final first = route.originStop;
    final last = route.destinationStop;

    String label(CanonicalStop stop) {
      final name = arabic ? stop.nameAr : stop.nameEn;
      if (stop.id == first?.id) return l10n.mapOriginLabel(name);
      if (stop.id == last?.id) return l10n.mapDestinationLabel(name);
      return l10n.mapStopLabel(name);
    }

    return DarbMap(
      height: height,
      emptyLabel: l10n.mapRouteMissingCoordinates,
      attributionLabel: l10n.mapAttribution,
      paths: roadRoutePaths(road),
      notes: [...roadRouteNotes(l10n, road), ...overlay.notes],
      markers: [
        ...overlay.markers,
        for (final stop in route.stops)
          if (stop.position != null)
            DarbMapMarker(
              position: stop.position!,
              icon: stop.id == first?.id
                  ? Icons.trip_origin_rounded
                  : stop.id == last?.id
                  ? Icons.flag_rounded
                  : Icons.circle,
              color: highlightIds.contains(stop.id)
                  ? SemanticColors.action
                  : stop.id == last?.id
                  ? SemanticColors.completedRoute
                  : SemanticColors.parcel,
              label: label(stop),
              size:
                  highlightIds.contains(stop.id) ||
                      stop.id == first?.id ||
                      stop.id == last?.id
                  ? 32
                  : 22,
            ),
      ],
    );
  }
}
