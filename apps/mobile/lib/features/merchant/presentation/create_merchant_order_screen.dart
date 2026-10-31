import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_back_button.dart';
import '../../../core/widgets/masari_card.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import '../application/merchant_order_submission.dart';
import '../data/merchant_order_operation_storage.dart';
import 'merchant_ui.dart';

class CreateMerchantOrderScreen extends ConsumerStatefulWidget {
  const CreateMerchantOrderScreen({super.key});

  @override
  ConsumerState<CreateMerchantOrderScreen> createState() =>
      _CreateMerchantOrderScreenState();
}

class _CreateMerchantOrderScreenState
    extends ConsumerState<CreateMerchantOrderScreen> {
  bool _busy = true;
  bool _locked = true;
  Animation<double>? _navigationAnimation;
  AnimationStatusListener? _navigationListener;
  Completer<bool>? _navigationReady;

  @override
  void dispose() {
    final listener = _navigationListener;
    if (listener != null) _navigationAnimation?.removeStatusListener(listener);
    if (_navigationReady?.isCompleted == false) {
      _navigationReady!.complete(false);
    }
    super.dispose();
  }

  Future<void> _openOrder(String id) async {
    // A fast read-only recovery can finish during the full-screen route's
    // entrance animation. Let that transition settle before returning to its shell.
    final animation = ModalRoute.of(context)?.animation;
    if (animation != null && animation.status != AnimationStatus.completed) {
      final ready = _navigationReady = Completer<bool>();
      void listener(AnimationStatus status) {
        if (status == AnimationStatus.completed ||
            status == AnimationStatus.dismissed) {
          animation.removeStatusListener(listener);
          _navigationListener = null;
          if (!ready.isCompleted) {
            ready.complete(status == AnimationStatus.completed);
          }
        }
      }

      _navigationAnimation = animation;
      _navigationListener = listener;
      animation.addStatusListener(listener);
      if (!await ready.future) return;
    }
    if (mounted && ModalRoute.of(context)?.isCurrent == true) {
      context.go('/merchant/order/$id');
    }
  }

  @override
  void initState() {
    super.initState();
    Future.microtask(_restorePending);
  }

  Future<void> _restorePending() async {
    final service = ref.read(merchantOrderSubmissionProvider);
    try {
      final pending = await service.pending();
      if (!mounted) return;
      if (pending == null) {
        _locked = false;
        return;
      }
      final parcels = (pending.payload['parcels'] as List).map((value) {
        if (!merchantDestinations.contains(value['destination_label'])) {
          throw const MerchantOrderRecoveryException(
            'merchant_order_recovery_unreadable',
          );
        }
        return ParcelDraft(
          destinationLabel: value['destination_label'] as String,
          size: value['size'] as String,
          priority: value['priority'] as String,
        );
      }).toList();
      ref.read(merchantOrderDraftProvider.notifier).restorePending(parcels);
      final order = await service.recover();
      if (!mounted) return;
      if (order != null) {
        ref.invalidate(merchantDashboardProvider);
        await _openOrder(order.id);
      } else {
        _error = AppLocalizations.of(context).merchantOrderUncertain;
      }
    } catch (error) {
      if (mounted) _error = _recoveryError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _recoveryError(Object error) {
    final l10n = AppLocalizations.of(context);
    return error is MerchantOrderRecoveryException
        ? merchantErrorLabel(l10n, error)
        : l10n.merchantOrderUncertain;
  }

  String? _error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final parcels = ref.watch(merchantOrderDraftProvider);
    final draft = ref.read(merchantOrderDraftProvider.notifier);
    return Scaffold(
      // Keyed like the other merchant screens so route-guard tests can assert
      // on the screen itself. Its title reuses `createOrder`, which is the same
      // Arabic string as the passenger's `createRequest` CTA, so matching on
      // text cannot tell the two screens apart.
      key: const ValueKey('merchantCreateOrder'),
      appBar: AppBar(
        title: Text(l10n.createOrder),
        leading: const MasariBackButton(fallback: '/merchant'),
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: [
            const SizedBox(height: AppTokens.spaceLarge),
            MasariCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.fixedPickup,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Text(l10n.lockedCorridor),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.spaceMedium),
            ...parcels.indexed.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.spaceMedium),
                child: _parcelCard(l10n, entry.$1, entry.$2),
              ),
            ),
            OutlinedButton.icon(
              key: const ValueKey('addParcelButton'),
              onPressed: !_busy && !_locked && draft.canAdd
                  ? draft.addParcel
                  : null,
              icon: const Icon(Icons.add),
              label: Text('${l10n.addParcel} (${parcels.length}/10)'),
            ),
            Text(l10n.parcelLimit),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            const SizedBox(height: AppTokens.spaceLarge),
            TextButton.icon(
              key: const ValueKey('openBulkOrders'),
              onPressed: _busy
                  ? null
                  : () => context.push('/merchant/order/bulk'),
              icon: const Icon(Icons.upload_file_outlined),
              label: Text(
                Localizations.localeOf(context).languageCode == 'ar'
                    ? 'رفع طلبات بالجملة (CSV)'
                    : 'Bulk upload (CSV)',
              ),
            ),
            FilledButton(
              key: const ValueKey('submitMerchantOrder'),
              onPressed: _busy ? null : _submit,
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.tertiary,
                foregroundColor: Theme.of(context).colorScheme.onTertiary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTokens.radiusAction),
                ),
              ),
              child: Text(
                _locked ? l10n.recoverMerchantOrder : l10n.submitOrder,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _parcelCard(AppLocalizations l10n, int index, ParcelDraft parcel) {
    final controller = ref.read(merchantOrderDraftProvider.notifier);
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${l10n.parcel} ${index + 1}',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          DropdownButtonFormField<String>(
            key: ValueKey('parcelDestination-$index'),
            initialValue: parcel.destinationLabel,
            decoration: InputDecoration(labelText: l10n.destination),
            items: merchantDestinations
                .map(
                  (value) => DropdownMenuItem(
                    value: value,
                    child: Text(merchantDestinationLabel(context, value)),
                  ),
                )
                .toList(),
            onChanged: _busy || _locked
                ? null
                : (value) =>
                      controller.updateParcel(index, destinationLabel: value),
          ),
          DropdownButtonFormField<String>(
            key: ValueKey('parcelSize-$index'),
            initialValue: parcel.size,
            decoration: InputDecoration(labelText: l10n.parcelSize),
            items: const ['S', 'M', 'L']
                .map(
                  (value) => DropdownMenuItem(value: value, child: Text(value)),
                )
                .toList(),
            onChanged: _busy || _locked
                ? null
                : (value) => controller.updateParcel(index, size: value),
          ),
          DropdownButtonFormField<String>(
            key: ValueKey('parcelPriority-$index'),
            initialValue: parcel.priority,
            decoration: InputDecoration(labelText: l10n.priority),
            items: ['low', 'normal', 'high']
                .map(
                  (value) => DropdownMenuItem(
                    value: value,
                    child: Text(merchantPriorityLabel(l10n, value)),
                  ),
                )
                .toList(),
            onChanged: _busy || _locked
                ? null
                : (value) => controller.updateParcel(index, priority: value),
          ),
          if (controller.canRemove)
            TextButton.icon(
              key: ValueKey('removeParcel-$index'),
              onPressed: _busy || _locked
                  ? null
                  : () => controller.removeParcel(index),
              icon: const Icon(Icons.remove_circle_outline),
              label: Text(l10n.removeParcel),
            ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    final service = ref.read(merchantOrderSubmissionProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final order = _locked
          ? await service.resume()
          : await service.submit(ref.read(merchantOrderDraftProvider));
      ref.invalidate(merchantDashboardProvider);
      if (mounted) await _openOrder(order.id);
    } catch (error) {
      if (!mounted) return;
      try {
        _locked = await service.pending() != null;
      } catch (_) {
        _locked = true;
      }
      if (mounted) {
        setState(
          () => _error = _locked
              ? _recoveryError(error)
              : merchantErrorLabel(AppLocalizations.of(context), error),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
