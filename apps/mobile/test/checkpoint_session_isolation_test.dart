import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/data/session_coordinator.dart';
import 'package:masari_mobile/features/auth/domain/auth_models.dart';
import 'package:masari_mobile/features/checkpoints/data/checkpoint_repository.dart';

import 'support/checkpoint_test_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final end in [
    'logout',
    'logout-all',
    'revocation',
    'expiry',
    'termination',
  ]) {
    test(
      '$end removes cached checkpoint values without another read',
      () async {
        final h = CheckpointTestHarness();
        addTearDown(h.dispose);
        await h.login();
        await h.load();
        expect(h.ids, ['actor-a']);
        final reads = h.reads;
        await _end(h, end);
        await CheckpointTestHarness.flush();
        expect(h.ids, isEmpty);
        expect(h.state.value?.checkpoints ?? [], isEmpty);
        expect(
          h.reads,
          reads,
          reason: 'a signed-out rebuild must not read checkpoints',
        );
        expect(
          h.container.read(authControllerProvider).value?.isAuthenticated,
          isFalse,
        );
      },
    );
  }

  test('account B cannot observe cached A while B is pending', () async {
    final h = CheckpointTestHarness();
    addTearDown(h.dispose);
    await h.login();
    await h.load();
    final b = h.delay();
    h.checkpointHandler = (_) => b.future;
    final boundary = h.values.length;
    await h.login('actor-b');
    expect(h.ids, isEmpty);
    expect(
      h.values
          .skip(boundary)
          .expand((value) => value.value?.checkpoints ?? [])
          .map((row) => row.id),
      isNot(contains('actor-a')),
    );
    b.complete(CheckpointTestHarness.snapshot('actor-b'));
    await CheckpointTestHarness.flush();
    expect(h.ids, ['actor-b']);
    expect(h.requests.last.headers['authorization'], contains('actor-b'));
  });

  test('a new session for the same actor clears its prior snapshot', () async {
    final h = CheckpointTestHarness();
    addTearDown(h.dispose);
    await h.login();
    await h.load();
    final current = h.delay();
    h.checkpointHandler = (_) => current.future;
    await h.login();
    expect(h.ids, isEmpty);
    current.complete(CheckpointTestHarness.snapshot('new-session'));
    await CheckpointTestHarness.flush();
    expect(h.ids, ['new-session']);
  });

  test(
    'a retained provider without active map listeners cannot resurrect A',
    () async {
      final h = CheckpointTestHarness();
      addTearDown(h.dispose);
      await h.login();
      await h.load();
      h.stopWatching();
      await _end(h, 'logout');
      await h.login('actor-b');
      expect(h.ids, isNot(contains('actor-a')));
      h.watch();
      await CheckpointTestHarness.flush();
      expect(h.ids, ['actor-b']);
    },
  );

  for (final failure in [false, true]) {
    test(
      'late A ${failure ? 'failure' : 'success'} cannot publish while B remains pending',
      () async {
        final h = CheckpointTestHarness();
        addTearDown(h.dispose);
        await h.login();
        await h.load();
        final a = h.delay();
        final b = h.delay();
        final started = Completer<void>();
        h.checkpointHandler = (request) {
          if (request.headers['authorization']!.contains('actor-a')) {
            started.complete();
            return a.future;
          }
          return b.future;
        };
        final pending = h.refresh();
        await started.future;
        await _end(h, 'logout');
        await h.login('actor-b');
        a.complete(
          failure
              ? CheckpointTestHarness.response({'error': 'obsolete'}, 503)
              : CheckpointTestHarness.snapshot('obsolete-a'),
        );
        await pending;
        await CheckpointTestHarness.flush();
        expect(h.ids, isEmpty);
        expect(h.state.hasError, isFalse);
        b.complete(CheckpointTestHarness.snapshot('actor-b'));
        await CheckpointTestHarness.flush();
        expect(h.ids, ['actor-b']);
      },
    );
  }

  test(
    'restart restores the session and fetches current records rather than a prior snapshot',
    () async {
      final first = CheckpointTestHarness();
      await first.login();
      await first.load();
      final storage = first.storage;
      first.dispose();
      final restarted = CheckpointTestHarness(tokenStorage: storage);
      addTearDown(restarted.dispose);
      restarted.checkpointHandler = (_) async =>
          CheckpointTestHarness.snapshot('after-restart');
      expect(
        (await restarted.container.read(authControllerProvider.future)).status,
        AuthStatus.authenticated,
      );
      expect((await restarted.load()).checkpoints.single.id, 'after-restart');
      expect(restarted.reads, 1);
      expect(
        restarted.requests.where((request) => request.url.path.endsWith('/me')),
        hasLength(1),
      );
    },
  );

  test(
    'repository pre-send guard runs inside the real authenticated transport',
    () async {
      final h = CheckpointTestHarness();
      addTearDown(h.dispose);
      await h.login();
      await expectLater(
        h.container
            .read(checkpointRepositoryProvider)
            .checkpoints(beforeSend: () => throw StateError('session_changed')),
        throwsStateError,
      );
      expect(h.reads, 0);
    },
  );

  test(
    'server stale metadata passes through without inventing a freshness threshold',
    () async {
      final h = CheckpointTestHarness();
      addTearDown(h.dispose);
      await h.login();
      h.checkpointHandler = (_) async =>
          CheckpointTestHarness.snapshot('stale', stale: true);
      final result = await h.load();
      expect(result.stale, isTrue);
      expect(result.fetchedAt, DateTime.utc(2026, 10, 23, 0, 1));
    },
  );

  for (final initial in [true, false]) {
    for (final failure in [false, true]) {
      test(
        'obsolete ${initial ? 'initial' : 'refresh'} ${failure ? 'failure' : 'success'} cannot replace B',
        () async {
          final h = CheckpointTestHarness();
          addTearDown(h.dispose);
          await h.login();
          if (!initial) await h.load();
          final old = h.delay();
          final started = Completer<void>();
          h.checkpointHandler = (request) {
            if (request.headers['authorization']!.contains('actor-a')) {
              if (!started.isCompleted) started.complete();
              return old.future;
            }
            return Future.value(CheckpointTestHarness.snapshot('actor-b'));
          };
          final pending = initial ? h.load().then<void>((_) {}) : h.refresh();
          unawaited(pending.catchError((Object _) {}));
          await started.future;
          await _end(h, 'logout');
          await h.login('actor-b');
          // Also exercise an explicit B refresh; it must not share A's queue.
          await h.refresh();
          expect(h.ids, ['actor-b']);
          final boundary = h.values.length;
          old.complete(
            failure
                ? CheckpointTestHarness.response({
                    'error': 'old-session-failure',
                  }, 503)
                : CheckpointTestHarness.snapshot('obsolete-a'),
          );
          await pending.catchError((Object _) {});
          await CheckpointTestHarness.flush();
          expect(h.ids, ['actor-b']);
          expect(h.state.hasError, isFalse);
          expect(
            h.values
                .skip(boundary)
                .any(
                  (value) =>
                      value.hasError ||
                      value.value?.checkpoints.any(
                            (row) => row.id == 'obsolete-a',
                          ) ==
                          true,
                ),
            isFalse,
          );
        },
      );
    }
  }

  for (final firstFails in [false, true]) {
    test(
      'overlapping refreshes publish only the latest intent after ${firstFails ? 'failure' : 'success'}',
      () async {
        final h = CheckpointTestHarness();
        addTearDown(h.dispose);
        await h.login();
        await h.load();
        final old = h.delay();
        final started = Completer<void>();
        var requests = 0;
        h.checkpointHandler = (_) {
          requests++;
          if (requests == 1) {
            started.complete();
            return old.future;
          }
          return Future.value(CheckpointTestHarness.snapshot('latest'));
        };
        final boundary = h.values.length;
        final first = h.refresh();
        unawaited(first.catchError((Object _) {}));
        await started.future;
        final second = h.refresh();
        unawaited(second.catchError((Object _) {}));
        await CheckpointTestHarness.flush();
        final readsBeforeRelease = requests;
        old.complete(
          firstFails
              ? CheckpointTestHarness.response({'error': 'overtaken'}, 503)
              : CheckpointTestHarness.snapshot('overtaken'),
        );
        await Future.wait([first, second]);
        expect(readsBeforeRelease, 1);
        expect(h.ids, ['latest']);
        expect(requests, 2);
        expect(
          h.values
              .skip(boundary)
              .any(
                (value) =>
                    value.hasError ||
                    value.value?.checkpoints.any(
                          (row) => row.id == 'overtaken',
                        ) ==
                        true,
              ),
          isFalse,
        );
      },
    );
  }

  for (final status in [401, 403]) {
    test(
      '$status read clears earlier data and retains the genuine access error',
      () async {
        final h = CheckpointTestHarness();
        addTearDown(h.dispose);
        await h.login();
        await h.load();
        h.checkpointHandler = (_) async => CheckpointTestHarness.response({
          'error': 'checkpoint_access_denied',
        }, status);
        await h.refresh();
        expect(h.ids, isEmpty);
        expect(
          h.state.error,
          isA<ApiException>().having(
            (error) => error.statusCode,
            'status',
            status,
          ),
        );
      },
    );
  }

  test(
    'terminal checkpoint response expires the real session and clears the snapshot',
    () async {
      final h = CheckpointTestHarness();
      addTearDown(h.dispose);
      await h.login();
      await h.load();
      h.checkpointHandler = (_) async =>
          CheckpointTestHarness.response({'error': 'session_revoked'}, 401);
      await h.refresh();
      await CheckpointTestHarness.flush();
      expect(h.ids, isEmpty);
      expect(
        h.container.read(authControllerProvider).value?.status,
        AuthStatus.sessionEnded,
      );
    },
  );

  test(
    'initial load and explicit refresh share the latest authoritative read',
    () async {
      final h = CheckpointTestHarness();
      addTearDown(h.dispose);
      await h.login();
      final old = h.delay();
      final started = Completer<void>();
      h.checkpointHandler = (_) {
        if (h.reads == 1) {
          started.complete();
          return old.future;
        }
        return Future.value(CheckpointTestHarness.snapshot('latest'));
      };
      final initial = h.load();
      await started.future;
      final refresh = h.refresh();
      old.complete(CheckpointTestHarness.snapshot('old-initial'));
      await Future.wait([initial, refresh]);
      expect(h.ids, ['latest']);
      expect(
        h.values.any(
          (value) =>
              value.value?.checkpoints.any((row) => row.id == 'old-initial') ==
              true,
        ),
        isFalse,
      );
    },
  );

  test(
    'routine successful token refresh preserves current actor snapshot',
    () async {
      final h = CheckpointTestHarness();
      addTearDown(h.dispose);
      await h.login();
      await h.load();
      final started = Completer<void>();
      final token = h.delay();
      h.refreshHandler = (_) {
        started.complete();
        return token.future;
      };
      final refreshing = h.container
          .read(authSessionCoordinatorProvider)
          .refresh();
      await started.future;
      expect(h.ids, ['actor-a']);
      token.complete(CheckpointTestHarness.response(h.authBody()));
      await refreshing;
      await CheckpointTestHarness.flush();
      expect(h.ids, ['actor-a']);
      expect(
        h.reads,
        1,
        reason: 'credential refresh is not an actor transition',
      );
    },
  );

  test('retryable auth refresh failure does not impersonate logout', () async {
    final h = CheckpointTestHarness();
    addTearDown(h.dispose);
    await h.login();
    await h.load();
    h.refreshHandler = (_) async =>
        CheckpointTestHarness.response({'error': 'temporary'}, 503);
    await expectLater(
      h.container.read(authSessionCoordinatorProvider).refresh(),
      throwsA(isA<ApiException>()),
    );
    expect(h.ids, ['actor-a']);
    expect(
      h.container.read(authControllerProvider).value?.status,
      AuthStatus.retryableFailure,
    );
  });

  test('a disposed notifier never publishes a late completion', () async {
    final h = CheckpointTestHarness();
    await h.login();
    await h.load();
    final old = h.delay();
    final started = Completer<void>();
    h.checkpointHandler = (_) {
      started.complete();
      return old.future;
    };
    final pending = h.refresh();
    unawaited(pending.catchError((Object _) {}));
    await started.future;
    h.dispose();
    await expectLater(pending, completes);
  });
}

Future<void> _end(CheckpointTestHarness h, String end) => switch (end) {
  'logout' => h.container.read(authControllerProvider.notifier).logout(),
  'logout-all' => h.container.read(authControllerProvider.notifier).logoutAll(),
  'revocation' =>
    h.container
        .read(authControllerProvider.notifier)
        .completeCurrentSessionRevocation(),
  'expiry' =>
    h.container
        .read(authSessionCoordinatorProvider)
        .clearCredentials(reason: SessionEndReason.expired),
  _ =>
    h.container
        .read(authSessionCoordinatorProvider)
        .clearCredentials(reason: SessionEndReason.ended),
};
