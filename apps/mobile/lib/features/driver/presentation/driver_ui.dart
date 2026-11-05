import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/discard_saved_request_button.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../application/driver_controller.dart';
import '../data/driver_models.dart';

String driverStatusLabel(AppLocalizations l10n, String status) =>
    switch (status) {
      'proposed' => l10n.statusProposed,
      'sent_to_driver' => l10n.statusSentToDriver,
      'pending' => l10n.statusPending,
      'matched' => l10n.statusMatched,
      'accepted' => l10n.statusAccepted,
      'pickup_started' => l10n.statusPickupStarted,
      'picked_up' => l10n.statusPickedUp,
      'in_transit' => l10n.statusInTransit,
      'delivered' => l10n.statusDelivered,
      'completed' => l10n.statusCompleted,
      'cancelled' => l10n.statusCancelled,
      'failed' => l10n.requestFailed,
      'rejected' => l10n.statusRejected,
      'expired' => l10n.statusExpired,
      'active' => l10n.statusActive,
      'inactive' => l10n.statusInactive,
      'assigned' => l10n.statusAssigned,
      'on_trip' => l10n.statusOnTrip,
      'created' => l10n.statusCreated,
      _ => status,
    };

String driverErrorLabel(AppLocalizations l10n, Object error) {
  if (error is DriverRouteRequired) return l10n.orderRouteRequired;
  final saved = savedRequestOutcomeLabel(l10n, error);
  if (saved != null) return saved;
  if (error is CanonicalOperationBlocked ||
      error is CanonicalOperationStorageException) {
    return l10n.canonicalRecoveryRequired;
  }
  if (error is! ApiException) return l10n.requestFailed;
  if (error.type == ApiErrorType.network) return l10n.networkUnavailable;
  if (error.type == ApiErrorType.timeout) return l10n.requestTimedOut;
  if (error.type == ApiErrorType.forbidden) return l10n.forbidden;
  return switch (error.message) {
    'route_already_active' => l10n.routeAlreadyActive,
    'route_not_active' => l10n.routeCannotDeactivate,
    'match_cannot_be_accepted' ||
    'match_cannot_be_rejected' ||
    'duplicate_active_trip' => l10n.matchCannotChange,
    'invalid_trip_status_transition' => l10n.tripTransitionConflict,
    'route_unavailable' => l10n.orderRouteUnavailable,
    'route_required' => l10n.orderRouteRequired,
    'driver_price_out_of_range' => l10n.driverPriceOutOfRange,
    'driver_price_fixed' => l10n.driverPriceFixedError,
    _ => l10n.requestFailed,
  };
}

/// Re-reads after a failed action, a retry tap or a pull to refresh. A failed
/// read is already in the provider's state (the screen shows it), so it is not
/// rethrown into a callback where nothing could catch it.
Future<void> quietRefresh(Future<Object?> Function() read) async {
  try {
    await read();
  } catch (_) {
    // Shown through the provider's state; nothing else to do here.
  }
}

bool _arabic(BuildContext context) =>
    Localizations.localeOf(context).languageCode == 'ar';

/// The predefined route a driver route runs on, or for routes from before
/// routes existed, its two ends.
String driverRouteName(BuildContext context, DriverRoute route) =>
    route.routeName(arabic: _arabic(context)) ??
    '${localizedCorridorPlace(context, route.originLabel)} → '
        '${localizedCorridorPlace(context, route.destinationLabel)}';

/// Where to collect the passenger: their own words, or the old place label.
String driverPassengerPickupText(
  BuildContext context,
  DriverPassengerSummary passenger,
) =>
    passenger.pickupDetails ??
    localizedCorridorPlace(context, passenger.pickupLabel);

/// Where the passenger gets off: their own words, or the old place label.
String driverPassengerDropoffText(
  BuildContext context,
  DriverPassengerSummary passenger,
) =>
    passenger.dropoffDetails ??
    localizedCorridorPlace(context, passenger.destinationLabel);

/// Where to collect a merchant's parcels: their words, or the old place label.
String driverMerchantPickupText(
  BuildContext context,
  DriverMerchantSummary order,
) => order.pickupDetails ?? localizedCorridorPlace(context, order.pickupLabel);

/// Where one parcel goes: the merchant's words, or the old place label.
String? driverParcelDropoffText(BuildContext context, DriverParcelStop parcel) {
  final label = parcel.destinationLabel;
  return parcel.dropoffDetails ??
      (label == null ? null : localizedCorridorPlace(context, label));
}

/// Where one order's parcels go, for labelling its hand-over stop: each
/// receiver's name and the drop-off, or null when the order says neither.
String? driverOrderStopText(BuildContext context, DriverBatchOrder order) {
  final parts = <String>{
    for (final parcel in order.parcels) ...[
      ?parcel.receiverName,
      ?driverParcelDropoffText(context, parcel),
    ],
  };
  return parts.isEmpty ? null : parts.join(' · ');
}

/// What to call each parcel order's hand-over stop on [trip], by order id:
/// "Stop 2 · Sami · Door near the bakery". Stops are numbered in trip order.
Map<String, String> driverHandoverStopLabels(
  BuildContext context,
  DriverTrip trip,
) {
  final l10n = AppLocalizations.of(context);
  final orders = trip.parcelOrders;
  return {
    for (final (index, order) in orders.indexed)
      if (driverOrderStopText(context, order) case final place?)
        order.id: l10n.handoverStopLabel(index + 1, place),
  };
}

/// Pickup and drop-off for every passenger and parcel on a match or trip, so
/// the driver can find them. Parcels show their receiver when given. A batch
/// lists each of its orders ([batchOrders]) with its own pickup and drop-offs.
class DriverStopDetailsCard extends StatelessWidget {
  const DriverStopDetailsCard({
    required this.passenger,
    required this.merchantOrder,
    this.batchOrders = const [],
    super.key,
  });

  final DriverPassengerSummary? passenger;
  final DriverMerchantSummary? merchantOrder;
  final List<DriverBatchOrder> batchOrders;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final passenger = this.passenger;
    final order = merchantOrder;
    final parcels = order?.parcels ?? const <DriverParcelStop>[];
    // A batch of several orders: each order is its own pickup and stops.
    final orders = batchOrders.length > 1
        ? batchOrders
        : const <DriverBatchOrder>[];

    Widget line(IconData icon, String label, String value, {Key? key}) =>
        Padding(
          padding: const EdgeInsets.symmetric(
            vertical: AppTokens.spaceExtraSmall,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20, color: AppTheme.primary),
              const SizedBox(width: AppTokens.spaceSmall),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: AppTheme.onSurfaceVariant,
                      ),
                    ),
                    Text(
                      value,
                      key: key,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );

    return DarbCard(
      key: const ValueKey('driverStopDetails'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.driverWhereToFindTitle, style: theme.textTheme.titleMedium),
          const SizedBox(height: AppTokens.spaceSmall),
          if (passenger != null) ...[
            line(
              Icons.person_pin_circle_outlined,
              l10n.driverPickupDetailsLabel,
              driverPassengerPickupText(context, passenger),
              key: const ValueKey('driverPassengerPickup'),
            ),
            line(
              Icons.flag_outlined,
              l10n.driverDropoffDetailsLabel,
              driverPassengerDropoffText(context, passenger),
              key: const ValueKey('driverPassengerDropoff'),
            ),
          ],
          for (final (orderIndex, batchOrder) in orders.indexed) ...[
            if (passenger != null || orderIndex > 0) const Divider(),
            Text(
              l10n.driverBatchOrderTitle(orderIndex + 1, orders.length),
              key: ValueKey('driverBatchOrder-$orderIndex'),
              style: theme.textTheme.labelLarge,
            ),
            line(
              Icons.storefront_outlined,
              l10n.driverMerchantPickupLabel,
              driverMerchantPickupText(context, batchOrder.asMerchantSummary),
              key: ValueKey('driverBatchOrderPickup-$orderIndex'),
            ),
            for (final (index, parcel) in batchOrder.parcels.indexed)
              if (driverParcelDropoffText(context, parcel) case final place?)
                line(
                  Icons.inventory_2_outlined,
                  l10n.driverParcelStopLabel(index + 1),
                  _parcelStopText(l10n, place, parcel),
                  key: ValueKey('driverBatchParcelStop-$orderIndex-$index'),
                ),
          ],
          if (order != null && orders.isEmpty) ...[
            if (passenger != null) const Divider(),
            line(
              Icons.storefront_outlined,
              l10n.driverMerchantPickupLabel,
              driverMerchantPickupText(context, order),
              key: const ValueKey('driverMerchantPickup'),
            ),
            if (parcels.isNotEmpty) ...[
              const SizedBox(height: AppTokens.spaceSmall),
              Text(
                l10n.driverParcelStopsTitle,
                style: theme.textTheme.labelLarge,
              ),
              for (final (index, parcel) in parcels.indexed)
                if (driverParcelDropoffText(context, parcel) case final place?)
                  line(
                    Icons.inventory_2_outlined,
                    l10n.driverParcelStopLabel(index + 1),
                    _parcelStopText(l10n, place, parcel),
                    key: ValueKey('driverParcelStop-$index'),
                  ),
            ],
          ],
        ],
      ),
    );
  }
}

/// A parcel's drop-off, then its receiver when the sender gave one.
String _parcelStopText(
  AppLocalizations l10n,
  String place,
  DriverParcelStop parcel,
) => [
  place,
  if (parcel.receiverName != null || parcel.receiverPhone != null)
    '${l10n.driverReceiverLabel}: ${[parcel.receiverName, parcel.receiverPhone].nonNulls.join(' · ')}',
].join('\n');

String matchTypeLabel(AppLocalizations l10n, DriverMatch match) {
  if (match.isCombined) return l10n.combinedAssignment;
  // A passenger's own parcel is not a shop's order.
  if (match.isPassengerParcel) return l10n.passengerParcelAssignment;
  if (match.isMerchantOnly) return l10n.merchantOrder;
  return l10n.passengerRequest;
}

String nextTripActionLabel(AppLocalizations l10n, String status) =>
    switch (status) {
      'pickup_started' => l10n.startPickup,
      'picked_up' => l10n.pickedUpAction,
      'in_transit' => l10n.startTrip,
      'delivered' => l10n.deliver,
      'completed' => l10n.completeTrip,
      _ => status,
    };

String percent(double value) => '${(value * 100).toStringAsFixed(1)}%';

Widget technicalText(String value, {Key? key, bool selectable = false}) {
  return Directionality(
    textDirection: TextDirection.ltr,
    child: selectable ? SelectableText(value, key: key) : Text(value, key: key),
  );
}

String localizedOrigin(BuildContext context, String fallback) =>
    localizedCorridorPlace(context, fallback);
