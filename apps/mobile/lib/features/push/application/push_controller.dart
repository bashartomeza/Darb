import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/i18n/domain_labels.dart';
import '../../../core/i18n/locale_controller.dart';
import '../../../core/routing/app_router.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/auth_models.dart';
import '../../notifications/application/notifications_controller.dart';
import '../data/push_messaging.dart';
import '../data/push_repository.dart';
import '../push_config.dart';
import 'push_tap_target.dart';

class PushState {
  const PushState({
    required this.available,
    this.permission = PushPermission.notDetermined,
    this.registered = false,
  });

  /// Push is off in this build, or Firebase could not start.
  static const off = PushState(available: false);

  /// This build can receive pushes (PUSH_ENABLED and Firebase configured).
  final bool available;
  final PushPermission permission;

  /// This phone's token is registered for the signed-in account.
  final bool registered;

  PushState copyWith({PushPermission? permission, bool? registered}) =>
      PushState(
        available: available,
        permission: permission ?? this.permission,
        registered: registered ?? this.registered,
      );
}

typedef PushNavigate = void Function(String location, {required bool push});

/// Opens the screen for a tapped push through the app router.
final pushNavigatorProvider = Provider<PushNavigate>((ref) {
  return (location, {required push}) {
    final router = ref.read(appRouterProvider);
    if (push) {
      unawaited(router.push<void>(location));
    } else {
      router.go(location);
    }
  };
});

/// Remembers the token registered for the current session so logout can
/// unregister it. Kept apart from [PushController] so the auth controller can
/// reach it without depending on a provider that itself watches auth.
class PushRegistration {
  PushRegistration(this._ref);

  static const unregisterTimeout = Duration(seconds: 3);

  final Ref _ref;
  String? token;

  /// Called just before the session ends, while the API still accepts it.
  /// Bounded so a slow network never holds up logout; the server revokes the
  /// registration with the session anyway. A no-op when nothing is registered
  /// (always the case on builds without push).
  Future<void> unregisterBeforeSignOut() async {
    final registered = token;
    token = null;
    if (registered == null) return;
    try {
      await _ref
          .read(pushRepositoryProvider)
          .unregister(registered)
          .timeout(unregisterTimeout);
    } catch (_) {}
  }
}

final pushRegistrationProvider = Provider<PushRegistration>(
  PushRegistration.new,
);

/// Push notifications for the signed-in account.
///
/// Dormant (state [PushState.off], no SDK calls) unless the build enabled push
/// and Firebase initialised. Then it registers this phone's token with the API
/// whenever someone is signed in and the OS allows notifications, keeps the
/// token and language current, unregisters on logout, and turns a tapped push
/// into the same navigation the inbox uses. It never asks for permission by
/// itself: [promptAfterSignIn] (once, from the signed-in home) and the settings
/// toggle do.
final pushControllerProvider = NotifierProvider<PushController, PushState>(
  PushController.new,
);

class PushController extends Notifier<PushState> {
  static const promptedKey = 'push.permission_prompted';

  PushMessaging? _messaging;
  bool _ready = false;
  AuthUser? _user;
  Map<String, String>? _pendingTap;
  final List<StreamSubscription<Object?>> _subscriptions = [];

  @override
  PushState build() {
    final messaging = ref.watch(pushMessagingProvider);
    _messaging = messaging;
    _ready = false;
    ref.onDispose(_cancelSubscriptions);
    if (messaging == null) return PushState.off;

    ref.listen<AuthUser?>(
      authControllerProvider.select((auth) {
        final value = auth.value;
        return value != null && value.isAuthenticated ? value.user : null;
      }),
      (_, user) => _onUser(user),
      fireImmediately: true,
    );
    ref.listen<String?>(
      localeControllerProvider.select((locale) => locale.value?.languageCode),
      (previous, next) {
        // Push text is written in the language the phone registered with.
        if (previous != null &&
            next != previous &&
            ref.read(pushRegistrationProvider).token != null) {
          unawaited(_register());
        }
      },
    );
    unawaited(_start(messaging));
    return PushState.off;
  }

  Future<void> _start(PushMessaging messaging) async {
    final ok = await messaging.initialize();
    if (!ok || !ref.mounted) return;
    _ready = true;
    _subscriptions
      ..add(messaging.onTokenRefresh.listen((token) => _register(token: token)))
      ..add(messaging.onOpened.listen(_handleTap))
      ..add(messaging.onForegroundMessage.listen((_) => _refreshInbox()));
    PushPermission permission;
    try {
      permission = await messaging.permissionStatus();
    } catch (_) {
      permission = PushPermission.notDetermined;
    }
    if (!ref.mounted) return;
    state = PushState(available: true, permission: permission);
    try {
      final initial = await messaging.initialOpened();
      if (initial != null) _handleTap(initial);
    } catch (_) {}
    if (_user != null) {
      await _register();
      _flushPendingTap();
    }
  }

  void _onUser(AuthUser? user) {
    final previous = _user;
    _user = user;
    if (user == null) {
      // Signed out: the server already revoked this phone's registration.
      ref.read(pushRegistrationProvider).token = null;
      if (_ready) state = state.copyWith(registered: false);
      return;
    }
    if (previous?.id == user.id) return;
    ref.read(pushRegistrationProvider).token = null;
    if (!_ready) return;
    unawaited(_register());
    _flushPendingTap();
  }

  Future<void> _register({String? token}) async {
    final messaging = _messaging;
    if (!_ready || messaging == null || _user == null) return;
    try {
      final permission = await messaging.permissionStatus();
      if (!ref.mounted) return;
      state = state.copyWith(permission: permission);
      if (permission != PushPermission.granted) return;
      final value = token ?? await messaging.token();
      if (value == null || !ref.mounted || _user == null) return;
      final locale =
          ref.read(localeControllerProvider).value?.languageCode ??
          DomainLabels.defaultLocale.languageCode;
      await ref
          .read(pushRepositoryProvider)
          .register(
            token: value,
            platform: messaging.platform,
            locale: locale,
            appVersion: pushAppVersion.isEmpty ? null : pushAppVersion,
          );
      if (!ref.mounted) return;
      ref.read(pushRegistrationProvider).token = value;
      state = state.copyWith(registered: true);
    } catch (_) {
      // Retried on the next launch, sign-in, token refresh or language change.
    }
  }

  /// Asks for notification permission once per install, after sign-in.
  Future<void> promptAfterSignIn() => requestPermission(onlyOnce: true);

  /// Shows the system prompt (unless already granted) and registers on
  /// success. With [onlyOnce], an install that was asked before is left alone.
  Future<PushPermission> requestPermission({bool onlyOnce = false}) async {
    final messaging = _messaging;
    if (!_ready || messaging == null || _user == null) return state.permission;
    try {
      final current = await messaging.permissionStatus();
      if (current == PushPermission.granted) {
        await _register();
        return current;
      }
      if (onlyOnce) {
        final preferences = await ref.read(sharedPreferencesProvider.future);
        if (preferences.getBool(promptedKey) ?? false) return current;
        await preferences.setBool(promptedKey, true);
      }
      final result = await messaging.requestPermission();
      if (!ref.mounted) return result;
      state = state.copyWith(permission: result);
      if (result == PushPermission.granted) await _register();
      return result;
    } catch (_) {
      return state.permission;
    }
  }

  /// See [PushRegistration.unregisterBeforeSignOut].
  Future<void> unregisterBeforeSignOut() async {
    await ref.read(pushRegistrationProvider).unregisterBeforeSignOut();
    if (ref.mounted && _ready) state = state.copyWith(registered: false);
  }

  void _handleTap(Map<String, String> data) {
    final user = _user;
    if (user == null) {
      // Opened from a cold start: navigate once the session is restored.
      _pendingTap = data;
      return;
    }
    final target = pushTapTarget(user.role, data);
    if (target == null) return;
    ref.read(pushNavigatorProvider)(target.location, push: target.push);
    _refreshInbox();
  }

  void _flushPendingTap() {
    final pending = _pendingTap;
    _pendingTap = null;
    if (pending != null) scheduleMicrotask(() => _handleTap(pending));
  }

  void _refreshInbox() {
    if (!ref.exists(notificationsControllerProvider)) return;
    unawaited(
      ref
          .read(notificationsControllerProvider.notifier)
          .refresh()
          .catchError((_) {}),
    );
  }

  void _cancelSubscriptions() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _subscriptions.clear();
  }
}

/// The account's push preference, loaded only where the toggle is shown.
final pushPreferenceProvider =
    AsyncNotifierProvider.autoDispose<PushPreferenceController, PushPreference>(
      PushPreferenceController.new,
    );

class PushPreferenceController extends AsyncNotifier<PushPreference> {
  @override
  Future<PushPreference> build() {
    ref.watch(authControllerProvider.select((auth) => auth.value?.user?.id));
    return ref.read(pushRepositoryProvider).preference();
  }

  /// Turning push on also asks the OS for permission if it was never given.
  Future<void> setEnabled(bool enabled) async {
    final previous = state.value;
    if (previous != null) {
      state = AsyncData(
        PushPreference(enabled: enabled, available: previous.available),
      );
    }
    try {
      if (enabled) {
        await ref.read(pushControllerProvider.notifier).requestPermission();
      }
      final saved = await ref.read(pushRepositoryProvider).setEnabled(enabled);
      if (ref.mounted) state = AsyncData(saved);
    } catch (error, stackTrace) {
      if (!ref.mounted) return;
      if (previous != null) {
        state = AsyncData(previous);
      } else {
        state = AsyncError(error, stackTrace);
      }
      rethrow;
    }
  }
}
