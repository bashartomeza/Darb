import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// OAuth client IDs, supplied at build time with `--dart-define`.
///
/// - [_webClientId]  the Web OAuth client ID (used as `clientId` on web).
/// - [_iosClientId]  the iOS OAuth client ID (used as `clientId` on iOS/macOS).
/// - [_serverClientId] the client ID the backend expects as the ID-token
///   audience (normally the Web client ID). Passed as `serverClientId` on every
///   platform so Android/iOS return an ID token the API can verify.
const _webClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');
const _iosClientId = String.fromEnvironment('GOOGLE_IOS_CLIENT_ID');
const _serverClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');

final googleSignInServiceProvider = Provider<GoogleSignInService>((ref) {
  return GoogleSignInService();
});

/// Thin wrapper over `google_sign_in` v7 that yields a Google **ID token** for
/// the backend's `POST /auth/google`.
///
/// On web, interactive sign-in must go through the rendered Google button
/// (see `GoogleAuthButton`); its result is delivered on [authenticationEvents].
/// On Android/iOS/macOS, [authenticate] runs the native flow directly.
class GoogleSignInService {
  GoogleSignInService();

  Future<void>? _initialization;

  /// Whether a client ID is present for the current platform. When false the
  /// UI should hide the Google option rather than fail on tap.
  bool get isConfigured {
    if (kIsWeb) return _webClientId.isNotEmpty;
    return _serverClientId.isNotEmpty || _webClientId.isNotEmpty;
  }

  /// True on platforms where [authenticate] works; web must use the button.
  bool get supportsDirectAuthentication => !kIsWeb;

  Stream<GoogleSignInAuthenticationEvent> get authenticationEvents =>
      GoogleSignIn.instance.authenticationEvents;

  Future<void> ensureInitialized() {
    return _initialization ??= _initialize();
  }

  Future<void> _initialize() async {
    if (!isConfigured) return;
    try {
      await GoogleSignIn.instance.initialize(
        clientId: kIsWeb
            ? _nullIfEmpty(_webClientId)
            : _nullIfEmpty(_iosClientId),
        serverClientId: _nullIfEmpty(
          _serverClientId.isNotEmpty ? _serverClientId : _webClientId,
        ),
      );
    } catch (_) {
      // Missing platform plugin (e.g. unit tests) or a misconfigured client:
      // leave the service inert so the caller can surface a friendly error
      // instead of crashing the whole screen.
      _initialization = null;
      rethrow;
    }
  }

  /// Runs the native Google sign-in flow and returns the ID token, or null if
  /// the user dismissed the picker.
  Future<String?> authenticate() async {
    await ensureInitialized();
    try {
      final account = await GoogleSignIn.instance.authenticate(
        scopeHint: const ['email', 'profile'],
      );
      return account.authentication.idToken;
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) return null;
      rethrow;
    }
  }

  Future<void> signOut() async {
    await ensureInitialized();
    await GoogleSignIn.instance.signOut();
  }

  static String? _nullIfEmpty(String value) => value.isEmpty ? null : value;
}
