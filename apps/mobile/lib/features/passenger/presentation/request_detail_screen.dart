import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/darb_section.dart';
import '../../../core/widgets/status_chip.dart';
import '../../auth/application/auth_actor_binding.dart';
import '../../canonical_routes/presentation/canonical_route_widgets.dart';
import '../../security/presentation/security_actions.dart';
import '../../matching/data/matching_repository.dart';
import '../application/passenger_controller.dart';
import '../data/passenger_repository.dart';
import '../data/passenger_models.dart';
import 'passenger_request_labels.dart';

String _readableTime(BuildContext context, DateTime value) {
  final local = value.toLocal();
  final labels = MaterialLocalizations.of(context);
  return '${labels.formatMediumDate(local)} · ${labels.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
}

class RequestDetailScreen extends ConsumerStatefulWidget {
  const RequestDetailScreen({required this.requestId, super.key});
  final String requestId;

  @override
  ConsumerState<RequestDetailScreen> createState() =>
      _RequestDetailScreenState();
}

class _RequestDetailScreenState extends ConsumerState<RequestDetailScreen> {
  bool _cancelling = false;

  Future<void> _cancelRequest(PassengerRequest request) async {
    if (_cancelling) return;
    final binding = ref.read(authenticatedActorBindingProvider);
    final revision = binding.revision;
    bool currentActor() =>
        mounted && binding.actorId != null && binding.revision == revision;
    void requireCurrent() {
      if (!currentActor()) throw StateError('session_changed');
    }

    if (!currentActor()) return;
    final l10n = AppLocalizations.of(context);
    setState(() => _cancelling = true);
    try {
      final confirmed = await confirmSecurityAction(
        context,
        title: l10n.cancelRequest,
        message: l10n.cancelRequestConfirm,
        confirmLabel: l10n.cancelRequest,
      );
      if (!confirmed || !currentActor()) return;
      Object? mutationError;
      try {
        await ref
            .read(passengerRepositoryProvider)
            .cancelRequest(request.id, beforeSend: requireCurrent);
      } catch (error) {
        mutationError = error;
      }
      if (!currentActor()) return;
      // Re-read even after a lost response: the cancellation may have committed.
      invalidatePassengerLists(ref.invalidate);

      // Reconcile both records even when the committed PATCH response was lost.
      // Never repeat the mutation or invent a cancelled trip from local state.
      Object? visibleError = mutationError;
      try {
        ref.invalidate(passengerTripForRequestProvider(request.id));
        final savedRequest = await ref.refresh(
          passengerRequestDetailProvider(request.id).future,
        );
        if (!currentActor()) return;
        final savedTrip = await ref.read(
          passengerTripForRequestProvider(request.id).future,
        );
        if (!currentActor()) return;
        final cancellationConfirmed =
            savedRequest.status == 'cancelled' &&
            (savedTrip == null || savedTrip.status == 'cancelled');
        if (mutationError == null ||
            (!_definitiveCancellationError(mutationError) &&
                cancellationConfirmed)) {
          return;
        }
      } catch (error) {
        // A failed reconciliation is not proof the cancellation failed.
        // An original authorization/validation rejection must remain visible.
        if (!_definitiveCancellationError(mutationError)) visibleError = error;
      }
      if (visibleError != null && mounted && currentActor()) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_cancellationErrorLabel(l10n, visibleError))),
        );
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final requestId = widget.requestId;
    final l10n = AppLocalizations.of(context);
    final detail = ref.watch(passengerRequestDetailProvider(requestId));
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([
              ref.refresh(passengerRequestDetailProvider(requestId).future),
              ref.refresh(passengerTripForRequestProvider(requestId).future),
            ]);
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(AppTokens.spaceLarge),
            children: [
              // Both role shells already title this page in their app bar;
              // the heading is only drawn when it stands alone.
              if (!ShellLanguageControl.isProvided(context) &&
                  !(Scaffold.maybeOf(context)?.hasAppBar ?? false)) ...[
                Text(
                  l10n.requestDetails,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: AppTokens.spaceLarge),
              ],
              detail.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (_, _) => FilledButton(
                  onPressed: () =>
                      ref.invalidate(passengerRequestDetailProvider(requestId)),
                  child: Text(l10n.retry),
                ),
                data: (request) => DarbCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: StatusChip(
                          label: _statusLabel(l10n, request.status),
                          tone: statusToneFor(request.status),
                        ),
                      ),
                      const SizedBox(height: 24),
                      // The route, then the exact places the passenger typed;
                      // older requests show their saved place names instead.
                      DetailRow(
                        key: const ValueKey('requestRouteName'),
                        label: l10n.passengerRouteLabel,
                        value: request.routeTitle(context),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Divider(height: 1),
                      ),
                      DetailRow(
                        key: const ValueKey('requestPickupDetails'),
                        label: request.pickupDetails == null
                            ? l10n.pickup
                            : l10n.passengerPickupPoint,
                        value: request.pickupText(context),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Divider(height: 1),
                      ),
                      DetailRow(
                        key: const ValueKey('requestDropoffDetails'),
                        label: request.dropoffDetails == null
                            ? l10n.destination
                            : l10n.passengerDropoffPoint,
                        value: request.dropoffText(context),
                      ),
                      const SizedBox(height: 20),
                      DetailRow(
                        label: l10n.preferredTime,
                        value: _readableTime(context, request.preferredTime),
                      ),
                      const SizedBox(height: 12),
                      DetailRow(
                        label: l10n.passengerCount,
                        value: '${request.passengerCount}',
                      ),
                      // The fare frozen when the request was made; nothing
                      // when the route had no fare.
                      fareSnapshotBox(
                        context,
                        request.fare,
                        passengers: request.passengerCount,
                      ),
                      const SizedBox(height: 12),
                      DetailRow(
                        label: l10n.createdTime,
                        value: _readableTime(context, request.createdAt),
                      ),
                      const SizedBox(height: 24),
                      Consumer(
                        builder: (context, ref, _) {
                          final trip = ref.watch(
                            passengerTripForRequestProvider(request.id),
                          );
                          return trip.when(
                            loading: () => const SizedBox.shrink(),
                            error: (_, _) => const SizedBox.shrink(),
                            data: (value) {
                              if (value == null) return const SizedBox.shrink();
                              return Padding(
                                padding: const EdgeInsets.only(
                                  top: AppTokens.spaceSmall,
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${l10n.currentStatus}: '
                                      '${_statusLabel(l10n, value.status)}',
                                    ),
                                    TextButton(
                                      onPressed: () => context.go(
                                        '/passenger/trip/${value.id}',
                                      ),
                                      child: Text(l10n.tripTimeline),
                                    ),
                                  ],
                                ),
                              );
                            },
                          );
                        },
                      ),
                      const SizedBox(height: AppTokens.spaceLarge),
                      if (request.status == 'matched')
                        FilledButton(
                          onPressed: () async {
                            try {
                              final match = await ref
                                  .read(matchingRepositoryProvider)
                                  .latestForPassengerRequest(
                                    request.id,
                                    driverRouteId:
                                        request.selectedDriverRouteId,
                                  );
                              if (!context.mounted) return;
                              if (match != null) {
                                context.go('/passenger/match/${match.id}');
                              } else {
                                ref.invalidate(
                                  passengerRequestDetailProvider(requestId),
                                );
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(l10n.requestFailed)),
                                );
                              }
                            } catch (error) {
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    _matchingErrorLabel(l10n, error),
                                  ),
                                ),
                              );
                            }
                          },
                          child: Text(l10n.findCompatibleRoute),
                        ),
                      if (request.canMatch)
                        FilledButton(
                          onPressed: () async {
                            try {
                              final match = await ref
                                  .read(matchingRepositoryProvider)
                                  .runForPassengerRequest(
                                    request.id,
                                    driverRouteId:
                                        request.selectedDriverRouteId,
                                  );
                              if (context.mounted) {
                                invalidatePassengerLists(ref.invalidate);
                                context.go('/passenger/match/${match.id}');
                              }
                            } catch (error) {
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    _matchingErrorLabel(l10n, error),
                                  ),
                                ),
                              );
                              ref.invalidate(
                                passengerRequestDetailProvider(requestId),
                              );
                            }
                          },
                          child: Text(l10n.findCompatibleRoute),
                        ),
                      if (request.canCancel)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: OutlinedButton(
                            onPressed: _cancelling
                                ? null
                                : () => _cancelRequest(request),
                            child: Text(l10n.cancelRequest),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _statusLabel(AppLocalizations l10n, String status) => switch (status) {
  'pending' => l10n.statusPending,
  'matched' => l10n.statusMatched,
  'accepted' => l10n.statusAccepted,
  'picked_up' => l10n.statusPickedUp,
  'in_transit' => l10n.statusInTransit,
  'delivered' => l10n.statusDelivered,
  'cancelled' => l10n.statusCancelled,
  'completed' => l10n.statusCompleted,
  'pickup_started' => l10n.statusPickupStarted,
  'expired' => l10n.statusExpired,
  _ => status,
};

String _matchingErrorLabel(AppLocalizations l10n, Object error) {
  if (error is! ApiException) return l10n.requestFailed;
  if (error.type == ApiErrorType.network) return l10n.networkUnavailable;
  if (error.type == ApiErrorType.timeout) return l10n.requestTimedOut;
  if (error.type == ApiErrorType.forbidden) return l10n.forbidden;
  return switch (error.message) {
    'booking_outcome_unknown' => l10n.bookingOutcomeUnknown,
    'selected_driver_route_unavailable' => l10n.selectedDriverUnavailable,
    'no_compatible_driver_route' => l10n.noCompatibleDriverFound,
    'passenger_request_already_matched' => l10n.statusMatched,
    'passenger_request_not_matchable' => l10n.requestFailed,
    _ => l10n.requestFailed,
  };
}

bool _definitiveCancellationError(Object? error) =>
    error is ApiException &&
    (error.type == ApiErrorType.unauthorized ||
        error.type == ApiErrorType.forbidden ||
        (error.statusCode != null &&
            error.statusCode! >= 400 &&
            error.statusCode! < 500 &&
            error.statusCode != 408 &&
            error.statusCode != 429));

String _cancellationErrorLabel(AppLocalizations l10n, Object error) {
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
