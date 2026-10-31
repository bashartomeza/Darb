import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/notifications/application/notifications_controller.dart';
import 'package:masari_mobile/features/notifications/data/notification_models.dart';
import 'package:masari_mobile/features/notifications/data/notification_repository.dart';
import 'package:masari_mobile/features/notifications/presentation/notification_bell.dart';
import 'package:masari_mobile/features/notifications/presentation/notifications_screen.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

class _FakeAuth extends AuthController {
  _FakeAuth(this.userId);

  final String? userId;

  @override
  Future<AuthState> build() async {
    final id = userId;
    if (id == null) return const AuthState.unauthenticated();
    return AuthState.authenticated(
      AuthUser(
        id: id,
        name: 'Test',
        phone: '+970590000000',
        role: UserRole.passenger,
        demoAccount: true,
      ),
    );
  }
}

class _FakeRepository implements NotificationRepository {
  _FakeRepository(this.items);

  List<AppNotification> items;
  final List<String> markedRead = [];
  int markAllCalls = 0;
  int inboxCalls = 0;
  Object? failMarkRead;

  @override
  // The real client is never touched by this fake.
  get apiClient => throw UnimplementedError();

  @override
  Future<NotificationInbox> inbox({int limit = 50}) async {
    inboxCalls += 1;
    return NotificationInbox(
      items: List.of(items),
      unreadCount: items.where((item) => !item.isRead).length,
    );
  }

  @override
  Future<void> markRead(String id) async {
    final error = failMarkRead;
    if (error != null) throw error;
    markedRead.add(id);
    items = [
      for (final item in items)
        item.id == id ? item.markedRead(DateTime.now()) : item,
    ];
  }

  @override
  Future<void> markAllRead() async {
    markAllCalls += 1;
    items = [for (final item in items) item.markedRead(DateTime.now())];
  }
}

AppNotification _note(
  String id,
  String type, {
  Map<String, dynamic> params = const {},
  bool read = false,
}) => AppNotification(
  id: id,
  type: type,
  params: params,
  readAt: read ? DateTime(2026, 10, 25) : null,
  createdAt: DateTime.utc(2026, 10, 25, 10),
);

ProviderContainer _container(
  _FakeRepository repo, {
  String? userId = 'user_1',
}) {
  final container = ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(() => _FakeAuth(userId)),
      notificationRepositoryProvider.overrideWithValue(repo),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<void> _pumpScreen(
  WidgetTester tester,
  _FakeRepository repo, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _FakeAuth('user_1')),
        notificationRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const NotificationsScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('controller', () {
    test('loads the inbox and exposes the unread count', () async {
      final repo = _FakeRepository([
        _note('a', 'match_offered'),
        _note('b', 'trip_status', read: true),
      ]);
      final container = _container(repo);
      final sub = container.listen(unreadNotificationCountProvider, (_, _) {});
      addTearDown(sub.close);

      final inbox = await container.read(
        notificationsControllerProvider.future,
      );

      expect(inbox.items, hasLength(2));
      expect(container.read(unreadNotificationCountProvider), 1);
    });

    test(
      'marking one read updates the badge immediately and tells the server',
      () async {
        final repo = _FakeRepository([_note('a', 'match_offered')]);
        final container = _container(repo);
        final sub = container.listen(
          notificationsControllerProvider,
          (_, _) {},
        );
        addTearDown(sub.close);
        final inbox = await container.read(
          notificationsControllerProvider.future,
        );

        await container
            .read(notificationsControllerProvider.notifier)
            .markRead(inbox.items.single);

        expect(repo.markedRead, ['a']);
        expect(container.read(unreadNotificationCountProvider), 0);
        expect(
          container
              .read(notificationsControllerProvider)
              .value!
              .items
              .single
              .isRead,
          isTrue,
        );
      },
    );

    test('a failed mark-read falls back to the server truth', () async {
      final repo = _FakeRepository([_note('a', 'match_offered')]);
      final container = _container(repo);
      final sub = container.listen(notificationsControllerProvider, (_, _) {});
      addTearDown(sub.close);
      final inbox = await container.read(
        notificationsControllerProvider.future,
      );

      repo.failMarkRead = StateError('offline');
      await container
          .read(notificationsControllerProvider.notifier)
          .markRead(inbox.items.single);

      expect(container.read(unreadNotificationCountProvider), 1);
    });

    test('signed-out users get an empty inbox without any request', () async {
      final repo = _FakeRepository([_note('a', 'match_offered')]);
      final container = _container(repo, userId: null);
      final sub = container.listen(notificationsControllerProvider, (_, _) {});
      addTearDown(sub.close);

      final inbox = await container.read(
        notificationsControllerProvider.future,
      );

      expect(inbox.items, isEmpty);
      expect(repo.inboxCalls, 0);
    });

    test('model parses the API payload', () {
      final parsed = AppNotification.fromJson({
        'id': 'n1',
        'type': 'trip_status',
        'entity_type': 'Trip',
        'entity_id': 't1',
        'params': {'status': 'in_transit'},
        'read_at': null,
        'created_at': '2026-10-25T10:00:00.000Z',
      });
      expect(parsed.params['status'], 'in_transit');
      expect(parsed.isRead, isFalse);
    });
  });

  group('screen', () {
    testWidgets('shows localized messages with unread markers', (tester) async {
      final repo = _FakeRepository([
        _note('a', 'match_offered'),
        _note('b', 'trip_status', params: {'status': 'in_transit'}, read: true),
        _note(
          'c',
          'driver_verification_rejected',
          params: {'reason': 'Blurry licence'},
        ),
      ]);
      await _pumpScreen(tester, repo);

      expect(find.text('New match offer'), findsOneWidget);
      expect(find.text('The trip is now: In transit'), findsOneWidget);
      expect(find.text('Reason: Blurry licence'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('notificationUnreadDot')),
        findsNWidgets(2),
      );
    });

    testWidgets('renders document expiry notifications', (tester) async {
      final repo = _FakeRepository([
        _note(
          'a',
          'driver_documents_expiring',
          params: {'kind': 'licence', 'expires_on': '2026-11-20'},
        ),
        _note('b', 'driver_documents_expired'),
        _note('c', 'driver_documents_renewal_submitted'),
      ]);
      await _pumpScreen(tester, repo);

      expect(find.text('Document expiring soon'), findsOneWidget);
      expect(find.textContaining('Driving licence expires on'), findsOneWidget);
      expect(find.text('Your documents have expired'), findsOneWidget);
      expect(find.textContaining('restricted'), findsOneWidget);
      expect(find.text('Renewal documents sent'), findsOneWidget);
    });

    testWidgets('renders document expiry notifications in Arabic', (
      tester,
    ) async {
      final repo = _FakeRepository([_note('b', 'driver_documents_expired')]);
      await _pumpScreen(tester, repo, locale: const Locale('ar'));

      expect(find.text('انتهت صلاحية مستنداتك'), findsOneWidget);
    });

    testWidgets('renders in Arabic', (tester) async {
      final repo = _FakeRepository([_note('a', 'match_accepted')]);
      await _pumpScreen(tester, repo, locale: const Locale('ar'));

      expect(find.text('تم قبول طلبك'), findsOneWidget);
    });

    testWidgets('driver approaching alert shows in English and Arabic', (
      tester,
    ) async {
      final repo = _FakeRepository([_note('a', 'driver_approaching')]);
      await _pumpScreen(tester, repo);
      expect(find.text('Your driver is approaching'), findsOneWidget);

      await _pumpScreen(tester, repo, locale: const Locale('ar'));
      expect(find.text('سائقك يقترب'), findsOneWidget);
    });

    testWidgets('tapping an entry marks it read', (tester) async {
      final repo = _FakeRepository([_note('a', 'match_offered')]);
      await _pumpScreen(tester, repo);

      await tester.tap(find.byKey(const ValueKey('notification-a')));
      await tester.pumpAndSettle();

      expect(repo.markedRead, ['a']);
      expect(find.byKey(const ValueKey('notificationUnreadDot')), findsNothing);
    });

    testWidgets('mark all read clears every unread entry', (tester) async {
      final repo = _FakeRepository([
        _note('a', 'match_offered'),
        _note('b', 'match_accepted'),
      ]);
      await _pumpScreen(tester, repo);

      await tester.tap(find.byKey(const ValueKey('notificationsMarkAllRead')));
      await tester.pumpAndSettle();

      expect(repo.markAllCalls, 1);
      expect(find.byKey(const ValueKey('notificationUnreadDot')), findsNothing);
      expect(
        find.byKey(const ValueKey('notificationsMarkAllRead')),
        findsNothing,
      );
    });

    testWidgets('an empty inbox says so', (tester) async {
      await _pumpScreen(tester, _FakeRepository([]));

      expect(find.text('No notifications yet.'), findsOneWidget);
    });

    testWidgets('the bell badge shows the unread count', (tester) async {
      final repo = _FakeRepository([
        _note('a', 'match_offered'),
        _note('b', 'match_accepted'),
      ]);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(() => _FakeAuth('user_1')),
            notificationRepositoryProvider.overrideWithValue(repo),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: Center(child: NotificationBell())),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('2'), findsOneWidget);
    });
  });
}
