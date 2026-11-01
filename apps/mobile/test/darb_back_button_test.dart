import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/core/widgets/darb_back_button.dart';

void main() {
  for (final directLink in [true, false]) {
    testWidgets(
      'back handles ${directLink ? 'a direct link' : 'a pushed route'}',
      (tester) async {
        final router = GoRouter(
          initialLocation: directLink ? '/detail' : '/home',
          routes: [
            GoRoute(
              path: '/home',
              builder: (_, _) => const Scaffold(body: Text('Home')),
            ),
            GoRoute(
              path: '/detail',
              builder: (_, _) => Scaffold(
                appBar: AppBar(
                  leading: const DarbBackButton(fallback: '/home'),
                ),
                body: const Text('Detail'),
              ),
            ),
          ],
        );
        addTearDown(router.dispose);
        await tester.pumpWidget(MaterialApp.router(routerConfig: router));
        await tester.pumpAndSettle();
        if (!directLink) {
          router.push('/detail');
          await tester.pumpAndSettle();
        }
        await tester.tap(find.byKey(const ValueKey('masariBackButton')));
        await tester.pumpAndSettle();
        expect(find.text('Home'), findsOneWidget);
        expect(find.text('Detail'), findsNothing);
      },
    );
  }
}
