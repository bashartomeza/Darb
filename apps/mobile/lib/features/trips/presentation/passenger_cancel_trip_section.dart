import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/cancellation/cancellation.dart';
import '../../passenger/application/passenger_controller.dart';
import '../../passenger/data/passenger_repository.dart';
import '../application/passenger_trip_controller.dart';
import '../data/trip_models.dart';

/// The passenger's cancel action on the trip screen, and the reason a
/// cancelled trip shows. A trip can be cancelled before the passenger is
/// picked up; the driver is told. Cancelling goes through the ride request
/// (the same endpoint as the request screen).
class PassengerCancelTripSection extends ConsumerStatefulWidget {
  const PassengerCancelTripSection({required this.trip, super.key});

  final PassengerTrip trip;

  @override
  ConsumerState<PassengerCancelTripSection> createState() =>
      _PassengerCancelTripSectionState();
}

class _PassengerCancelTripSectionState
    extends ConsumerState<PassengerCancelTripSection> {
  bool _busy = false;

  Future<void> _cancel() async {
    final requestId = widget.trip.passengerRequestId;
    if (_busy || requestId == null) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final choice = await showCancelReasonDialog(
      context,
      role: CancelRole.rider,
      title: l10n.cancelRequest,
      message: l10n.cancelAcceptedRideConfirm,
      confirmLabel: l10n.cancelRequest,
    );
    if (choice == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(passengerRepositoryProvider)
          .cancelRequest(requestId, choice);
    } catch (error) {
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text(_errorLabel(l10n, error))),
        );
      }
    } finally {
      // Re-read even after a failure: a lost response may have committed.
      invalidatePassengerLists(ref.invalidate);
      if (mounted) {
        ref.invalidate(passengerTripControllerProvider(widget.trip.id));
        setState(() => _busy = false);
      }
    }
  }

  String _errorLabel(AppLocalizations l10n, Object error) {
    if (error is! ApiException) return l10n.requestFailed;
    return switch (error.type) {
      ApiErrorType.network => l10n.networkUnavailable,
      ApiErrorType.timeout => l10n.requestTimedOut,
      ApiErrorType.unauthorized => l10n.sessionEnded,
      ApiErrorType.forbidden => l10n.forbidden,
      ApiErrorType.server => l10n.requestFailed,
      _ => l10n.requestCannotBeCancelled,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final trip = widget.trip;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (trip.status == 'cancelled')
          CancellationReasonNote(info: trip.cancellation),
        if (trip.passengerCanCancel)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton(
              key: const ValueKey('passengerCancelTripButton'),
              onPressed: _busy ? null : _cancel,
              child: Text(l10n.cancelRequest),
            ),
          ),
      ],
    );
  }
}
