import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/api/authoritative_refresh.dart';
import 'package:masari_mobile/core/widgets/foreground_refresh.dart';

void main() {
  testWidgets(
    'polling pauses on inactive lifecycle, route, branch and disposal',
    (tester) async {
      var calls = 0;
      final enabled = ValueNotifier(true);
      final navigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          home: ValueListenableBuilder<bool>(
            valueListenable: enabled,
            builder: (_, active, _) => TickerMode(
              enabled: active,
              child: ForegroundRefresh(
                refresh: () async {
                  calls++;
                },
                child: const Scaffold(body: Text('waiting')),
              ),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(seconds: 5));
      expect(calls, 1);
      enabled.value = false;
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      expect(calls, 1);
      enabled.value = true;
      await tester.pump();
      expect(calls, 2);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      expect(calls, 2);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(calls, 3);
      unawaited(
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('other')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final covered = calls;
      await tester.pump(const Duration(seconds: 15));
      expect(calls, covered);
      navigator.currentState!.pop();
      await tester.pumpAndSettle();
      expect(calls, covered + 1);
      await tester.pumpWidget(const SizedBox.shrink());
      final disposed = calls;
      await tester.pump(const Duration(seconds: 15));
      expect(calls, disposed);
      enabled.dispose();
    },
  );

  testWidgets('polling failure does not overlap another read or escape', (
    tester,
  ) async {
    var calls = 0;
    final pending = Completer<void>();
    await tester.pumpWidget(
      MaterialApp(
        home: ForegroundRefresh(
          refresh: () {
            calls++;
            return pending.future;
          },
          child: const SizedBox(),
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 5));
    await tester.pump(const Duration(seconds: 15));
    expect(calls, 1);
    pending.completeError(StateError('synthetic transport failure'));
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  test(
    'queued reads discard obsolete filters and preserve latest intent',
    () async {
      final queue = AuthoritativeRefresh<String>();
      final first = Completer<String>();
      final last = Completer<String>();
      final published = <String>[];
      final a = queue.run(
        load: () => first.future,
        publish: published.add,
        isCurrent: () => true,
      );
      final b = queue.run(
        load: () async => 'superseded filter',
        publish: published.add,
        isCurrent: () => true,
      );
      final c = queue.run(
        load: () => last.future,
        publish: published.add,
        isCurrent: () => true,
      );
      first.complete('old filter');
      await Future<void>.delayed(Duration.zero);
      expect(published, isEmpty);
      last.complete('latest filter');
      expect(await Future.wait([a, b, c]), everyElement('latest filter'));
      expect(published, ['latest filter']);
      queue.dispose();
    },
  );

  test(
    'actor switch or disposal fences a delayed account-private read',
    () async {
      for (final dispose in [true, false]) {
        final queue = AuthoritativeRefresh<String>();
        final pending = Completer<String>();
        var current = true;
        final published = <String>[];
        final result = queue.run(
          load: () => pending.future,
          publish: published.add,
          isCurrent: () => current,
        );
        final rejected = expectLater(result, throwsStateError);
        if (dispose) {
          queue.dispose();
        } else {
          current = false;
        }
        pending.complete('previous account offer');
        await rejected;
        expect(published, isEmpty);
      }
    },
  );
}
