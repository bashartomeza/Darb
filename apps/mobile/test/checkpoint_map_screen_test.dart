import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/location/location_service.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/passenger/application/passenger_map_controller.dart';
import 'package:masari_mobile/features/passenger/presentation/passenger_map_alerts_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/checkpoint_test_harness.dart';

void main() {
  testWidgets(
    'canonical congestion contributes to the checkpoint browser count',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2600);
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
          ],
        ),
      );
      h.checkpointHandler = (_) async => CheckpointTestHarness.response({
        'checkpoints': [
          {
            'id': 'traffic',
            'latitude': 31.7,
            'longitude': 35.2,
            'status': 'congested',
          },
        ],
      });
      await tester.runAsync(() async {
        await h.login();
        await h.load();
      });
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: h.container,
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PassengerMapAlertsScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final label = find.text('حواجز عليها ازدحام');
      expect(label, findsOneWidget);
      final metric = find
          .ancestor(of: label, matching: find.byType(Column))
          .first;
      expect(
        find.descendant(of: metric, matching: find.text('1')),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      h.dispose();
    },
  );

  testWidgets(
    'base map renders while optional route and assignment data are pending',
    (tester) async {
      final pending = Completer<PassengerMapView>();
      final h = CheckpointTestHarness(
        containerFactory: (fixture) => ProviderContainer(
          overrides: [
            ...fixture.overrides,
            passengerMapViewProvider.overrideWith((ref) => pending.future),
            currentPositionProvider.overrideWith(_NoPosition.new),
          ],
        ),
      );
      h.checkpointHandler = (_) async =>
          CheckpointTestHarness.response({'checkpoints': []});
      await tester.runAsync(() async {
        await h.login();
        await h.load();
      });
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: h.container,
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PassengerMapAlertsScreen(),
          ),
        ),
      );
      await tester.pump();
      try {
        expect(find.byType(MasariMap), findsOneWidget);
      } finally {
        pending.complete(
          const PassengerMapView(
            mapsAvailable: true,
            checkpointsAvailable: true,
          ),
        );
        await tester.pumpWidget(const SizedBox.shrink());
        h.dispose();
      }
    },
  );
}

class _NoPosition extends CurrentPositionNotifier {
  @override
  Future<GeoPoint?> build() async => null;
}
