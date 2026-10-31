import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_error.dart';
import '../../canonical_assignments/application/canonical_assignment_controller.dart';
import '../../canonical_routes/application/canonical_route_controller.dart';
import '../../driver/application/driver_controller.dart';
import '../../driver/data/driver_repository.dart';
import '../../merchant/application/merchant_controller.dart';
import '../../onboarding/application/onboarding_controller.dart';
import '../../onboarding/data/onboarding_storage.dart';
import '../../passenger/application/passenger_controller.dart';
import '../../passenger/application/passenger_history_controller.dart';
import '../../security/data/session_repository.dart';
import '../../shared_trips/application/shared_trip_controller.dart';
import '../../trips/application/passenger_trip_controller.dart';
import '../data/auth_repository.dart';
import '../data/session_coordinator.dart';
import '../domain/auth_models.dart';
import 'auth_actor_binding.dart';

enum AuthStatus {
  restoring,
  unauthenticated,
  authenticating,
  authenticated,
  refreshing,
  retryableFailure,
  restoreFailed,
  sessionEnded,
  registrationRequired,
}

class AuthState {
  const AuthState({
    required this.status,
    this.user,
    this.error,
    this.sessionEndReason,
    this.registrationGrant,
  });

  const AuthState.restoring() : this(status: AuthStatus.restoring);

  const AuthState.unauthenticated() : this(status: AuthStatus.unauthenticated);

  const AuthState.authenticating() : this(status: AuthStatus.authenticating);

  const AuthState.authenticated(AuthUser user)
    : this(status: AuthStatus.authenticated, user: user);

  const AuthState.refreshing(AuthUser user)
    : this(status: AuthStatus.refreshing, user: user);

  const AuthState.retryableFailure(AuthUser user, ApiException error)
    : this(status: AuthStatus.retryableFailure, user: user, error: error);

  const AuthState.restoreFailed(ApiException error)
    : this(status: AuthStatus.restoreFailed, error: error);

  const AuthState.sessionEnded(SessionEndReason reason)
    : this(status: AuthStatus.sessionEnded, sessionEndReason: reason);

  final AuthStatus status;
  final AuthUser? user;
  final ApiException? error;
  final SessionEndReason? sessionEndReason;
  final Map<String, dynamic>? registrationGrant;

  bool get isAuthenticated =>
      user != null &&
      (status == AuthStatus.authenticated ||
          status == AuthStatus.refreshing ||
          status == AuthStatus.retryableFailure);
}

final authControllerProvider = AsyncNotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

class AuthController extends AsyncNotifier<AuthState> {
  AuthRepository get _repository => ref.read(authRepositoryProvider);
  late AuthSessionCoordinator _coordinator;
  SessionRepository get _sessionRepository =>
      ref.read(sessionRepositoryProvider);

  AuthUser? _currentUser;
  Map<String, dynamic>? _registrationGrant;
  int _authAttempt = 0;
  bool _disposed = false;
  Object? _loginFailure;
  bool _displayLoginFailure = false;

  /// The current login attempt's failure survives router page recreation.
  Object? get loginFailure => _loginFailure;
  bool _isCurrent(int attempt) => !_disposed && attempt == _authAttempt;

  @override
  Future<AuthState> build() async {
    ref.read(authenticatedActorBindingProvider).clear();
    _coordinator = ref.read(authSessionCoordinatorProvider);
    _coordinator.setListener(_handleSessionTransition);
    ref.onDispose(() {
      _disposed = true;
      _authAttempt++;
      _coordinator.setListener(null);
    });
    final bundle = await _coordinator.restoreBundle();
    if (bundle == null) return const AuthState.unauthenticated();
    return _restoreLoadedSession();
  }

  Future<void> retryRestore() async {
    state = const AsyncData(AuthState.authenticating());
    final bundle = await _coordinator.restoreBundle();
    if (bundle == null) {
      state = const AsyncData(AuthState.unauthenticated());
      return;
    }
    state = AsyncData(await _restoreLoadedSession());
  }

  Future<void> login({required String email, required String password}) {
    _loginFailure = null;
    _displayLoginFailure = true;
    _registrationGrant = null;
    return _completeAuthentication(
      () => _repository.login(email: email, password: password),
    );
  }

  Future<void> register({
    required String name,
    required String email,
    required String password,
    String locale = 'ar',
  }) {
    _loginFailure = null;
    _displayLoginFailure = false;
    return _startRegistration(
      () => _repository.register(
        name: name,
        email: email,
        password: password,
        locale: locale,
      ),
    );
  }

  Future<void> loginWithGoogle({required String idToken}) {
    _loginFailure = null;
    _displayLoginFailure = true;
    return _startRegistration(
      () => _repository.loginWithGoogle(idToken: idToken),
    );
  }

  Future<void> _startRegistration(
    Future<Map<String, dynamic>> Function() request,
  ) async {
    final attempt = ++_authAttempt;
    _registrationGrant = null;
    state = const AsyncData(AuthState.authenticating());
    try {
      final response = await request();
      if (!_isCurrent(attempt)) return;
      if (response['registration_token'] is String &&
          [
            'verify_email',
            'consent_required',
          ].contains(response['next_action']) &&
          DateTime.tryParse(
                response['expires_at'] as String? ?? '',
              )?.isAfter(DateTime.now()) ==
              true) {
        _registrationGrant = response;
        state = AsyncData(
          AuthState(
            status: AuthStatus.registrationRequired,
            registrationGrant: response,
          ),
        );
      } else {
        await _completeAuthentication(
          () async => LoginResult.fromJson(response),
          attempt: attempt,
        );
      }
    } catch (error, stack) {
      if (!_isCurrent(attempt)) return;
      final failure = error is ApiException
          ? error
          : const ApiException(ApiErrorType.validation, 'invalid_response');
      if (_displayLoginFailure) _loginFailure = failure;
      state = const AsyncData(AuthState.unauthenticated());
      state = AsyncError(failure, stack);
    }
  }

  Future<void> completeRegistration({
    required String locale,
    required List<Map<String, dynamic>> documents,
    required String emailToken,
    required String name,
  }) async {
    final grant = _registrationGrant;
    if (grant == null) return;
    await _completeAuthentication(
      () => _repository.completeRegistration(
        grant: grant,
        locale: locale,
        documents: documents,
        emailToken: emailToken,
        name: name,
      ),
    );
  }

  void cancelRegistration() {
    _authAttempt++;
    _registrationGrant = null;
    state = const AsyncData(AuthState.unauthenticated());
  }

  Future<void> reloadProfile() async {
    final attempt = _authAttempt;
    final user = await _repository.me();
    if (!_isCurrent(attempt)) return;
    _bindAuthenticatedActor(user);
    state = AsyncData(AuthState.authenticated(user));
  }

  Future<void> _completeAuthentication(
    Future<LoginResult> Function() run, {
    int? attempt,
  }) async {
    final generation = attempt ?? ++_authAttempt;
    if (_registrationGrant == null) {
      state = const AsyncData(AuthState.authenticating());
    }
    try {
      final result = await run();
      if (!_isCurrent(generation)) return;
      await _coordinator.installBundle(result.bundle);
      if (!_isCurrent(generation)) return;
      await _clearOnboardingState();
      if (!_isCurrent(generation)) return;
      _bindAuthenticatedActor(result.user);
      _registrationGrant = null;
      state = AsyncData(AuthState.authenticated(result.user));
    } on ApiException catch (error, stackTrace) {
      if (!_isCurrent(generation)) return;
      if (_displayLoginFailure) _loginFailure = error;
      // Riverpod keeps the prior value alongside an error, so settle back to
      // unauthenticated first: leaving `authenticating` as the retained value
      // would strand every screen watching this provider on a spinner.
      if (_registrationGrant != null) {
        state = AsyncData(
          AuthState(
            status: AuthStatus.registrationRequired,
            registrationGrant: _registrationGrant,
            error: error,
          ),
        );
      } else {
        state = const AsyncData(AuthState.unauthenticated());
        state = AsyncError(error, stackTrace);
      }
    }
  }

  /// Drops a failed attempt's error so it cannot surface on another screen.
  void clearError() {
    _loginFailure = null;
    _displayLoginFailure = false;
    if (state.hasError) state = const AsyncData(AuthState.unauthenticated());
  }

  Future<void> retryRefresh() async {
    try {
      await _coordinator.retryRefresh();
    } on ApiException {
      // The coordinator publishes either retryable or terminal state.
    }
  }

  Future<void> logout() async {
    _authAttempt++;
    _registrationGrant = null;
    try {
      await _sessionRepository.logout();
    } catch (_) {
      // Explicit logout is local-first safe even when server revocation cannot
      // be confirmed because the network is unavailable.
    }
    await _clearLocalSession();
  }

  Future<void> logoutAll() async {
    _authAttempt++;
    _registrationGrant = null;
    await _sessionRepository.logoutAll();
    await _clearLocalSession();
  }

  Future<void> completeCurrentSessionRevocation() async {
    _authAttempt++;
    await _coordinator.clearCredentials();
    _clearAuthenticatedActor();
    _invalidateAuthenticatedWork();
    state = const AsyncData(AuthState.sessionEnded(SessionEndReason.ended));
  }

  Future<AuthState> _restoreLoadedSession() async {
    try {
      final user = await _repository.me();
      await _coordinator.promoteLegacyBundle();
      await _clearOnboardingState();
      _bindAuthenticatedActor(user);
      return AuthState.authenticated(user);
    } on ApiException catch (error) {
      if (error.type == ApiErrorType.network ||
          error.type == ApiErrorType.timeout ||
          error.type == ApiErrorType.server) {
        return AuthState.restoreFailed(error);
      }
      final reason = _coordinator.lastTerminationReason;
      if (reason != null) return AuthState.sessionEnded(reason);
      await _coordinator.clearCredentials();
      _clearAuthenticatedActor();
      return const AuthState.unauthenticated();
    }
  }

  Future<void> _clearLocalSession() async {
    await _coordinator.clearCredentials();
    _clearAuthenticatedActor();
    _invalidateAuthenticatedWork();
    state = const AsyncData(AuthState.unauthenticated());
  }

  void _handleSessionTransition(SessionTransition transition) {
    switch (transition.type) {
      case SessionTransitionType.refreshing:
        final user = _currentUser;
        if (user != null) state = AsyncData(AuthState.refreshing(user));
        break;
      case SessionTransitionType.refreshed:
        final user = _currentUser;
        if (user != null) state = AsyncData(AuthState.authenticated(user));
        break;
      case SessionTransitionType.retryableFailure:
        final user = _currentUser;
        final error = transition.error;
        if (user != null && error != null) {
          state = AsyncData(AuthState.retryableFailure(user, error));
        }
        break;
      case SessionTransitionType.terminated:
        _authAttempt++;
        _clearAuthenticatedActor();
        _invalidateAuthenticatedWork();
        state = AsyncData(
          AuthState.sessionEnded(transition.reason ?? SessionEndReason.ended),
        );
        break;
    }
  }

  void _invalidateAuthenticatedWork() {
    ref.invalidate(passengerDashboardProvider);
    // The trip history outlives a single dashboard load, so it has to be
    // dropped here too or the next account inherits the previous one's trips.
    ref.invalidate(passengerHistoryProvider);
    ref.invalidate(passengerRequestDetailProvider);
    ref.invalidate(passengerTripControllerProvider);
    ref.invalidate(driverDashboardProvider);
    ref.invalidate(driverTrustScoreProvider);
    ref.invalidate(driverRouteControllerProvider);
    ref.invalidate(driverMatchInboxProvider);
    ref.invalidate(driverMatchDetailProvider);
    ref.invalidate(driverTripControllerProvider);
    ref.invalidate(merchantDashboardProvider);
    ref.invalidate(merchantOrderDraftProvider);
    ref.invalidate(merchantOrderProvider);
    ref.invalidate(merchantMatchInboxProvider);
    ref.invalidate(merchantMatchDetailProvider);
    ref.invalidate(merchantTripProvider);
    ref.invalidate(mobileCapabilitiesProvider);
    ref.invalidate(canonicalRouteCatalogProvider);
    ref.invalidate(driverAvailabilitiesProvider);
    ref.invalidate(driverCanonicalOffersProvider);
    ref.invalidate(driverCanonicalOfferDetailProvider);
    ref.invalidate(sharedDriverOffersProvider);
    ref.invalidate(sharedDriverOfferDetailProvider);
    ref.invalidate(passengerCanonicalAssignmentsProvider);
    ref.invalidate(merchantCanonicalAssignmentsProvider);
    ref.invalidate(canonicalAssignmentDetailProvider);
  }

  void _bindAuthenticatedActor(AuthUser user) {
    _currentUser = user;
    ref.read(authenticatedActorBindingProvider).bind(user.id);
  }

  void _clearAuthenticatedActor() {
    _currentUser = null;
    ref.read(authenticatedActorBindingProvider).clear();
  }

  Future<void> _clearOnboardingState() async {
    await ref.read(onboardingStorageProvider).clear();
    ref.invalidate(onboardingControllerProvider);
  }
}
