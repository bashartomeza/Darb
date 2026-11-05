import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/cancellation/cancellation.dart';
import 'package:darb_mobile/features/auth/application/auth_controller.dart';
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/delivery_handover/data/delivery_handover_models.dart';
import 'package:darb_mobile/features/delivery_handover/data/delivery_handover_repository.dart';
import 'package:darb_mobile/features/operating_routes/data/operating_route_repository.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_models.dart';
import 'package:darb_mobile/features/passenger_parcels/data/passenger_parcel_repository.dart';
import 'package:darb_mobile/features/passenger_parcels/presentation/passenger_parcels_screen.dart';
import 'package:darb_mobile/features/passenger_parcels/presentation/send_parcel_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import 'support/booking_recovery_test_support.dart';
import 'support/operating_routes_fixture.dart';

const _route = 'Hebron → Bethlehem';

Map<String, dynamic> _parcelJson({String state = 'searching'}) => {
  'id': 'order-1',
  'tracking_state': state,
  'size': 'S',
  'pickup_label': 'Hebron',
  'dropoff_label': 'Bethlehem',
  'service_route_id': 'route-heb-bth',
  'route_name_en': _route,
  'pickup_details': 'The shop next to Ibn Rushd roundabout',
  'dropoff_details': 'Receiver house near the Church of the Nativity',
  'can_cancel': true,
  'created_at': '2026-10-28T10:00:00.000Z',
};

/// Answers POST /passenger/parcels with a canned body.
class _ApiClient implements AuthenticatedApiClient {
  _ApiClient(this.response);
  final Map<String, dynamic> response;
  final paths = <String>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Map<String, dynamic>> postJson(
    String path, {
    required Map<String, dynamic> body,
    Map<String, String> headers = const {},
    Future<void> Function()? beforeRetry,
    void Function()? beforeSend,
  }) async {
    paths.add(path);
    return response;
  }
}

class _ParcelRepository implements PassengerParcelRepository {
  _ParcelRepository({this.handoverCode});
  final String? handoverCode;

  @override
  AuthenticatedApiClient get apiClient => throw UnimplementedError();

  @override
  Future<List<PassengerParcel>> list() async => [
    PassengerParcel.fromJson(_parcelJson()),
  ];

  @override
  Future<PassengerParcel> create({
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async => PassengerParcel.fromJson(
    _parcelJson(),
    replayed: handoverCode == null,
    handoverCode: handoverCode,
  );

  @override
  Future<PassengerParcel> cancel(String id, CancelChoice choice) =>
      throw UnimplementedError();
}

class _HandoverRepository implements DeliveryHandoverRepository {
  final statusCalls = <String>[];
  final regenerated = <({String orderId, bool remember})>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<HandoverStatus> status(String orderId) async {
    statusCalls.add(orderId);
    return HandoverStatus.fromJson({'issued': true, 'attempts_remaining': 5});
  }

  @override
  Future<HandoverStatus> regenerate(
    String orderId, {
    bool remember = true,
  }) async {
    regenerated.add((orderId: orderId, remember: remember));
    final status = HandoverStatus.fromJson({
      'issued': true,
      'attempts_remaining': 5,
      'code': '730194',
    });
    if (remember) HandoverCodeVault.remember(orderId, status.code);
    return status;
  }
}

class _SignedIn extends AuthController {
  @override
  Future<AuthState> build() async => const AuthState.authenticated(
    AuthUser(
      id: 'passenger-fixture',
      name: 'Passenger',
      role: UserRole.passenger,
      demoAccount: false,
    ),
  );
}

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  required PassengerParcelRepository parcels,
  required DeliveryHandoverRepository handover,
}) async {
  tester.view.physicalSize = const Size(1000, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(_SignedIn.new),
        operatingRoutesProvider.overrideWith(
          (ref) async => testOperatingRoutes(),
        ),
        passengerParcelRepositoryProvider.overrideWithValue(parcels),
        deliveryHandoverRepositoryProvider.overrideWithValue(handover),
        passengerParcelMutationRunnerProvider.overrideWithValue(
          CanonicalMutationRunner(storage: MemoryBookingStorage()),
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _fillAndSend(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('parcelRouteField')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(_route).last);
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('parcelPickupDetails')),
    'The shop next to Ibn Rushd roundabout',
  );
  await tester.enterText(
    find.byKey(const ValueKey('parcelDropoffDetails')),
    'Receiver house near the Church of the Nativity',
  );
  await tester.enterText(find.byKey(const ValueKey('receiverName')), 'Sami');
  await tester.enterText(
    find.byKey(const ValueKey('receiverPhone')),
    '+970591234567',
  );
  await tester.tap(find.byKey(const ValueKey('forbiddenItemsAck')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('submitPassengerParcel')));
  await tester.pumpAndSettle();
}

void main() {
  setUp(HandoverCodeVault.clear);

  group('repository', () {
    test('create keeps the handover code from the response', () async {
      final api = _ApiClient({
        'parcel': _parcelJson(),
        'replayed': false,
        'handover_code': '048213',
      });
      final parcel = await PassengerParcelRepository(
        apiClient: api,
      ).create(payload: const {}, idempotencyKey: 'key-1');
      expect(api.paths, ['/passenger/parcels']);
      expect(parcel.id, 'order-1');
      expect(parcel.handoverCode, '048213');
      expect(parcel.replayed, isFalse);
    });

    test('a replay without a code is accepted and carries none', () async {
      final api = _ApiClient({
        'parcel': _parcelJson(),
        'replayed': true,
        'handover_code': null,
      });
      final parcel = await PassengerParcelRepository(
        apiClient: api,
      ).create(payload: const {}, idempotencyKey: 'key-1');
      expect(parcel.replayed, isTrue);
      expect(parcel.handoverCode, isNull);
    });
  });

  group('send parcel done screen', () {
    testWidgets('shows the code from the create response with how to use it', (
      tester,
    ) async {
      final handover = _HandoverRepository();
      await _pump(
        tester,
        const SendParcelScreen(),
        parcels: _ParcelRepository(handoverCode: '048213'),
        handover: handover,
      );
      await _fillAndSend(tester);

      expect(find.text('Your parcel request was recorded.'), findsOneWidget);
      expect(find.byKey(const ValueKey('handoverCode')), findsOneWidget);
      expect(find.text('048213'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('sendParcelHandoverIntro')),
        findsOneWidget,
      );
      expect(find.textContaining('The driver asks for it'), findsOneWidget);
      // Shown from the response itself: no extra call, nothing kept.
      expect(handover.statusCalls, isEmpty);
      expect(HandoverCodeVault.recall('order-1'), isNull);
    });

    testWidgets('a replay without the code offers a new one instead', (
      tester,
    ) async {
      final handover = _HandoverRepository();
      await _pump(
        tester,
        const SendParcelScreen(),
        parcels: _ParcelRepository(),
        handover: handover,
      );
      await _fillAndSend(tester);

      expect(find.text('Your parcel request was recorded.'), findsOneWidget);
      expect(handover.statusCalls, ['order-1']);
      expect(find.byKey(const ValueKey('handoverHidden')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('sendParcelHandoverIntro')),
        findsNothing,
      );

      await tester.tap(find.byKey(const ValueKey('handoverIssueButton')));
      await tester.pumpAndSettle();
      expect(find.text('730194'), findsOneWidget);
      expect(handover.regenerated.single.remember, isFalse);
      expect(HandoverCodeVault.recall('order-1'), isNull);
    });
  });

  group('my parcels', () {
    testWidgets('the sender can get a new receiver code for a parcel', (
      tester,
    ) async {
      final handover = _HandoverRepository();
      await _pump(
        tester,
        const PassengerParcelsScreen(),
        parcels: _ParcelRepository(),
        handover: handover,
      );
      expect(find.byKey(const ValueKey('handoverCodeCard')), findsNothing);
      expect(handover.statusCalls, isEmpty);

      await tester.tap(
        find.byKey(const ValueKey('toggleReceiverCode-order-1')),
      );
      await tester.pumpAndSettle();
      expect(handover.statusCalls, ['order-1']);
      expect(find.byKey(const ValueKey('handoverHidden')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('handoverIssueButton')));
      await tester.pumpAndSettle();
      expect(find.text('730194'), findsOneWidget);
      expect(handover.regenerated.single.orderId, 'order-1');
      expect(handover.regenerated.single.remember, isFalse);
      expect(HandoverCodeVault.recall('order-1'), isNull);
    });
  });
}
