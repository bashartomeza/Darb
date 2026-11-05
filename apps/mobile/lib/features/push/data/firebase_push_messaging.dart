import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../push_config.dart';
import 'push_messaging.dart';

/// [PushMessaging] over Firebase Cloud Messaging.
///
/// Only constructed for builds with `PUSH_ENABLED=true`. Initialisation
/// failures (no Firebase values and no native config file) are swallowed and
/// reported as "not available", so a misconfigured build simply has no push.
class FirebasePushMessaging implements PushMessaging {
  FirebasePushMessaging(this._values);

  final FirebaseClientValues? _values;

  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  @override
  String get platform {
    if (kIsWeb) return 'web';
    return defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
  }

  @override
  Future<bool> initialize() async {
    try {
      if (Firebase.apps.isEmpty) {
        final values = _values;
        await Firebase.initializeApp(
          options: values == null
              ? null
              : FirebaseOptions(
                  apiKey: values.apiKey,
                  appId: values.appId,
                  messagingSenderId: values.messagingSenderId,
                  projectId: values.projectId,
                  iosBundleId: values.iosBundleId,
                ),
        );
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<PushPermission> permissionStatus() async {
    final settings = await _messaging.getNotificationSettings();
    return _permission(settings.authorizationStatus);
  }

  @override
  Future<PushPermission> requestPermission() async {
    final settings = await _messaging.requestPermission();
    return _permission(settings.authorizationStatus);
  }

  static PushPermission _permission(AuthorizationStatus status) =>
      switch (status) {
        AuthorizationStatus.authorized ||
        AuthorizationStatus.provisional => PushPermission.granted,
        AuthorizationStatus.denied ||
        AuthorizationStatus.deniedPermanently => PushPermission.denied,
        AuthorizationStatus.notDetermined => PushPermission.notDetermined,
      };

  // The classic FCM registration token, which the API sends to through the
  // HTTP v1 `message.token` field. Newer firebase_messaging (17+) deprecates
  // it in favour of Firebase Installation ID registration; moving to
  // installation IDs would need a matching server change.
  @override
  Future<String?> token() async {
    try {
      // ignore: deprecated_member_use
      return await _messaging.getToken();
    } catch (_) {
      // iOS before the APNs token arrives, or no network: onTokenRefresh
      // delivers it later.
      return null;
    }
  }

  @override
  // ignore: deprecated_member_use
  Stream<String> get onTokenRefresh => _messaging.onTokenRefresh;

  @override
  Stream<Map<String, String>> get onForegroundMessage =>
      FirebaseMessaging.onMessage.map(_data);

  @override
  Stream<Map<String, String>> get onOpened =>
      FirebaseMessaging.onMessageOpenedApp.map(_data);

  @override
  Future<Map<String, String>?> initialOpened() async {
    final message = await _messaging.getInitialMessage();
    return message == null ? null : _data(message);
  }

  static Map<String, String> _data(RemoteMessage message) => {
    for (final entry in message.data.entries)
      if (entry.value != null) entry.key: entry.value.toString(),
  };
}
