import 'package:darb_mobile/core/maps/darb_route_map.dart';
import 'package:darb_mobile/core/maps/maps_config.dart';
import 'package:darb_mobile/core/maps/osrm_route_service.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

const _a = LatLng(31.5326, 35.0998);
const _b = LatLng(31.7054, 35.2024);

http.Response _road() => http.Response(
  '{"code":"Ok","routes":[{"duration":600,"distance":9000,'
  '"geometry":{"coordinates":[[35.0998,31.5326],[35.2024,31.7054]]}}]}',
  200,
);

void main() {
  group('MapsConfig', () {
    test('public demo servers are allowed in local, test and demo', () {
      for (final env in ['local', 'test', 'demo']) {
        final c = MapsConfig.fromValues(appEnvironment: env);
        expect(c.routingSource, RoutingSource.direct, reason: env);
        expect(c.routingBaseUrl, MapsConfig.publicRoutingBaseUrl);
        expect(c.tileUrlTemplate, MapsConfig.publicTileUrlTemplate);
      }
    });

    test('production without config uses the API proxy and has no tiles', () {
      final c = MapsConfig.fromValues(appEnvironment: 'production');
      expect(c.routingSource, RoutingSource.api);
      expect(c.routingBaseUrl, isNull);
      expect(c.tileUrlTemplate, isNull);
      expect(c.tilesAvailable, isFalse);
    });

    test('production refuses the public demo servers when set explicitly', () {
      final c = MapsConfig.fromValues(
        appEnvironment: 'production',
        routingBaseUrl: 'https://router.project-osrm.org',
        tileUrlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      );
      expect(c.routingSource, RoutingSource.disabled);
      expect(c.tileUrlTemplate, isNull);
      final sub = MapsConfig.fromValues(
        appEnvironment: 'staging',
        tileUrlTemplate: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      );
      expect(sub.tileUrlTemplate, isNull);
    });

    test('production accepts configured https providers and attribution', () {
      final c = MapsConfig.fromValues(
        appEnvironment: 'production',
        routingBaseUrl: 'https://routing.darb.example/',
        tileUrlTemplate: 'https://tiles.darb.example/{z}/{x}/{y}.png',
        tileAttribution: '  © OpenStreetMap contributors © Tiles Co  ',
      );
      expect(c.routingSource, RoutingSource.direct);
      expect(c.routingBaseUrl, 'https://routing.darb.example');
      expect(c.tileUrlTemplate, 'https://tiles.darb.example/{z}/{x}/{y}.png');
      expect(c.tileAttribution, '© OpenStreetMap contributors © Tiles Co');
    });

    test('production rejects http and templates missing placeholders', () {
      final c = MapsConfig.fromValues(
        appEnvironment: 'production',
        routingBaseUrl: 'http://routing.darb.example',
        tileUrlTemplate: 'https://tiles.darb.example/tile.png',
      );
      expect(c.routingSource, RoutingSource.disabled);
      expect(c.tileUrlTemplate, isNull);
      expect(
        MapsConfig.fromValues(
          appEnvironment: 'production',
          tileUrlTemplate: 'http://tiles.darb.example/{z}/{x}/{y}.png',
        ).tileUrlTemplate,
        isNull,
      );
    });

    test('an unknown environment is treated like production', () {
      final c = MapsConfig.fromValues(appEnvironment: 'whatever');
      expect(c.routingSource, RoutingSource.api);
      expect(c.tileUrlTemplate, isNull);
    });
  });

  group('routing source', () {
    test('disabled routing sends no request', () async {
      var calls = 0;
      final service = OsrmRouteService(
        config: MapsConfig.fromValues(
          appEnvironment: 'production',
          routingBaseUrl: 'https://router.project-osrm.org',
        ),
        client: MockClient((_) async {
          calls++;
          return _road();
        }),
      );
      expect(service.available, isFalse);
      await expectLater(
        service.getRoute(start: _a, end: _b),
        throwsA(isA<RoutingUnavailableException>()),
      );
      expect(calls, 0);
    });

    test('a configured server is used instead of the public one', () async {
      Uri? seen;
      final service = OsrmRouteService(
        config: MapsConfig.fromValues(
          appEnvironment: 'production',
          routingBaseUrl: 'https://routing.darb.example',
        ),
        client: MockClient((request) async {
          seen = request.url;
          return _road();
        }),
      );
      final result = await service.getRoute(start: _a, end: _b);
      expect(result.points, hasLength(2));
      expect(seen!.host, 'routing.darb.example');
    });

    test('the API proxy path is used by default in production', () async {
      String? path;
      final service = OsrmRouteService(
        config: MapsConfig.fromValues(appEnvironment: 'production'),
        client: MockClient((_) async => fail('must not call a router')),
        apiGet: (p) async {
          path = p;
          return {
            'code': 'Ok',
            'routes': [
              {
                'duration': 600,
                'distance': 9000,
                'geometry': {
                  'coordinates': [
                    [35.0998, 31.5326],
                    [35.2024, 31.7054],
                  ],
                },
              },
            ],
          };
        },
      );
      final result = await service.getRoute(start: _a, end: _b);
      expect(result.distanceMeters, 9000);
      expect(path, startsWith('/api/v1/maps/route?waypoints='));
      expect(Uri.decodeQueryComponent(path!), contains('31.5326,35.0998;'));
    });

    test('an API failure surfaces as an error the map turns into a line', () {
      final service = OsrmRouteService(
        config: MapsConfig.fromValues(appEnvironment: 'production'),
        apiGet: (_) async => throw Exception('503'),
      );
      expect(service.getRoute(start: _a, end: _b), throwsException);
    });
  });

  group('straight-line fallback', () {
    test('disabled routing is labelled "route preview unavailable"', () async {
      final l10n = await AppLocalizations.delegate.load(const Locale('en'));
      final ar = await AppLocalizations.delegate.load(const Locale('ar'));
      final points = [GeoPoint(31.5, 35.1), GeoPoint(31.7, 35.2)];
      final off = RoadRoute.straight(points, routingDisabled: true);
      final failed = RoadRoute.straight(points);
      expect(roadRouteNotes(l10n, off), [l10n.mapRoutingNotConfiguredNote]);
      expect(l10n.mapRoutingNotConfiguredNote, contains('unavailable'));
      expect(roadRouteNotes(ar, off), [ar.mapRoutingNotConfiguredNote]);
      expect(roadRouteNotes(l10n, failed), [l10n.mapStraightLineNote]);
      expect(roadRoutePaths(off).single.dashed, isTrue);
    });
  });
}
