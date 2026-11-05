import 'package:flutter/material.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/widgets/darb_map.dart';
import '../domain/map_place.dart';
import '../domain/place_category.dart';
import '../domain/place_clustering.dart';

/// At most this many pins are drawn for places; beyond it nearby places merge
/// into numbered clusters, so a dense city stays fast.
const int maxPlaceMarkers = 80;

/// Map pins for [places]: one pin per place, or a cluster pin where they are
/// too many to draw. Tapping a place pin calls [onSelect] (which opens its
/// sheet); a cluster pin opens the usual callout asking to zoom in.
List<DarbMapMarker> placeMapMarkers(
  AppLocalizations l10n,
  List<MapPlace> places, {
  required void Function(MapPlace place) onSelect,
}) {
  final arabic = l10n.localeName == 'ar';
  return [
    for (final cluster in clusterPlaces(places, maxMarkers: maxPlaceMarkers))
      _marker(l10n, cluster, arabic: arabic, onSelect: onSelect),
  ];
}

DarbMapMarker _marker(
  AppLocalizations l10n,
  PlaceCluster cluster, {
  required bool arabic,
  required void Function(MapPlace place) onSelect,
}) {
  final first = cluster.first;
  final category = placeCategoryFor(first.category);
  final icon = category?.icon ?? Icons.place_rounded;
  final color = category?.color ?? const Color(0xFF607D8B);
  final categoryLabel = placeCategoryLabel(l10n, first.category);
  if (!cluster.single) {
    return DarbMapMarker(
      position: cluster.center,
      icon: Icons.workspaces_rounded,
      color: color,
      type: DarbMapMarkerType.place,
      size: 38,
      label: l10n.placeClusterLabel(cluster.members.length, categoryLabel),
    );
  }
  final name = first.name(arabic: arabic);
  return DarbMapMarker(
    position: first.position,
    icon: icon,
    color: color,
    type: DarbMapMarkerType.place,
    size: 30,
    label: name == null ? categoryLabel : '$name\n$categoryLabel',
    onTap: () => onSelect(first),
  );
}
