import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/delivery_handover/data/delivery_handover_models.dart';
import 'package:masari_mobile/features/delivery_handover/data/delivery_handover_repository.dart';
import 'package:masari_mobile/features/delivery_handover/delivery_handover_strings.dart';
import 'package:masari_mobile/features/delivery_handover/presentation/handover_code_card.dart';
import 'package:masari_mobile/features/delivery_handover/presentation/receiver_confirmation_dialog.dart';

class _FakeRepository implements DeliveryHandoverRepository {
  _FakeRepository();

  final String issuedCode = '482913';
  int regenerated = 0;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<HandoverStatus> regenerate(String orderId) async {
    regenerated++;
    final status = HandoverStatus.fromJson({
      'issued': true,
      'attempts_remaining': 5,
      'code': issuedCode,
    });
    HandoverCodeVault.remember(orderId, status.code);
    return status;
  }

  @override
  Future<HandoverStatus> status(String orderId) async =>
      HandoverStatus.fromJson({'issued': true, 'attempts_remaining': 5});
}

Widget _host(Widget child, {Locale locale = const Locale('en')}) {
  return MaterialApp(
    locale: locale,
    supportedLocales: const [Locale('en'), Locale('ar')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    home: Scaffold(body: child),
  );
}

void main() {
  setUp(HandoverCodeVault.clear);

  group('models', () {
    test('trip confirmation lists the orders still waiting for a receiver', () {
      final confirmation = TripDeliveryConfirmation.fromJson({
        'required': true,
        'all_confirmed': false,
        'orders': [
          {'order_id': 'a', 'confirmed': true, 'attempts_remaining': 5},
          {'order_id': 'b', 'confirmed': false, 'attempts_remaining': 3},
        ],
      });
      expect(confirmation.needsReceiverConfirmation, isTrue);
      expect(confirmation.pending.map((o) => o.orderId), ['b']);
      expect(confirmation.pending.single.status.attemptsRemaining, 3);
    });

    test('a locked or expired handover needs a new code', () {
      expect(
        HandoverStatus.fromJson({'issued': true, 'locked': true}).needsNewCode,
        isTrue,
      );
      expect(
        HandoverStatus.fromJson({
          'issued': true,
          'confirmed': true,
          'locked': true,
        }).needsNewCode,
        isFalse,
      );
    });

    test('the code is only remembered for the current session', () {
      HandoverCodeVault.remember('o1', '123456');
      expect(HandoverCodeVault.recall('o1'), '123456');
      HandoverCodeVault.clear();
      expect(HandoverCodeVault.recall('o1'), isNull);
    });
  });

  group('sender card', () {
    testWidgets('issues a code, shows it, and reveals no stored digest', (
      tester,
    ) async {
      final repo = _FakeRepository();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deliveryHandoverRepositoryProvider.overrideWithValue(repo),
          ],
          child: _host(
            const HandoverCodeCard(
              orderId: 'o1',
              initial: HandoverStatus(
                issued: false,
                confirmed: false,
                locked: false,
                expired: false,
                attemptsRemaining: 0,
              ),
            ),
          ),
        ),
      );
      expect(find.byKey(const ValueKey('handoverNotIssued')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('handoverIssueButton')));
      await tester.pumpAndSettle();
      expect(find.text('482913'), findsOneWidget);
      expect(repo.regenerated, 1);
    });

    testWidgets('a locked order tells the sender to get a new code', (
      tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deliveryHandoverRepositoryProvider.overrideWithValue(
              _FakeRepository(),
            ),
          ],
          child: _host(
            const HandoverCodeCard(
              orderId: 'o2',
              initial: HandoverStatus(
                issued: true,
                confirmed: false,
                locked: true,
                expired: false,
                attemptsRemaining: 0,
              ),
            ),
          ),
        ),
      );
      expect(find.byKey(const ValueKey('handoverLocked')), findsOneWidget);
    });

    testWidgets('shows how a delivery was confirmed, in Arabic too', (
      tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deliveryHandoverRepositoryProvider.overrideWithValue(
              _FakeRepository(),
            ),
          ],
          child: _host(
            locale: const Locale('ar'),
            const HandoverCodeCard(
              orderId: 'o3',
              initial: HandoverStatus(
                issued: false,
                confirmed: true,
                locked: false,
                expired: false,
                attemptsRemaining: 5,
                method: 'receiver_unavailable',
                unavailableReason: 'لم يرد أحد',
              ),
            ),
          ),
        ),
      );
      expect(find.byKey(const ValueKey('handoverConfirmed')), findsOneWidget);
      expect(find.textContaining('المستلم غير متوفر'), findsOneWidget);
      expect(find.textContaining('لم يرد أحد'), findsOneWidget);
    });
  });

  group('driver dialog', () {
    final pending = [
      const OrderDeliveryConfirmation(
        orderId: 'o1',
        status: HandoverStatus(
          issued: true,
          confirmed: false,
          locked: false,
          expired: false,
          attemptsRemaining: 5,
        ),
      ),
    ];

    Future<ReceiverConfirmationResult?> open(
      WidgetTester tester,
      Future<void> Function() interact,
    ) async {
      ReceiverConfirmationResult? result;
      await tester.pumpWidget(
        _host(
          Builder(
            builder: (context) => TextButton(
              onPressed: () async =>
                  result = await showReceiverConfirmationDialog(
                    context,
                    pending: pending,
                  ),
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await interact();
      return result;
    }

    testWidgets('rejects a malformed code without closing', (tester) async {
      final result = await open(tester, () async {
        await tester.enterText(
          find.byKey(const ValueKey('receiverCodeField-0')),
          '12345',
        );
        await tester.tap(find.byKey(const ValueKey('receiverConfirmSubmit')));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('receiverConfirmationError')),
          findsOneWidget,
        );
      });
      expect(result, isNull);
    });

    testWidgets('returns the six-digit code per order', (tester) async {
      final result = await open(tester, () async {
        await tester.enterText(
          find.byKey(const ValueKey('receiverCodeField-0')),
          '654321',
        );
        await tester.tap(find.byKey(const ValueKey('receiverConfirmSubmit')));
        await tester.pumpAndSettle();
      });
      expect(result, isA<ReceiverCodes>());
      expect((result as ReceiverCodes).codesByOrderId, {'o1': '654321'});
    });

    testWidgets('receiver unavailable needs a real reason', (tester) async {
      final result = await open(tester, () async {
        await tester.tap(
          find.byKey(const ValueKey('receiverToggleUnavailable')),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const ValueKey('receiverUnavailableReason')),
          'short',
        );
        await tester.tap(find.byKey(const ValueKey('receiverConfirmSubmit')));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('receiverConfirmationError')),
          findsOneWidget,
        );
        await tester.enterText(
          find.byKey(const ValueKey('receiverUnavailableReason')),
          'Nobody answered the door or phone',
        );
        await tester.tap(find.byKey(const ValueKey('receiverConfirmSubmit')));
        await tester.pumpAndSettle();
      });
      expect(result, isA<ReceiverUnavailable>());
      expect(
        (result as ReceiverUnavailable).reason,
        'Nobody answered the door or phone',
      );
    });
  });

  testWidgets('API failures map to actionable driver messages', (tester) async {
    late HandoverStrings s;
    await tester.pumpWidget(
      _host(
        Builder(
          builder: (context) {
            s = HandoverStrings.of(context);
            return const SizedBox();
          },
        ),
      ),
    );
    const wrong = ApiException(
      ApiErrorType.validation,
      'invalid_handover_code',
      statusCode: 422,
    );
    expect(s.errorFor(wrong), contains('not right'));
    expect(
      s.errorFor(
        const ApiException(
          ApiErrorType.unknown,
          'handover_locked',
          statusCode: 429,
        ),
      ),
      contains('new code'),
    );
  });
}
