import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../data/delivery_handover_models.dart';
import '../delivery_handover_strings.dart';

/// What the driver decided in the hand-over dialog.
sealed class ReceiverConfirmationResult {
  const ReceiverConfirmationResult();
}

/// Codes for the stops the driver is at; stops left blank stay open.
class ReceiverCodes extends ReceiverConfirmationResult {
  const ReceiverCodes(this.codesByOrderId);
  final Map<String, String> codesByOrderId;
}

/// The receiver of [orderIds] could not be reached, and why.
class ReceiverUnavailable extends ReceiverConfirmationResult {
  const ReceiverUnavailable(this.reason, {this.orderIds = const []});
  final String reason;
  final List<String> orderIds;
}

/// Asks the driver for the code each receiver reads out, or for the reason the
/// receiver is unavailable. On a trip with several stops the driver confirms
/// the stop they are at: each code field is labelled with its stop
/// ([stopLabels], by order id) and blank fields stay open for later. Returns
/// null when the driver backs out.
Future<ReceiverConfirmationResult?> showReceiverConfirmationDialog(
  BuildContext context, {
  required List<OrderDeliveryConfirmation> pending,
  Map<String, String> stopLabels = const {},
}) {
  return showDialog<ReceiverConfirmationResult>(
    context: context,
    builder: (context) =>
        ReceiverConfirmationDialog(pending: pending, stopLabels: stopLabels),
  );
}

class ReceiverConfirmationDialog extends StatefulWidget {
  const ReceiverConfirmationDialog({
    required this.pending,
    this.stopLabels = const {},
    super.key,
  });

  final List<OrderDeliveryConfirmation> pending;

  /// What to call each order's stop (receiver and drop-off), by order id.
  final Map<String, String> stopLabels;

  @override
  State<ReceiverConfirmationDialog> createState() =>
      _ReceiverConfirmationDialogState();
}

class _ReceiverConfirmationDialogState
    extends State<ReceiverConfirmationDialog> {
  late final List<TextEditingController> _codes = [
    for (final _ in widget.pending) TextEditingController(),
  ];
  final _reason = TextEditingController();
  bool _unavailable = false;
  String? _error;

  /// The stop whose receiver is unavailable.
  late String? _unavailableOrderId = widget.pending.firstOrNull?.orderId;

  bool get _severalStops => widget.pending.length > 1;

  @override
  void dispose() {
    for (final controller in _codes) {
      controller.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  String _label(HandoverStrings s, int index) =>
      widget.stopLabels[widget.pending[index].orderId] ??
      s.codeFieldLabel(index + 1, widget.pending.length);

  void _submit(HandoverStrings s) {
    if (_unavailable) {
      final reason = _reason.text.trim();
      if (reason.length < 10) {
        setState(() => _error = s.reasonTooShort);
        return;
      }
      final orderId = _unavailableOrderId;
      Navigator.of(context).pop(
        ReceiverUnavailable(
          reason,
          orderIds: orderId == null ? const [] : [orderId],
        ),
      );
      return;
    }
    final codes = <String, String>{};
    for (final (index, order) in widget.pending.indexed) {
      final value = _codes[index].text.trim();
      // Another stop's field is left blank until the driver gets there.
      if (value.isEmpty && _severalStops) continue;
      if (!RegExp(r'^\d{6}$').hasMatch(value)) {
        setState(() => _error = s.invalidCodeFormat);
        return;
      }
      codes[order.orderId] = value;
    }
    if (codes.isEmpty) {
      setState(
        () => _error = AppLocalizations.of(context).handoverStopCodeRequired,
      );
      return;
    }
    Navigator.of(context).pop(ReceiverCodes(codes));
  }

  @override
  Widget build(BuildContext context) {
    final s = HandoverStrings.of(context);
    final intro = _unavailable
        ? s.unavailableIntro
        : _severalStops
        ? AppLocalizations.of(context).handoverStopIntro
        : s.driverIntro;
    return AlertDialog(
      title: Text(_unavailable ? s.receiverUnavailable : s.driverTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(intro),
            const SizedBox(height: 12),
            if (_unavailable) ...[
              if (_severalStops) ...[
                Text(AppLocalizations.of(context).handoverUnavailableStop),
                RadioGroup<String>(
                  groupValue: _unavailableOrderId,
                  onChanged: (value) =>
                      setState(() => _unavailableOrderId = value),
                  child: Column(
                    children: [
                      for (final (index, order) in widget.pending.indexed)
                        RadioListTile<String>(
                          key: ValueKey('receiverUnavailableStop-$index'),
                          contentPadding: EdgeInsets.zero,
                          value: order.orderId,
                          title: Text(_label(s, index)),
                        ),
                    ],
                  ),
                ),
              ],
              TextField(
                key: const ValueKey('receiverUnavailableReason'),
                controller: _reason,
                maxLength: 300,
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(labelText: s.reasonLabelField),
              ),
            ] else
              for (final (index, _) in widget.pending.indexed) ...[
                TextField(
                  key: ValueKey('receiverCodeField-$index'),
                  controller: _codes[index],
                  keyboardType: TextInputType.number,
                  textDirection: TextDirection.ltr,
                  maxLength: 6,
                  autofocus: index == 0,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(labelText: _label(s, index)),
                ),
              ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  key: const ValueKey('receiverConfirmationError'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const ValueKey('receiverToggleUnavailable'),
          onPressed: () => setState(() {
            _unavailable = !_unavailable;
            _error = null;
          }),
          child: Text(_unavailable ? s.back : s.receiverUnavailable),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(s.cancel),
        ),
        FilledButton(
          key: const ValueKey('receiverConfirmSubmit'),
          onPressed: () => _submit(s),
          child: Text(_unavailable ? s.confirmUnavailable : s.confirm),
        ),
      ],
    );
  }
}
