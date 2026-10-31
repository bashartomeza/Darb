import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/widgets/status_chip.dart';
import '../data/passenger_parcel_models.dart';

String parcelTrackingLabel(AppLocalizations l10n, ParcelTrackingState state) =>
    switch (state) {
      ParcelTrackingState.searching => l10n.parcelTrackSearching,
      ParcelTrackingState.assigned => l10n.parcelTrackAssigned,
      ParcelTrackingState.pickedUp => l10n.parcelTrackPickedUp,
      ParcelTrackingState.inTransit => l10n.parcelTrackInTransit,
      ParcelTrackingState.delivered => l10n.parcelTrackDelivered,
      ParcelTrackingState.cancelled => l10n.parcelTrackCancelled,
      ParcelTrackingState.failed => l10n.parcelTrackFailed,
      ParcelTrackingState.expired => l10n.parcelTrackExpired,
    };

StatusTone parcelTrackingTone(ParcelTrackingState state) => switch (state) {
  ParcelTrackingState.searching => StatusTone.pending,
  ParcelTrackingState.assigned => StatusTone.confirmed,
  ParcelTrackingState.pickedUp ||
  ParcelTrackingState.inTransit => StatusTone.active,
  ParcelTrackingState.delivered => StatusTone.success,
  ParcelTrackingState.cancelled ||
  ParcelTrackingState.expired => StatusTone.neutral,
  ParcelTrackingState.failed => StatusTone.error,
};

/// Translates an API error from the parcel endpoints into the sender's language.
String parcelErrorLabel(AppLocalizations l10n, String? code, int? statusCode) {
  switch (code) {
    case 'passenger_parcel_limit_reached':
      return l10n.parcelLimitReached;
    case 'passenger_parcel_daily_limit_reached':
      return l10n.parcelDailyLimit;
    case 'invalid_receiver_phone':
      return l10n.invalidReceiverPhone;
    case 'parcel_cannot_be_cancelled':
      return l10n.parcelCannotCancel;
    case 'forbidden_items_acknowledgement_required':
      return l10n.parcelAckRequired;
    case 'invalid_departure_window':
    case 'departure_window_out_of_range':
      return l10n.invalidDepartureWindow;
  }
  return l10n.requestFailed;
}

Widget parcelStateChip(AppLocalizations l10n, ParcelTrackingState state) =>
    StatusChip(
      label: parcelTrackingLabel(l10n, state),
      tone: parcelTrackingTone(state),
    );
