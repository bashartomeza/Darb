import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/driver/data/driver_repository.dart';
import 'package:masari_mobile/features/driver/presentation/driver_route_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';
import 'support/auth_test_support.dart';

void main() {
  testWidgets(
    'driver form replays the saved identity after response loss and capacity/status changes',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      final keys = <String>[];
      final rows = <String, Map<String, dynamic>>{};
      var lose = true;
      Future<http.Response> handler(http.Request request) async {
        if (request.method == 'GET') {
          return http.Response(
            jsonEncode({'routes': rows.values.toList()}),
            200,
          );
        }
        final key = request.headers['idempotency-key'] ?? '';
        keys.add(key);
        final row = rows.putIfAbsent(
          key,
          () => {
            ...jsonDecode(request.body) as Map<String, dynamic>,
            'id': 'original-route',
            'origin_lat': 31.5,
            'origin_lng': 35.1,
            'destination_lat': 31.7,
            'destination_lng': 35.2,
            'status': 'active',
          },
        );
        if (lose) {
          lose = false;
          row['seats_available'] = 0;
          row['status'] = 'completed';
          throw http.ClientException('commit response lost');
        }
        return http.Response(jsonEncode({'route': row}), 200);
      }

      Future<void> pump() async {
        final client = TestAuthenticatedClient(handler: handler);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authenticatedActorBindingProvider.overrideWithValue(
                AuthenticatedActorBinding()..bind('driver'),
              ),
              driverRepositoryProvider.overrideWithValue(
                DriverRepository(apiClient: client.client),
              ),
            ],
            child: const MaterialApp(
              locale: Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: DriverRouteScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
      }

      await pump();
      await tester.tap(find.byKey(const ValueKey('activateRouteButton')));
      await tester.pumpAndSettle();
      expect(find.text('Verify booking'), findsOneWidget);
      expect(keys.single, isNotEmpty);
      final seats = tester.widget<DropdownButtonFormField<int>>(
        find.byKey(const ValueKey('driverSeatsField')),
      );
      expect(seats.onChanged, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await pump();
      await tester.pumpAndSettle();
      expect(keys, [keys.first, keys.first]);
      expect(rows.length, 1);
      expect(find.byKey(const ValueKey('driverRouteMessage')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
