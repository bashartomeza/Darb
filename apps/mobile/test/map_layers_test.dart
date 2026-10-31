import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';

Map<String, dynamic> _stop(String id, double? lat, double? lng, int sequence) =>
    {
      'sequence': sequence,
      'passenger_pickup_allowed': true,
      'passenger_dropoff_allowed': true,
      'parcel_pickup_allowed': true,
      'parcel_dropoff_allowed': true,
      'stop': {
        'id': id,
        'name_ar': 'محطة اختبار $id',
        'name_en': 'Test Stop $id',
        'latitude': lat,
        'longitude': lng,
      },
    };

Map<String, dynamic> _route({
  Map<String, dynamic>? geometry,
  List<Map<String, dynamic>>? stops,
}) => {
  'id': 'route_test_1',
  'direction': 'outbound',
  'status': 'active',
  'current_version': {
    'id': 'version_test_1',
    'version_number': 1,
    'status': 'published',
    'name_ar': 'مسار اختبار',
    'name_en': 'Test Route',
    'active_from': null,
    'active_until': null,
    'stops':
        stops ??
        [
          _stop('stop_a', 31.5326, 35.0998, 1),
          _stop('stop_b', 31.6200, 35.1450, 2),
          _stop('stop_c', 31.7054, 35.2024, 3),
        ],
    'geometry': geometry,
  },
};

void main() {
  // ==========================================================================
  // ROUTE GEOMETRY
  // ==========================================================================

  group('route geometry', () {
    test('decodes published geometry and prefers it over the stop line', () {
      final route = CanonicalRoute.fromJson(
        _route(
          geometry: {
            'status': 'available',
            'ready': true,
            'encoding': 'demo-json-v1',
            'encoded':
                '[{"lat":31.5326,"lng":35.0998},'
                '{"lat":31.55,"lng":35.10},'
                '{"lat":31.7054,"lng":35.2024}]',
            'precision': 6,
            'estimated_distance_m': 21530,
            'estimated_duration_s': null,
          },
        ),
      );

      expect(route.geometry.status, RouteGeometryStatus.available);

      expect(route.geometry.distanceMeters, 21530);

      expect(route.geometry.hasPoints, isTrue);

      expect(route.path, hasLength(3));

      expect(route.path.first, const GeoPoint(31.5326, 35.0998));

      expect(route.path[1], const GeoPoint(31.55, 35.10));

      expect(route.path.last, const GeoPoint(31.7054, 35.2024));
    });

    test('falls back to the ordered stops when geometry is not ready', () {
      final route = CanonicalRoute.fromJson(
        _route(
          geometry: {
            'status': 'pending',
            'ready': false,
            'encoded': null,
            'encoding': null,
          },
        ),
      );

      expect(route.geometry.hasPoints, isFalse);

      expect(route.path, hasLength(3));

      expect(route.path.first, const GeoPoint(31.5326, 35.0998));

      expect(route.path[1], const GeoPoint(31.6200, 35.1450));

      expect(route.path.last, const GeoPoint(31.7054, 35.2024));
    });

    test('an unknown encoding does not create guessed geometry', () {
      final route = CanonicalRoute.fromJson(
        _route(
          geometry: {
            'status': 'available',
            'ready': true,
            'encoding': 'polyline6',
            'encoded': 'invalid-test-data',
            'precision': 6,
            'estimated_distance_m': null,
            'estimated_duration_s': null,
          },
        ),
      );

      expect(route.geometry.hasPoints, isFalse);

      // The route can still use the server-provided
      // ordered stops as its fallback path.
      expect(route.path, hasLength(3));
    });

    test('a route whose stops carry no coordinates is not drawable', () {
      final route = CanonicalRoute.fromJson(
        _route(
          stops: [
            _stop('stop_a', null, null, 1),
            _stop('stop_b', null, null, 2),
          ],
        ),
      );

      expect(route.path, isEmpty);

      expect(route.originStop?.id, 'stop_a');

      expect(route.destinationStop?.id, 'stop_b');
    });

    test('keeps the route stops ordered by sequence', () {
      final route = CanonicalRoute.fromJson(
        _route(
          stops: [
            _stop('stop_c', 31.7054, 35.2024, 3),
            _stop('stop_a', 31.5326, 35.0998, 1),
            _stop('stop_b', 31.6200, 35.1450, 2),
          ],
        ),
      );

      expect(route.path, hasLength(3));

      expect(route.path.first, const GeoPoint(31.5326, 35.0998));

      expect(route.path[1], const GeoPoint(31.6200, 35.1450));

      expect(route.path.last, const GeoPoint(31.7054, 35.2024));
    });
  });

  // ==========================================================================
  // CHECKPOINT SNAPSHOT
  // ==========================================================================

  group('checkpoint snapshot', () {
    test('parses checkpoint names, cities and timestamps', () {
      const checkpointName = 'Checkpoint Test';

      const checkpointCity = 'City Test';

      final enteringTime = DateTime.parse('2026-08-01T10:00:00Z');

      final leavingTime = DateTime.parse('2026-08-01T10:05:00Z');

      final fetchedTime = DateTime.parse('2026-08-01T10:10:00Z');

      final snapshot = CheckpointSnapshot.fromJson({
        'checkpoints': [
          {
            'id': 'checkpoint_1',
            'latitude': 31.7,
            'longitude': 35.2,
            'checkpoint': checkpointName,
            'city': checkpointCity,
            'entering_status_last_updated': enteringTime.toIso8601String(),
            'leaving_status_last_updated': leavingTime.toIso8601String(),
          },
        ],
        'generatedAt': fetchedTime.toIso8601String(),
      });

      expect(snapshot.checkpoints, hasLength(1));

      final checkpoint = snapshot.checkpoints.single;

      expect(checkpoint.id, 'checkpoint_1');

      expect(checkpoint.nameAr, checkpointName);

      expect(checkpoint.city, checkpointCity);

      expect(checkpoint.enteringStatusLastUpdated, enteringTime);

      expect(checkpoint.leavingStatusLastUpdated, leavingTime);

      expect(snapshot.fetchedAt, fetchedTime);
    });

    test('allows missing checkpoint timestamps', () {
      final snapshot = CheckpointSnapshot.fromJson({
        'checkpoints': [
          {
            'id': 'checkpoint_2',
            'latitude': 31.7,
            'longitude': 35.2,
            'checkpoint': 'Checkpoint Test',
            'city': 'City Test',
          },
        ],
      });

      expect(snapshot.checkpoints, hasLength(1));

      final checkpoint = snapshot.checkpoints.single;

      expect(checkpoint.id, 'checkpoint_2');

      expect(checkpoint.nameAr, 'Checkpoint Test');

      expect(checkpoint.city, 'City Test');

      expect(checkpoint.enteringStatusLastUpdated, isNull);

      expect(checkpoint.leavingStatusLastUpdated, isNull);

      expect(snapshot.fetchedAt, isNull);
    });

    test('uses empty strings when checkpoint name or city is missing', () {
      final snapshot = CheckpointSnapshot.fromJson({
        'checkpoints': [
          {'id': 'checkpoint_3', 'latitude': 31.7, 'longitude': 35.2},
        ],
      });

      final checkpoint = snapshot.checkpoints.single;

      expect(checkpoint.id, 'checkpoint_3');

      expect(checkpoint.nameAr, isEmpty);

      expect(checkpoint.city, isEmpty);

      expect(checkpoint.enteringStatusLastUpdated, isNull);

      expect(checkpoint.leavingStatusLastUpdated, isNull);
    });

    test('parses null timestamp values as null', () {
      final snapshot = CheckpointSnapshot.fromJson({
        'checkpoints': [
          {
            'id': 'checkpoint_4',
            'latitude': 31.7,
            'longitude': 35.2,
            'checkpoint': 'Checkpoint Test',
            'city': 'City Test',
            'entering_status_last_updated': null,
            'leaving_status_last_updated': null,
          },
        ],
        'generatedAt': null,
      });

      final checkpoint = snapshot.checkpoints.single;

      expect(checkpoint.enteringStatusLastUpdated, isNull);

      expect(checkpoint.leavingStatusLastUpdated, isNull);

      expect(snapshot.fetchedAt, isNull);
    });

    test('ignores invalid timestamp strings', () {
      final snapshot = CheckpointSnapshot.fromJson({
        'checkpoints': [
          {
            'id': 'checkpoint_5',
            'latitude': 31.7,
            'longitude': 35.2,
            'checkpoint': 'Checkpoint Test',
            'city': 'City Test',
            'entering_status_last_updated': 'invalid-date',
            'leaving_status_last_updated': 'not-a-date',
          },
        ],
        'generatedAt': 'invalid-generated-date',
      });

      final checkpoint = snapshot.checkpoints.single;

      expect(checkpoint.enteringStatusLastUpdated, isNull);

      expect(checkpoint.leavingStatusLastUpdated, isNull);

      expect(snapshot.fetchedAt, isNull);
    });

    test('rejects a checkpoint without a valid id', () {
      expect(
        () => Checkpoint.fromJson({
          'id': '',
          'latitude': 31.7,
          'longitude': 35.2,
        }),
        throwsFormatException,
      );
    });

    test('rejects a checkpoint with a non-string id', () {
      expect(
        () => Checkpoint.fromJson({
          'id': 123,
          'latitude': 31.7,
          'longitude': 35.2,
        }),
        throwsFormatException,
      );
    });

    test('rejects a response without checkpoints', () {
      expect(
        () => CheckpointSnapshot.fromJson({'checkpoints': null}),
        throwsFormatException,
      );
    });

    test('rejects a response with a non-list checkpoints value', () {
      expect(
        () => CheckpointSnapshot.fromJson({'checkpoints': 'invalid'}),
        throwsFormatException,
      );
    });

    test('omits an invalid checkpoint item', () {
      expect(
        CheckpointSnapshot.fromJson({
          'checkpoints': ['invalid'],
        }).checkpoints,
        isEmpty,
      );
    });

    test('supports an empty checkpoint list', () {
      final snapshot = CheckpointSnapshot.fromJson({'checkpoints': []});

      expect(snapshot.checkpoints, isEmpty);

      expect(snapshot.fetchedAt, isNull);
    });
  });
}
