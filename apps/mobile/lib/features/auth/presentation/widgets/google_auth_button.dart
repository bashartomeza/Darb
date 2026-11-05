import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../data/google_sign_in_service.dart';
import '../../data/auth_repository.dart';
import 'auth_style.dart';
import 'google_render_button_stub.dart'
    if (dart.library.js_interop) 'google_render_button_web.dart';

/// How long a failed capabilities read waits before it is asked again while
/// the Google button is on screen.
const googleCapabilitiesRetryDelay = Duration(seconds: 15);

/// "Continue with Google" affordance.
///
/// On web this is the official Google Identity Services button and the ID
/// token arrives asynchronously on the sign-in event stream. On mobile it is a
/// normal outlined button that runs the native flow and returns the token
/// inline. Either way [onIdToken] fires once with a Google ID token.
class GoogleAuthButton extends ConsumerStatefulWidget {
  const GoogleAuthButton({
    super.key,
    required this.onIdToken,
    required this.onError,
    this.enabled = true,
  });

  final Future<void> Function(String) onIdToken;
  final ValueChanged<Object> onError;
  final bool enabled;

  @override
  ConsumerState<GoogleAuthButton> createState() => _GoogleAuthButtonState();
}

class _GoogleAuthButtonState extends ConsumerState<GoogleAuthButton> {
  StreamSubscription<GoogleSignInAuthenticationEvent>? _eventsSub;
  bool _busy = false;
  Timer? _capabilitiesRetry;

  GoogleSignInService get _service => ref.read(googleSignInServiceProvider);

  @override
  void initState() {
    super.initState();
    // A capabilities read that failed earlier in the session is asked again
    // whenever a sign-in screen shows the button, instead of hiding Google
    // until the app restarts.
    if (ref.read(authCapabilitiesProvider).hasError) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) ref.invalidate(authCapabilitiesProvider);
      });
    }
    if (!_service.isConfigured) return;
    _service.ensureInitialized().catchError((Object error) {
      if (mounted) widget.onError(error);
    });
    if (kIsWeb) {
      _eventsSub = _service.authenticationEvents.listen(
        _handleEvent,
        onError: (Object error) => widget.onError(error),
      );
    }
  }

  @override
  void dispose() {
    _capabilitiesRetry?.cancel();
    _eventsSub?.cancel();
    super.dispose();
  }

  void _retryCapabilitiesLater() {
    if (_capabilitiesRetry?.isActive ?? false) return;
    _capabilitiesRetry = Timer(googleCapabilitiesRetryDelay, () {
      if (mounted) ref.invalidate(authCapabilitiesProvider);
    });
  }

  Future<void> _handleEvent(GoogleSignInAuthenticationEvent event) async {
    if (!mounted || !widget.enabled || _busy) return;
    if (event is GoogleSignInAuthenticationEventSignIn) {
      final idToken = event.user.authentication.idToken;
      if (idToken == null) return;
      setState(() => _busy = true);
      try {
        await widget.onIdToken(idToken);
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    }
  }

  Future<void> _authenticateNative() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final idToken = await _service.authenticate();
      if (idToken != null && mounted) await widget.onIdToken(idToken);
    } catch (error) {
      widget.onError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final capabilities = ref.watch(authCapabilitiesProvider);
    ref.listen(authCapabilitiesProvider, (_, next) {
      if (next.hasError && !next.isLoading) _retryCapabilitiesLater();
    });
    if (capabilities.hasError && !capabilities.isLoading) {
      _retryCapabilitiesLater();
    }
    if (!_service.isConfigured ||
        capabilities.value?['google_mobile_login_available'] != true) {
      return const SizedBox.shrink();
    }

    if (kIsWeb) {
      // The GIS button paints its own label; disable pointer events while the
      // form is busy so a second click can't race the first.
      return Align(
        alignment: AlignmentDirectional.centerStart,
        child: IgnorePointer(
          ignoring: !widget.enabled || _busy,
          child: Opacity(
            opacity: widget.enabled ? 1 : 0.5,
            child: googleRenderButton(),
          ),
        ),
      );
    }

    return SizedBox(
      height: AuthStyle.fieldHeight,
      child: OutlinedButton(
        key: const ValueKey('googleSignInButton'),
        onPressed: widget.enabled && !_busy ? _authenticateNative : null,
        style: OutlinedButton.styleFrom(
          foregroundColor: AuthStyle.ink,
          side: const BorderSide(color: AuthStyle.border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AuthStyle.radius),
          ),
          textStyle: const TextStyle(fontSize: 16),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const GoogleGMark(),
            const SizedBox(width: 8),
            const Text('Google'),
          ],
        ),
      ),
    );
  }
}
