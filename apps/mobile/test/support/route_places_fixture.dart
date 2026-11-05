// Synthetic places for tests, in the exact shape of
// `GET /operating-routes/:id/places`.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/operating_routes/data/city_place_models.dart';
import 'package:darb_mobile/features/operating_routes/data/operating_route_repository.dart';

Map<String, dynamic> _placeJson(String id, String ar, String en) => {
  'id': id,
  'name': en,
  'name_ar': ar,
  'name_en': en,
  'latitude': 31.6,
  'longitude': 35.1,
  'approximate': true,
};

final _hebronPlaces = [
  _placeJson('place-heb-centre', 'وسط الخليل', 'Hebron city centre'),
  _placeJson('place-heb-halhul', 'حلحول', 'Halhul'),
  _placeJson('place-heb-yatta', 'يطا', 'Yatta'),
];

final _bethlehemPlaces = [
  _placeJson('place-bth-centre', 'وسط بيت لحم', 'Bethlehem city centre'),
  _placeJson('place-bth-beitjala', 'بيت جالا', 'Beit Jala'),
  _placeJson('place-bth-beitsahur', 'بيت ساحور', 'Beit Sahur'),
];

/// The two test routes: Hebron → Bethlehem (`route-heb-bth`) offers Hebron's
/// places for pickup and Bethlehem's for drop-off; the reverse route
/// (`route-bth-heb`) offers them the other way round.
Map<String, dynamic> routePlacesJson(String routeId) {
  final reverse = routeId == 'route-bth-heb';
  return {
    'route_id': routeId,
    'pickup_city_key': reverse ? 'city-bethlehem' : 'city-hebron',
    'dropoff_city_key': reverse ? 'city-hebron' : 'city-bethlehem',
    'pickup_places': reverse ? _bethlehemPlaces : _hebronPlaces,
    'dropoff_places': reverse ? _hebronPlaces : _bethlehemPlaces,
  };
}

RoutePlaces testRoutePlaces(String routeId) =>
    RoutePlaces.fromJson(routePlacesJson(routeId));

/// Serves the test places for any route, so a screen's pickers load them
/// without a server.
Override routePlacesTestOverride() => routePlacesProvider.overrideWith(
  (ref, key) async => testRoutePlaces(key.routeId),
);

/// Opens the pickup or drop-off picker (`side` is 'pickup' or 'dropoff') and
/// chooses the place shown as [name]. A screen with several pickers names the
/// one it means by [pickerKey], the key it gave the picker.
Future<void> pickPlace(
  WidgetTester tester,
  String name, {
  String side = 'pickup',
  Key? pickerKey,
}) async {
  final inner = find.byKey(ValueKey('${side}PlaceField'));
  final field = pickerKey == null
      ? inner
      : find.descendant(of: find.byKey(pickerKey), matching: inner);
  await tester.ensureVisible(field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text(name).last);
  await tester.pumpAndSettle();
}
