import '../../canonical_routes/domain/canonical_route_models.dart';
import 'map_place.dart';

/// Places drawn as one pin. A cluster of one is just the place.
class PlaceCluster {
  const PlaceCluster(this.members, this.center);

  final List<MapPlace> members;
  final GeoPoint center;

  bool get single => members.length == 1;
  MapPlace get first => members.first;
}

/// Groups [places] on a square grid, coarsening the grid until there are at most
/// [maxMarkers] groups, so a dense city never puts hundreds of widgets on the
/// map. Places of different categories are never merged. Deterministic and
/// independent of the order of [places].
List<PlaceCluster> clusterPlaces(
  List<MapPlace> places, {
  int maxMarkers = 80,
  double startCell = 0.002,
}) {
  if (places.isEmpty) return const [];
  final sorted = [...places]..sort((a, b) => a.id.compareTo(b.id));
  var cell = startCell;
  while (true) {
    final groups = <String, List<MapPlace>>{};
    for (final place in sorted) {
      final row = (place.position.latitude / cell).floor();
      final column = (place.position.longitude / cell).floor();
      groups.putIfAbsent('${place.category}|$row|$column', () => []).add(place);
    }
    // At the coarsest grid (about 1 degree) everything left is one pin per
    // category, however many there are.
    if (groups.length <= maxMarkers || cell >= 1) {
      final clusters = [
        for (final members in groups.values)
          PlaceCluster(members, _centroid(members)),
      ]..sort((a, b) => a.first.id.compareTo(b.first.id));
      return clusters;
    }
    cell *= 2;
  }
}

GeoPoint _centroid(List<MapPlace> members) {
  var lat = 0.0, lng = 0.0;
  for (final member in members) {
    lat += member.position.latitude;
    lng += member.position.longitude;
  }
  return GeoPoint(lat / members.length, lng / members.length);
}
