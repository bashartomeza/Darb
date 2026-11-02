import 'package:flutter/material.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/maps/darb_route_map.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/darb_map.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../data/merchant_models.dart';

/// The order's own route (pickup, then each parcel drop-off), with checkpoints.
class MerchantOrderRouteMap extends StatelessWidget {
  const MerchantOrderRouteMap({
    required this.order,
    this.vehicle,
    this.height = 240,
    super.key,
  });

  final MerchantOrder order;

  /// Latest vehicle position, when the trip reports one.
  final GeoPoint? vehicle;
  final double height;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final waypoints = order.routeWaypoints;
    final drops = order.routeDropLabels;
    return DarbRouteMap(
      height: height,
      emptyLabel: l10n.mapRouteMissingCoordinates,
      waypoints: waypoints,
      originLabel: order.pickupLabel,
      destinationLabel: drops.isEmpty ? null : drops.last,
      stopLabels: drops.length > 1
          ? drops.sublist(0, drops.length - 1)
          : const [],
      extraMarkers: [
        if (vehicle != null)
          DarbMapMarker(
            position: vehicle!,
            icon: Icons.local_shipping_rounded,
            color: SemanticColors.action,
            type: DarbMapMarkerType.driver,
            label: l10n.latestLocation,
            size: 44,
          ),
      ],
    );
  }
}
