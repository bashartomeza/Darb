import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_tokens.dart';
import '../../../../core/widgets/darb_bottom_nav.dart';
import '../../../operating_routes/data/operating_route_models.dart';
import '../../../operating_routes/data/operating_route_repository.dart';
import '../../domain/driver_prices.dart';
import 'driver_price_fields.dart';

/// Asks the driver which predefined route they are driving before they go
/// online, and their own prices on it inside the admin's range. Returns the
/// choice, or null when dismissed.
Future<DriverRouteChoice?> showDriverRoutePicker(
  BuildContext context, {
  String? initialRouteId,
}) => showDarbBottomSheet<DriverRouteChoice>(
  context: context,
  child: DriverRoutePicker(initialRouteId: initialRouteId),
);

class DriverRoutePicker extends ConsumerStatefulWidget {
  const DriverRoutePicker({this.initialRouteId, super.key});

  /// Preselected when still running, e.g. the route driven last time.
  final String? initialRouteId;

  @override
  ConsumerState<DriverRoutePicker> createState() => _DriverRoutePickerState();
}

class _DriverRoutePickerState extends ConsumerState<DriverRoutePicker> {
  String? _chosen;

  /// The prices typed for the chosen route; null while one is invalid.
  DriverPrices? _prices = DriverPrices.none;

  @override
  void initState() {
    super.initState();
    _chosen = widget.initialRouteId;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final routes = ref.watch(operatingRoutesProvider);
    final list = routes.value ?? const <OperatingRoute>[];
    final chosenRoute = list.where((route) => route.id == _chosen).firstOrNull;
    final chosen = chosenRoute?.id;

    return Column(
      key: const ValueKey('driverRoutePicker'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.driverRoutePickTitle, style: theme.textTheme.titleLarge),
        const SizedBox(height: AppTokens.spaceExtraSmall),
        Text(
          l10n.driverRoutePickBody,
          style: theme.textTheme.bodySmall?.copyWith(
            color: AppTheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppTokens.spaceMedium),
        routes.when(
          skipLoadingOnRefresh: false,
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: AppTokens.spaceMedium),
            child: LinearProgressIndicator(),
          ),
          error: (_, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.orderRoutesLoadFailed,
                key: const ValueKey('driverRoutesError'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
              TextButton(
                key: const ValueKey('driverRoutesRetry'),
                onPressed: () => ref.invalidate(operatingRoutesProvider),
                child: Text(l10n.retry),
              ),
            ],
          ),
          data: (_) => list.isEmpty
              ? Text(
                  l10n.orderRoutesEmpty,
                  key: const ValueKey('driverRoutesEmpty'),
                )
              : RadioGroup<String>(
                  groupValue: chosen,
                  onChanged: (id) => setState(() {
                    _chosen = id;
                    _prices = DriverPrices.none;
                  }),
                  child: Column(
                    children: [
                      for (final route in list)
                        RadioListTile<String>(
                          key: ValueKey('driverRouteOption-${route.id}'),
                          value: route.id,
                          contentPadding: EdgeInsets.zero,
                          title: Text(route.displayName(arabic: arabic)),
                        ),
                    ],
                  ),
                ),
        ),
        if (chosenRoute != null) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          DriverPriceFields(
            key: ValueKey('driverPickerPrices-${chosenRoute.id}'),
            fares: chosenRoute.fares,
            onChanged: (prices) => setState(() => _prices = prices),
          ),
        ],
        const SizedBox(height: AppTokens.spaceMedium),
        FilledButton(
          key: const ValueKey('driverRoutePickConfirm'),
          onPressed: chosen == null || _prices == null
              ? null
              : () => Navigator.of(
                  context,
                ).pop(DriverRouteChoice(chosen, _prices!)),
          child: Text(l10n.driverRoutePickConfirm),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
      ],
    );
  }
}
