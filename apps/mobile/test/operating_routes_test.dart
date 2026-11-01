import 'package:darb_mobile/features/operating_routes/data/operating_route_models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/operating_routes_fixture.dart';

void main() {
  test('parses routes with their two cities', () {
    final routes = testOperatingRoutes();
    expect(routes.map((r) => r.id), ['route-heb-bth', 'route-bth-heb']);
    final first = routes.first;
    expect(first.displayName(arabic: true), 'الخليل ← بيت لحم');
    expect(first.displayName(arabic: false), 'Hebron → Bethlehem');
    expect(first.origin.displayName(arabic: true), 'الخليل');
    expect(first.destination.lat, 31.7054);
  });

  test('a malformed route fails the whole list', () {
    final json = operatingRoutesJson();
    (json['routes'] as List).add({'id': 'broken'});
    expect(() => parseOperatingRoutes(json), throwsFormatException);
    expect(() => parseOperatingRoutes({'routes': 'x'}), throwsFormatException);
  });
}
