import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/passenger/data/passenger_models.dart';
import 'package:masari_mobile/features/passenger/presentation/location_picker_screen.dart';

void main() {
  testWidgets(
    'named origin and destination keep their independently selected coordinates',
    (tester) async {
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
                          builder: (_) => const PassengerLocationPickerScreen(
                            title: 'Select location',
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
      for (final entry in <(String, LatLng)>[
        ('Origin square', const LatLng(31.72, 35.21)),
        ('Destination station', const LatLng(32.21, 35.29)),
      ]) {
        await tester.tap(find.text('Choose'));
        await tester.pumpAndSettle();
        tester.widget<MasariMap>(find.byType(MasariMap)).onTap!(entry.$2);
        await tester.pump();
        await tester.enterText(find.byType(TextField), entry.$1);
        await tester.tap(find.text('تأكيد الموقع'));
        await tester.pumpAndSettle();
      }
      expect(selected[0].label, 'Origin square');
      expect(selected[0].latitude, 31.72);
      expect(selected[0].longitude, 35.21);
      expect(selected[1].label, 'Destination station');
      expect(selected[1].latitude, 32.21);
      expect(selected[1].longitude, 35.29);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
