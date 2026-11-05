import 'package:flutter/material.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../theme/app_tokens.dart';

/// Who is cancelling, which decides the list of reasons to choose from. The
/// codes are the API's (apps/api/src/services/cancellationReasons.ts).
enum CancelRole {
  /// A passenger cancelling a ride request.
  rider([
    'changed_plans',
    'found_other_transport',
    'driver_too_far',
    'wrong_details',
    'other',
  ]),

  /// A merchant or parcel sender cancelling an order.
  sender([
    'changed_plans',
    'wrong_details',
    'found_other_delivery',
    'driver_too_far',
    'other',
  ]),

  /// A driver cancelling an accepted trip.
  driver([
    'vehicle_problem',
    'emergency',
    'cannot_reach_pickup',
    'route_changed',
    'other',
  ]);

  const CancelRole(this.reasons);
  final List<String> reasons;
}

/// The reason (and optional note) a person picked when cancelling.
class CancelChoice {
  const CancelChoice(this.reason, {this.note});

  final String reason;
  final String? note;

  /// The request body every cancel endpoint takes.
  Map<String, dynamic> toBody() => {
    'reason': reason,
    if (note != null && note!.isNotEmpty) 'note': note,
  };
}

/// Who ended a cancelled ride, order or parcel and why, as the API returns
/// it. The free-text note is never part of it.
class CancellationInfo {
  const CancellationInfo({
    required this.reason,
    required this.by,
    required this.automatic,
  });

  final String reason;

  /// passenger, merchant, driver, admin or system.
  final String by;
  final bool automatic;

  static CancellationInfo? tryParse(Object? json) {
    if (json is! Map) return null;
    final reason = json['reason'];
    final by = json['by'];
    if (reason is! String || by is! String) return null;
    return CancellationInfo(
      reason: reason,
      by: by,
      automatic: json['automatic'] == true,
    );
  }
}

/// The label of a cancellation reason code; an unknown code reads as "other".
String cancelReasonLabel(AppLocalizations l10n, String code) => switch (code) {
  'changed_plans' => l10n.cancelReasonChangedPlans,
  'found_other_transport' => l10n.cancelReasonFoundOtherTransport,
  'driver_too_far' => l10n.cancelReasonDriverTooFar,
  'wrong_details' => l10n.cancelReasonWrongDetails,
  'found_other_delivery' => l10n.cancelReasonFoundOtherDelivery,
  'vehicle_problem' => l10n.cancelReasonVehicleProblem,
  'emergency' => l10n.cancelReasonEmergency,
  'cannot_reach_pickup' => l10n.cancelReasonCannotReachPickup,
  'route_changed' => l10n.cancelReasonRouteChanged,
  'customer_request' => l10n.cancelReasonCustomerRequest,
  'driver_unavailable' => l10n.cancelReasonDriverUnavailable,
  'safety_concern' => l10n.cancelReasonSafetyConcern,
  'duplicate' => l10n.cancelReasonDuplicate,
  'policy_violation' => l10n.cancelReasonPolicyViolation,
  'no_driver_in_time' => l10n.cancelReasonNoDriverInTime,
  _ => l10n.cancelReasonOther,
};

/// "Cancelled automatically: …", "Cancelled by the driver: …" and so on.
///
/// The passenger or sender who cancelled reads "You cancelled"; a driver
/// reading the same trip ([viewerIsDriver]) reads who cancelled it, and
/// reads "You cancelled" for a trip they cancelled themselves.
String cancellationSummary(
  AppLocalizations l10n,
  CancellationInfo info, {
  bool viewerIsDriver = false,
}) {
  final reason = cancelReasonLabel(l10n, info.reason);
  if (info.automatic || info.by == 'system') {
    return l10n.cancelledAutomaticallyReason(reason);
  }
  return switch (info.by) {
    'driver' =>
      viewerIsDriver
          ? l10n.cancelledByYouReason(reason)
          : l10n.cancelledByDriverReason(reason),
    'admin' => l10n.cancelledByAdminReason(reason),
    'passenger' when viewerIsDriver => l10n.cancelledByPassengerReason(reason),
    'merchant' when viewerIsDriver => l10n.cancelledBySenderReason(reason),
    _ => l10n.cancelledByYouReason(reason),
  };
}

/// Shows why a cancelled ride, order or parcel was cancelled. Draws nothing
/// when the item has no recorded cancellation (older items).
class CancellationReasonNote extends StatelessWidget {
  const CancellationReasonNote({
    required this.info,
    this.viewerIsDriver = false,
    super.key,
  });

  final CancellationInfo? info;
  final bool viewerIsDriver;

  @override
  Widget build(BuildContext context) {
    final value = info;
    if (value == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: AppTokens.spaceSmall),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: scheme.onSurfaceVariant),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              cancellationSummary(l10n, value, viewerIsDriver: viewerIsDriver),
              key: const ValueKey('cancellationReasonNote'),
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

/// The reason list and note box shared by every cancel dialog. Reports the
/// current choice (null until a reason is picked) through [onChanged].
class CancelReasonPicker extends StatefulWidget {
  const CancelReasonPicker({
    required this.role,
    required this.onChanged,
    super.key,
  });

  final CancelRole role;
  final ValueChanged<CancelChoice?> onChanged;

  @override
  State<CancelReasonPicker> createState() => _CancelReasonPickerState();
}

class _CancelReasonPickerState extends State<CancelReasonPicker> {
  String? _reason;
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _report() {
    final reason = _reason;
    widget.onChanged(
      reason == null ? null : CancelChoice(reason, note: _note.text.trim()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.cancelReasonPrompt,
          style: Theme.of(context).textTheme.titleSmall,
        ),
        RadioGroup<String>(
          groupValue: _reason,
          onChanged: (value) {
            setState(() => _reason = value);
            _report();
          },
          child: Column(
            children: [
              for (final code in widget.role.reasons)
                RadioListTile<String>(
                  key: ValueKey('cancelReason-$code'),
                  value: code,
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(cancelReasonLabel(l10n, code)),
                ),
            ],
          ),
        ),
        TextField(
          key: const ValueKey('cancelNoteField'),
          controller: _note,
          maxLength: 300,
          maxLines: 2,
          decoration: InputDecoration(labelText: l10n.cancelNoteLabel),
          onChanged: (_) => _report(),
        ),
      ],
    );
  }
}

/// Asks why, then confirms. Returns the choice, or null when the person
/// keeps the ride, order or trip. Nothing is cancelled until a reason is
/// picked and the confirm button is pressed.
Future<CancelChoice?> showCancelReasonDialog(
  BuildContext context, {
  required CancelRole role,
  required String title,
  required String message,
  required String confirmLabel,
  Widget? extra,
}) {
  return showDialog<CancelChoice>(
    context: context,
    builder: (dialogContext) {
      CancelChoice? choice;
      return StatefulBuilder(
        builder: (context, setState) {
          final l10n = AppLocalizations.of(context);
          return AlertDialog(
            key: const ValueKey('cancelReasonDialog'),
            title: Text(title),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(message),
                  if (extra != null) ...[const SizedBox(height: 12), extra],
                  const SizedBox(height: 12),
                  CancelReasonPicker(
                    role: role,
                    onChanged: (value) => setState(() => choice = value),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                key: const ValueKey('cancelReasonKeep'),
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(l10n.cancelReasonKeep),
              ),
              FilledButton(
                key: const ValueKey('cancelReasonConfirm'),
                onPressed: choice == null
                    ? null
                    : () => Navigator.of(dialogContext).pop(choice),
                child: Text(confirmLabel),
              ),
            ],
          );
        },
      );
    },
  );
}
