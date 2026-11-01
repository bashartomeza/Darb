import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/features/legacy_corridor/data/legacy_corridor_models.dart';
import 'package:darb_mobile/features/legacy_corridor/data/legacy_corridor_repository.dart';

import 'support/auth_test_support.dart';
import 'support/legacy_corridor_fixture.dart';

void main() {
  group('legacy corridor repository', () {
    test('reads the corridor, its driver route and its stops', () async {
      final requests = <http.Request>[];
      final repository = LegacyCorridorRepository(
        apiClient: TestAuthenticatedClient(
          handler: (request) async {
            requests.add(request);
            return corridorResponse();
          },
        ).client,
      );

      final corridor = await repository.fetch();

      expect(requests.single.method, 'GET');
      expect(requests.single.url.path, '/api/v1/legacy-corridor');
      expect(corridor.key, corridorKey);
      expect(corridor.displayName(arabic: true), corridorNameAr);
      expect(corridor.displayName(arabic: false), corridorNameEn);
      expect(corridor.driverRoute.originLabel, corridorOriginLabel);
      expect(corridor.driverRoute.originLat, corridorOriginLat);
      expect(corridor.driverRoute.destinationLabel, corridorDestinationLabel);
      expect(corridor.driverRoute.destinationLng, corridorDestinationLng);
      expect(corridor.stops.map((stop) => stop.key), [
        'demo-bab-al-zawiya',
        'demo-ppu-main-gate',
        'demo-bethlehem-center',
      ]);
      // Each use offers only the stops the route version allows for it.
      expect(corridor.passengerPickups.map((stop) => stop.key), [
        'demo-bab-al-zawiya',
        'demo-ppu-main-gate',
      ]);
      expect(corridor.passengerDropoffs.map((stop) => stop.key), [
        'demo-bethlehem-center',
      ]);
      expect(corridor.parcelPickups.single.key, 'demo-bab-al-zawiya');
      expect(corridor.parcelDropoffs.single.key, 'demo-bethlehem-center');
      final ppu = corridor.stops[1];
      expect(ppu.label, 'PPU Main Gate');
      expect(ppu.displayName(arabic: true), 'بوابة جامعة بوليتكنك فلسطين');
      expect(ppu.lat, 31.55);
      expect(ppu.lng, 35.1);
    });

    test('an unpublished corridor offers no places', () {
      final corridor = LegacyCorridor.fromJson({
        'key': corridorKey,
        'route_version_id': null,
        'name_ar': null,
        'name_en': corridorNameEn,
        'driver_route': {
          'origin_label': corridorOriginLabel,
          'origin_lat': corridorOriginLat,
          'origin_lng': corridorOriginLng,
          'destination_label': corridorDestinationLabel,
          'destination_lat': corridorDestinationLat,
          'destination_lng': corridorDestinationLng,
        },
        'stops': <Object>[],
      });

      expect(corridor.stops, isEmpty);
      expect(corridor.parcelPickups, isEmpty);
      expect(corridor.passengerDropoffs, isEmpty);
      // Without an Arabic name the English one is shown rather than nothing.
      expect(corridor.displayName(arabic: true), corridorNameEn);
    });

    test('a malformed reply is rejected', () async {
      final repository = LegacyCorridorRepository(
        apiClient: TestAuthenticatedClient(
          handler: (_) async => http.Response('{"corridor":{"key":"x"}}', 200),
        ).client,
      );

      await expectLater(repository.fetch(), throwsFormatException);
    });
  });
}
