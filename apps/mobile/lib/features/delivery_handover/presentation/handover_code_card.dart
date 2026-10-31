import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_tokens.dart';
import '../data/delivery_handover_models.dart';
import '../data/delivery_handover_repository.dart';
import '../delivery_handover_strings.dart';

/// The sender's side of the receiver hand-over: shows the six-digit code to give
/// the receiver, or how the delivery was confirmed. Works for any parcel order, so
/// merchant and passenger senders share it. When [initial] is null the card loads
/// the current state itself.
class HandoverCodeCard extends ConsumerStatefulWidget {
  const HandoverCodeCard({required this.orderId, this.initial, super.key});

  final String orderId;
  final HandoverStatus? initial;

  @override
  ConsumerState<HandoverCodeCard> createState() => _HandoverCodeCardState();
}

class _HandoverCodeCardState extends ConsumerState<HandoverCodeCard> {
  HandoverStatus? _status;
  String? _code;
  bool _busy = false;
  bool _loadFailed = false;

  @override
  void initState() {
    super.initState();
    _status = widget.initial;
    _code = widget.initial?.code ?? HandoverCodeVault.recall(widget.orderId);
    if (_status == null) Future.microtask(_load);
  }

  @override
  void didUpdateWidget(covariant HandoverCodeCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final incoming = widget.initial;
    // A refresh of the parent brings authoritative state (for example "confirmed").
    if (incoming != null &&
        incoming.confirmed &&
        !(_status?.confirmed ?? false)) {
      _status = incoming;
    }
  }

  Future<void> _load() async {
    try {
      final status = await ref
          .read(deliveryHandoverRepositoryProvider)
          .status(widget.orderId);
      if (mounted) setState(() => _status = status);
    } catch (_) {
      if (mounted) setState(() => _loadFailed = true);
    }
  }

  Future<void> _issue() async {
    setState(() {
      _busy = true;
      _loadFailed = false;
    });
    try {
      final status = await ref
          .read(deliveryHandoverRepositoryProvider)
          .regenerate(widget.orderId);
      if (mounted) {
        setState(() {
          _status = status;
          _code = status.code;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadFailed = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = HandoverStrings.of(context);
    final theme = Theme.of(context);
    final status = _status;

    return Card(
      key: const ValueKey('handoverCodeCard'),
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.spaceMedium),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.verified_user_outlined),
                const SizedBox(width: AppTokens.spaceSmall),
                Expanded(
                  child: Text(
                    s.senderTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppTokens.spaceSmall),
            if (status == null && !_loadFailed)
              const Center(child: CircularProgressIndicator())
            else if (status == null)
              Text(s.couldNotLoad, key: const ValueKey('handoverLoadError'))
            else if (status.confirmed)
              _confirmed(s, status)
            else
              ..._open(s, theme, status),
          ],
        ),
      ),
    );
  }

  Widget _confirmed(HandoverStrings s, HandoverStatus status) {
    final text = switch (status.method) {
      'receiver_unavailable' => s.confirmedUnavailable,
      'admin_override' => s.confirmedAdmin,
      _ => s.confirmedByCode,
    };
    final reason = status.unavailableReason;
    return Column(
      key: const ValueKey('handoverConfirmed'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(text),
        if (reason != null && reason.isNotEmpty) ...[
          const SizedBox(height: AppTokens.spaceSmall),
          Text(s.reasonLabel(reason)),
        ],
      ],
    );
  }

  List<Widget> _open(
    HandoverStrings s,
    ThemeData theme,
    HandoverStatus status,
  ) {
    final code = _code;
    final usable = code != null && !status.locked && !status.expired;
    return [
      if (usable) ...[
        Center(
          child: SelectableText(
            code,
            key: const ValueKey('handoverCode'),
            textDirection: TextDirection.ltr,
            style: theme.textTheme.displaySmall?.copyWith(
              letterSpacing: 8,
              fontWeight: FontWeight.w800,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
        const SizedBox(height: AppTokens.spaceSmall),
        Text(s.senderHint),
        if (status.attemptsRemaining < 5) ...[
          const SizedBox(height: AppTokens.spaceSmall),
          Text(s.attemptsLeft(status.attemptsRemaining)),
        ],
      ] else if (!status.issued)
        Text(s.notIssued, key: const ValueKey('handoverNotIssued'))
      else if (status.locked)
        Text(s.locked, key: const ValueKey('handoverLocked'))
      else if (status.expired)
        Text(s.expired, key: const ValueKey('handoverExpired'))
      else
        Text(s.codeHidden, key: const ValueKey('handoverHidden')),
      const SizedBox(height: AppTokens.spaceSmall),
      Row(
        children: [
          if (usable)
            IconButton(
              tooltip: MaterialLocalizations.of(context).copyButtonLabel,
              onPressed: () => Clipboard.setData(ClipboardData(text: code)),
              icon: const Icon(Icons.copy_outlined),
            ),
          const Spacer(),
          OutlinedButton(
            key: const ValueKey('handoverIssueButton'),
            onPressed: _busy ? null : _issue,
            child: Text(status.issued ? s.newCode : s.createCode),
          ),
        ],
      ),
      if (_loadFailed) Text(s.couldNotLoad),
    ];
  }
}
