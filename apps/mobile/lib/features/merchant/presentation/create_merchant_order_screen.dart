import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_back_button.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/darb_section.dart';
import '../../../core/widgets/discard_saved_request_button.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../../operating_routes/data/operating_route_models.dart';
import '../../operating_routes/data/operating_route_repository.dart';
import '../../operating_routes/presentation/route_place_picker.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_models.dart';
import '../application/merchant_order_submission.dart';
import '../data/merchant_order_operation_storage.dart';
import 'merchant_ui.dart';

/// A new order: one predefined route, the pickup in the merchant's own words,
/// and up to ten parcels, each with where it goes in the merchant's words.
///
/// An order whose response was lost is kept and shown exactly as it will be
/// resent, until the server confirms it.
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
  final _formKey = GlobalKey<FormState>();
  final _pickupDetails = TextEditingController();
  String? _routeId;
  String? _pickupPlaceId;

  /// Place errors show once the merchant tried to send the order.
  bool _showPlaceErrors = false;
  String? _error;

  /// The saved order being recovered, as it will be resent.
  PendingOrderPreview? _pending;

  @override
  void initState() {
    super.initState();
    Future.microtask(_restorePending);
  }

  @override
  void dispose() {
    final listener = _navigationListener;
    if (listener != null) _navigationAnimation?.removeStatusListener(listener);
    if (_navigationReady?.isCompleted == false) {
      _navigationReady!.complete(false);
    }
    _pickupDetails.dispose();
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

  /// Reads a saved order for display. The payload is resent exactly as saved
  /// (including orders saved by builds before routes existed), so it is shown
  /// as saved even if the routes have changed since.
  static PendingOrderPreview _preview(MerchantPendingOrder pending) {
    try {
      return PendingOrderPreview.fromPayload(pending.payload);
    } on FormatException {
      throw const MerchantOrderRecoveryException(
        'merchant_order_recovery_unreadable',
      );
    }
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
      _pending = _preview(pending);
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
      await _unlockIfCleared(service);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// A saved order removed along the way (refused on resend or too old to
  /// confirm) opens the form again.
  Future<void> _unlockIfCleared(MerchantOrderSubmission service) async {
    try {
      if (await service.pending() == null && mounted) {
        _locked = false;
        _pending = null;
      }
    } catch (_) {
      // Still unreadable: the form stays locked and offers to discard it.
    }
  }

  String _recoveryError(Object error) {
    final l10n = AppLocalizations.of(context);
    return error is MerchantOrderRecoveryException ||
            savedRequestOutcomeLabel(l10n, error) != null
        ? merchantErrorLabel(l10n, error)
        : l10n.merchantOrderUncertain;
  }

  /// Drops the saved order after the merchant confirms, so a new one can be
  /// written.
  Future<void> _discard() async {
    final service = ref.read(merchantOrderSubmissionProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await service.discard();
      if (mounted) {
        _locked = false;
        _pending = null;
      }
    } catch (error) {
      if (mounted) _error = _recoveryError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The chosen route while it is still offered; a single route is chosen
  /// for the merchant.
  String? _selectedRoute(List<OperatingRoute> routes) {
    if (routes.any((route) => route.id == _routeId)) return _routeId;
    return routes.length == 1 ? routes.single.id : null;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final parcels = ref.watch(merchantOrderDraftProvider);
    final draft = ref.read(merchantOrderDraftProvider.notifier);
    final routes = ref.watch(operatingRoutesProvider);
    final routeList = routes.value ?? const <OperatingRoute>[];
    final routesReady = routeList.isNotEmpty;
    final editable = !_busy && !_locked;
    final pending = _pending;
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
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            children: [
              const SizedBox(height: AppTokens.spaceLarge),
              if (_locked && pending != null)
                _pendingCard(l10n, pending, routeList)
              else ...[
                _routeCard(l10n, routes, routeList, editable),
                const SizedBox(height: AppTokens.spaceMedium),
                ...parcels.indexed.map(
                  (entry) => KeyedSubtree(
                    key: ValueKey('parcelCard-${entry.$2.id}'),
                    child: Padding(
                      padding: const EdgeInsets.only(
                        bottom: AppTokens.spaceMedium,
                      ),
                      child: _parcelCard(
                        l10n,
                        entry.$1,
                        entry.$2,
                        editable,
                        _selectedRoute(routeList),
                      ),
                    ),
                  ),
                ),
                // The route's default prices for these sizes; the driver who
                // takes the order may charge their own inside the range.
                if (routeList
                        .where((route) => route.id == _selectedRoute(routeList))
                        .firstOrNull
                    case final route?)
                  KeyedSubtree(
                    key: const ValueKey('merchantRouteFare'),
                    child: parcelFareEstimate(context, route.fares, [
                      for (final parcel in parcels) parcel.size,
                    ]),
                  ),
                OutlinedButton.icon(
                  key: const ValueKey('addParcelButton'),
                  onPressed: editable && draft.canAdd ? draft.addParcel : null,
                  icon: const Icon(Icons.add),
                  label: Text('${l10n.addParcel} (${parcels.length}/10)'),
                ),
                Text(l10n.parcelLimit),
              ],
              if (_error != null)
                Text(
                  _error!,
                  key: const ValueKey('merchantOrderError'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              if (_locked && !_busy)
                DiscardSavedRequestButton(onDiscard: _discard),
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
                // A pending order resends its saved payload; a new one needs
                // the routes first.
                onPressed: _busy
                    ? null
                    : _locked
                    ? _submit
                    : routesReady
                    ? _submit
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
      ),
    );
  }

  /// The route and the pickup, written once for the whole order.
  Widget _routeCard(
    AppLocalizations l10n,
    AsyncValue<List<OperatingRoute>> routes,
    List<OperatingRoute> routeList,
    bool editable,
  ) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return DarbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppTokens.spaceMedium,
        children: [
          Text(
            l10n.orderRouteLabel,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          routes.when(
            skipLoadingOnRefresh: false,
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
              child: LinearProgressIndicator(
                key: ValueKey('merchantRoutesLoading'),
              ),
            ),
            error: (_, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.orderRoutesLoadFailed,
                  key: const ValueKey('merchantRoutesError'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
                TextButton(
                  key: const ValueKey('merchantRoutesRetry'),
                  onPressed: () => ref.invalidate(operatingRoutesProvider),
                  child: Text(l10n.retry),
                ),
              ],
            ),
            data: (_) => routeList.isEmpty
                ? Text(
                    l10n.orderRoutesEmpty,
                    key: const ValueKey('merchantRoutesEmpty'),
                  )
                // A reloaded list starts a fresh field, so a route that was
                // turned off is never kept as the chosen value.
                : KeyedSubtree(
                    key: ObjectKey(routeList),
                    child: DropdownButtonFormField<String>(
                      key: const ValueKey('merchantRouteField'),
                      initialValue: _selectedRoute(routeList),
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: l10n.orderRouteLabel,
                      ),
                      hint: Text(l10n.orderRouteChoose),
                      items: [
                        for (final route in routeList)
                          DropdownMenuItem(
                            value: route.id,
                            child: Text(
                              route.displayName(arabic: arabic),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      validator: (value) =>
                          value == null ? l10n.orderRouteRequired : null,
                      onChanged: editable
                          ? (id) => setState(() {
                              if (id != _routeId) {
                                // Places belong to the previous route's
                                // cities.
                                _pickupPlaceId = null;
                                ref
                                    .read(merchantOrderDraftProvider.notifier)
                                    .clearDropoffPlaces();
                              }
                              _routeId = id;
                            })
                          : null,
                    ),
                  ),
          ),
          RoutePlacePicker(
            key: const ValueKey('merchantPickupPlacePicker'),
            routeId: _selectedRoute(routeList),
            side: RoutePlaceSide.pickup,
            selectedId: _pickupPlaceId,
            enabled: editable,
            errorText: _showPlaceErrors && _pickupPlaceId == null
                ? l10n.routePlaceRequired
                : null,
            onChanged: (place) => setState(() => _pickupPlaceId = place.id),
          ),
          TextFormField(
            key: const ValueKey('merchantPickupDetailsField'),
            controller: _pickupDetails,
            enabled: editable,
            maxLength: routeDetailsMaxLength,
            minLines: 1,
            maxLines: 3,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(
              labelText: l10n.routePlaceMoreDetailsLabel,
              hintText: l10n.merchantPickupDetailsHint,
              helperText: l10n.routePlaceDetailsHelper,
              prefixIcon: const Icon(Icons.storefront_outlined),
            ),
          ),
        ],
      ),
    );
  }

  Widget _parcelCard(
    AppLocalizations l10n,
    int index,
    ParcelDraft parcel,
    bool editable,
    String? routeId,
  ) {
    final controller = ref.read(merchantOrderDraftProvider.notifier);
    return DarbCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppTokens.spaceMedium,
        children: [
          Text(
            '${l10n.parcel} ${index + 1}',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          RoutePlacePicker(
            key: ValueKey('parcelDropoffPlace-$index'),
            routeId: routeId,
            side: RoutePlaceSide.dropoff,
            selectedId: parcel.dropoffPlaceId,
            enabled: editable,
            errorText: _showPlaceErrors && parcel.dropoffPlaceId == null
                ? l10n.routePlaceRequired
                : null,
            onChanged: (place) =>
                controller.updateParcel(index, dropoffPlaceId: place.id),
          ),
          TextFormField(
            key: ValueKey('parcelDropoff-$index'),
            initialValue: parcel.dropoffDetails,
            enabled: editable,
            maxLength: routeDetailsMaxLength,
            minLines: 1,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: l10n.routePlaceMoreDetailsLabel,
              hintText: l10n.merchantDropoffDetailsHint,
              prefixIcon: const Icon(Icons.place_outlined),
            ),
            onChanged: (value) =>
                controller.updateParcel(index, dropoffDetails: value),
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
            onChanged: editable
                ? (value) => controller.updateParcel(index, size: value)
                : null,
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
            onChanged: editable
                ? (value) => controller.updateParcel(index, priority: value)
                : null,
          ),
          TextFormField(
            key: ValueKey('parcelReceiverName-$index'),
            initialValue: parcel.receiverName,
            enabled: editable,
            maxLength: receiverNameMaxLength,
            decoration: InputDecoration(
              labelText: l10n.merchantReceiverNameLabel,
              prefixIcon: const Icon(Icons.person_outline),
              counterText: '',
            ),
            onChanged: (value) =>
                controller.updateParcel(index, receiverName: value),
          ),
          TextFormField(
            key: ValueKey('parcelReceiverPhone-$index'),
            initialValue: parcel.receiverPhone,
            enabled: editable,
            keyboardType: TextInputType.phone,
            textDirection: TextDirection.ltr,
            maxLength: 32,
            decoration: InputDecoration(
              labelText: l10n.merchantReceiverPhoneLabel,
              prefixIcon: const Icon(Icons.phone_outlined),
              counterText: '',
            ),
            validator: (value) => receiverPhoneValid(value ?? '')
                ? null
                : l10n.merchantReceiverPhoneInvalid,
            onChanged: (value) =>
                controller.updateParcel(index, receiverPhone: value),
          ),
          if (controller.canRemove)
            TextButton.icon(
              key: ValueKey('removeParcel-$index'),
              onPressed: editable ? () => controller.removeParcel(index) : null,
              icon: const Icon(Icons.remove_circle_outline),
              label: Text(l10n.removeParcel),
            ),
        ],
      ),
    );
  }

  /// The saved order, read-only, exactly as it will be resent.
  Widget _pendingCard(
    AppLocalizations l10n,
    PendingOrderPreview pending,
    List<OperatingRoute> routes,
  ) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final route = routes
        .where((value) => value.id == pending.serviceRouteId)
        .firstOrNull;
    return DarbCard(
      key: const ValueKey('merchantPendingOrder'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.merchantPendingOrderTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          if (!pending.legacy)
            DetailRow(
              label: l10n.orderRouteLabel,
              value: route?.displayName(arabic: arabic) ?? l10n.orderRouteSaved,
              icon: Icons.route_outlined,
            ),
          DetailRow(
            label: l10n.pickup,
            value: pending.legacy
                ? localizedCorridorPlace(context, pending.pickup)
                : _savedChoice(l10n, pending.pickup, pending.pickupPlaceChosen),
            icon: Icons.storefront_outlined,
            valueKey: const ValueKey('merchantPickupLabel'),
          ),
          for (final (index, parcel) in pending.parcels.indexed)
            DetailRow(
              label: '${l10n.parcel} ${index + 1}',
              value:
                  '${pending.legacy ? merchantDestinationLabel(context, parcel.dropoff) : _savedChoice(l10n, parcel.dropoff, parcel.placeChosen)}'
                  ' · ${parcel.size} · ${merchantPriorityLabel(l10n, parcel.priority)}',
              icon: Icons.place_outlined,
            ),
        ],
      ),
    );
  }

  /// A saved order keeps place ids, not names: show the details typed next
  /// to it, or that a place was chosen.
  String _savedChoice(AppLocalizations l10n, String details, bool chosen) {
    if (!chosen) return details;
    return details.isEmpty
        ? l10n.routePlaceSavedChoice
        : '${l10n.routePlaceSavedChoice} · $details';
  }

  Future<void> _submit() async {
    if (!_locked && !(_formKey.currentState?.validate() ?? false)) return;
    final routes = ref.read(operatingRoutesProvider).value ?? const [];
    final routeId = _selectedRoute(routes);
    if (!_locked && routeId == null) return;
    final parcelDrafts = ref.read(merchantOrderDraftProvider);
    if (!_locked &&
        (_pickupPlaceId == null ||
            parcelDrafts.any((parcel) => parcel.dropoffPlaceId == null))) {
      // The pickup and every drop-off must be a place of the route's cities.
      setState(() => _showPlaceErrors = true);
      return;
    }
    final service = ref.read(merchantOrderSubmissionProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final order = _locked
          ? await service.resume()
          : await service.submit(
              serviceRouteId: routeId!,
              pickupPlaceId: _pickupPlaceId,
              pickupDetails: _pickupDetails.text,
              parcels: parcelDrafts,
            );
      ref.invalidate(merchantDashboardProvider);
      if (mounted) await _openOrder(order.id);
    } catch (error) {
      if (!mounted) return;
      if (error is ApiException && error.message == 'route_unavailable') {
        // The route was turned off; offer the current list again.
        ref.invalidate(operatingRoutesProvider);
      }
      try {
        final pending = await service.pending();
        _locked = pending != null;
        _pending = pending == null ? null : _preview(pending);
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
