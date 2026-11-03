import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/api_error.dart';
import '../domain/auth_models.dart';
import 'token_storage.dart';

final authSessionCoordinatorProvider = Provider<AuthSessionCoordinator>((ref) {
  return AuthSessionCoordinator(
    apiClient: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
  );
});

enum SessionTransitionType {
  refreshing,
  refreshed,
  retryableFailure,
  terminated,
}

class SessionTransition {
  const SessionTransition._(this.type, {this.error, this.reason});

  const SessionTransition.refreshing()
    : this._(SessionTransitionType.refreshing);

  const SessionTransition.refreshed() : this._(SessionTransitionType.refreshed);

  const SessionTransition.retryable(ApiException error)
    : this._(SessionTransitionType.retryableFailure, error: error);

  const SessionTransition.terminated(SessionEndReason reason)
    : this._(SessionTransitionType.terminated, reason: reason);

  final SessionTransitionType type;
  final ApiException? error;
  final SessionEndReason? reason;
}

typedef SessionTransitionListener = void Function(SessionTransition event);

class AuthSessionCoordinator {
  AuthSessionCoordinator({
    required this.apiClient,
    required this.tokenStorage,
    this.refreshThreshold = const Duration(seconds: 60),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final ApiClient apiClient;
  final TokenStorage tokenStorage;
  final Duration refreshThreshold;
  final DateTime Function() _now;

  AuthTokenBundle? _bundle;
  Future<AuthTokenBundle>? _refreshFuture;
  Future<void>? _terminalFuture;
  Future<void> _storageTail = Future<void>.value();
  SessionTransitionListener? _listener;
  SessionEndReason? _lastTerminationReason;
  ApiException? _retryableRefreshError;
  int _credentialGeneration = 0;

  AuthTokenBundle? get cachedBundle => _bundle;
  String? get currentSessionId => _bundle?.sessionId;
  SessionEndReason? get lastTerminationReason => _lastTerminationReason;

  void setListener(SessionTransitionListener? listener) {
    _listener = listener;
  }

  Future<AuthTokenBundle?> restoreBundle() async {
    final generation = ++_credentialGeneration;
    _bundle = null;
    _refreshFuture = null;
    _retryableRefreshError = null;
    _lastTerminationReason = null;
    _terminalFuture = null;
    final restored = await _withStorageLock(tokenStorage.readBundle);
    if (generation != _credentialGeneration) return _bundle;
    _bundle = restored;
    return _bundle;
  }

  Future<void> installBundle(AuthTokenBundle bundle) async {
    final generation = ++_credentialGeneration;
    _bundle = null;
    _refreshFuture = null;
    _retryableRefreshError = null;
    _lastTerminationReason = null;
    _terminalFuture = null;
    try {
      await _withStorageLock(() async {
        if (generation != _credentialGeneration) throw _authStateChanged;
        await tokenStorage.saveBundle(bundle);
      });
      if (generation != _credentialGeneration) throw _authStateChanged;
      _bundle = bundle;
    } on ApiException {
      rethrow;
    } catch (_) {
      if (generation == _credentialGeneration) {
        _bundle = null;
        await _discardStoredCredentials();
      }
      throw const ApiException(
        ApiErrorType.validation,
        'secure_storage_unavailable',
      );
    }
  }

  Future<void> promoteLegacyBundle() async {
    final bundle = _bundle;
    if (bundle == null || !bundle.legacyAccessOnly) return;
    final generation = _credentialGeneration;
    final migrated = bundle.asMigratedLegacy();
    try {
      await _withStorageLock(() async {
        if (!_isCurrentCredential(bundle, generation)) {
          throw _authStateChanged;
        }
        await tokenStorage.promoteLegacy(migrated);
      });
      if (!_isCurrentCredential(bundle, generation)) {
        throw _authStateChanged;
      }
      _bundle = migrated;
      _credentialGeneration += 1;
    } on ApiException {
      rethrow;
    } catch (_) {
      throw const ApiException(
        ApiErrorType.validation,
        'secure_storage_unavailable',
      );
    }
  }

  Future<void> clearCredentials({SessionEndReason? reason}) async {
    if (reason != null) {
      await _terminate(reason);
      return;
    }
    _credentialGeneration += 1;
    _bundle = null;
    _refreshFuture = null;
    _retryableRefreshError = null;
    _lastTerminationReason = null;
    _terminalFuture = null;
    await _discardStoredCredentials();
  }

  Future<Map<String, dynamic>> sendAuthenticated(
    Future<Map<String, dynamic>> Function(String accessToken) request, {
    Future<void> Function()? beforeRetry,
  }) async {
    var bundle = await _bundleForRequest();
    try {
      return await request(bundle.accessToken);
    } on ApiException catch (error) {
      if (error.message == 'access_token_expired' && bundle.canRefresh) {
        final current = _bundle;
        if (!identical(current, bundle)) {
          if (!_sameSession(bundle, current)) throw _authStateChanged;
          bundle = current!;
        } else {
          bundle = await refresh();
        }
        if (!identical(_bundle, bundle)) throw _authStateChanged;
        await beforeRetry?.call();
        try {
          return await request(bundle.accessToken);
        } on ApiException catch (retryError) {
          await _handleFinalAccessError(retryError, bundle);
          rethrow;
        }
      }
      await _handleFinalAccessError(error, bundle);
      rethrow;
    }
  }

  Future<AuthTokenBundle> refresh() async {
    final active = _refreshFuture;
    if (active != null) return active;

    final bundle = _bundle ?? await _loadBundle();
    if (bundle == null) {
      await _terminate(SessionEndReason.ended);
      throw const ApiException(
        ApiErrorType.unauthorized,
        'missing_token',
        statusCode: 401,
      );
    }
    final generation = _credentialGeneration;
    final future = _performRefresh(bundle, generation);
    _refreshFuture = future;
    try {
      return await future;
    } finally {
      if (identical(_refreshFuture, future)) _refreshFuture = null;
    }
  }

  Future<AuthTokenBundle> retryRefresh() async {
    final active = _refreshFuture;
    if (active != null) {
      try {
        return await active;
      } catch (_) {
        // The failed flight must finish before an explicit retry starts.
      }
    }
    _retryableRefreshError = null;
    return refresh();
  }

  Future<AuthTokenBundle> _bundleForRequest() async {
    final bundle = _bundle ?? await _loadBundle();
    if (bundle == null) {
      await _terminate(SessionEndReason.ended);
      throw const ApiException(
        ApiErrorType.unauthorized,
        'missing_token',
        statusCode: 401,
      );
    }

    final retryableError = _retryableRefreshError;
    if (retryableError != null) throw retryableError;

    final accessExpiry = bundle.accessTokenExpiresAt;
    if (accessExpiry == null) return bundle;

    final remaining = accessExpiry.difference(_now().toUtc());
    if (remaining <= Duration.zero && !bundle.canRefresh) {
      await _terminate(SessionEndReason.expired);
      throw const ApiException(
        ApiErrorType.unauthorized,
        'access_token_expired',
        statusCode: 401,
      );
    }
    if (bundle.canRefresh && remaining < refreshThreshold) {
      return refresh();
    }
    return bundle;
  }

  Future<AuthTokenBundle> _performRefresh(
    AuthTokenBundle bundle,
    int generation,
  ) async {
    final refreshToken = bundle.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) {
      await _terminate(SessionEndReason.ended);
      throw const ApiException(
        ApiErrorType.unauthorized,
        'invalid_refresh_token',
        statusCode: 401,
      );
    }
    if (!_isCurrentCredential(bundle, generation)) throw _authStateChanged;
    final refreshExpiry = bundle.refreshTokenExpiresAt;
    if (refreshExpiry != null && !refreshExpiry.isAfter(_now().toUtc())) {
      await _terminate(SessionEndReason.expired);
      throw const ApiException(
        ApiErrorType.unauthorized,
        'session_expired',
        statusCode: 401,
      );
    }

    _emit(const SessionTransition.refreshing());
    try {
      final json = await apiClient.postJson(
        '/auth/refresh',
        body: {'refresh_token': refreshToken},
      );
      final result = LoginResult.fromJson(json, receivedAt: _now().toUtc());
      final replacement = result.bundle;
      if (!replacement.canRefresh ||
          (bundle.sessionId != null &&
              replacement.sessionId != bundle.sessionId)) {
        throw const FormatException('Invalid refresh response');
      }
      await _withStorageLock(() async {
        if (!_isCurrentCredential(bundle, generation)) {
          throw _authStateChanged;
        }
        await tokenStorage.saveBundle(replacement);
      });
      if (!_isCurrentCredential(bundle, generation)) {
        throw _authStateChanged;
      }
      _bundle = replacement;
      _credentialGeneration += 1;
      _retryableRefreshError = null;
      _lastTerminationReason = null;
      _emit(const SessionTransition.refreshed());
      return replacement;
    } on ApiException catch (error) {
      if (error.message == _authStateChanged.message) rethrow;
      if (_isRetryableRefreshFailure(error)) {
        if (_isCurrentCredential(bundle, generation)) {
          _retryableRefreshError = error;
          _emit(SessionTransition.retryable(error));
        }
        rethrow;
      }
      if (_isCurrentCredential(bundle, generation)) {
        final reason = sessionEndReasonForCode(error.message);
        await _terminate(reason);
      }
      rethrow;
    } on FormatException {
      if (!_isCurrentCredential(bundle, generation)) {
        throw _authStateChanged;
      }
      await _terminate(SessionEndReason.ended);
      throw const ApiException(
        ApiErrorType.validation,
        'invalid_refresh_response',
      );
    } catch (_) {
      if (!_isCurrentCredential(bundle, generation)) {
        throw _authStateChanged;
      }
      await _terminate(SessionEndReason.ended);
      throw const ApiException(
        ApiErrorType.validation,
        'invalid_refresh_response',
      );
    }
  }

  Future<void> _handleFinalAccessError(
    ApiException error,
    AuthTokenBundle requestBundle,
  ) async {
    if (!_belongsToCurrentSession(requestBundle)) return;
    if (error.message == 'access_token_expired') {
      await _terminate(SessionEndReason.expired);
      return;
    }
    if (_terminalAccessCodes.contains(error.message)) {
      await _terminate(sessionEndReasonForCode(error.message));
    }
  }

  /// Only the server's authentication verdict (401, or 403 for an unavailable
  /// account) ends the session. Anything else, such as an outage, a proxy
  /// error page or a captive portal, keeps the refresh token for a retry: if
  /// the token was in fact spent, the retry is rejected as reuse and ends the
  /// session then.
  bool _isRetryableRefreshFailure(ApiException error) {
    return !isDefiniteAuthRejection(error);
  }

  Future<void> _terminate(SessionEndReason reason) {
    final active = _terminalFuture;
    if (active != null) return active;
    final future = _clearAndNotify(reason);
    _terminalFuture = future;
    return future;
  }

  Future<void> _clearAndNotify(SessionEndReason reason) async {
    _credentialGeneration += 1;
    _bundle = null;
    _refreshFuture = null;
    _retryableRefreshError = null;
    _lastTerminationReason = reason;
    await _discardStoredCredentials();
    _emit(SessionTransition.terminated(reason));
  }

  void _emit(SessionTransition transition) => _listener?.call(transition);

  Future<AuthTokenBundle?> _loadBundle() async {
    if (_lastTerminationReason != null) return null;
    final generation = _credentialGeneration;
    final loaded = await _withStorageLock(tokenStorage.readBundle);
    if (generation != _credentialGeneration) return _bundle;
    _bundle = loaded;
    return _bundle;
  }

  bool _isCurrentCredential(AuthTokenBundle bundle, int generation) {
    return generation == _credentialGeneration && identical(_bundle, bundle);
  }

  bool _belongsToCurrentSession(AuthTokenBundle requestBundle) {
    final current = _bundle;
    return identical(current, requestBundle) ||
        _sameSession(requestBundle, current);
  }

  bool _sameSession(AuthTokenBundle left, AuthTokenBundle? right) {
    final leftSession = left.sessionId;
    return right != null &&
        leftSession != null &&
        right.sessionId == leftSession;
  }

  Future<void> _discardStoredCredentials() async {
    try {
      await _withStorageLock(tokenStorage.clearAuth);
    } catch (_) {
      // In-memory authentication has already been invalidated. Storage errors
      // must never keep a user authenticated or suppress the terminal event.
    }
  }

  Future<T> _withStorageLock<T>(Future<T> Function() operation) async {
    final previous = _storageTail;
    final release = Completer<void>();
    _storageTail = release.future;
    await previous;
    try {
      return await operation();
    } finally {
      release.complete();
    }
  }
}

const _authStateChanged = ApiException(
  ApiErrorType.unauthorized,
  'auth_state_changed',
);

/// Whether [error] is the server definitively refusing the credentials, as
/// opposed to an outage, a proxy error page or a malformed answer. Only a
/// definite rejection may discard stored credentials.
bool isDefiniteAuthRejection(ApiException error) {
  return error.type == ApiErrorType.unauthorized ||
      (error.type == ApiErrorType.forbidden &&
          error.message == 'account_unavailable');
}

const _terminalAccessCodes = {
  'invalid_token',
  'invalid_session',
  'session_revoked',
  'session_expired',
  'account_unavailable',
  'missing_token',
};
