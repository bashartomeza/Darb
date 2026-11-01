import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/maps/checkpoint_map_markers.dart';
import 'package:masari_mobile/core/maps/osrm_route_service.dart';
import 'package:masari_mobile/core/theme/semantic_colors.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';

Checkpoint _cp(String status, {double lat = 31.7, double lng = 35.2}) =>
    Checkpoint(
      id: status,
      position: GeoPoint(lat, lng),
      nameAr: 'حاجز',
      status: parseCheckpointStatus(status),
    );

void main() {
  const red = Color(0xFFEB3223);
  const green = Color(0xFF3A7C07);
  const orange = Color(0xFFFA5F12);
  const unknownGrey = Color(0xFF64748B);

  test('palette constants match the Darb checkpoint colours', () {
    expect(SemanticColors.checkpointClosed, red);
    expect(SemanticColors.checkpointOpen, green);
    expect(SemanticColors.checkpointCongested, orange);
  });

  test('status maps to red closed, green open, orange congestion', () {
    for (final s in ['closed', 'blocked', 'مغلق']) {
      expect(checkpointTrafficMarker(_cp(s)).color, red, reason: s);
    }
    for (final s in ['open', 'clear', 'سالك', 'مفتوح']) {
      expect(checkpointTrafficMarker(_cp(s)).color, green, reason: s);
    }
    for (final s in ['congested', 'busy', 'أزمة متوسطة', 'ازدحام']) {
      expect(checkpointTrafficMarker(_cp(s)).color, orange, reason: s);
    }
  });

  test('unknown status gets neutral colour and does not throw', () {
    for (final s in ['', 'weird', '???']) {
      final marker = checkpointTrafficMarker(_cp(s));
      expect(marker.color, unknownGrey);
      expect(marker.icon, Icons.signpost_rounded);
    }
  });

  test('marker sits at the checkpoint coordinates', () {
    final marker = checkpointTrafficMarker(_cp('open', lat: 31.5, lng: 35.1));
    expect(marker.position, const GeoPoint(31.5, 35.1));
  });

  test('invalid coordinates are skipped by the shared builder', () {
    final markers = checkpointTrafficMarkers([
      _cp('open'),
      _cp('closed', lat: 0, lng: 0),
      _cp('closed', lat: 91, lng: 35),
      _cp('closed', lat: 31, lng: 181),
      _cp('closed', lat: double.nan, lng: 35),
      _cp('closed', lat: 31, lng: double.infinity),
      _cp('congested', lat: 32, lng: 35.3),
    ]);
    expect(markers.map((m) => m.position.latitude), [31.7, 32]);
  });

  test('parsing drops entries with null or out-of-range coordinates', () {
    final snapshot = CheckpointSnapshot.fromJson({
      'checkpoints': [
        {'id': 'a', 'latitude': 31.7, 'longitude': 35.2, 'status': 'closed'},
        {'id': 'b', 'latitude': null, 'longitude': 35.2, 'status': 'open'},
        {'id': 'c', 'latitude': 95, 'longitude': 35.2, 'status': 'open'},
        {'id': 'd', 'latitude': 31.7, 'longitude': 35.2, 'status': 'zzz'},
        'garbage',
      ],
    });
    expect(snapshot.checkpoints.map((c) => c.id), ['a', 'd']);
    final markers = checkpointTrafficMarkers(snapshot.checkpoints);
    expect(markers.map((m) => m.color), [red, unknownGrey]);
  });

  test('route cache key ignores GPS jitter below ~100 m', () {
    expect(routeCoordKey(31.50001), routeCoordKey(31.50004));
    expect(routeCoordKey(31.5), isNot(routeCoordKey(31.52)));
  });
}
