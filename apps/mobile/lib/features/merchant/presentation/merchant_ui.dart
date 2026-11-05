import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/cancellation/cancellation.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/widgets/discard_saved_request_button.dart';
import '../data/merchant_models.dart';
import '../data/merchant_order_operation_storage.dart';
import 'widgets/merchant_design.dart';

String merchantStatusLabel(AppLocalizations l10n, String status) =>
    switch (status) {
      'draft' => l10n.statusDraft,
      'submitted' => l10n.statusSubmitted,
      'batched' => l10n.statusBatched,
      'proposed' => l10n.statusProposed,
      'sent_to_driver' => l10n.statusSentToDriver,
      'pending' => l10n.statusPending,
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
      'assigned' => l10n.statusAssigned,
      'created' => l10n.statusCreated,
      _ => status,
    };

String merchantErrorLabel(AppLocalizations l10n, Object error) {
  final saved = savedRequestOutcomeLabel(l10n, error);
  if (saved != null) return saved;
  if (error is MerchantOrderRecoveryException) {
    return switch (error.code) {
      'merchant_order_recovery_expired' => l10n.merchantOrderRecoveryExpired,
      'merchant_order_pending' ||
      'merchant_order_in_progress' => l10n.merchantOrderUncertain,
      _ => l10n.merchantOrderRecoveryUnavailable,
    };
  }
  if (error is! ApiException) return l10n.requestFailed;
  if (error.type == ApiErrorType.network) return l10n.networkUnavailable;
  if (error.type == ApiErrorType.timeout) return l10n.requestTimedOut;
  if (error.type == ApiErrorType.forbidden) return l10n.forbidden;
  return switch (error.message) {
    'order_already_batched' => l10n.orderAlreadyBatched,
    'order_not_batchable' => l10n.orderAlreadyBatched,
    'no_route_with_parcel_capacity' ||
    'no_compatible_driver_route' => l10n.noCompatibleDriverFound,
    'route_unavailable' => l10n.orderRouteUnavailable,
    'invalid_receiver_phone' => l10n.merchantReceiverPhoneInvalid,
    _ => l10n.requestFailed,
  };
}

bool _arabic(BuildContext context) =>
    Localizations.localeOf(context).languageCode == 'ar';

/// Asks before cancelling [order], naming exactly what is cancelled: this
/// order and its parcels only. When it is grouped with other orders for one
/// driver, it says those stay grouped (and that a pending driver offer for
/// the group is withdrawn), and asks why. Returns the merchant's reason, or
/// null when they keep the order.
Future<CancelChoice?> showMerchantCancelOrderDialog(
  BuildContext context,
  MerchantOrder order,
) {
  final l10n = AppLocalizations.of(context);
  final batch = order.latestBatch;
  final others = batch != null && batch.isOpen ? batch.orderCount - 1 : 0;
  final reference = merchantReference(order.id);
  return showDialog<CancelChoice>(
    context: context,
    builder: (dialogContext) {
      CancelChoice? choice;
      return StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          key: const ValueKey('merchantCancelOrderDialog'),
          title: Text(l10n.merchantCancelOrderTitle),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.merchantCancelOrderBody(reference, order.parcels.length),
                  key: const ValueKey('merchantCancelOrderBody'),
                ),
                if (order.hasAcceptedDriver) ...[
                  const SizedBox(height: 12),
                  Text(
                    l10n.cancelAcceptedOrderNote,
                    key: const ValueKey('merchantCancelAcceptedNote'),
                  ),
                ],
                if (others > 0) ...[
                  const SizedBox(height: 12),
                  Text(
                    l10n.merchantCancelBatchNote(others),
                    key: const ValueKey('merchantCancelBatchNote'),
                  ),
                ],
                if (others > 0 && order.status == 'matched') ...[
                  const SizedBox(height: 12),
                  Text(
                    l10n.merchantCancelOfferNote,
                    key: const ValueKey('merchantCancelOfferNote'),
                  ),
                ],
                const SizedBox(height: 12),
                CancelReasonPicker(
                  role: CancelRole.sender,
                  onChanged: (value) => setState(() => choice = value),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              key: const ValueKey('merchantCancelOrderKeep'),
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.merchantCancelKeep),
            ),
            FilledButton(
              key: const ValueKey('merchantCancelOrderConfirm'),
              onPressed: choice == null
                  ? null
                  : () => Navigator.of(dialogContext).pop(choice),
              child: Text(l10n.merchantCancelConfirm),
            ),
          ],
        ),
      );
    },
  );
}

/// The order's route ("Hebron → Bethlehem"), or for orders created before
/// routes existed, the old pickup place and parcel destination(s).
String merchantOrderRouteLabel(BuildContext context, MerchantOrder order) {
  final name = order.routeName(arabic: _arabic(context));
  if (name != null) return name;
  final pickup = localizedCorridorPlace(context, order.pickupLabel);
  final destinations = {
    for (final parcel in order.parcels)
      merchantDestinationLabel(context, parcel.destinationLabel),
  };
  return destinations.length == 1 ? '$pickup ← ${destinations.first}' : pickup;
}

/// Where the parcels are collected: the merchant's own words, or the old
/// corridor place.
String merchantPickupText(BuildContext context, MerchantOrder order) =>
    order.pickupSummary(arabic: _arabic(context)) ??
    localizedCorridorPlace(context, order.pickupLabel);

/// Where one parcel goes: the merchant's own words, or the old corridor place.
String merchantParcelDropoffText(BuildContext context, MerchantParcel parcel) =>
    parcel.dropoffSummary(arabic: _arabic(context)) ??
    merchantDestinationLabel(context, parcel.destinationLabel);

String merchantDestinationLabel(BuildContext context, String value) {
  if (Localizations.localeOf(context).languageCode != 'ar') return value;
  return switch (value) {
    'Bethlehem Market' => 'سوق بيت لحم',
    'Bethlehem University Area' => 'منطقة جامعة بيت لحم',
    'Manger Street' => 'شارع المهد',
    'Beit Jala Junction' => 'مفرق بيت جالا',
    'Bethlehem Center' => 'وسط بيت لحم',
    _ => value,
  };
}

String merchantPriorityLabel(AppLocalizations l10n, String value) =>
    switch (value) {
      'low' => l10n.priorityLow,
      'high' => l10n.priorityHigh,
      _ => l10n.priorityNormal,
    };

String merchantPercent(double value) => '${(value * 100).toStringAsFixed(1)}%';

Widget merchantTechnicalText(String value, {Key? key}) => Directionality(
  textDirection: TextDirection.ltr,
  child: SelectableText(value, key: key),
);
