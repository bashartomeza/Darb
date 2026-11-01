import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:masari_mobile/core/geo/reverse_geocoder.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/passenger/data/passenger_models.dart';
import 'package:masari_mobile/features/passenger/presentation/location_picker_screen.dart';

class _FakeGeocoder implements ReverseGeocoder {
  _FakeGeocoder(this.answer);
  final Future<String?> Function(double, double) answer;
  int calls = 0;

  @override
  Future<String?> lookup(double latitude, double longitude) {
    calls++;
    return answer(latitude, longitude);
  }
}

Future<List<PassengerLocation>> _open(
  WidgetTester tester,
  ReverseGeocoder? geocoder, {
  PassengerLocation? initial,
}) async {
  tester.view.physicalSize = const Size(1000, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final selected = <PassengerLocation>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: FilledButton(
            onPressed: () async {
              final result = await Navigator.of(context)
                  .push<PassengerLocation>(
                    MaterialPageRoute(
                      builder: (_) => PassengerLocationPickerScreen(
                        title: 'Select',
                        initialLocation: initial,
                        reverseGeocoder: geocoder,
                      ),
                    ),
                  );
              if (result != null) selected.add(result);
            },
            child: const Text('Choose'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Choose'));
  await tester.pumpAndSettle();
  return selected;
}

void _tap(WidgetTester tester, LatLng point) =>
    tester.widget<MasariMap>(find.byType(MasariMap)).onTap!(point);

String _label(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!.text;

void main() {
  testWidgets(
    'resolved place name replaces the neutral label and is returned with the coordinates',
    (tester) async {
      final geocoder = _FakeGeocoder((_, _) async => 'Bab Al-Zawiya');
      final selected = await _open(tester, geocoder);
      _tap(tester, const LatLng(31.53, 35.10));
      await tester.pump();
      await tester.pump();
      expect(_label(tester), 'Bab Al-Zawiya');
      await tester.tap(find.text('تأكيد الموقع'));
      await tester.pumpAndSettle();
      expect(selected.single.label, 'Bab Al-Zawiya');
      expect(selected.single.latitude, 31.53);
      expect(selected.single.longitude, 35.10);
    },
  );

  testWidgets('geocoder failure keeps coordinates and a neutral label', (
    tester,
  ) async {
    final geocoder = _FakeGeocoder((_, _) async => throw StateError('down'));
    final selected = await _open(tester, geocoder);
    _tap(tester, const LatLng(31.7, 35.2));
    await tester.pump();
    await tester.pump();
    expect(_label(tester), PassengerLocationPickerFallback.label);
    await tester.tap(find.text('تأكيد الموقع'));
    await tester.pumpAndSettle();
    expect(selected.single.label, PassengerLocationPickerFallback.label);
    expect(selected.single.latitude, 31.7);
    expect(selected.single.longitude, 35.2);
  });

  testWidgets(
    'a name typed by the user is never overwritten by a late answer',
    (tester) async {
      final completer = Completer<String?>();
      final geocoder = _FakeGeocoder((_, _) => completer.future);
      await _open(tester, geocoder);
      _tap(tester, const LatLng(31.5, 35.1));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'My shop');
      completer.complete('Some street');
      await tester.pump();
      await tester.pump();
      expect(_label(tester), 'My shop');
    },
  );

  testWidgets('a stale answer for an earlier tap is ignored', (tester) async {
    final first = Completer<String?>();
    final geocoder = _FakeGeocoder(
      (lat, _) => lat == 31.5 ? first.future : Future.value('Second place'),
    );
    await _open(tester, geocoder);
    _tap(tester, const LatLng(31.5, 35.1));
    await tester.pump();
    _tap(tester, const LatLng(31.6, 35.1));
    await tester.pump();
    await tester.pump();
    first.complete('First place');
    await tester.pump();
    expect(_label(tester), 'Second place');
  });

  testWidgets('previous point name is not kept for a newly tapped point', (
    tester,
  ) async {
    final selected = await _open(
      tester,
      null,
      initial: const PassengerLocation(
        label: 'Old place',
        latitude: 31.0,
        longitude: 35.0,
      ),
    );
    expect(_label(tester), 'Old place');
    _tap(tester, const LatLng(31.9, 35.9));
    await tester.pump();
    expect(_label(tester), PassengerLocationPickerFallback.label);
    await tester.tap(find.text('تأكيد الموقع'));
    await tester.pumpAndSettle();
    expect(selected.single.latitude, 31.9);
  });

  test(
    'CachingReverseGeocoder looks a point up once, even concurrently and after failure',
    () async {
      final ok = _FakeGeocoder((_, _) async => ' Name ');
      final cached = CachingReverseGeocoder(ok);
      final results = await Future.wait([
        cached.lookup(31.5, 35.1),
        cached.lookup(31.5, 35.1),
      ]);
      expect(results, ['Name', 'Name']);
      await cached.lookup(31.5, 35.1);
      expect(ok.calls, 1);

      final bad = _FakeGeocoder((_, _) async => throw StateError('x'));
      final cachedBad = CachingReverseGeocoder(bad);
      expect(await cachedBad.lookup(1, 2), isNull);
      expect(await cachedBad.lookup(1, 2), isNull);
      expect(bad.calls, 1);
    },
  );
}
