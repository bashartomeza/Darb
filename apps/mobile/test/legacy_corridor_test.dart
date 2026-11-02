import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/theme/app_theme.dart';
import 'package:darb_mobile/features/assistant/application/passenger_assistant_controller.dart';
import 'package:darb_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:darb_mobile/features/assistant/presentation/passenger_assistant_screen.dart';
import 'package:darb_mobile/features/legacy_corridor/data/legacy_corridor_models.dart';
import 'package:darb_mobile/features/legacy_corridor/data/legacy_corridor_repository.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

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

  group('assistant review card', () {
    testWidgets('offers the corridor stops and books the chosen one', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = _CapturingAssistantController(
        PassengerAssistantState(
          phase: PassengerAssistantPhase.requestReview,
          messages: const [
            PassengerAssistantMessage.passenger('من باب الزاوية إلى بيت لحم'),
          ],
          draft: PassengerAssistantTripDraft(
            pickupKey: testPickup.key,
            pickupLabel: testPickup.label,
            pickupLat: testPickup.lat,
            pickupLng: testPickup.lng,
            destinationKey: testDropoff.key,
            destinationLabel: testDropoff.label,
            destinationLat: testDropoff.lat,
            destinationLng: testDropoff.lng,
            preferredTime: DateTime.now().add(const Duration(days: 1)),
            passengerCount: 1,
          ),
        ),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            passengerAssistantControllerProvider.overrideWith(() => controller),
            legacyCorridorProvider.overrideWith((ref) async => testCorridor()),
          ],
          child: MaterialApp(
            locale: const Locale('ar'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            theme: AppTheme.light,
            home: const PassengerAssistantScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('assistantPickupField')));
      await tester.pumpAndSettle();
      // Both passenger pickup stops of the corridor, named by the server.
      expect(find.text('بوابة جامعة بوليتكنك فلسطين'), findsOneWidget);
      await tester.tap(find.text('بوابة جامعة بوليتكنك فلسطين'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('assistantConfirmSearch')),
      );
      await tester.tap(find.byKey(const ValueKey('assistantConfirmSearch')));
      await tester.pumpAndSettle();

      final searched = controller.searched!;
      expect(searched.pickupKey, 'demo-ppu-main-gate');
      expect(searched.pickupLabel, 'PPU Main Gate');
      expect(searched.pickupLat, 31.55);
      expect(searched.pickupLng, 35.1);
      expect(searched.destinationKey, testDropoff.key);
      expect(searched.destinationLat, testDropoff.lat);
    });
  });
}

class _CapturingAssistantController extends PassengerAssistantController {
  _CapturingAssistantController(this.value);

  final PassengerAssistantState value;
  PassengerAssistantTripDraft? searched;

  @override
  Future<PassengerAssistantState> build() async => value;

  @override
  Future<void> confirmAndSearch(PassengerAssistantTripDraft draft) async {
    searched = draft;
  }
}
