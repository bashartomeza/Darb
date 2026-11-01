import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_back_button.dart';
import '../../../core/widgets/darb_card.dart';
import '../../legacy_corridor/data/legacy_corridor_models.dart';
import '../../legacy_corridor/data/legacy_corridor_repository.dart';
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
    // New parcels start at the corridor's first drop-off stop, as soon as the
    // server has said which stops those are.
    ref.listenManual(legacyCorridorProvider, (_, next) {
      final destination = next.value?.parcelDropoffs.firstOrNull;
      if (destination == null) return;
      Future.microtask(() {
        if (!mounted) return;
        ref
            .read(merchantOrderDraftProvider.notifier)
            .fillMissingDestinations(destination);
      });
    }, fireImmediately: true);
  }

  /// The pickup stop in use: the merchant's choice while it is still offered,
  /// otherwise the corridor's first parcel pickup stop.
  CorridorPlace? _pickup(List<CorridorPlace> pickups) =>
      pickups.where((place) => place.key == _pickupKey).firstOrNull ??
      pickups.firstOrNull;

  static CorridorPlace? _placeOf(
    ParcelDraft parcel,
    List<CorridorPlace> places,
  ) => places
      .where(
        (place) =>
            place.label == parcel.destinationLabel &&
            place.lat == parcel.destinationLat &&
            place.lng == parcel.destinationLng,
      )
      .firstOrNull;

  Future<void> _restorePending() async {
    final service = ref.read(merchantOrderSubmissionProvider);
    try {
      final pending = await service.pending();
      if (!mounted) return;
      if (pending == null) {
        _locked = false;
        return;
      }
      // The stored payload is resent exactly as saved, so it is shown as saved
      // even if the corridor's places have changed since.
      final pickupLabel = pending.payload['pickup_label'];
      final parcels = (pending.payload['parcels'] as List).map((value) {
        final label = value['destination_label'];
        final lat = value['destination_lat'];
        final lng = value['destination_lng'];
        if (label is! String || lat is! num || lng is! num) {
          throw const MerchantOrderRecoveryException(
            'merchant_order_recovery_unreadable',
          );
        }
        return ParcelDraft(
          destinationLabel: label,
          destinationLat: lat.toDouble(),
          destinationLng: lng.toDouble(),
          size: value['size'] as String,
          priority: value['priority'] as String,
        );
      }).toList();
      if (pickupLabel is! String) {
        throw const MerchantOrderRecoveryException(
          'merchant_order_recovery_unreadable',
        );
      }
      _pendingPickupLabel = pickupLabel;
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
  String? _pendingPickupLabel;
  String? _pickupKey;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final parcels = ref.watch(merchantOrderDraftProvider);
    final draft = ref.read(merchantOrderDraftProvider.notifier);
    final corridor = ref.watch(legacyCorridorProvider);
    final pickups = corridor.value?.parcelPickups ?? const <CorridorPlace>[];
    final dropoffs = corridor.value?.parcelDropoffs ?? const <CorridorPlace>[];
    final pickup = _pickup(pickups);
    final placesReady = pickup != null && dropoffs.isNotEmpty;
    return Scaffold(
      // Keyed like the other merchant screens so route-guard tests can assert
      // on the screen itself. Its title reuses `createOrder`, which is the same
      // Arabic string as the passenger's `createRequest` CTA, so matching on
      // text cannot tell the two screens apart.
      key: const ValueKey('merchantCreateOrder'),
      appBar: AppBar(
        title: Text(l10n.createOrder),
        leading: const DarbBackButton(fallback: '/merchant'),
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: [
            const SizedBox(height: AppTokens.spaceLarge),
            DarbCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    pickups.length > 1 ? l10n.pickup : l10n.fixedPickup,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (_locked && _pendingPickupLabel != null)
                    Text(
                      localizedCorridorPlace(context, _pendingPickupLabel!),
                      key: const ValueKey('merchantPickupLabel'),
                    )
                  else
                    corridor.when(
                      loading: () => const Padding(
                        padding: EdgeInsets.symmetric(
                          vertical: AppTokens.spaceSmall,
                        ),
                        child: LinearProgressIndicator(),
                      ),
                      error: (_, _) => Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.corridorPlacesLoadFailed,
                            key: const ValueKey('merchantPlacesError'),
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                          TextButton(
                            key: const ValueKey('merchantPlacesRetry'),
                            onPressed: () =>
                                ref.invalidate(legacyCorridorProvider),
                            child: Text(l10n.retry),
                          ),
                        ],
                      ),
                      data: (_) => pickup == null || dropoffs.isEmpty
                          ? Text(
                              l10n.corridorPlacesUnavailable,
                              key: const ValueKey('merchantPlacesUnavailable'),
                            )
                          : pickups.length == 1
                          ? Text(
                              pickup.displayName(arabic: arabic),
                              key: const ValueKey('merchantPickupLabel'),
                            )
                          : DropdownButtonFormField<String>(
                              key: const ValueKey('merchantPickupField'),
                              initialValue: pickup.key,
                              decoration: InputDecoration(
                                labelText: l10n.pickup,
                              ),
                              items: [
                                for (final place in pickups)
                                  DropdownMenuItem(
                                    value: place.key,
                                    child: Text(
                                      place.displayName(arabic: arabic),
                                    ),
                                  ),
                              ],
                              onChanged: _busy || _locked
                                  ? null
                                  : (key) => setState(() => _pickupKey = key),
                            ),
                    ),
                  if (corridor.value case final value?)
                    Text(value.displayName(arabic: arabic)),
                ],
              ),
            ),
            const SizedBox(height: AppTokens.spaceMedium),
            ...parcels.indexed.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.spaceMedium),
                child: _parcelCard(l10n, entry.$1, entry.$2, dropoffs),
              ),
            ),
            OutlinedButton.icon(
              key: const ValueKey('addParcelButton'),
              onPressed: !_busy && !_locked && placesReady && draft.canAdd
                  ? () => draft.addParcel(destination: dropoffs.first)
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
              // A pending order resends its saved payload; a new one needs the
              // corridor's places first.
              onPressed: _busy
                  ? null
                  : _locked
                  ? () => _submit(null, null)
                  : placesReady
                  ? () => _submit(pickup, dropoffs.first)
                  : null,
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

  Widget _parcelCard(
    AppLocalizations l10n,
    int index,
    ParcelDraft parcel,
    List<CorridorPlace> dropoffs,
  ) {
    final controller = ref.read(merchantOrderDraftProvider.notifier);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final place = _placeOf(parcel, dropoffs);
    // A restored pending parcel may name a place the corridor no longer
    // offers; it is still shown as it will be resent.
    const savedValue = '';
    final saved = place == null && parcel.hasDestination;
    return DarbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppTokens.spaceMedium,
        children: [
          Text(
            '${l10n.parcel} ${index + 1}',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          DropdownButtonFormField<String>(
            key: ValueKey('parcelDestination-$index'),
            initialValue: saved
                ? savedValue
                : (place ?? dropoffs.firstOrNull)?.key,
            decoration: InputDecoration(labelText: l10n.destination),
            items: [
              for (final value in dropoffs)
                DropdownMenuItem(
                  value: value.key,
                  child: Text(value.displayName(arabic: arabic)),
                ),
              if (saved)
                DropdownMenuItem(
                  value: savedValue,
                  child: Text(
                    merchantDestinationLabel(context, parcel.destinationLabel!),
                  ),
                ),
            ],
            onChanged: _busy || _locked
                ? null
                : (key) {
                    final chosen = dropoffs
                        .where((value) => value.key == key)
                        .firstOrNull;
                    if (chosen != null) {
                      controller.updateParcel(index, destination: chosen);
                    }
                  },
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

  Future<void> _submit(
    CorridorPlace? pickup,
    CorridorPlace? defaultDestination,
  ) async {
    final service = ref.read(merchantOrderSubmissionProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!_locked && defaultDestination != null) {
        ref
            .read(merchantOrderDraftProvider.notifier)
            .fillMissingDestinations(defaultDestination);
      }
      final order = _locked || pickup == null
          ? await service.resume()
          : await service.submit(pickup, ref.read(merchantOrderDraftProvider));
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
