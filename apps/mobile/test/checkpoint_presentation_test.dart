import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/location/location_service.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/data/session_coordinator.dart';
import 'package:masari_mobile/features/checkpoints/presentation/checkpoint_sheet.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/driver/application/driver_controller.dart';
import 'package:masari_mobile/features/driver/data/driver_models.dart';
import 'package:masari_mobile/features/driver/presentation/driver_trip_screen.dart';
import 'package:masari_mobile/features/passenger/application/passenger_map_controller.dart';
import 'package:masari_mobile/features/passenger/presentation/passenger_map_alerts_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/checkpoint_test_harness.dart';

void main() {
  for (final driver in [false, true]) {
    for (final locale in ['ar', 'en']) {
      for (final mode in [
        'marker',
        'card',
        'card-forbidden',
        'card-refresh',
        'card-network',
        'card-token-refresh',
      ]) {
        final card = mode != 'marker';
        testWidgets(
          '${driver ? 'Driver' : 'Passenger'} $locale real $mode preserves English-only name',
          (tester) async {
            tester.view.physicalSize = const Size(1280, 2600);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            final h = CheckpointTestHarness(
              containerFactory: (fixture) => ProviderContainer(
                overrides: [
                  ...fixture.overrides,
                  passengerMapViewProvider.overrideWith(
                    (ref) async => const PassengerMapView(
                      mapsAvailable: true,
                      checkpointsAvailable: true,
                    ),
                  ),
                  currentPositionProvider.overrideWith(_NoPosition.new),
                  driverTripControllerProvider(
                    'trip',
                  ).overrideWith(_FixtureDriverTrip.new),
                ],
              ),
            );
            h.role = driver ? 'driver' : 'passenger';
            h.checkpointHandler = (_) async => CheckpointTestHarness.snapshot(
              'synthetic',
              nameAr: ' \t ',
              nameEn: 'Bab Al-Zawiya -> Gate-B',
            );
            await tester.runAsync(() async {
              await h.login();
              await h.load();
            });
            await tester.pumpWidget(
              UncontrolledProviderScope(
                container: h.container,
                child: MaterialApp(
                  locale: Locale(locale),
                  localizationsDelegates:
                      AppLocalizations.localizationsDelegates,
                  supportedLocales: AppLocalizations.supportedLocales,
                  home: driver
                      ? const DriverTripScreen(tripId: 'trip')
                      : const PassengerMapAlertsScreen(),
                ),
              ),
            );
            await tester.pumpAndSettle();
            try {
              final screen = find.byType(
                driver ? DriverTripScreen : PassengerMapAlertsScreen,
              );
              expect(
                Directionality.of(tester.element(screen)),
                locale == 'ar' ? TextDirection.rtl : TextDirection.ltr,
              );
              final mapFinder = find.byType(MasariMap);
              expect(mapFinder, findsOneWidget);
              final marker = tester
                  .widget<MasariMap>(mapFinder)
                  .markers
                  .singleWhere(
                    (marker) => marker.type == MasariMapMarkerType.checkpoint,
                  );
              if (!card) {
                expect(
                  marker.label.split('\n').first,
                  'Bab Al-Zawiya -> Gate-B',
                );
                expect(marker.position, const GeoPoint(31.7, 35.2));
                final pin = find.descendant(
                  of: mapFinder,
                  matching: find.byIcon(Icons.car_crash_rounded),
                );
                await tester.ensureVisible(pin);
                await tester.tap(pin);
                await tester.pumpAndSettle();
                expect(find.text('Bab Al-Zawiya -> Gate-B'), findsOneWidget);
                await tester.runAsync(
                  () => h.container
                      .read(authControllerProvider.notifier)
                      .logout(),
                );
                await tester.pumpAndSettle();
                expect(find.byType(MasariMap), findsOneWidget);
                expect(
                  tester
                      .widget<MasariMap>(mapFinder)
                      .markers
                      .where(
                        (marker) =>
                            marker.type == MasariMapMarkerType.checkpoint,
                      ),
                  isEmpty,
                );
                expect(find.text('Bab Al-Zawiya -> Gate-B'), findsNothing);
              } else {
                // Both existing checkpoint browsers group by the authoritative city.
                // Open their existing city action, then inspect the actual card.
                final city = find.text('Synthetic city');
                {
                  final browser = find.text(
                    driver
                        ? (locale == 'ar' ? 'الحواجز' : 'Barriers')
                        : 'الحواجز على الطريق',
                  );
                  await tester.ensureVisible(browser);
                  await tester.tap(browser);
                  await tester.pumpAndSettle();
                }
                await tester.ensureVisible(city.first);
                await tester.tap(city.first);
                await tester.pumpAndSettle();
                expect(find.text('Bab Al-Zawiya -> Gate-B'), findsWidgets);
                await tester.runAsync(() async {
                  if (mode == 'card-token-refresh') {
                    await h.container
                        .read(authSessionCoordinatorProvider)
                        .refresh();
                  } else if (mode == 'card-refresh' || mode == 'card-network') {
                    if (mode == 'card-network') {
                      h.checkpointHandler = (_) async =>
                          CheckpointTestHarness.response({
                            'error': 'temporary',
                          }, 503);
                    }
                    await h.refresh();
                  } else if (mode == 'card-forbidden') {
                    h.checkpointHandler = (_) async =>
                        CheckpointTestHarness.response({
                          'error': 'checkpoint_access_denied',
                        }, 403);
                    await h.refresh();
                  } else {
                    await h.container
                        .read(authControllerProvider.notifier)
                        .logout();
                  }
                });
                await tester.pumpAndSettle();
                expect(
                  find.text('Bab Al-Zawiya -> Gate-B'),
                  [
                        'card-refresh',
                        'card-network',
                        'card-token-refresh',
                      ].contains(mode)
                      ? findsWidgets
                      : findsNothing,
                );
              }
            } finally {
              await tester.pumpWidget(const SizedBox.shrink());
              h.dispose();
            }
          },
        );
      }
    }
  }

  testWidgets('stale sheet tap cannot relabel A records as belonging to B', (
    tester,
  ) async {
    final h = CheckpointTestHarness();
    final records = await tester.runAsync(() async {
      await h.login();
      final a = await h.load();
      await h.container.read(authControllerProvider.notifier).logout();
      await h.login('actor-b');
      await h.load();
      return a.checkpoints;
    });
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: h.container,
        child: MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => unawaited(
                  showCheckpointSheet<void>(
                    context: context,
                    checkpoints: records!,
                    builder: (_) => const Text('obsolete-private-A'),
                  ),
                ),
                child: const Text('stale tap'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('stale tap'));
    await tester.pumpAndSettle();
    expect(find.text('obsolete-private-A'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    h.dispose();
  });

  testWidgets(
    'invalidating a checkpoint sheet preserves an unrelated covering dialog',
    (tester) async {
      final h = CheckpointTestHarness();
      final records = await tester.runAsync(() async {
        await h.login();
        return (await h.load()).checkpoints;
      });
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: h.container,
          child: MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => unawaited(
                    showCheckpointSheet<void>(
                      context: context,
                      checkpoints: records!,
                      builder: (sheetContext) => Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('private-A'),
                          TextButton(
                            onPressed: () => unawaited(
                              showDialog<void>(
                                context: sheetContext,
                                builder: (_) => const AlertDialog(
                                  content: Text('unrelated-control'),
                                ),
                              ),
                            ),
                            child: const Text('cover'),
                          ),
                        ],
                      ),
                    ),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('cover'));
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => h.container.read(authControllerProvider.notifier).logout(),
      );
      await tester.pumpAndSettle();
      expect(find.text('unrelated-control'), findsOneWidget);
      expect(find.text('private-A', skipOffstage: false), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      h.dispose();
    },
  );
}

class _NoPosition extends CurrentPositionNotifier {
  @override
  Future<GeoPoint?> build() async => null;
}

class _FixtureDriverTrip extends DriverTripController {
  _FixtureDriverTrip() : super('trip');
  @override
  Future<DriverTripState> build() async => DriverTripState(
    trip: DriverTrip.fromJson({
      'id': 'trip',
      'status': 'accepted',
      'created_at': '2026-10-23T00:00:00Z',
      'driver_route': {
        'id': 'route',
        'origin_label': 'Origin',
        'destination_label': 'Destination',
        'origin_lat': 31.6,
        'origin_lng': 35.1,
        'destination_lat': 31.8,
        'destination_lng': 35.3,
        'corridor_key': 'legacy',
        'seats_available': 3,
        'parcel_capacity_available': 1,
        'status': 'assigned',
      },
    }),
    location: null,
  );
}
