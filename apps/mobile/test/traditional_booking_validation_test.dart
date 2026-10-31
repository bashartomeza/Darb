import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:masari_mobile/features/passenger/domain/trip_offer.dart';
import 'package:masari_mobile/features/passenger/presentation/widgets/trip_offer_card.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'support/auth_test_support.dart';
import 'support/booking_recovery_test_support.dart';

void main() {
  test(
    'selected expired departure is rejected before creating or matching a request',
    () async {
      var calls = 0;
      final client = TestAuthenticatedClient(
        handler: (request) async {
          calls++;
          return http.Response(
            request.url.path.endsWith('/passenger/requests')
                ? '{"request":{"id":"should-not-create"}}'
                : '{"match":{"id":"should-not-match"}}',
            201,
          );
        },
      );
      final repository = ApiPassengerAssistantRepository(
        apiClient: client.client,
        mutation: testBookingMutation(),
      );
      final draft = PassengerAssistantTripDraft(
        pickupKey: 'bab_al_zawiya',
        pickupLabel: 'Bab Al-Zawiya',
        destinationKey: 'bethlehem',
        destinationLabel: 'Bethlehem Center',
        preferredTime: DateTime.now().add(const Duration(hours: 1)),
        passengerCount: 1,
      );
      final option = PassengerAssistantTripOption(
        id: 'expired',
        driverName: 'Fixture driver',
        fromLabel: 'Origin',
        toLabel: 'Destination',
        seatsAvailable: 2,
        score: 0.9,
        departureAt: DateTime.now().subtract(const Duration(minutes: 1)),
      );
      await expectLater(
        repository.selectTrip(draft: draft, option: option),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'reason',
            'booking_time_passed',
          ),
        ),
      );
      expect(calls, 0);
    },
  );

  testWidgets(
    'expired offer cannot be booked while upcoming and undated supply remain enabled',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Column(
              children: [
                for (final entry in <(String, DateTime?)>[
                  (
                    'expired',
                    DateTime.now().subtract(const Duration(minutes: 1)),
                  ),
                  ('upcoming', DateTime.now().add(const Duration(hours: 1))),
                  ('undated', null),
                ])
                  TripOfferCard(
                    offer: TripOffer(
                      id: entry.$1,
                      driverName: 'Fixture',
                      fromLabel: 'Origin',
                      toLabel: 'Destination',
                      departureAt: entry.$2,
                    ),
                    onBook: () {},
                  ),
              ],
            ),
          ),
        ),
      );
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('bookOffer-expired')),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('bookOffer-upcoming')),
            )
            .onPressed,
        isNotNull,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('bookOffer-undated')),
            )
            .onPressed,
        isNotNull,
      );
      expect(
        find.text('This departure time has passed. Choose an upcoming time.'),
        findsOneWidget,
      );
    },
  );
}
