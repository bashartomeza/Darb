import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../data/city_place_models.dart';
import '../data/operating_route_repository.dart';

/// Which end of the route a picker chooses. The route's origin city offers
/// the pickup places and its destination city the drop-off places, so a
/// Hebron → Ramallah route offers Hebron's villages for pickup and Ramallah's
/// for drop-off, and the reverse route the other way round.
enum RoutePlaceSide { pickup, dropoff }

/// A read-only field that opens a searchable list of the route's places for
/// one [side]. Without a route it asks for one first; while the list loads or
/// fails it says so, with a retry.
class RoutePlacePicker extends ConsumerWidget {
  const RoutePlacePicker({
    required this.routeId,
    required this.side,
    required this.selectedId,
    required this.onChanged,
    this.enabled = true,
    this.errorText,
    super.key,
  });

  /// The chosen service route id, or null before one is chosen.
  final String? routeId;
  final RoutePlaceSide side;
  final String? selectedId;
  final ValueChanged<CityPlace> onChanged;
  final bool enabled;
  final String? errorText;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final pickup = side == RoutePlaceSide.pickup;
    final label = pickup
        ? l10n.routePlacePickupLabel
        : l10n.routePlaceDropoffLabel;
    final hint = pickup
        ? l10n.routePlacePickupHint
        : l10n.routePlaceDropoffHint;
    final icon = pickup
        ? Icons.trip_origin_rounded
        : Icons.location_on_outlined;
    final prefix = pickup ? 'pickup' : 'dropoff';

    Widget notice(Key key, Widget leading, String message, [Widget? action]) {
      return InputDecorator(
        key: key,
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon, size: 20),
          errorText: errorText,
          errorMaxLines: 2,
        ),
        child: Row(
          children: [
            leading,
            const SizedBox(width: AppTokens.spaceSmall),
            Expanded(
              child: Text(
                message,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppTheme.onSurfaceVariant,
                ),
              ),
            ),
            ?action,
          ],
        ),
      );
    }

    final id = routeId;
    if (id == null) {
      return notice(
        ValueKey('${prefix}PlaceNeedsRoute'),
        const Icon(Icons.route_outlined, size: 20),
        l10n.routePlaceChooseRouteFirst,
      );
    }
    final key = (routeId: id, arabic: arabic);
    return ref
        .watch(routePlacesProvider(key))
        .when(
          skipLoadingOnRefresh: false,
          loading: () => notice(
            ValueKey('${prefix}PlacesLoading'),
            const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            l10n.routePlacesLoading,
          ),
          error: (_, _) => notice(
            ValueKey('${prefix}PlacesError'),
            const Icon(Icons.cloud_off_rounded, size: 20),
            l10n.routePlacesLoadFailed,
            TextButton(
              key: ValueKey('${prefix}PlacesRetry'),
              onPressed: () => ref.invalidate(routePlacesProvider(key)),
              child: Text(l10n.retry),
            ),
          ),
          data: (places) {
            final options = pickup ? places.pickup : places.dropoff;
            if (options.isEmpty) {
              return notice(
                ValueKey('${prefix}PlacesEmpty'),
                const Icon(Icons.location_off_outlined, size: 20),
                l10n.routePlacesEmpty,
              );
            }
            final selected = options.where((place) => place.id == selectedId);
            final chosen = selected.isEmpty ? null : selected.first;
            return InkWell(
              key: ValueKey('${prefix}PlaceField'),
              borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
              onTap: !enabled
                  ? null
                  : () async {
                      final picked = await showModalBottomSheet<CityPlace>(
                        context: context,
                        isScrollControlled: true,
                        useSafeArea: true,
                        builder: (_) => RoutePlaceSheet(
                          title: label,
                          options: options,
                          selectedId: chosen?.id,
                          sheetKey: ValueKey('${prefix}PlaceSheet'),
                        ),
                      );
                      if (picked != null) onChanged(picked);
                    },
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: label,
                  prefixIcon: Icon(icon, size: 20),
                  suffixIcon: const Icon(Icons.arrow_drop_down_rounded),
                  errorText: errorText,
                  errorMaxLines: 2,
                  enabled: enabled,
                  hintText: hint,
                  floatingLabelBehavior: FloatingLabelBehavior.always,
                ),
                isEmpty: chosen == null,
                child: chosen == null
                    ? null
                    : Text(
                        chosen.displayName(arabic: arabic),
                        overflow: TextOverflow.ellipsis,
                      ),
              ),
            );
          },
        );
  }
}

/// The searchable list inside the picker's bottom sheet.
class RoutePlaceSheet extends StatefulWidget {
  const RoutePlaceSheet({
    required this.title,
    required this.options,
    required this.sheetKey,
    this.selectedId,
    super.key,
  });

  final String title;
  final List<CityPlace> options;
  final String? selectedId;
  final Key sheetKey;

  @override
  State<RoutePlaceSheet> createState() => _RoutePlaceSheetState();
}

class _RoutePlaceSheetState extends State<RoutePlaceSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final shown = [
      for (final place in widget.options)
        if (place.matches(_query)) place,
    ];
    return Padding(
      key: widget.sheetKey,
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.7,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppTokens.marginMobile,
                AppTokens.spaceMedium,
                AppTokens.marginMobile,
                AppTokens.spaceSmall,
              ),
              child: Text(
                widget.title,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTokens.marginMobile,
              ),
              child: TextField(
                key: const ValueKey('placeSearchField'),
                autofocus: false,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: l10n.routePlaceSearchHint,
                  prefixIcon: const Icon(Icons.search_rounded, size: 20),
                ),
              ),
            ),
            const SizedBox(height: AppTokens.spaceSmall),
            Expanded(
              child: shown.isEmpty
                  ? Center(
                      key: const ValueKey('placeNoResults'),
                      child: Text(l10n.routePlaceNoResults),
                    )
                  : ListView.builder(
                      itemCount: shown.length,
                      itemBuilder: (context, index) {
                        final place = shown[index];
                        final selected = place.id == widget.selectedId;
                        return ListTile(
                          key: ValueKey('placeOption-${place.id}'),
                          title: Text(place.displayName(arabic: arabic)),
                          subtitle: Text(
                            place.displayName(arabic: !arabic),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: AppTheme.onSurfaceVariant,
                            ),
                          ),
                          trailing: selected
                              ? const Icon(Icons.check_rounded)
                              : null,
                          onTap: () => Navigator.of(context).pop(place),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
