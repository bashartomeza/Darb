import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../push_config.dart';
import 'firebase_push_messaging.dart';

enum PushPermission { granted, denied, notDetermined }

/// The slice of a push SDK the app uses. The Firebase implementation lives in
/// [FirebasePushMessaging]; tests use a fake.
abstract class PushMessaging {
  /// Starts the SDK. False when this build has no usable Firebase setup, in
  /// which case nothing else is called.
  Future<bool> initialize();

  /// `android`, `ios` or `web`, as the API expects.
  String get platform;

  Future<PushPermission> permissionStatus();

  /// Shows the system prompt where the platform has one.
  Future<PushPermission> requestPermission();

  Future<String?> token();

  Stream<String> get onTokenRefresh;

  /// Data payload of a push received while the app is in the foreground.
  Stream<Map<String, String>> get onForegroundMessage;

  /// Data payload of a push the user tapped while the app was running.
  Stream<Map<String, String>> get onOpened;

  /// Data payload of the push that launched the app, if any.
  Future<Map<String, String>?> initialOpened();
}

/// Null unless the build opted in with `--dart-define=PUSH_ENABLED=true`.
final pushMessagingProvider = Provider<PushMessaging?>((ref) {
  final config = ref.watch(pushBuildConfigProvider);
  if (!config.enabled) return null;
  return FirebasePushMessaging(config.firebase);
});
