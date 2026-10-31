import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../data/passenger_assistant_repository.dart';
import '../domain/passenger_assistant_models.dart';
import '../data/assistant_conversation_storage.dart';
import '../../auth/application/auth_controller.dart';
import '../../passenger/application/legacy_passenger_request_mutation.dart';

final passengerAssistantControllerProvider =
    AsyncNotifierProvider<
      PassengerAssistantController,
      PassengerAssistantState
    >(PassengerAssistantController.new);

class PassengerAssistantController
    extends AsyncNotifier<PassengerAssistantState> {
  Future<void> _saving = Future.value();
  int _generation = 0;
  String? _actor;
  bool _mutationPending = false;

  bool _isCurrent(int generation, String? actor) =>
      generation == _generation &&
      actor == _actor &&
      ref.read(authControllerProvider).value?.user?.id == actor;

  @override
  Future<PassengerAssistantState> build() async {
    final generation = ++_generation;
    final userId = ref.watch(
      authControllerProvider.select((value) => value.value?.user?.id),
    );
    _actor = userId;
    _mutationPending = false;
    final storage = ref.read(assistantConversationStorageProvider);
    final stopSaving = listenSelf((previous, next) {
      // AsyncLoading can retain a previous account's value. Only a current
      // actor's newly published data may enter that account's history.
      if (next is! AsyncData<PassengerAssistantState> ||
          !_isCurrent(generation, userId)) {
        return;
      }
      final current = next.value;
      if (userId == null ||
          (current.messages.isEmpty && current.savedRequestId == null)) {
        return;
      }
      _saving = _saving
          .then((_) async {
            if (_isCurrent(generation, userId)) {
              await storage.save(userId, current);
            }
          })
          .catchError((Object _) {});
    });
    ref.onDispose(() {
      stopSaving();
      if (_generation == generation) _generation++;
    });
    if (userId == null) return const PassengerAssistantState();
    await _saving;
    if (!_isCurrent(generation, userId)) return const PassengerAssistantState();
    PassengerAssistantState history;
    try {
      history = await storage.read(userId);
    } catch (_) {
      history = const PassengerAssistantState();
    }
    if (!_isCurrent(generation, userId)) return const PassengerAssistantState();
    try {
      final pending = await ref
          .read(legacyPassengerRequestMutationProvider)
          .pending();
      if (!_isCurrent(generation, userId)) {
        return const PassengerAssistantState();
      }
      final context = pending?.payload['client_recovery'];
      if (context is Map &&
          context['draft'] is Map &&
          context['option'] is Map) {
        final draft = PassengerAssistantTripDraft.fromJson(
          Map<String, dynamic>.from(context['draft'] as Map),
        );
        final option = PassengerAssistantTripOption.fromJson(
          Map<String, dynamic>.from(context['option'] as Map),
        );
        _mutationPending = true;
        return PassengerAssistantState(
          phase: PassengerAssistantPhase.result,
          messages: history.messages,
          conversationId: history.conversationId,
          lastLocale: history.lastLocale,
          savedRequestId: history.savedRequestId,
          draft: draft,
          tripOptions: [option],
          selectionFailure: PassengerAssistantFailure.unknownBooking,
        );
      }
    } catch (_) {
      // Another actor's unresolved operation is never exposed in this chat.
    }
    return _isCurrent(generation, userId)
        ? history
        : const PassengerAssistantState();
  }

  Future<void> submit(String query, {required String locale}) async {
    await _send(query, locale: locale, appendPassengerMessage: true);
  }

  Future<void> retry() async {
    final current = state.value;
    final query = current?.lastQuery;
    if (query == null || query.isEmpty) return;
    await _send(
      query,
      locale: current?.lastLocale ?? 'ar',
      appendPassengerMessage: false,
    );
  }

  Future<void> confirmAndSearch(PassengerAssistantTripDraft draft) async {
    if (state.isLoading || _mutationPending) return;
    final generation = _generation;
    final actor = _actor;
    final current = state.value;
    if (current == null ||
        current.phase != PassengerAssistantPhase.requestReview) {
      return;
    }
    state = AsyncData(
      PassengerAssistantState(
        phase: PassengerAssistantPhase.searching,
        savedRequestId: current.savedRequestId,
        messages: current.messages,
        suggestions: current.suggestions,
        conversationId: current.conversationId,
        lastQuery: current.lastQuery,
        lastLocale: current.lastLocale,
        draft: draft,
      ),
    );
    try {
      final results = await ref
          .read(passengerAssistantRepositoryProvider)
          .searchTrips(draft);
      if (!_isCurrent(generation, actor)) return;
      state = AsyncData(
        PassengerAssistantState(
          phase: PassengerAssistantPhase.result,
          messages: current.messages,
          suggestions: current.suggestions,
          conversationId: current.conversationId,
          lastQuery: current.lastQuery,
          lastLocale: current.lastLocale,
          draft: draft,
          tripOptions: results,
          savedRequestId: current.savedRequestId,
        ),
      );
    } catch (error) {
      if (!_isCurrent(generation, actor)) return;
      state = AsyncData(
        PassengerAssistantState(
          phase: PassengerAssistantPhase.requestReview,
          messages: current.messages,
          suggestions: current.suggestions,
          conversationId: current.conversationId,
          lastQuery: current.lastQuery,
          lastLocale: current.lastLocale,
          draft: draft,
          searchFailure: _failureFor(error),
          savedRequestId: current.savedRequestId,
        ),
      );
    }
  }

  Future<String?> selectTrip(PassengerAssistantTripOption option) async {
    if (state.isLoading) return null;
    final generation = _generation;
    final actor = _actor;
    final current = state.value;
    final draft = current?.draft;
    if (current == null ||
        draft == null ||
        current.phase != PassengerAssistantPhase.result ||
        current.selectingTripId != null ||
        !current.tripOptions.any((value) => value.id == option.id)) {
      return null;
    }

    state = AsyncData(
      PassengerAssistantState(
        phase: current.phase,
        messages: current.messages,
        suggestions: current.suggestions,
        conversationId: current.conversationId,
        lastQuery: current.lastQuery,
        lastLocale: current.lastLocale,
        draft: draft,
        tripOptions: current.tripOptions,
        selectingTripId: option.id,
        savedRequestId: current.savedRequestId,
      ),
    );

    try {
      final result = await ref
          .read(passengerAssistantRepositoryProvider)
          .selectTrip(draft: draft, option: option);
      if (!_isCurrent(generation, actor)) return null;
      _mutationPending = false;
      return result;
    } catch (error) {
      if (!_isCurrent(generation, actor)) return null;
      final failure = _failureFor(error);
      _mutationPending =
          failure == PassengerAssistantFailure.unknownBooking ||
          failure == PassengerAssistantFailure.savedBooking;
      state = AsyncData(
        PassengerAssistantState(
          phase: current.phase,
          messages: current.messages,
          suggestions: current.suggestions,
          conversationId: current.conversationId,
          lastQuery: current.lastQuery,
          lastLocale: current.lastLocale,
          draft: draft,
          tripOptions: current.tripOptions,
          selectionFailure: _failureFor(error),
          savedRequestId: error is AssistantSavedRequestException
              ? error.requestId
              : current.savedRequestId,
          selectionRequestId:
              error is AssistantSavedRequestException && !_mutationPending
              ? error.requestId
              : null,
        ),
      );
      await _saving;
      return null;
    }
  }

  void editSearch() {
    if (state.isLoading || _mutationPending) return;
    final current = state.value;
    if (current?.draft == null || current?.selectingTripId != null) return;
    state = AsyncData(
      PassengerAssistantState(
        phase: PassengerAssistantPhase.requestReview,
        messages: current!.messages,
        suggestions: current.suggestions,
        conversationId: current.conversationId,
        lastQuery: current.lastQuery,
        lastLocale: current.lastLocale,
        draft: current.draft,
        savedRequestId: current.savedRequestId,
      ),
    );
  }

  Future<void> _send(
    String query, {
    required String locale,
    required bool appendPassengerMessage,
  }) async {
    if (state.isLoading || _mutationPending) return;
    final generation = _generation;
    final actor = _actor;
    final normalized = query.trim();
    if (normalized.isEmpty) return;
    final current = state.value ?? const PassengerAssistantState();
    if (current.phase == PassengerAssistantPhase.processing ||
        current.phase == PassengerAssistantPhase.searching ||
        current.selectingTripId != null) {
      return;
    }

    final history = [...current.messages];
    if (!appendPassengerMessage &&
        history.isNotEmpty &&
        history.last.role == PassengerAssistantMessageRole.passenger &&
        history.last.text == normalized) {
      history.removeLast();
    }

    final messages = [
      ...current.messages,
      if (appendPassengerMessage)
        PassengerAssistantMessage.passenger(normalized),
    ];
    final processing = PassengerAssistantState(
      phase: PassengerAssistantPhase.processing,
      savedRequestId: current.savedRequestId,
      messages: messages,
      conversationId: current.conversationId,
      lastQuery: normalized,
      lastLocale: locale,
    );
    state = AsyncData(processing);

    try {
      final reply = await ref
          .read(passengerAssistantRepositoryProvider)
          .ask(
            message: normalized,
            locale: locale,
            history: history,
            conversationId: current.conversationId,
          );
      if (!_isCurrent(generation, actor)) return;
      state = AsyncData(
        PassengerAssistantState(
          phase: switch (reply.type) {
            PassengerAssistantReplyType.clarification =>
              PassengerAssistantPhase.clarification,
            PassengerAssistantReplyType.requestReview =>
              PassengerAssistantPhase.requestReview,
            PassengerAssistantReplyType.result =>
              PassengerAssistantPhase.result,
          },
          messages: [
            ...messages,
            PassengerAssistantMessage.assistant(reply.message),
          ],
          suggestions: reply.suggestions,
          conversationId: reply.conversationId ?? current.conversationId,
          lastQuery: normalized,
          lastLocale: locale,
          draft: reply.draft,
          savedRequestId: current.savedRequestId,
        ),
      );
    } catch (error) {
      if (!_isCurrent(generation, actor)) return;
      state = AsyncData(
        PassengerAssistantState(
          phase: PassengerAssistantPhase.error,
          messages: messages,
          conversationId: current.conversationId,
          lastQuery: normalized,
          lastLocale: locale,
          failure: _failureFor(error),
          savedRequestId: current.savedRequestId,
        ),
      );
    }
  }
}

PassengerAssistantFailure _failureFor(Object error) {
  if (error is ApiException) {
    if (error.message == 'selected_driver_route_unavailable') {
      return PassengerAssistantFailure.selectedDriverUnavailable;
    }
    if (error.message == 'booking_outcome_unknown') {
      return PassengerAssistantFailure.unknownBooking;
    }
    if (error.message == 'booking_saved_matching_unavailable') {
      return PassengerAssistantFailure.savedBooking;
    }
    if ([
      'booking_time_passed',
      'preferred_time_in_past',
      'passenger_request_expired',
      'match_expired',
      'route_not_active',
    ].contains(error.message)) {
      return PassengerAssistantFailure.expired;
    }
    if (error.statusCode == 404 || error.statusCode == 503) {
      return PassengerAssistantFailure.unavailable;
    }
    if (error.type == ApiErrorType.network ||
        error.type == ApiErrorType.timeout) {
      return PassengerAssistantFailure.network;
    }
  }
  return PassengerAssistantFailure.generic;
}
