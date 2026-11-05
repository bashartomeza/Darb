import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/places/domain/map_place.dart';
import 'package:darb_mobile/features/places/domain/opening_hours.dart';
import 'package:darb_mobile/features/places/domain/place_category.dart';
import 'package:darb_mobile/features/places/domain/place_clustering.dart';
import 'package:darb_mobile/features/places/domain/place_suggestion_engine.dart';

MapPlace place(
  String id,
  String category,
  double lat,
  double lng, {
  String? openingHours,
}) => MapPlace(
  id: id,
  category: category,
  position: GeoPoint(lat, lng),
  nameAr: 'اسم $id',
  openingHours: openingHours,
);

void main() {
  group('category registry', () {
    test('has the categories the owner asked for, with unique keys', () {
      final keys = placeCategories.map((c) => c.key).toList();
      expect(
        keys,
        containsAll([
          'cafe',
          'restaurant',
          'hospital',
          'clinic',
          'pharmacy',
          'fuel',
        ]),
      );
      expect(keys.toSet().length, keys.length);
    });

    test('health places are never offered as suggestions', () {
      for (final key in ['pharmacy', 'hospital', 'clinic']) {
        expect(placeCategoryFor(key)!.suggestible, isFalse, reason: key);
      }
    });

    test('fuel is a driver suggestion only', () {
      expect(placeCategoryFor('fuel')!.suggestFor, {SuggestionAudience.driver});
      expect(
        placeCategoryFor('cafe')!.suggestFor,
        contains(SuggestionAudience.rider),
      );
    });
  });

  group('MapPlace and GeoBox', () {
    test('reads the API shape and falls back between names', () {
      final parsed = MapPlace.fromJson({
        'id': 'p1',
        'category': 'cafe',
        'name_ar': 'مقهى',
        'name_en': null,
        'lat': 31.9,
        'lng': 35.2,
        'phone': ' +970 2 123 ',
        'opening_hours': null,
      });
      expect(parsed.name(arabic: true), 'مقهى');
      expect(parsed.name(arabic: false), 'مقهى');
      expect(parsed.phone, '+970 2 123');
      expect(parsed.position.latitude, 31.9);
    });

    test('snaps a box outward to a grid and never past the API span limit', () {
      final snapped = const GeoBox(
        south: 31.912,
        west: 35.171,
        north: 31.988,
        east: 35.233,
      ).snapped();
      expect(snapped.south, 31.9);
      expect(snapped.north, 32.0);
      expect(snapped.west, 35.15);
      expect(snapped.east, 35.25);
      expect(snapped.query, '31.9,35.15,32.0,35.25');

      final huge = const GeoBox(
        south: 29.5,
        west: 34.3,
        north: 33.3,
        east: 35.9,
      ).snapped();
      expect(huge.north - huge.south, lessThanOrEqualTo(0.9 + 1e-9));
      expect(huge.east - huge.west, lessThanOrEqualTo(0.9 + 1e-9));
    });

    test('a small pan snaps to the same box (one request)', () {
      const a = GeoBox(south: 31.91, west: 35.16, north: 31.99, east: 35.24);
      const b = GeoBox(south: 31.92, west: 35.17, north: 31.98, east: 35.23);
      expect(a.snapped(), b.snapped());
    });
  });

  group('opening hours', () {
    // 2026-11-02 is a Monday.
    final monday10 = DateTime(2026, 11, 2, 10);
    final saturday22 = DateTime(2026, 11, 7, 22);
    final sunday1 = DateTime(2026, 11, 8, 1);

    test('24/7 is always open', () {
      expect(OpeningHours.parse('24/7')!.isOpenAt(saturday22), isTrue);
    });

    test('day ranges and times', () {
      final hours = OpeningHours.parse('Mo-Fr 08:00-17:00; Sa 09:00-13:00')!;
      expect(hours.isOpenAt(monday10), isTrue);
      expect(hours.isOpenAt(DateTime(2026, 11, 2, 18)), isFalse);
      expect(hours.isOpenAt(DateTime(2026, 11, 7, 10)), isTrue);
      expect(hours.isOpenAt(DateTime(2026, 11, 8, 10)), isFalse); // Sunday
    });

    test('a later rule replaces an earlier one and off closes a day', () {
      final hours = OpeningHours.parse('Mo-Su 08:00-22:00; Fr off')!;
      expect(hours.isOpenAt(monday10), isTrue);
      expect(hours.isOpenAt(DateTime(2026, 11, 6, 10)), isFalse); // Friday
    });

    test('ranges past midnight carry into the next morning', () {
      final hours = OpeningHours.parse('Mo-Sa 18:00-02:00')!;
      expect(hours.isOpenAt(saturday22), isTrue);
      expect(hours.isOpenAt(sunday1), isTrue); // Saturday night's tail
      expect(hours.isOpenAt(DateTime(2026, 11, 8, 20)), isFalse);
    });

    test('public holiday rules are ignored and several ranges work', () {
      final hours = OpeningHours.parse(
        'Mo-Su 08:00-12:00,16:00-20:00; PH off',
      )!;
      expect(hours.isOpenAt(monday10), isTrue);
      expect(hours.isOpenAt(DateTime(2026, 11, 2, 14)), isFalse);
      expect(hours.isOpenAt(DateTime(2026, 11, 2, 17)), isTrue);
    });

    test('syntax it cannot read is unknown, never guessed', () {
      expect(OpeningHours.parse('sunrise-sunset'), isNull);
      expect(
        OpeningHours.parse('Mo-Fr 08:00-17:00 open "by appointment"'),
        isNull,
      );
      expect(OpeningHours.parse(''), isNull);
      expect(OpeningHours.parse(null), isNull);
    });
  });

  group('clustering', () {
    test('stays under the pin limit and keeps categories apart', () {
      final places = [
        for (var i = 0; i < 300; i++)
          place(
            'c$i',
            'cafe',
            31.9 + (i % 20) * 0.0007,
            35.2 + (i ~/ 20) * 0.0007,
          ),
        place('p1', 'pharmacy', 31.9, 35.2),
      ];
      final clusters = clusterPlaces(places, maxMarkers: 40);
      expect(clusters.length, lessThanOrEqualTo(40));
      expect(clusters.fold<int>(0, (n, c) => n + c.members.length), 301);
      expect(
        clusters.where((c) => c.members.any((m) => m.category == 'pharmacy')),
        hasLength(1),
      );
      for (final cluster in clusters) {
        expect(cluster.members.map((m) => m.category).toSet(), hasLength(1));
      }
    });

    test('few places stay individual and the result ignores input order', () {
      final places = [
        place('a', 'cafe', 31.9, 35.2),
        place('b', 'cafe', 32.1, 35.3),
      ];
      final forward = clusterPlaces(places);
      final backward = clusterPlaces(places.reversed.toList());
      expect(forward.every((c) => c.single), isTrue);
      expect(forward.map((c) => c.first.id), backward.map((c) => c.first.id));
    });
  });

  group('suggestion engine throttling', () {
    final here = const GeoPoint(31.9, 35.2);
    final start = DateTime(2026, 11, 2, 10);
    final cafeNear = place('cafe1', 'cafe', 31.905, 35.2); // ~550 m
    final cafeNear2 = place('cafe2', 'cafe', 31.906, 35.2);
    final cafeFar = place('cafe3', 'cafe', 31.95, 35.2); // ~5.5 km
    final fuelNear = place('fuel1', 'fuel', 31.904, 35.2);
    final pharmacyNear = place('ph1', 'pharmacy', 31.901, 35.2);
    const all = {'cafe', 'restaurant', 'fuel', 'pharmacy', 'rest_stop'};

    PlaceSuggestion? ask(
      PlaceSuggestionEngine engine, {
      String trip = 't1',
      SuggestionAudience audience = SuggestionAudience.rider,
      List<MapPlace>? places,
      DateTime? at,
      double? speed,
      Set<String> enabled = all,
      bool suppress = false,
    }) => engine.next(
      tripId: trip,
      audience: audience,
      position: here,
      speedMetresPerSecond: speed,
      places: places ?? [cafeNear, cafeNear2, cafeFar, fuelNear, pharmacyNear],
      enabledCategories: enabled,
      now: at ?? start,
      suppress: suppress,
    );

    test('suggests the nearest allowed place within the radius', () {
      final engine = PlaceSuggestionEngine();
      final suggestion = ask(engine)!;
      expect(suggestion.place.id, 'cafe1');
      expect(suggestion.distanceMetres, lessThan(1500));
      expect(suggestion.passive, isFalse);
    });

    test('nothing beyond the radius, nothing for a category that is off', () {
      final engine = PlaceSuggestionEngine();
      expect(ask(engine, places: [cafeFar]), isNull);
      expect(ask(engine, enabled: const {'fuel'}, places: [cafeNear]), isNull);
    });

    test('health places are never suggested even when enabled', () {
      final engine = PlaceSuggestionEngine();
      expect(ask(engine, places: [pharmacyNear]), isNull);
    });

    test('fuel only for drivers', () {
      final rider = PlaceSuggestionEngine();
      expect(ask(rider, places: [fuelNear]), isNull);
      final driver = PlaceSuggestionEngine();
      expect(
        ask(
          driver,
          audience: SuggestionAudience.driver,
          places: [fuelNear],
        )!.place.id,
        'fuel1',
      );
    });

    test('a place is suggested once per trip', () {
      final engine = PlaceSuggestionEngine();
      expect(ask(engine, places: [cafeNear])!.place.id, 'cafe1');
      final later = start.add(const Duration(hours: 1));
      expect(ask(engine, places: [cafeNear], at: later), isNull);
    });

    test('cool-down between two suggestions', () {
      final engine = PlaceSuggestionEngine();
      expect(ask(engine)!.place.id, 'cafe1');
      expect(ask(engine, at: start.add(const Duration(minutes: 5))), isNull);
      expect(
        ask(engine, at: start.add(const Duration(minutes: 16)))!.place.id,
        'cafe2',
      );
    });

    test(
      'at most the configured number per trip, then a new trip starts fresh',
      () {
        final engine = PlaceSuggestionEngine(
          config: const SuggestionConfig(maxPerTrip: 2),
        );
        final places = [
          place('a', 'cafe', 31.901, 35.2),
          place('b', 'cafe', 31.902, 35.2),
          place('c', 'cafe', 31.903, 35.2),
        ];
        var t = start;
        expect(ask(engine, places: places, at: t), isNotNull);
        t = t.add(const Duration(minutes: 20));
        expect(ask(engine, places: places, at: t), isNotNull);
        t = t.add(const Duration(minutes: 20));
        expect(ask(engine, places: places, at: t), isNull);
        expect(engine.shownThisTrip, 2);

        // The same place can be offered again on the next trip.
        expect(ask(engine, trip: 't2', places: places, at: t)!.place.id, 'a');
      },
    );

    test(
      'a driver moving fast gets a passive banner; slowly, an actionable one',
      () {
        final fast = PlaceSuggestionEngine();
        expect(
          ask(fast, audience: SuggestionAudience.driver, speed: 15)!.passive,
          isTrue,
        );
        final slow = PlaceSuggestionEngine();
        expect(
          ask(slow, audience: SuggestionAudience.driver, speed: 1)!.passive,
          isFalse,
        );
        // A rider is never "driving".
        final rider = PlaceSuggestionEngine();
        expect(ask(rider, speed: 15)!.passive, isFalse);
      },
    );

    test(
      'a place known to be closed is not suggested; unknown hours are fine',
      () {
        final engine = PlaceSuggestionEngine();
        final closed = place(
          'x',
          'cafe',
          31.901,
          35.2,
          openingHours: 'Mo-Su 18:00-23:00',
        );
        final unknown = place(
          'y',
          'cafe',
          31.902,
          35.2,
          openingHours: 'sunrise-sunset',
        );
        expect(ask(engine, places: [closed, unknown])!.place.id, 'y');
      },
    );

    test(
      'suppressed (for example during an emergency) shows nothing and counts nothing',
      () {
        final engine = PlaceSuggestionEngine();
        expect(ask(engine, suppress: true), isNull);
        expect(engine.shownThisTrip, 0);
        expect(ask(engine), isNotNull);
      },
    );
  });
}
