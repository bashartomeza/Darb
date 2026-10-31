import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../../core/fares/fare.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_tokens.dart';
import '../../../../core/theme/semantic_colors.dart';
import '../../../../core/widgets/entity_cards.dart';
import '../../../../core/widgets/masari_card.dart';
import '../../../../core/widgets/match_widgets.dart';
import '../../../../core/widgets/route_chip.dart';
import '../../domain/trip_offer.dart';

/// One bookable trip.
///
/// Driven entirely by [TripOffer], so it renders identically whether the offer
/// came from a demo source or, later, a real endpoint. Optional fields collapse
/// instead of showing placeholders — against the current schema that means no
/// price, rating, or trip count appears, and the card simply reads as driver,
/// route, departure, and seats.
class TripOfferCard extends StatelessWidget {
  const TripOfferCard({
    required this.offer,
    this.onBook,
    this.actionLabel,
    this.busy = false,
    this.enabled = true,
    this.verifyingBooking = false,
    super.key,
  });

  final TripOffer offer;

  /// Booking is only offered when the caller can actually perform it.
  final VoidCallback? onBook;
  final String? actionLabel;
  final bool busy;
  final bool enabled;

  /// Reconcile an existing request identity; this never authorizes a new booking.
  final bool verifyingBooking;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final departurePassed =
        offer.departureAt != null &&
        !offer.departureAt!.isAfter(DateTime.now());

    return MasariCard(
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              RoleAvatar(
                name: offer.driverName,
                role: 'driver',
                imageUrl: offer.photoUrl,
                size: 56,
              ),
              const SizedBox(width: AppTokens.gutterMobile),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      offer.driverName,
                      style: theme.textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (offer.ratingOutOfFive != null ||
                        offer.trustScore != null) ...[
                      const SizedBox(height: AppTokens.spaceExtraSmall),
                      _Reputation(offer: offer),
                    ],
                  ],
                ),
              ),
              if (offer.matchScore != null) ...[
                const SizedBox(width: AppTokens.spaceSmall),
                MatchScore(
                  score: offer.matchScore!,
                  label: l10n.matchScore,
                  compact: true,
                ),
              ] else if (offer.fareSeatMinor != null) ...[
                const SizedBox(width: AppTokens.spaceSmall),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      formatFare(
                        offer.fareSeatMinor!,
                        offer.fareCurrency ?? 'ILS',
                        Localizations.localeOf(context).languageCode,
                      ),
                      key: const ValueKey('tripOfferFare'),
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 1,
                    ),
                    Text(
                      l10n.perPassenger,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: AppTheme.onSurfaceVariant,
                      ),
                      maxLines: 1,
                    ),
                  ],
                ),
              ] else if (offer.priceLabel != null) ...[
                const SizedBox(width: AppTokens.spaceSmall),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      offer.priceLabel!,
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 1,
                    ),
                    Text(
                      l10n.perPassenger,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: AppTheme.onSurfaceVariant,
                      ),
                      maxLines: 1,
                    ),
                  ],
                ),
              ],
            ],
          ),
          const Divider(height: AppTokens.spaceLarge),
          RouteChip(from: offer.fromLabel, to: offer.toLabel, compact: true),
          const SizedBox(height: AppTokens.spaceMedium),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (offer.departureAt != null)
                      _DetailLine(
                        icon: Icons.schedule_outlined,
                        text:
                            '${l10n.departure}: '
                            '${_formatTime(context, offer.departureAt!)}',
                      ),
                    if (offer.vehicleLabel != null)
                      _DetailLine(
                        icon: Icons.directions_car_outlined,
                        text: offer.vehicleLabel!,
                      ),
                    if (offer.remainingSeats != null)
                      _DetailLine(
                        icon: Icons.event_seat_outlined,
                        text: l10n.seatsRemaining(offer.remainingSeats!),
                      ),
                  ],
                ),
              ),
              if (onBook != null) ...[
                const SizedBox(width: AppTokens.spaceSmall),
                FilledButton(
                  key: ValueKey('bookOffer-${offer.id}'),
                  onPressed:
                      busy || !enabled || (departurePassed && !verifyingBooking)
                      ? null
                      : onBook,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, AppTokens.minTouchTarget),
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTokens.spaceLarge,
                    ),
                  ),
                  child: busy
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(actionLabel ?? l10n.bookSeat),
                ),
              ],
            ],
          ),
          if (offer.matchScore == null && offer.fareSeatMinor != null)
            Padding(
              padding: const EdgeInsets.only(top: AppTokens.spaceSmall),
              child: Text(
                l10n.fareDisclaimer,
                key: const ValueKey('tripOfferFareDisclaimer'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: AppTheme.onSurfaceVariant,
                ),
              ),
            ),
          if (departurePassed && onBook != null) Text(l10n.bookingTimePassed),
        ],
      ),
    );
  }
}

/// Rating when one exists, otherwise the trust score the schema actually keeps.
///
/// These are not interchangeable, so they are labelled differently rather than
/// rendering a trust score as if it were a five-star rating.
class _Reputation extends StatelessWidget {
  const _Reputation({required this.offer});

  final TripOffer offer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final rating = offer.ratingOutOfFive;

    if (rating == null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.verified_user_outlined,
            size: 14,
            color: SemanticColors.success,
          ),
          const SizedBox(width: AppTokens.spaceExtraSmall),
          Flexible(
            child: Text(
              '${l10n.trustScore}: ${offer.trustScore}',
              style: theme.textTheme.labelMedium?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.star, size: 14, color: SemanticColors.warning),
        const SizedBox(width: AppTokens.spaceExtraSmall),
        Flexible(
          child: Text(
            rating.toStringAsFixed(1),
            style: theme.textTheme.labelMedium?.copyWith(
              color: AppTheme.onSurface,
            ),
            maxLines: 1,
          ),
        ),
        if (offer.completedTrips != null) ...[
          const SizedBox(width: AppTokens.spaceExtraSmall),
          Flexible(
            child: Text(
              '(${l10n.completedTripsCount(offer.completedTrips!)})',
              style: theme.textTheme.labelMedium?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ],
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.spaceExtraSmall),
      child: Row(
        children: [
          Icon(icon, size: 16, color: AppTheme.onSurfaceVariant),
          const SizedBox(width: AppTokens.spaceSmall),
          Expanded(
            child: Text(
              text,
              style: Theme.of(context).textTheme.bodySmall,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

String _formatTime(BuildContext context, DateTime value) {
  return MaterialLocalizations.of(
    context,
  ).formatTimeOfDay(TimeOfDay.fromDateTime(value.toLocal()));
}
