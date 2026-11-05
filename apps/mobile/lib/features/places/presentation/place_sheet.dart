import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/location/location_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';
import '../../trips/presentation/driver_call_card.dart';
import '../application/places_controller.dart';
import '../data/places_repository.dart';
import '../domain/map_place.dart';
import '../domain/opening_hours.dart';
import '../domain/place_category.dart';

/// Opens turn-by-turn navigation to a place; false when the device has no app
/// for it. Replaceable in tests.
typedef PlaceNavigator = Future<bool> Function(MapPlace place, String? name);

final placeNavigatorProvider = Provider<PlaceNavigator>((ref) => navigateTo);

Future<bool> navigateTo(MapPlace place, String? name) async {
  final lat = place.position.latitude;
  final lng = place.position.longitude;
  final label = Uri.encodeComponent(name ?? '');
  final attempts = [
    Uri.parse('geo:$lat,$lng?q=$lat,$lng($label)'),
    Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng'),
  ];
  for (final uri in attempts) {
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        return true;
      }
    } on PlatformException {
      // Try the next address.
    }
  }
  return false;
}

/// "Open now", "Closed now" or null when the hours are missing or unreadable.
bool? placeOpenNow(MapPlace place, DateTime now) =>
    OpeningHours.parse(place.openingHours)?.isOpenAt(now);

/// Shows the sheet for [place]. [now] and [from] are injectable for tests.
Future<void> showPlaceSheet(
  BuildContext context,
  MapPlace place, {
  DateTime? now,
  GeoPoint? from,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => PlaceSheet(place: place, now: now, from: from),
  );
}

/// Name, kind, distance, open-now, phone and the actions for one place.
class PlaceSheet extends ConsumerWidget {
  const PlaceSheet({required this.place, this.now, this.from, super.key});

  final MapPlace place;
  final DateTime? now;

  /// Where the user is, when known; the distance row is hidden otherwise.
  final GeoPoint? from;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final arabic = l10n.localeName == 'ar';
    final category = placeCategoryFor(place.category);
    final categoryLabel = placeCategoryLabel(l10n, place.category);
    final name = place.name(arabic: arabic);
    final open = placeOpenNow(place, now ?? DateTime.now());
    final origin = from ?? _knownPosition(ref);
    final metres = origin == null
        ? null
        : distanceMetres(origin, place.position);
    final phone = place.phone;
    final theme = Theme.of(context);

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: category?.color ?? AppTheme.onSurface,
                  foregroundColor: Colors.white,
                  child: Icon(category?.icon ?? Icons.place_rounded),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name ?? categoryLabel,
                        key: const ValueKey('placeSheetName'),
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (name != null)
                        Text(
                          categoryLabel,
                          key: const ValueKey('placeSheetCategory'),
                          style: theme.textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (metres != null)
              _InfoRow(
                key: const ValueKey('placeSheetDistance'),
                icon: Icons.near_me_rounded,
                text: metres < 1000
                    ? l10n.placeDistanceMetres((metres / 10).round() * 10)
                    : l10n.placeDistanceKm(
                        (metres / 1000).toStringAsFixed(metres < 10000 ? 1 : 0),
                      ),
              ),
            if (open != null)
              _InfoRow(
                key: const ValueKey('placeSheetOpen'),
                icon: Icons.schedule_rounded,
                text: open ? l10n.placeOpenNow : l10n.placeClosedNow,
                color: open ? const Color(0xFF2E7D32) : const Color(0xFFC62828),
              )
            else if (place.openingHours != null)
              _InfoRow(
                key: const ValueKey('placeSheetHours'),
                icon: Icons.schedule_rounded,
                text: place.openingHours!,
              ),
            if (phone != null)
              _InfoRow(
                key: const ValueKey('placeSheetPhone'),
                icon: Icons.phone_rounded,
                text: phone,
              ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  key: const ValueKey('placeSheetNavigate'),
                  onPressed: () async {
                    final ok = await ref.read(placeNavigatorProvider)(
                      place,
                      name,
                    );
                    if (!ok && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(l10n.placeNavigateFailed)),
                      );
                    }
                  },
                  icon: const Icon(Icons.directions_rounded),
                  label: Text(l10n.placeNavigate),
                ),
                OutlinedButton.icon(
                  key: const ValueKey('placeSheetShow'),
                  onPressed: () {
                    ref
                        .read(placeFocusProvider.notifier)
                        .focusOn(place.position);
                    Navigator.of(context).pop();
                  },
                  icon: const Icon(Icons.my_location_rounded),
                  label: Text(l10n.placeShowOnMap),
                ),
                if (phone != null)
                  OutlinedButton.icon(
                    key: const ValueKey('placeSheetCall'),
                    onPressed: () => ref.read(phoneDialerProvider)(phone),
                    icon: const Icon(Icons.call_rounded),
                    label: Text(l10n.placeCall),
                  ),
                TextButton.icon(
                  key: const ValueKey('placeSheetReport'),
                  onPressed: () => _report(context, ref, l10n),
                  icon: const Icon(Icons.flag_outlined),
                  label: Text(l10n.placeReport),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              l10n.placeDataAttribution,
              key: const ValueKey('placeSheetAttribution'),
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  /// The device position if something already read it. Never asks for
  /// permission from here.
  GeoPoint? _knownPosition(WidgetRef ref) {
    if (!ref.exists(currentPositionProvider)) return null;
    return ref.read(currentPositionProvider).value;
  }

  Future<void> _report(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (dialog) => SimpleDialog(
        title: Text(l10n.placeReportTitle),
        children: [
          for (final (key, label) in [
            ('closed', l10n.placeReportClosed),
            ('wrong_location', l10n.placeReportWrongLocation),
            ('wrong_info', l10n.placeReportWrongInfo),
            ('not_exists', l10n.placeReportNotExists),
          ])
            SimpleDialogOption(
              key: ValueKey('placeReport_$key'),
              onPressed: () => Navigator.of(dialog).pop(key),
              child: Text(label),
            ),
        ],
      ),
    );
    if (reason == null || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(placesRepositoryProvider).report(place.id, reason: reason);
      messenger.showSnackBar(SnackBar(content: Text(l10n.placeReportSent)));
    } on Exception {
      messenger.showSnackBar(SnackBar(content: Text(l10n.placeReportFailed)));
    }
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.text,
    this.color,
    super.key,
  });

  final IconData icon;
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: color, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
