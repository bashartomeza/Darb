import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/maps/checkpoint_map_markers.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/checkpoints/data/checkpoint_repository.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';

import 'support/auth_test_support.dart';

void main() {
  Map<String, dynamic> row({
    Object? lat = 31.7,
    Object? lng = 35.2,
    String status = 'closed',
  }) => {
    'id': 'canonical-checkpoint',
    'name_ar': 'حاجز اختبار',
    'name_en': 'Test gate',
    'latitude': lat,
    'longitude': lng,
    'status': status,
    'updated_at': '2026-10-16T09:00:00Z',
  };

  test(
    'authenticated checkpoint API preserves canonical names coordinates and traffic color',
    () async {
      final client = TestAuthenticatedClient(
        handler: (request) async {
          expect(request.url.path, '/api/v1/checkpoints');
          expect(request.headers['authorization'], startsWith('Bearer '));
          return http.Response(
            jsonEncode({
              'checkpoints': [row()],
              'fetched_at': '2026-10-16T09:01:00Z',
              'stale': false,
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        },
      );
      final result = await CheckpointRepository(
        apiClient: client.client,
      ).checkpoints();
      final checkpoint = result.checkpoints.single;
      expect(checkpoint.position, const GeoPoint(31.7, 35.2));
      expect(checkpoint.nameAr, 'حاجز اختبار');
      expect(result.fetchedAt, DateTime.utc(2026, 10, 16, 9, 1));
      expect(
        checkpointTrafficMarker(checkpoint).color,
        const Color(0xFFDC2626),
      );
    },
  );

  test(
    'invalid or missing positions are omitted without losing valid rows',
    () {
      final result = CheckpointSnapshot.fromJson({
        'checkpoints': [
          row(),
          row(lat: null),
          row(lat: ''),
          row(lat: true),
          row(lat: 91),
          row(lng: double.nan),
          'malformed',
          {'id': 'missing-position'},
        ],
      });
      expect(result.checkpoints, hasLength(1));
      expect(result.checkpoints.single.position, const GeoPoint(31.7, 35.2));
    },
  );

  test('both maps share canonical traffic semantics including unknown', () {
    for (final entry in <String, Color>{
      'closed': const Color(0xFFDC2626),
      'مغلق': const Color(0xFFDC2626),
      'open': const Color(0xFF16A34A),
      'سالك': const Color(0xFF16A34A),
      'congested': const Color(0xFFF59E0B),
      'أزمة': const Color(0xFFF59E0B),
      'unknown': const Color(0xFF64748B),
    }.entries) {
      final checkpoint = Checkpoint.fromJson(row(status: entry.key));
      expect(
        checkpointTrafficMarker(checkpoint).color,
        entry.value,
        reason: entry.key,
      );
    }
  });
}
