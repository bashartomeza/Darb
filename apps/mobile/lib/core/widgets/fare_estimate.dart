import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../fares/fare.dart';
import '../theme/app_tokens.dart';

/// One labelled amount inside a [FareEstimateBox].
class FareLine {
  const FareLine({required this.label, required this.minor, this.emphasis});
  final String label;
  final int minor;

  /// Renders the line as the headline amount (the total).
  final bool? emphasis;
}

/// A display-only fare, always labelled as an estimate paid to the driver.
///
/// Payments are not processed in the app, so every place that shows a fare
/// uses this widget; the disclosure text cannot be left out by accident.
/// Layout uses only start/end alignment so it mirrors correctly in Arabic.
class FareEstimateBox extends StatelessWidget {
  const FareEstimateBox({
    required this.currency,
    required this.lines,
    this.booked = false,
    super.key,
  });

  final String currency;
  final List<FareLine> lines;

  /// True when this is the fare frozen on an existing request/parcel.
  final bool booked;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final language = Localizations.localeOf(context).languageCode;
    return Semantics(
      container: true,
      child: Container(
        key: const ValueKey('fareEstimateBox'),
        width: double.infinity,
        margin: const EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
        padding: const EdgeInsets.all(AppTokens.spaceMedium),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              booked ? l10n.fareBookedTitle : l10n.fareEstimatedTitle,
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: AppTokens.spaceExtraSmall),
            for (final line in lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        line.label,
                        style: line.emphasis == true
                            ? theme.textTheme.titleMedium
                            : theme.textTheme.bodyMedium,
                      ),
                    ),
                    Text(
                      formatFare(line.minor, currency, language),
                      style:
                          (line.emphasis == true
                                  ? theme.textTheme.titleMedium
                                  : theme.textTheme.bodyMedium)
                              ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: AppTokens.spaceExtraSmall),
            Text(
              l10n.fareDisclaimer,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shown instead of a fare when the route has no published tariff.
class FareNotSetNote extends StatelessWidget {
  const FareNotSetNote({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      key: const ValueKey('fareNotSetNote'),
      padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
      child: Text(
        AppLocalizations.of(context).fareNotSet,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

/// Fare lines for a seat booking: per-seat price, and a total for groups.
List<FareLine> seatFareLines(
  AppLocalizations l10n,
  RouteFares fares,
  int passengers,
) {
  final unit = fares.passengerSeatMinor;
  if (unit == null) return const [];
  final total = fares.seatTotal(passengers)!;
  return [
    FareLine(label: l10n.farePerSeat, minor: unit),
    if (passengers > 1)
      FareLine(
        label: l10n.fareSeatsLine(passengers),
        minor: total,
        emphasis: true,
      ),
  ];
}

/// Fare lines for parcels: one line per size present, then a total when every
/// parcel is priced. Unpriced parcels are listed by omission, never as zero.
List<FareLine> parcelFareLines(
  AppLocalizations l10n,
  RouteFares fares,
  List<String> sizes,
) {
  final lines = <FareLine>[];
  for (final size in fareParcelSizes) {
    final count = sizes.where((value) => value == size).length;
    final price = fares.parcelFor(size);
    if (count == 0 || price == null) continue;
    lines.add(
      FareLine(
        label: count == 1
            ? l10n.fareParcelLine(size)
            : '${l10n.fareParcelLine(size)} × $count',
        minor: price * count,
      ),
    );
  }
  final total = fares.parcelTotal(sizes);
  if (total != null && sizes.length > 1) {
    lines.add(FareLine(label: l10n.fareTotal, minor: total, emphasis: true));
  }
  return lines;
}
