import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/features/checkpoint_directory/presentation/checkpoint_directory_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'support/checkpoint_test_harness.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/checkpoint_directory/application/checkpoint_directory_controller.dart';
import 'package:masari_mobile/features/checkpoint_directory/application/limited_checkpoint_directory_controller.dart';
import 'package:masari_mobile/features/checkpoint_directory/domain/limited_checkpoint_directory.dart';
import 'package:masari_mobile/features/checkpoint_directory/domain/checkpoint_directory.dart';

Map<String, dynamic> limitedDirectory() => {
  'schema_version': 1,
  'dataset_role': 'LIMITED_PROVIDER_DIRECTORY',
  'limited_dataset': true,
  'max_records_per_city': 7,
  'permission_state': 'USER_REPORTED',
  'generated_at': {
    'raw': '2026-08-16T22:28:23.000Z',
    'timezone_specified': true,
  },
  'fetched_at': '2026-10-24T10:00:00.000Z',
  'count': 2,
  'city_count': 2,
  'checkpoints': [
    for (var i = 0; i < 2; i++)
      {
        'provider_checkpoint_id': 'synthetic-provider-$i',
        'checkpoint_name_ar': 'بوابة-تجريبية',
        'city_ar': i == 0 ? 'مدينة تجريبية أ' : 'مدينة تجريبية ب',
        'entering_status_last_updated': {
          'raw': '2026-08-16T18:28:32',
          'timezone_specified': false,
        },
        'leaving_status_last_updated': {
          'raw': '2026-08-16T18:28:32Z',
          'timezone_specified': true,
        },
        'latitude': null,
        'longitude': null,
        'coordinate_verified': false,
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
    'separate limited parser preserves identities and never relaxes research parser',
    () {
      final json = limitedDirectory();
      final parsed = LimitedCheckpointDirectory.fromJson(json).catalog;
      expect(parsed.rows.map((r) => r.key).toSet().length, 2);
      expect(parsed.rows.first.entering!.raw, '2026-08-16T18:28:32');
      expect(parsed.rows.first.entering!.timezoneSpecified, false);
      expect(() => CheckpointDirectory.fromJson(json), throwsFormatException);
      (json['checkpoints'] as List).first['traffic_status'] = 'open';
      expect(
        () => LimitedCheckpointDirectory.fromJson(json),
        throwsFormatException,
      );
    },
  );

  testWidgets(
    'limited capability opens existing directory without research publication or map status',
    (tester) async {
      final h = CheckpointTestHarness();
      h.extraHandler = (request) async => CheckpointTestHarness.response(
        request.url.path.endsWith('/capabilities')
            ? {
                'limited_checkpoint_directory_available': true,
                'checkpoint_directory_available': false,
              }
            : limitedDirectory(),
      );
      await tester.runAsync(h.login);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: h.container,
          child: MaterialApp(
            locale: const Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: CheckpointDirectoryAction()),
          ),
        ),
      );
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.list_alt_rounded), findsOneWidget);
      await tester.tap(find.byIcon(Icons.list_alt_rounded));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.text('بوابة-تجريبية'), findsNWidgets(2));
      expect(find.text('حالة المرور غير متاحة'), findsNWidgets(2));
      expect(find.text('سالك'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      h.dispose();
    },
  );
  testWidgets(
    'a late A limited directory response cannot replace pending B after an account switch',
    (tester) async {
      final h = CheckpointTestHarness();
      final a = h.delay(), b = h.delay();
      h.extraHandler = (request) {
        if (request.url.path.endsWith('/capabilities')) {
          return Future.value(
            CheckpointTestHarness.response({
              'limited_checkpoint_directory_available': true,
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
      a.complete(CheckpointTestHarness.response(limitedDirectory()));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pump();
      expect(find.text('بوابة-تجريبية'), findsNothing);
      b.complete(CheckpointTestHarness.response(limitedDirectory()));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.text('بوابة-تجريبية'), findsNWidgets(2));
      await tester.pumpWidget(const SizedBox.shrink());
      h.dispose();
    },
  );
  testWidgets(
    'limited capability withdrawal hides previously loaded records without retaining values',
    (tester) async {
      final h = CheckpointTestHarness();
      var available = true;
      h.extraHandler = (request) async => CheckpointTestHarness.response(
        request.url.path.endsWith('/capabilities')
            ? {'limited_checkpoint_directory_available': available}
            : limitedDirectory(),
      );
      await pump(tester, h, 'en');
      await tester.tap(find.byIcon(Icons.list_alt_rounded));
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.text('بوابة-تجريبية'), findsNWidgets(2));
      available = false;
      final owner = h.container.read(checkpointDirectoryOwnerProvider)!;
      h.container.invalidate(
        limitedCheckpointDirectoryCapabilityProvider(owner),
      );
      await tester.runAsync(CheckpointTestHarness.flush);
      await tester.pumpAndSettle();
      expect(find.text('بوابة-تجريبية'), findsNothing);
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
                'limited_checkpoint_directory_available': true,
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
        expect(find.text('بوابة-تجريبية'), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        h.dispose();
      },
    );
  }
}
