import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
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
    _ => l10n.requestFailed,
  };
}

String matchTypeLabel(AppLocalizations l10n, DriverMatch match) {
  if (match.isCombined) return l10n.combinedAssignment;
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

String localizedOrigin(BuildContext context, String fallback) {
  return Localizations.localeOf(context).languageCode == 'ar' &&
          fallback == lockedDriverOriginLabel
      ? 'الخليل / جامعة بوليتكنك فلسطين / باب الزاوية'
      : fallback;
}
