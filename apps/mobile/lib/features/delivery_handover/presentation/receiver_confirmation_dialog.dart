import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/delivery_handover_models.dart';
import '../delivery_handover_strings.dart';

/// What the driver decided in the hand-over dialog.
sealed class ReceiverConfirmationResult {
  const ReceiverConfirmationResult();
}

class ReceiverCodes extends ReceiverConfirmationResult {
  const ReceiverCodes(this.codesByOrderId);
  final Map<String, String> codesByOrderId;
}

class ReceiverUnavailable extends ReceiverConfirmationResult {
  const ReceiverUnavailable(this.reason);
  final String reason;
}

/// Asks the driver for the code each receiver reads out, or for the reason the
/// receiver is unavailable. Returns null when the driver backs out.
Future<ReceiverConfirmationResult?> showReceiverConfirmationDialog(
  BuildContext context, {
  required List<OrderDeliveryConfirmation> pending,
}) {
  return showDialog<ReceiverConfirmationResult>(
    context: context,
    builder: (context) => ReceiverConfirmationDialog(pending: pending),
  );
}

class ReceiverConfirmationDialog extends StatefulWidget {
  const ReceiverConfirmationDialog({required this.pending, super.key});

  final List<OrderDeliveryConfirmation> pending;

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

  @override
  void dispose() {
    for (final controller in _codes) {
      controller.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  void _submit(HandoverStrings s) {
    if (_unavailable) {
      final reason = _reason.text.trim();
      if (reason.length < 10) {
        setState(() => _error = s.reasonTooShort);
        return;
      }
      Navigator.of(context).pop(ReceiverUnavailable(reason));
      return;
    }
    final codes = <String, String>{};
    for (final (index, order) in widget.pending.indexed) {
      final value = _codes[index].text.trim();
      if (!RegExp(r'^\d{6}$').hasMatch(value)) {
        setState(() => _error = s.invalidCodeFormat);
        return;
      }
      codes[order.orderId] = value;
    }
    Navigator.of(context).pop(ReceiverCodes(codes));
  }

  @override
  Widget build(BuildContext context) {
    final s = HandoverStrings.of(context);
    return AlertDialog(
      title: Text(_unavailable ? s.receiverUnavailable : s.driverTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_unavailable ? s.unavailableIntro : s.driverIntro),
            const SizedBox(height: 12),
            if (_unavailable)
              TextField(
                key: const ValueKey('receiverUnavailableReason'),
                controller: _reason,
                maxLength: 300,
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(labelText: s.reasonLabelField),
              )
            else
              for (final (index, _) in widget.pending.indexed) ...[
                TextField(
                  key: ValueKey('receiverCodeField-$index'),
                  controller: _codes[index],
                  keyboardType: TextInputType.number,
                  textDirection: TextDirection.ltr,
                  maxLength: 6,
                  autofocus: index == 0,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    labelText: s.codeFieldLabel(
                      index + 1,
                      widget.pending.length,
                    ),
                  ),
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
