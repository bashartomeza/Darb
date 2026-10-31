import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/checkpoint_directory/presentation/checkpoint_directory_screen.dart';
import 'package:masari_mobile/features/checkpoint_directory/application/checkpoint_directory_controller.dart';
import 'package:masari_mobile/features/checkpoint_directory/domain/checkpoint_directory.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:masari_mobile/core/widgets/status_chip.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'support/checkpoint_test_harness.dart';

Map<String, dynamic> directory() => {
  'schema_version': 1,
  'version': 'synthetic-v1',
  'dataset_role': 'RESEARCH_DIRECTORY_ONLY',
  'count': 3,
  'city_count': 2,
  'checkpoints': [
    for (var i = 0; i < 3; i++)
      {
        'research_row_key': 'synthetic-$i',
        'city_ar': i < 2 ? 'مدينة تجريبية أ' : 'مدينة تجريبية ب',
        'city_slug': i < 2 ? 'test-a' : 'test-b',
        'checkpoint_name_ar': i == 1 ? 'بوابة تجريبية' : 'اسم تجريبي مكرر',
        'provider_checkpoint_id': null,
        'latitude': null,
        'longitude': null,
        'coordinate_verified': false,
        'provider_id_verified': false,
        'ready_for_map': false,
        'traffic_status': 'unavailable',
      },
  ],
};

Future<void> pump(
  WidgetTester tester,
  CheckpointTestHarness h,
  String locale,
) async {
  await tester.runAsync(h.login);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: h.container,
      child: MaterialApp(
        locale: Locale(locale),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: CheckpointDirectoryAction()),
      ),
    ),
  );
  await tester.runAsync(CheckpointTestHarness.flush);
  await tester.pumpAndSettle();
}

void main() {
  test(
    'research records preserve Arabic, punctuation and distinct identities without map conversion',
    () {
      final json = directory();
      ((json['checkpoints'] as List)[0] as Map)['checkpoint_name_ar'] =
          'اسم-تجريبي / بوابة → أ';
      final value = CheckpointDirectory.fromJson(json);
      expect(value.records.first.nameAr, 'اسم-تجريبي / بوابة → أ');
      expect(value.records.map((row) => row.researchKey).toSet().length, 3);
      expect(
        value.records.every(
          (row) => !row.readyForMap && row.trafficStatus == 'unavailable',
        ),
        isTrue,
      );
      expect(CheckpointSnapshot.fromJson(json).checkpoints, isEmpty);
    },
  );
  for (final change in [
    'latitude',
    'longitude',
    'provider_checkpoint_id',
    'ready_for_map',
    'traffic_status',
    'duplicate-key',
    'count',
    'city-count',
  ]) {
    test('directory rejects unsafe or inconsistent $change', () {
      final json = directory();
      final rows = json['checkpoints'] as List;
      if (change == 'duplicate-key') {
        (rows[1] as Map)['research_row_key'] =
            (rows[0] as Map)['research_row_key'];
      } else if (change == 'count') {
        json['count'] = 2;
      } else if (change == 'city-count') {
        json['city_count'] = 1;
      } else {
        (rows[0] as Map)[change] = switch (change) {
          'latitude' => 31.7,
          'longitude' => 35.2,
          'ready_for_map' => true,
          'traffic_status' => 'open',
          _ => 'invented-provider-id',
        };
      }
      expect(() => CheckpointDirectory.fromJson(json), throwsFormatException);
    });
  }
  for (final role in ['passenger', 'driver']) {
    for (final locale in ['ar', 'en']) {
      testWidgets(
        '$role $locale disabled directory hides entry and never reads records',
        (tester) async {
          var reads = 0;
          final h = CheckpointTestHarness()..role = role;
          h.extraHandler = (request) async {
            if (request.url.path.endsWith('/capabilities')) {
              return CheckpointTestHarness.response({
                'checkpoint_directory_available': false,
              });
            }
            reads++;
            return CheckpointTestHarness.response(directory());
          };
          await pump(tester, h, locale);
          expect(find.byIcon(Icons.list_alt_rounded), findsNothing);
          expect(reads, 0);
          await tester.pumpWidget(const SizedBox.shrink());
          h.dispose();
        },
      );
      testWidgets(
        '$role $locale Arabic directory searches cities and preserves duplicate records',
        (tester) async {
          final h = CheckpointTestHarness()..role = role;
          h.extraHandler = (request) async => CheckpointTestHarness.response(
            request.url.path.endsWith('/capabilities')
                ? {'checkpoint_directory_available': true}
                : directory(),
          );
          await pump(tester, h, locale);
          await tester.tap(find.byIcon(Icons.list_alt_rounded));
          await tester.runAsync(CheckpointTestHarness.flush);
          await tester.pumpAndSettle();
          expect(find.text('اسم تجريبي مكرر'), findsNWidgets(2));
          expect(find.text('مدينة تجريبية أ'), findsWidgets);
          expect(find.text('مدينة تجريبية ب'), findsWidgets);
          expect(find.byKey(const ValueKey('synthetic-0')), findsOneWidget);
          expect(find.byKey(const ValueKey('synthetic-2')), findsOneWidget);
          expect(find.byType(MasariMap), findsNothing);
          expect(find.byType(StatusChip), findsNothing);
          expect(find.text('Open'), findsNothing);
          expect(find.text('سالك'), findsNothing);
          expect(
            find.text(
              locale == 'ar'
                  ? 'حالة المرور غير متاحة'
                  : 'Traffic status unavailable',
            ),
            findsNWidgets(3),
          );
          await tester.enterText(find.byType(TextField), 'مكرر');
          await tester.pump();
          expect(find.text('اسم تجريبي مكرر'), findsNWidgets(2));
          expect(find.text('بوابة تجريبية'), findsNothing);
          await tester.enterText(find.byType(TextField), 'مدينة تجريبية ب');
          await tester.pump();
          expect(find.byKey(const ValueKey('synthetic-2')), findsOneWidget);
          expect(find.byKey(const ValueKey('synthetic-0')), findsNothing);
          await tester.runAsync(
            () => h.container.read(authControllerProvider.notifier).logout(),
          );
          await tester.pumpAndSettle();
          expect(find.text('اسم تجريبي مكرر'), findsNothing);
          expect(find.byType(TextField), findsNothing);
          await tester.pumpWidget(const SizedBox.shrink());
          h.dispose();
        },
      );
    }
  }
  testWidgets(
    'a late A directory response cannot replace pending B after an account switch',
    (tester) async {
      final h = CheckpointTestHarness();
      final a = h.delay(), b = h.delay();
      h.extraHandler = (request) {
        if (request.url.path.endsWith('/capabilities')) {
          return Future.value(
            CheckpointTestHarness.response({
              'checkpoint_directory_available': true,
            }),
          );
        }
        return request.headers['authorization']!.contains('actor-a')
            ? a.future
            : b.future;
      };
      await pump(tester, h, 'ar');
      await tester.tap(find.byIcon(Icons.list_alt_rounded));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pump();
      await tester.runAsync(() async {
        await h.container.read(authControllerProvider.notifier).logout();
        await h.login('actor-b');
      });
      await tester.pump();
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pump();
      a.complete(CheckpointTestHarness.response(directory()));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pump();
      expect(find.text('اسم تجريبي مكرر'), findsNothing);
      b.complete(CheckpointTestHarness.response(directory()));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.text('اسم تجريبي مكرر'), findsNWidgets(2));
      await tester.pumpWidget(const SizedBox.shrink());
      h.dispose();
    },
  );
  testWidgets(
    'capability withdrawal hides previously loaded records without retaining values',
    (tester) async {
      final h = CheckpointTestHarness();
      var available = true;
      h.extraHandler = (request) async => CheckpointTestHarness.response(
        request.url.path.endsWith('/capabilities')
            ? {'checkpoint_directory_available': available}
            : directory(),
      );
      await pump(tester, h, 'en');
      await tester.tap(find.byIcon(Icons.list_alt_rounded));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.text('اسم تجريبي مكرر'), findsNWidgets(2));
      available = false;
      final owner = h.container.read(checkpointDirectoryOwnerProvider)!;
      h.container.invalidate(checkpointDirectoryCapabilityProvider(owner));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.text('اسم تجريبي مكرر'), findsNothing);
      expect(find.byType(TextField), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      h.dispose();
    },
  );
  for (final status in [401, 403, 503]) {
    testWidgets(
      '$status directory failure remains a real error without false success',
      (tester) async {
        final h = CheckpointTestHarness();
        h.extraHandler = (request) async =>
            request.url.path.endsWith('/capabilities')
            ? CheckpointTestHarness.response({
                'checkpoint_directory_available': true,
              })
            : CheckpointTestHarness.response({
                'error': 'synthetic-directory-failure',
              }, status);
        await pump(tester, h, 'en');
        await tester.tap(find.byIcon(Icons.list_alt_rounded));
        await tester.runAsync(CheckpointTestHarness.flush);
        await tester.pumpAndSettle();
        expect(
          find.text('Checkpoint directory could not be loaded.'),
          findsOneWidget,
        );
        expect(find.text('اسم تجريبي مكرر'), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        h.dispose();
      },
    );
  }
}
