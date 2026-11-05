import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/presentation/localized_labels.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/theme/semantic_colors.dart';
import '../../../core/widgets/darb_button.dart';
import '../../../core/widgets/darb_card.dart';
import '../../../core/widgets/route_summary_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_back_button.dart';
import '../application/passenger_assistant_controller.dart';
import '../data/speech_service.dart';
import '../data/tts_service.dart';
import '../data/voice_preferences.dart';
import '../domain/assistant_route_match.dart';
import '../domain/passenger_assistant_models.dart';
import '../../passenger/application/passenger_controller.dart';
import '../../operating_routes/data/operating_route_models.dart';
import '../../operating_routes/data/operating_route_repository.dart';
import '../../operating_routes/presentation/operating_route_inputs.dart';
import '../../operating_routes/presentation/route_place_picker.dart';
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
    // Load the saved voice settings and warm the speech engine now, so the
    // first spoken turn does not wait for either.
    ref.listenManual(voicePreferencesProvider, (_, _) {});
    _tts = ref.read(ttsServiceProvider);
    _tts!.prepare(
      WidgetsBinding.instance.platformDispatcher.locale.languageCode,
    );
  }

  @override
  void dispose() {
    _inputController
      ..removeListener(_refreshComposer)
      ..dispose();
    _scrollController.dispose();
    if (_voice == _VoiceState.listening) _speech?.cancel();
    _tts?.stop();
    super.dispose();
  }

  void _refreshComposer() => setState(() {});

  _VoiceState _voice = _VoiceState.idle;
  TtsService? _tts;

  /// True from the moment a spoken request is sent until its reply is read
  /// out. Typed requests never set it, so typing never makes the app talk.
  bool _replyByVoice = false;
  bool _autoSent = false;
  SpeechFailure? _voiceFailure;
  SpeechAvailability? _voiceAvailability;
  String _voiceBase = '';
  SpeechService? _speech;

  Future<void> _toggleVoice() async {
    final speech = ref.read(speechServiceProvider);
    _speech = speech;
    // Barge-in: starting to talk silences the assistant straight away.
    _tts = ref.read(ttsServiceProvider);
    _tts!.stop();
    if (_voice == _VoiceState.listening) {
      await speech.stop();
      if (mounted) setState(() => _voice = _VoiceState.idle);
      return;
    }
    if (_voice == _VoiceState.starting) return;
    final languageCode = Localizations.localeOf(context).languageCode;
    FocusScope.of(context).unfocus();
    setState(() {
      _voice = _VoiceState.starting;
      _voiceFailure = null;
      _voiceAvailability = null;
    });
    final availability = await speech.initialize();
    if (!mounted) return;
    if (availability != SpeechAvailability.available) {
      setState(() {
        _voice = _VoiceState.error;
        _voiceAvailability = availability;
      });
      return;
    }
    final localeId = pickSpeechLocale(languageCode, await speech.locales());
    if (!mounted) return;
    _voiceBase = _inputController.text.trim();
    _autoSent = false;
    // Warm the speech engine while the passenger is still talking.
    _tts!.prepare(languageCode);
    setState(() => _voice = _VoiceState.listening);
    try {
      await speech.start(
        localeId: localeId,
        onResult: (text, isFinal) {
          if (!mounted) return;
          final spoken = text.trim();
          if (spoken.isEmpty) return;
          final value = _voiceBase.isEmpty ? spoken : '$_voiceBase $spoken';
          _inputController.value = TextEditingValue(
            text: value,
            selection: TextSelection.collapsed(offset: value.length),
          );
          // The final text starts the request at once; no extra tap.
          if (isFinal && !_autoSent) {
            final autoSend =
                ref.read(voicePreferencesProvider).value?.autoSend ??
                VoicePreferences.defaultAutoSend;
            if (autoSend) {
              _autoSent = true;
              _submit(null, true);
            }
          }
        },
        onFailure: (failure) {
          if (!mounted) return;
          setState(() {
            _voice = _VoiceState.error;
            _voiceFailure = failure;
          });
        },
        onDone: () {
          if (mounted && _voice == _VoiceState.listening) {
            setState(() => _voice = _VoiceState.idle);
          }
        },
      );
    } catch (_) {
      if (mounted) {
        setState(() {
          _voice = _VoiceState.error;
          _voiceFailure = SpeechFailure.other;
        });
      }
    }
  }

  String? _voiceMessage(AppLocalizations l10n) {
    if (_voice != _VoiceState.error) return null;
    switch (_voiceAvailability) {
      case SpeechAvailability.permissionDenied:
        return l10n.assistantVoicePermissionDenied;
      case SpeechAvailability.permanentlyDenied:
        return l10n.assistantVoicePermissionPermanent;
      case SpeechAvailability.unavailable:
        return l10n.assistantVoiceUnavailable;
      default:
    }
    switch (_voiceFailure) {
      case SpeechFailure.noSpeech:
        return l10n.assistantVoiceNoSpeech;
      case SpeechFailure.offline:
        return l10n.assistantVoiceOffline;
      case SpeechFailure.permission:
        return l10n.assistantVoicePermissionPermanent;
      case SpeechFailure.unavailable:
        return l10n.assistantVoiceUnavailable;
      default:
        return l10n.assistantVoiceError;
    }
  }

  bool get _voiceNeedsSettings =>
      _voiceAvailability == SpeechAvailability.permanentlyDenied ||
      _voiceFailure == SpeechFailure.permission;

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

  Future<void> _submit([String? suggestion, bool byVoice = false]) async {
    final query = (suggestion ?? _inputController.text).trim();
    if (query.isEmpty) return;
    _replyByVoice = byVoice;
    if (!byVoice) _tts?.stop();
    _inputController.clear();
    if (_voice == _VoiceState.listening) {
      _speech?.cancel();
      _voice = _VoiceState.idle;
    }
    FocusScope.of(context).unfocus();
    await ref
        .read(passengerAssistantControllerProvider.notifier)
        .submit(query, locale: Localizations.localeOf(context).languageCode);
  }

  /// Reads the newest assistant reply aloud, only for a request that was spoken.
  void _speakReply(
    PassengerAssistantState? before,
    PassengerAssistantState? now,
  ) {
    if (!_replyByVoice || now == null || now.messages.isEmpty) return;
    if (now.messages.length <= (before?.messages.length ?? 0)) return;
    final last = now.messages.last;
    if (last.role != PassengerAssistantMessageRole.assistant) return;
    _replyByVoice = false;
    final prefs =
        ref.read(voicePreferencesProvider).value ?? const VoicePreferences();
    if (!prefs.speakReplies) return;
    _tts = ref.read(ttsServiceProvider);
    _tts!.speak(
      last.text,
      languageCode: Localizations.localeOf(context).languageCode,
      rate: prefs.speechRate,
    );
  }

  Future<void> _openVoiceSettings() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => const _VoiceSettingsSheet(),
    );
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
    // A booking may have saved a request (and a match) whatever the outcome.
    invalidatePassengerLists(ref.invalidate);
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

  Future<void> _startNewChat() async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.assistantNewChatTitle),
        content: Text(l10n.assistantNewChatBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: const ValueKey('assistantNewChatConfirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.assistantNewChat),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    _inputController.clear();
    try {
      await ref
          .read(passengerAssistantControllerProvider.notifier)
          .startNewChat();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.assistantNewChatFailed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final assistant = ref.watch(passengerAssistantControllerProvider);
    ref.listen(passengerAssistantControllerProvider, (previous, next) {
      _scrollToLatest();
      _speakReply(previous?.value, next.value);
    });
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
              leading: const DarbBackButton(fallback: '/passenger'),
            ),
      body: Column(
        children: [
          if ((assistant.value?.messages.isNotEmpty ?? false) &&
              !busy &&
              !recoveryPending)
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: Padding(
                padding: const EdgeInsetsDirectional.only(top: 4, end: 8),
                child: TextButton.icon(
                  key: const ValueKey('assistantNewChat'),
                  onPressed: _startNewChat,
                  icon: const Icon(Icons.add_comment_outlined, size: 18),
                  label: Text(l10n.assistantNewChat),
                ),
              ),
            ),
          Expanded(
            child: assistant.when(
              loading: () => const _AssistantLoadingView(),
              error: (_, _) => ErrorStateView(
                title: l10n.assistantHistoryErrorTitle,
                message: l10n.assistantHistoryErrorBody,
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
            voice: _voice,
            voiceMessage: _voiceMessage(l10n),
            onVoice: _toggleVoice,
            onVoiceSettings: _openVoiceSettings,
            speaking: ref.watch(ttsServiceProvider).speaking,
            onStopSpeaking: () => ref.read(ttsServiceProvider).stop(),
            onOpenSettings: _voiceNeedsSettings
                ? () => ref.read(speechServiceProvider).openSettings()
                : null,
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
        if ((state.phase == PassengerAssistantPhase.clarification ||
                state.phase == PassengerAssistantPhase.result) &&
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

    return DarbCard(
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
          RouteSummaryCard(
            from: localizedCorridorPlace(context, options.first.fromLabel),
            to: localizedCorridorPlace(context, options.first.toLabel),
            chips: [
              if (options.first.departureAt != null) ...[
                InfoPill(
                  icon: Icons.calendar_today_outlined,
                  label: MaterialLocalizations.of(
                    context,
                  ).formatMediumDate(options.first.departureAt!.toLocal()),
                ),
                InfoPill(
                  icon: Icons.schedule_rounded,
                  label: MaterialLocalizations.of(context).formatTimeOfDay(
                    TimeOfDay.fromDateTime(
                      options.first.departureAt!.toLocal(),
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: AppTokens.spaceMedium),
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
    fareSeatMinor: option.fare?.unitMinor,
    fareCurrency: option.fare?.currency,
  );
}

class _TripReviewCard extends ConsumerStatefulWidget {
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
  ConsumerState<_TripReviewCard> createState() => _TripReviewCardState();
}

class _TripReviewCardState extends ConsumerState<_TripReviewCard> {
  late PassengerAssistantTripDraft _draft = widget.draft;
  // The assistant's own wording of each place prefills the optional details;
  // the passenger still picks the village or town from the route's cities.
  late final _pickupDetails = TextEditingController(
    text: _initialPickup(widget.draft),
  );
  late final _dropoffDetails = TextEditingController(
    text: _initialDropoff(widget.draft),
  );

  /// The route the passenger picked; until they do, the one the extracted
  /// places point to (or the route a restored draft already carries).
  String? _routeId;
  late String? _pickupPlaceId = widget.draft.pickupPlaceId;
  late String? _dropoffPlaceId = widget.draft.dropoffPlaceId;
  bool _routeTouched = false;
  bool _showErrors = false;

  static String _initialPickup(PassengerAssistantTripDraft draft) =>
      draft.pickupDetails ?? draft.pickupLabel;

  static String _initialDropoff(PassengerAssistantTripDraft draft) =>
      draft.dropoffDetails ?? draft.destinationLabel;

  @override
  void didUpdateWidget(covariant _TripReviewCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.draft != widget.draft && !widget.searching) {
      final sameTrip =
          oldWidget.draft.pickupKey == widget.draft.pickupKey &&
          oldWidget.draft.destinationKey == widget.draft.destinationKey;
      _draft = widget.draft;
      if (!sameTrip) {
        // A new reply from the assistant: start over from its places.
        _routeTouched = false;
        _routeId = null;
        _pickupPlaceId = null;
        _dropoffPlaceId = null;
        _showErrors = false;
        _pickupDetails.text = _initialPickup(widget.draft);
        _dropoffDetails.text = _initialDropoff(widget.draft);
      }
    }
  }

  @override
  void dispose() {
    _pickupDetails.dispose();
    _dropoffDetails.dispose();
    super.dispose();
  }

  String? _selectedRoute(List<OperatingRoute>? routes) {
    if (_routeTouched) return _routeId;
    if (routes == null) return null;
    final saved = _draft.serviceRouteId;
    if (saved != null && routes.any((route) => route.id == saved)) {
      return saved;
    }
    return routeForAssistantDraft(routes, _draft)?.id;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final timeValid = _draft.preferredTime.isAfter(DateTime.now());
    final routeId = _selectedRoute(ref.watch(operatingRoutesProvider).value);
    final complete =
        routeId != null && _pickupPlaceId != null && _dropoffPlaceId != null;

    return DarbCard(
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
            routeId == null
                ? l10n.assistantRouteChoose
                : l10n.assistantReviewBody,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppTheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          OperatingRouteDropdown(
            fieldKey: const ValueKey('assistantRouteField'),
            value: routeId,
            enabled: !widget.searching,
            errorText: _showErrors && routeId == null
                ? l10n.passengerRouteRequired
                : null,
            onChanged: (route) => setState(() {
              if (route.id != routeId) {
                _pickupPlaceId = null;
                _dropoffPlaceId = null;
              }
              _routeTouched = true;
              _routeId = route.id;
            }),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          RoutePlacePicker(
            key: const ValueKey('assistantPickupPlacePicker'),
            routeId: routeId,
            side: RoutePlaceSide.pickup,
            selectedId: _pickupPlaceId,
            enabled: !widget.searching,
            errorText: _showErrors && _pickupPlaceId == null
                ? l10n.routePlaceRequired
                : null,
            onChanged: (place) => setState(() => _pickupPlaceId = place.id),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          RouteDetailsField(
            key: const ValueKey('assistantPickupDetailsField'),
            controller: _pickupDetails,
            enabled: !widget.searching,
            icon: Icons.edit_location_alt_outlined,
            label: l10n.routePlaceMoreDetailsLabel,
            hint: l10n.routePlacePickupDetailsHint,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          RoutePlacePicker(
            key: const ValueKey('assistantDropoffPlacePicker'),
            routeId: routeId,
            side: RoutePlaceSide.dropoff,
            selectedId: _dropoffPlaceId,
            enabled: !widget.searching,
            errorText: _showErrors && _dropoffPlaceId == null
                ? l10n.routePlaceRequired
                : null,
            onChanged: (place) => setState(() => _dropoffPlaceId = place.id),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          RouteDetailsField(
            key: const ValueKey('assistantDropoffDetailsField'),
            controller: _dropoffDetails,
            enabled: !widget.searching,
            icon: Icons.edit_location_alt_outlined,
            label: l10n.routePlaceMoreDetailsLabel,
            hint: l10n.routePlaceDropoffDetailsHint,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
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
          DarbButton(
            key: const ValueKey('assistantConfirmSearch'),
            label: widget.searching
                ? l10n.assistantSearching
                : l10n.assistantConfirmSearch,
            icon: widget.searching ? null : Icons.search,
            busy: widget.searching,
            onPressed: !widget.searching && timeValid
                ? () {
                    if (!complete) {
                      setState(() => _showErrors = true);
                      return;
                    }
                    widget.onConfirm(
                      _draft.copyWith(
                        serviceRouteId: routeId,
                        pickupPlaceId: _pickupPlaceId,
                        dropoffPlaceId: _dropoffPlaceId,
                        pickupDetails: _pickupDetails.text.trim(),
                        dropoffDetails: _dropoffDetails.text.trim(),
                      ),
                    );
                  }
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
  return AppLocalizations.of(context).dateTimeValue(
    material.formatMediumDate(value),
    material.formatTimeOfDay(TimeOfDay.fromDateTime(value)),
  );
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
      child: DarbCard(
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

    return DarbCard(
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
          DarbButton.outline(
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

enum _VoiceState { idle, starting, listening, error }

class _VoiceSettingsSheet extends ConsumerWidget {
  const _VoiceSettingsSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final prefs =
        ref.watch(voicePreferencesProvider).value ?? const VoicePreferences();
    final controller = ref.read(voicePreferencesProvider.notifier);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SwitchListTile(
              key: const ValueKey('assistantVoiceAutoSendSwitch'),
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.assistantVoiceAutoSend),
              value: prefs.autoSend,
              onChanged: controller.setAutoSend,
            ),
            SwitchListTile(
              key: const ValueKey('assistantVoiceSpeakSwitch'),
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.assistantVoiceSpeakReplies),
              value: prefs.speakReplies,
              onChanged: controller.setSpeakReplies,
            ),
            Text(l10n.assistantVoiceSpeed),
            Slider(
              key: const ValueKey('assistantVoiceSpeedSlider'),
              min: VoicePreferences.minSpeechRate,
              max: VoicePreferences.maxSpeechRate,
              divisions: 10,
              value: prefs.speechRate,
              onChanged: prefs.speakReplies ? controller.setSpeechRate : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _AssistantComposer extends StatelessWidget {
  const _AssistantComposer({
    required this.controller,
    required this.enabled,
    required this.busy,
    required this.onSubmit,
    required this.voice,
    required this.onVoice,
    required this.onVoiceSettings,
    required this.speaking,
    required this.onStopSpeaking,
    this.voiceMessage,
    this.onOpenSettings,
  });

  final _VoiceState voice;
  final VoidCallback onVoice;
  final VoidCallback onVoiceSettings;
  final ValueListenable<bool> speaking;
  final VoidCallback onStopSpeaking;
  final String? voiceMessage;
  final VoidCallback? onOpenSettings;

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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (voice == _VoiceState.listening)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
                child: Row(
                  key: const ValueKey('assistantVoiceListening'),
                  children: [
                    const Icon(
                      Icons.graphic_eq_rounded,
                      size: 18,
                      color: AppTheme.primary,
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Text(
                      l10n.assistantVoiceListening,
                      style: const TextStyle(color: AppTheme.primary),
                    ),
                  ],
                ),
              ),
            if (voiceMessage != null)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
                child: Row(
                  key: const ValueKey('assistantVoiceError'),
                  children: [
                    const Icon(
                      Icons.mic_off_rounded,
                      size: 18,
                      color: SemanticColors.error,
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Expanded(
                      child: Text(
                        voiceMessage!,
                        style: const TextStyle(
                          color: SemanticColors.onErrorContainer,
                        ),
                      ),
                    ),
                    if (onOpenSettings != null)
                      TextButton(
                        key: const ValueKey('assistantVoiceSettings'),
                        onPressed: onOpenSettings,
                        child: Text(l10n.assistantVoiceOpenSettings),
                      ),
                  ],
                ),
              ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                SizedBox(
                  width: AppTokens.minTouchTarget,
                  height: AppTokens.minTouchTarget,
                  child: IconButton(
                    key: const ValueKey('assistantMicButton'),
                    tooltip: voice == _VoiceState.listening
                        ? l10n.assistantVoiceStop
                        : l10n.assistantVoiceStart,
                    onPressed: enabled ? onVoice : null,
                    style: voice == _VoiceState.listening
                        ? IconButton.styleFrom(
                            backgroundColor: AppTheme.primaryContainer,
                            foregroundColor: AppTheme.primary,
                          )
                        : null,
                    icon: voice == _VoiceState.starting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(
                            voice == _VoiceState.listening
                                ? Icons.stop_rounded
                                : Icons.mic_rounded,
                          ),
                  ),
                ),
                ValueListenableBuilder<bool>(
                  valueListenable: speaking,
                  builder: (context, isSpeaking, _) => isSpeaking
                      ? IconButton(
                          key: const ValueKey('assistantStopSpeaking'),
                          tooltip: l10n.assistantVoiceStopSpeaking,
                          onPressed: onStopSpeaking,
                          icon: const Icon(Icons.volume_off_outlined),
                        )
                      : const SizedBox.shrink(),
                ),
                IconButton(
                  key: const ValueKey('assistantVoiceTune'),
                  tooltip: l10n.assistantVoiceSettings,
                  onPressed: onVoiceSettings,
                  icon: const Icon(Icons.tune),
                ),
                const SizedBox(width: AppTokens.spaceSmall),
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
              ],
            ),
          ],
        ),
      ),
    );
  }
}
