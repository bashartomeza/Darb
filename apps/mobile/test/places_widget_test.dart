import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:darb_mobile/core/maps/map_overlays.dart';
import 'package:darb_mobile/core/widgets/darb_map.dart';
import 'package:darb_mobile/features/canonical_routes/application/canonical_route_controller.dart';
import 'package:darb_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:darb_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:darb_mobile/features/checkpoints/domain/checkpoint_models.dart';
import 'package:darb_mobile/features/places/application/place_suggestion_settings.dart';
import 'package:darb_mobile/features/places/application/places_controller.dart';
import 'package:darb_mobile/features/places/data/places_repository.dart';
import 'package:darb_mobile/features/places/domain/map_place.dart';
import 'package:darb_mobile/features/places/domain/place_category.dart';
import 'package:darb_mobile/features/places/domain/place_suggestion_engine.dart';
import 'package:darb_mobile/features/places/presentation/map_filter_bar.dart';
import 'package:darb_mobile/features/places/presentation/place_sheet.dart';
import 'package:darb_mobile/features/places/presentation/place_suggestion_host.dart';
import 'package:darb_mobile/features/places/presentation/place_suggestions_settings_tile.dart';
import 'package:darb_mobile/features/trips/presentation/driver_call_card.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import 'package:darb_mobile/l10n/app_localizations_ar.dart';

final _pharmacies = [
  const MapPlace(
    id: 'ph1',
    category: 'pharmacy',
    position: GeoPoint(31.90, 35.20),
    nameAr: 'صيدلية الأمل',
    nameEn: 'Al Amal Pharmacy',
    phone: '+970 2 123 4567',
    openingHours: 'Mo-Su 08:00-22:00',
  ),
  const MapPlace(
    id: 'ph2',
    category: 'pharmacy',
    position: GeoPoint(31.95, 35.25),
    nameAr: 'صيدلية الشفاء',
  ),
];

class _Caps extends MobileCapabilitiesNotifier {
  @override
  Future<MobileCapabilities> build() async => const MobileCapabilities(
    routeCatalogAvailable: true,
    multiRouteEntryAvailable: false,
    matchingAvailable: false,
    canonicalTripCreationAvailable: false,
    driverCanonicalOffersAvailable: false,
    canonicalAssignmentStatusAvailable: false,
    mapsAvailable: true,
    checkpointsAvailable: true,
    liveTrackingAvailable: false,
  );
}

class _Checkpoints extends CheckpointsNotifier {
  @override
  Future<CheckpointSnapshot> build() async => const CheckpointSnapshot(
    checkpoints: [
      Checkpoint(
        id: 'c1',
        position: GeoPoint(32.15, 35.25),
        nameAr: 'حوارة',
        nameEn: 'Huwwara',
      ),
      Checkpoint(
        id: 'c2',
        position: GeoPoint(31.86, 35.22),
        nameAr: 'قلنديا',
        nameEn: 'Qalandiya',
      ),
    ],
  );
}

class _Places extends ActivePlaces {
  _Places(this.requests);

  final List<String?> requests;

  @override
  Future<PlacesResult> build() async {
    final filter = ref.watch(mapFilterProvider);
    requests.add(filter);
    if (filter == null || filter == checkpointsFilterId) {
      return PlacesResult.empty;
    }
    return PlacesResult(places: _pharmacies, truncated: false);
  }
}

/// Shows how many pins of each kind the shared overlay hands to a map.
class _OverlayProbe extends ConsumerWidget {
  const _OverlayProbe();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overlay = watchMapOverlay(ref, AppLocalizations.of(context));
    int count(DarbMapMarkerType type) =>
        overlay.markers.where((m) => m.type == type).length;
    return Column(
      children: [
        const MapFilterBar(),
        Text(
          'checkpoints=${count(DarbMapMarkerType.checkpoint)} '
          'places=${count(DarbMapMarkerType.place)} '
          'total=${overlay.markers.length}',
          key: const ValueKey('probe'),
        ),
        Text('notes=${overlay.notes.join('|')}', key: const ValueKey('notes')),
      ],
    );
  }
}

Widget app(
  Widget home, {
  List<Override> overrides = const [],
  Locale? locale,
}) => ProviderScope(
  overrides: overrides,
  child: MaterialApp(
    locale: locale ?? const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: SafeArea(child: home)),
  ),
);

Future<void> tapChip(WidgetTester tester, String key) async {
  final chip = find.byKey(ValueKey(key));
  if (chip.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      chip,
      key == 'mapFilter_checkpoints' ? -200 : 200,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('mapFilterBar')),
        matching: find.byType(Scrollable),
      ),
    );
  }
  await tester.tap(chip);
}

String probe(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const ValueKey('probe'))).data!;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('map filter chips', () {
    final requests = <String?>[];
    List<Override> overrides() => [
      mobileCapabilitiesProvider.overrideWith(_Caps.new),
      checkpointsProvider.overrideWith(_Checkpoints.new),
      activePlacesProvider.overrideWith(() => _Places(requests)),
    ];

    testWidgets('normal view shows checkpoints and no places', (tester) async {
      await tester.pumpWidget(
        app(const _OverlayProbe(), overrides: overrides()),
      );
      await tester.pumpAndSettle();
      expect(probe(tester), 'checkpoints=2 places=0 total=2');
    });

    testWidgets(
      'a place chip shows only that category and hides the checkpoints; pressing it again restores the view',
      (tester) async {
        await tester.pumpWidget(
          app(const _OverlayProbe(), overrides: overrides()),
        );
        await tester.pumpAndSettle();

        await tapChip(tester, 'mapFilter_pharmacy');
        await tester.pumpAndSettle();
        expect(probe(tester), 'checkpoints=0 places=2 total=2');

        await tapChip(tester, 'mapFilter_pharmacy');
        await tester.pumpAndSettle();
        expect(probe(tester), 'checkpoints=2 places=0 total=2');
      },
    );

    testWidgets(
      'the Checkpoints chip shows only checkpoints; another chip replaces it',
      (tester) async {
        await tester.pumpWidget(
          app(const _OverlayProbe(), overrides: overrides()),
        );
        await tester.pumpAndSettle();

        await tapChip(tester, 'mapFilter_checkpoints');
        await tester.pumpAndSettle();
        expect(probe(tester), 'checkpoints=2 places=0 total=2');

        // One filter at a time: choosing another one replaces it.
        await tapChip(tester, 'mapFilter_pharmacy');
        await tester.pumpAndSettle();
        expect(probe(tester), 'checkpoints=0 places=2 total=2');

        await tapChip(tester, 'mapFilter_pharmacy');
        await tester.pumpAndSettle();
        expect(probe(tester), 'checkpoints=2 places=0 total=2');
      },
    );

    testWidgets('offers every category as a chip, Arabic included', (
      tester,
    ) async {
      await tester.pumpWidget(
        app(
          const _OverlayProbe(),
          overrides: overrides(),
          locale: const Locale('ar'),
        ),
      );
      await tester.pumpAndSettle();
      final bar = find.byKey(const ValueKey('mapFilterBar'));
      final arabic = AppLocalizationsAr();
      for (final category in placeCategories) {
        await tester.scrollUntilVisible(
          find.byKey(ValueKey('mapFilter_${category.key}')),
          200,
          scrollable: find.descendant(
            of: bar,
            matching: find.byType(Scrollable),
          ),
        );
        expect(
          find.text(placeCategoryLabel(arabic, category.key)),
          findsWidgets,
        );
      }
    });
  });

  group('place sheet', () {
    final place = _pharmacies.first;
    final tuesday10 = DateTime(2026, 11, 3, 10);

    testWidgets('shows name, category, distance, open now and phone', (
      tester,
    ) async {
      await tester.pumpWidget(
        app(
          PlaceSheet(
            place: place,
            now: tuesday10,
            from: const GeoPoint(31.91, 35.20),
          ),
        ),
      );
      expect(find.text('Al Amal Pharmacy'), findsOneWidget);
      expect(find.text('Pharmacy'), findsOneWidget);
      expect(find.text('1.1 km'), findsOneWidget);
      expect(find.text('Open now'), findsOneWidget);
      expect(find.text('+970 2 123 4567'), findsWidgets);
      expect(find.textContaining('OpenStreetMap'), findsOneWidget);
    });

    testWidgets('says closed outside the hours and hides unknown details', (
      tester,
    ) async {
      await tester.pumpWidget(
        app(PlaceSheet(place: place, now: DateTime(2026, 11, 3, 23))),
      );
      expect(find.text('Closed now'), findsOneWidget);

      await tester.pumpWidget(
        app(PlaceSheet(place: _pharmacies.last, now: tuesday10)),
      );
      expect(find.byKey(const ValueKey('placeSheetOpen')), findsNothing);
      expect(find.byKey(const ValueKey('placeSheetPhone')), findsNothing);
      expect(find.byKey(const ValueKey('placeSheetDistance')), findsNothing);
    });

    testWidgets(
      'navigate and call use the device; the report goes to the API',
      (tester) async {
        MapPlace? navigated;
        String? dialled;
        final reports = <(String, String)>[];
        await tester.pumpWidget(
          app(
            PlaceSheet(place: place, now: tuesday10),
            overrides: [
              placeNavigatorProvider.overrideWithValue((p, _) async {
                navigated = p;
                return true;
              }),
              phoneDialerProvider.overrideWithValue((number) async {
                dialled = number;
                return true;
              }),
              placesRepositoryProvider.overrideWithValue(
                _FakeRepository((id, reason) => reports.add((id, reason))),
              ),
            ],
          ),
        );
        await tester.tap(find.byKey(const ValueKey('placeSheetNavigate')));
        await tester.pump();
        expect(navigated?.id, 'ph1');

        await tester.tap(find.byKey(const ValueKey('placeSheetCall')));
        await tester.pump();
        expect(dialled, '+970 2 123 4567');

        await tester.tap(find.byKey(const ValueKey('placeSheetReport')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('placeReport_closed')));
        await tester.pumpAndSettle();
        expect(reports, [('ph1', 'closed')]);
        expect(find.text('Thanks, we will review your report'), findsOneWidget);
      },
    );

    testWidgets('a tapped pin opens the sheet through the filter bar', (
      tester,
    ) async {
      final container = ProviderContainer(
        overrides: [
          mobileCapabilitiesProvider.overrideWith(_Caps.new),
          checkpointsProvider.overrideWith(_Checkpoints.new),
          activePlacesProvider.overrideWith(() => _Places([])),
        ],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: _OverlayProbe()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      container.read(selectedPlaceProvider.notifier).select(_pharmacies.first);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('placeSheetName')), findsOneWidget);
      expect(find.text('Al Amal Pharmacy'), findsOneWidget);
    });
  });

  group('suggestion banner', () {
    testWidgets('actionable: dismiss and "don\'t suggest again" are offered', (
      tester,
    ) async {
      var dismissed = 0, never = 0;
      await tester.pumpWidget(
        app(
          PlaceSuggestionBanner(
            suggestion: PlaceSuggestion(
              place: const MapPlace(
                id: 'c1',
                category: 'cafe',
                position: GeoPoint(31.9, 35.2),
              ),
              distanceMetres: 640,
              passive: false,
            ),
            onDismiss: () => dismissed++,
            onNever: () => never++,
          ),
        ),
      );
      expect(
        find.text('There is a cafe on your road — want a coffee?'),
        findsOneWidget,
      );
      expect(find.text('640 m'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('placeSuggestionDismiss')));
      await tester.tap(find.byKey(const ValueKey('placeSuggestionNever')));
      expect([dismissed, never], [1, 1]);
    });

    testWidgets('passive (a driver moving fast): text only, nothing to tap', (
      tester,
    ) async {
      await tester.pumpWidget(
        app(
          PlaceSuggestionBanner(
            suggestion: PlaceSuggestion(
              place: const MapPlace(
                id: 'f1',
                category: 'fuel',
                position: GeoPoint(31.9, 35.2),
              ),
              distanceMetres: 900,
              passive: true,
            ),
            onDismiss: () {},
            onNever: () {},
          ),
          locale: const Locale('ar'),
        ),
      );
      expect(find.text('توجد محطة وقود على طريقك'), findsOneWidget);
      expect(find.byType(IconButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
    });
  });

  group('suggestion settings', () {
    testWidgets(
      'defaults, switching a category off, and the master switch persist',
      (tester) async {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const Scaffold(
                body: SingleChildScrollView(
                  child: PlaceSuggestionsSettingsTile(),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('placeSuggestionsTile')));
        await tester.pumpAndSettle();

        var settings = container
            .read(placeSuggestionSettingsProvider)
            .requireValue;
        expect(settings.enabled, isTrue);
        expect(settings.categories, {
          'cafe',
          'restaurant',
          'fuel',
          'rest_stop',
        });

        await tester.tap(find.byKey(const ValueKey('placeSuggestions_cafe')));
        await tester.pumpAndSettle();
        settings = container.read(placeSuggestionSettingsProvider).requireValue;
        expect(settings.categories, isNot(contains('cafe')));
        expect(settings.active, isNot(contains('cafe')));

        await tester.tap(find.byKey(const ValueKey('placeSuggestionsMaster')));
        await tester.pumpAndSettle();
        settings = container.read(placeSuggestionSettingsProvider).requireValue;
        expect(settings.enabled, isFalse);
        expect(settings.active, isEmpty);

        // A fresh controller reads the saved choices back.
        final preferences = await SharedPreferences.getInstance();
        expect(preferences.getBool('place_suggestions_enabled_v1'), isFalse);
        expect(
          preferences.getStringList('place_suggestions_categories_v1'),
          isNot(contains('cafe')),
        );
      },
    );

    test(
      '"don\'t suggest again" from a banner turns that category off',
      () async {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        await container.read(placeSuggestionSettingsProvider.future);
        await container
            .read(placeSuggestionSettingsProvider.notifier)
            .turnOffCategory('fuel');
        expect(
          container
              .read(placeSuggestionSettingsProvider)
              .requireValue
              .categories,
          isNot(contains('fuel')),
        );
      },
    );
  });
}

class _FakeRepository implements PlacesRepository {
  _FakeRepository(this.onReport);

  final void Function(String id, String reason) onReport;

  @override
  Future<void> report(String placeId, {required String reason}) async =>
      onReport(placeId, reason);

  @override
  Future<PlacesResult> places(
    GeoBox box, {
    Iterable<String> categories = const [],
    int limit = 200,
  }) async => PlacesResult.empty;

  @override
  get apiClient => throw UnimplementedError();
}
