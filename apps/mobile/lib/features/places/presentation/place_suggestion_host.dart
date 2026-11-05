import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../application/place_suggestion_controller.dart';
import '../application/place_suggestion_settings.dart';
import '../data/places_repository.dart';
import '../domain/map_place.dart';
import '../domain/place_category.dart';
import '../domain/place_suggestion_engine.dart';

/// How long a suggestion stays on screen before it fades on its own.
const Duration suggestionVisibleFor = Duration(seconds: 12);

/// Shows gentle "there is a cafe on your road" banners above the app while a
/// rider or driver is on a running trip.
///
/// Foreground only: the position stream is cancelled whenever the app is not
/// resumed. It uses the position the app already has permission for and never
/// asks for it; places come from the same API as the map; nothing about the
/// position or the suggestions is stored (the engine keeps this trip's state in
/// memory only). Wrap the signed-in shell with it; it renders its [child]
/// untouched when there is nothing to suggest.
class PlaceSuggestionHost extends ConsumerStatefulWidget {
  const PlaceSuggestionHost({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<PlaceSuggestionHost> createState() =>
      _PlaceSuggestionHostState();
}

class _PlaceSuggestionHostState extends ConsumerState<PlaceSuggestionHost>
    with WidgetsBindingObserver {
  final PlaceSuggestionEngine _engine = PlaceSuggestionEngine();
  StreamSubscription<SuggestionFix>? _subscription;
  Timer? _hideTimer;
  bool _resumed = true;
  bool _busy = false;
  SuggestionTrip? _trip;
  String? _cellKey;
  List<MapPlace> _cellPlaces = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _resumed = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _sync();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _subscription?.cancel();
    _hideTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    _sync();
  }

  /// Starts or stops listening to the position to match the trip, the
  /// settings and whether the app is in the foreground.
  void _sync() {
    final settings = ref.read(placeSuggestionSettingsProvider).value;
    final trip = ref.read(placeSuggestionTripProvider);
    final wanted =
        _resumed &&
        trip != null &&
        settings != null &&
        settings.active.isNotEmpty;
    if (!wanted) {
      _subscription?.cancel();
      _subscription = null;
      if (trip == null) {
        _trip = null;
        _engine.reset();
        _cellKey = null;
        ref.read(placeSuggestionProvider.notifier).dismiss();
      }
      return;
    }
    if (_trip?.id != trip.id) {
      _engine.reset();
      _cellKey = null;
    }
    _trip = trip;
    if (_subscription != null) return;
    _subscription = ref
        .read(suggestionPositionSourceProvider)
        .fixes()
        .listen(_onFix, onError: (_) {}, cancelOnError: false);
  }

  Future<void> _onFix(SuggestionFix fix) async {
    final trip = _trip;
    final settings = ref.read(placeSuggestionSettingsProvider).value;
    if (_busy || trip == null || settings == null) return;
    final categories = {
      for (final key in settings.active)
        if (placeCategoryFor(key)?.suggestFor.contains(trip.audience) == true)
          key,
    };
    if (categories.isEmpty) return;
    _busy = true;
    try {
      // One lookup per ~2 km cell, not per reading.
      final key =
          '${(fix.point.latitude / 0.02).floor()},'
          '${(fix.point.longitude / 0.02).floor()},${categories.toList()..sort()}';
      if (key != _cellKey) {
        final result = await ref
            .read(placesRepositoryProvider)
            .places(
              GeoBox.around(fix.point, 0.03),
              categories: categories,
              limit: 100,
            );
        _cellKey = key;
        _cellPlaces = result.places;
      }
      if (!mounted || _trip?.id != trip.id) return;
      final suggestion = _engine.next(
        tripId: trip.id,
        audience: trip.audience,
        position: fix.point,
        speedMetresPerSecond: fix.speedMetresPerSecond,
        places: _cellPlaces,
        enabledCategories: categories,
        now: DateTime.now(),
      );
      if (suggestion == null) return;
      ref.read(placeSuggestionProvider.notifier).show(suggestion);
      _hideTimer?.cancel();
      _hideTimer = Timer(suggestionVisibleFor, () {
        if (mounted) ref.read(placeSuggestionProvider.notifier).dismiss();
      });
    } on Exception {
      // A failed lookup only means no suggestion this time.
    } finally {
      _busy = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Re-evaluate whenever the trip or the settings change.
    ref.listen(placeSuggestionTripProvider, (_, _) => _sync());
    ref.listen(placeSuggestionSettingsProvider, (_, _) => _sync());
    final suggestion = ref.watch(placeSuggestionProvider);
    if (suggestion == null) return widget.child;
    return Stack(
      children: [
        widget.child,
        PositionedDirectional(
          top: 0,
          start: 0,
          end: 0,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: PlaceSuggestionBanner(
                suggestion: suggestion,
                onDismiss: () {
                  _hideTimer?.cancel();
                  ref.read(placeSuggestionProvider.notifier).dismiss();
                },
                onNever: () {
                  _hideTimer?.cancel();
                  ref.read(placeSuggestionProvider.notifier).dismiss();
                  ref
                      .read(placeSuggestionSettingsProvider.notifier)
                      .turnOffCategory(suggestion.place.category);
                },
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The banner itself. A passive one (a driver moving fast) has no buttons.
class PlaceSuggestionBanner extends StatelessWidget {
  const PlaceSuggestionBanner({
    required this.suggestion,
    required this.onDismiss,
    required this.onNever,
    super.key,
  });

  final PlaceSuggestion suggestion;
  final VoidCallback onDismiss;
  final VoidCallback onNever;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final arabic = l10n.localeName == 'ar';
    final place = suggestion.place;
    final category = placeCategoryFor(place.category);
    final metres = suggestion.distanceMetres;
    final distance = metres < 1000
        ? l10n.placeDistanceMetres((metres / 10).round() * 10)
        : l10n.placeDistanceKm((metres / 1000).toStringAsFixed(1));
    return Material(
      key: const ValueKey('placeSuggestionBanner'),
      elevation: 6,
      borderRadius: BorderRadius.circular(16),
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: category?.color ?? Colors.grey,
              foregroundColor: Colors.white,
              child: Icon(category?.icon ?? Icons.place_rounded, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    placeSuggestionMessage(
                      l10n,
                      place.category,
                      place.name(arabic: arabic),
                    ),
                    key: const ValueKey('placeSuggestionText'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(distance, style: const TextStyle(fontSize: 12)),
                  if (!suggestion.passive)
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton(
                        key: const ValueKey('placeSuggestionNever'),
                        style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          minimumSize: const Size(0, 32),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        onPressed: onNever,
                        child: Text(l10n.placeSuggestNever),
                      ),
                    ),
                ],
              ),
            ),
            if (!suggestion.passive)
              IconButton(
                key: const ValueKey('placeSuggestionDismiss'),
                tooltip: l10n.placeSuggestDismiss,
                onPressed: onDismiss,
                icon: const Icon(Icons.close_rounded),
              ),
          ],
        ),
      ),
    );
  }
}
