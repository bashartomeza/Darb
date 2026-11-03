import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../../core/fares/fare.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_tokens.dart';
import '../../domain/driver_prices.dart';

/// The driver's own price for each item of the chosen route, each inside the
/// range the admin allows. An empty field charges the route's default; an
/// item without a range shows its fixed price instead of a field.
///
/// Reports the prices typed so far through [onChanged], or null while one of
/// them is not a valid amount inside its range. Give it a key per route so a
/// different route starts with empty fields.
class DriverPriceFields extends StatefulWidget {
  const DriverPriceFields({
    required this.fares,
    required this.onChanged,
    this.initial = DriverPrices.none,
    this.enabled = true,
    super.key,
  });

  final RouteFares? fares;
  final DriverPrices initial;
  final bool enabled;
  final ValueChanged<DriverPrices?> onChanged;

  @override
  State<DriverPriceFields> createState() => _DriverPriceFieldsState();
}

class _DriverPriceFieldsState extends State<DriverPriceFields> {
  final _controllers = <String, TextEditingController>{};

  @override
  void initState() {
    super.initState();
    for (final item in driverPriceItems) {
      final initial = widget.initial[item];
      _controllers[item] = TextEditingController(
        text: initial == null ? '' : fareInputText(initial),
      );
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  int? _default(String item) {
    final fares = widget.fares;
    if (fares == null) return null;
    if (item == driverPriceSeatItem) return fares.passengerSeatMinor;
    return fares.parcelFor(item.substring('parcel_'.length).toUpperCase());
  }

  FareRange? _range(String item) {
    final fares = widget.fares;
    if (fares == null) return null;
    if (item == driverPriceSeatItem) return fares.seatRange;
    return fares.parcelRanges[item.substring('parcel_'.length).toUpperCase()];
  }

  /// True when the field holds text that is not a price inside its range; an
  /// empty field is the route's default and always valid.
  bool _invalid(String item) {
    final text = _controllers[item]!.text.trim();
    if (text.isEmpty) return false;
    final range = _range(item);
    final minor = parseFareInput(text);
    return range == null || minor == null || !range.contains(minor);
  }

  void _report() {
    final prices = <String, int>{};
    for (final item in driverPriceItems) {
      final text = _controllers[item]!.text.trim();
      if (text.isEmpty || _range(item) == null) continue;
      if (_invalid(item)) {
        widget.onChanged(null);
        return;
      }
      prices[item] = parseFareInput(text)!;
    }
    widget.onChanged(DriverPrices(Map.unmodifiable(prices)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final language = Localizations.localeOf(context).languageCode;
    final fares = widget.fares;
    final currency = fares?.currency ?? 'ILS';
    String money(int minor) => formatFare(minor, currency, language);

    final rows = <Widget>[];
    for (final item in driverPriceItems) {
      final price = _default(item);
      if (price == null) continue;
      final label = item == driverPriceSeatItem
          ? l10n.driverPriceSeat
          : l10n.driverPriceParcel(
              item.substring('parcel_'.length).toUpperCase(),
            );
      final range = _range(item);
      if (range == null) {
        rows.add(
          Padding(
            key: ValueKey('driverPriceFixed-$item'),
            padding: const EdgeInsets.symmetric(
              vertical: AppTokens.spaceExtraSmall,
            ),
            child: Text('$label: ${l10n.driverPriceFixedHint(money(price))}'),
          ),
        );
        continue;
      }
      rows.add(
        Padding(
          padding: const EdgeInsets.only(top: AppTokens.spaceSmall),
          child: TextField(
            key: ValueKey('driverPrice-$item'),
            controller: _controllers[item],
            enabled: widget.enabled,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(
              labelText: label,
              hintText: fareInputText(price),
              helperText: l10n.driverPriceRangeHint(
                money(price),
                money(range.minMinor),
                money(range.maxMinor),
              ),
              helperMaxLines: 2,
              errorText: _invalid(item)
                  ? l10n.driverPriceInvalid(
                      money(range.minMinor),
                      money(range.maxMinor),
                    )
                  : null,
            ),
            onChanged: (_) {
              setState(() {});
              _report();
            },
          ),
        ),
      );
    }

    return Column(
      key: const ValueKey('driverPriceFields'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.driverPricesTitle, style: theme.textTheme.titleMedium),
        if (rows.isEmpty)
          Text(
            l10n.fareNotSet,
            key: const ValueKey('driverPricesNotSet'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          )
        else ...[
          Text(
            l10n.driverPricesBody,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          ),
          ...rows,
        ],
      ],
    );
  }
}
