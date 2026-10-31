import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/masari_button.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_back_button.dart';
import '../application/passenger_assistant_controller.dart';
import '../domain/passenger_assistant_models.dart';
import '../../passenger/data/passenger_models.dart';
import '../../auth/application/auth_controller.dart';
import '../../passenger/domain/trip_offer.dart';
import '../../passenger/presentation/widgets/trip_offer_card.dart';

class PassengerAssistantScreen extends ConsumerStatefulWidget {
  const PassengerAssistantScreen({super.key});

  @override
  ConsumerState<PassengerAssistantScreen> createState() =>
      _PassengerAssistantScreenState();
}

class _PassengerAssistantScreenState
    extends ConsumerState<PassengerAssistantScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _inputController.addListener(_refreshComposer);
  }

  @override
  void dispose() {
    _inputController
      ..removeListener(_refreshComposer)
      ..dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _refreshComposer() => setState(() {});

  void _scrollToLatest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _submit([String? suggestion]) async {
    final query = (suggestion ?? _inputController.text).trim();
    if (query.isEmpty) return;
    _inputController.clear();
    FocusScope.of(context).unfocus();
    await ref
        .read(passengerAssistantControllerProvider.notifier)
        .submit(query, locale: Localizations.localeOf(context).languageCode);
  }

  Future<void> _confirmAndSearch(PassengerAssistantTripDraft draft) async {
    FocusScope.of(context).unfocus();
    await ref
        .read(passengerAssistantControllerProvider.notifier)
        .confirmAndSearch(draft);
  }

  Future<void> _selectTrip(PassengerAssistantTripOption option) async {
    FocusScope.of(context).unfocus();
    final actor = ref.read(authControllerProvider).value?.user?.id;
    final matchId = await ref
        .read(passengerAssistantControllerProvider.notifier)
        .selectTrip(option);
    if (!mounted || actor != ref.read(authControllerProvider).value?.user?.id) {
      return;
    }
    if (mounted && matchId != null) {
      context.go('/passenger/match/$matchId');
    } else if (mounted) {
      final current = ref.read(passengerAssistantControllerProvider).value;
      final requestId = current?.selectionRequestId;
      if (requestId != null &&
          current?.selectionFailure !=
              PassengerAssistantFailure.unknownBooking &&
          current?.selectionFailure != PassengerAssistantFailure.savedBooking) {
        final l10n = AppLocalizations.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              current?.selectionFailure == PassengerAssistantFailure.expired
                  ? l10n.bookingTimePassed
                  : current?.selectionFailure ==
                        PassengerAssistantFailure.selectedDriverUnavailable
                  ? l10n.selectedDriverUnavailable
                  : l10n.assistantSearchError,
            ),
          ),
        );
        context.go('/passenger/request/$requestId');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final assistant = ref.watch(passengerAssistantControllerProvider);
    ref.listen(
      passengerAssistantControllerProvider,
      (_, _) => _scrollToLatest(),
    );
    final phase = assistant.value?.phase;
    final busy =
        phase == PassengerAssistantPhase.processing ||
        phase == PassengerAssistantPhase.searching ||
        assistant.value?.selectingTripId != null;
    final recoveryPending =
        assistant.value?.selectionFailure ==
            PassengerAssistantFailure.unknownBooking ||
        assistant.value?.selectionFailure ==
            PassengerAssistantFailure.savedBooking;

    return Scaffold(
      key: const ValueKey('passengerAssistantScreen'),
      appBar: ShellLanguageControl.isProvided(context)
          ? null
          : AppBar(
              title: Text(l10n.assistantTitle),
              leading: const MasariBackButton(fallback: '/passenger'),
            ),
      body: Column(
        children: [
          Expanded(
            child: assistant.when(
              loading: () => const _AssistantLoadingView(),
              error: (_, _) => ErrorStateView(
                title: l10n.assistantErrorTitle,
                message: l10n.assistantErrorBody,
                retryLabel: l10n.retry,
                onRetry: () =>
                    ref.invalidate(passengerAssistantControllerProvider),
              ),
              data: (state) => _AssistantConversation(
                state: state,
                scrollController: _scrollController,
                onSuggestion: _submit,
                onConfirm: _confirmAndSearch,
                onSelectTrip: _selectTrip,
                onRetry: () => ref
                    .read(passengerAssistantControllerProvider.notifier)
                    .retry(),
                onExample: (value) {
                  _inputController.text = value;
                  _inputController.selection = TextSelection.collapsed(
                    offset: value.length,
                  );
                },
              ),
            ),
          ),
          _AssistantComposer(
            controller: _inputController,
            enabled: !assistant.isLoading && !busy && !recoveryPending,
            busy: busy,
            onSubmit: _submit,
          ),
        ],
      ),
    );
  }
}

class _AssistantConversation extends StatelessWidget {
  const _AssistantConversation({
    required this.state,
    required this.scrollController,
    required this.onSuggestion,
    required this.onConfirm,
    required this.onSelectTrip,
    required this.onRetry,
    required this.onExample,
  });

  final PassengerAssistantState state;
  final ScrollController scrollController;
  final ValueChanged<String> onSuggestion;
  final ValueChanged<PassengerAssistantTripDraft> onConfirm;
  final Future<void> Function(PassengerAssistantTripOption) onSelectTrip;
  final VoidCallback onRetry;
  final ValueChanged<String> onExample;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final hasConversation = state.messages.isNotEmpty;

    return ListView(
      key: const ValueKey('assistantConversation'),
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(
        AppTokens.marginMobile,
        AppTokens.spaceMedium,
        AppTokens.marginMobile,
        AppTokens.spaceLarge,
      ),
      children: [
        if (!hasConversation)
          _AssistantWelcome(onExample: onExample)
        else
          for (final message in state.messages) ...[
            _MessageBubble(message: message),
            const SizedBox(height: AppTokens.gutterMobile),
          ],
        if (state.phase == PassengerAssistantPhase.processing)
          Semantics(
            liveRegion: true,
            label: l10n.assistantProcessing,
            child: const _ProcessingBubble(),
          ),
        if (state.draft != null &&
            (state.phase == PassengerAssistantPhase.requestReview ||
                state.phase == PassengerAssistantPhase.searching)) ...[
          const SizedBox(height: AppTokens.spaceExtraSmall),
          _TripReviewCard(
            draft: state.draft!,
            searching: state.phase == PassengerAssistantPhase.searching,
            searchFailure: state.searchFailure,
            onConfirm: onConfirm,
          ),
        ],
        if (state.phase == PassengerAssistantPhase.result &&
            state.draft != null) ...[
          const SizedBox(height: AppTokens.spaceMedium),
          _TripSearchResults(
            options: state.tripOptions,
            selectingTripId: state.selectingTripId,
            selectionFailure: state.selectionFailure,
            onSelectTrip: onSelectTrip,
          ),
        ],
        if (state.phase == PassengerAssistantPhase.clarification &&
            state.suggestions.isNotEmpty) ...[
          const SizedBox(height: AppTokens.spaceExtraSmall),
          Semantics(
            label: l10n.assistantClarificationLabel,
            child: Wrap(
              key: const ValueKey('assistantClarificationOptions'),
              spacing: AppTokens.spaceSmall,
              runSpacing: AppTokens.spaceSmall,
              children: [
                for (final suggestion in state.suggestions)
                  ActionChip(
                    label: Text(suggestion),
                    avatar: const Icon(Icons.reply, size: 18),
                    onPressed: () => onSuggestion(suggestion),
                  ),
              ],
            ),
          ),
        ],
        if (state.phase == PassengerAssistantPhase.error) ...[
          const SizedBox(height: AppTokens.spaceExtraSmall),
          _AssistantErrorCard(failure: state.failure, onRetry: onRetry),
        ],
      ],
    );
  }
}

class _AssistantWelcome extends StatelessWidget {
  const _AssistantWelcome({required this.onExample});

  final ValueChanged<String> onExample;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return MasariCard(
      key: const ValueKey('assistantReadyState'),
      padding: const EdgeInsets.all(AppTokens.spaceLarge),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppTheme.primaryContainer,
              borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
            ),
            child: const Icon(
              Icons.auto_awesome,
              color: AppTheme.onPrimaryContainer,
              size: 26,
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Text(l10n.assistantWelcomeTitle, style: theme.textTheme.titleLarge),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            l10n.assistantWelcomeBody,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppTokens.spaceLarge),
          Text(
            l10n.assistantTryAsking,
            style: theme.textTheme.labelLarge?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Wrap(
            spacing: AppTokens.spaceSmall,
            runSpacing: AppTokens.spaceSmall,
            children: [
              ActionChip(
                key: const ValueKey('assistantExampleTripTime'),
                label: Text(l10n.assistantExampleTripTime),
                onPressed: () => onExample(l10n.assistantExampleTripTime),
              ),
              ActionChip(
                key: const ValueKey('assistantExampleAvailableTrip'),
                label: Text(l10n.assistantExampleAvailableTrip),
                onPressed: () => onExample(l10n.assistantExampleAvailableTrip),
              ),
              ActionChip(
                key: const ValueKey('assistantExampleFindTrip'),
                label: Text(l10n.assistantExampleFindTrip),
                onPressed: () => onExample(l10n.assistantExampleFindTrip),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Renders the real driver-route candidates returned by `/matches/search` in
/// the same card used for the passenger's existing trip offers.  Selecting a
/// card delegates the actual booking work to the controller; this widget never
/// manufactures a request or a match on its own.
class _TripSearchResults extends StatelessWidget {
  const _TripSearchResults({
    required this.options,
    required this.selectingTripId,
    required this.selectionFailure,
    required this.onSelectTrip,
  });

  final List<PassengerAssistantTripOption> options;
  final String? selectingTripId;
  final PassengerAssistantFailure? selectionFailure;
  final Future<void> Function(PassengerAssistantTripOption) onSelectTrip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    if (options.isEmpty) {
      return EmptyState(
        key: const ValueKey('assistantTripResultsEmpty'),
        title: l10n.noAvailableTrips,
        message: l10n.noAvailableTripsBody,
        icon: Icons.directions_car_outlined,
      );
    }

    return Semantics(
      label: l10n.matchResult,
      child: Column(
        key: const ValueKey('assistantTripResults'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.matchResult,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          for (final option in options) ...[
            TripOfferCard(
              offer: _offerFor(option),
              actionLabel:
                  selectionFailure ==
                          PassengerAssistantFailure.unknownBooking ||
                      selectionFailure == PassengerAssistantFailure.savedBooking
                  ? l10n.verifyBooking
                  : l10n.bookSeat,
              verifyingBooking:
                  selectionFailure ==
                      PassengerAssistantFailure.unknownBooking ||
                  selectionFailure == PassengerAssistantFailure.savedBooking,
              busy: selectingTripId == option.id,
              enabled: selectingTripId == null,
              onBook: () {
                onSelectTrip(option);
              },
            ),
            const SizedBox(height: AppTokens.spaceMedium),
          ],
          if (selectionFailure != null)
            Text(
              selectionFailure ==
                      PassengerAssistantFailure.selectedDriverUnavailable
                  ? l10n.selectedDriverUnavailable
                  : selectionFailure == PassengerAssistantFailure.expired
                  ? l10n.bookingTimePassed
                  : selectionFailure == PassengerAssistantFailure.unknownBooking
                  ? l10n.bookingOutcomeUnknown
                  : selectionFailure == PassengerAssistantFailure.savedBooking
                  ? l10n.requestRecorded
                  : l10n.assistantSearchError,
              key: const ValueKey('assistantTripSelectionError'),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: SemanticColors.onErrorContainer,
              ),
            ),
        ],
      ),
    );
  }

  TripOffer _offerFor(PassengerAssistantTripOption option) => TripOffer(
    id: option.id,
    driverName: option.driverName,
    fromLabel: option.fromLabel,
    toLabel: option.toLabel,
    vehicleLabel: option.vehicleType,
    trustScore: option.trustScore,
    matchScore: option.score,
    departureAt: option.departureAt,
    remainingSeats: option.seatsAvailable,
  );
}

class _TripReviewCard extends StatefulWidget {
  const _TripReviewCard({
    required this.draft,
    required this.searching,
    required this.searchFailure,
    required this.onConfirm,
  });

  final PassengerAssistantTripDraft draft;
  final bool searching;
  final PassengerAssistantFailure? searchFailure;
  final ValueChanged<PassengerAssistantTripDraft> onConfirm;

  @override
  State<_TripReviewCard> createState() => _TripReviewCardState();
}

class _TripReviewCardState extends State<_TripReviewCard> {
  late PassengerAssistantTripDraft _draft = widget.draft;

  @override
  void didUpdateWidget(covariant _TripReviewCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.draft != widget.draft && !widget.searching) {
      _draft = widget.draft;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final timeValid = _draft.preferredTime.isAfter(DateTime.now());

    return MasariCard(
      key: const ValueKey('assistantExtractedData'),
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.fact_check_outlined, color: AppTheme.primary),
              const SizedBox(width: AppTokens.spaceSmall),
              Expanded(
                child: Text(
                  l10n.assistantReviewTitle,
                  style: theme.textTheme.titleMedium,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.spaceExtraSmall),
          Text(
            l10n.assistantReviewBody,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          DropdownButtonFormField<String>(
            key: const ValueKey('assistantPickupField'),
            initialValue: _draft.pickupKey,
            decoration: InputDecoration(labelText: l10n.pickup),
            items: [
              for (final pickup in lockedPickupPresets)
                DropdownMenuItem(
                  value: pickup.key,
                  child: Text(localizedCorridorPlace(context, pickup.label)),
                ),
              // The stop the assistant matched, when it is not a preset place.
              if (!lockedPickupPresets.any(
                (value) => value.key == widget.draft.pickupKey,
              ))
                DropdownMenuItem(
                  value: widget.draft.pickupKey,
                  child: Text(widget.draft.pickupLabel),
                ),
            ],
            onChanged: widget.searching
                ? null
                : (key) {
                    final pickup = lockedPickupPresets
                        .where((value) => value.key == key)
                        .firstOrNull;
                    setState(() {
                      if (pickup != null) {
                        _draft = _draft.copyWith(
                          pickupKey: pickup.key,
                          pickupLabel: pickup.label,
                          pickupLat: pickup.lat,
                          pickupLng: pickup.lng,
                        );
                      } else if (key == widget.draft.pickupKey) {
                        _draft = _draft.copyWith(
                          pickupKey: widget.draft.pickupKey,
                          pickupLabel: widget.draft.pickupLabel,
                          pickupLat: widget.draft.pickupLat,
                          pickupLng: widget.draft.pickupLng,
                        );
                      }
                    });
                  },
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          DropdownButtonFormField<String>(
            key: const ValueKey('assistantDestinationField'),
            initialValue: _draft.destinationKey,
            decoration: InputDecoration(labelText: l10n.destination),
            items: [
              DropdownMenuItem(
                value: 'bethlehem',
                child: Text(
                  localizedCorridorPlace(context, lockedDestinationLabel),
                ),
              ),
              // The stop the assistant matched, when it is not the preset one.
              if (widget.draft.destinationKey != 'bethlehem')
                DropdownMenuItem(
                  value: widget.draft.destinationKey,
                  child: Text(widget.draft.destinationLabel),
                ),
            ],
            onChanged: widget.searching
                ? null
                : (key) {
                    if (key == null) return;
                    setState(() {
                      _draft = key == 'bethlehem'
                          ? _draft.copyWith(
                              destinationKey: key,
                              destinationLabel: lockedDestinationLabel,
                              destinationLat: lockedDestinationLat,
                              destinationLng: lockedDestinationLng,
                            )
                          : _draft.copyWith(
                              destinationKey: widget.draft.destinationKey,
                              destinationLabel: widget.draft.destinationLabel,
                              destinationLat: widget.draft.destinationLat,
                              destinationLng: widget.draft.destinationLng,
                            );
                    });
                  },
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          OutlinedButton.icon(
            key: const ValueKey('assistantTimeField'),
            onPressed: widget.searching ? null : _pickTime,
            icon: const Icon(Icons.schedule),
            label: Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(
                '${l10n.preferredTime}: ${_dateTimeLabel(context, _draft.preferredTime)}',
              ),
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          DropdownButtonFormField<int>(
            key: const ValueKey('assistantPassengerCountField'),
            initialValue: _draft.passengerCount,
            decoration: InputDecoration(labelText: l10n.passengerCount),
            items: [
              for (var count = 1; count <= 4; count++)
                DropdownMenuItem(value: count, child: Text('$count')),
            ],
            onChanged: widget.searching
                ? null
                : (count) {
                    if (count != null) {
                      setState(
                        () => _draft = _draft.copyWith(passengerCount: count),
                      );
                    }
                  },
          ),
          if (!timeValid || widget.searchFailure != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            Text(
              !timeValid
                  ? l10n.assistantFutureTimeRequired
                  : l10n.assistantSearchError,
              key: const ValueKey('assistantSearchError'),
              style: theme.textTheme.bodySmall?.copyWith(
                color: SemanticColors.onErrorContainer,
              ),
            ),
          ],
          const SizedBox(height: AppTokens.spaceLarge),
          MasariButton(
            key: const ValueKey('assistantConfirmSearch'),
            label: widget.searching
                ? l10n.assistantSearching
                : l10n.assistantConfirmSearch,
            icon: widget.searching ? null : Icons.search,
            busy: widget.searching,
            onPressed: !widget.searching && timeValid
                ? () => widget.onConfirm(_draft)
                : null,
          ),
        ],
      ),
    );
  }

  Future<void> _pickTime() async {
    final now = DateTime.now();
    final initial = _draft.preferredTime.isAfter(now)
        ? _draft.preferredTime
        : now.add(const Duration(hours: 1));
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 1, now.month, now.day),
      initialDate: initial,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null) return;
    setState(() {
      _draft = _draft.copyWith(
        preferredTime: DateTime(
          date.year,
          date.month,
          date.day,
          time.hour,
          time.minute,
        ),
      );
    });
  }
}

String _dateTimeLabel(BuildContext context, DateTime value) {
  final material = MaterialLocalizations.of(context);
  return '${material.formatMediumDate(value)}، ${material.formatTimeOfDay(TimeOfDay.fromDateTime(value))}';
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final PassengerAssistantMessage message;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final isPassenger = message.role == PassengerAssistantMessageRole.passenger;
    // `.bubble-user` is pinned to `--ms-secondary` (navy) in the spec
    // regardless of the app's general orange emphasis, so it always uses
    // AppTheme.secondary rather than the brand `primary`.
    final background = isPassenger
        ? AppTheme.secondary
        : AppTheme.surfaceContainerHigh;
    final foreground = isPassenger ? AppTheme.onSecondary : AppTheme.onSurface;

    return Align(
      alignment: isPassenger
          ? AlignmentDirectional.centerEnd
          : AlignmentDirectional.centerStart,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 340),
        child: Semantics(
          liveRegion: !isPassenger,
          label: isPassenger
              ? l10n.assistantPassengerMessage
              : l10n.assistantResultLabel,
          child: Container(
            key: ValueKey(
              isPassenger ? 'assistantPassengerMessage' : 'assistantReply',
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: AppTokens.spaceMedium,
              vertical: AppTokens.gutterMobile,
            ),
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadiusDirectional.only(
                topStart: const Radius.circular(AppTokens.radiusBubble),
                topEnd: const Radius.circular(AppTokens.radiusBubble),
                bottomStart: Radius.circular(
                  isPassenger ? AppTokens.radiusBubble : AppTokens.radiusSmall,
                ),
                bottomEnd: Radius.circular(
                  isPassenger ? AppTokens.radiusSmall : AppTokens.radiusBubble,
                ),
              ),
              border: isPassenger
                  ? null
                  : Border.all(color: AppTheme.outlineVariant),
            ),
            child: Text(
              message.text,
              textAlign: TextAlign.start,
              style: theme.textTheme.bodyMedium?.copyWith(color: foreground),
            ),
          ),
        ),
      ),
    );
  }
}

class _ProcessingBubble extends StatelessWidget {
  const _ProcessingBubble();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: MasariCard(
        key: const ValueKey('assistantProcessingState'),
        padding: const EdgeInsets.symmetric(
          horizontal: AppTokens.spaceMedium,
          vertical: AppTokens.gutterMobile,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: AppTokens.spaceSmall),
            Text(l10n.assistantProcessing),
          ],
        ),
      ),
    );
  }
}

class _AssistantErrorCard extends StatelessWidget {
  const _AssistantErrorCard({required this.failure, required this.onRetry});

  final PassengerAssistantFailure? failure;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final message = switch (failure) {
      PassengerAssistantFailure.unavailable => l10n.assistantUnavailable,
      PassengerAssistantFailure.network => l10n.networkUnavailable,
      _ => l10n.assistantErrorBody,
    };

    return MasariCard(
      key: const ValueKey('assistantErrorState'),
      background: SemanticColors.errorContainer,
      border: BorderSide.none,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.error_outline,
                color: SemanticColors.onErrorContainer,
              ),
              const SizedBox(width: AppTokens.spaceSmall),
              Expanded(
                child: Text(
                  l10n.assistantErrorTitle,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: SemanticColors.onErrorContainer,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            message,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: SemanticColors.onErrorContainer,
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          MasariButton.outline(
            key: const ValueKey('assistantRetryButton'),
            label: l10n.retry,
            icon: Icons.refresh,
            onPressed: onRetry,
            expand: false,
          ),
        ],
      ),
    );
  }
}

class _AssistantLoadingView extends StatelessWidget {
  const _AssistantLoadingView();

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: const ValueKey('assistantLoadingState'),
      padding: const EdgeInsets.all(AppTokens.marginMobile),
      children: const [
        LoadingSkeleton(height: 160, radius: AppTokens.radiusDefault),
        SizedBox(height: AppTokens.spaceMedium),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: LoadingSkeleton(height: 64, width: 220),
        ),
      ],
    );
  }
}

class _AssistantComposer extends StatelessWidget {
  const _AssistantComposer({
    required this.controller,
    required this.enabled,
    required this.busy,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool enabled;
  final bool busy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final canSubmit = enabled && controller.text.trim().isNotEmpty;

    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          AppTokens.marginMobile,
          AppTokens.gutterMobile,
          AppTokens.marginMobile,
          AppTokens.gutterMobile,
        ),
        decoration: const BoxDecoration(
          color: AppTheme.surfaceContainerLowest,
          border: Border(top: BorderSide(color: AppTheme.outlineVariant)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                key: const ValueKey('assistantTextInput'),
                controller: controller,
                enabled: enabled,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: canSubmit ? (_) => onSubmit() : null,
                decoration: InputDecoration(
                  hintText: l10n.assistantInputHint,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: AppTokens.spaceMedium,
                    vertical: AppTokens.gutterMobile,
                  ),
                ),
              ),
            ),
            const SizedBox(width: AppTokens.spaceSmall),
            SizedBox(
              width: AppTokens.minTouchTarget,
              height: AppTokens.minTouchTarget,
              child: IconButton.filled(
                key: const ValueKey('assistantSendButton'),
                tooltip: l10n.assistantSend,
                onPressed: canSubmit ? onSubmit : null,
                icon: busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.onPrimary,
                        ),
                      )
                    : const Icon(Icons.send_rounded),
              ),
            ),
            // Voice is intentionally absent: no speech-input capability or
            // microphone permission exists in this app yet.
          ],
        ),
      ),
    );
  }
}
