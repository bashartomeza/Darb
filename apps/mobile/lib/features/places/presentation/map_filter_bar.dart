import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../application/places_controller.dart';
import '../domain/map_place.dart';
import '../domain/place_category.dart';
import 'place_sheet.dart';

/// The chip row on a map: "Checkpoints" and every place category.
///
/// Pressing a chip shows only that layer; pressing it again clears the filter
/// (see [mapFilterProvider]). The bar also opens the sheet of a tapped place,
/// so every map that shows the bar gets the sheet.
class MapFilterBar extends ConsumerWidget {
  const MapFilterBar({this.includeCheckpoints = true, super.key});

  /// Maps with no checkpoint layer (the merchant's delivery map) leave the
  /// "Checkpoints" chip out.
  final bool includeCheckpoints;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final filter = ref.watch(mapFilterProvider);

    // Tabs of the shell stay mounted while hidden; only the visible one may
    // open the sheet.
    ref.listen<MapPlace?>(selectedPlaceProvider, (_, place) {
      if (place == null) return;
      if (!TickerMode.valuesOf(context).enabled ||
          ModalRoute.of(context)?.isCurrent == false) {
        return;
      }
      ref.read(selectedPlaceProvider.notifier).clear();
      showPlaceSheet(context, place);
    });

    return SizedBox(
      height: 44,
      child: ListView(
        key: const ValueKey('mapFilterBar'),
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 2),
        children: [
          if (includeCheckpoints)
            _FilterChip(
              id: checkpointsFilterId,
              icon: Icons.traffic_rounded,
              label: l10n.mapFilterCheckpoints,
              color: const Color(0xFFFA5F12),
              selected: filter == checkpointsFilterId,
            ),
          for (final category in placeCategories)
            _FilterChip(
              id: category.key,
              icon: category.icon,
              label: placeCategoryLabel(l10n, category.key),
              color: category.color,
              selected: filter == category.key,
            ),
        ],
      ),
    );
  }
}

class _FilterChip extends ConsumerWidget {
  const _FilterChip({
    required this.id,
    required this.icon,
    required this.label,
    required this.color,
    required this.selected,
  });

  final String id;
  final IconData icon;
  final String label;
  final Color color;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 6),
      child: Semantics(
        selected: selected,
        button: true,
        label: label,
        excludeSemantics: true,
        child: Material(
          elevation: 2,
          shadowColor: Colors.black38,
          shape: const StadiumBorder(),
          color: selected ? color : Colors.white,
          child: InkWell(
            key: ValueKey('mapFilter_$id'),
            customBorder: const StadiumBorder(),
            onTap: () => ref.read(mapFilterProvider.notifier).toggle(id),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 18, color: selected ? Colors.white : color),
                  const SizedBox(width: 6),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: selected ? Colors.white : const Color(0xFF1C1A1A),
                    ),
                  ),
                  if (selected) ...[
                    const SizedBox(width: 4),
                    const Icon(
                      Icons.close_rounded,
                      size: 16,
                      color: Colors.white,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
