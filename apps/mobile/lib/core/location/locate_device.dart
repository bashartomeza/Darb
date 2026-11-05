import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/canonical_routes/domain/canonical_route_models.dart';
import '../../l10n/app_localizations.dart';
import '../maps/service_area.dart';
import 'location_service.dart';

/// Reads the device position for a map's "my location" button, asking for the
/// location permission when it has not been decided yet.
///
/// Returns null, and tells the user why in a snack bar, when there is nothing
/// to centre on: location is off, the permission is refused, the position is
/// unavailable, or it lies outside Darb's service area (the map never leaves
/// that area).
Future<GeoPoint?> locateDeviceForMap(
  BuildContext context,
  WidgetRef ref,
) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.maybeOf(context);
  String? problem;
  GeoPoint? point;
  try {
    point = await ref.read(locationServiceProvider).currentPosition();
    if (!DarbServiceArea.contains(point.latitude, point.longitude)) {
      problem = l10n.mapLocationOutsideArea;
      point = null;
    }
  } on LocationException catch (error) {
    problem = locationFailureMessage(l10n, error.failure);
  } catch (_) {
    problem = l10n.locationUnavailable;
  }
  if (problem != null) {
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(problem)));
  }
  return point;
}

/// Why there is no device position, in words the user can act on.
String locationFailureMessage(AppLocalizations l10n, LocationFailure failure) =>
    switch (failure) {
      LocationFailure.serviceDisabled => l10n.locationServiceDisabled,
      LocationFailure.permissionDenied => l10n.locationPermissionDenied,
      LocationFailure.permanentlyDenied => l10n.locationPermanentlyDenied,
      LocationFailure.unavailable => l10n.locationUnavailable,
    };
